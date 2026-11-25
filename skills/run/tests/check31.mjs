// 0.4.10: the gate wrapper is one command, a red gate is never handed over, gates see the workstream's own shared edits,
// the cycle reviewer knows shared edits land at the merge, and the S26 fixture mode.
// Every scenario fails against the 0.4.9 script and fixture except the ones marked (control).
import { Run } from './run.mjs'
import assert from 'node:assert'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const SHA = n => (n + '').padStart(40, 'a')
const parallel = fs => Promise.all(fs.map(f => f().catch(() => null)))
const free = { total: null, spent: () => 0, remaining: () => Infinity }
const green = { green: true, summary: '12 passed', command: 'npm test', flaky: [] }
const red = { gate: { ...green, green: false, summary: 'test_readme red' } }
const push = { status: 'done', ok: true, tests: 't', gateTail: 'gate exit=0', sharedEdits: [], decisions: [], questions: [], notes: [] }
const F = (id, where = 'b/util.js:9', severity = 'major') => ({ id, severity, kind: 'bug', where, issue: `issue ${id}`, evidence: 'test t1 red' })
const EDITS = [{ file: 'README.md', intent: 'list a/x.py under Modules' }]
const ws = (id, extra = {}) => ({ id, repo: '/r/one', featureBranch: 'f', branch: `f--${id}`, model: 'sonnet', brief: `brief ${id}`, gate: 'npm test', files: [`${id}/`], ...extra })
const go = async (args, sc = {}) => {
  const prompts = {}, all = {}, order = []
  let head = SHA(97), n = 0
  const agent = async (p, o) => {
    const L = o.label.replace(/ attempt \d$/, '')
    prompts[L] = p; (all[L] ||= []).push(p); order.push(o.label)
    const own = sc[L]?.(p)
    if (L.startsWith('health ')) return { ok: true, notes: 'git version 2', ...own }
    if (L.endsWith('implement') || /fix [cr]\d/.test(L)) return { ...push, sha: head = SHA(200 + ++n), answers: [], ...own }
    if (/review c\d/.test(L)) return { headSha: head, findings: [], ...own }
    if (/validate c\d/.test(L)) return { headSha: head, gate: green, evidence: 'e', verified: [], open: [], questions: [], ...own }
    if (L.endsWith('merge')) return { ...push, sha: head = SHA(500), preMergeSha: SHA(40), baseAtMerge: SHA(41), ...own }
    if (/ shared check m\d$/.test(L)) return { verdict: 'pass', sections: 's', sha: head, tests: 't', gate: green, findings: [], ...own }
    if (L.endsWith(' review')) return { headSha: head, findings: [], seams: 'none', ...own }
    if (L.endsWith(' docs')) return { baseSha: head, sha: SHA(900), files: ['README.md'], prBody: false, ok: true, tests: 't', notes: [], ...own }
    if (L.endsWith(' docs validate')) return { verdict: 'pass', sections: 's', sha: SHA(900), tests: 't', gate: green, findings: [], ...own }
    if (/ (validate|recheck r\d)$/.test(L)) return { verdict: 'pass', sections: 's', sha: head, tests: 't', gate: green, findings: [], verified: [], questions: [], ...own }
    if (L.endsWith(' promote')) return { ok: true, sha: (p.match(/ to ([0-9a-f]{40})\./) || [])[1], notes: [], ...own }
    throw new Error('unmocked ' + L)
  }
  let timer
  const hung = new Promise((_, no) => { timer = setTimeout(() => no(new Error('the run hung')), 2000) })
  const r = await Promise.race([Run(args, agent, parallel, () => {}, free), hung]).finally(() => clearTimeout(timer))
  return { r, one: r.repos[0], a: r.workstreams[0], cf: r.carryForward?.workstreams?.a, prompts, all, order }
}
const fails = []
const t = async (name, fn) => { try { await fn() } catch (e) { fails.push(`${name}: ${e.message.split('\n').slice(0, 12).join(' ')}`) } }
const count = (s, x) => s.split(x).length - 1
// every label whose prompt holds x, sorted
const holds = (prompts, x) => Object.keys(prompts).filter(L => prompts[L].includes(x)).sort()
// a full run that reaches every prompt with a gate: the cycle, the shared check, the whole-branch pass with a fix round, docs
const everything = gate => go(
  { cycles: 1, workstreams: [ws('a', { gate })], repos: [{ repo: '/r/one', reviewSharedEdits: true }] },
  { 'a implement': () => ({ sharedEdits: EDITS }), 'a fix c1': () => ({ sharedEdits: EDITS }),
    'a review c1': () => ({ findings: [F('c1-F1', 'a/x.py:3')] }), 'a validate c1': () => ({ verified: ['c1-F1'] }),
    'one validate': () => ({ verdict: 'fail', findings: [F('V-F1', 'a/x.py:3')] }), 'one recheck r1': () => ({ verified: ['V-F1'] }) })

// ---- 1. gate wrapper ----
const CLEAN = 'Nothing is ever pushed on a red gate'
// the command a prompt shows: what stands between the wrapper sentence and the green rules
const shown = p => p.split(new RegExp(`${CLEAN}[^\\n]*:\\n`))[1].split('\nGreen = ')[0]
await t('1a every prompt with a gate shows it as one bash -c command, nothing after the closing quote', async () => {
  const { all } = await everything(`npm test -- --name 'x y' && npm run lint`)
  const gated = Object.entries(all).flatMap(([L, ps]) => ps.filter(p => p.includes('gate exit=$?')).map(p => [L, p]))
  for (const L of ['a implement', 'a fix c1', 'a validate c1', 'a merge', 'a shared check m1', 'one validate', 'one fix r1', 'one recheck r1', 'one docs', 'one docs validate']) assert(gated.some(([l]) => l === L), `no gate in ${L}`)
  for (const [L, p] of gated) {
    assert.equal(count(p, 'gate exit=$?'), 1, L)
    assert.match(shown(p), /^bash -c '(?:[^']|'\\'')*'$/, L)
  } })
const CASES = [ // gate, its own exit code
  ['false', 1], ['true', 0], ['exit 3', 3], ['true\nfalse\ntrue', 1], ['echo one\necho two', 0],
  ['false | cat', 1], ['false; true', 1], [`test 'a b' = "a b"`, 0], [`sh -c 'exit 4'`, 4],
  ['true # every suite', 0], ['cat <<EOF\nsuite\nEOF', 0], ['cat >/dev/null <<EOF\nsuite\nEOF\nfalse', 1]]
await t('1b with | tail -1 appended to the bash -c command it still prints the gate\'s own exit code, in a real shell', async () => {
  for (const [gate, code] of CASES) {
    const cmd = shown((await go({ cycles: 1, workstreams: [ws('a', { gate })] })).prompts['a implement'])
    const bash = cmd.match(/^bash -c '(?:[^']|'\\'')*'/)[0].length // where an agent appends: after the closing quote
    for (const tail of [' | tail -1', ' 2>&1 | tail -1', '']) {
      const out = spawnSync('bash', ['-c', cmd.slice(0, bash) + tail + cmd.slice(bash)], { encoding: 'utf8' }).stdout.trim().split('\n').at(-1)
      assert.equal(out, `gate exit=${code}`, `${JSON.stringify(gate)} with "${tail}"`)
    }
  } })

// ---- 2. a red gate is never handed over ----
const RED = { // the clean review's validator and the delta validator both see a red gate; the fixer says "carried" and the validator lists it verified
  'a implement': () => ({ sharedEdits: EDITS }),
  'a validate c1': p => /clean, but no validator/.test(p) ? red : { ...red, verified: ['v1-G'] },
  'a fix c1': () => ({ sharedEdits: EDITS, answers: [{ id: 'v1-G', action: 'carried', note: 'README.md is outside files[]' }] }),
}
const one = { cycles: 1, maxCycles: 1, workstreams: [ws('a')] }
await t('2a a red gate answered "carried" and listed verified leaves the workstream unmerged, the gate open and nothing handed', async () => {
  const { a, cf, one: repo, order } = await go(one, RED)
  assert.equal(a.merged, false)
  assert.deepEqual([a.handed, cf.handed], [[], []])
  assert.deepEqual(a.open, ['critical gate: test_readme red'])
  assert.deepEqual(cf.open.map(f => [f.id, f.severity]), [['v1-G', 'critical']])
  assert.equal(a.findings.find(e => e.id === 'v1-G')?.status, 'open', JSON.stringify(a.findings))
  assert(!order.includes('a merge') && repo.verdict === 'skipped', order.join()) })
await t('2b in a later cycle too: the first gate finding never reads "carried" in the ledger while the gate is red', async () => {
  const { a, cf, prompts } = await go({ cycles: 1, maxCycles: 2, workstreams: [ws('a')] }, { ...RED,
    'a review c2': () => ({ findings: [] }),
    'a fix c2': () => ({ sharedEdits: EDITS, answers: [{ id: 'v1-G', action: 'carried', note: 'README.md' }] }),
    'a validate c2': () => ({ ...red, verified: ['v1-G'] }) })
  assert.equal(a.merged, false)
  assert.deepEqual(a.handed, [])
  assert(cf.open.some(f => f.id === 'v2-G'), JSON.stringify(cf.open))
  assert(!a.findings.some(e => e.status === 'carried'), JSON.stringify(a.findings))
  assert(!/"status":"carried"/.test(prompts['a review c2']), 'the reviewer is not told the red gate is settled') })
await t('2c the delta validator is not asked to judge a "carried" claim on a gate', async () => {
  const { prompts } = await go(one, RED)
  assert(prompts['a validate c1'].includes('"action":"carried"') && !/A claim "carried" holds/.test(prompts['a validate c1'])) })
await t('2d a handed finding that shares the red gate\'s id never hides the red gate', async () => {
  const twin = F('v1-G', 'tests/test_readme.py:8') // a validator that files the failing test itself, under the id the script gives the gate
  const { a, cf } = await go(one, { ...RED, 'a validate c1': p => /clean, but no validator/.test(p) ? { ...red, open: [twin] } : { ...red, verified: ['v1-G'] } })
  assert.equal(a.merged, false)
  assert.deepEqual([cf.handed.map(f => f.where), cf.open.map(f => f.where)], [['tests/test_readme.py:8'], ['gate']]) })
await t('2e a gate that turns green after a "carried" answer merges, and the gate finding reads fixed', async () => {
  const { a } = await go(one, { ...RED, 'a validate c1': p => /clean, but no validator/.test(p) ? red : { verified: ['v1-G'] } })
  assert.equal(a.merged, true)
  assert.deepEqual(a.handed, [])
  assert.equal(a.findings.find(e => e.id === 'v1-G')?.status, 'fixed', JSON.stringify(a.findings)) })
await t('2f (control) a carried claim on a finding that is not the gate still hands over and merges', async () => {
  const { a } = await go(one, { 'a review c1': () => ({ findings: [F('c1-F1')] }), 'a validate c1': () => ({ verified: ['c1-F1'] }),
    'a fix c1': () => ({ answers: [{ id: 'c1-F1', action: 'carried', note: 'b/util.js' }] }) })
  assert.equal(a.merged, true)
  assert.deepEqual(a.handed, ['major b/util.js:9: issue c1-F1'])
  assert.equal(a.findings.find(e => e.id === 'c1-F1')?.status, 'carried') })

// ---- 3. the new sentences, each only where it belongs ----
const OWN = 'If your gate reads a shared file you need changed (a test that reads the README, a version file), make that change in your worktree so the gate sees it, never stage it (git add your own paths only), and return it in sharedEdits as usual.'
const NEVER = 'A red gate is never "carried": when its only cause is a shared-file change in your sharedEdits, answer it "answered" and name the edit.'
const RERUN = 'If the gate is red and the failing test reads a shared file: apply the author\'s sharedEdits (listed in step 1) in your worktree, uncommitted, the way the merge will (a generated file: the repo\'s regen), rerun the gate once and report that run, with "shared edits applied" in gate.summary. Still red: red.'
const NOTE = hot => `Shared files are never the author's to commit: ${hot}; the merge applies the edits the brief asks for there, so a change missing from them is not a finding.\n`
const NOTE_RE = /so a change missing from them is not a finding/
const hotRepo = (hot = ['**/README*', 'contract.yaml']) => [{ repo: '/r/one', hot }]
const busy = { 'a implement': () => ({ sharedEdits: EDITS }), 'a fix c1': () => ({ sharedEdits: EDITS, answers: [{ id: 'v1-F1', action: 'fixed', note: 'n' }] }) }
// call 1 of validate c1 is the clean-review validator, call 2 the delta validator of its fix
const valTwice = () => { let k = 0; return { 'a validate c1': () => k++ ? { verified: ['v1-F1'] } : { open: [F('v1-F1', 'a/x.py:3')] } } }
const wbFix = { 'one validate': () => ({ verdict: 'fail', findings: [F('V-F1', 'a/x.py:3')] }), 'one recheck r1': () => ({ verified: ['V-F1'] }) }
await t('3a the author and the fixer are told to make the shared-file change their gate reads, nobody else', async () => {
  const { prompts } = await go({ cycles: 1, workstreams: [ws('a')], repos: hotRepo() }, { ...busy, ...valTwice(), ...wbFix })
  assert.deepEqual(holds(prompts, OWN), ['a fix c1', 'a implement'])
  for (const L of ['a fix c1', 'a implement']) assert(count(prompts[L], OWN) === 1 && prompts[L].includes(`the merge applies it on the feature-branch tip. ${OWN}`), L)
  const none = await go({ cycles: 1, workstreams: [ws('a')], repos: hotRepo([]) }, { ...busy, ...valTwice() })
  assert.deepEqual(holds(none.prompts, OWN), [], 'no hot list, no shared files') })
await t('3b the fix prompt alone says a red gate is never carried', async () => {
  const { prompts } = await go({ cycles: 1, workstreams: [ws('a')], repos: hotRepo() }, { ...busy, ...valTwice(), ...wbFix })
  assert.deepEqual(holds(prompts, NEVER), ['a fix c1'])
  assert.equal(count(prompts['a fix c1'], NEVER), 1) })
await t('3c both workstream validators get the rerun sentence in their gate step, only with shared edits', async () => {
  const args = { cycles: 1, workstreams: [ws('a')], repos: hotRepo() }
  const { all, prompts } = await go(args, { ...busy, ...valTwice(), ...wbFix })
  assert.equal(all['a validate c1'].length, 2)
  assert(/clean, but no validator/.test(all['a validate c1'][0]) && /review-fix delta/.test(all['a validate c1'][1]))
  for (const p of all['a validate c1']) {
    assert.equal(count(p, RERUN), 1)
    const step3 = p.split('\n3. Run the gate')[1].split('\n4. ')[0]
    assert(step3.endsWith(` ${RERUN}`), 'the end of the gate step')
    assert(p.split('\n2. ')[0].includes(JSON.stringify(EDITS)), 'the list the sentence points at stands in step 1')
  }
  assert.deepEqual(holds(prompts, RERUN), ['a validate c1'])
  const off = await go(args, { ...valTwice() })
  assert.equal(off.all['a validate c1'].length, 2)
  for (const p of off.all['a validate c1']) assert(!p.includes('shared edits applied'))
  const noHot = await go({ ...args, repos: hotRepo([]) }, { ...busy, ...valTwice() })
  for (const p of noHot.all['a validate c1']) assert(!p.includes('shared edits applied'), 'no hot list: step 1 lists no edits') })
await t('3d the delta validator follows the fixer\'s list, not the author\'s', async () => {
  const gone = await go({ cycles: 1, workstreams: [ws('a')], repos: hotRepo() }, { ...busy, 'a fix c1': () => ({ sharedEdits: [], answers: [] }), ...valTwice() })
  assert.deepEqual(gone.all['a validate c1'].map(p => p.includes(RERUN)), [true, false])
  const lite = await go({ cycles: 1, workstreams: [ws('a', { lite: true })], repos: hotRepo() }, { 'a implement': busy['a implement'] })
  assert(lite.prompts['a validate c1'].includes(RERUN), 'a lite workstream\'s one validator') })
await t('3e the cycle reviewer is told shared edits land at the merge, right before the severity block, with the repo\'s hot list', async () => {
  const { prompts, all } = await go({ cycles: 2, workstreams: [ws('a')], repos: hotRepo() }, { ...busy, ...valTwice(), 'a review c2': () => ({ findings: [] }), ...wbFix })
  assert.deepEqual(holds(prompts, NOTE('**/README*, contract.yaml')), ['a review c1', 'a review c2'])
  for (const L of ['a review c1', 'a review c2']) assert(all[L][0].includes(`\n${NOTE('**/README*, contract.yaml')}Severity: critical = `), L)
  assert('one review' in prompts && !NOTE_RE.test(prompts['one review']), 'never the whole-branch review') })
await t('3f the reviewer note is absent with no hot list, and the default hot list counts as one', async () => {
  const none = await go({ cycles: 1, workstreams: [ws('a')], repos: hotRepo([]) })
  assert(none.prompts['a review c1'] && !NOTE_RE.test(none.prompts['a review c1']))
  const dflt = await go({ cycles: 1, workstreams: [ws('a')] })
  assert(/Shared files are never the author's to commit: \*\*\/README\*, [^;]*\*\*\/\*\.sha256; the merge applies/.test(dflt.prompts['a review c1'])) })

// ---- 4. the S26 fixture mode ----
const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp // build.sh refuses a path that names a seed, so a telling suffix is re-drawn
do tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lw.'))); while (/seed|defect|plant|inject|bug|impossible|control|s15|s16|s17|s27|s28/i.test(tmp) && (fs.rmdirSync(tmp), true))
const GATE = 'python3 -m unittest discover -s tests -t .'
const KNOWN = 'tests.test_known_red.KnownRed.test_upstream_rounding', README = 'tests.test_readme.ReadmeTest.test_every_module_is_listed'
const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim()
const failing = dir => {
  const out = spawnSync('bash', ['-c', GATE], { cwd: dir, encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }).stderr
  assert.match(out, /^Ran [1-9]\d* tests?/m, out)
  return [...out.matchAll(/^(?:FAIL|ERROR): \S+ \(([^)]+)\)$/gm)].map(m => m[1]).sort()
}
try {
  const build = (dest, mode) => JSON.parse(execFileSync('bash', [path.join(HERE, 'fixture/build.sh'), dest, ...(mode ? [mode] : [])], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
  await t('4a --shared prints one alpha workstream with files[], a README shared edit in its brief and docs off', () => {
    const dest = path.join(tmp, 'a/dest'), a = build(dest, '--shared'), alpha = `${dest}/alpha`
    assert.deepEqual([a.cycles, a.repos.map(r => r.repo), a.docsRepos, a.skillDir, a.repos[0].smoke], [1, [alpha], [], undefined, undefined])
    assert.deepEqual(a.repos[0].hot, ['**/README*', 'contract.yaml'])
    const [w, ...more] = a.workstreams
    assert.deepEqual([more, w.id, w.repo, w.branch, w.base, w.model, w.gate, w.files], [[], 'alpha-report', alpha, 'feat/eval--alpha-report', undefined, 'sonnet', GATE, ['ledger/report.py', 'tests/test_report.py']])
    assert.match(w.brief, /Shared edit: README needs a line under Modules listing ledger\/report\.py and summary\(entries\)\.$/)
    assert.doesNotMatch(w.brief, /test_readme|gate/i) })
  await t('4b the baseline holds the README test and is green but the known-red; only origin main, feat/eval-base and feat/eval exist', () => {
    const alpha = path.join(tmp, 'a/dest/alpha')
    assert.deepEqual(failing(alpha), [KNOWN])
    assert(git(alpha, 'ls-files').includes('tests/test_readme.py'))
    assert.deepEqual(git(path.join(tmp, 'a/dest/remotes/alpha.git'), 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n'), ['feat/eval', 'feat/eval-base', 'main'])
    assert.equal(git(alpha, 'diff', '--name-only', 'feat/eval-base', 'feat/eval'), '') })
  await t('4c the brief\'s module turns only the README test red, and the README line turns it green', () => {
    const alpha = path.join(tmp, 'a/dest/alpha')
    fs.writeFileSync(path.join(alpha, 'ledger/report.py'), 'def summary(entries):\n    return {"count": len(entries), "owners": sorted({e["owner"] for e in entries})}\n')
    assert.deepEqual(failing(alpha), [KNOWN, README].sort())
    const f = path.join(alpha, 'README.md'), s = fs.readFileSync(f, 'utf8'), last = '- `ledger/rounding.py`: `round_total(amount)`, ties to even\n'
    assert.equal(count(s, last), 1)
    fs.writeFileSync(f, s.replace(last, `${last}- \`ledger/report.py\`: \`summary(entries)\`\n`))
    assert.deepEqual(failing(alpha), [KNOWN]) })
  await t('4d (control) the plain baseline has no such test', () => {
    build(path.join(tmp, 'b/dest'))
    assert(!git(path.join(tmp, 'b/dest/alpha'), 'ls-files').includes('test_readme')) })
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
await t('4e fixture-scenarios.md has the S26 section: how to build it and what passes', () => {
  const s = fs.readFileSync(path.join(HERE, 'fixture-scenarios.md'), 'utf8')
  const sec = s.split(/^## /m).find(x => /\(S26\)/.test(x.split('\n')[0])) || ''
  for (const x of ['`tests/fixture/build.sh <dest> --shared`', 'tests/test_readme.py', '"shared edits applied"', '`handed`', 'unscored']) assert(sec.includes(x), x)
  assert(s.includes('[--seed|--control|--impossible|--ws-seed|--ws-control|--flow|--decided|--ruled|--shared]'), 'the builder line') })

if (fails.length) { console.error(fails.join('\n')); process.exit(1) }
console.log('one gate command, own shared edits and reviewer note checks ok')
