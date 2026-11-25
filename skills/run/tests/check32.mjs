// 0.4.11: every fix hunk serves a listed finding, and the validators of a fix map each hunk of its delta.
// Every scenario fails against the 0.4.10 script except the ones marked (control).
import { Run } from './run.mjs'
import assert from 'node:assert'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const SHA = n => (n + '').padStart(40, 'a')
const parallel = fs => Promise.all(fs.map(f => f().catch(() => null)))
const free = { total: null, spent: () => 0, remaining: () => Infinity }
const green = { green: true, summary: '12 passed', command: 'npm test', flaky: [] }
const push = { status: 'done', ok: true, tests: 't', gateTail: 'gate exit=0', sharedEdits: [], decisions: [], questions: [], notes: [] }
const F = (id, where = 'a/x.py:3', severity = 'major', kind = 'bug') => ({ id, severity, kind, where, issue: `issue ${id}`, evidence: 'test t1 red' })
const EDITS = [{ file: 'README.md', intent: 'list a/x.py under Modules' }]
const ws = (id, extra = {}) => ({ id, repo: '/r/one', featureBranch: 'f', branch: `f--${id}`, model: 'sonnet', brief: `brief ${id}`, gate: 'npm test', files: [`${id}/`], ...extra })
const go = async (args, sc = {}) => {
  const prompts = {}, all = {}, order = [], head = {}
  let tip = SHA(40), n = 0
  const agent = async (p, o) => {
    const L = o.label.replace(/ attempt \d$/, ''), id = L.split(' ')[0]
    prompts[L] = p; (all[L] ||= []).push(p); order.push(o.label)
    const own = sc[L]?.(p, all[L].length)
    if (L.startsWith('health ')) return { ok: true, notes: 'git version 2', ...own }
    if (L.endsWith('implement') || /fix c\d/.test(L)) { const r = { ...push, sha: SHA(200 + ++n), answers: [], ...own }; head[id] = r.sha; return r }
    if (/review c\d/.test(L)) return { headSha: head[id], findings: [], ...own }
    if (/validate c\d/.test(L)) return { headSha: head[id], gate: green, evidence: 'e', verified: [], open: [], questions: [], ...own }
    if (L.endsWith('merge')) return { ...push, sha: tip = SHA(500 + ++n), preMergeSha: SHA(40), baseAtMerge: SHA(41), ...own }
    if (/fix r\d/.test(L)) { const r = { ...push, sha: SHA(700 + ++n), answers: [], ...own }; tip = r.sha; return r }
    if (L.endsWith(' review')) return { headSha: tip, findings: [], seams: 'none', ...own }
    if (L.endsWith(' docs')) return { baseSha: tip, sha: SHA(900), files: ['README.md'], prBody: false, ok: true, tests: 't', notes: [], ...own }
    if (L.endsWith(' docs validate')) return { verdict: 'pass', sections: 's', sha: SHA(900), tests: 't', gate: green, findings: [], ...own }
    if (/ (validate|recheck r\d)$/.test(L)) return { verdict: 'pass', sections: 's', sha: tip, tests: 't', gate: green, findings: [], verified: [], questions: [], ...own }
    if (L.endsWith(' promote')) return { ok: true, sha: (p.match(/ to ([0-9a-f]{40})\./) || [])[1], notes: [], ...own }
    throw new Error('unmocked ' + L)
  }
  let timer
  const hung = new Promise((_, no) => { timer = setTimeout(() => no(new Error('the run hung')), 2000) })
  const r = await Promise.race([Run(args, agent, parallel, () => {}, free), hung]).finally(() => clearTimeout(timer))
  return { r, one: r.repos[0], W: id => r.workstreams.find(w => w.id === id), prompts, all, order }
}
const fails = []
const t = async (name, fn) => { try { await fn() } catch (e) { fails.push(`${name}: ${e.message.split('\n').slice(0, 6).join(' ')}`) } }
const count = (s, x) => s.split(x).length - 1
// every label one of whose prompts holds x, sorted
const holds = (all, x) => Object.keys(all).filter(L => all[L].some(p => p.includes(x))).sort()
const step2 = p => p.split('\n2. ')[1].split('\n3. ')[0]

// step 2 holds the map after the test guard, and the findings it maps to stand above it
const mapped = p => step2(p).indexOf(` ${UNASKED}`) > step2(p).indexOf('a red run is a major (kind bug).') && p.indexOf('"claim":') > -1 && p.indexOf('"claim":') < p.indexOf(UNASKED)
const SCOPE_FIX = 'Every hunk you commit must serve one finding listed above. Leave everything else as it is (a rename, reworded copy, a changed default, a tidy-up); if it matters, return it as a question.'
const UNASKED = 'Map each hunk of the delta to the finding it resolves. A hunk that changes behaviour, user-visible text, a default or a test and serves no listed finding is an unasked change: file it as kind "regression" (major when user-visible or against a brief clause or a decision, else minor), with the hunk as evidence.'

// call 1 of validate c1 is the clean-review validator, call 2 the delta validator of its fix; then one whole-branch fix round and docs
const full = () => ({
  'a implement': () => ({ sharedEdits: EDITS }), 'a fix c1': () => ({ sharedEdits: EDITS, answers: [{ id: 'v1-F1', action: 'fixed', note: 'n' }] }),
  'a validate c1': (p, k) => k > 1 ? { verified: ['v1-F1'] } : { open: [F('v1-F1')] },
  'one validate': () => ({ verdict: 'fail', findings: [F('V-F1')] }), 'one recheck r1': () => ({ verified: ['V-F1'] }) })
const solo = { cycles: 1, workstreams: [ws('a')], repos: [{ repo: '/r/one', hot: ['**/README*'] }] }

// ---- 1. fixers stay in scope ----
await t('1a both fix prompts, and no other, say that every hunk serves a listed finding', async () => {
  const { all, prompts } = await go(solo, full())
  assert.deepEqual(holds(all, SCOPE_FIX), ['a fix c1', 'one fix r1'])
  for (const L of ['a fix c1', 'one fix r1']) {
    assert.equal(count(prompts[L], SCOPE_FIX), 1, L)
    const at = prompts[L].indexOf(SCOPE_FIX), id = L === 'a fix c1' ? '"id":"v1-F1"' : '"id":"V-F1"'
    assert(prompts[L].indexOf(id) > -1 && prompts[L].indexOf(id) < at, `${L}: the findings stand above the sentence`)
    assert(/decline(d)? (it )?with a reason/.test(prompts[L].slice(0, at)), `${L}: right after the rule for minors`)
  } })
await t('1b the two sentences it replaces are gone from every prompt', async () => {
  const { all } = await go(solo, full())
  for (const [L, ps] of Object.entries(all)) for (const p of ps) assert(!/Keep fixes minimal|Minimal fixes/.test(p), L) })
await t('1c a fixer with no files[] and a lite workstream\'s fixer get it too', async () => {
  for (const w of [ws('a', { files: undefined }), ws('a', { lite: true })])
    assert.equal(count((await go({ ...solo, workstreams: [w] }, full())).prompts['a fix c1'], SCOPE_FIX), 1) })

// ---- 2. the validators of a fix map its hunks ----
await t('2a the delta validator and the recheck hold the map in step 2, after the test guard, and no other prompt does', async () => {
  const { all } = await go(solo, full())
  assert.equal(all['a validate c1'].length, 2)
  assert.deepEqual(holds(all, UNASKED), ['a validate c1', 'one recheck r1'])
  for (const p of [all['a validate c1'][1], all['one recheck r1'][0]]) {
    assert.equal(count(p, UNASKED), 1)
    assert(mapped(p), step2(p).slice(-200))
  } })
await t('2b in a later cycle and under a stop rule too', async () => {
  const two = { ...full(), 'a review c2': () => ({ findings: [F('c2-F1')] }), 'a validate c2': () => ({ verified: ['c2-F1'] }) }
  const { prompts } = await go({ ...solo, cycles: 2, stopRule: 'wrong output' }, two)
  for (const L of ['a validate c2', 'one recheck r1']) assert(mapped(prompts[L]), L) })
await t('2c (control) the clean-review validator has no map: its step 2 ends with the read-only guard, as before', async () => {
  const p = (await go(solo, full())).all['a validate c1'][0]
  assert(/clean, but no validator/.test(p))
  assert(step2(p).startsWith('Prove the new tests: revert the production hunks in your worktree, they must go red; restore them, green. Test integrity: '))
  assert(step2(p).endsWith('editing one is a major regression, whatever the brief seems to justify.'))
  assert(!/Map each hunk|unasked/.test(p)) })

// ---- 3. what the map must not punish ----
const MAP_MERGED = (prev, sha, f = 'origin/f') => `In step 2's map, only its own hunks count: git log -p --cc ${prev}..${sha} --not ${f}.`
const siblings = { cycles: 1, workstreams: [ws('b'), ws('a', { after: ['b'] })], repos: [{ repo: '/r/one', hot: ['**/README*'] }] }
const seam = () => ({ ...full(), 'a review c1': () => ({ findings: [F('c1-F1', 'b/util.js:9', 'major', 'integration')] }), 'a validate c1': () => ({ verified: ['c1-F1'] }) })
await t('3a after a fixer merged the feature branch the map is told to count the fixer\'s own hunks only', async () => {
  const { all } = await go(siblings, seam())
  const p = all['a validate c1'][0], [prev, sha] = p.match(/then ([0-9a-f]{40})\.\.([0-9a-f]{40}) on f--a/).slice(1)
  assert.equal(count(p, MAP_MERGED(prev, sha)), 1)
  const line = p.split('\n').find(l => l.startsWith('If the fixer merged origin/f (an integration fix), skip the merged-in side: judge git diff '))
  assert(line?.endsWith(` ${MAP_MERGED(prev, sha)}`), 'conditional on the merge: it stands on the line about it')
  assert.deepEqual(holds(all, 'own hunks count'), ['a validate c1']) })
await t('3b that command, in a real repo, lists the fixer\'s hunks and conflict resolution, neither the author\'s nor the sibling\'s', async () => {
  const { all } = await go(solo, full())
  const cmd = all['a validate c1'][1].match(/git log -p --cc \S+ --not origin\/f/)?.[0]
  assert(cmd, 'the prompt names the command')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lw.'))
  try {
    const git = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    const commit = files => { for (const [f, s] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), s); git('add', '-A'); git('commit', '-qm', 'c'); return git('rev-parse', 'HEAD') }
    git('init', '-q', '-b', 'base')
    commit({ 'a.txt': 'base\n', 'shared.txt': 'base\n' })
    git('checkout', '-qb', 'work'); const prev = commit({ 'a.txt': 'author work\n', 'shared.txt': 'author side\n' })
    git('checkout', '-qb', 'f', 'base'); commit({ 'sib.txt': 'sibling work\n', 'shared.txt': 'sibling side\n' }); git('update-ref', 'refs/remotes/origin/f', 'f')
    git('checkout', '-q', 'work')
    assert.throws(() => git('merge', '--no-ff', '-m', 'm', 'f'))
    commit({ 'shared.txt': 'resolved by fixer\n' })
    const sha = commit({ 'sib.txt': 'sibling work\nfixer line\n' })
    const out = git(...cmd.replace(/\S+\.\.\S+/, `${prev}..${sha}`).split(' ').slice(1))
    assert.match(out, /\+fixer line/)
    assert.match(out, /resolved by fixer/)
    assert.doesNotMatch(out, /author work|\+sibling work/)
    assert.match(git('diff', `origin/f...${sha}`), /author work/) // why the line needs it: the diff judged after a merge holds the whole workstream
  } finally { fs.rmSync(dir, { recursive: true, force: true }) } })
await t('3c (control) the integration-fix exception stands: its blocker is a listed finding, so its hunks in a sibling\'s file map to it', async () => {
  const { prompts } = await go(siblings, seam())
  assert(prompts['a fix c1'].includes('first git merge origin/f into your branch, then fix those files too'))
  for (const L of ['a fix c1', 'a validate c1']) assert(prompts[L].includes('"id":"c1-F1","severity":"major","kind":"integration","where":"b/util.js:9"'), L) })
await t('3d (control) the test a fix prompt asks for is claimed against a listed finding, and the validators prove it red at the head before the fix', async () => {
  const { all, prompts } = await go(solo, full())
  assert(prompts['a fix c1'].includes('fix bugs with a test you ran RED before the fix and green after') && prompts['one fix r1'].includes('red-verified tests for bug fixes'))
  assert(all['a validate c1'][1].includes('Where a test is claimed, it must fail at ') && prompts['one recheck r1'].includes('A claimed test must fail at ')) })
await t('3e (control) shared edits stay out of the mapped delta: never committed, and a validator applies them only after step 2', async () => {
  const { all, prompts } = await go(solo, full())
  assert(prompts['a fix c1'].includes('make that change in your worktree so the gate sees it, never stage it'))
  const p = all['a validate c1'][1], late = p.indexOf('apply the author\'s sharedEdits (listed in step 1) in your worktree, uncommitted')
  assert(late > p.indexOf('\n3. Run the gate') && late < p.indexOf('\n4. ')) })
await t('3f (control) the whole-branch fixer never merges a workstream, and its regenerated files follow a source it changed', async () => {
  const { prompts } = await go(solo, full())
  assert(prompts['one fix r1'].includes('Never merge a workstream branch') && prompts['one fix r1'].includes('If you change the source of a generated file')) })
await t('3g (control) a minor unasked change neither drives a cycle nor counts as churn; a major one drives the next cycle', async () => {
  const unasked = sev => ({ 'a review c1': () => ({ findings: [F('c1-F1')] }), 'a validate c1': () => ({ verified: ['c1-F1'], open: [F('v1-R1', 'a/x.py:9', sev, 'regression')] }) })
  const minor = await go({ cycles: 1, maxCycles: 2, workstreams: [ws('a')] }, unasked('minor'))
  assert.deepEqual([minor.W('a').merged, minor.W('a').cyclesRun, minor.W('a').churn], [true, 1, []])
  const major = await go({ cycles: 1, maxCycles: 2, workstreams: [ws('a')] }, { ...unasked('major'), 'a validate c2': () => ({ verified: ['v1-R1'] }) })
  assert.deepEqual([major.W('a').merged, major.W('a').cyclesRun, major.W('a').churn], [true, 2, [{ cycle: 1, files: ['a/x.py'] }]]) })

if (fails.length) { console.error(fails.join('\n')); process.exit(1) }
console.log('fix scope and unasked-change checks ok')
