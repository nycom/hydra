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
    { title: 'Drift audit', detail: 'one read-only fable agent maps every user-visible change to a decision-log line or brief clause' },
    { title: 'Docs sync', detail: 'one sonnet docs agent (plus graph refresh when graphify-out exists) per docs repo on a side branch, then an opus validator on its commit, fast-forwarded onto the feature branch on a pass' },
  ],
}

// ---- args ----------------------------------------------------------------
const A = args || {}
const W = A.workstreams || []
if (!W.length) throw new Error('args.workstreams is empty')
const norm = repo => repo.replace(/\/+$/, '') // one key per repo, however the path was typed
const MODELS = ['sonnet', 'opus', 'fable'] // tier order; never below sonnet
if (A.wbReviewModel != null && !MODELS.includes(A.wbReviewModel)) throw new Error('wbReviewModel must be sonnet|opus|fable')
for (const w of W) {
  for (const k of ['id', 'repo', 'featureBranch', 'branch', 'model', 'brief', 'gate'])
    if (!w[k]) throw new Error(`workstream ${w.id || '?'}: missing ${k}`)
  if (!['sonnet', 'opus'].includes(w.model)) throw new Error(`workstream ${w.id}: model must be sonnet|opus`)
  if (w.reviewModel && !MODELS.includes(w.reviewModel)) throw new Error(`workstream ${w.id}: reviewModel must be sonnet|opus|fable`)
  if (w.files != null && !(Array.isArray(w.files) && w.files.length)) throw new Error(`workstream ${w.id}: files must be a non-empty array`)
  if (w.checks != null && !(Array.isArray(w.checks) && w.checks.length && w.checks.every(x => typeof x === 'string' && x.trim()))) throw new Error(`workstream ${w.id}: checks must be a non-empty array of commands`)
  if (w.knownRedChecks != null && !(Array.isArray(w.knownRedChecks) && w.knownRedChecks.length && w.knownRedChecks.every(x => w.checks?.includes(x)))) throw new Error(`workstream ${w.id}: knownRedChecks must be a non-empty array of entries of its checks`)
  if (w.quickGate != null && !(typeof w.quickGate === 'string' && w.quickGate.trim())) throw new Error(`workstream ${w.id}: quickGate must be a non-empty command`)
  w.repo = norm(w.repo)
  w.base ||= 'main'
  if (/^(docs|wbfix\d+)$/.test(w.branch.startsWith(`${w.featureBranch}--`) ? w.branch.slice(w.featureBranch.length + 2) : '')) throw new Error(`workstream ${w.id}: branch ${w.branch} is reserved for the run's side branches (${w.featureBranch}--docs, ${w.featureBranch}--wbfix<n>)`)
  w.reviewModel ||= w.model === 'opus' ? 'fable' : 'opus' // one tier above the author
  if (w.lite != null && typeof w.lite !== 'boolean') throw new Error(`workstream ${w.id}: lite must be a boolean`)
  if (w.humanCheck != null && !(typeof w.humanCheck === 'string' && w.humanCheck.trim())) throw new Error(`workstream ${w.id}: humanCheck must be non-empty instructions for the user`)
  if (w.after != null && !(Array.isArray(w.after) && w.after.length && w.after.every(x => typeof x === 'string'))) throw new Error(`workstream ${w.id}: after must be a non-empty array of workstream ids`)
}
if (new Set(W.map(w => w.id)).size !== W.length) throw new Error('workstream ids must be unique')
const byId = Object.fromEntries(W.map(w => [w.id, w]))
// after: same repo only, so "merged" always means merged into the one feature branch this workstream branches from
for (const w of W) for (const id of w.after || []) {
  if (!byId[id] || id === w.id) throw new Error(`workstream ${w.id}: after names ${id === w.id ? 'itself' : `unknown workstream ${id}`}`)
  if (byId[id].repo !== w.repo) throw new Error(`workstream ${w.id}: after ${id} is in another repo; order across repos by running them as separate runs`)
}
const ordered = (w, path = []) => { if (path.includes(w.id)) throw new Error(`after forms a cycle: ${[...path, w.id].join(' -> ')}`); for (const id of w.after || []) ordered(byId[id], [...path, w.id]) }
W.forEach(w => ordered(w))
// dropped: workstreams the user dropped; the rest merges and these are listed as not done
if (A.dropped != null && !(Array.isArray(A.dropped) && A.dropped.every(x => typeof x === 'string'))) throw new Error('dropped must be an array of workstream ids')
const DROPPED = new Set(A.dropped || [])
for (const id of DROPPED) if (!byId[id]) throw new Error(`dropped: no workstream ${id}`)
for (const w of W) for (const id of w.after || []) if (DROPPED.has(id) && !DROPPED.has(w.id)) throw new Error(`workstream ${w.id}: after ${id}, which is dropped: drop it too or remove the after`)
if (A.localOnly != null && typeof A.localOnly !== 'boolean') throw new Error('localOnly must be a boolean')
// localOnly: every fetch, push and ls-remote targets a bare repo on local disk the coordinator sets up as this remote
const O = A.localOnly ? 'hydra-local' : 'origin'
const FETCH = A.localOnly ? ` ${O}` : '' // a bare git fetch reads origin
const HUMAN = A.humanChecks || {}
if (typeof HUMAN !== 'object' || Array.isArray(HUMAN)) throw new Error('humanChecks must be an object {<workstream id>: answer}')
for (const [id, a] of Object.entries(HUMAN)) {
  if (!byId[id]?.humanCheck) throw new Error(`humanChecks.${id}: no workstream ${id} with a humanCheck`)
  // each answer names the sha the user checked, so it never applies to a different commit (a resume whose cache missed)
  if (![].concat(a).length || ![].concat(a).every(x => x && /^[0-9a-f]{7,40}$/.test(x.sha) && typeof x.answer === 'string' && x.answer.trim())) throw new Error(`humanChecks.${id}: {sha, answer} or an array of them: sha = the checked commit (7-40 hex), answer = "ok" or the problem in words`)
}
// resume: the id of the run a resumeFromRunId call resumes; with the call ordinal and the input digest it makes the git-state probe's prompt new, so the probe runs live
if (A.resume != null && !(typeof A.resume === 'string' && A.resume.trim())) throw new Error('resume must be the id of the run being resumed (a non-empty string)')
const DECIDE = A.decisions || {}
if (typeof DECIDE !== 'object' || Array.isArray(DECIDE)) throw new Error('decisions must be an object {<workstream id>: answer}')
for (const [id, a] of Object.entries(DECIDE)) {
  if (!byId[id]) throw new Error(`decisions.${id}: no workstream ${id}`)
  if (!(typeof a === 'string' && a.trim())) throw new Error(`decisions.${id}: the user's answer to that workstream's blocked question, in words`)
}
// the answer joins the brief, so every agent of that workstream reads it and the test guard accepts the edit it authorises
for (const w of W) if (DECIDE[w.id]) w.brief += `\n\nThe user's answer to this workstream's earlier blocked question (binding; a pre-existing test edit it authorises is named by this brief, so it is not a finding; the author lists each such edit in notes as "authorised test edit: <path>"): ${DECIDE[w.id]}`
if (new Set(W.map(w => w.repo + ' ' + w.branch)).size !== W.length) throw new Error('workstream branches must be unique per repo')
if (A.cycles != null && !(Number.isInteger(A.cycles) && A.cycles >= 1)) throw new Error('cycles must be a positive integer or null')
if (A.stopRule != null && !(typeof A.stopRule === 'string' && A.stopRule.trim())) throw new Error('stopRule must be a non-empty string naming the wrong actions that block, e.g. "wrong output for a listed case, lost user data, a crash"')
const absArg = k => { if (A[k] != null && !(typeof A[k] === 'string' && /^\//.test(A[k]))) throw new Error(`${k} must be an absolute path`) }
if (A.stepTool != null && !(typeof A.stepTool === 'string' && /^[\w-]+$/.test(A.stepTool))) throw new Error('stepTool must be a tool name (letters, digits, _ and -)')
// opt-in worker step reports: empty unless stepTool is set, so default prompts are unchanged
const STEP = A.stepTool ? `\n\nProgress: report your steps with the ${A.stepTool} tool (total once, then done as each step finishes). Send failed: true, with reason and error, only when your own attempt at this step failed. Findings you report, and a red gate or check you were asked to run, are results, not failures.` : ''
absArg('acceptance')
absArg('decisionLog')
if (A.maxCycles != null && !(Number.isInteger(A.maxCycles) && A.maxCycles >= (A.cycles ?? 1))) throw new Error('maxCycles must be an integer >= cycles')
if (A.stage != null && A.stage !== 'wholeBranch') throw new Error('stage must be "wholeBranch" or omitted')
for (const k of ['tokenBudget', 'tokenReserve', 'wbRounds'])
  if (A[k] != null && !(Number.isInteger(A[k]) && A[k] >= 0)) throw new Error(`${k} must be a non-negative integer or null`)

// files[]: literal paths or dir prefixes (dir/ or dir/**). Two workstreams of one repo may not claim overlapping ones,
// unless one is ordered after the other: they never run at once, and the later one's backstop allows the earlier one's files.
// shortcut: other glob patterns are compared literally; list concrete paths when two briefs share a directory.
const stem = f => f.replace(/\/\*\*$/, '/')
const dependsOn = (w, id) => (w.after || []).some(x => x === id || dependsOn(byId[x], id))
const overlaps = (a, b) => { const [x, y] = [stem(a), stem(b)]; return x === y || (x.endsWith('/') && y.startsWith(x)) || (y.endsWith('/') && x.startsWith(y)) }
for (const [i, a] of W.entries())
  for (const b of W.slice(i + 1))
    if (a.repo === b.repo && a.files && b.files && !dependsOn(a, b.id) && !dependsOn(b, a.id)) {
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
  if (c.reviewSharedEdits != null && typeof c.reviewSharedEdits !== 'boolean') throw new Error(`repos ${c.repo}: reviewSharedEdits must be a boolean`)
  // the script can't run git: whether each path is ignored is checked by every agent that copies it
  if (c.copyExcluded != null && !(Array.isArray(c.copyExcluded) && c.copyExcluded.every(p => typeof p === 'string' && p.trim() && p === p.trim() && !p.startsWith('/') && !p.startsWith('~') && !p.split('/').includes('..')))) throw new Error(`repos ${c.repo}: copyExcluded must be an array of paths inside the repo (relative, no ..)`)
  if (c.commitPrefix != null && !(typeof c.commitPrefix === 'string' && /^[^\n\r"]+$/.test(c.commitPrefix))) throw new Error(`repos ${c.repo}: commitPrefix must be a non-empty string without a newline or a quote`)
  CONF[norm(c.repo)] = c
}
const conf = repo => ({ knownRed: [], hot: HOT, regen: '', smoke: '', smokeTimeout: RUN_SECS, copyExcluded: [], ...CONF[repo], commitPrefix: CONF[repo]?.commitPrefix ?? '' })
// The script can't learn its own path, so the coordinator passes the skill's base directory for run-cmd.mjs.
if ((W.some(w => w.checks) || Object.values(CONF).some(c => c.smoke)) && !/^\//.test(A.skillDir || '')) throw new Error('skillDir (the skill\'s absolute base directory) is required when a repo has smoke or a workstream has checks')
const repoMap = {}
for (const w of W) (repoMap[w.repo] ||= { repo: w.repo, featureBranch: w.featureBranch, base: w.base, conf: conf(w.repo), ws: [] }).ws.push(w)
const REPOS = Object.values(repoMap)
for (const r of REPOS)
  if (r.ws.some(w => w.featureBranch !== r.featureBranch || w.base !== r.base)) throw new Error(`${r.repo}: workstreams disagree on featureBranch/base`)
const DOCS = (A.docsRepos || REPOS).map(d => ({ repo: d.repo && norm(d.repo), featureBranch: d.featureBranch, base: d.base || repoMap[d.repo && norm(d.repo)]?.base || 'main', gate: d.gate || '' }))
for (const d of DOCS) if (!d.repo || !d.featureBranch) throw new Error('docsRepos items need {repo, featureBranch, base?, gate?}')
// the gate runs under pipefail: a reader that exits early (head, grep -q) makes the writer die of SIGPIPE (exit 141), which reads red
const EARLY_EXIT = /(?<!\|)\|(?!\|)\s*(head\b|grep\s+(-\w*q|--quiet))/
for (const [who, g] of [...W.flatMap(w => [[`workstream ${w.id}`, w.gate], [`workstream ${w.id}`, w.quickGate]]), ...DOCS.map(d => [`docsRepos ${d.repo}`, d.gate])])
  if (EARLY_EXIT.test(g || '')) throw new Error(`${who}: the gate pipes into head or grep -q: under the pipefail wrapper the writer gets SIGPIPE (exit 141) and the gate reads red; use tail, or redirect to a file`)
// carryForward: what git cannot say, handed from a paused or incomplete result to its resume (findings, settled ledgers, passed whole-branch passes)
const CF = A.carryForward || {}
if (typeof CF !== 'object' || Array.isArray(CF)) throw new Error('carryForward must be the carryForward object of the result being resumed')
if (A.carryForward && !A.resume) throw new Error('carryForward is only for a resume: set resume too')
if (CF.call != null && !(Number.isInteger(CF.call) && CF.call >= 1)) throw new Error('carryForward.call must be a positive integer (the call that returned it)')
// this call's ordinal: resumeFromRunId keeps the run id, so the probe tells a 2nd resume from the 1st by it
const CALL = (CF.call ?? 0) + 1
for (const [id, x] of Object.entries(CF.workstreams || {})) {
  if (!byId[id]) throw new Error(`carryForward.workstreams.${id}: no workstream ${id}`)
  for (const k of ['handed', 'open', 'findings']) if (x[k] != null && !Array.isArray(x[k])) throw new Error(`carryForward.workstreams.${id}.${k} must be an array`)
}
const CF_REPOS = Object.fromEntries(Object.entries(CF.repos || {}).map(([repo, x]) => [norm(repo), x]))
for (const [repo, x] of Object.entries(CF_REPOS)) {
  if (!repoMap[repo]) throw new Error(`carryForward.repos: ${repo} has no workstream in this run`)
  if (x.shared != null && !Array.isArray(x.shared)) throw new Error(`carryForward.repos ${repo}: shared must be an array`)
  const k = x.passed && ['open', 'findings', 'questions', 'notes', 'escalations', 'churn'].find(f => !Array.isArray(x.passed[f]))
  if (x.passed != null && !(x.passed.verdict === 'pass' && /^[0-9a-f]{7,40}$/.test(x.passed.sha || '') && !k)) throw new Error(`carryForward.repos ${repo}: passed must be the repo result of a passed whole-branch pass (verdict pass, a 7-40 hex sha${k ? `, ${k} an array` : ''})`)
}
// restored ids get a p: prefix, so a restarted review's new c1-F1 (or a re-merge's S-<id>-m1-F1) never collides with the earlier call's
const prior = f => ({ ...f, id: `p:${f.id}` })
const CF_WS = Object.fromEntries(Object.entries(CF.workstreams || {}).map(([id, x]) => [id, Object.fromEntries(['handed', 'open', 'findings'].map(k => [k, (x[k] || []).map(prior)]))]))
const name = repo => repo.split('/').pop()
const STALE = `Read other repos ONLY via git -C <repo> fetch ${O}, then git -C <repo> show ${O}/<featureBranch>:<path> or git -C <repo> diff ${O}/<base>...${O}/<featureBranch> — never by filesystem path: those checkouts sit on unrelated branches.`

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
const DECIDED = A.decisionLog ? ` Binding decisions (user-approved): ${A.decisionLog}. Read it first; never act against a line of it. A finding that asks for what a decision rules out is dropped; a brief clause that contradicts a decision goes to questions, the default keeping the decision. File missing or unreadable: a critical finding (kind question), or, if you push, stop and report it (status "blocked", or ok=false with the reason in notes).` : ''
const HARD = `Hard rules: no deploys, no ssh or rsync to hosts, no cloud or prod actions (prod data and prod endpoints included); never gh run rerun or gh pr merge; never create or push a plan/spec doc (plannings/, docs/*plan*) unless that file already exists on the ${O} branch.${A.localOnly ? ` Local-only run: nothing may reach the network. ${O} is a bare repo on local disk and the only remote you may fetch from, push to or ls-remote; never fetch from or push to origin or any other remote, and run no gh command.` : ''}${DECIDED}`
const sq = s => `'${s.replace(/'/g, `'\\''`)}'` // POSIX single-quoting for a shell argument
const RUN = (secs, cmd) => `node ${sq(`${A.skillDir}/run-cmd.mjs`)} ${secs} ${sq(cmd)}`
const SHELL_CAP = 'give the shell call a timeout above the cap (foreground max is 600 s), or run it in the background and wait'
const SMOKE = c => c.smoke ? `Live smoke, proving the core invariants: run the repo's local recipe exactly as this command line wraps it (${c.smokeTimeout} s hard cap, exit 124 = timed out; leftover processes are killed; ${SHELL_CAP}):\n${RUN(c.smokeTimeout, c.smoke)}\nA failed or timed-out smoke is a critical finding.` : 'Live smoke: "skipped: no smoke recipe" (do not improvise a boot).'
const CHECKS = w => w.checks?.length ? `Checks: run each of these from your worktree root, exactly as written (${RUN_SECS} s hard cap, exit 124 = timed out; ${SHELL_CAP}), and report the exit code per command in checkExits, in this order:\n${w.checks.map(x => RUN(RUN_SECS, x)).join('\n')}\n${w.knownRedChecks?.length ? `Known-red checks (red at the base; report the exit, never a finding): ${JSON.stringify(w.knownRedChecks)}\n` : ''}A red check is a critical finding and is never rerun; an author never pushes with one red${w.knownRedChecks?.length ? ' that is not known-red' : ''}.\n` : ''
// checkExits is the typed channel for checks: a red one that is not known-red turns the gate red, so redGate files it as critical.
// author = the exits the author or fixer of the same head reported; its 0 where the validator saw red is a false green.
const judged = (r, w, author) => {
  const red = r && w.checks?.length ? w.checks.map((x, i) => [x, r.checkExits[i], author?.[i]]).filter(([x, e]) => e !== 0 && !w.knownRedChecks?.includes(x)) : []
  return red.length ? { ...r, gate: { ...r.gate, green: false, summary: `${r.gate.summary}; red check(s): ${red.map(([x, e, a]) => `${x} exit ${e}${a === 0 ? ' (false green: its author reported exit 0)' : ''}`).join(', ')}` } } : r
}
// copyExcluded: git-ignored files the gate needs (e.g. a local preview test) exist only in the user's checkout
const COPY = repo => { const ps = conf(repo).copyExcluded; return ps.length ? `Git-excluded files: right after creating each worktree, before any gate or test, copy these paths from the user's checkout ${repo} to the same path in it (mkdir -p the parent, then cp -Rp): ${ps.join(', ')}. Copy only if each exists and git -C ${repo} check-ignore -q <path> succeeds; otherwise copy nothing, stop and report it (status blocked, or a critical hygiene finding). Never commit them (no git add -f).\n` : '' }
const GIT = (repo, wt) => `Git rules (non-negotiable):
- Never touch the user's existing checkout of ${repo} (no checkout/switch/reset there). Work only in your own worktree at ${repo}/.claude/worktrees/${wt}: git -C ${repo} fetch ${O} and git -C ${repo} worktree prune first; if that path still exists, git worktree remove --force it; if the local branch already exists, add the worktree on it instead of creating it with -b.
${COPY(repo) && `- ${COPY(repo)}`}- Commit in repo style with the repo's configured identity (the user). NO AI attribution anywhere: no Co-Authored-By trailer, no "Generated with" footer, no Claude/Anthropic/AI mention in messages, comments, docs or PR bodies, and no agent-tooling paths (.claude/) in committed text — say "a scratch worktree".
- Never rebase or rewrite pushed history; bring another branch in with git merge.
- Push with an explicit refspec (git push ${O} HEAD:refs/heads/<branch>, never --force) and verify with git ls-remote that the remote SHA equals your HEAD (detached-HEAD trap).
- Never open PRs, never touch main. Remove your worktree (git worktree remove --force) when done, including on failure.
${HARD}`
const RO = (repo, wt, regen = '') => `No commits, no pushes, no changes to any checkout but your own throwaway worktree at ${repo}/.claude/worktrees/${wt} (git worktree prune first; if that path still exists, git worktree remove --force it; remove it when done). Edits inside it — reverts, mutations, probes — are expected. Read every file at the SHA under review (git show <sha>:<path> or inside that worktree), never by path in ${repo}: that checkout sits on an unrelated branch.
${COPY(repo)}${regen ? `${REGEN(regen)}\n` : ''}${HARD}`
// Run-wide flaky registry per repo: tests a validator proved intermittent at head and base; later gate prompts list them.
// shortcut: like mergedInto, prompts that list it depend on timing, so a resume may run those agents live instead of from cache.
const flakySeen = {}
const noteFlaky = (repo, r) => { for (const t of r?.gate?.flaky || []) (flakySeen[repo] ||= new Set()).add(t) }
const flakyOf = repo => [...(flakySeen[repo] || [])]
const GREEN = (knownRed, repo) => `${knownRed.length ? `Green = everything passes except exactly these known-red tests (recorded at the base): ${knownRed.join(', ')}. Any other failure is red; report any known-red that now passes.` : 'Green = every test passes.'}${flakyOf(repo).length ? ` Known flaky in this run (intermittent at head and base): ${flakyOf(repo).join(', ')}. If one of these fails, rerun it once alone and skip the base rerun: green on the rerun = flaky, not red; red again = a failure.` : ''} Never invent your own allowed failures.`
// the fixed wrapper: pipefail and errexit, so a failure behind a pipe or a ; chain is red, and the exit code is printed last
const GATE_CMD = gate => `bash -c ${sq(`set -eo pipefail\n${gate}`)}; echo "gate exit=$?"`
// a known-red or flaky failure makes the exit non-zero and stops the chain, so the rest of the gate still has to run
const WRAPPED = 'Run it through exactly this wrapper (pipefail; it stops at the first failing command and prints the exit code last). "gate exit=0" is green. Any other exit is red unless every failure it printed is allowed by the green rules below (a known-red or known-flaky test, or one the flaky rule proves intermittent); then run each command after the failing one through the same wrapper too, so no suite stays unrun, and judge them all. Nothing is ever pushed on a red gate'
const GATE = (gate, knownRed, repo, quick) => `${quick ? 'Quick gate, green before every push (validators, the merge, the whole-branch pass and docs run the full gate)' : 'Full gate, green before every push — every suite the repo defines (unit, typecheck, build, Playwright/e2e where present), not just "test"'}. ${WRAPPED}:\n${GATE_CMD(gate)}\n${GREEN(knownRed, repo)}\nRun gates in the foreground or with the harness's background-run. Never write pgrep -f wait loops (they match their own command line and never exit); if a wait is unavoidable, use wait $pid, kill -0 $pid, or a bracketed pattern like pgrep -f "[m]vnw".`
const FLAKY = 'A failure outside the known-red and known-flaky lists: rerun that test alone twice and once at the base SHA. Intermittent, or red on base too -> FLAKY: a minor hygiene finding with the three outcomes. Deterministic on head and green on base -> a regression, and gate.green = false. List in gate.flaky only tests that were intermittent on head AND failed at the base (pre-existing flakiness).'
// One regex for every no-AI-trace check, scoped to commits this run authored, never teammates'.
const AI_TRACE = 'co-authored-by|generated with|\\bclaude\\b|anthropic|\\.claude/'
// localOnly: a push to a configured network remote leaves its remote-tracking ref; checking those needs no network
const runBranches = repo => [...new Set([...W.filter(w => w.repo === repo).flatMap(w => [w.featureBranch, w.branch]), ...DOCS.filter(d => d.repo === repo).map(d => d.featureBranch)])]
const HYGIENE = (range, repo) => `Hygiene: the commits git log --author="$(git config user.email)" ${range} lists (messages, trailers, added lines) and any PR body written for this branch must have zero matches for grep -iE '${AI_TRACE}' (real code identifiers such as an API-key env var name are not trace). A hit in a run-authored commit is critical (kind hygiene); if you are the agent pushing, do not push and return ok=false. Commits by other authors: report a hit once as a minor hygiene finding, never rewrite them.${conf(repo).copyExcluded.length ? ` Git-excluded copies stay out of every commit: git diff --name-only ${range} -- ${conf(repo).copyExcluded.map(sq).join(' ')} must print nothing; a hit is critical (kind hygiene).` : ''}${A.localOnly ? ` Local-only run: git -C ${repo} for-each-ref --format='%(refname)' ${runBranches(repo).flatMap(b => [sq(`refs/remotes/*/${b}`), sq(`refs/remotes/*/${b}--*`)]).join(' ')} | grep -v '^refs/remotes/${O}/' must print nothing: a line there is a run branch pushed to a network remote, critical (kind hygiene).` : ''}`
const TEST_GUARD = 'Test integrity: list pre-existing test files the range modified, deleted or renamed (git diff --diff-filter=MDR --name-only on test paths). A changed input or weakened assertion needs a reason from the brief or spec, else it is a major. Each of these is a critical unless the brief names it: a deleted or renamed pre-existing test; an added skip marker (skip|xfail|\\.only\\(|@Disabled|pytest.mark.skip|it.todo|describe.skip); an edit to test-runner config (jest/vitest/playwright/pytest config, pyproject [tool.pytest], conftest, coverage thresholds); a rewritten snapshot. For each changed assertion, mutate the production line it guards in your worktree and confirm the test goes red; one that stays green is a regression. Each new or changed test must pass 3 consecutive runs at the head (run it alone); a red run is a major (kind bug).'
const TRIAL = w => `Integration: in your worktree, trial-merge ${O}/${w.featureBranch} into the head (git merge --no-commit --no-ff, never committed or pushed) and run the gate there too. A failure or conflict the merge introduces is a regression of kind "integration" (critical or major by SEV), even when it surfaces in another workstream's files.`
const REFUTE = 'For each claim, try to REFUTE it; a claim you cannot prove with a command you ran stays open. Comments, docstrings and commit messages are claims, not evidence.'
const MERGE_EDITS = (hot, edits) => hot.length ? `Shared-file edits are applied by the merge on the feature-branch tip, never in this range (shared files = ${hot.join(', ')}): a brief criterion on a shared file is met when the author's sharedEdits carry it (${edits.length ? JSON.stringify(edits) : 'none returned'}). Its absence from this range or head is never a finding; only a brief shared edit missing from that list is a finding. ` : ''
// merge, promote and docs run as the lean implementer type, whose own instructions are written for feature work
const NOT_FEATURE = "This step is not a feature task: write no tests, skip test-first and the self-review fix pass; change nothing these instructions don't name; follow everything below in order and return the schema."
const ALSO = fs => fs.some(f => f.also) ? 'An entry with `also` holds a second finding at overlapping lines: resolve and verify both; if the `also` one still holds, return it open under its own id.\n' : ''
const RO_TESTS = 'Pre-existing tests are read-only unless the brief names them. If a test or the gate contradicts the brief, or passing would need special-casing, return status blocked with a question — that is a valid outcome. For any question, the default must keep every pre-existing test unchanged and stay within the brief; offer a test edit only as a non-default option. Blocked only on an optional sub-part, with every other part done, your head pushed with the gate green and each question\'s default implemented: return status "blocked" with ok=true and the run continues with the defaults, carrying the questions; any other block is ok=false. The user\'s answer comes back on a re-run of this same workstream.'
// A brief conflict is the user's call: fixers escalate it, validators route it to questions, never to the fix loop.
const ESCALATE = 'A finding that can only be fixed by breaking another clause of the brief (editing a file or test the brief protects, dropping a mandated call) or by reversing a fix verified earlier in this run, or whose substance is that the brief contradicts the repo: do not pick a side and leave the code; answer it "escalated" with status still done (not blocked), and return a question with both options, the default keeping the current behaviour and tests. Start each such question with the finding id (e.g. "c1-F2: ...").'
const CONFLICT = 'Only a contradiction between the brief and the repo itself (a premise the history disproves, or two brief clauses that cannot both hold) goes to questions instead of findings: both options, the default keeping the current behaviour and tests. A real defect is always a finding, even in code or tests the brief protects or where its fix would reverse a fix verified earlier; the fixer escalates it.'
const CLAUSES = 'Judge each fix against the brief\'s hard clauses as well as its finding: a fix that removes a call the brief mandates, edits or deletes a file the brief says not to edit, or deletes or weakens a test an earlier stage verified as guarding a fix stays open as a regression unless the user answered a question allowing it. Accept (verified) an answer escalated as a brief conflict when no fix keeps every clause.'
const GONE = ids => ids.length ? `\n\nDropped by the user, not on this branch: ${ids.join(', ')}; its absence is never a finding.` : ''
const LADDER = 'Ladder-first (reuse > stdlib > native > one line > minimum code), no speculative code, stay strictly in scope.'
const SEV_038 = 'Severity: critical = wrong behaviour, data loss, security, broken contract or red gate; major = real bug or design flaw; minor = the rest. Critical and major block the merge. Report only real issues; an empty list means clean.'
// explicit severities no stop rule or acceptance table lowers
const KEEP = 'Checks these instructions rate explicitly (hygiene, test integrity, smoke, checks) keep that severity, a broken wire contract between repos stays critical, and a break between workstreams (kind integration) stays major.'
const SEV = A.stopRule ? `Stop rule: critical or major only for a regression (behaviour that works at the base branch, or worked before a fix made in this run, and breaks at this head) or a wrong action: ${A.stopRule}. Security and data loss stay critical. ${KEEP} A miss the base also has is a known gap: minor, whatever its kind. Critical and major block the merge. Report only real issues; an empty list means clean.` : SEV_038
const STOP_FIX = A.stopRule ? 'Stop rule in force: a minor that is a known gap (the base has the same miss): decline it as "known gap"; never add a word list, pattern or matcher branch for it.\n' : ''
const ACC_READ = A.acceptance ? `Acceptance table (user-approved, binding): ${A.acceptance}. Read it before you change code; your change must satisfy every row that touches it. File missing or unreadable: stop with status "blocked" and say so in notes.\n` : ''
const ACC_REVIEW = A.acceptance ? `Acceptance table: ${A.acceptance} (read it). Rate a finding critical or major only if it breaks a row of the acceptance table or is a regression vs the base branch${A.stopRule ? ' or is a wrong action under the stop rule' : ''}; anything else is minor (this overrides the severity definitions below). The known-gap exemption never covers a row. Security, data loss and a red gate stay critical. ${KEEP}\n` : ''
const ACC_RUN = sha => A.acceptance ? `Acceptance table: ${A.acceptance}. Before judging anything else, run every row of the acceptance table that this change touches, black-box, at ${sha}: the row's input against the public interface, compared to its expected action. A failing row is a finding (kind bug, severity major, evidence = the row and the output). A failing row is major even when the base fails it too. The known-gap exemption never covers a row. ${A.decisionLog ? 'A decision-log line never waives a row; only a changed table does. ' : ''}File missing or unreadable: a critical finding (kind question).\n` : ''
const DROP = 'Drop (do not downgrade): issues that predate the diff and are not made worse by it, anything the repo\'s linter/formatter catches, code the plan or brief explicitly allows, pure style with no correctness, safety or maintainability cost. A comment added in this diff is a claim to grill, never a reason to drop a finding; do not flag `shortcut:` comments themselves.'
const EVIDENCE = 'A critical or major of kind bug, regression or integration with evidence "none" and not resolved at this head: reproduce it here. Reproduced: keep it blocking with your evidence; otherwise return it still open with the same id, demoted to minor. Design, question and overengineering kinds are exempt.'
const LENSES = grill => `Lenses:
1. Correctness: each finding names file:line plus the input or state that breaks it — bugs, edge cases, error handling, data loss, contract breaks, missing or weak tests.
   Test cheats are bugs: special-casing test inputs or expected values, always-true __eq__/comparison overloads, hidden state (call counters), test-environment detection.
${grill ? '2. Grilling: stress-test each design decision in the diff; raise one as kind "question" only when you can name the concrete failure you fear. The author must answer it defensibly or change it.\n' : ''}${grill ? 3 : 2}. Over-engineering: reinvented stdlib/helpers, speculative abstractions, dead flexibility, options nobody asked for — say what to DELETE (kind "overengineering").`
const asGlob = f => f.endsWith('/') ? f + '**' : f
const pathspec = (ps, magic = 'glob') => ps.map(p => `':(${magic})${asGlob(p)}'`).join(' ')
// fixing: in a fix step a blocker whose fix lies outside files[] is answered "carried", never a block
const SHARED = (c, files, fixing) => [
  files && `Edit only these paths: ${files.join(', ')}. ${fixing ? 'A critical or major whose fix needs anything else is answered "carried" (see above).' : 'Needing anything else is status "blocked" with a question.'}`,
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
    command: { type: 'string', description: 'the exact gate command(s) you executed at this head in this step; empty if you ran none' },
    flaky: { type: 'array', items: { type: 'string' }, description: 'test ids intermittent on head that also failed at the base; empty if none' },
  },
  required: ['green', 'summary', 'command', 'flaky'],
}
const FINDINGS = { type: 'object', properties: { headSha: HEAD, findings: { type: 'array', items: FINDING } }, required: ['headSha', 'findings'] }
const SEAMS = { ...FINDINGS, properties: { ...FINDINGS.properties, seams: { type: 'string', description: 'one line per seam intersection; "none" if no change crosses a workstream' } }, required: [...FINDINGS.required, 'seams'] }
const QUESTION = {
  type: 'object',
  properties: { q: { type: 'string' }, options: { type: 'array', items: { type: 'string' } }, default: { type: 'string', description: 'the default must keep every pre-existing test unchanged and stay within the brief; offer a test edit only as a non-default option.' } },
  required: ['q', 'options', 'default'],
}
const PUSHED = {
  type: 'object',
  properties: {
    status: { enum: ['done', 'blocked', 'needs_context', 'failed'] },
    ok: { type: 'boolean', description: 'gate green AND pushed AND ls-remote verified' },
    sha: { type: 'string', pattern: '^([0-9a-f]{40})?$', description: 'full 40-hex remote SHA verified via git ls-remote; empty if nothing was pushed' },
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
// the implement step may find an earlier attempt already done; the merge always pushes, so it keeps PUSHED
const ALREADY = { type: 'boolean', description: 'true when the validated head was already an ancestor of the feature branch: success, nothing merged again' }
const IMPLEMENTED = { ...PUSHED, properties: { ...PUSHED.properties, alreadyMerged: ALREADY, sha: { type: 'string', pattern: '^([0-9a-f]{40})?$', description: `full 40-hex remote SHA verified via git ls-remote; nothing to change: the current ${O} branch head` }, ok: { type: 'boolean', description: 'gate green AND pushed AND ls-remote verified; nothing to change: gate green, no push' } } }
// the merge also reports where it landed, so a lone workstream merged onto an untouched base can skip the seam review
const MERGED = { ...PUSHED, properties: { ...PUSHED.properties, alreadyMerged: ALREADY, preMergeSha: { type: 'string', description: 'the feature-branch tip your pushed merge commit sits on (its first parent)' }, baseAtMerge: { type: 'string', description: `git rev-parse ${O}/<base> after your last fetch` } }, required: [...PUSHED.required, 'preMergeSha', 'baseAtMerge'] }
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
          action: { enum: ['fixed', 'answered', 'declined', 'escalated', 'carried'] },
          note: { type: 'string', description: 'what changed (name the red-verified test) or why not' },
        },
        required: ['id', 'action', 'note'],
      },
    },
    settles: { type: 'array', items: { type: 'string' }, description: 'ids of the listed open questions this fix settled (took an option other than the default, or made the question moot); empty if none' },
  },
  required: [...PUSHED.required, 'answers'],
}
const DELTA = {
  type: 'object',
  properties: {
    headSha: HEAD,
    gate: GATE_OUT,
    evidence: { type: 'string', description: 'one short line per numbered step: the commands you ran for it, or "not run"' },
    verified: { type: 'array', items: { type: 'string' }, description: 'finding ids confirmed resolved, or whose answer or decline you accept' },
    open: { type: 'array', items: FINDING, description: 'unresolved findings, indefensible answers, and new regressions' },
    questions: { type: 'array', items: QUESTION, description: 'brief conflicts for the user; empty if none' },
  },
  required: ['headSha', 'gate', 'evidence', 'verified', 'open', 'questions'],
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
const RECHECK = { ...VERDICT, properties: { ...VERDICT.properties, verified: { type: 'array', items: { type: 'string' }, description: 'finding ids confirmed resolved, or whose answer or decline you accept' }, questions: DELTA.properties.questions }, required: [...VERDICT.required, 'verified', 'questions'] }
// built per call, so a run without checks keeps byte-identical schemas
const withChecks = (schema, n) => n ? { ...schema, properties: { ...schema.properties, checkExits: { type: 'array', items: { type: 'integer' }, minItems: n, maxItems: n, description: 'exit code of each check, in the order listed; 124 = timed out' } }, required: [...schema.required, 'checkExits'] } : schema
const CONTRACT = {
  type: 'object',
  properties: { verdict: { enum: ['pass', 'fail'] }, sections: { type: 'string', description: 'one short line per section' }, findings: { type: 'array', items: FINDING } },
  required: ['verdict', 'sections', 'findings'],
}
// resume: what git says each workstream branch is, read live before any stage
const STATE = { type: 'object', properties: { featureSha: { type: 'string', description: 'full SHA of the remote feature branch' }, workstreams: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, head: { type: 'string', description: 'full SHA of the remote workstream branch; empty if it does not exist' }, merged: { type: 'boolean', description: 'head is non-empty and an ancestor of the feature branch' } }, required: ['id', 'head', 'merged'] } } }, required: ['featureSha', 'workstreams'] }
const DRIFT_OUT = { type: 'object', properties: { ok: { type: 'boolean', description: 'false if you could not read the decision log or a repo' }, notes: { type: 'array', items: { type: 'string' } }, sections: { type: 'string' }, drift: { type: 'array', items: { type: 'object', properties: { repo: { type: 'string' }, where: { type: 'string' }, change: { type: 'string' } }, required: ['repo', 'where', 'change'] } } }, required: ['ok', 'notes', 'sections', 'drift'] }
const PROMOTED = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', description: 'the feature branch now points at the promoted SHA, ls-remote verified' },
    sha: { type: 'string', description: 'remote SHA of the feature branch after this step (git ls-remote)' },
    notes: { type: 'array', items: { type: 'string' }, description: 'every step not done and why (a side branch you could not delete included); empty when all steps succeeded' },
  },
  required: ['ok', 'sha', 'notes'],
}
const DOCS_OUT = {
  type: 'object',
  properties: {
    baseSha: { type: 'string', description: `${O} feature-branch SHA you started from` },
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
const mergeShas = {} // workstream id -> the feature-branch tip its latest merge pushed, for workstreams ordered after it
const sharedFound = Object.fromEntries(Object.entries(CF_REPOS).filter(([, x]) => x.shared?.length).map(([repo, x]) => [repo, x.shared.map(prior)])) // repo -> findings of the shared-edits checks, fixed in the whole-branch fix rounds; a resume starts from the resumed result's
const landedHere = {} // repo -> a merge landed in this call, so a kept whole-branch pass no longer covers its tip
// humanCheck: a repo's checks are asked together, in the one pause after its merges finish; merges never wait on a check.
// repo -> {workstream id -> why its check is open}; an "ok" deletes the entry, and an open entry pauses the repo's whole-branch pass
const humanOpen = {}
const openCheck = (w, why) => { (humanOpen[w.repo] ||= {})[w.id] = why }
const reopen = (w, why) => { if (humanOpen[w.repo]?.[w.id] != null) humanOpen[w.repo][w.id] = why } // a check whose fix stopped or crashed stays open, with the reason
const humanPending = [] // the result's humanCheck block
const owners = ws => ws.map(x => `${x.id}${x.files ? ` (${x.files.join(', ')})` : ' (no files[] declared)'}`).join('; ')
const serialized = (repo, fn) => (lock[repo] = (lock[repo] || Promise.resolve()).then(fn, fn)) // workstreams of one repo merge one at a time
const blocking = f => f.severity !== 'minor' || (!!f.also && f.also.severity !== 'minor') // an absorbed blocker keeps its entry blocking
// The result's findings ledger: each id keeps the stage that first raised it, its latest text, and a status
// (open until a validator verifies the fix, answer or decline; a red gate counts fixed once the next gate is green).
const STATUS = ['fixed', 'declined', 'answered', 'carried'] // an escalated finding stays open: it is the user's call; carried = handed to the whole-branch pass
const track = (book, stage, fs) => { for (const f of fs) { const e = book.find(x => x.id === f.id); const n = { id: f.id, stage: e?.stage || stage, severity: f.severity, kind: f.kind, where: f.where, issue: f.issue, status: 'open' }; e ? Object.assign(e, n) : book.push(n) } }
const settle = (book, id, action) => { const e = book.find(x => x.id === id); if (e) e.status = STATUS.includes(action) ? action : 'open' }
const settleGate = (book, gate) => { if (gate.green) for (const e of book) if (e.where === 'gate' && e.status === 'open') e.status = 'fixed' }
const asLedger = (stage, fs = []) => { const b = []; track(b, stage, fs); return b }
// SHA checks compare what two different agents reported. The script can't run git, so this catches
// inconsistency between agents (a moved tip, a stale read), not one agent lying about both sides.
const hex = s => /^[0-9a-f]{7,40}$/.test(s)
const same = (a = '', b = '') => hex(a) && hex(b) && (a.startsWith(b) || b.startsWith(a))
// gate.green is the typed channel: a red gate is critical without relying on the model to file it.
const redGate = (r, id) => r.gate.green ? [] : [{ id, severity: 'critical', kind: 'regression', where: 'gate', issue: r.gate.summary, evidence: 'the validator\'s gate run' }]
// A blocker the validator neither verified nor re-opened stays open: silence is not a resolution.
// Gate findings are rebuilt by redGate from each gate run, so they are never kept here.
const unaccounted = (prior, verified, open) => prior.filter(f => blocking(f) && f.where !== 'gate' && !verified.includes(f.id) && !open.some(o => o.id === f.id))
// the first path:line (or path:from-to) in a finding's where; null for 'gate', 'merge' and other non-file wheres
const loc = f => { const m = f.where.match(/([^\s:,()]+):(\d+)(?:-(\d+))?/); return m && { file: m[1], from: +m[2], to: +(m[3] || m[2]) } }
const fileOf = f => loc(f)?.file || '' // churn ignores ''
// A dead agent is replaced by a fresh one of the same role that redoes the whole step, up to 2 replacements.
// The attempt number changes the prompt, so a resume can never hand back the dead attempt's cached result.
// A done+ok result without a full 40-hex sha would orphan a correct push: the next attempt only repairs the sha,
// and the script keeps the first full result (sharedEdits, questions, answers) with the repaired sha and both attempts' notes. anySha: the caller never reads the sha.
// gated: the prompt carries a gate, so a gate with no command or a "skipped" summary never ran: a dead attempt, never kept as bad.
// The script can't see tool calls; command turns a silent skip into an explicit claim.
// An accepted escalation is the user's call: if no fixer question names its id, one is made from the finding, so it always reaches the user.
const names = (q, id) => new RegExp(`^\\W*${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(q)
const askEscalated = (fs, fix) => fs.flatMap(f => { const a = fix.answers.find(x => x.id === f.id && x.action === 'escalated'); return a && !(fix.questions || []).some(q => names(q.q, f.id)) ? [{ q: `${f.id} (${f.where}: ${f.issue}) was escalated by the fixer: ${a.note}. How should it be resolved?`, options: ['keep the current code and tests', 'change the brief or spec so a fix is clear (say how)'], default: 'keep the current code and tests' }] : [] })
const SETTLES = 'If a change you make takes an option other than a question\'s default, or settles it so the user no longer needs to answer, return its id in settles and say what you did in notes.'
// drops from w.questions the listed questions whose id a validated fix returned in settles; returns their texts
const dropSettled = (w, asked, ids = []) => { const qs = asked.filter(q => ids.includes(q.id)).map(q => q.q); if (qs.length) w.questions = w.questions.filter(q => !qs.includes(q.q)); return qs }
const softOf = {} // workstream id -> its soft-block questions, for the whole-branch fixer
const UNRUN = /^\W*(skip(ped)?|not run|none|n\/?a)\b/i // a prefix: "skipped: clean review" never ran; "OK (skipped=1)" did
const unran = {} // label -> attempts that returned without running the gate, for the caller's escalation
// After a step's first replacement dies, one cheap probe tells a dead environment (expired auth, no tool access) from a dead agent:
// a failed probe ends the step as a resumable infra fault instead of a third blind retry.
const infra = {} // label -> the health probe failed
const HEALTH = { type: 'object', properties: { ok: { type: 'boolean', description: 'true if the command ran' }, notes: { type: 'string' } }, required: ['ok', 'notes'] }
const healthy = async o => !!(await agent(`Health check: run git --version in a shell and return ok=true with its output in notes. Change nothing. ${HARD}`, { label: `health ${o.label}`, phase: o.phase, model: 'sonnet', effort: 'low', schema: HEALTH }))?.ok
// checks: how many checks the prompt carries; the schema asks for their exits, and in a gated step a missing or short checkExits never ran
async function step(prompt, { gated, checks = 0, ...opts }, anySha = false) {
  opts.schema = withChecks(opts.schema, checks)
  let bad = null, skipped = false
  unran[opts.label] = 0
  for (let n = 1; n <= 3; n++) {
    const tail = bad
      ? `the previous attempt finished and returned the result below, but its sha ${JSON.stringify(bad.sha)} is not a full 40-hex SHA. Do not redo the work: git ls-remote the branch you were told to push to and return the same result with the verified sha.\n${JSON.stringify(bad)}`
      : skipped ? `the previous attempt returned without running the gate${checks ? ' or every check' : ''}; redo the whole step, run every command, and report the command you ran in gate.command`
      : 'the previous agent died mid-step. Redo the whole step; first check the remote for anything it already pushed.'
    const r = await agent((n === 1 ? prompt : `${prompt}\n\nAttempt ${n}: ${tail}`) + STEP, n === 1 ? opts : { ...opts, label: `${opts.label} attempt ${n}` })
    const malformed = !anySha && r?.status === 'done' && r.ok && !/^[0-9a-f]{40}$/.test(r.sha)
    const unrun = gated && r?.gate && (!r.gate.command?.trim() || UNRUN.test(r.gate.command) || UNRUN.test(r.gate.summary) || (checks && !(Array.isArray(r.checkExits) && r.checkExits.length === checks && r.checkExits.every(Number.isInteger))))
    if (r && !malformed && !unrun) return bad && r.status === 'done' && r.ok ? { ...bad, sha: r.sha, notes: [...(bad.notes || []), ...(r.notes || [])] } : r
    if (unrun) unran[opts.label]++
    else bad ??= r // the first full result is the one kept and repaired
    skipped = !!unrun
    log(`${opts.label}: ${unrun ? `returned without running the gate (summary ${JSON.stringify(r.gate.summary)})` : r ? `returned a malformed sha ${JSON.stringify(r.sha)}` : 'agent died'} (attempt ${n} of 3)`)
    if (!r && n === 2 && !await healthy(opts)) { infra[opts.label] = true; log(`${opts.label}: health probe failed, stopping as an infra fault`); return null }
  }
  return null
}
// why a gated step returned null, for its escalation
const INFRA = what => `${what} died twice and the health probe failed (auth or tool access): an infra fault, not the work; fix it, then re-run with resumeFromRunId, resume and carryForward = this result's carryForward`
const died = (what, label) => infra[label] ? INFRA(what) : !unran[label] ? `${what} died 3 times` : `${what} ${unran[label] === 3 ? 'never ran its gate' : 'died or never ran its gate'} in 3 attempts`
const unusable = (what, branch, label) => infra[label] ? `${INFRA(what)}; check ${O}/${branch} for an unvalidated push` : `${what} returned no usable result 3 times (died or malformed sha); check ${O}/${branch} for an unvalidated push`
// Whole-branch fixes and docs land on side branches; a feature branch only fast-forwards to a SHA a validator passed.
// Returns '' once promoted, else why not (the side branches stay and the feature branch stays where it was).
// A promote that landed but left a step undone (a side-branch delete denied) records its notes per repo for the result.
const leftovers = {}
async function promote(repo, branch, from, to, sides, label, phase) {
  const p = await step(
    `Promote a validated commit in ${repo}: fast-forward ${branch} from ${from} to ${to}.
${NOT_FEATURE}
1. git -C ${repo} fetch ${O}. If ls-remote already shows ${to}, an earlier attempt pushed it: go to step 3. Otherwise git -C ${repo} ls-remote ${O} refs/heads/${branch} must equal ${from}, and git -C ${repo} merge-base --is-ancestor ${from} ${to} must succeed. Otherwise push nothing: ok=false, the reason in notes.
2. git -C ${repo} push ${O} ${to}:refs/heads/${branch} (plain push, never --force; a rejected push is ok=false), then verify git ls-remote shows ${to}.
3. Only after a verified push: git -C ${repo} push ${O} --delete ${sides.join(' ')} (a side branch that is already gone is fine).
No worktree, no checkout, no commits; never touch the user's checkout of ${repo}. ${HARD}
Return ok, the remote sha of ${branch} and notes (every step not done and why; empty when all succeeded).`,
    { label, phase, agentType: 'implementer', model: 'sonnet', effort: 'low', schema: PROMOTED })
  if (!(p?.ok && same(p.sha, to))) return p ? p.notes.join('; ') || `${branch} is at ${p.sha}` : died('promote agent', label)
  leftovers[repo] = [...(leftovers[repo] || []), ...p.notes.map(x => `${label}: ${x}`)]
  return ''
}

// reviewSharedEdits: the merge agent writes no tests, so its shared-file commits get their own gate and validator
// before the next merge lands on top of them; findings join the repo's whole-branch fix rounds.
async function checkShared(w, m, edits, k) {
  const c = repoMap[w.repo].conf
  const label = `${w.id} shared check m${k}`
  const S = `S-${w.id}-m${k}` // k = this workstream's merge round, so a re-merge never reuses the label or ids
  const range = `${m.preMergeSha}..${m.sha}`
  const v = await step(
    `Validate the shared-file edits the merge applied for workstream ${w.id} in ${w.repo}, on ${w.featureBranch} at ${m.sha}: git fetch ${O}, then only the commits git log --first-parent --no-merges ${range} lists (the shared-edits commit and any regen commit after the merge commit), their diff against that merge commit. The merge step that wrote them writes no tests. ${REFUTE}
Sections (verdict per section):
1. Each edit against its intent, and nothing beyond these: ${JSON.stringify(edits)}. A generated file must equal what the repo's own tooling produces${c.regen ? ` (${c.regen})` : ''}.
2. Run the gate and report gate {green, summary, command, flaky}. ${WRAPPED}:
${GATE_CMD(w.gate)}
${GREEN(c.knownRed, w.repo)} ${FLAKY}
3. ${HYGIENE(range, w.repo)}
${RO(w.repo, `shared-${w.id}`)}
${SEV}
sha = the commit you validated. Ids: ${S}-F1, ${S}-F2, ...`,
    { label, phase: 'Merge', agentType: 'validator', model: 'opus', effort: 'high', schema: VERDICT, gated: true })
  const fs = v && same(v.sha, m.sha) ? [...v.findings, ...redGate(v, `${S}-G`)] : [{ id: `${S}-X`, severity: 'critical', kind: 'regression', where: `shared edits of ${w.id}`, issue: `${range} is unchecked: ${v ? `the shared-edits validator saw ${v.sha}, the merge pushed ${m.sha}` : died('shared-edits validator', label)}`, evidence: 'the script\'s own check' }]
  if (v) noteFlaky(w.repo, v)
  ;(sharedFound[w.repo] ||= []).push(...fs)
}

// ---- one workstream: implement -> cycles -> merge --------------------------
async function runWorkstream(w) {
  const tag = w.id
  const c = repoMap[w.repo].conf
  const out = { id: w.id, branch: w.branch, status: '', sha: '', validatedSha: '', cyclesRun: 0, extended: false, findingsFixed: 0, open: [], sharedEdits: [], questions: [], notes: [], escalations: [], tests: '', gateTail: '', merged: false, preMergeSha: '', baseAtMerge: '', evidence: {}, findings: [], handed: [] }
  const book = out.findings
  const decisions = [] // the author's reasoning, handed to every later reviewer and fixer
  const ledger = [] // settled findings: never re-raised unless the code under them changed
  // a resume restores what git cannot say: the ledger (settled entries stay settled for the reviewers) and the findings handed to the whole-branch pass
  const cf = CF_WS[w.id]
  if (cf) {
    book.push(...cf.findings)
    ledger.push(...book.filter(e => STATUS.includes(e.status)).map(({ id, where, issue, status }) => ({ id, where, issue, status })))
    out.handed.push(...cf.handed)
  }
  // blockers open when the resumed call stopped: a restarted review re-checks them, and only a validator clears them
  const reopened = (cf?.findings || []).filter(e => e.status === 'open' && e.severity !== 'minor').map(({ id, severity, kind, where, issue }) => ({ id, severity, kind, where, issue, evidence: 'open when the resumed run stopped' }))
  let authored = [] // the last author's or fixer's checkExits, for the false-green label
  const softQs = softOf[w.id] = [] // soft-block questions (optional, run continued on the default): a later validated fix that acts on one settles it
  const absorb = r => {
    authored = r.checkExits
    out.sharedEdits = r.sharedEdits // each author returns the complete current list
    out.questions.push(...r.questions)
    if (soft(r)) softQs.push(...r.questions)
    out.notes.push(...r.notes)
    decisions.push(...r.decisions)
    Object.assign(out, { status: soft(r) ? 'done' : r.status, tests: r.tests, gateTail: r.gateTail })
  }
  const stop = why => {
    // merged earlier: a human-check problem whose fix did not land; the first merge stays on the feature branch
    out.escalations.push(`${why}; ${out.merged ? `the fix NOT merged (its earlier merge is on ${w.featureBranch})` : 'NOT merged'}`)
    log(`${tag}: NOT merged after ${out.cyclesRun} cycle(s): ${why}`)
    reopen(w, `${w.id} stopped before its human check passed: ${why}`)
    return out
  }
  // a block carries its question as a decision the user answers on the re-run (decisions.<id>), which resumes this same workstream
  const blocked = (what, r) => {
    if (r.status === 'blocked' && r.questions.length) out.decision = { questions: r.questions, answer: `re-run with the same args, resumeFromRunId = this run, resume = this run's id, carryForward = this result's carryForward, and decisions.${w.id} = "<the user's answer>"` }
    return stop(`${what} ${r.status}: ${r.tests}`)
  }
  // blocked only on an optional sub-part, with a green, pushed head that takes the defaults: continue, carrying the question
  const soft = r => r.status === 'blocked' && r.ok && /^[0-9a-f]{40}$/.test(r.sha) && r.questions.length > 0
  const pushed = (r, what) => { if (soft(r)) out.notes.push(`${what} blocked only on an optional question; continued with its default, the question is carried`); return r.ok && (r.status === 'done' || soft(r)) }
  // A seam blocker in a merged workstream's files is this author's to fix; files of workstreams not merged yet never are.
  const integration = () => {
    const done = mergedInto[w.repo] || []
    const pending = W.filter(x => x.repo === w.repo && x !== w && !done.includes(x) && !(dependsOn(x, w.id) && x.files?.some(f => w.files?.some(g => overlaps(f, g)))))
    return done.length
      ? `Integration fix: if a critical or major can only be fixed in files owned by workstreams already merged into ${w.featureBranch} — ${owners(done)} — first git merge ${O}/${w.featureBranch} into your branch, then fix those files too (the one exception to your file list; say so in notes). The exception covers their code and the tests they added in this run, which are not pre-existing, never a test that is already on ${O}/${w.base} and the brief does not name (git show ${O}/${w.base}:<path> has it): that test stays read-only, and a blocker whose only fix is in one is ${w.files ? 'answered "carried"' : 'status "blocked" with a question'}.${pending.length ? ` Never touch files owned by workstreams not merged yet: ${owners(pending)}.` : ''}`
      : `No workstream has merged into ${w.featureBranch} yet; a blocker outside your files is ${w.files ? 'answered "carried" (see above)' : 'status "blocked" with a question'}.`
  }
  // read-only = on the run's base; a test a sibling added in this run is its owner's code. No files[]: only merged siblings' declared files are guarded
  const roGuard = () => {
    const sibs = (mergedInto[w.repo] || []).filter(x => x.files)
    const where = w.files ? `outside this workstream's files (${w.files.join(', ')})` : sibs.length && `in the files of ${owners(sibs)}`
    return where ? ` Read-only unless the brief names it: any test already on ${O}/${w.base} (git show ${O}/${w.base}:<path> has it) ${where}; editing one is a major regression, whatever the brief seems to justify.` : ''
  }
  const authorGate = () => w.quickGate ? GATE(w.quickGate, c.knownRed, w.repo, true) : GATE(w.gate, c.knownRed, w.repo)
  // The first validator of a workstream writes black-box acceptance tests from the brief before it reads the diff.
  let acceptance = true
  const accept = sha => {
    if (!acceptance) return ''
    acceptance = false
    return `0. Before you read the diff: from the brief's acceptance criteria alone, write 2-5 black-box tests against the public interface in your worktree and run them at ${sha}; never commit or push them. A failing one is a finding (kind bug) with the test and its output as evidence, the reproducer. If the brief says no behaviour change, instead run the same inputs at git merge-base ${O}/${w.featureBranch} ${sha} and at ${sha} (check each out inside your worktree) and diff the outputs; any difference is a finding.\n`
  }
  const fullGuard = sha => `Test integrity also covers the whole workstream range: run that check over ${O}/${w.featureBranch}...${sha} (git diff --diff-filter=MDR --name-only ${O}/${w.featureBranch}...${sha} on test paths), not only the delta; a weakened pre-existing test there is a finding, even when the brief protects that file. Everything else in this step judges the delta only.`
  const reasons = () => decisions.length ? `\nThe author's recorded decisions — form your findings from the diff and brief first, then read these; don't grill one whose why is sound:\n${JSON.stringify(decisions)}\n` : ''

  let carry = [] // open findings handed to the next review
  let rejected = null // a rejected merge goes back to the author once, as an integration critical
  const given = [].concat(HUMAN[w.id] ?? []) // the user's answers, earliest first
  const used = new Set() // indexes of the answers applied in this call
  const told = [] // the answers applied so far, in order
  let seeded = false
  // A check binds to this workstream's own validated head, never the feature tip, so a re-merge with no new commit and a carried merge
  // find their answer; round counts the answers applied, across calls: at this call's first check, every answer before the last one
  // bound to the head was spent by an earlier call (all of them when none is bound to it, as on a new head). True: nothing more runs here (no check, ok, or the pause).
  // False: the user's problem goes to this workstream's fix path, like a rejected merge, then it merges and is checked again.
  const checked = at => {
    if (!w.humanCheck) return true
    const head = out.validatedSha, where = `${w.featureBranch} @ ${at || 'its tip'}`
    if (!seeded) {
      seeded = true
      const last = given.findLastIndex(a => same(a.sha, head))
      for (let j = 0; j < (last < 0 ? given.length : last); j++) { used.add(j); told.push({ sha: given[j].sha, answer: given[j].answer }) }
    }
    const n = told.length + 1
    const k = given.findIndex((a, j) => !used.has(j) && same(a.sha, head))
    if (k < 0) {
      const ask = JSON.stringify([...told, { sha: head, answer: '<ok, or the problem in words>' }])
      humanPending.push({ id: w.id, repo: w.repo, featureBranch: w.featureBranch, sha: head, checkAt: at || `${O}/${w.featureBranch}`, check: w.humanCheck, round: n, answer: `re-run with the same args, resumeFromRunId = this run, resume = this run's id, carryForward = this result's carryForward, and humanChecks.${w.id} = ${ask}` })
      openCheck(w, `awaiting the user's human check ${n} of ${w.id} (${where}, workstream head ${head})`)
      log(`${tag}: merged; paused for the user's human check ${n}`)
      return true
    }
    used.add(k)
    const said = given[k].answer
    told.push({ sha: head, answer: said })
    if (/^ok\W*$/i.test(said.trim())) { delete humanOpen[w.repo]?.[w.id]; return true }
    openCheck(w, `${w.id}: the fix of human check ${n} is not merged`)
    rejected = { id: `H${n}-F1`, severity: 'critical', kind: 'bug', where: `human check ${n}`, issue: `The user checked ${where} by eye (${w.humanCheck}) and reports: ${said}. Fix it on ${w.branch}; git merge ${O}/${w.featureBranch} into your branch first if the problem needs the merged state.`, evidence: 'the user\'s answer' }
    track(book, 'human', [rejected])
    carry = [...carry, rejected]
    log(`${tag}: human check ${n} failed, returned to the author`)
    return false
  }
  // Already on the feature branch (the resume's git probe, or the implement step finding it merged): success, no stage re-runs.
  const carried = (head, at) => {
    Object.assign(out, { status: 'done', sha: head, validatedSha: head, merged: true, open: [...(cf?.open || [])] }) // its carried minors ride to the whole-branch pass again
    const done = (mergedInto[w.repo] ||= [])
    if (!done.includes(w)) done.push(w)
    mergeShas[w.id] = head
    out.notes.push(`already merged into ${w.featureBranch} at ${head}: carried as merged, no stage re-run`)
    log(`${tag}: already merged, carried`)
    return checked(at)
  }
  const prior = RESUMED[w.id]
  if (prior?.merged && /^[0-9a-f]{40}$/.test(prior.head)) {
    if (DROPPED.has(w.id)) out.escalations.push(`dropped, but already merged into ${w.featureBranch}: it stays on the branch`)
    if (carried(prior.head, prior.featureSha)) return out
  }
  else {
  const impl = await step(
    `You are the author of workstream ${w.id} in ${w.repo}.
Set up: worktree ${w.id} on a new branch ${w.branch} from ${O}/${w.featureBranch}.${w.after ? ` This workstream is ordered after ${w.after.join(', ')}: fetch first; ${O}/${w.featureBranch} must contain their merges (git merge-base --is-ancestor <sha> ${O}/${w.featureBranch} for each of ${w.after.map(id => mergeShas[id]).join(', ')}), else stop with status "blocked".` : ''} If ${O}/${w.branch} already exists from an earlier attempt and is not yet merged into ${O}/${w.featureBranch}, continue from it instead; if it is already merged (git merge-base --is-ancestor ${O}/${w.branch} ${O}/${w.featureBranch}), that is success, not a block: change nothing, status "done", ok = true, sha = its head, alreadyMerged = true.

Brief:
${w.brief}

${ACC_READ}${LADDER} Test-first where behaviour changes.
${RO_TESTS}
${SHARED(c, w.files)}
${authorGate()}
${CHECKS(w)}${GIT(w.repo, w.id)}
Commit and push to ${w.branch}. Nothing to change (the branch already meets the brief and the gate is green): no commit, no push, status "done", sha = the current ${O}/${w.branch} head, ok = true.
Return status ("done" only when the gate is green and the push verified, or nothing to change), ok, the verified remote sha, a one-line test summary, gateTail, sharedEdits, decisions (up to 10), questions and notes.`,
    { label: `${tag} implement`, phase: 'Implement', agentType: 'implementer', model: w.model, schema: IMPLEMENTED, checks: w.checks?.length })
  if (!impl) return stop(unusable('implement', w.branch, `${tag} implement`))
  absorb(impl)
  if (!pushed(impl, 'implement')) return blocked('implement', impl)
  if (impl.alreadyMerged) { if (carried(impl.sha, '')) return out }
  else { out.sha = impl.sha; carry = reopened }
  }

  const tries = [] // blockers that survived a fix round: {id, where, rounds, answers}
  // same id, or same where; every red-gate finding has where 'gate', so that sentinel never matches by where (as in unaccounted)
  const sameFinding = (a, b) => a.id === b.id || (a.where !== 'gate' && a.where === b.where)
  const triesOf = f => tries.find(t => sameFinding(t, f))
  let landings = 0 // merges of this workstream that landed
  // the shared-edits check, the human check and workstreams ordered after this one read the merge's sha
  const readsMergeSha = !!(c.reviewSharedEdits || w.humanCheck || W.some(x => x.after?.includes(w.id)))
  for (let from = 1; ; from = out.cyclesRun + 1) {
    for (let i = from; i <= CAP; i++) {
      if (short(`${tag} cycle ${i}`)) return stop(`token budget below the ${RESERVE} reserve before cycle ${i}; resume with resumeFromRunId, resume and carryForward = this result's carryForward`)
      // a merge rejection goes straight to the fix: the head under it is unchanged and already reviewed
      // lite: no reviews; the clean-review validator below is the one check, and its blockers go straight to the fix
      const rev = (rejected && i === from) || w.lite ? { headSha: out.sha, findings: carry } : await step(
        `Review workstream ${w.id}: git -C ${w.repo} fetch ${O}, then the diff ${O}/${w.featureBranch}...${out.sha} (branch ${w.branch}).
${RO(w.repo, `${w.id}-rev${i}`, c.regen)}

The brief it implements:
${w.brief}
The author's notes and questions are not shown to you: never claim what they say.
${reasons()}
${LENSES(i === 1)}
${ACC_REVIEW}${DROP}
${w.quickGate ? `Probes: to confirm a suspicion by running code, use the quick gate (${w.quickGate}) or single tests; the full gate is the validators' job.\n` : ''}${ledger.length ? `Settled in earlier cycles — do not re-raise unless the code under it changed:\n${JSON.stringify(ledger)}\n` : ''}${carry.length ? `The last validation left these open — re-check each, keep the ones still valid (same id):\n${JSON.stringify(carry)}\n` : ''}${SEV}
New finding ids: c${i}-F1, c${i}-F2, ...`,
        { label: `${tag} review c${i}`, phase: 'Review cycles', agentType: 'reviewer', model: w.reviewModel, schema: FINDINGS })
      if (!rev) return stop(died(`review c${i}`, `${tag} review c${i}`))
      if (!same(rev.headSha, out.sha)) return stop(`review c${i} saw ${rev.headSha}, the author pushed ${out.sha}`)
      out.cyclesRun = i
      track(book, 'review', rev.findings)
      // Clean needs both: nothing blocking in this review AND nothing blocking left by the last validation.
      // Only a validator can clear a carried critical/major; a reviewer that drops one doesn't.
      let found = [...rev.findings, ...carry.filter(f => blocking(f) && !rev.findings.some(g => g.id === f.id))]

      if (!found.some(blocking)) {
        if (same(out.validatedSha, out.sha)) { carry = found; break } // converged on a validated head; minors carried, not cycled
        // A clean review is a claim: a head no validator has seen gets one independent pass before it can merge.
        const val = judged(await step(
          `Independently validate workstream ${w.id} in ${w.repo} before it merges: git fetch${FETCH}, then ${O}/${w.featureBranch}...${out.sha}. ${w.lite ? 'Lite workstream: no review runs, so you are its only independent check.' : 'The review came back clean, but no validator has seen this head.'}
The brief:
${w.brief}

${accept(out.sha)}${ACC_RUN(out.sha)}1. Check every acceptance criterion of the brief against the code and a command you ran. ${MERGE_EDITS(c.hot, out.sharedEdits)}${REFUTE} ${CONFLICT}
2. Prove the new tests: revert the production hunks in your worktree, they must go red; restore them, green. ${TEST_GUARD}${roGuard()}
3. Run the gate and report gate {green, summary, command, flaky}. ${WRAPPED}:
${GATE_CMD(w.gate)}
${GREEN(c.knownRed, w.repo)} ${FLAKY}
4. ${TRIAL(w)}
${CHECKS(w)}${RO(w.repo, `${w.id}-val${i}`, c.regen)}
${SEV}
Return headSha, gate, evidence, verified (empty), open (ids v${i}-F1, ...) and questions.`,
          { label: `${tag} validate c${i}`, phase: 'Review cycles', agentType: 'validator', model: 'opus', effort: 'high', schema: DELTA, gated: true, checks: w.checks?.length }), w, authored)
        if (!val) return stop(died(`validate c${i}`, `${tag} validate c${i}`))
        if (!same(val.headSha, out.sha)) return stop(`validate c${i} saw ${val.headSha}, the head is ${out.sha}`)
        out.evidence[`validate c${i}`] = val.evidence
        out.questions.push(...(val.questions || []))
        noteFlaky(w.repo, val)
        const raised = [...val.open, ...redGate(val, `v${i}-G`)]
        track(book, 'validate', raised)
        found = [...found, ...raised]
        out.validatedSha = out.sha
        if (!found.some(blocking)) { carry = found; break }
        // the validator's blockers go straight to this cycle's fix: re-reviewing the unchanged SHA wastes the cycle
      }
      {
        const prev = out.sha
        // A blocker that survived two fix rounds gets one opus fix with the earlier attempts.
        const stuck = found.filter(blocking).map(f => ({ f, t: triesOf(f) })).filter(x => x.t?.rounds.size >= 2)
        const asked = softQs.filter(q => out.questions.includes(q)).map((q, k) => ({ id: `Q${k + 1}`, ...q })) // still open, so the user is never asked about done work
        const fix = await step(
          `You are the author of workstream ${w.id} (${w.repo}, branch ${w.branch}). Review cycle ${i} findings:
${JSON.stringify(found)}
${stuck.map(({ f, t }) => `${f.id}: a prior fixer attempted this ${t.rounds.size} times: ${t.answers.join(' | ')}. Those attempts did not hold: find the root cause rather than repeat them; if no fix can hold, say why in the answer.\n`).join('')}${decisions.length ? `Your earlier reasoning:\n${JSON.stringify(decisions)}\n` : ''}${asked.length ? `Optional questions this workstream raised earlier (it continued on their defaults), still open for the user:\n${JSON.stringify(asked)}\n${SETTLES}\n` : ''}
Set up: worktree ${w.id}-fix${i}, detached at ${O}/${w.branch} (expected ${prev}; if it moved, an earlier attempt of this step pushed it: continue from it); push back to ${w.branch}.
Critical and major: fix bugs with a test you ran RED before the fix and green after; answer every kind "question" with a defensible reason or a change; delete what the over-engineering findings say to delete.
${ESCALATE}
${ACC_READ}${STOP_FIX}${RO_TESTS}
Minor: fix only if it is a one-liner inside your files, otherwise decline with a reason — declining is a valid outcome.
Keep fixes minimal and inside this workstream's files.
${w.files ? 'A critical or major whose only fix lies outside the files you may edit (a pre-existing test, or a file the integration-fix exception below does not give you): change nothing for it and answer it "carried" (not blocked, not escalated), naming that file in the note; once the validator agrees, the whole-branch pass fixes it and it leaves your cycles.\n' : ''}Nothing to change (all answered, declined or escalated): no commit, no push, sha = the current ${O}/${w.branch} head (${prev} unless an earlier attempt moved it), ok = true.
${SHARED(c, w.files, true)}
${integration()}
sharedEdits: return the complete current list; it replaces the earlier one${out.sharedEdits.length ? `, so keep every entry still needed from:\n${JSON.stringify(out.sharedEdits)}` : ''}.
${authorGate()}
${CHECKS(w)}${GIT(w.repo, `${w.id}-fix${i}`)}
Return status, ok, verified sha, tests, gateTail, one answer per finding id, sharedEdits, decisions (new or changed only), questions (only what code, spec and brief cannot settle; use action "escalated") and notes.`,
          { label: `${tag} fix c${i}`, phase: 'Review cycles', agentType: 'implementer', model: stuck.length ? 'opus' : w.model, schema: FIXED, checks: w.checks?.length })
        if (!fix) return stop(unusable(`fix c${i}`, w.branch, `${tag} fix c${i}`))
        absorb(fix)
        if (!pushed(fix, `fix c${i}`)) return blocked(`fix c${i}`, fix)
        // a claimed fix outside files[] is the whole-branch pass's once this cycle's validator verifies the claim; a rejected one stays in the cycles
        const claimed = w.files ? found.filter(f => blocking(f) && fix.answers.some(a => a.id === f.id && a.action === 'carried')) : []
        const allowed = [...new Set([...(w.files || []), ...(mergedInto[w.repo] || []).flatMap(x => x.files || [])])].join(', ')
        out.sha = fix.sha

        const first = acceptance // the workstream's first validator: its test guard covers the whole range
        const val = judged(await step(
          `Independently validate the review-fix delta of workstream ${w.id} in ${w.repo}: git fetch${FETCH}, then ${prev}..${fix.sha} on ${w.branch}. Trust nothing the author claims.
The brief:
${w.brief}
${accept(fix.sha)}${ACC_RUN(fix.sha)}${same(prev, fix.sha) ? 'No delta: skip the delta hunt and judge the answers and declines; still run the gate, the test-integrity check and the trial merge at this head.\n' : ''}If the fixer merged ${O}/${w.featureBranch} (an integration fix), skip the merged-in side: judge git diff ${O}/${w.featureBranch}...${fix.sha}, and don't re-hunt sibling code already validated.
Findings with the author's claimed resolutions — judge the code first, then read each claim:
${JSON.stringify(found.map(f => ({ ...f, claim: fix.answers.find(a => a.id === f.id) || 'no answer' })))}
${out.handed.length ? `Handed to the whole-branch pass (their fix is outside this workstream's files; not yours to judge, never re-file them): ${out.handed.map(f => f.id).join(', ')}\n` : ''}${ledger.length ? `Verified in earlier cycles (a fix that undoes one is a regression unless escalated): ${JSON.stringify(ledger)}\n` : ''}
1. ${REFUTE} Where a test is claimed, it must fail at ${prev}, the pre-fix head: run it there in a second worktree at ${w.repo}/.claude/worktrees/${w.id}-val${i}-red (same rules: clear a leftover path first, remove it when done; never mktemp), and green at ${fix.sha}. Reverting the fix hunks in your worktree is the fallback only when that cannot run; state the fallback in evidence. Judge each answer to a question and each declined minor: defensible or not. ${CLAUSES} ${CONFLICT} ${MERGE_EDITS(c.hot, out.sharedEdits)}${EVIDENCE}${claimed.length ? ` A claim "carried" holds only when its fix cannot be made inside the files this workstream may edit (${allowed}): return the id in verified if so, otherwise in open. A pre-existing test the brief does not name is read-only, so it counts as outside them. Pre-existing means on ${O}/${w.base}: a test a merged sibling added in this run does not count. Once you verify a "carried" claim, the whole-branch pass fixes that finding in any file, pre-existing tests included (except a file a brief names as not to be edited); that needs no question. If you still ask one about it, start it with the finding's id (e.g. "${claimed[0].id}: ..."): it is dropped once that fix is verified.` : ''}
2. Hunt regressions the fixes introduced (they routinely plant new bugs: data loss, broken callers, weakened tests). ${TEST_GUARD}${roGuard()}${first ? ` ${fullGuard(fix.sha)}` : ''}
3. Run the gate and report gate {green, summary, command, flaky}. ${WRAPPED}:
${GATE_CMD(w.gate)}
${GREEN(c.knownRed, w.repo)} ${FLAKY}
4. ${TRIAL(w)}
${CHECKS(w)}${RO(w.repo, `${w.id}-val${i}`, c.regen)}
${SEV}
Return headSha, gate, evidence, verified (ids confirmed resolved, or whose answer or decline you accept), open (same id for an unresolved finding; unresolved, indefensible, plus regressions as kind "regression" with ids v${i}-R1, ...) and questions.`,
          { label: `${tag} validate c${i}`, phase: 'Review cycles', agentType: 'validator', model: 'opus', effort: 'high', schema: DELTA, gated: true, checks: w.checks?.length }), w, authored)
        if (!val) return stop(died(`validate c${i}`, `${tag} validate c${i}`))
        if (!same(val.headSha, fix.sha)) return stop(`validate c${i} saw ${val.headSha}, the fix pushed ${fix.sha}`)
        out.evidence[`validate c${i} delta`] = val.evidence
        out.questions.push(...(val.questions || []))
        noteFlaky(w.repo, val)
        const handed = claimed.filter(f => val.verified.includes(f.id))
        out.handed.push(...handed)
        out.findingsFixed += val.verified.filter(id => !['escalated', 'carried'].includes(fix.answers.find(a => a.id === id)?.action)).length
        out.questions.push(...askEscalated(found.filter(f => val.verified.includes(f.id)), fix))
        for (const f of found)
          if (val.verified.includes(f.id)) {
            const status = fix.answers.find(a => a.id === f.id)?.action || 'fixed'
            ledger.push({ id: f.id, where: f.where, issue: f.issue, status })
            settle(book, f.id, status)
          }
        settleGate(book, val.gate)
        carry = [...val.open, ...redGate(val, `v${i}-G`), ...unaccounted(found, val.verified, val.open)].filter(f => !out.handed.some(h => h.id === f.id))
        track(book, 'validate', carry)
        out.validatedSha = fix.sha
        // a settle counts once the validator left nothing blocking; otherwise the question is offered to the next fixer
        if (!carry.some(blocking)) out.notes.push(...dropSettled(out, asked, fix.settles).map(q => `fix c${i} settled the open question: ${q}`))
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
          out.questions.push({ q: `${spent.f.id} (${spent.f.where}: ${spent.f.issue}) is still open after ${spent.t.rounds.size} fix rounds, the last on opus. Attempts: ${spent.t.answers.join(' | ')}. How should it be resolved?`, options: ['change the brief or spec so a fix is clear (say how)', 'accept it as known debt', `drop this workstream (re-run with dropped: ["${w.id}"]; the rest merges and it is listed as not done)`], default: 'change the brief or spec so a fix is clear (say how)' })
          return stop(`${spent.f.id} survived ${spent.t.rounds.size} fix rounds, the last on opus; returned to the user as a question`)
        }
      }

      const open = carry.some(blocking)
      if (CYCLES != null && i >= CYCLES && !open) break // named count reached and nothing critical or major left
      if (w.lite && !open) break // lite: a validated head with nothing blocking needs no further cycle
      if (CYCLES != null && i >= CYCLES) out.extended = true // floor, not permission to merge dirty work
    }
    out.open = carry
    if (carry.some(blocking)) return stop(`critical/major findings still open after ${out.cyclesRun} cycle(s) (cap ${CAP})`)
    if (!same(out.validatedSha, out.sha)) return stop('the head was never validated')

    const merge = await serialized(w.repo, async () => {
      const done = (mergedInto[w.repo] ||= [])
      // allowed = own files plus those of workstreams already merged (integration fixes); empty hot list or no files[] = no check
      const allowed = w.files && [...new Set([...w.files, ...done.flatMap(x => x.files || [])])]
      const diff = `git diff --name-only ${O}/${w.featureBranch}...${out.validatedSha} --`
      const backstop = [c.hot.length && `${diff} ${pathspec(c.hot)}`, allowed && `${diff} . ${pathspec(allowed, 'glob,exclude')}`].filter(Boolean)
      const m = await step(
        `Merge workstream ${w.id} into feature branch ${w.featureBranch} in ${w.repo}, then apply its shared-file edits.
${NOT_FEATURE}
Set up: worktree merge-${w.id}, detached at ${O}/${w.featureBranch} (fetch first).
1. git ls-remote ${O} refs/heads/${w.branch} must equal ${out.validatedSha}, the validated head, or descend from it only through commits already on ${O}/${w.featureBranch} (the run's own integration-fix or shared-files commits: git log --oneline ${out.validatedSha}..<that head> --not ${O}/${w.featureBranch} prints nothing); otherwise ok=false, status "failed".
If ${out.validatedSha} is already an ancestor of ${O}/${w.featureBranch} (git merge-base --is-ancestor), it is merged, never a failure ("Already up to date"): skip steps 2 and 3, apply in step 4 only the edits the branch does not carry yet, and return status "done", ok = true, alreadyMerged = true, sha = the ${w.featureBranch} head you leave (pushed or unchanged).
2. ${backstop.length ? `Backstop: ${backstop.join(' and ')} must each print nothing. Otherwise ok=false, status "failed", the offending paths in notes.` : 'No backstop paths for this repo.'}
3. git merge --no-ff ${out.validatedSha} -m "Merge ${w.branch} into ${w.featureBranch}". On conflict: git merge --abort, remove the worktree, ok=false, status "failed", the conflicting files in notes.
4. ${out.sharedEdits.length ? `Apply these shared-file edits on top of the merge, keeping what earlier merges put in those files${out.merged ? ' (this workstream merged before: skip an edit the branch already carries)' : ''} (a generated file is regenerated with the repo's own tooling, never hand-merged); one commit "${c.commitPrefix}Update shared files for ${w.id}":\n${JSON.stringify(out.sharedEdits)}` : 'No shared-file edits.'}
5. ${c.regen ? `Regenerate generated files: ${c.regen}\nCommit any change as "${c.commitPrefix}Regenerate generated files".` : 'No regen recipe for this repo.'}
${GATE(w.gate, c.knownRed, w.repo)}
Red gate: do not push, return ok=false with the failure.
${HYGIENE(`${O}/${w.featureBranch}..HEAD`, w.repo)}
${GIT(w.repo, `merge-${w.id}`)}
Push to ${w.featureBranch} (plain push; if rejected, fetch and redo every step on the new tip). Return status, ok, verified sha, tests, gateTail, notes, preMergeSha (git rev-parse of your pushed merge commit's first parent, the ${w.featureBranch} tip it landed on) and baseAtMerge (git rev-parse ${O}/${w.base} after your last fetch); sharedEdits, decisions and questions empty.`,
        { label: `${tag} merge`, phase: 'Merge', agentType: 'implementer', model: 'sonnet', effort: out.sharedEdits.length ? 'medium' : 'low', schema: MERGED }, !readsMergeSha) // a malformed sha gets the repair call only when a later step reads it
      if (m?.ok && m.status === 'done') {
        if (!done.includes(w)) done.push(w)
        mergeShas[w.id] = m.sha
        landedHere[w.repo] = true
        landings++
        if (c.reviewSharedEdits && out.sharedEdits.length) await checkShared(w, m, out.sharedEdits, landings)
      }
      return m
    })
    if (!merge && infra[`${tag} merge`]) return stop(`${INFRA('merge')}; check the head of ${O}/${w.featureBranch} before re-running`)
    if (!merge) return stop(readsMergeSha ? `merge returned no usable result 3 times (died or malformed sha); it may have landed: check the head of ${O}/${w.featureBranch} before re-running` : `merge agent died 3 times; check ${O}/${w.featureBranch} for an unvalidated push`)
    out.notes.push(...merge.notes)
    const landed = merge.ok && merge.status === 'done'
    out.merged ||= landed
    if (landed) {
      Object.assign(out, { preMergeSha: merge.preMergeSha || '', baseAtMerge: merge.baseAtMerge || '' })
      if (checked(merge.sha)) break
      continue
    }
    const why = merge.notes.join('; ') || merge.tests
    if (rejected || out.cyclesRun >= CAP) return stop(`merge failed: ${why}`)
    rejected = { id: 'M-F1', severity: 'critical', kind: 'integration', where: 'merge', issue: `The merge into ${w.featureBranch} rejected ${out.validatedSha}: ${why}. For a conflict or a red gate on the merged tip, git merge ${O}/${w.featureBranch} into your branch first, then resolve.`, evidence: 'the merge agent\'s report' }
    track(book, 'merge', [rejected])
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
  const gone = mine.filter(w => w.dropped).map(w => w.id)
  const gates = [...new Set(r.ws.filter(w => !gone.includes(w.id)).map(w => w.gate))].join('\n')
  const briefs = r.ws.filter(w => !gone.includes(w.id)).map(w => `## ${w.id}\n${w.brief}`).join('\n\n') + GONE(gone)
  const range = `${O}/${r.base}...${O}/${r.featureBranch}`
  const top = ms => MODELS[Math.max(...ms.map(m => MODELS.indexOf(m)))]
  const res = { repo: r.repo, featureBranch: r.featureBranch, sha: '', verdict: 'skipped', sections: 'no workstream merged', seams: '', tests: '', fixRounds: 0, churn: [], open: [], questions: [], notes: [], escalations: [], findings: [] }
  const book = res.findings
  const shared = sharedFound[r.repo] || []
  track(book, 'shared-edits', shared)
  const pause = Object.values(humanOpen[r.repo] || {}).join('; ')
  if (pause) return { ...res, verdict: 'paused', sections: pause, open: shared, escalations: [`whole-branch pass not run: ${pause}`] }
  if (!mine.some(w => w.merged)) return res
  // never a pass on a partial branch: the whole-branch pass runs once every planned workstream of the repo is on it
  const unmerged = mine.filter(w => !w.merged && !w.dropped).map(w => w.id)
  if (unmerged.length && STAGE !== 'wholeBranch') return { ...res, verdict: 'incomplete', sections: `not run: ${unmerged.join(', ')} not merged into ${r.featureBranch}`, open: shared, escalations: [`whole-branch pass not run: planned workstream(s) ${unmerged.join(', ')} not merged; settle them, then re-run with resumeFromRunId, resume and carryForward = this result's carryForward (merged workstreams are carried from git)`] }
  // the resumed call already passed this repo's whole-branch pass and its feature branch has not moved since: keep that result
  const kept = CF_REPOS[r.repo]?.passed
  if (kept && STAGE !== 'wholeBranch' && !landedHere[r.repo] && same(kept.sha, featureShaOf[r.repo]))
    return { ...kept, notes: [...(kept.notes || []), `whole-branch pass kept from the resumed run: ${r.featureBranch} is unchanged at ${kept.sha}`] }
  let findings = [...shared] // what fail() reports if the whole-branch agents die
  // A validator finding whose first path:line (or path:from-to) in where overlaps a reviewer finding's in the same file joins it:
  // the fixer and rechecks see one entry, the other finding whole under also. Both hunts stay independent; a where with no path:line never collapses.
  const alsoOf = {} // kept id -> the finding it absorbed
  const rank = f => FINDING.properties.severity.enum.indexOf(f.severity)
  const sameLines = (a, b) => !!(a && b) && a.file === b.file && a.from <= b.to && b.from <= a.to
  const collapse = (ws, vs) => {
    const out = [...ws]
    for (const v of vs) {
      const i = out.findIndex(f => ws.includes(f) && sameLines(loc(f), loc(v))) // each reviewer entry pairs once
      if (i < 0) { out.push(v); continue }
      const [keep, { id, severity, kind, where, issue, evidence }] = rank(v) < rank(out[i]) ? [v, out[i]] : [out[i], v]
      out[i] = { ...keep, also: alsoOf[keep.id] = { id, severity, kind, where, issue, evidence } }
    }
    return out
  }
  // Whole-branch fixes push to side branches; the feature branch fast-forwards to the last checked head only after a passing recheck.
  let checked = ''
  const sides = []
  const fail = why => { Object.assign(res, { verdict: 'fail', open: findings }); res.escalations.push(sides.length ? `${why}; whole-branch fixes left unpromoted on ${sides.at(-1)}, ${r.featureBranch} unchanged` : why); return res }
  const merged = mine.filter(w => w.merged)
  // minors carried from the merged workstreams' cycles; ids prefixed so two workstreams' c1-F1 stay apart
  const carried = merged.flatMap(w => w.open.map(f => ({ ...f, id: `${w.id}:${f.id}` })))
  // blockers a workstream handed over because their fix lies outside its files: this pass fixes them
  const handed = merged.flatMap(w => (w.handed || []).map(f => ({ ...f, id: `${w.id}:${f.id}` })))
  track(book, 'handed', handed)
  findings.push(...handed)
  // one workstream merged onto a feature branch still at its base has no seam: the validator alone covers the branch
  // findings the workstream cycles settled: a whole-branch finding that would reverse one is a question
  const fixedIn = (b, pre = '') => b.filter(e => e.status === 'fixed' && e.where !== 'gate').map(e => ({ id: pre + e.id, where: e.where, issue: e.issue }))
  const SETTLED = recheck => {
    const fixed = [...merged.flatMap(w => fixedIn(w.findings || [], `${w.id}:`)), ...fixedIn(book)]
    const asked = [...new Set([...merged.flatMap(w => w.questions || []), ...res.questions].map(q => q.q))]
    return `${fixed.length ? ` Fixes verified earlier in this run (a finding whose fix would reverse one: file it and name it; the fixer escalates): ${JSON.stringify(fixed)}` : ''}${asked.length ? ` Already asked of the user, never re-ask: ${JSON.stringify(asked)}` : ''}${handed.length ? ` Handed findings (${handed.map(h => `${h.id} (${h.where})`).join(', ')}) are this pass's to fix in any file, pre-existing tests included, except a file a brief names as not to be edited: ${recheck ? 'the hard-clause rule stands for it' : "that one is not this pass's to edit"}. An open question about a handed finding never holds its fix.${recheck ? ' For an assertion such a fix changes, the handed finding is the reason the test-integrity check asks for; its other checks still apply.' : ''}` : ''}`
  }
  const solo = merged.length === 1 && same(merged[0].preMergeSha, merged[0].baseAtMerge)
  // the merged tip re-runs the checks of every merged workstream (a dropped one already merged stays on the branch), each command once
  const onTip = merged.map(w => byId[w.id])
  const tip = { checks: [...new Set(onTip.flatMap(w => w.checks || []))], knownRedChecks: [...new Set(onTip.flatMap(w => w.knownRedChecks || []))] }
  const softAsked = merged.flatMap(w => (softOf[w.id] || []).filter(q => w.questions.includes(q)).map((q, k) => ({ w, id: `${w.id}:Q${k + 1}`, q: q.q, options: q.options, default: q.default })))
  let wbSettles = [] // the last fix round's settles: it counts only once the pass ends clean and promoted

  const [rev, val] = await parallel([
    async () => solo ? { findings: [], seams: `skipped: ${merged[0].id} is the only workstream and merged onto ${r.featureBranch} at its base; no seam to check` } : step(
      `Integrated review of ${r.repo}: git fetch${FETCH}, then the whole feature-branch diff ${range}. All workstreams are merged; hunt the cross-workstream seams the per-workstream reviews could not see.
${RO(r.repo, 'wb-rev')}

Briefs:
${briefs}

Seam inventory first: for each workstream merge commit M (git log --first-parent --merges --format='%H %s' ${range.replace('...', '..')}; the subject names the workstream branch), git diff M^1 M and list what it changed at its edges: signatures, fields, config/env keys, defaults, enum values, error shapes. Grep for their use sites in the other workstreams' diffs. Return each intersection as its own line in seams (producer change -> use site -> compatible or not); an incompatible one is also a finding of kind "integration"; a first-parent merge of the base or parent branch into this branch is an up-merge: use it as a producer only and file nothing inside it when its diff lies outside the review range; any other merge whose diff lies inside the review range is reviewable code, whoever authored it.

${LENSES(false)}
${ACC_REVIEW}${DROP}
${SEV}
headSha = the ${O}/${r.featureBranch} commit you reviewed. Ids: W-F1, W-F2, ...`,
      { label: `${n} review`, phase: 'Whole-branch', agentType: 'reviewer', model: A.wbReviewModel || top(r.ws.map(w => w.reviewModel)), schema: SEAMS }),
    async () => judged(await step(
      `Independent whole-branch validation of ${r.repo}, feature branch ${r.featureBranch} vs ${O}/${r.base}. Trust nothing; re-derive everything yourself. ${REFUTE}
${ACC_RUN(`the head of ${O}/${r.featureBranch}`)}${RO(r.repo, 'wb-val')}
Sections (verdict per section):
1. ${HYGIENE(`${O}/${r.base}..${O}/${r.featureBranch}`, r.repo)}
2. Tests from scratch, every suite including Playwright/e2e; report gate {green, summary, command, flaky}. ${WRAPPED}:
${GATE_CMD(gates)}
${GREEN(c.knownRed, r.repo)} ${FLAKY}
3. Spec compliance point by point against the briefs below. ${TEST_GUARD} ${CONFLICT}${SETTLED()}${carried.length ? ` Minors carried from the workstream cycles: ${JSON.stringify(carried)}. Return in verified each carried id whose issue no longer holds at this head (e.g. a shared edit the merge applied); never re-file one in findings.` : ''}
4. Concurrency / writer audit where relevant.
5. ${SMOKE(c)}
${CHECKS(tip)}Cross-repo wire contracts are checked separately once every repo is final.

Briefs:
${briefs}

${SEV}
sha = the ${O}/${r.featureBranch} commit you validated. Ids: V-F1, V-F2, ...; questions for brief conflicts.`,
      { label: `${n} validate`, phase: 'Whole-branch', agentType: 'validator', model: 'opus', effort: 'high', schema: RECHECK, gated: true, checks: tip.checks.length }), tip),
  ])
  if (!rev || !val) return fail(!rev ? died('integrated review', `${n} review`) : died('whole-branch validator', `${n} validate`))
  if (!solo && !same(rev.headSha, val.sha)) return fail(`review saw ${rev.headSha}, validator saw ${val.sha}`)
  noteFlaky(r.repo, val)
  res.questions.push(...(val.questions || []))
  Object.assign(res, { sha: val.sha, verdict: val.verdict, sections: val.sections, tests: val.tests, seams: rev.seams })
  checked = val.sha
  track(book, 'wb-review', rev.findings)
  track(book, 'wb-validate', [...val.findings, ...redGate(val, 'V-G')])
  for (const w of mine.filter(w => w.merged)) for (const f of w.open) track(book, w.findings?.find(x => x.id === f.id)?.stage || 'review', [{ ...f, id: `${w.id}:${f.id}` }])
  // a carried minor this validator verified is settled; the rest ride along (declinable)
  const resolved = f => val.verified?.includes(f.id)
  for (const f of carried.filter(resolved)) settle(book, f.id, 'fixed')
  findings = [...collapse(rev.findings, val.findings), ...redGate(val, 'V-G'), ...carried.filter(f => !resolved(f)), ...shared, ...handed]

  for (let round = 1; round <= WB_ROUNDS && findings.some(blocking); round++) {
    if (short(`${n} whole-branch fix round ${round}`)) return fail(`token budget below the ${RESERVE} reserve before whole-branch fix round ${round}; resume with resumeFromRunId, resume and carryForward = this result's carryForward`)
    res.fixRounds = round
    const head = checked
    const side = `${r.featureBranch}--wbfix${round}`
    const asked = new Set(findings.map(fileOf).filter(Boolean)) // files this round's fix is asked to touch
    const fix = await step(
      `Whole-branch fix round ${round} on ${r.repo}, feature branch ${r.featureBranch}. Findings:
${JSON.stringify(findings)}
${ALSO(findings)}
${(x => x.length ? `Handed findings (${x.join(', ')}) are this pass's to fix in any file, pre-existing tests included (never escalated for that), unless a finding says a brief names that file as not to be edited: escalate that one.\n` : '')(handed.filter(h => findings.some(f => f.id === h.id)).map(h => h.id))}${softAsked.length ? `Optional questions the workstreams raised earlier (they continued on the defaults), still open for the user:\n${JSON.stringify(softAsked.map(({ w, ...q }) => q))}\n${SETTLES}\n` : ''}Set up: worktree wb-fix${round}, detached at ${head} (fetch first); push to the side branch ${side}, never to ${r.featureBranch}: it fast-forwards to your fix only after the recheck passes. If ${O}/${side} already exists and contains ${head}, an earlier attempt of this step pushed it: continue from it; if it does not contain ${head}, it is a leftover of an earlier run: delete it first (git push ${O} --delete ${side}).
Critical and major: resolve every one (red-verified tests for bug fixes; defensible answers to questions; delete what over-engineering findings name). ${ESCALATE}${STOP_FIX && ' ' + STOP_FIX.trim()} Minor, including those carried from the workstream cycles: fix only if it is a one-liner, otherwise decline with a reason. Minimal fixes.
Nothing to change (all answered, declined or escalated): no commit, no push, sha = ${head} (or the ${O}/${side} head if an earlier attempt pushed it), ok = true.
Never merge a workstream branch: an unmerged workstream is the coordinator's call. If you change the source of a generated file, ${c.regen ? `rerun: ${c.regen}` : 'regenerate it with the repo\'s own script'}.
${ACC_READ}${LADDER}
${GATE(gates, c.knownRed, r.repo)}
${GIT(r.repo, `wb-fix${round}`)}
In notes, list each file you changed as "changed: <path>".
Return status, ok, verified sha, tests, gateTail, one answer per finding id, questions and notes; sharedEdits and decisions empty.`,
      { label: `${n} fix r${round}`, phase: 'Whole-branch', agentType: 'implementer', model: top(r.ws.map(w => w.model)), schema: FIXED })
    if (!fix) return fail(unusable(`whole-branch fix r${round}`, side, `${n} fix r${round}`))
    res.questions.push(...fix.questions)
    res.notes.push(...fix.notes)
    if (!fix.ok || fix.status !== 'done') return fail(`whole-branch fix r${round} ${fix.status}: ${fix.tests}`)
    if (!same(head, fix.sha)) sides.push(side)
    wbSettles = fix.settles || []

    const re = judged(await step(
      `Re-check whole-branch fix round ${round} on ${r.repo}, feature branch ${r.featureBranch}: git fetch${FETCH}, then the delta ${head}..${fix.sha}. Trust nothing the author claims.
${ACC_RUN(fix.sha)}${same(head, fix.sha) ? 'No delta: skip the delta hunt and judge the answers and declines; still run every suite, the test-integrity check and hygiene at this head.\n' : ''}Findings with claimed resolutions — judge the code first, then read each claim:
${JSON.stringify(findings.map(f => ({ ...f, claim: fix.answers.find(a => a.id === f.id) || 'no answer' })))}
${ALSO(findings)}1. ${REFUTE} A claimed test must fail at ${head}, the pre-fix head: run it there in a second worktree at ${r.repo}/.claude/worktrees/wb-recheck${round}-red (same rules: clear a leftover path first, remove it when done; never mktemp), and green at ${fix.sha}. Reverting the fix hunks is the fallback only when that cannot run; state the fallback in evidence. Judge each answer and each declined minor. ${CLAUSES} ${EVIDENCE}
2. Hunt regressions the fixes introduced. ${TEST_GUARD} ${CONFLICT}${SETTLED(true)}${A.stopRule ? ' File each break a fix introduced as kind "regression", even when the base lacks the feature.' : ''}
3. Rerun every suite and report gate {green, summary, command, flaky}. ${WRAPPED}:
${GATE_CMD(gates)}
${GREEN(c.knownRed, r.repo)} ${FLAKY}
4. ${HYGIENE(`${head}..${fix.sha}`, r.repo)}
5. ${SMOKE(c)}
${CHECKS(tip)}${RO(r.repo, `wb-recheck${round}`)}
Briefs:
${briefs}

${SEV}
sha = the commit you checked. verdict pass only if nothing critical or major is open; verified = finding ids confirmed resolved, or whose answer or decline you accept; findings = everything still open (same id for a carried finding, new ids R${round}-F1, ...); questions for brief conflicts.`,
      { label: `${n} recheck r${round}`, phase: 'Whole-branch', agentType: 'validator', model: 'opus', effort: 'high', schema: RECHECK, gated: true, checks: tip.checks.length }), tip)
    if (!re) return fail(died(`recheck r${round}`, `${n} recheck r${round}`))
    if (!same(re.sha, fix.sha)) return fail(`recheck r${round} saw ${re.sha}, the fix pushed ${fix.sha}`)
    noteFlaky(r.repo, re)
    res.questions.push(...(re.questions || []))
    Object.assign(res, { verdict: re.verdict, sections: re.sections, tests: re.tests })
    checked = re.sha
    res.questions.push(...askEscalated(findings.filter(f => re.verified.includes(f.id)), fix))
    // churn: a new regression blocker in a file the fix was asked to touch; two rounds in a row stop the loop
    const hit = [...new Set(re.findings.filter(f => blocking(f) && f.kind === 'regression' && !findings.some(g => g.id === f.id || g.also?.id === f.id) && asked.has(fileOf(f))).map(fileOf))]
    if (hit.length) res.churn.push({ round, files: hit })
    const action = (...ids) => ids.map(id => fix.answers.find(a => a.id === id)?.action).find(Boolean) || 'fixed'
    for (const id of re.verified) settle(book, id, action(id))
    // an absorbed finding settles with its kept entry; if the recheck returned it open, track() below re-opens it
    for (const [id, a] of Object.entries(alsoOf)) if (re.verified.includes(id)) settle(book, a.id, action(a.id, id))
    settleGate(book, re.gate)
    findings = [...re.findings, ...redGate(re, `R${round}-G`), ...unaccounted(findings, re.verified, re.findings)]
    // a kept entry re-filed without its also gets it back while the absorbed one is open and not its own entry
    findings = findings.map(f => alsoOf[f.id] && !f.also && !findings.some(g => g.id === alsoOf[f.id].id) && book.find(e => e.id === alsoOf[f.id].id)?.status === 'open' ? { ...f, also: alsoOf[f.id] } : f)
    track(book, 'recheck', findings)
    // stops after findings are rebuilt, so fail() reports this recheck's open set
    if (hit.length && res.churn.at(-2)?.round === round - 1) {
      const stop = 'stop and simplify: one predicate with one owner, re-run stage wholeBranch'
      const pairs = res.churn.slice(-2).flatMap(c => c.files.map(f => [f, c.round]))
      const broke = [...new Set(pairs.map(([f]) => f))].map(f => `${f} (${pairs.filter(([g]) => g === f).map(([, k]) => `r${k}`).join(', ')})`).join(', ')
      res.questions.push({ q: `heuristic churn: fix rounds ${round - 1} and ${round} broke ${broke} again`, options: [stop, 'run more fix rounds'], default: stop })
      return fail(`heuristic churn: rounds ${round - 1}-${round} broke ${broke}`)
    }
  }
  res.open = findings
  const open = findings.filter(blocking)
  // no offer with an acceptance table (a failing row is filed as a plain major) or a stop rule (every open major is a regression,
  // a wrong action or an explicitly rated check); a red gate is a critical regression via redGate
  if (open.length && sides.length && !A.acceptance && !A.stopRule && !open.flatMap(f => [f, f.also || {}]).some(f => f.severity === 'critical' || f.kind === 'regression' || f.kind === 'integration'))
    res.questions.push({ q: `whole-branch fixes on ${sides.at(-1)} (checked head ${checked}, gate green) stay unpromoted with ${open.length} open major(s): ${open.map(f => `${f.severity} ${f.where}: ${f.issue}`).join('; ')}. Promote them as known gaps?`, options: ['leave unpromoted', `promote: fast-forward ${r.featureBranch} to ${checked} and park the open majors as known gaps`], default: 'leave unpromoted' })
  if (open.length) return fail(WB_ROUNDS ? `critical/major findings still open after ${res.fixRounds} whole-branch fix round(s)` : 'wbRounds 0: critical/major findings returned unfixed')
  if (sides.length) {
    const why = res.verdict !== 'pass' ? `the last recheck returned ${res.verdict}` : await promote(r.repo, r.featureBranch, res.sha, checked, sides, `${n} promote`, 'Whole-branch')
    if (why) return fail(`whole-branch fixes not promoted: ${why}`)
    res.sha = checked
  }
  for (const x of merged) res.notes.push(...dropSettled(x, softAsked.filter(q => q.w === x), wbSettles).map(q => `whole-branch fix r${res.fixRounds} settled the open question of ${x.id}: ${q}`))
  // a question that names a handed finding this pass fixed (recheck-verified, promoted) asks about done work
  for (const x of merged) for (const h of x.handed || []) {
    const id = `${x.id}:${h.id}`
    if (book.find(e => e.id === id)?.status !== 'fixed') continue
    const gone = [...x.questions.filter(q => names(q.q, h.id) || names(q.q, id)), ...res.questions.filter(q => names(q.q, id))]
    x.questions = x.questions.filter(q => !gone.includes(q))
    res.questions = res.questions.filter(q => !gone.includes(q))
    res.notes.push(...gone.map(q => `whole-branch fix r${res.fixRounds} fixed ${id}; dropped the question about it: ${q.q}`))
  }
  return res
}

// ---- wiring ---------------------------------------------------------------
log(`${STAGE === 'wholeBranch' ? 'whole-branch re-validation' : `${W.length} workstream(s)`} across ${REPOS.length} repo(s); cycles=${CYCLES ?? 'converge'} (hard cap ${CAP})`)
// resume: one read-only probe per repo rebuilds each workstream's state from git before any stage. Its prompt names the resumed run,
// this call's ordinal and a digest of this call's resume inputs, so a later resume of the same run never replays an earlier probe's state.
// shortcut: two calls with byte-identical args (a call that returned no result, re-run with the same carryForward) share a probe; a per-call nonce would fix it, if the tool ever gives one.
const RESUMED = {} // workstream id -> {head, merged, featureSha}
const featureShaOf = {} // repo -> its feature-branch head when the probe read it
// FNV-1a: a short, stable fingerprint; the script has no crypto
const digest = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193); return (h >>> 0).toString(16).padStart(8, '0') }
if (A.resume && STAGE !== 'wholeBranch') {
  if (!A.carryForward) log(`resume of ${A.resume} without carryForward: ledgers, handed and shared-edits findings and passed whole-branch passes of the resumed run are not restored`)
  const inputs = digest(JSON.stringify([HUMAN, DECIDE, CF]))
  const states = await parallel(REPOS.map(r => () => step(
    `Resume of run ${A.resume}, call ${CALL} (inputs ${inputs}): read the git state of ${r.repo}; change nothing. git -C ${r.repo} fetch ${O}; featureSha = git -C ${r.repo} rev-parse ${O}/${r.featureBranch}. For each workstream branch below: head = git -C ${r.repo} rev-parse ${O}/<branch> (empty if the branch does not exist on ${O}); merged = true only if head is non-empty and git -C ${r.repo} merge-base --is-ancestor <head> ${O}/${r.featureBranch} succeeds.
${r.ws.map(w => `${w.id}: ${w.branch}`).join('\n')}
No worktree, no checkout, no commits, no pushes; never touch the user's checkout. ${HARD}`,
    { label: `${name(r.repo)} state`, phase: 'Implement', model: 'sonnet', effort: 'low', schema: STATE }, true)))
  states.forEach((st, i) => {
    if (st) featureShaOf[REPOS[i].repo] = st.featureSha
    if (!st) return log(`${name(REPOS[i].repo)}: the resume state probe died; its workstreams start from implement, which carries a merged branch as merged`)
    for (const x of st.workstreams) if (byId[x.id]?.repo === REPOS[i].repo) RESUMED[x.id] = { ...x, featureSha: st.featureSha }
  })
}
const notRun = (w, why) => ({ id: w.id, branch: w.branch, merged: false, open: [], questions: [], notes: [], escalations: [why], findings: [] })
const dropOut = w => ({ ...notRun(w, `dropped by the user: NOT done; delete ${O}/${w.branch} if an earlier call pushed it`), dropped: true, status: 'dropped' })
// after: a workstream starts only once every listed one merged, so it branches from the head that carries them
const started = {}
const launch = w => started[w.id] ||= (DROPPED.has(w.id) && !(RESUMED[w.id]?.merged && /^[0-9a-f]{40}$/.test(RESUMED[w.id].head)) ? Promise.resolve(dropOut(w)) : w.after
  ? Promise.all(w.after.map(id => launch(byId[id]))).then(pre => { const missing = w.after.filter((_, i) => !pre[i].merged); return missing.length ? notRun(w, `ordered after ${missing.join(', ')}, which did not merge into ${w.featureBranch}; NOT started`) : runWorkstream(w) })
  : runWorkstream(w)).catch(e => { reopen(w, `${w.id} crashed`); return notRun(w, `crashed: ${e}`) })
const wsPromises = STAGE === 'wholeBranch'
  ? W.map(w => Promise.resolve(DROPPED.has(w.id) ? dropOut(w) : { id: w.id, merged: true, open: [] })) // already merged by an earlier run
  : W.map(w => launch(w))
// Each repo's whole-branch pass starts as soon as ITS workstreams finish (no global barrier).
const repoResults = await parallel(REPOS.map(r => async () => {
  const mine = await Promise.all(wsPromises.filter((_, i) => W[i].repo === r.repo))
  return runRepo(r, mine).catch(e => ({ repo: r.repo, featureBranch: r.featureBranch, sha: '', verdict: 'fail', sections: 'crashed', tests: '', fixRounds: 0, churn: [], open: [], questions: [], notes: [], escalations: [`crashed: ${e}`], findings: [] }))
}))
const wsResults = await Promise.all(wsPromises)
const dropped = wsResults.filter(w => w.dropped).map(w => w.id)

// Barrier: the contract check and docs need every repo final.
const skipped = new Set(repoResults.filter(r => r.verdict === 'skipped').map(r => r.repo))
const shipped = skipped.size < REPOS.length
const paused = repoResults.some(r => r.verdict === 'paused' || r.verdict === 'incomplete') // contracts, docs and the drift audit wait for the user's human check, or for every planned workstream
const PINS = repoResults.map(r => `${r.repo} @ ${r.featureBranch} = ${r.sha || `${O}/${repoMap[r.repo].base} (nothing merged)`}`).join('\n') + '\n' + STALE
const driftWanted = !!A.decisionLog && shipped && !paused
const driftShort = driftWanted && short('drift audit') // short last: it records a stop only when the audit would run
const driftRan = driftWanted && !driftShort
const [crossRepo, docs, driftOut] = await parallel([
  async () => REPOS.length < 2 || !shipped || paused ? null : short('contracts') ? { verdict: 'fail', sections: 'skipped: token budget below the reserve', findings: [] } : step(
    `Cross-repo wire-contract check, run once every repo is final. Pinned heads:
${PINS}
${RO('<repo>', 'contracts')}
Sections (verdict per section):
1. Every wire contract between these repos — HTTP/API payloads, events, shared schemas, vendored OpenAPI and its digest, env/config keys — field by field at the pinned SHAs: names, types, optionality, defaults, enum values, error shapes.
2. The merge order the contracts require (which repo's contract must land first) and every re-vendor or digest step still missing.
${SEV}
Ids: X-F1, X-F2, ...`,
    { label: 'contracts', phase: 'Contracts', agentType: 'validator', model: 'opus', effort: 'high', schema: CONTRACT })
    .then(x => x || { verdict: 'fail', sections: died('contract validator', 'contracts'), findings: [] }),
  () => parallel(DOCS.map(d => async () => {
    if (!shipped || paused || skipped.has(d.repo)) return null
    // docs build on the validated head only; a failed pass may have its fixes on a side branch
    const rs = repoResults.find(x => x.repo === d.repo)
    if (rs?.verdict === 'fail') return { sha: '', files: [], prBody: false, ok: false, tests: '', notes: ['skipped: the whole-branch pass failed; docs run with the passing re-run'] }
    if (short(`${name(d.repo)} docs`)) return { sha: '', files: [], prBody: false, ok: false, tests: '', notes: ['skipped: token budget below the reserve'] }
    const rr = repoMap[d.repo]
    const gate = rr ? [...new Set(rr.ws.filter(w => !dropped.includes(w.id)).map(w => w.gate))].join('\n') : d.gate
    const knownRed = conf(d.repo).knownRed
    const side = `${d.featureBranch}--docs`
    const o = await step(
      `Docs sync for ${d.repo}, branch ${d.featureBranch}. Docs must describe what SHIPPED, not what the author first wrote.
${NOT_FEATURE}
This repo's branch: ${d.featureBranch} vs ${O}/${d.base}. Read the whole diff of every feature branch below vs its base, INCLUDING every review-round fix:
${PINS}
Set up: worktree docs-sync, detached at ${O}/${d.featureBranch}; push to the side branch ${side}, never to ${d.featureBranch}: it fast-forwards to your commit only after a validator passes it. If ${O}/${side} already exists and contains ${O}/${d.featureBranch}, an earlier attempt of this step pushed it: continue from it; otherwise it is a leftover of an earlier run: delete it first (git push ${O} --delete ${side}).
1. Update in ${d.repo}: README / docs / runbooks (new or changed env vars with prod-required secrets first, endpoints, contract fields, defaults flipped in review, deleted scaffolding, behaviour changed for existing clients); design/spec docs if this repo holds them (rows whose box, trigger or status moved).
2. ${A.localOnly ? 'Local-only run: no PR exists and gh never runs; skip this step.' : `If a PR already exists for ${d.featureBranch} (gh pr view), update its body (placement table, test plan, claims the fixes made false) with gh pr edit — never create a PR.`}
3. Knowledge graph, if graphify-out/ exists: graphify update . (add --force if the branch deleted files; never --update or semantic mode); reset line 1 of graphify-out/GRAPH_REPORT.md to the repo name (never a worktree name); drop manifest changes that are mtime-only; commit only graph.json, GRAPH_REPORT.md, manifest.json and .graphify_labels.json as "${conf(d.repo).commitPrefix}Refresh the knowledge graph". No graphify-out/: skip.
4. ${gate ? `${GATE(gate, knownRed, d.repo)}\nRun it after the graph refresh. Red gate: do not push, ok=false.` : 'No gate for this repo.'}
5. Before pushing: ${HYGIENE(`${O}/${d.featureBranch}..HEAD`, d.repo)}
Nothing stale and the graph unchanged: no commit, empty sha, ok=true.
${GIT(d.repo, 'docs-sync')}`,
      { label: `${name(d.repo)} docs`, phase: 'Docs sync', agentType: 'implementer', model: 'sonnet', schema: DOCS_OUT })
    if (!o || !o.sha) return o
    if (rs && !same(o.baseSha, rs.sha)) return { ...o, verdict: 'fail', findings: [{ id: 'D-X', severity: 'critical', kind: 'docs', where: o.sha, issue: `docs started from ${o.baseSha}, but the whole-branch pass validated ${rs.sha}`, evidence: 'the script\'s own check' }] }
    // The docs commit becomes the repo's finalSha only once its own read-only validator passes it.
    const v = await step(
      `Validate the docs-sync commits on ${d.repo}, branch ${d.featureBranch}: git fetch${FETCH}, then ${o.baseSha}..${o.sha} on the side branch ${side}. They land after every other check: on a pass they are fast-forwarded onto ${d.featureBranch} and become its head. ${REFUTE}
Sections (verdict per section):
1. Every changed doc line against the code it describes, at these pinned heads:
${PINS}
2. Knowledge graph, if touched: GRAPH_REPORT.md line 1 is the repo name; only the four graphify files are committed.
3. ${HYGIENE(`${o.baseSha}..${o.sha}`, d.repo)}
4. ${gate ? `Run the gate and report gate {green, summary, command, flaky}. ${WRAPPED}:\n${GATE_CMD(gate)}\n${GREEN(knownRed, d.repo)} ${FLAKY}` : 'No gate: gate {green: true, summary: "no gate", command: "", flaky: []}.'}
${RO(d.repo, 'docs-val')}
${SEV}
sha = the commit you validated. Ids: D-F1, D-F2, ...`,
      { label: `${name(d.repo)} docs validate`, phase: 'Docs sync', agentType: 'validator', model: 'opus', effort: 'high', schema: VERDICT, gated: !!gate })
    noteFlaky(d.repo, v)
    const vOk = v && same(v.sha, o.sha)
    const findings = vOk ? [...v.findings, ...redGate(v, 'D-G')] : [{ id: 'D-X', severity: 'critical', kind: 'docs', where: o.sha, issue: v ? `docs validator saw ${v.sha}, docs pushed ${o.sha}` : died('docs validator', `${name(d.repo)} docs validate`), evidence: 'the script\'s own check' }]
    if (!vOk || v.verdict !== 'pass' || findings.some(blocking)) return { ...o, verdict: 'fail', findings }
    const why = await promote(d.repo, d.featureBranch, o.baseSha, o.sha, [side], `${name(d.repo)} docs promote`, 'Docs sync')
    return { ...o, verdict: why ? 'fail' : 'pass', findings: why ? [...findings, { id: 'D-P', severity: 'critical', kind: 'docs', where: side, issue: `validated docs not promoted to ${d.featureBranch}: ${why}`, evidence: 'the promote step' }] : findings }
  })),
  async () => driftRan ? step(
    `Drift audit, read-only: find every user-visible change that no decision-log line and no brief clause covers.
${PINS}
${REPOS.map(r => `${r.repo}: base ${O}/${r.base}`).join('\n')}
${W.filter(w => !dropped.includes(w.id)).map(w => `## ${w.id}\n${w.brief}`).join('\n\n')}${GONE(dropped)}
Read the decision log ${A.decisionLog}. For each repo, list every user-visible change in ${O}/<base>...<pinned sha> (copy, spoken or printed lines, defaults, prompts, thresholds, UI, removed hints or options). Map each one to a decision-log line or a brief clause. Return in drift only the changes with neither.
If you cannot read the decision log or a repo: ok=false, the reason in notes; still list what you could check.
${RO(REPOS[0].repo, 'drift')}`,
    { label: 'drift', phase: 'Drift audit', agentType: 'reviewer', model: 'fable', schema: DRIFT_OUT }) : null,
])
// a failed audit's items are kept as unconfirmed, never questions: with the log unread every change looks undecided, and each item's default is a revert
const drift = !driftRan ? { verdict: 'skipped', items: [], unconfirmed: [], sections: '', notes: driftShort ? ['token budget below the reserve'] : [] }
  : !driftOut ? { verdict: 'died', items: [], unconfirmed: [], sections: '', notes: [died('drift agent', 'drift')] }
  : { verdict: !driftOut.ok ? 'failed' : driftOut.drift.length ? 'drift' : 'pass', items: driftOut.ok ? driftOut.drift : [], unconfirmed: driftOut.ok ? [] : driftOut.drift, sections: driftOut.sections, notes: driftOut.notes }

const brief = f => `${f.severity} ${f.where}: ${f.issue}${f.also ? ` (+ ${f.also.severity} ${f.also.id} at ${f.also.where})` : ""}`
const uniq = xs => [...new Set(xs)]
const uniqQ = qs => qs.filter((q, i) => qs.findIndex(x => x.q === q.q) === i)
const docsOf = repo => {
  const j = DOCS.findIndex(d => d.repo === repo)
  if (j < 0 || !shipped || paused || skipped.has(repo)) return null
  const d = docs?.[j]
  const verdict = d?.verdict || (d?.sha ? 'fail' : 'n/a')
  return d ? { sha: d.sha, files: d.files, prBody: d.prBody, ok: d.ok, tests: d.tests, notes: d.sha && verdict !== 'pass' ? [...d.notes, `not promoted: docs commit ${d.sha} stays on ${DOCS[j].featureBranch}--docs`] : d.notes, verdict, findings: d.findings || [] } : { sha: '', files: [], prBody: false, ok: false, tests: '', notes: [died('docs agent', `${name(repo)} docs`)], verdict: 'fail', findings: [] }
}
const docsOut = d => d && { ...d, findings: d.findings.map(brief) }
// Contracts have no fix loop: an open cross-repo blocker is the user's call, with the contract check's own recipe.
const xBlockers = (crossRepo?.findings || []).filter(blocking) // a blocker counts whatever the verdict says, as in docs
const fixUp = 'apply the recipe with a fix-up implementer per repo, then re-run stage "wholeBranch" with every repo of the contract'
const contractQ = xBlockers.length ? [{ q: `The cross-repo contract check left these open: ${xBlockers.map(brief).join('; ')}. Nothing fixes contracts inside the run. The contract check's recipe: ${crossRepo.sections || xBlockers.map(f => f.issue).join(' ')}. How should it be resolved?`, options: [fixUp, 'accept the drift as known debt', 'change the contract or the briefs (say how)'], default: fixUp }] : []
// the coordinator asks once from here: every workstream and repo question, tagged with where it came from
const tagged = (who, qs) => uniqQ(qs).map(q => ({ ...q, q: `${who}: ${q.q}` }))
const questions = [...contractQ, ...wsResults.flatMap(w => tagged(w.id, w.questions || [])), ...repoResults.flatMap(r => tagged(name(r.repo), r.questions || []))]
const revert = 'revert it: no decision or brief clause covers it'
questions.push(...drift.items.map(({ repo, where, change }) => ({ q: `drift: ${repo} ${where}: ${change}`, options: [revert, 'keep it and add it to the decision log'], default: revert })))
const rerun = 're-run stage wholeBranch to audit drift'
if (A.decisionLog && (drift.verdict === 'died' || drift.verdict === 'failed' || driftShort))
  questions.push({ q: `drift audit ${drift.verdict}: ${drift.notes.join('; ') || 'the drift agent could not read the decision log or a repo'}${drift.unconfirmed.length ? ` (${drift.unconfirmed.length} unconfirmed item${drift.unconfirmed.length > 1 ? 's' : ''} in drift.unconfirmed)` : ''}`, options: [rerun, 'ship without the drift audit'], default: rerun })
return {
  stage: STAGE,
  budget: { spent: budget.spent() - SPENT0, tokenBudget: A.tokenBudget ?? null, turnTotal: budget.total, reserve: RESERVE, stoppedBy },
  cycles: CYCLES,
  maxCycles: CAP,
  questions,
  dropped,
  workstreams: STAGE === 'wholeBranch' ? [] : wsResults.map(w => ({ ...w, open: w.open.map(brief), handed: (w.handed || []).map(brief), questions: uniqQ(w.questions), notes: uniq(w.notes) })),
  repos: repoResults.map(r => {
    const d = docsOf(r.repo)
    // docs that fail validation or promotion never reach the branch and fail the repo; so does a docs agent that died 3 times
    const docsFailed = d && (d.sha ? d.verdict !== 'pass' : d.verdict === 'fail')
    return { ...r, verdict: docsFailed ? 'fail' : r.verdict, escalations: [...r.escalations, ...(docsFailed ? [d.sha ? `docs commit ${d.sha} left unpromoted on ${r.featureBranch}--docs` : `${died('docs agent', `${name(r.repo)} docs`)}; docs not synced`] : [])], open: [...r.open, ...(d?.findings || [])].map(brief), questions: uniqQ(r.questions), notes: uniq([...r.notes, ...(leftovers[r.repo] || []), ...(x => x.length ? [`not done (dropped): ${x.join(', ')}`] : [])(dropped.filter(id => byId[id].repo === r.repo))]), findings: [...r.findings, ...asLedger('docs', d?.findings)], docs: docsOut(d), finalSha: (d?.verdict === 'pass' && d.sha) || r.sha, flaky: flakyOf(r.repo) }
  }),
  // crossRepo.ledger is the result key, not the prompt-side ledger of settled findings inside runWorkstream
  drift,
  crossRepo: crossRepo && { ...crossRepo, findings: crossRepo.findings.map(brief), ledger: asLedger('contract', crossRepo.findings) },
  ...(humanPending.length && { humanCheck: humanPending }), // the run paused: ask the user, then re-run with humanChecks
  // every full-stage result hands over what git cannot say, since any of them may be resumed; pass it back verbatim as carryForward
  ...(STAGE !== 'wholeBranch' && { carryForward: {
    call: CALL,
    workstreams: Object.fromEntries(wsResults.map(w => {
      const settled = repoResults.find(r => r.repo === byId[w.id].repo)?.findings || [] // a handed finding the whole-branch pass settled leaves
      return [w.id, { handed: (w.handed || []).filter(f => !settled.some(e => e.id === `${w.id}:${f.id}` && STATUS.includes(e.status) && e.status !== 'carried')), open: w.open || [], findings: w.findings || [] }]
    })),
    repos: Object.fromEntries(repoResults.map(r => [r.repo, { shared: sharedFound[r.repo] || [], passed: r.verdict === 'pass' ? r : null }])),
  } }),
  otherDocs: DOCS.filter(d => !repoMap[d.repo]).map(d => ({ repo: d.repo, featureBranch: d.featureBranch, docs: (x => x && { ...x, notes: [...x.notes, ...(leftovers[d.repo] || [])] })(docsOut(docsOf(d.repo))), findings: asLedger('docs', docsOf(d.repo)?.findings), flaky: flakyOf(d.repo) })),
}
