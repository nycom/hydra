export const meta = {
  name: 'hydra',
  description: 'Hydra run: implement workstreams in worktrees, review/fix/validate cycles until no critical or major is open, merge validated SHAs to feature branches with shared-file edits applied in order, whole-branch double review, cross-repo contract check, docs sync + docs validation',
  whenToUse: 'Called by the hydra:run skill after it has decomposed the plan, cut and pushed the feature branches, and written one brief per workstream. stage "wholeBranch" re-validates and docs-syncs the current feature-branch tips after coordinator fix-ups.',
  phases: [
    { title: 'Implement', detail: 'one author per workstream in its own worktree off the feature branch' },
    { title: 'Review cycles', detail: 'review one tier above the author (correctness + grilling in c1 + over-engineering) -> author fixes -> opus delta-validate' },
    { title: 'Merge', detail: 'validated SHA -> feature branch, then the workstream shared-file edits and regen, serialized per repo' },
    { title: 'Whole-branch', detail: 'integrated review + independent opus validator per repo, up to two fix rounds' },
    { title: 'Contracts', detail: 'one opus cross-repo wire-contract check once every repo is final (2+ repos)' },
    { title: 'Docs sync', detail: 'one sonnet docs agent (plus graph refresh when graphify-out exists) per docs repo, then an opus validator on its commit' },
  ],
}

// ---- args ----------------------------------------------------------------
const A = args || {}
const W = A.workstreams || []
if (!W.length) throw new Error('args.workstreams is empty')
const norm = repo => repo.replace(/\/+$/, '') // one key per repo, however the path was typed
const MODELS = ['sonnet', 'opus', 'fable'] // tier order; never below sonnet
for (const w of W) {
  for (const k of ['id', 'repo', 'featureBranch', 'branch', 'model', 'brief', 'gate'])
    if (!w[k]) throw new Error(`workstream ${w.id || '?'}: missing ${k}`)
  if (!['sonnet', 'opus'].includes(w.model)) throw new Error(`workstream ${w.id}: model must be sonnet|opus`)
  if (w.reviewModel && !MODELS.includes(w.reviewModel)) throw new Error(`workstream ${w.id}: reviewModel must be sonnet|opus|fable`)
  if (w.files != null && !(Array.isArray(w.files) && w.files.length)) throw new Error(`workstream ${w.id}: files must be a non-empty array`)
  w.repo = norm(w.repo)
  w.base ||= 'main'
  w.reviewModel ||= w.model === 'opus' ? 'fable' : 'opus' // one tier above the author
}
if (new Set(W.map(w => w.id)).size !== W.length) throw new Error('workstream ids must be unique')
if (new Set(W.map(w => w.repo + ' ' + w.branch)).size !== W.length) throw new Error('workstream branches must be unique per repo')
if (A.cycles != null && !(Number.isInteger(A.cycles) && A.cycles >= 1)) throw new Error('cycles must be a positive integer or null')
if (A.maxCycles != null && !(Number.isInteger(A.maxCycles) && A.maxCycles >= (A.cycles ?? 1))) throw new Error('maxCycles must be an integer >= cycles')
if (A.stage != null && A.stage !== 'wholeBranch') throw new Error('stage must be "wholeBranch" or omitted')
for (const k of ['tokenBudget', 'tokenReserve'])
  if (A[k] != null && !(Number.isInteger(A[k]) && A[k] >= 0)) throw new Error(`${k} must be a non-negative integer or null`)

// files[]: literal paths or dir prefixes (dir/ or dir/**). Two workstreams of one repo may not claim overlapping ones.
// shortcut: other glob patterns are compared literally; list concrete paths when two briefs share a directory.
const stem = f => f.replace(/\/\*\*$/, '/')
const overlaps = (a, b) => { const [x, y] = [stem(a), stem(b)]; return x === y || (x.endsWith('/') && y.startsWith(x)) || (y.endsWith('/') && x.startsWith(y)) }
for (const [i, a] of W.entries())
  for (const b of W.slice(i + 1))
    if (a.repo === b.repo && a.files && b.files) {
      const hit = a.files.find(f => b.files.some(g => overlaps(f, g)))
      if (hit) throw new Error(`workstreams ${a.id} and ${b.id} overlap on ${hit}`)
    }

const CYCLES = A.cycles ?? null
const CAP = A.maxCycles ?? (CYCLES ?? 2) + 2 // null -> 4; named N -> N+2 (extra cycles only while critical/major findings remain)
const WB_ROUNDS = 2 // whole-branch fix -> recheck rounds while critical/major findings remain
const STAGE = A.stage || 'full'
// Shared files no workstream commits: the merge applies each workstream's sharedEdits to them in order, and regenerates the generated ones.
const HOT = ['**/README*', '**/CHANGELOG*', 'docs/**', 'graphify-out/**', '**/package-lock.json', '**/yarn.lock', '**/pnpm-lock.yaml', '**/poetry.lock', '**/uv.lock', '**/Cargo.lock', '**/go.sum', '**/openapi*.yaml', '**/openapi*.yml', '**/openapi*.json', '**/*.sha256']
const CONF = {}
for (const c of A.repos || []) {
  if (!c.repo) throw new Error('repos items need {repo, knownRed?, hot?, regen?, smoke?}')
  for (const k of ['knownRed', 'hot']) if (c[k] != null && !Array.isArray(c[k])) throw new Error(`repos ${c.repo}: ${k} must be an array`)
  CONF[norm(c.repo)] = c
}
const conf = repo => ({ knownRed: [], hot: HOT, regen: '', smoke: '', ...CONF[repo] })
const repoMap = {}
for (const w of W) (repoMap[w.repo] ||= { repo: w.repo, featureBranch: w.featureBranch, base: w.base, conf: conf(w.repo), ws: [] }).ws.push(w)
const REPOS = Object.values(repoMap)
for (const r of REPOS)
  if (r.ws.some(w => w.featureBranch !== r.featureBranch || w.base !== r.base)) throw new Error(`${r.repo}: workstreams disagree on featureBranch/base`)
const DOCS = (A.docsRepos || REPOS).map(d => ({ repo: d.repo && norm(d.repo), featureBranch: d.featureBranch, base: d.base || repoMap[d.repo && norm(d.repo)]?.base || 'main', gate: d.gate || '' }))
for (const d of DOCS) if (!d.repo || !d.featureBranch) throw new Error('docsRepos items need {repo, featureBranch, base?, gate?}')
const name = repo => repo.split('/').pop()
const STALE = 'Read other repos ONLY via git -C <repo> fetch origin, then git -C <repo> show origin/<featureBranch>:<path> or git -C <repo> diff origin/<base>...origin/<featureBranch> — never by filesystem path: those checkouts sit on unrelated branches.'

// ---- token budget --------------------------------------------------------
// budget.spent() counts output tokens across the whole turn, so this run's own spend is measured from here.
// SPENT0 is not resume-stable; that only moves when the guard trips, never what a cached agent returned.
const SPENT0 = budget.spent()
const RESERVE = A.tokenReserve ?? 600_000
const left = () => Math.min(budget.remaining(), A.tokenBudget != null ? A.tokenBudget - (budget.spent() - SPENT0) : Infinity)
const stoppedBy = [] // what the reserve kept from starting, reported in the result
const short = what => { const s = left() < RESERVE; if (s) stoppedBy.push(what); return s } // no user target and no tokenBudget -> never short

// ---- shared prompt text --------------------------------------------------
// Workstreams never commit generated files, so whoever runs the gate on a workstream SHA regenerates them first.
const REGEN = regen => `Before running the gate or any test, run the repo's regen recipe in your worktree: ${regen}\nDiffs it produces are expected (generated files are rebuilt at merge): they are not findings and are never committed.`
const HARD = 'Hard rules: never ssh/rsync/deploy to a robot unit or any device; never touch Cloud Run, gcloud, prod data or prod endpoints; never gh run rerun or gh pr merge; never create or push a plan/spec doc (plannings/, docs/*plan*) unless that file already exists on the origin branch.'
const GIT = (repo, wt) => `Git rules (non-negotiable):
- Never touch the user's existing checkout of ${repo} (no checkout/switch/reset there). Work only in your own worktree at ${repo}/.claude/worktrees/${wt}: git -C ${repo} fetch origin and git -C ${repo} worktree prune first; if that path still exists, git worktree remove --force it; if the local branch already exists, add the worktree on it instead of creating it with -b.
- Commit in repo style with the repo's configured identity (the user). NO AI attribution anywhere: no Co-Authored-By trailer, no "Generated with" footer, no Claude/Anthropic/AI mention in messages, comments, docs or PR bodies, and no agent-tooling paths (.claude/) in committed text — say "a scratch worktree".
- Push with an explicit refspec (git push origin HEAD:refs/heads/<branch>, never --force) and verify with git ls-remote that the remote SHA equals your HEAD (detached-HEAD trap).
- Never open PRs, never touch main. Remove your worktree (git worktree remove --force) when done, including on failure.
${HARD}`
const RO = (repo, wt, regen = '') => `No commits, no pushes, no changes to any checkout but your own throwaway worktree at ${repo}/.claude/worktrees/${wt} (git worktree prune first; if that path still exists, git worktree remove --force it; remove it when done). Edits inside it — reverts, mutations, probes — are expected. Read every file at the SHA under review (git show <sha>:<path> or inside that worktree), never by path in ${repo}: that checkout sits on an unrelated branch.
${regen ? `${REGEN(regen)}\n` : ''}${HARD}`
const GREEN = knownRed => `${knownRed.length ? `Green = everything passes except exactly these known-red tests (recorded at the base): ${knownRed.join(', ')}. Any other failure is red; report any known-red that now passes.` : 'Green = every test passes.'} Never invent your own allowed failures.`
const GATE = (gate, knownRed) => `Full gate, green before every push — every suite the repo defines (unit, typecheck, build, Playwright/e2e where present), not just "test":\n${gate}\n${GREEN(knownRed)}\nRun gates in the foreground or with the harness's background-run. Never write pgrep -f wait loops (they match their own command line and never exit); if a wait is unavoidable, use wait $pid, kill -0 $pid, or a bracketed pattern like pgrep -f "[m]vnw".`
const FLAKY = 'A failure outside the known-red list: rerun that test alone twice and once at the base SHA. Intermittent, or red on base too -> FLAKY: a minor hygiene finding with the three outcomes. Deterministic on head and green on base -> a regression, and gate.green = false.'
// One regex for every no-AI-trace check, scoped to commits this run authored, never teammates'.
const AI_TRACE = 'co-authored-by|generated with|\\bclaude\\b|anthropic|\\.claude/'
const HYGIENE = range => `Hygiene: the commits git log --author="$(git config user.email)" ${range} lists (messages, trailers, added lines) and any PR body written for this branch must have zero matches for grep -iE '${AI_TRACE}' (real code identifiers such as an API-key env var name are not trace). A hit in a run-authored commit is critical (kind hygiene); if you are the agent pushing, do not push and return ok=false. Commits by other authors: report a hit once as a minor hygiene finding, never rewrite them.`
const TEST_GUARD = 'Test integrity: list pre-existing test files the range modified, deleted or renamed (git diff --diff-filter=MDR --name-only on test paths). A changed input or weakened assertion needs a reason from the brief or spec, else it is a major. Each of these is a critical unless the brief names it: a deleted or renamed pre-existing test; an added skip marker (skip|xfail|\\.only\\(|@Disabled|pytest.mark.skip|it.todo|describe.skip); an edit to test-runner config (jest/vitest/playwright/pytest config, pyproject [tool.pytest], conftest, coverage thresholds); a rewritten snapshot. For each changed assertion, mutate the production line it guards in your worktree and confirm the test goes red; one that stays green is a regression.'
const TRIAL = w => `Integration: in your worktree, trial-merge origin/${w.featureBranch} into the head (git merge --no-commit --no-ff, never committed or pushed) and run the gate there too. A failure or conflict the merge introduces is a regression of kind "integration" (critical or major by SEV), even when it surfaces in another workstream's files.`
const REFUTE = 'For each claim, try to REFUTE it; a claim you cannot prove with a command you ran stays open. Comments, docstrings and commit messages are claims, not evidence.'
const RO_TESTS = 'Pre-existing tests are read-only unless the brief names them. If a test or the gate contradicts the brief, or passing would need special-casing, return status blocked with a question — that is a valid outcome.'
const LADDER = 'Ladder-first (reuse > stdlib > native > one line > minimum code), no speculative code, stay strictly in scope.'
const SEV = 'Severity: critical = wrong behaviour, data loss, security, broken contract or red gate; major = real bug or design flaw; minor = the rest. Critical and major block the merge. Report only real issues; an empty list means clean.'
const DROP = 'Drop (do not downgrade): issues that predate the diff and are not made worse by it, anything the repo\'s linter/formatter catches, code the plan or brief explicitly allows, pure style with no correctness, safety or maintainability cost. A comment added in this diff is a claim to grill, never a reason to drop a finding; do not flag `shortcut:` comments themselves.'
const EVIDENCE = 'A critical or major of kind bug, regression or integration with evidence "none": reproduce it yourself. Reproduced: keep it blocking with your evidence. Not reproduced and not resolved: return it still open with the same id, demoted to minor. Design, question and overengineering kinds are exempt.'
const LENSES = grill => `Lenses:
1. Correctness: each finding names file:line plus the input or state that breaks it — bugs, edge cases, error handling, data loss, contract breaks, missing or weak tests.
   Test cheats are bugs: special-casing test inputs or expected values, always-true __eq__/comparison overloads, hidden state (call counters), test-environment detection.
${grill ? '2. Grilling: stress-test each design decision in the diff; raise one as kind "question" only when you can name the concrete failure you fear. The author must answer it defensibly or change it.\n' : ''}${grill ? 3 : 2}. Over-engineering: reinvented stdlib/helpers, speculative abstractions, dead flexibility, options nobody asked for — say what to DELETE (kind "overengineering").`
const asGlob = f => f.endsWith('/') ? f + '**' : f
const pathspec = (ps, magic = 'glob') => ps.map(p => `':(${magic})${asGlob(p)}'`).join(' ')
const SHARED = (c, files) => [
  files && `Edit only these paths: ${files.join(', ')}. Needing anything else is status "blocked" with a question.`,
  c.hot.length && `Shared files are never yours to commit: ${c.hot.join(', ')}. Regenerate generated ones locally if the gate needs it${c.regen ? ` (${c.regen})` : ''}, but leave them out of your commits. Return every change you need in a shared file as sharedEdits [{file, intent}] (for a generated file, the intent says what to regenerate); the merge applies it on the feature-branch tip.`,
].filter(Boolean).join('\n') || 'No shared-file restrictions in this repo.'

// ---- schemas -------------------------------------------------------------
const FINDING = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    severity: { enum: ['critical', 'major', 'minor'] },
    kind: { enum: ['bug', 'design', 'overengineering', 'question', 'regression', 'integration', 'hygiene', 'docs'] },
    where: { type: 'string', description: 'file:line or area' },
    issue: { type: 'string', description: 'one or two sentences' },
    evidence: { type: 'string', description: 'test id, command + output, or trace that proves it; "none" if you have none' },
  },
  required: ['id', 'severity', 'kind', 'where', 'issue', 'evidence'],
}
const HEAD = { type: 'string', description: 'full SHA of the commit you actually reviewed/validated (git rev-parse after fetch)' }
const GATE_OUT = {
  type: 'object',
  properties: { green: { type: 'boolean', description: 'false on any failure that is neither known-red nor proven flaky' }, summary: { type: 'string' } },
  required: ['green', 'summary'],
}
const FINDINGS = { type: 'object', properties: { headSha: HEAD, findings: { type: 'array', items: FINDING } }, required: ['headSha', 'findings'] }
const QUESTION = {
  type: 'object',
  properties: { q: { type: 'string' }, options: { type: 'array', items: { type: 'string' } }, default: { type: 'string' } },
  required: ['q', 'options', 'default'],
}
const PUSHED = {
  type: 'object',
  properties: {
    status: { enum: ['done', 'blocked', 'needs_context', 'failed'] },
    ok: { type: 'boolean', description: 'gate green AND pushed AND ls-remote verified' },
    sha: { type: 'string', description: 'remote SHA verified via git ls-remote' },
    tests: { type: 'string', description: 'one line: suites run and pass/fail counts' },
    gateTail: { type: 'string', description: 'last 8 lines of the gate output including the exit code, verbatim' },
    sharedEdits: {
      type: 'array',
      description: 'changes needed in shared files you may not commit',
      items: { type: 'object', properties: { file: { type: 'string' }, intent: { type: 'string' } }, required: ['file', 'intent'] },
    },
    decisions: {
      type: 'array',
      maxItems: 10,
      description: 'design decisions you would defend in review',
      items: { type: 'object', properties: { what: { type: 'string' }, why: { type: 'string' } }, required: ['what', 'why'] },
    },
    questions: { type: 'array', items: QUESTION, description: 'only what the user must decide: code, spec and brief cannot settle it' },
    notes: { type: 'array', items: { type: 'string' }, description: 'deviations from the brief, anything not run' },
  },
  required: ['status', 'ok', 'sha', 'tests', 'gateTail', 'sharedEdits', 'decisions', 'questions', 'notes'],
}
const FIXED = {
  type: 'object',
  properties: {
    ...PUSHED.properties,
    ok: { type: 'boolean', description: 'gate green AND pushed AND ls-remote verified; nothing to change: gate green, no push' },
    answers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          action: { enum: ['fixed', 'answered', 'declined', 'escalated'] },
          note: { type: 'string', description: 'what changed (name the red-verified test) or why not' },
        },
        required: ['id', 'action', 'note'],
      },
    },
  },
  required: [...PUSHED.required, 'answers'],
}
const DELTA = {
  type: 'object',
  properties: {
    headSha: HEAD,
    gate: GATE_OUT,
    verified: { type: 'array', items: { type: 'string' }, description: 'finding ids confirmed resolved, or whose answer or decline you accept' },
    open: { type: 'array', items: FINDING, description: 'unresolved findings, indefensible answers, and new regressions' },
  },
  required: ['headSha', 'gate', 'verified', 'open'],
}
const VERDICT = {
  type: 'object',
  properties: {
    verdict: { enum: ['pass', 'fail'] },
    sections: { type: 'string', description: 'one short line per section' },
    sha: HEAD,
    tests: { type: 'string' },
    gate: GATE_OUT,
    findings: { type: 'array', items: FINDING },
  },
  required: ['verdict', 'sections', 'sha', 'tests', 'gate', 'findings'],
}
const RECHECK = { ...VERDICT, properties: { ...VERDICT.properties, verified: { type: 'array', items: { type: 'string' }, description: 'finding ids confirmed resolved, or whose answer or decline you accept' } }, required: [...VERDICT.required, 'verified'] }
const CONTRACT = {
  type: 'object',
  properties: { verdict: { enum: ['pass', 'fail'] }, sections: { type: 'string', description: 'one short line per section' }, findings: { type: 'array', items: FINDING } },
  required: ['verdict', 'sections', 'findings'],
}
const DOCS_OUT = {
  type: 'object',
  properties: {
    baseSha: { type: 'string', description: 'origin feature-branch SHA you started from' },
    sha: { type: 'string', description: 'pushed SHA, or empty if nothing was stale and the graph was unchanged' },
    files: { type: 'array', items: { type: 'string' } },
    prBody: { type: 'boolean', description: 'true if an existing PR body was updated' },
    ok: { type: 'boolean', description: 'gate green (or no gate) and, if pushed, ls-remote verified' },
    tests: { type: 'string' },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['baseSha', 'sha', 'files', 'prBody', 'ok', 'tests', 'notes'],
}

// ---- helpers -------------------------------------------------------------
const lock = {}
// Run-wide record of the workstreams merged into each repo's feature branch, in merge order; written only inside serialized().
// shortcut: prompts that list it depend on merge timing, so a resume may run those agents live instead of from cache.
const mergedInto = {}
const owners = ws => ws.map(x => `${x.id}${x.files ? ` (${x.files.join(', ')})` : ' (no files[] declared)'}`).join('; ')
const serialized = (repo, fn) => (lock[repo] = (lock[repo] || Promise.resolve()).then(fn, fn)) // workstreams of one repo merge one at a time
const blocking = f => f.severity !== 'minor'
// SHA checks compare what two different agents reported. The script can't run git, so this catches
// inconsistency between agents (a moved tip, a stale read), not one agent lying about both sides.
const same = (a = '', b = '') => a.length >= 7 && b.length >= 7 && (a.startsWith(b) || b.startsWith(a))
// gate.green is the typed channel: a red gate is critical without relying on the model to file it.
const redGate = (r, id) => r.gate.green ? [] : [{ id, severity: 'critical', kind: 'regression', where: 'gate', issue: r.gate.summary, evidence: 'the validator\'s gate run' }]
// A dead agent is replaced by a fresh one of the same role that redoes the whole step, up to 2 replacements.
// The attempt number changes the prompt, so a resume can never hand back the dead attempt's cached result.
async function step(prompt, opts) {
  for (let n = 1; n <= 3; n++) {
    const r = await agent(n === 1 ? prompt : `${prompt}\n\nAttempt ${n}: the previous agent died mid-step. Redo the whole step; first check the remote for anything it already pushed.`,
      n === 1 ? opts : { ...opts, label: `${opts.label} attempt ${n}` })
    if (r) return r
    log(`${opts.label}: agent died (attempt ${n} of 3)`)
  }
  return null
}

// ---- one workstream: implement -> cycles -> merge --------------------------
async function runWorkstream(w) {
  const tag = w.id
  const c = repoMap[w.repo].conf
  const out = { id: w.id, branch: w.branch, status: '', sha: '', validatedSha: '', cyclesRun: 0, extended: false, findingsFixed: 0, open: [], sharedEdits: [], questions: [], notes: [], escalations: [], tests: '', gateTail: '', merged: false }
  const decisions = [] // the author's reasoning, handed to every later reviewer and fixer
  const ledger = [] // settled findings: never re-raised unless the code under them changed
  const absorb = r => {
    out.sharedEdits = r.sharedEdits // each author returns the complete current list
    out.questions.push(...r.questions)
    out.notes.push(...r.notes)
    decisions.push(...r.decisions)
    Object.assign(out, { status: r.status, tests: r.tests, gateTail: r.gateTail })
  }
  const stop = why => {
    out.escalations.push(`${why}; NOT merged`)
    log(`${tag}: NOT merged after ${out.cyclesRun} cycle(s): ${why}`)
    return out
  }
  // A seam blocker in a merged workstream's files is this author's to fix; files of workstreams not merged yet never are.
  const integration = () => {
    const done = mergedInto[w.repo] || []
    const pending = W.filter(x => x.repo === w.repo && x !== w && !done.includes(x))
    return done.length
      ? `Integration fix: if a critical or major can only be fixed in files owned by workstreams already merged into ${w.featureBranch} — ${owners(done)} — first git merge origin/${w.featureBranch} into your branch, then fix those files too (the one exception to your file list; say so in notes).${pending.length ? ` Never touch files owned by workstreams not merged yet: ${owners(pending)}.` : ''}`
      : `No workstream has merged into ${w.featureBranch} yet; a blocker outside your files is status "blocked" with a question.`
  }
  const reasons = () => decisions.length ? `\nThe author's recorded decisions — form your findings from the diff and brief first, then read these; don't grill one whose why is sound:\n${JSON.stringify(decisions)}\n` : ''

  const impl = await step(
    `You are the author of workstream ${w.id} in ${w.repo}.
Set up: worktree ${w.id} on a new branch ${w.branch} from origin/${w.featureBranch}. If origin/${w.branch} already exists from an earlier attempt and is not yet merged into origin/${w.featureBranch}, continue from it instead; if it is already merged, stop with status "blocked" and say so in notes.

Brief:
${w.brief}

${LADDER} Test-first where behaviour changes.
${RO_TESTS}
${SHARED(c, w.files)}
${GATE(w.gate, c.knownRed)}
${GIT(w.repo, w.id)}
Commit and push to ${w.branch}. Return status ("done" only when the gate is green and the push verified), ok, the verified remote sha, a one-line test summary, gateTail, sharedEdits, decisions (up to 10), questions and notes.`,
    { label: `${tag} implement`, phase: 'Implement', agentType: 'implementer', model: w.model, schema: PUSHED })
  if (!impl) return stop('implement agent died 3 times')
  absorb(impl)
  if (!impl.ok || impl.status !== 'done') return stop(`implement ${impl.status}: ${impl.tests}`)
  out.sha = impl.sha

  let carry = [] // open findings handed to the next review
  for (let i = 1; i <= CAP; i++) {
    if (short(`${tag} cycle ${i}`)) return stop(`token budget below the ${RESERVE} reserve before cycle ${i}`)
    const rev = await step(
      `Review workstream ${w.id}: git -C ${w.repo} fetch origin, then the diff origin/${w.featureBranch}...${out.sha} (branch ${w.branch}).
${RO(w.repo, `${w.id}-rev${i}`, c.regen)}

The brief it implements:
${w.brief}
${reasons()}
${LENSES(i === 1)}
${DROP}
${ledger.length ? `Settled in earlier cycles — do not re-raise unless the code under it changed:\n${JSON.stringify(ledger)}\n` : ''}${carry.length ? `The last validation left these open — re-check each, keep the ones still valid (same id):\n${JSON.stringify(carry)}\n` : ''}${SEV}
New finding ids: c${i}-F1, c${i}-F2, ...`,
      { label: `${tag} review c${i}`, phase: 'Review cycles', agentType: 'reviewer', model: w.reviewModel, schema: FINDINGS })
    if (!rev) return stop(`review c${i} died 3 times`)
    if (!same(rev.headSha, out.sha)) return stop(`review c${i} saw ${rev.headSha}, the author pushed ${out.sha}`)
    out.cyclesRun = i
    // Clean needs both: nothing blocking in this review AND nothing blocking left by the last validation.
    // Only a validator can clear a carried critical/major; a reviewer that drops one doesn't.
    let found = [...rev.findings, ...carry.filter(f => blocking(f) && !rev.findings.some(g => g.id === f.id))]

    if (!found.some(blocking)) {
      if (same(out.validatedSha, out.sha)) { carry = found; break } // converged on a validated head; minors carried, not cycled
      // A clean review is a claim: a head no validator has seen gets one independent pass before it can merge.
      const val = await step(
        `Independently validate workstream ${w.id} in ${w.repo} before it merges: git fetch, then origin/${w.featureBranch}...${out.sha}. The review came back clean, but no validator has seen this head.
The brief:
${w.brief}

1. Check every acceptance criterion of the brief against the code and a command you ran. ${REFUTE}
2. Prove the new tests: revert the production hunks in your worktree, they must go red; restore them, green. ${TEST_GUARD}
3. Run the gate and report gate {green, summary}:
${w.gate}
${GREEN(c.knownRed)} ${FLAKY}
4. ${TRIAL(w)}
${RO(w.repo, `${w.id}-val${i}`, c.regen)}
${SEV}
Return headSha, gate, verified (empty) and open (ids v${i}-F1, ...).`,
        { label: `${tag} validate c${i}`, phase: 'Review cycles', agentType: 'validator', model: 'opus', effort: 'high', schema: DELTA })
      if (!val) return stop(`validate c${i} died 3 times`)
      if (!same(val.headSha, out.sha)) return stop(`validate c${i} saw ${val.headSha}, the head is ${out.sha}`)
      found = [...found, ...val.open, ...redGate(val, `v${i}-G`)]
      out.validatedSha = out.sha
      if (!found.some(blocking)) { carry = found; break }
      // the validator's blockers go straight to this cycle's fix: re-reviewing the unchanged SHA wastes the cycle
    }
    {
      const prev = out.sha
      const fix = await step(
        `You are the author of workstream ${w.id} (${w.repo}, branch ${w.branch}). Review cycle ${i} findings:
${JSON.stringify(found)}
${decisions.length ? `Your earlier reasoning:\n${JSON.stringify(decisions)}\n` : ''}
Set up: worktree ${w.id}-fix${i}, detached at origin/${w.branch} (expected ${prev}; if it moved, an earlier attempt of this step pushed it: continue from it); push back to ${w.branch}.
Critical and major: fix bugs with a test you ran RED before the fix and green after; answer every kind "question" with a defensible reason or a change; delete what the over-engineering findings say to delete.
${RO_TESTS}
Minor: fix only if it is a one-liner inside your files, otherwise decline with a reason — declining is a valid outcome.
Keep fixes minimal and inside this workstream's files.
Nothing to change (all answered or declined): no commit, no push, sha = ${prev}, ok = true.
${SHARED(c, w.files)}
${integration()}
sharedEdits: return the complete current list; it replaces the earlier one${out.sharedEdits.length ? `, so keep every entry still needed from:\n${JSON.stringify(out.sharedEdits)}` : ''}.
${GATE(w.gate, c.knownRed)}
${GIT(w.repo, `${w.id}-fix${i}`)}
Return status, ok, verified sha, tests, gateTail, one answer per finding id, sharedEdits, decisions (new or changed only), questions (only what code, spec and brief cannot settle; use action "escalated") and notes.`,
        { label: `${tag} fix c${i}`, phase: 'Review cycles', agentType: 'implementer', model: w.model, schema: FIXED })
      if (!fix) return stop(`fix c${i} died 3 times`)
      absorb(fix)
      if (!fix.ok || fix.status !== 'done') return stop(`fix c${i} ${fix.status}: ${fix.tests}`)
      out.sha = fix.sha

      const val = await step(
        `Independently validate the review-fix delta of workstream ${w.id} in ${w.repo}: git fetch, then ${prev}..${fix.sha} on ${w.branch}. Trust nothing the author claims.
${same(prev, fix.sha) ? 'No delta: judge the answers and declines only, and run the gate at this head.\n' : ''}If the fixer merged origin/${w.featureBranch} (an integration fix), skip the merged-in side: judge git diff origin/${w.featureBranch}...${fix.sha}, and don't re-hunt sibling code already validated.
Findings with the author's claimed resolutions — judge the code first, then read each claim:
${JSON.stringify(found.map(f => ({ ...f, claim: fix.answers.find(a => a.id === f.id) || 'no answer' })))}

1. ${REFUTE} Where a test is claimed, it must fail at ${prev}, the pre-fix head: run it there in a second worktree at ${w.repo}/.claude/worktrees/${w.id}-val${i}-red (never mktemp), and green at ${fix.sha}. Reverting the fix hunks in your worktree is the fallback only when that cannot run; state the fallback in evidence. Judge each answer to a question and each declined minor: defensible or not. ${EVIDENCE}
2. Hunt regressions the fixes introduced (they routinely plant new bugs: data loss, broken callers, weakened tests). ${TEST_GUARD}
3. Run the gate and report gate {green, summary}:
${w.gate}
${GREEN(c.knownRed)} ${FLAKY}
4. ${TRIAL(w)}
${RO(w.repo, `${w.id}-val${i}`, c.regen)}
${SEV}
Return headSha, gate, verified (ids confirmed resolved, or whose answer or decline you accept) and open (unresolved, indefensible, plus regressions as kind "regression" with ids v${i}-R1, ...).`,
        { label: `${tag} validate c${i}`, phase: 'Review cycles', agentType: 'validator', model: 'opus', effort: 'high', schema: DELTA })
      if (!val) return stop(`validate c${i} died 3 times`)
      if (!same(val.headSha, fix.sha)) return stop(`validate c${i} saw ${val.headSha}, the fix pushed ${fix.sha}`)
      out.findingsFixed += val.verified.length
      for (const f of found)
        if (val.verified.includes(f.id)) ledger.push({ id: f.id, where: f.where, issue: f.issue, status: fix.answers.find(a => a.id === f.id)?.action || 'fixed' })
      // a blocker the validator neither verified nor re-opened stays open: silence is not a resolution
      carry = [...val.open, ...redGate(val, `v${i}-G`), ...found.filter(f => blocking(f) && !val.verified.includes(f.id) && !val.open.some(o => o.id === f.id))]
      out.validatedSha = fix.sha
    }

    const open = carry.some(blocking)
    if (CYCLES != null && i >= CYCLES && !open) break // named count reached and nothing critical or major left
    if (CYCLES != null && i >= CYCLES) out.extended = true // floor, not permission to merge dirty work
  }
  out.open = carry
  if (carry.some(blocking)) return stop(`critical/major findings still open after ${out.cyclesRun} cycle(s) (cap ${CAP})`)
  if (!same(out.validatedSha, out.sha)) return stop('the head was never validated')

  const merge = await serialized(w.repo, async () => {
    const done = (mergedInto[w.repo] ||= [])
    // allowed = own files plus those of workstreams already merged (integration fixes); empty hot list or no files[] = no check
    const allowed = w.files && [...w.files, ...done.flatMap(x => x.files || [])]
    const diff = `git diff --name-only origin/${w.featureBranch}...${out.validatedSha} --`
    const backstop = [c.hot.length && `${diff} ${pathspec(c.hot)}`, allowed && `${diff} . ${pathspec(allowed, 'glob,exclude')}`].filter(Boolean)
    const m = await step(
      `Merge workstream ${w.id} into feature branch ${w.featureBranch} in ${w.repo}, then apply its shared-file edits.
Set up: worktree merge-${w.id}, detached at origin/${w.featureBranch} (fetch first).
1. git ls-remote origin refs/heads/${w.branch} must equal ${out.validatedSha}, the validated head; otherwise ok=false, status "failed".
2. ${backstop.length ? `Backstop: ${backstop.join(' and ')} must each print nothing. Otherwise ok=false, status "failed", the offending paths in notes.` : 'No backstop paths for this repo.'}
3. git merge --no-ff ${out.validatedSha} -m "Merge ${w.branch} into ${w.featureBranch}". On conflict: git merge --abort, remove the worktree, ok=false, status "failed", the conflicting files in notes.
4. ${out.sharedEdits.length ? `Apply these shared-file edits on top of the merge, keeping what earlier merges put in those files (a generated file is regenerated with the repo's own tooling, never hand-merged); one commit "Update shared files for ${w.id}":\n${JSON.stringify(out.sharedEdits)}` : 'No shared-file edits.'}
5. ${c.regen ? `Regenerate generated files: ${c.regen}\nCommit any change as "Regenerate generated files".` : 'No regen recipe for this repo.'}
${GATE(w.gate, c.knownRed)}
Red gate: do not push, return ok=false with the failure.
${HYGIENE(`origin/${w.featureBranch}..HEAD`)}
${GIT(w.repo, `merge-${w.id}`)}
Push to ${w.featureBranch} (plain push; if rejected, fetch and redo every step on the new tip). Return status, ok, verified sha, tests, gateTail and notes; sharedEdits, decisions and questions empty.`,
      { label: `${tag} merge`, phase: 'Merge', model: 'sonnet', effort: out.sharedEdits.length ? 'medium' : 'low', schema: PUSHED })
    if (m?.ok && m.status === 'done') done.push(w)
    return m
  })
  if (!merge) return stop('merge agent died 3 times')
  out.notes.push(...merge.notes)
  out.merged = merge.ok && merge.status === 'done'
  if (!out.merged) return stop(`merge failed: ${merge.notes.join('; ') || merge.tests}`)
  log(`${tag}: merged after ${out.cyclesRun} cycle(s)${out.extended ? ' (extended)' : ''}, ${out.open.length} minor(s) carried`)
  return out
}

// ---- one repo: integrated review + independent validator, up to WB_ROUNDS fix rounds ----
async function runRepo(r, mine) {
  const n = name(r.repo)
  const c = r.conf
  const gates = [...new Set(r.ws.map(w => w.gate))].join('\n')
  const briefs = r.ws.map(w => `## ${w.id}\n${w.brief}`).join('\n\n')
  const range = `origin/${r.base}...origin/${r.featureBranch}`
  const top = ms => MODELS[Math.max(...ms.map(m => MODELS.indexOf(m)))]
  const res = { repo: r.repo, featureBranch: r.featureBranch, sha: '', verdict: 'skipped', sections: 'no workstream merged', tests: '', fixRounds: 0, open: [], questions: [], notes: [], escalations: [] }
  if (!mine.some(w => w.merged)) return res
  let findings = []
  const fail = why => { Object.assign(res, { verdict: 'fail', open: findings }); res.escalations.push(why); return res }

  const [rev, val] = await parallel([
    () => step(
      `Integrated review of ${r.repo}: git fetch, then the whole feature-branch diff ${range}. All workstreams are merged; hunt the cross-workstream seams the per-workstream reviews could not see.
${RO(r.repo, 'wb-rev')}

Briefs:
${briefs}

${LENSES(false)}
${DROP}
${SEV}
headSha = the origin/${r.featureBranch} commit you reviewed. Ids: W-F1, W-F2, ...`,
      { label: `${n} review`, phase: 'Whole-branch', agentType: 'reviewer', model: top(r.ws.map(w => w.reviewModel)), schema: FINDINGS }),
    () => step(
      `Independent whole-branch validation of ${r.repo}, feature branch ${r.featureBranch} vs origin/${r.base}. Trust nothing; re-derive everything yourself. ${REFUTE}
${RO(r.repo, 'wb-val')}
Sections (verdict per section):
1. ${HYGIENE(`origin/${r.base}..origin/${r.featureBranch}`)}
2. Tests from scratch, every suite including Playwright/e2e; report gate {green, summary}:
${gates}
${GREEN(c.knownRed)} ${FLAKY}
3. Spec compliance point by point against the briefs below. ${TEST_GUARD}
4. Concurrency / writer audit where relevant.
5. ${c.smoke ? `Live smoke, exactly this local recipe, proving the core invariants:\n${c.smoke}` : 'Live smoke: "skipped: no smoke recipe" (do not improvise a boot).'}
Cross-repo wire contracts are checked separately once every repo is final.

Briefs:
${briefs}

${SEV}
sha = the origin/${r.featureBranch} commit you validated. Ids: V-F1, V-F2, ...`,
      { label: `${n} validate`, phase: 'Whole-branch', agentType: 'validator', model: 'opus', effort: 'high', schema: VERDICT }),
  ])
  if (!rev || !val) return fail(`${!rev ? 'integrated review' : 'whole-branch validator'} died 3 times`)
  if (!same(rev.headSha, val.sha)) return fail(`review saw ${rev.headSha}, validator saw ${val.sha}`)
  Object.assign(res, { sha: val.sha, verdict: val.verdict, sections: val.sections, tests: val.tests })
  // minors carried from the merged workstreams' cycles ride along (declinable); ids prefixed so two workstreams' c1-F1 stay apart
  findings = [...rev.findings, ...val.findings, ...redGate(val, 'V-G'), ...mine.filter(w => w.merged).flatMap(w => w.open.map(f => ({ ...f, id: `${w.id}:${f.id}` })))]

  for (let round = 1; round <= WB_ROUNDS && findings.some(blocking); round++) {
    if (short(`${n} whole-branch fix round ${round}`)) return fail(`token budget below the ${RESERVE} reserve before whole-branch fix round ${round}`)
    res.fixRounds = round
    const head = res.sha
    const fix = await step(
      `Whole-branch fix round ${round} on ${r.repo}, feature branch ${r.featureBranch}. Findings:
${JSON.stringify(findings)}

Set up: worktree wb-fix${round}, detached at origin/${r.featureBranch} (expected ${head}; if it moved, an earlier attempt of this step pushed it: continue from it); push back to ${r.featureBranch}.
Critical and major: resolve every one (red-verified tests for bug fixes; defensible answers to questions; delete what over-engineering findings name). Minor, including those carried from the workstream cycles: fix only if it is a one-liner, otherwise decline with a reason. Minimal fixes.
Nothing to change (all answered or declined): no commit, no push, sha = ${head}, ok = true.
Never merge a workstream branch: an unmerged workstream is the coordinator's call. If you change the source of a generated file, ${c.regen ? `rerun: ${c.regen}` : 'regenerate it with the repo\'s own script'}.
${LADDER}
${GATE(gates, c.knownRed)}
${GIT(r.repo, `wb-fix${round}`)}
Return status, ok, verified sha, tests, gateTail, one answer per finding id, questions and notes; sharedEdits and decisions empty.`,
      { label: `${n} fix r${round}`, phase: 'Whole-branch', agentType: 'implementer', model: top(r.ws.map(w => w.model)), schema: FIXED })
    if (!fix) return fail(`whole-branch fix r${round} died 3 times`)
    res.questions.push(...fix.questions)
    res.notes.push(...fix.notes)
    if (!fix.ok || fix.status !== 'done') return fail(`whole-branch fix r${round} ${fix.status}: ${fix.tests}`)

    const re = await step(
      `Re-check whole-branch fix round ${round} on ${r.repo}, feature branch ${r.featureBranch}: git fetch, then the delta ${head}..${fix.sha}. Trust nothing the author claims.
${same(head, fix.sha) ? 'No delta: judge the answers and declines only, and run the gate at this head.\n' : ''}Findings with claimed resolutions — judge the code first, then read each claim:
${JSON.stringify(findings.map(f => ({ ...f, claim: fix.answers.find(a => a.id === f.id) || 'no answer' })))}
1. ${REFUTE} A claimed test must fail at ${head}, the pre-fix head: run it there in a second worktree at ${r.repo}/.claude/worktrees/wb-recheck${round}-red (never mktemp), and green at ${fix.sha}. Reverting the fix hunks is the fallback only when that cannot run; state the fallback in evidence. Judge each answer and each declined minor. ${EVIDENCE}
2. Hunt regressions the fixes introduced. ${TEST_GUARD}
3. Rerun every suite and report gate {green, summary}:
${gates}
${GREEN(c.knownRed)} ${FLAKY}
4. ${HYGIENE(`${head}..${fix.sha}`)}
${RO(r.repo, `wb-recheck${round}`)}
${SEV}
sha = the commit you checked. verdict pass only if nothing critical or major is open; verified = finding ids confirmed resolved, or whose answer or decline you accept; findings = everything still open (same id for a carried finding, new ids R${round}-F1, ...).`,
      { label: `${n} recheck r${round}`, phase: 'Whole-branch', agentType: 'validator', model: 'opus', effort: 'high', schema: RECHECK })
    if (!re) return fail(`recheck r${round} died 3 times`)
    if (!same(re.sha, fix.sha)) return fail(`recheck r${round} saw ${re.sha}, the fix pushed ${fix.sha}`)
    Object.assign(res, { verdict: re.verdict, sections: re.sections, sha: re.sha, tests: re.tests })
    findings = [...re.findings, ...redGate(re, `R${round}-G`), ...findings.filter(f => blocking(f) && !re.verified.includes(f.id) && !re.findings.some(o => o.id === f.id))]
  }
  res.open = findings
  if (findings.some(blocking)) return fail(`critical/major findings still open after ${res.fixRounds} whole-branch fix round(s)`)
  return res
}

// ---- wiring ---------------------------------------------------------------
log(`${STAGE === 'wholeBranch' ? 'whole-branch re-validation' : `${W.length} workstream(s)`} across ${REPOS.length} repo(s); cycles=${CYCLES ?? 'converge'} (hard cap ${CAP})`)
const wsPromises = STAGE === 'wholeBranch'
  ? W.map(w => Promise.resolve({ id: w.id, merged: true, open: [] })) // already merged by an earlier run
  : W.map(w => runWorkstream(w).catch(e => ({ id: w.id, branch: w.branch, merged: false, open: [], questions: [], notes: [], escalations: [`crashed: ${e}`] })))
// Each repo's whole-branch pass starts as soon as ITS workstreams finish (no global barrier).
const repoResults = await parallel(REPOS.map(r => async () => {
  const mine = await Promise.all(wsPromises.filter((_, i) => W[i].repo === r.repo))
  return runRepo(r, mine).catch(e => ({ repo: r.repo, featureBranch: r.featureBranch, sha: '', verdict: 'fail', sections: 'crashed', tests: '', fixRounds: 0, open: [], questions: [], notes: [], escalations: [`crashed: ${e}`] }))
}))
const wsResults = await Promise.all(wsPromises)

// Barrier: the contract check and docs need every repo final.
const skipped = new Set(repoResults.filter(r => r.verdict === 'skipped').map(r => r.repo))
const shipped = skipped.size < REPOS.length
const PINS = repoResults.map(r => `${r.repo} @ ${r.featureBranch} = ${r.sha || `origin/${repoMap[r.repo].base} (nothing merged)`}`).join('\n') + '\n' + STALE
const [crossRepo, docs] = await parallel([
  async () => REPOS.length < 2 || !shipped ? null : short('contracts') ? { verdict: 'fail', sections: 'skipped: token budget below the reserve', findings: [] } : step(
    `Cross-repo wire-contract check, run once every repo is final. Pinned heads:
${PINS}
${RO('<repo>', 'contracts')}
Sections (verdict per section):
1. Every wire contract between these repos — HTTP/API payloads, events, shared schemas, vendored OpenAPI and its digest, env/config keys — field by field at the pinned SHAs: names, types, optionality, defaults, enum values, error shapes.
2. The merge order the contracts require (which repo's contract must land first) and every re-vendor or digest step still missing.
${SEV}
Ids: X-F1, X-F2, ...`,
    { label: 'contracts', phase: 'Contracts', agentType: 'validator', model: 'opus', effort: 'high', schema: CONTRACT })
    .then(x => x || { verdict: 'fail', sections: 'contract validator died 3 times', findings: [] }),
  () => parallel(DOCS.map(d => async () => {
    if (!shipped || skipped.has(d.repo)) return null
    if (short(`${name(d.repo)} docs`)) return { sha: '', files: [], prBody: false, ok: false, tests: '', notes: ['skipped: token budget below the reserve'] }
    const rr = repoMap[d.repo]
    const gate = rr ? [...new Set(rr.ws.map(w => w.gate))].join('\n') : d.gate
    const knownRed = conf(d.repo).knownRed
    const o = await step(
      `Docs sync for ${d.repo}, branch ${d.featureBranch}. Docs must describe what SHIPPED, not what the author first wrote.
This repo's branch: ${d.featureBranch} vs origin/${d.base}. Read the whole diff of every feature branch below vs its base, INCLUDING every review-round fix:
${PINS}
Set up: worktree docs-sync, detached at origin/${d.featureBranch}; push back to ${d.featureBranch}.
1. Update in ${d.repo}: README / docs / runbooks (new or changed env vars with prod-required secrets first, endpoints, contract fields, defaults flipped in review, deleted scaffolding, behaviour changed for existing clients); design/spec docs if this repo holds them (rows whose box, trigger or status moved).
2. If a PR already exists for ${d.featureBranch} (gh pr view), update its body (placement table, test plan, claims the fixes made false) with gh pr edit — never create a PR.
3. Knowledge graph, if graphify-out/ exists: graphify update . (add --force if the branch deleted files; never --update or semantic mode); reset line 1 of graphify-out/GRAPH_REPORT.md to the repo name (never a worktree name); drop manifest changes that are mtime-only; commit only graph.json, GRAPH_REPORT.md, manifest.json and .graphify_labels.json as "Refresh the knowledge graph". No graphify-out/: skip.
4. ${gate ? `${GATE(gate, knownRed)}\nRun it after the graph refresh. Red gate: do not push, ok=false.` : 'No gate for this repo.'}
5. Before pushing: ${HYGIENE(`origin/${d.featureBranch}..HEAD`)}
Nothing stale and the graph unchanged: no commit, empty sha, ok=true.
${GIT(d.repo, 'docs-sync')}`,
      { label: `${name(d.repo)} docs`, phase: 'Docs sync', model: 'sonnet', schema: DOCS_OUT })
    if (!o || !o.sha) return o
    // The docs commit becomes the repo's finalSha, so it gets its own read-only validator.
    const v = await step(
      `Validate the docs-sync commits on ${d.repo}, branch ${d.featureBranch}: git fetch, then ${o.baseSha}..${o.sha}. They land after every other check and become the branch head. ${REFUTE}
Sections (verdict per section):
1. Every changed doc line against the code it describes, at these pinned heads:
${PINS}
2. Knowledge graph, if touched: GRAPH_REPORT.md line 1 is the repo name; only the four graphify files are committed.
3. ${HYGIENE(`${o.baseSha}..${o.sha}`)}
4. ${gate ? `Run the gate and report gate {green, summary}:\n${gate}\n${GREEN(knownRed)} ${FLAKY}` : 'No gate: gate.green true, summary "no gate".'}
${RO(d.repo, 'docs-val')}
${SEV}
sha = the commit you validated. Ids: D-F1, D-F2, ...`,
      { label: `${name(d.repo)} docs validate`, phase: 'Docs sync', agentType: 'validator', model: 'opus', effort: 'high', schema: VERDICT })
    const vOk = v && same(v.sha, o.sha)
    return { ...o, verdict: vOk ? v.verdict : 'fail', findings: vOk ? [...v.findings, ...redGate(v, 'D-G')] : [{ id: 'D-X', severity: 'critical', kind: 'docs', where: o.sha, issue: v ? `docs validator saw ${v.sha}, docs pushed ${o.sha}` : 'docs validator died 3 times' }] }
  })),
])

const brief = f => `${f.severity} ${f.where}: ${f.issue}`
const uniq = xs => [...new Set(xs)]
const uniqQ = qs => qs.filter((q, i) => qs.findIndex(x => x.q === q.q) === i)
const docsOf = repo => {
  const j = DOCS.findIndex(d => d.repo === repo)
  if (j < 0 || !shipped || skipped.has(repo)) return null
  const d = docs?.[j]
  return d ? { sha: d.sha, files: d.files, prBody: d.prBody, ok: d.ok, tests: d.tests, notes: d.notes, verdict: d.verdict || (d.sha ? 'fail' : 'n/a'), findings: d.findings || [] } : { sha: '', files: [], prBody: false, ok: false, tests: '', notes: ['docs agent died 3 times'], verdict: 'fail', findings: [] }
}
const docsOut = d => d && { ...d, findings: d.findings.map(brief) }
return {
  stage: STAGE,
  budget: { spent: budget.spent() - SPENT0, tokenBudget: A.tokenBudget ?? null, turnTotal: budget.total, reserve: RESERVE, stoppedBy },
  cycles: CYCLES,
  maxCycles: CAP,
  workstreams: STAGE === 'wholeBranch' ? [] : wsResults.map(w => ({ ...w, open: w.open.map(brief), questions: uniqQ(w.questions), notes: uniq(w.notes) })),
  repos: repoResults.map(r => {
    const d = docsOf(r.repo)
    // the docs commit is the head, so a failed docs validation fails the repo; so does a docs agent that died 3 times
    const docsFailed = d && (d.sha ? d.verdict !== 'pass' : d.verdict === 'fail')
    return { ...r, verdict: docsFailed ? 'fail' : r.verdict, escalations: [...r.escalations, ...(docsFailed && !d.sha ? ['docs agent died 3 times; docs not synced'] : [])], open: [...r.open, ...(d?.findings || [])].map(brief), questions: uniqQ(r.questions), notes: uniq(r.notes), docs: docsOut(d), finalSha: d?.sha || r.sha }
  }),
  crossRepo: crossRepo && { ...crossRepo, findings: crossRepo.findings.map(brief) },
  otherDocs: DOCS.filter(d => !repoMap[d.repo]).map(d => ({ repo: d.repo, featureBranch: d.featureBranch, docs: docsOut(docsOf(d.repo)) })),
}
