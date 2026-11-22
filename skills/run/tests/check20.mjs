// Verified carried claims, soft blocks that read done, dropped workstreams, the stuck-finding follow-through and after-ordered files[] overlap.
// Every scenario fails against the 0.3.10 script except the ones marked (control).
import { Run } from './run.mjs'
import assert from 'node:assert'
const SHA = n => (n + '').padStart(40, 'a')
const parallel = fs => Promise.all(fs.map(f => f().catch(() => null)))
const free = { total: null, spent: () => 0, remaining: () => Infinity }
const push = { status: 'done', ok: true, tests: 't', gateTail: 'gate exit=0', sharedEdits: [], decisions: [], questions: [], notes: [] }
const green = { green: true, summary: '12 passed', command: 'npm test', flaky: [] }
const F = (id, severity = 'major', where = 'x.py:3') => ({ id, severity, kind: 'bug', where, issue: `issue ${id}`, evidence: 'test t1 red' })
const Q = q => ({ q, options: ['keep the tests', 'edit the test'], default: 'keep the tests' })
function mock(args, sc = {}) {
  const prompts = {}, all = {}, order = [], merges = {}
  const head = {}
  let n = 0
  const repoOf = L => { const w = args.workstreams.find(w => L.startsWith(`${w.id} `)); return w ? w.repo : `/r/${L.split(' ')[0]}` }
  const agent = async (p, o) => {
    const L = o.label.replace(/ attempt \d$/, '')
    prompts[L] = p; (all[L] ||= []).push(p); order.push(o.label)
    const id = L.split(' ')[0]
    const repo = repoOf(L)
    const own = sc[L]?.(p, all[L].length)
    if (own === null) return null
    if (L.startsWith('health ')) return { ok: true, notes: 'git version 2', ...own }
    if (L.endsWith(' state')) return { featureSha: SHA(4000), workstreams: [], ...own }
    if (L.endsWith('implement')) return (head[id] = SHA(id.charCodeAt(0)), { ...push, sha: head[id], ...own })
    if (/fix c(\d)/.test(L)) { const r = { ...push, sha: SHA(200 + ++n), answers: [], ...own }; head[id] = r.sha; return r }
    if (/review c\d/.test(L)) return { headSha: head[id], findings: [], ...own }
    if (/validate c\d/.test(L)) return { headSha: head[id], gate: green, evidence: 'e', verified: [], open: [], questions: [], ...own }
    if (L.endsWith('merge')) { const pre = head[repo] || SHA(40); head[repo] = SHA(500 + ++n); (merges[id] ||= []).push(head[repo]); return { ...push, sha: head[repo], preMergeSha: pre, baseAtMerge: SHA(40), ...own } }
    if (/ shared check m\d+$/.test(L)) return { verdict: 'pass', sections: 's', sha: head[repo], tests: 't', gate: green, findings: [], ...own }
    if (L.endsWith(' review')) return { headSha: head[repo] || SHA(4000), findings: [], seams: 'none', ...own }
    if (L.endsWith(' docs validate')) return { verdict: 'pass', sections: 's', sha: SHA(900), tests: 't', gate: green, findings: [], ...own }
    if (L.endsWith(' validate')) return { verdict: 'pass', sections: 's', sha: head[repo] || SHA(4000), tests: 't', gate: green, findings: [], verified: [], questions: [], ...own }
    if (/fix r(\d)/.test(L)) { const r = { ...push, sha: SHA(70 + +L.at(-1)), answers: [], ...own }; head[repo] = r.sha; return r }
    if (/recheck r\d/.test(L)) return { verdict: 'pass', sections: 's', sha: head[repo], tests: 't', gate: green, findings: [], verified: [], questions: [], ...own }
    if (L.endsWith(' docs')) return { baseSha: head[repo] || SHA(4000), sha: '', files: [], prBody: false, ok: true, tests: 't', notes: [], ...own }
    if (L.endsWith(' promote')) return { ok: true, sha: (p.match(/ to ([0-9a-f]{40})\./) || [])[1], notes: [], ...own }
    if (L === 'drift') return { ok: true, notes: [], sections: 's', drift: [], ...own }
    if (L === 'contracts') return { verdict: 'pass', sections: 's', findings: [], ...own }
    throw new Error('unmocked ' + L)
  }
  return { agent, prompts, all, order, merges, head }
}
const ws = (id, extra = {}) => ({ id, repo: '/r/one', featureBranch: 'f', branch: `f--${id}`, model: 'sonnet', brief: `brief ${id}`, gate: 'npm test', files: [`${id}/`], ...extra })
const go = async (args, sc) => {
  const m = mock(args, sc)
  let timer
  const hung = new Promise((_, no) => { timer = setTimeout(() => no(new Error('the run hung')), 2000) })
  const r = await Promise.race([Run(args, m.agent, parallel, () => {}, free), hung]).finally(() => clearTimeout(timer))
  return { r, ...m }
}
const rejects = async (args, re) => { let e = null; try { await go(args, {}) } catch (x) { e = x } assert(e && re.test(e.message), `expected ${re}, got ${e?.message}`) }
const fails = []
const t = async (name, fn) => { try { await fn() } catch (e) { fails.push(`${name}: ${e.message.split('\n')[0]}`) } }
const W = (r, id) => r.workstreams.find(w => w.id === id)
const ran = (order, id) => order.filter(L => L.startsWith(`${id} `))
const state = (...xs) => ({ 'one state': () => ({ workstreams: xs }) })
const HA = SHA(1001), HB = SHA(1002)

// ---- C1.1 a carried claim is verified ----
const outside = { 'a review c1': () => ({ findings: [F('c1-F1', 'major', 'b/util.js:9')] }), 'a fix c1': () => ({ answers: [{ id: 'c1-F1', action: 'carried', note: 'the fix flips a pre-existing assertion in b/util.test.js' }] }) }
const CLAIM = /A claim "carried" holds only when its fix cannot be made inside the files this workstream may edit \(a\/\): return the id in verified if so, otherwise in open\./
await t('C1.1a accepted: the validator verifies the claim, it is handed to the whole-branch fixer and never counts as fixed', async () => {
  const { r, prompts } = await go({ cycles: null, workstreams: [ws('a'), ws('b')] }, { ...outside, 'a validate c1': () => ({ verified: ['c1-F1'] }) })
  const a = W(r, 'a')
  assert(a.merged && a.handed.length === 1 && a.findings.find(e => e.id === 'c1-F1')?.status === 'carried' && a.findingsFixed === 0, JSON.stringify(a))
  assert(prompts['a validate c1'].includes('"claim":{"id":"c1-F1","action":"carried"') && !/Handed to the whole-branch pass/.test(prompts['a validate c1']), 'judged by this cycle\'s validator, not pre-settled')
  assert(prompts['one fix r1']?.includes('"a:c1-F1"')) })
const rejectedClaim = how => async () => {
  const { r, order, prompts } = await go({ cycles: 1, workstreams: [ws('a'), ws('b')] }, { ...outside, 'a validate c1': how, 'a validate c2': () => ({ verified: ['c1-F1'] }) })
  const a = W(r, 'a')
  assert(a.handed.length === 0 && order.includes('a fix c2') && prompts['a fix c2'].includes('"c1-F1"') && a.cyclesRun === 2, JSON.stringify({ a, order }))
  assert(!(prompts['one fix r1'] || '').includes('a:c1-F1'), 'a rejected claim never reaches the whole-branch pass') }
await t('C1.1b rejected: a claim the validator returns open goes back to the fixer for another cycle', rejectedClaim(() => ({ open: [F('c1-F1', 'major', 'b/util.js:9')] })))
await t('C1.1c silent: a claim the validator neither verifies nor re-opens is rejected', rejectedClaim(() => ({})))
await t('C1.1d the claim sentence reaches the delta validator only when a carried answer exists (control: a plain fix cycle)', async () => {
  const { prompts } = await go({ cycles: 1, workstreams: [ws('a')] }, { ...outside, 'a validate c1': () => ({ verified: ['c1-F1'] }) })
  assert(CLAIM.test(prompts['a validate c1']), prompts['a validate c1'])
  const plain = await go({ cycles: 1, workstreams: [ws('a')] }, { 'a review c1': () => ({ findings: [F('c1-F1')] }), 'a validate c1': () => ({ verified: ['c1-F1'] }) })
  assert(!/A claim "carried" holds/.test(plain.prompts['a validate c1'])) })
await t('C1.1e the allowed files in the claim sentence include those of workstreams already merged', async () => {
  const { prompts } = await go({ cycles: 1, workstreams: [ws('b'), ws('a', { after: ['b'] })] }, { ...outside, 'a validate c1': () => ({ verified: ['c1-F1'] }) })
  assert(prompts['a validate c1'].includes('inside the files this workstream may edit (a/, b/)'), prompts['a validate c1']) })

// ---- C1.2 a soft block reads done ----
await t('C1.2 blocked only on an optional sub-part: status done, the note says it continued, the question at the top level', async () => {
  const { r } = await go({ cycles: 1, workstreams: [ws('a')] }, { 'a implement': () => ({ status: 'blocked', ok: true, questions: [Q('optional: also tint the label?')] }) })
  const a = W(r, 'a')
  assert.equal(a.status, 'done')
  assert(a.merged && a.notes.some(n => /blocked only on an optional question; continued with its default/.test(n)) && r.questions.some(q => /optional: also tint the label/.test(q.q)), JSON.stringify(a)) })
await t('C1.2 (control) a hard block still reads blocked', async () => {
  const { r } = await go({ cycles: 1, workstreams: [ws('a')] }, { 'a implement': () => ({ status: 'blocked', ok: false, sha: '', questions: [Q('contradiction')] }) })
  assert(W(r, 'a').status === 'blocked' && !W(r, 'a').merged) })

// ---- C1.4 dropped workstreams ----
const DROP_S = 'Dropped by the user, not on this branch: a; its absence is never a finding.'
await t('C1.4a a dropped workstream runs no agent; the rest merges and passes; it is listed as not done', async () => {
  const { r, order } = await go({ cycles: 1, resume: 'run-1', dropped: ['a'], workstreams: [ws('a'), ws('b')] }, state({ id: 'a', head: HA, merged: false }, { id: 'b', head: HB, merged: true }))
  assert.deepEqual(ran(order, 'a'), [], order.join())
  assert(order.includes('one validate') && r.repos[0].verdict === 'pass', JSON.stringify(r.repos[0]))
  assert.deepEqual(r.dropped, ['a'])
  assert(r.repos[0].notes.includes('not done (dropped): a') && W(r, 'a').status === 'dropped' && W(r, 'a').dropped === true && !W(r, 'a').merged, JSON.stringify(W(r, 'a'))) })
await t('C1.4b whole-branch prompts and the drift audit leave the dropped brief out and say so (control: no sentence without dropped)', async () => {
  const { prompts } = await go({ cycles: 1, decisionLog: '/t/d.md', dropped: ['a'], workstreams: [ws('a'), ws('b'), ws('c')] }, { 'one validate': (p, k) => k > 1 ? {} : { verdict: 'fail', findings: [F('V-F1')] }, 'one recheck r1': () => ({ verified: ['V-F1'] }) })
  for (const L of ['one review', 'one validate', 'one recheck r1', 'drift']) assert(prompts[L] && !prompts[L].includes('## a\nbrief a') && prompts[L].includes('## b\nbrief b') && prompts[L].includes(DROP_S), L)
  const plain = await go({ cycles: 1, workstreams: [ws('a'), ws('b')] }, {})
  assert(!Object.values(plain.all).flat().some(p => p.includes('Dropped by the user'))) })
await t('C1.4c an unknown dropped id throws, and so does a workstream ordered after a dropped one', async () => {
  await rejects({ dropped: ['zz'], workstreams: [ws('a')] }, /dropped: no workstream zz/)
  await rejects({ dropped: ['a'], workstreams: [ws('a'), ws('b', { after: ['a'] })] }, /workstream b: after a, which is dropped: drop it too or remove the after/)
  await go({ cycles: 1, dropped: ['a', 'b'], workstreams: [ws('a'), ws('b', { after: ['a'] }), ws('c')] }, {}) })
await t('C1.4d dropped but already merged: carried as merged, with an escalation that it stays on the branch', async () => {
  const { r } = await go({ cycles: 1, resume: 'run-2', dropped: ['a'], workstreams: [ws('a'), ws('b')] }, state({ id: 'a', head: HA, merged: true }, { id: 'b', head: HB, merged: true }))
  const a = W(r, 'a')
  assert(a.merged && a.escalations.some(e => e === 'dropped, but already merged into f: it stays on the branch') && r.repos[0].verdict === 'pass', JSON.stringify(a))
  assert.deepEqual(r.dropped, []) })
await t('C1.4e a repo whose every workstream is dropped stays skipped', async () => {
  const { r, order } = await go({ cycles: 1, dropped: ['a'], workstreams: [ws('a')] }, {})
  assert(r.repos[0].verdict === 'skipped' && !order.length, order.join()) })

// ---- the stuck-finding question names its re-run ----
const stubborn = { 'a review c1': () => ({ findings: [F('c1-F1')] }), 'a validate c1': () => ({ open: [F('c1-F1')] }), 'a validate c2': () => ({ open: [F('c1-F1')] }), 'a validate c3': () => ({ open: [F('c1-F1')] }) }
await t('C1.4f the stuck-finding question: drop names dropped, known debt names decisions, and the decision gives the exact re-run', async () => {
  const { r } = await go({ cycles: null, workstreams: [ws('a')] }, stubborn)
  const a = W(r, 'a')
  const q = a.questions.find(q => /still open after 3 fix rounds/.test(q.q))
  assert(q.options.includes('drop this workstream (re-run with dropped: ["a"]; the rest merges and it is listed as not done)'), JSON.stringify(q.options))
  assert(q.options.some(o => o.startsWith('accept it as known debt (re-run with decisions.a = "accept c1-F1 (x.py:3) as known debt"')), JSON.stringify(q.options))
  assert(q.default === q.options[0] && a.decision?.questions[0] === q && /decisions\.a = /.test(a.decision.answer) && /dropped: \["a"\]/.test(a.decision.answer), JSON.stringify(a.decision)) })

await t('C1.4g known debt: the resume settles the accepted finding, never fixes it again, merges and lists it as known debt', async () => {
  const first = await go({ cycles: null, workstreams: [ws('a')] }, stubborn)
  const { r, order } = await go({ cycles: null, resume: 'run-1', carryForward: first.r.carryForward, decisions: { a: 'accept c1-F1 (x.py:3) as known debt' }, workstreams: [ws('a')] }, stubborn)
  const a = W(r, 'a')
  assert(a.merged && a.findingsFixed === 0 && !order.includes('a fix c1') && r.repos[0].verdict === 'pass', JSON.stringify({ a, order }))
  assert(a.findings.find(e => e.id === 'p:c1-F1')?.status === 'debt' && a.notes.includes('known debt (accepted by the user): p:c1-F1 (x.py:3: issue c1-F1)'), JSON.stringify(a))
  await rejects({ cycles: null, resume: 'run-1', decisions: { a: 'accept c1-F1 (x.py:3) as known debt' }, workstreams: [ws('a')] }, /decisions\.a accepts c1-F1 as known debt, but carryForward has no such finding of a/) })
await t('C1.4h (control) a plain decision is no known debt: the restored blocker still runs the fix loop', async () => {
  const first = await go({ cycles: null, workstreams: [ws('a')] }, stubborn)
  const { order } = await go({ cycles: null, resume: 'run-1', carryForward: first.r.carryForward, decisions: { a: 'change the brief: x.py:3 may keep its old shape' }, workstreams: [ws('a')] }, stubborn)
  assert(order.includes('a fix c1'), order.join()) })
await t('C1.4i a non-array dropped gets the argument error, not a raw TypeError', async () => {
  for (const d of [5, true, { a: 1 }]) await rejects({ cycles: 1, dropped: d, workstreams: [ws('a')] }, /^dropped must be an array of workstream ids$/) })

// ---- friction (a): files[] overlap allowed between after-ordered workstreams ----
await t('FA after-ordered workstreams may share files; the merge backstop names each path once', async () => {
  const { r, prompts } = await go({ cycles: 1, workstreams: [ws('a', { files: ['big.js'] }), ws('b', { files: ['big.js'], after: ['a'] })] }, {})
  assert(W(r, 'b').merged, JSON.stringify(W(r, 'b')))
  assert.equal(prompts['b merge'].split("':(glob,exclude)big.js'").length, 2, prompts['b merge'])
  await go({ cycles: 1, workstreams: [ws('a', { files: ['big.js'] }), ws('b', { after: ['a'] }), ws('c', { files: ['big.js'], after: ['b'] })] }, {}) })
await t('FA (control) unordered workstreams sharing a file still throw', async () => {
  await rejects({ workstreams: [ws('a', { files: ['big.js'] }), ws('b', { files: ['big.js'] })] }, /workstreams a and b overlap on big\.js/) })
await t('FA a later workstream sharing files is never listed as off-limits to the earlier one', async () => {
  const { prompts } = await go({ cycles: 1, workstreams: [ws('x'), ws('a', { files: ['big.js'], after: ['x'] }), ws('b', { files: ['big.js'], after: ['a'] })] }, { 'a review c1': () => ({ findings: [F('c1-F1')] }), 'a validate c1': () => ({ verified: ['c1-F1'] }) })
  assert(!/Never touch files owned by workstreams not merged yet: [^\n]*b \(big\.js\)/.test(prompts['a fix c1']), prompts['a fix c1']) })
await t('FA (control) a later workstream with disjoint files stays off-limits to the earlier one', async () => {
  const { prompts } = await go({ cycles: 1, workstreams: [ws('x'), ws('a', { after: ['x'] }), ws('b', { after: ['a'] })] }, { 'a review c1': () => ({ findings: [F('c1-F1')] }), 'a validate c1': () => ({ verified: ['c1-F1'] }) })
  assert(/Never touch files owned by workstreams not merged yet: b \(b\/\)\./.test(prompts['a fix c1']), prompts['a fix c1']) })

if (fails.length) { console.error(fails.join('\n')); process.exit(1) }
console.log('check20 ok')
