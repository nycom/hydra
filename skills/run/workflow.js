export const meta = {
  name: 'hydra',
  description: 'Hydra run: implement workstreams in worktrees, review/fix/validate cycles until no critical or major is open, merge validated SHAs to feature branches with shared-file edits applied in order, whole-branch double review, cross-repo contract check, docs sync + docs validation',
  whenToUse: 'Called by the hydra:run skill after it has decomposed the plan, cut and pushed the feature branches, and written one brief per workstream. stage "wholeBranch" re-validates and docs-syncs the current feature-branch tips after coordinator fix-ups.',
  phases: [
    { title: 'Implement', detail: 'one author per workstream in its own worktree off the feature branch' },
    { title: 'Review cycles', detail: 'review one tier above the author (correctness + grilling in c1 + over-engineering) -> author fixes -> opus delta-validate' },
    { title: 'Merge', detail: 'validated SHA -> feature branch, then the workstream shared-file edits and regen, serialized per repo; a rejected merge returns to its author once' },
    { title: 'Whole-branch', detail: 'integrated review with seam inventory + independent opus validator per repo, up to wbRounds (default 2) fix rounds on side branches, fast-forwarded onto the feature branch once a recheck passes' },
    { title: 'Contracts', detail: 'one opus cross-repo wire-contract check once every repo is final (2+ repos)' },
    { title: 'Docs sync', detail: 'one sonnet docs agent (plus graph refresh when graphify-out exists) per docs repo on a side branch, then an opus validator on its commit, fast-forwarded onto the feature branch on a pass' },
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
  if (w.checks != null && !(Array.isArray(w.checks) && w.checks.length && w.checks.every(x => typeof x === 'string' && x.trim()))) throw new Error(`workstream ${w.id}: checks must be a non-empty array of commands`)
  if (w.quickGate != null && !(typeof w.quickGate === 'string' && w.quickGate.trim())) throw new Error(`workstream ${w.id}: quickGate must be a non-empty command`)
  w.repo = norm(w.repo)
  w.base ||= 'main'
  if (/^(docs|wbfix\d+)$/.test(w.branch.startsWith(`${w.featureBranch}--`) ? w.branch.slice(w.featureBranch.length + 2) : '')) throw new Error(`workstream ${w.id}: branch ${w.branch} is reserved for the run's side branches (${w.featureBranch}--docs, ${w.featureBranch}--wbfix<n>)`)
  w.reviewModel ||= w.model === 'opus' ? 'fable' : 'opus' // one tier above the author
}
if (new Set(W.map(w => w.id)).size !== W.length) throw new Error('workstream ids must be unique')
if (new Set(W.map(w => w.repo + ' ' + w.branch)).size !== W.length) throw new Error('workstream branches must be unique per repo')
if (A.cycles != null && !(Number.isInteger(A.cycles) && A.cycles >= 1)) throw new Error('cycles must be a positive integer or null')
if (A.maxCycles != null && !(Number.isInteger(A.maxCycles) && A.maxCycles >= (A.cycles ?? 1))) throw new Error('maxCycles must be an integer >= cycles')
if (A.stage != null && A.stage !== 'wholeBranch') throw new Error('stage must be "wholeBranch" or omitted')
for (const k of ['tokenBudget', 'tokenReserve', 'wbRounds'])
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
const WB_ROUNDS = A.wbRounds ?? 2 // whole-branch fix -> recheck rounds while critical/major findings remain; 0 = no fix rounds (findings returned unfixed)
const STAGE = A.stage || 'full'
// Shared files no workstream commits: the merge applies each workstream's sharedEdits to them in order, and regenerates the generated ones.
const HOT = ['**/README*', '**/CHANGELOG*', 'docs/**', 'graphify-out/**', '**/package-lock.json', '**/yarn.lock', '**/pnpm-lock.yaml', '**/poetry.lock', '**/uv.lock', '**/Cargo.lock', '**/go.sum', '**/openapi*.yaml', '**/openapi*.yml', '**/openapi*.json', '**/*.sha256']
const RUN_SECS = 540 // hard cap for smoke recipes and workstream checks (never for gates)
const CONF = {}
for (const c of A.repos || []) {
  if (!c.repo) throw new Error('repos items need {repo, knownRed?, hot?, regen?, smoke?, smokeTimeout?}')
  for (const k of ['knownRed', 'hot']) if (c[k] != null && !Array.isArray(c[k])) throw new Error(`repos ${c.repo}: ${k} must be an array`)
  // capped below the agent shell's 600 s foreground limit so the wrapper's own timeout always fires first
  if (c.smokeTimeout != null && !(Number.isInteger(c.smokeTimeout) && c.smokeTimeout >= 1 && c.smokeTimeout <= 590)) throw new Error(`repos ${c.repo}: smokeTimeout must be an integer from 1 to 590 (seconds)`)
  CONF[norm(c.repo)] = c
}
const conf = repo => ({ knownRed: [], hot: HOT, regen: '', smoke: '', smokeTimeout: RUN_SECS, ...CONF[repo] })
// The script can't learn its own path, so the coordinator passes the skill's base directory for run-cmd.mjs.
if ((W.some(w => w.checks) || Object.values(CONF).some(c => c.smoke)) && !/^\//.test(A.skillDir || '')) throw new Error('skillDir (the skill\'s absolute base directory) is required when a repo has smoke or a workstream has checks')
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
const HARD = 'Hard rules: no deploys, no ssh or rsync to hosts, no cloud or prod actions (prod data and prod endpoints included); never gh run rerun or gh pr merge; never create or push a plan/spec doc (plannings/, docs/*plan*) unless that file already exists on the origin branch.'
const sq = s => `'${s.replace(/'/g, `'\\''`)}'` // POSIX single-quoting for a shell argument
const RUN = (secs, cmd) => `node ${sq(`${A.skillDir}/run-cmd.mjs`)} ${secs} ${sq(cmd)}`
const SHELL_CAP = 'give the shell call a timeout above the cap (foreground max is 600 s), or run it in the background and wait'
const SMOKE = c => c.smoke ? `Live smoke, proving the core invariants: run the repo's local recipe exactly as this command line wraps it (${c.smokeTimeout} s hard cap, exit 124 = timed out; leftover processes are killed; ${SHELL_CAP}):\n${RUN(c.smokeTimeout, c.smoke)}\nA failed or timed-out smoke is a critical finding.` : 'Live smoke: "skipped: no smoke recipe" (do not improvise a boot).'
const CHECKS = w => w.checks ? `Checks: run each of these from your worktree root, exactly as written (${RUN_SECS} s hard cap, exit 124 = timed out; ${SHELL_CAP}), and report the exit code per command in gate.summary (validators) or tests (authors and fixers):\n${w.checks.map(x => RUN(RUN_SECS, x)).join('\n')}\nA red check is a critical finding; an author never pushes with one red.\n` : ''
const GIT = (repo, wt) => `Git rules (non-negotiable):
- Never touch the user's existing checkout of ${repo} (no checkout/switch/reset there). Work only in your own worktree at ${repo}/.claude/worktrees/${wt}: git -C ${repo} fetch origin and git -C ${repo} worktree prune first; if that path still exists, git worktree remove --force it; if the local branch already exists, add the worktree on it instead of creating it with -b.
- Commit in repo style with the repo's configured identity (the user). NO AI attribution anywhere: no Co-Authored-By trailer, no "Generated with" footer, no Claude/Anthropic/AI mention in messages, comments, docs or PR bodies, and no agent-tooling paths (.claude/) in committed text — say "a scratch worktree".
- Never rebase or rewrite pushed history; bring another branch in with git merge.
- Push with an explicit refspec (git push origin HEAD:refs/heads/<branch>, never --force) and verify with git ls-remote that the remote SHA equals your HEAD (detached-HEAD trap).
- Never open PRs, never touch main. Remove your worktree (git worktree remove --force) when done, including on failure.
${HARD}`
const RO = (repo, wt, regen = '') => `No commits, no pushes, no changes to any checkout but your own throwaway worktree at ${repo}/.claude/worktrees/${wt} (git worktree prune first; if that path still exists, git worktree remove --force it; remove it when done). Edits inside it — reverts, mutations, probes — are expected. Read every file at the SHA under review (git show <sha>:<path> or inside that worktree), never by path in ${repo}: that checkout sits on an unrelated branch.
${regen ? `${REGEN(regen)}\n` : ''}${HARD}`
// Run-wide flaky registry per repo: tests a validator proved intermittent at head and base; later gate prompts list them.
// shortcut: like mergedInto, prompts that list it depend on timing, so a resume may run those agents live instead of from cache.
const flakySeen = {}
const noteFlaky = (repo, r) => { for (const t of r?.gate?.flaky || []) (flakySeen[repo] ||= new Set()).add(t) }
const flakyOf = repo => [...(flakySeen[repo] || [])]
const GREEN = (knownRed, repo) => `${knownRed.length ? `Green = everything passes except exactly these known-red tests (recorded at the base): ${knownRed.join(', ')}. Any other failure is red; report any known-red that now passes.` : 'Green = every test passes.'}${flakyOf(repo).length ? ` Known flaky in this run (intermittent at head and base): ${flakyOf(repo).join(', ')}. If one of these fails, rerun it once alone and skip the base rerun: green on the rerun = flaky, not red; red again = a failure.` : ''} Never invent your own allowed failures.`
const GATE = (gate, knownRed, repo, quick) => `${quick ? 'Quick gate, green before every push (validators, the merge, the whole-branch pass and docs run the full gate)' : 'Full gate, green before every push — every suite the repo defines (unit, typecheck, build, Playwright/e2e where present), not just "test"'}:\n${gate}\n${GREEN(knownRed, repo)}\nRun gates in the foreground or with the harness's background-run. Never write pgrep -f wait loops (they match their own command line and never exit); if a wait is unavoidable, use wait $pid, kill -0 $pid, or a bracketed pattern like pgrep -f "[m]vnw".`
const FLAKY = 'A failure outside the known-red and known-flaky lists: rerun that test alone twice and once at the base SHA. Intermittent, or red on base too -> FLAKY: a minor hygiene finding with the three outcomes. Deterministic on head and green on base -> a regression, and gate.green = false. List in gate.flaky only tests that were intermittent on head AND failed at the base (pre-existing flakiness).'
// One regex for every no-AI-trace check, scoped to commits this run authored, never teammates'.
const AI_TRACE = 'co-authored-by|generated with|\\bclaude\\b|anthropic|\\.claude/'
const HYGIENE = range => `Hygiene: the commits git log --author="$(git config user.email)" ${range} lists (messages, trailers, added lines) and any PR body written for this branch must have zero matches for grep -iE '${AI_TRACE}' (real code identifiers such as an API-key env var name are not trace). A hit in a run-authored commit is critical (kind hygiene); if you are the agent pushing, do not push and return ok=false. Commits by other authors: report a hit once as a minor hygiene finding, never rewrite them.`
const TEST_GUARD = 'Test integrity: list pre-existing test files the range modified, deleted or renamed (git diff --diff-filter=MDR --name-only on test paths). A changed input or weakened assertion needs a reason from the brief or spec, else it is a major. Each of these is a critical unless the brief names it: a deleted or renamed pre-existing test; an added skip marker (skip|xfail|\\.only\\(|@Disabled|pytest.mark.skip|it.todo|describe.skip); an edit to test-runner config (jest/vitest/playwright/pytest config, pyproject [tool.pytest], conftest, coverage thresholds); a rewritten snapshot. For each changed assertion, mutate the production line it guards in your worktree and confirm the test goes red; one that stays green is a regression. Each new or changed test must pass 3 consecutive runs at the head (run it alone); a red run is a major (kind bug).'
const TRIAL = w => `Integration: in your worktree, trial-merge origin/${w.featureBranch} into the head (git merge --no-commit --no-ff, never committed or pushed) and run the gate there too. A failure or conflict the merge introduces is a regression of kind "integration" (critical or major by SEV), even when it surfaces in another workstream's files.`
const REFUTE = 'For each claim, try to REFUTE it; a claim you cannot prove with a command you ran stays open. Comments, docstrings and commit messages are claims, not evidence.'
const RO_TESTS = 'Pre-existing tests are read-only unless the brief names them. If a test or the gate contradicts the brief, or passing would need special-casing, return status blocked with a question — that is a valid outcome.'
const LADDER = 'Ladder-first (reuse > stdlib > native > one line > minimum code), no speculative code, stay strictly in scope.'
const SEV = 'Severity: critical = wrong behaviour, data loss, security, broken contract or red gate; major = real bug or design flaw; minor = the rest. Critical and major block the merge. Report only real issues; an empty list means clean.'
const DROP = 'Drop (do not downgrade): issues that predate the diff and are not made worse by it, anything the repo\'s linter/formatter catches, code the plan or brief explicitly allows, pure style with no correctness, safety or maintainability cost. A comment added in this diff is a claim to grill, never a reason to drop a finding; do not flag `shortcut:` comments themselves.'
const EVIDENCE = 'A critical or major of kind bug, regression or integration with evidence "none" and not resolved at this head: reproduce it here. Reproduced: keep it blocking with your evidence; otherwise return it still open with the same id, demoted to minor. Design, question and overengineering kinds are exempt.'
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
  properties: {
    green: { type: 'boolean', description: 'false on any failure that is neither known-red nor proven flaky' },
    summary: { type: 'string' },
    flaky: { type: 'array', items: { type: 'string' }, description: 'test ids intermittent on head that also failed at the base; empty if none' },
  },
  required: ['green', 'summary', 'flaky'],
}
const FINDINGS = { type: 'object', properties: { headSha: HEAD, findings: { type: 'array', items: FINDING } }, required: ['headSha', 'findings'] }
const SEAMS = { ...FINDINGS, properties: { ...FINDINGS.properties, seams: { type: 'string', description: 'one line per seam intersection; "none" if no change crosses a workstream' } }, required: [...FINDINGS.required, 'seams'] }
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
const PROMOTED = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', description: 'the feature branch now points at the promoted SHA, ls-remote verified' },
    sha: { type: 'string', description: 'remote SHA of the feature branch after this step (git ls-remote)' },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok', 'sha', 'notes'],
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
// A blocker the validator neither verified nor re-opened stays open: silence is not a resolution.
// Gate findings are rebuilt by redGate from each gate run, so they are never kept here.
const unaccounted = (prior, verified, open) => prior.filter(f => blocking(f) && f.where !== 'gate' && !verified.includes(f.id) && !open.some(o => o.id === f.id))
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
// Whole-branch fixes and docs land on side branches; a feature branch only fast-forwards to a SHA a validator passed.
// Returns '' once promoted, else why not (the side branches stay and the feature branch stays where it was).
async function promote(repo, branch, from, to, sides, label, phase) {
  const p = await step(
    `Promote a validated commit in ${repo}: fast-forward ${branch} from ${from} to ${to}.
1. git -C ${repo} fetch origin. If ls-remote already shows ${to}, an earlier attempt pushed it: go to step 3. Otherwise git -C ${repo} ls-remote origin refs/heads/${branch} must equal ${from}, and git -C ${repo} merge-base --is-ancestor ${from} ${to} must succeed. Otherwise push nothing: ok=false, the reason in notes.
2. git -C ${repo} push origin ${to}:refs/heads/${branch} (plain push, never --force; a rejected push is ok=false), then verify git ls-remote shows ${to}.
3. Only after a verified push: git -C ${repo} push origin --delete ${sides.join(' ')} (a side branch that is already gone is fine).
No worktree, no checkout, no commits; never touch the user's checkout of ${repo}. ${HARD}
Return ok, the remote sha of ${branch} and notes.`,
    { label, phase, model: 'sonnet', effort: 'low', schema: PROMOTED })
  return p?.ok && same(p.sha, to) ? '' : p ? p.notes.join('; ') || `${branch} is at ${p.sha}` : 'promote agent died 3 times'
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
  const authorGate = () => w.quickGate ? GATE(w.quickGate, c.knownRed, w.repo, true) : GATE(w.gate, c.knownRed, w.repo)
  // The first validator of a workstream writes black-box acceptance tests from the brief before it reads the diff.
  let acceptance = true
  const accept = sha => {
    if (!acceptance) return ''
    acceptance = false
    return `0. Before you read the diff: from the brief's acceptance criteria alone, write 2-5 black-box tests against the public interface in your worktree and run them at ${sha}; never commit or push them. A failing one is a finding (kind bug) with the test and its output as evidence, the reproducer. If the brief says no behaviour change, instead run the same inputs at git merge-base origin/${w.featureBranch} ${sha} and at ${sha} (check each out inside your worktree) and diff the outputs; any difference is a finding.\n`
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
${authorGate()}
${CHECKS(w)}${GIT(w.repo, w.id)}
Commit and push to ${w.branch}. Return status ("done" only when the gate is green and the push verified), ok, the verified remote sha, a one-line test summary, gateTail, sharedEdits, decisions (up to 10), questions and notes.`,
    { label: `${tag} implement`, phase: 'Implement', agentType: 'implementer', model: w.model, schema: PUSHED })
  if (!impl) return stop('implement agent died 3 times')
  absorb(impl)
  if (!impl.ok || impl.status !== 'done') return stop(`implement ${impl.status}: ${impl.tests}`)
  out.sha = impl.sha

  let carry = [] // open findings handed to the next review
  const tries = [] // blockers that survived a fix round: {id, where, rounds, answers}
  // same id, or same where; every red-gate finding has where 'gate', so that sentinel never matches by where (as in unaccounted)
  const sameFinding = (a, b) => a.id === b.id || (a.where !== 'gate' && a.where === b.where)
  const triesOf = f => tries.find(t => sameFinding(t, f))
  let rejected = null // a rejected merge goes back to the author once, as an integration critical
  for (let from = 1; ; from = out.cyclesRun + 1) {
    for (let i = from; i <= CAP; i++) {
      if (short(`${tag} cycle ${i}`)) return stop(`token budget below the ${RESERVE} reserve before cycle ${i}`)
      // a merge rejection goes straight to the fix: the head under it is unchanged and already reviewed
      const rev = rejected && i === from ? { headSha: out.sha, findings: carry } : await step(
        `Review workstream ${w.id}: git -C ${w.repo} fetch origin, then the diff origin/${w.featureBranch}...${out.sha} (branch ${w.branch}).
${RO(w.repo, `${w.id}-rev${i}`, c.regen)}

The brief it implements:
${w.brief}
${reasons()}
${LENSES(i === 1)}
${DROP}
${w.quickGate ? `Probes: to confirm a suspicion by running code, use the quick gate (${w.quickGate}) or single tests; the full gate is the validators' job.\n` : ''}${ledger.length ? `Settled in earlier cycles — do not re-raise unless the code under it changed:\n${JSON.stringify(ledger)}\n` : ''}${carry.length ? `The last validation left these open — re-check each, keep the ones still valid (same id):\n${JSON.stringify(carry)}\n` : ''}${SEV}
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

${accept(out.sha)}1. Check every acceptance criterion of the brief against the code and a command you ran. ${REFUTE}
2. Prove the new tests: revert the production hunks in your worktree, they must go red; restore them, green. ${TEST_GUARD}
3. Run the gate and report gate {green, summary, flaky}:
${w.gate}
${GREEN(c.knownRed, w.repo)} ${FLAKY}
4. ${TRIAL(w)}
${CHECKS(w)}${RO(w.repo, `${w.id}-val${i}`, c.regen)}
${SEV}
Return headSha, gate, verified (empty) and open (ids v${i}-F1, ...).`,
          { label: `${tag} validate c${i}`, phase: 'Review cycles', agentType: 'validator', model: 'opus', effort: 'high', schema: DELTA })
        if (!val) return stop(`validate c${i} died 3 times`)
        if (!same(val.headSha, out.sha)) return stop(`validate c${i} saw ${val.headSha}, the head is ${out.sha}`)
        noteFlaky(w.repo, val)
        found = [...found, ...val.open, ...redGate(val, `v${i}-G`)]
        out.validatedSha = out.sha
        if (!found.some(blocking)) { carry = found; break }
        // the validator's blockers go straight to this cycle's fix: re-reviewing the unchanged SHA wastes the cycle
      }
      {
        const prev = out.sha
        // A blocker that survived two fix rounds gets one opus fix with the earlier attempts.
        const stuck = found.filter(blocking).map(f => ({ f, t: triesOf(f) })).filter(x => x.t?.rounds.size >= 2)
        const fix = await step(
          `You are the author of workstream ${w.id} (${w.repo}, branch ${w.branch}). Review cycle ${i} findings:
${JSON.stringify(found)}
${stuck.map(({ f, t }) => `${f.id}: a prior fixer attempted this ${t.rounds.size} times: ${t.answers.join(' | ')}. Those attempts did not hold: find the root cause rather than repeat them; if no fix can hold, say why in the answer.\n`).join('')}${decisions.length ? `Your earlier reasoning:\n${JSON.stringify(decisions)}\n` : ''}
Set up: worktree ${w.id}-fix${i}, detached at origin/${w.branch} (expected ${prev}; if it moved, an earlier attempt of this step pushed it: continue from it); push back to ${w.branch}.
Critical and major: fix bugs with a test you ran RED before the fix and green after; answer every kind "question" with a defensible reason or a change; delete what the over-engineering findings say to delete.
${RO_TESTS}
Minor: fix only if it is a one-liner inside your files, otherwise decline with a reason — declining is a valid outcome.
Keep fixes minimal and inside this workstream's files.
Nothing to change (all answered or declined): no commit, no push, sha = the current origin/${w.branch} head (${prev} unless an earlier attempt moved it), ok = true.
${SHARED(c, w.files)}
${integration()}
sharedEdits: return the complete current list; it replaces the earlier one${out.sharedEdits.length ? `, so keep every entry still needed from:\n${JSON.stringify(out.sharedEdits)}` : ''}.
${authorGate()}
${CHECKS(w)}${GIT(w.repo, `${w.id}-fix${i}`)}
Return status, ok, verified sha, tests, gateTail, one answer per finding id, sharedEdits, decisions (new or changed only), questions (only what code, spec and brief cannot settle; use action "escalated") and notes.`,
          { label: `${tag} fix c${i}`, phase: 'Review cycles', agentType: 'implementer', model: stuck.length ? 'opus' : w.model, schema: FIXED })
        if (!fix) return stop(`fix c${i} died 3 times`)
        absorb(fix)
        if (!fix.ok || fix.status !== 'done') return stop(`fix c${i} ${fix.status}: ${fix.tests}`)
        out.sha = fix.sha

        const val = await step(
          `Independently validate the review-fix delta of workstream ${w.id} in ${w.repo}: git fetch, then ${prev}..${fix.sha} on ${w.branch}. Trust nothing the author claims.
${accept(fix.sha)}${same(prev, fix.sha) ? 'No delta: skip the delta hunt and judge the answers and declines; still run the gate, the test-integrity check and the trial merge at this head.\n' : ''}If the fixer merged origin/${w.featureBranch} (an integration fix), skip the merged-in side: judge git diff origin/${w.featureBranch}...${fix.sha}, and don't re-hunt sibling code already validated.
Findings with the author's claimed resolutions — judge the code first, then read each claim:
${JSON.stringify(found.map(f => ({ ...f, claim: fix.answers.find(a => a.id === f.id) || 'no answer' })))}

1. ${REFUTE} Where a test is claimed, it must fail at ${prev}, the pre-fix head: run it there in a second worktree at ${w.repo}/.claude/worktrees/${w.id}-val${i}-red (same rules: clear a leftover path first, remove it when done; never mktemp), and green at ${fix.sha}. Reverting the fix hunks in your worktree is the fallback only when that cannot run; state the fallback in evidence. Judge each answer to a question and each declined minor: defensible or not. ${EVIDENCE}
2. Hunt regressions the fixes introduced (they routinely plant new bugs: data loss, broken callers, weakened tests). ${TEST_GUARD}
3. Run the gate and report gate {green, summary, flaky}:
${w.gate}
${GREEN(c.knownRed, w.repo)} ${FLAKY}
4. ${TRIAL(w)}
${CHECKS(w)}${RO(w.repo, `${w.id}-val${i}`, c.regen)}
${SEV}
Return headSha, gate, verified (ids confirmed resolved, or whose answer or decline you accept) and open (same id for an unresolved finding; unresolved, indefensible, plus regressions as kind "regression" with ids v${i}-R1, ...).`,
          { label: `${tag} validate c${i}`, phase: 'Review cycles', agentType: 'validator', model: 'opus', effort: 'high', schema: DELTA })
        if (!val) return stop(`validate c${i} died 3 times`)
        if (!same(val.headSha, fix.sha)) return stop(`validate c${i} saw ${val.headSha}, the fix pushed ${fix.sha}`)
        noteFlaky(w.repo, val)
        out.findingsFixed += val.verified.length
        for (const f of found)
          if (val.verified.includes(f.id)) ledger.push({ id: f.id, where: f.where, issue: f.issue, status: fix.answers.find(a => a.id === f.id)?.action || 'fixed' })
        carry = [...val.open, ...redGate(val, `v${i}-G`), ...unaccounted(found, val.verified, val.open)]
        out.validatedSha = fix.sha
        for (const g of found)
          if (blocking(g) && carry.some(s => blocking(s) && sameFinding(s, g))) {
            let t = triesOf(g)
            if (!t) tries.push(t = { id: g.id, where: g.where, rounds: new Set(), answers: [] })
            t.rounds.add(i)
            t.answers.push(`c${i} ${g.id}: ${fix.answers.find(a => a.id === g.id)?.note || 'no answer'}`)
          }
        // Surviving the opus round too, it is the user's call, not another patch.
        const spent = carry.filter(blocking).map(f => ({ f, t: triesOf(f) })).find(x => x.t?.rounds.size >= 3)
        if (spent) {
          out.open = carry
          out.questions.push({ q: `${spent.f.id} (${spent.f.where}: ${spent.f.issue}) is still open after ${spent.t.rounds.size} fix rounds, the last on opus. Attempts: ${spent.t.answers.join(' | ')}. How should it be resolved?`, options: ['change the brief or spec so a fix is clear (say how)', 'accept it as known debt', 'drop this workstream'], default: 'change the brief or spec so a fix is clear (say how)' })
          return stop(`${spent.f.id} survived ${spent.t.rounds.size} fix rounds, the last on opus; returned to the user as a question`)
        }
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
${GATE(w.gate, c.knownRed, w.repo)}
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
    if (out.merged) break
    const why = merge.notes.join('; ') || merge.tests
    if (rejected || out.cyclesRun >= CAP) return stop(`merge failed: ${why}`)
    rejected = { id: 'M-F1', severity: 'critical', kind: 'integration', where: 'merge', issue: `The merge into ${w.featureBranch} rejected ${out.validatedSha}: ${why}. For a conflict or a red gate on the merged tip, git merge origin/${w.featureBranch} into your branch first, then resolve.`, evidence: 'the merge agent\'s report' }
    carry = [...carry, rejected] // the minors carried so far ride along
    log(`${tag}: merge rejected, returned to the author once`)
  }
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
  const res = { repo: r.repo, featureBranch: r.featureBranch, sha: '', verdict: 'skipped', sections: 'no workstream merged', seams: '', tests: '', fixRounds: 0, open: [], questions: [], notes: [], escalations: [] }
  if (!mine.some(w => w.merged)) return res
  let findings = []
  // Whole-branch fixes push to side branches; the feature branch fast-forwards to the last checked head only after a passing recheck.
  let checked = ''
  const sides = []
  const fail = why => { Object.assign(res, { verdict: 'fail', open: findings }); res.escalations.push(sides.length ? `${why}; whole-branch fixes left unpromoted on ${sides.at(-1)}, ${r.featureBranch} unchanged` : why); return res }

  const [rev, val] = await parallel([
    () => step(
      `Integrated review of ${r.repo}: git fetch, then the whole feature-branch diff ${range}. All workstreams are merged; hunt the cross-workstream seams the per-workstream reviews could not see.
${RO(r.repo, 'wb-rev')}

Briefs:
${briefs}

Seam inventory first: for each workstream merge commit M (git log --first-parent --merges --format='%H %s' ${range.replace('...', '..')}; the subject names the workstream branch), git diff M^1 M and list what it changed at its edges: signatures, fields, config/env keys, defaults, enum values, error shapes. Grep for their use sites in the other workstreams' diffs. Return each intersection as its own line in seams (producer change -> use site -> compatible or not); an incompatible one is also a finding of kind "integration"; a first-parent merge whose subject is not a workstream branch is an up-merge: use it as a producer only and file nothing inside it when its diff lies outside the review range.

${LENSES(false)}
${DROP}
${SEV}
headSha = the origin/${r.featureBranch} commit you reviewed. Ids: W-F1, W-F2, ...`,
      { label: `${n} review`, phase: 'Whole-branch', agentType: 'reviewer', model: top(r.ws.map(w => w.reviewModel)), schema: SEAMS }),
    () => step(
      `Independent whole-branch validation of ${r.repo}, feature branch ${r.featureBranch} vs origin/${r.base}. Trust nothing; re-derive everything yourself. ${REFUTE}
${RO(r.repo, 'wb-val')}
Sections (verdict per section):
1. ${HYGIENE(`origin/${r.base}..origin/${r.featureBranch}`)}
2. Tests from scratch, every suite including Playwright/e2e; report gate {green, summary, flaky}:
${gates}
${GREEN(c.knownRed, r.repo)} ${FLAKY}
3. Spec compliance point by point against the briefs below. ${TEST_GUARD}
4. Concurrency / writer audit where relevant.
5. ${SMOKE(c)}
Cross-repo wire contracts are checked separately once every repo is final.

Briefs:
${briefs}

${SEV}
sha = the origin/${r.featureBranch} commit you validated. Ids: V-F1, V-F2, ...`,
      { label: `${n} validate`, phase: 'Whole-branch', agentType: 'validator', model: 'opus', effort: 'high', schema: VERDICT }),
  ])
  if (!rev || !val) return fail(`${!rev ? 'integrated review' : 'whole-branch validator'} died 3 times`)
  if (!same(rev.headSha, val.sha)) return fail(`review saw ${rev.headSha}, validator saw ${val.sha}`)
  noteFlaky(r.repo, val)
  Object.assign(res, { sha: val.sha, verdict: val.verdict, sections: val.sections, tests: val.tests, seams: rev.seams })
  checked = val.sha
  // minors carried from the merged workstreams' cycles ride along (declinable); ids prefixed so two workstreams' c1-F1 stay apart
  findings = [...rev.findings, ...val.findings, ...redGate(val, 'V-G'), ...mine.filter(w => w.merged).flatMap(w => w.open.map(f => ({ ...f, id: `${w.id}:${f.id}` })))]

  for (let round = 1; round <= WB_ROUNDS && findings.some(blocking); round++) {
    if (short(`${n} whole-branch fix round ${round}`)) return fail(`token budget below the ${RESERVE} reserve before whole-branch fix round ${round}`)
    res.fixRounds = round
    const head = checked
    const side = `${r.featureBranch}--wbfix${round}`
    const fix = await step(
      `Whole-branch fix round ${round} on ${r.repo}, feature branch ${r.featureBranch}. Findings:
${JSON.stringify(findings)}

Set up: worktree wb-fix${round}, detached at ${head} (fetch first); push to the side branch ${side}, never to ${r.featureBranch}: it fast-forwards to your fix only after the recheck passes. If origin/${side} already exists and contains ${head}, an earlier attempt of this step pushed it: continue from it; if it does not contain ${head}, it is a leftover of an earlier run: delete it first (git push origin --delete ${side}).
Critical and major: resolve every one (red-verified tests for bug fixes; defensible answers to questions; delete what over-engineering findings name). Minor, including those carried from the workstream cycles: fix only if it is a one-liner, otherwise decline with a reason. Minimal fixes.
Nothing to change (all answered or declined): no commit, no push, sha = ${head} (or the origin/${side} head if an earlier attempt pushed it), ok = true.
Never merge a workstream branch: an unmerged workstream is the coordinator's call. If you change the source of a generated file, ${c.regen ? `rerun: ${c.regen}` : 'regenerate it with the repo\'s own script'}.
${LADDER}
${GATE(gates, c.knownRed, r.repo)}
${GIT(r.repo, `wb-fix${round}`)}
Return status, ok, verified sha, tests, gateTail, one answer per finding id, questions and notes; sharedEdits and decisions empty.`,
      { label: `${n} fix r${round}`, phase: 'Whole-branch', agentType: 'implementer', model: top(r.ws.map(w => w.model)), schema: FIXED })
    if (!fix) return fail(`whole-branch fix r${round} died 3 times`)
    res.questions.push(...fix.questions)
    res.notes.push(...fix.notes)
    if (!fix.ok || fix.status !== 'done') return fail(`whole-branch fix r${round} ${fix.status}: ${fix.tests}`)
    if (!same(head, fix.sha)) sides.push(side)

    const re = await step(
      `Re-check whole-branch fix round ${round} on ${r.repo}, feature branch ${r.featureBranch}: git fetch, then the delta ${head}..${fix.sha}. Trust nothing the author claims.
${same(head, fix.sha) ? 'No delta: skip the delta hunt and judge the answers and declines; still run every suite, the test-integrity check and hygiene at this head.\n' : ''}Findings with claimed resolutions — judge the code first, then read each claim:
${JSON.stringify(findings.map(f => ({ ...f, claim: fix.answers.find(a => a.id === f.id) || 'no answer' })))}
1. ${REFUTE} A claimed test must fail at ${head}, the pre-fix head: run it there in a second worktree at ${r.repo}/.claude/worktrees/wb-recheck${round}-red (same rules: clear a leftover path first, remove it when done; never mktemp), and green at ${fix.sha}. Reverting the fix hunks is the fallback only when that cannot run; state the fallback in evidence. Judge each answer and each declined minor. ${EVIDENCE}
2. Hunt regressions the fixes introduced. ${TEST_GUARD}
3. Rerun every suite and report gate {green, summary, flaky}:
${gates}
${GREEN(c.knownRed, r.repo)} ${FLAKY}
4. ${HYGIENE(`${head}..${fix.sha}`)}
5. ${SMOKE(c)}
${RO(r.repo, `wb-recheck${round}`)}
${SEV}
sha = the commit you checked. verdict pass only if nothing critical or major is open; verified = finding ids confirmed resolved, or whose answer or decline you accept; findings = everything still open (same id for a carried finding, new ids R${round}-F1, ...).`,
      { label: `${n} recheck r${round}`, phase: 'Whole-branch', agentType: 'validator', model: 'opus', effort: 'high', schema: RECHECK })
    if (!re) return fail(`recheck r${round} died 3 times`)
    if (!same(re.sha, fix.sha)) return fail(`recheck r${round} saw ${re.sha}, the fix pushed ${fix.sha}`)
    noteFlaky(r.repo, re)
    Object.assign(res, { verdict: re.verdict, sections: re.sections, tests: re.tests })
    checked = re.sha
    findings = [...re.findings, ...redGate(re, `R${round}-G`), ...unaccounted(findings, re.verified, re.findings)]
  }
  res.open = findings
  if (findings.some(blocking)) return fail(WB_ROUNDS ? `critical/major findings still open after ${res.fixRounds} whole-branch fix round(s)` : 'wbRounds 0: critical/major findings returned unfixed')
  if (sides.length) {
    const why = res.verdict !== 'pass' ? `the last recheck returned ${res.verdict}` : await promote(r.repo, r.featureBranch, res.sha, checked, sides, `${n} promote`, 'Whole-branch')
    if (why) return fail(`whole-branch fixes not promoted: ${why}`)
    res.sha = checked
  }
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
    // docs build on the validated head only; a failed pass may have its fixes on a side branch
    const rs = repoResults.find(x => x.repo === d.repo)
    if (rs?.verdict === 'fail') return { sha: '', files: [], prBody: false, ok: false, tests: '', notes: ['skipped: the whole-branch pass failed; docs run with the passing re-run'] }
    if (short(`${name(d.repo)} docs`)) return { sha: '', files: [], prBody: false, ok: false, tests: '', notes: ['skipped: token budget below the reserve'] }
    const rr = repoMap[d.repo]
    const gate = rr ? [...new Set(rr.ws.map(w => w.gate))].join('\n') : d.gate
    const knownRed = conf(d.repo).knownRed
    const side = `${d.featureBranch}--docs`
    const o = await step(
      `Docs sync for ${d.repo}, branch ${d.featureBranch}. Docs must describe what SHIPPED, not what the author first wrote.
This repo's branch: ${d.featureBranch} vs origin/${d.base}. Read the whole diff of every feature branch below vs its base, INCLUDING every review-round fix:
${PINS}
Set up: worktree docs-sync, detached at origin/${d.featureBranch}; push to the side branch ${side}, never to ${d.featureBranch}: it fast-forwards to your commit only after a validator passes it. If origin/${side} already exists and contains origin/${d.featureBranch}, an earlier attempt of this step pushed it: continue from it; otherwise it is a leftover of an earlier run: delete it first (git push origin --delete ${side}).
1. Update in ${d.repo}: README / docs / runbooks (new or changed env vars with prod-required secrets first, endpoints, contract fields, defaults flipped in review, deleted scaffolding, behaviour changed for existing clients); design/spec docs if this repo holds them (rows whose box, trigger or status moved).
2. If a PR already exists for ${d.featureBranch} (gh pr view), update its body (placement table, test plan, claims the fixes made false) with gh pr edit — never create a PR.
3. Knowledge graph, if graphify-out/ exists: graphify update . (add --force if the branch deleted files; never --update or semantic mode); reset line 1 of graphify-out/GRAPH_REPORT.md to the repo name (never a worktree name); drop manifest changes that are mtime-only; commit only graph.json, GRAPH_REPORT.md, manifest.json and .graphify_labels.json as "Refresh the knowledge graph". No graphify-out/: skip.
4. ${gate ? `${GATE(gate, knownRed, d.repo)}\nRun it after the graph refresh. Red gate: do not push, ok=false.` : 'No gate for this repo.'}
5. Before pushing: ${HYGIENE(`origin/${d.featureBranch}..HEAD`)}
Nothing stale and the graph unchanged: no commit, empty sha, ok=true.
${GIT(d.repo, 'docs-sync')}`,
      { label: `${name(d.repo)} docs`, phase: 'Docs sync', model: 'sonnet', schema: DOCS_OUT })
    if (!o || !o.sha) return o
    if (rs && !same(o.baseSha, rs.sha)) return { ...o, verdict: 'fail', findings: [{ id: 'D-X', severity: 'critical', kind: 'docs', where: o.sha, issue: `docs started from ${o.baseSha}, but the whole-branch pass validated ${rs.sha}`, evidence: 'the script\'s own check' }] }
    // The docs commit becomes the repo's finalSha only once its own read-only validator passes it.
    const v = await step(
      `Validate the docs-sync commits on ${d.repo}, branch ${d.featureBranch}: git fetch, then ${o.baseSha}..${o.sha} on the side branch ${side}. They land after every other check: on a pass they are fast-forwarded onto ${d.featureBranch} and become its head. ${REFUTE}
Sections (verdict per section):
1. Every changed doc line against the code it describes, at these pinned heads:
${PINS}
2. Knowledge graph, if touched: GRAPH_REPORT.md line 1 is the repo name; only the four graphify files are committed.
3. ${HYGIENE(`${o.baseSha}..${o.sha}`)}
4. ${gate ? `Run the gate and report gate {green, summary, flaky}:\n${gate}\n${GREEN(knownRed, d.repo)} ${FLAKY}` : 'No gate: gate {green: true, summary: "no gate", flaky: []}.'}
${RO(d.repo, 'docs-val')}
${SEV}
sha = the commit you validated. Ids: D-F1, D-F2, ...`,
      { label: `${name(d.repo)} docs validate`, phase: 'Docs sync', agentType: 'validator', model: 'opus', effort: 'high', schema: VERDICT })
    noteFlaky(d.repo, v)
    const vOk = v && same(v.sha, o.sha)
    const findings = vOk ? [...v.findings, ...redGate(v, 'D-G')] : [{ id: 'D-X', severity: 'critical', kind: 'docs', where: o.sha, issue: v ? `docs validator saw ${v.sha}, docs pushed ${o.sha}` : 'docs validator died 3 times', evidence: 'the script\'s own check' }]
    if (!vOk || v.verdict !== 'pass' || findings.some(blocking)) return { ...o, verdict: 'fail', findings }
    const why = await promote(d.repo, d.featureBranch, o.baseSha, o.sha, [side], `${name(d.repo)} docs promote`, 'Docs sync')
    return { ...o, verdict: why ? 'fail' : 'pass', findings: why ? [...findings, { id: 'D-P', severity: 'critical', kind: 'docs', where: side, issue: `validated docs not promoted to ${d.featureBranch}: ${why}`, evidence: 'the promote step' }] : findings }
  })),
])

const brief = f => `${f.severity} ${f.where}: ${f.issue}`
const uniq = xs => [...new Set(xs)]
const uniqQ = qs => qs.filter((q, i) => qs.findIndex(x => x.q === q.q) === i)
const docsOf = repo => {
  const j = DOCS.findIndex(d => d.repo === repo)
  if (j < 0 || !shipped || skipped.has(repo)) return null
  const d = docs?.[j]
  const verdict = d?.verdict || (d?.sha ? 'fail' : 'n/a')
  return d ? { sha: d.sha, files: d.files, prBody: d.prBody, ok: d.ok, tests: d.tests, notes: d.sha && verdict !== 'pass' ? [...d.notes, `not promoted: docs commit ${d.sha} stays on ${DOCS[j].featureBranch}--docs`] : d.notes, verdict, findings: d.findings || [] } : { sha: '', files: [], prBody: false, ok: false, tests: '', notes: ['docs agent died 3 times'], verdict: 'fail', findings: [] }
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
    // docs that fail validation or promotion never reach the branch and fail the repo; so does a docs agent that died 3 times
    const docsFailed = d && (d.sha ? d.verdict !== 'pass' : d.verdict === 'fail')
    return { ...r, verdict: docsFailed ? 'fail' : r.verdict, escalations: [...r.escalations, ...(docsFailed ? [d.sha ? `docs commit ${d.sha} left unpromoted on ${r.featureBranch}--docs` : 'docs agent died 3 times; docs not synced'] : [])], open: [...r.open, ...(d?.findings || [])].map(brief), questions: uniqQ(r.questions), notes: uniq(r.notes), docs: docsOut(d), finalSha: (d?.verdict === 'pass' && d.sha) || r.sha, flaky: flakyOf(r.repo) }
  }),
  crossRepo: crossRepo && { ...crossRepo, findings: crossRepo.findings.map(brief) },
  otherDocs: DOCS.filter(d => !repoMap[d.repo]).map(d => ({ repo: d.repo, featureBranch: d.featureBranch, docs: docsOut(docsOf(d.repo)), flaky: flakyOf(d.repo) })),
}
