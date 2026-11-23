// A question that names a handed finding leaves `questions` once the whole-branch pass fixed that finding (recheck passed, fixes promoted).
// Every scenario fails against the 0.4.2 script except the ones marked (control).
import { Run } from './run.mjs'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
const SHA = n => (n + '').padStart(40, 'a')
const parallel = fs => Promise.all(fs.map(f => f().catch(() => null)))
const free = { total: null, spent: () => 0, remaining: () => Infinity }
const push = { status: 'done', ok: true, tests: 't', gateTail: 'gate exit=0', sharedEdits: [], decisions: [], questions: [], notes: [] }
const green = { green: true, summary: '12 passed', command: 'npm test', flaky: [] }
const F = (id, severity = 'major', where = 'x.py:3') => ({ id, severity, kind: 'bug', where, issue: `issue ${id}`, evidence: 'test t1 red' })
const Q = q => ({ q, options: ['keep the test', 'edit the test'], default: 'keep the test' })
function mock(args, sc = {}) {
  const prompts = {}, all = {}, order = []
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
    if (L.endsWith('merge')) { const pre = head[repo] || SHA(40); head[repo] = SHA(500 + ++n); return { ...push, sha: head[repo], preMergeSha: pre, baseAtMerge: SHA(40), ...own } }
    if (L.endsWith(' review')) return { headSha: head[repo] || SHA(4000), findings: [], seams: 'none', ...own }
    if (L.endsWith(' validate')) return { verdict: 'pass', sections: 's', sha: head[repo] || SHA(4000), tests: 't', gate: green, findings: [], verified: [], questions: [], ...own }
    if (/fix r(\d)/.test(L)) { const r = { ...push, sha: SHA(70 + +L.at(-1)), answers: [], ...own }; head[repo] = r.sha; return r }
    if (/recheck r\d/.test(L)) return { verdict: 'pass', sections: 's', sha: head[repo], tests: 't', gate: green, findings: [], verified: [], questions: [], ...own }
    if (L.endsWith(' docs')) return { baseSha: head[repo] || SHA(4000), sha: '', files: [], prBody: false, ok: true, tests: 't', notes: [], ...own }
    if (L.endsWith(' promote')) return { ok: true, sha: (p.match(/ to ([0-9a-f]{40})\./) || [])[1], notes: [], ...own }
    if (L === 'contracts') return { verdict: 'pass', sections: 's', findings: [], ...own }
    throw new Error('unmocked ' + L)
  }
  return { agent, prompts, all, order }
}
const ws = (id, extra = {}) => ({ id, repo: '/r/one', featureBranch: 'f', branch: `f--${id}`, model: 'sonnet', brief: `brief ${id}`, gate: 'npm test', files: [`${id}/`], ...extra })
const go = async (args, sc) => {
  const m = mock(args, sc)
  let timer
  const hung = new Promise((_, no) => { timer = setTimeout(() => no(new Error('the run hung')), 2000) })
  const r = await Promise.race([Run(args, m.agent, parallel, () => {}, free), hung]).finally(() => clearTimeout(timer))
  return { r, ...m }
}
const fails = []
const t = async (name, fn) => { try { await fn() } catch (e) { fails.push(`${name}: ${e.message.split('\n')[0]}`) } }
const W = (r, id) => r.workstreams.find(w => w.id === id)
const HA = SHA(1001)

// ---- 1. a question about a handed finding the whole-branch pass fixed ----
const stale = Q('c1-F1: should the whole-branch pass edit the read-only base test b/old.test.js?')
const C = F('c1-F1', 'critical', 'b/old.test.js:3')
const carry = (q, own = {}) => ({
  'a review c1': () => ({ findings: [C] }),
  'a fix c1': () => ({ answers: [{ id: 'c1-F1', action: 'carried', note: 'b/old.test.js is a base test outside a/' }] }),
  'a validate c1': () => ({ verified: ['c1-F1'], questions: [q] }),
  'one validate': () => ({ verdict: 'fail', findings: [F('V-F1', 'critical', 'b/old.test.js:3')] }),
  'one fix r1': () => ({ answers: [{ id: 'V-F1', action: 'fixed', note: 'flipped' }, { id: 'a:c1-F1', action: 'fixed', note: 'flipped' }] }),
  'one recheck r1': () => ({ verified: ['V-F1', 'a:c1-F1'] }),
  ...own,
})
const one = { cycles: 1, workstreams: [ws('a')] }
const asked = (r, q, who = 'a') => r.questions.some(x => x.q === `${who}: ${q.q}`)
await t('1a the question leaves questions, with a repo note, once the handed finding it names ended fixed', async () => {
  const { r } = await go(one, carry(stale))
  assert(r.repos[0].verdict === 'pass' && r.repos[0].findings.find(e => e.id === 'a:c1-F1')?.status === 'fixed', 'handed finding fixed')
  assert(!asked(r, stale) && !W(r, 'a').questions.some(q => q.q === stale.q), JSON.stringify(r.questions))
  assert(r.repos[0].notes.some(x => x.includes('a:c1-F1') && x.includes(stale.q)), JSON.stringify(r.repos[0].notes)) })
await t('1b (control) a pass that fails keeps the question', async () => {
  const still = () => ({ verdict: 'fail', findings: [{ ...C, id: 'a:c1-F1' }] })
  const { r } = await go(one, carry(stale, { 'one recheck r1': still, 'one recheck r2': still }))
  assert(r.repos[0].verdict === 'fail' && asked(r, stale), JSON.stringify(r.questions)) })
await t('1c (control) a question that does not start with the handed id stays', async () => {
  const other = Q('the brief and the repo disagree on the field name (see c1-F1)')
  const { r } = await go(one, carry(other))
  assert(r.repos[0].verdict === 'pass' && asked(r, other), JSON.stringify(r.questions)) })
await t('1d (control) a handed finding the whole-branch fixer escalated keeps its question', async () => {
  const { r } = await go(one, carry(stale, { 'one fix r1': () => ({ answers: [{ id: 'V-F1', action: 'fixed', note: 'n' }, { id: 'a:c1-F1', action: 'escalated', note: 'brief vs repo' }] }) }))
  assert(asked(r, stale), JSON.stringify(r.questions)) })
await t('1e (control) the whole-branch fixer is still never shown a validator question', async () => {
  const { prompts } = await go(one, carry(stale))
  assert(prompts['one fix r1'] && !prompts['one fix r1'].includes(stale.q) && !/settles/.test(prompts['one fix r1'])) })
await t('1f the workstream-tagged id form is dropped too', async () => {
  const tagged = Q('a:c1-F1: may the whole-branch pass edit b/old.test.js?')
  const { r } = await go(one, carry(tagged))
  assert(r.repos[0].verdict === 'pass' && !asked(r, tagged), JSON.stringify(r.questions)) })
await t('1g a question the whole-branch validator or the recheck raised about it is dropped from the repo\'s questions', async () => {
  const wbQ = Q('a:c1-F1: the user has not answered whether b/old.test.js may change'), reQ = Q('a:c1-F1: may the flipped assertion stay?')
  const { r } = await go(one, carry(Q('unrelated'), { 'one validate': () => ({ verdict: 'fail', findings: [F('V-F1', 'critical', 'b/old.test.js:3')], questions: [wbQ] }), 'one recheck r1': () => ({ verified: ['V-F1', 'a:c1-F1'], questions: [reQ] }) }))
  for (const x of [wbQ, reQ]) assert(r.repos[0].verdict === 'pass' && !r.questions.some(q => q.q.includes(x.q)) && !r.repos[0].questions.some(q => q.q === x.q), JSON.stringify(r.questions))
  assert(asked(r, Q('unrelated')), 'the unrelated question stays') })
const look = 'open the preview and look at the chart'
const wb = (id = 'a:p:c1-F1') => ({
  'one validate': () => ({ verdict: 'fail', findings: [F('V-F1', 'critical', 'b/old.test.js:3')] }),
  'one fix r1': () => ({ answers: [{ id: 'V-F1', action: 'fixed', note: 'flipped' }, { id, action: 'fixed', note: 'flipped' }] }),
  'one recheck r1': () => ({ verified: ['V-F1', id] }),
})
const SETTLED_NOTE = 'a question from an earlier call under the "a: " tag that starts with c1-F1, or any that starts with a:c1-F1, is settled'
await t('1h a handed finding a later call fixed leaves a repo note naming its id, for the question held from the paused call', async () => {
  const args = x => ({ cycles: 1, workstreams: [ws('a', { humanCheck: look })], ...x })
  const { r: r1 } = await go(args(), carry(stale))
  assert(r1.humanCheck?.length && asked(r1, stale), 'call 1 pauses holding the question')
  const H = r1.humanCheck[0].sha
  const { r } = await go(args({ resume: 'run-1', carryForward: r1.carryForward, humanChecks: { a: { sha: H, answer: 'ok' } } }), { 'one state': () => ({ workstreams: [{ id: 'a', head: H, merged: true }] }), ...wb() })
  assert(r.repos[0].verdict === 'pass' && r.repos[0].findings.find(e => e.id === 'a:p:c1-F1')?.status === 'fixed', JSON.stringify(r.repos[0].findings))
  assert(r.repos[0].notes.some(x => x.includes('a:p:c1-F1') && x.includes(SETTLED_NOTE)), JSON.stringify(r.repos[0].notes)) })
await t('1i so does a resume after a failed whole-branch pass', async () => {
  const still = () => ({ verdict: 'fail', findings: [{ ...C, id: 'a:c1-F1' }] })
  const { r: r1 } = await go(one, carry(stale, { 'one recheck r1': still, 'one recheck r2': still }))
  assert(r1.repos[0].verdict === 'fail' && asked(r1, stale), 'call 1 fails holding the question')
  const { r } = await go({ ...one, resume: 'run-1', carryForward: r1.carryForward }, { 'one state': () => ({ workstreams: [{ id: 'a', head: W(r1, 'a').validatedSha, merged: true }] }), ...wb() })
  assert(r.repos[0].verdict === 'pass' && r.repos[0].notes.some(x => x.includes(SETTLED_NOTE)), JSON.stringify(r.repos[0].notes)) })
await t('1j (control) whole-branch fixes that are not promoted keep the question', async () => {
  const { r } = await go(one, carry(stale, { 'one promote': () => ({ ok: false, notes: ['the side branch moved'] }) }))
  assert(r.repos[0].verdict === 'fail' && asked(r, stale), JSON.stringify(r.questions)) })
await t('1k (control) a handed finding the whole-branch pass declined or answered keeps its question', async () => {
  for (const action of ['declined', 'answered']) {
    const { r } = await go(one, carry(stale, { 'one fix r1': () => ({ answers: [{ id: 'V-F1', action: 'fixed', note: 'n' }, { id: 'a:c1-F1', action, note: 'n' }] }) }))
    assert(r.repos[0].findings.find(e => e.id === 'a:c1-F1')?.status === action && asked(r, stale), `${action}: ${JSON.stringify(r.questions)}`) } })
await t('1l with two workstreams only the fixed one\'s own and tagged questions leave', async () => {
  const X = F('c1-F1', 'critical', 'x/old.test.js:3'), own = w => ({
    [`${w} review c1`]: () => ({ findings: [X] }),
    [`${w} fix c1`]: () => ({ answers: [{ id: 'c1-F1', action: 'carried', note: 'x/ is a base test' }] }),
    [`${w} validate c1`]: () => ({ verified: ['c1-F1'], questions: [Q(`c1-F1: ${w} local`)] }) })
  const { r } = await go({ cycles: 1, workstreams: [ws('a'), ws('b')] }, { ...own('a'), ...own('b'),
    'one validate': () => ({ verdict: 'fail', findings: [F('V-F1', 'critical', 'x/old.test.js:3')], questions: [Q('a:c1-F1: wb a'), Q('b:c1-F1: wb b'), Q('c1-F1: untagged')] }),
    'one fix r1': () => ({ answers: [{ id: 'V-F1', action: 'fixed', note: 'f' }, { id: 'a:c1-F1', action: 'fixed', note: 'f' }, { id: 'b:c1-F1', action: 'escalated', note: 'a brief names x/' }] }),
    'one recheck r1': () => ({ verified: ['V-F1', 'a:c1-F1', 'b:c1-F1'] }) })
  const qs = r.questions.map(q => q.q).sort()
  const keep = ['b: c1-F1: b local', 'one: b:c1-F1: wb b', 'one: c1-F1: untagged']
  assert(r.repos[0].verdict === 'pass' && keep.every(k => qs.includes(k)) && qs.some(q => q.startsWith('one: b:c1-F1 (x/old.test.js:3')) && qs.length === 4, JSON.stringify(qs)) })
const settled = r => r.repos[0].notes.filter(x => x.includes('is settled'))
const resumeAt = (r1, x, sc) => go({ ...x, resume: 'run-1', carryForward: r1.carryForward }, { 'one state': () => ({ workstreams: r1.workstreams.filter(w => w.merged).map(w => ({ id: w.id, head: w.validatedSha, merged: true })) }), ...sc })
await t('1m with two workstreams the earlier-call note scopes the untagged id to its own workstream', async () => {
  const X = F('c1-F1', 'critical', 'x/old.test.js:3'), own = w => ({
    [`${w} review c1`]: () => ({ findings: [X] }),
    [`${w} fix c1`]: () => ({ answers: [{ id: 'c1-F1', action: 'carried', note: 'x/ is a base test' }] }),
    [`${w} validate c1`]: () => ({ verified: ['c1-F1'], questions: [Q(`c1-F1: ${w} asks`)] }) })
  const two = { cycles: 1, workstreams: [ws('a'), ws('b')] }
  const still = () => ({ verdict: 'fail', findings: [{ ...X, id: 'a:c1-F1' }, { ...X, id: 'b:c1-F1' }] })
  const { r: r1 } = await go(two, { ...own('a'), ...own('b'), 'one recheck r1': still, 'one recheck r2': still })
  assert(r1.repos[0].verdict === 'fail' && ['a', 'b'].every(w => r1.questions.some(q => q.q === `${w}: c1-F1: ${w} asks`)), 'call 1 holds both questions')
  const { r } = await resumeAt(r1, two, {
    'one validate': () => ({ verdict: 'fail', findings: [F('V-F1', 'critical', 'x/old.test.js:3')] }),
    'one fix r1': () => ({ answers: [{ id: 'V-F1', action: 'fixed', note: 'f' }, { id: 'a:p:c1-F1', action: 'fixed', note: 'f' }, { id: 'b:p:c1-F1', action: 'declined', note: 'n' }] }),
    'one recheck r1': () => ({ verified: ['V-F1', 'a:p:c1-F1', 'b:p:c1-F1'] }) })
  const n = settled(r)
  assert(r.repos[0].verdict === 'pass' && n.length === 1 && n[0].includes(SETTLED_NOTE) && !n.some(x => x.includes('"b: "') || x.includes('b:c1-F1')), JSON.stringify(r.repos[0].notes)) })
await t('1n (control) an earlier-call handed finding the whole-branch pass escalated leaves no settled note', async () => {
  const still = () => ({ verdict: 'fail', findings: [{ ...C, id: 'a:c1-F1' }] })
  const { r: r1 } = await go(one, carry(stale, { 'one recheck r1': still, 'one recheck r2': still }))
  const { r } = await resumeAt(r1, one, { ...wb(), 'one fix r1': () => ({ answers: [{ id: 'V-F1', action: 'fixed', note: 'f' }, { id: 'a:p:c1-F1', action: 'escalated', note: 'a brief names b/' }] }) })
  assert(r.repos[0].verdict === 'pass' && !settled(r).length, JSON.stringify(r.repos[0].notes)) })
await t('1o a third call names every earlier form of the id', async () => {
  const still = id => () => ({ verdict: 'fail', findings: [{ ...C, id }] })
  const { r: r1 } = await go(one, carry(stale, { 'one recheck r1': still('a:c1-F1'), 'one recheck r2': still('a:c1-F1') }))
  const { r: r2 } = await resumeAt(r1, one, { 'one validate': () => ({ verdict: 'fail', findings: [{ ...C, id: 'a:p:c1-F1' }] }), 'one recheck r1': still('a:p:c1-F1'), 'one recheck r2': still('a:p:c1-F1') })
  assert(r2.repos[0].verdict === 'fail', 'call 2 fails too')
  const { r } = await resumeAt({ ...r2, workstreams: r1.workstreams }, one, wb('a:p:p:c1-F1'))
  assert(r.repos[0].notes.some(x => x.includes('a question from an earlier call under the "a: " tag that starts with p:c1-F1 or c1-F1, or any that starts with a:p:c1-F1 or a:c1-F1, is settled')), JSON.stringify(r.repos[0].notes)) })
await t('1p a handed finding fixed in a failed whole-branch pass stays handed, so the resume fixes it and names it', async () => {
  const other = F('V-F1', 'major', 'a/x.js:1')
  const { r: r1 } = await go(one, carry(stale, {
    'one validate': () => ({ verdict: 'fail', findings: [other] }),
    'one fix r1': () => ({ answers: [{ id: 'a:c1-F1', action: 'fixed', note: 'flipped' }, { id: 'V-F1', action: 'fixed', note: 'n' }] }),
    'one recheck r1': () => ({ verdict: 'fail', verified: ['a:c1-F1'], findings: [other] }),
    'one recheck r2': () => ({ verdict: 'fail', findings: [other] }) }))
  assert(r1.repos[0].verdict === 'fail' && r1.carryForward.workstreams.a.handed.some(h => h.id === 'c1-F1'), JSON.stringify(r1.carryForward.workstreams.a.handed))
  const { r, prompts } = await resumeAt(r1, one, wb())
  assert(/Handed findings \(a:p:c1-F1/.test(prompts['one validate']) && /Handed findings \(a:p:c1-F1/.test(prompts['one fix r1']), 'the resume keeps the handed rule')
  assert(r.repos[0].verdict === 'pass' && r.repos[0].notes.some(x => x.includes(SETTLED_NOTE)), JSON.stringify(r.repos[0].notes)) })
await t('1q (control) a longer id that shares the prefix stays', async () => {
  const longer = Q('c1-F10: is the other base test stale too?')
  const { r } = await go(one, carry(longer))
  assert(r.repos[0].verdict === 'pass' && asked(r, longer), JSON.stringify(r.questions)) })
await t('1r a resumed call drops its own question in the p: form', async () => {
  const still = () => ({ verdict: 'fail', findings: [{ ...C, id: 'a:c1-F1' }] })
  const { r: r1 } = await go(one, carry(stale, { 'one recheck r1': still, 'one recheck r2': still }))
  const pq = Q('a:p:c1-F1: may b/old.test.js change now?')
  const { r } = await resumeAt(r1, one, { ...wb(), 'one validate': () => ({ verdict: 'fail', findings: [F('V-F1', 'critical', 'b/old.test.js:3')], questions: [pq] }) })
  assert(r.repos[0].verdict === 'pass' && !r.questions.some(q => q.q.includes(pq.q)), JSON.stringify(r.questions)) })
await t('1s (control) a repo question that names the tagged id later in its text stays', async () => {
  const later = Q('the base test b/old.test.js may change (see a:c1-F1)')
  const { r } = await go(one, carry(Q('unrelated'), { 'one validate': () => ({ verdict: 'fail', findings: [F('V-F1', 'critical', 'b/old.test.js:3')], questions: [later] }) }))
  assert(r.repos[0].verdict === 'pass' && r.questions.some(q => q.q === `one: ${later.q}`), JSON.stringify(r.questions)) })
await t('1t a handed finding verified with no new commit still drops its question', async () => {
  const atHead = p => ({ sha: p.match(/detached at ([0-9a-f]{40})/)[1], answers: [{ id: 'V-F1', action: 'answered', note: 'the merge fixed it' }, { id: 'a:c1-F1', action: 'fixed', note: 'the merge fixed it' }] })
  const { r } = await go(one, carry(stale, { 'one fix r1': atHead }))
  assert(r.repos[0].verdict === 'pass' && r.repos[0].findings.find(e => e.id === 'a:c1-F1')?.status === 'fixed' && !asked(r, stale), JSON.stringify(r.questions)) })
await t('1u two handed findings are both listed in every whole-branch prompt', async () => {
  const D = F('c1-F2', 'major', 'b/other.test.js:7')
  const { prompts } = await go(one, carry(stale, { 'a review c1': () => ({ findings: [C, D] }), 'a fix c1': () => ({ answers: ['c1-F1', 'c1-F2'].map(id => ({ id, action: 'carried', note: 'outside a/' })) }), 'a validate c1': () => ({ verified: ['c1-F1', 'c1-F2'], questions: [stale] }) }))
  for (const L of ['one validate', 'one recheck r1']) assert(prompts[L].includes('Handed findings (a:c1-F1 (b/old.test.js:3), a:c1-F2 (b/other.test.js:7))'), L)
  assert(prompts['one fix r1'].includes('Handed findings (a:c1-F1, a:c1-F2)'), 'fixer') })

// ---- 2. every prompt on the handed path gives the same answer ----
await t('2a the delta validator that verifies a carried claim is told what that licenses, and to start any question about it with the id', async () => {
  const p = (await go(one, carry(stale))).prompts['a validate c1']
  assert(/Once you verify a "carried" claim, the whole-branch pass fixes that finding in any file, pre-existing tests included \(except a file a brief names by path, directory or glob as not to be edited\); that needs no question\./.test(p), 'licence')
  assert(/start it with the finding's id \(e\.g\. "c1-F1: \.\.\."\)/.test(p), 'id sentence') })
await t('2b (control) with no carried claim the delta validator gets no such sentence', async () => {
  const { prompts } = await go(one, { 'a review c1': () => ({ findings: [F('c1-F1')] }), 'a validate c1': () => ({ verified: ['c1-F1'] }) })
  assert(prompts['a validate c1'] && !/Once you verify a "carried" claim/.test(prompts['a validate c1'])) })
const RULE = tail => new RegExp(`Handed findings \\(a:c1-F1 \\(b/old\\.test\\.js:3\\)\\) are this pass's to fix in any file, pre-existing tests included, except a file a brief names by path, directory or glob as not to be edited: ${tail}\\. An open question about a handed finding never holds its fix\\.`)
await t('2c the whole-branch validator and the recheck get the handed rule with its carve-out, each finding with its place', async () => {
  const { prompts } = await go(one, carry(stale))
  assert(RULE('the hard-clause rule stands for it').test(prompts['one recheck r1']), 'recheck')
  assert(RULE('that one is not this pass\'s to edit').test(prompts['one validate']) && !/hard-clause rule/.test(prompts['one validate']), 'validator')
  assert(/the handed finding is the reason the test-integrity check asks for/.test(prompts['one recheck r1']) && !/the reason the test-integrity check asks for/.test(prompts['one validate']), 'the test-integrity clause is the recheck\'s only') })
await t('2d (control) with nothing handed neither gets it', async () => {
  const { prompts } = await go(one, { 'one validate': () => ({ verdict: 'fail', findings: [F('V-F1')] }), 'one recheck r1': () => ({ verified: ['V-F1'] }) })
  for (const L of ['one validate', 'one recheck r1']) assert(prompts[L] && !/Handed findings/.test(prompts[L]), L) })
await t('2e the whole-branch fixer\'s handed rule escalates only when a finding says a brief names the file', async () => {
  const { prompts } = await go(one, carry(stale))
  assert(/pre-existing tests included \(never escalated for that\), unless a finding says a brief names that file by path, directory or glob as not to be edited: escalate that one\./.test(prompts['one fix r1'])) })
const RO = 'Make ledger.rounding.round_total round half up. Pre-existing tests are read-only: do not edit, delete, rename or skip them; add new tests as needed.'
const BAR = 'A clause that names no path, directory or glob does not bar a handed fix.'
await t('2f a brief clause that protects by class, not by path, does not bar a handed fix in any of the four prompts', async () => {
  const { prompts } = await go({ cycles: 1, workstreams: [ws('a', { brief: RO })] }, carry(stale))
  for (const L of ['a validate c1', 'one validate', 'one fix r1', 'one recheck r1']) assert(prompts[L].includes(BAR), L)
  const plain = (await go({ cycles: 1, workstreams: [ws('a', { brief: RO })] }, { 'a review c1': () => ({ findings: [F('c1-F1')] }), 'a validate c1': () => ({ verified: ['c1-F1'] }), 'one validate': () => ({ verdict: 'fail', findings: [F('V-F1')] }), 'one recheck r1': () => ({ verified: ['V-F1'] }) })).prompts
  for (const L of ['a validate c1', 'one validate', 'one fix r1', 'one recheck r1']) assert(plain[L] && !plain[L].includes('does not bar a handed fix'), `${L} without a handed finding`) })

// ---- 4. S21's resume leg (spec only: no red test of its own beyond the text pin) ----
const ANSWER = 'The brief stands as written. Change only this workstream\'s files; a test that then fails is for the later stages.'
await t('4a fixture-scenarios.md gives S21 its resume leg, the exact answer and the new void reason', async () => {
  const s = readFileSync(new URL('./fixture-scenarios.md', import.meta.url), 'utf8')
  assert(/1 call, or 2 when the author hard-blocks/.test(s) && s.includes(`"${ANSWER}"`) && /the resumed author edits the stale test under the answer/.test(s), 'S21 bullet')
  assert(s.includes('a resumed result is recorded apart and never pooled with a one-call result when a rate is reported'), 'the two legs are never pooled') })
await t('4b a hard-blocked author resumed with that answer reaches the carry and the whole-branch fix', async () => {
  const c1 = await go(one, { 'a implement': () => ({ status: 'blocked', ok: false, sha: '', questions: [Q('the brief contradicts b/old.test.js')] }) })
  assert(!W(c1.r, 'a').merged && c1.r.workstreams[0].decision, 'call 1 blocks with a decision')
  const c2 = await go({ ...one, resume: 'run-1', carryForward: c1.r.carryForward, decisions: { a: ANSWER } }, carry(stale))
  assert(c2.prompts['a implement'].includes(ANSWER), 'the answer joins the brief')
  assert(W(c2.r, 'a').merged && W(c2.r, 'a').cyclesRun === 1 && c2.r.repos[0].findings.find(e => e.id === 'a:c1-F1')?.status === 'fixed', JSON.stringify(c2.r.repos[0].findings))
  assert(!asked(c2.r, stale), JSON.stringify(c2.r.questions)) })

// ---- docs and version ----
await t('3a SKILL.md states the drop; plugin.json is at least 0.4.3', async () => {
  const s = readFileSync(new URL('../SKILL.md', import.meta.url), 'utf8')
  assert(/dropped the question about it/.test(s), 'the drop note')
  assert(/drop\s+a\s+held\s+question\s+that\s+starts\s+with\s+an\s+id\s+such\s+a\s+note\s+names/.test(s) && /a\s+question\s+from\s+an\s+earlier\s+call\s+under\s+the\s+\"<ws\s+id>:\s+\"\s+tag/.test(s) && /the\s+bare\s+`<id>`\s+only\s+under\s+that\s+workstream's\s+tag/.test(s), 'the held-question drop')
  assert(s.includes('a file a brief names by path, directory or glob as not to be edited') && !/may not stop that fix/.test(s), 'the widened carve-out')
  assert(/under\s+the\s+"<ws\s+id>:\s+"\s+tag\s+that\s+starts\s+with\s+<id>,\s+or\s+any\s+that\s+starts\s+with\s+<ws\s+id>:<id>/.test(s), 'the scoped earlier-call note')
  assert(/clean-review\s+validator\s+asks\s+before\s+any\s+finding\s+is\s+carried/.test(s), 'the clean-review limit')
  assert(/reuses\s+a\s+finding\s+id\s+across\s+calls/.test(s), 'the reused-id limit')
  const v = JSON.parse(readFileSync(new URL('../../../.claude-plugin/plugin.json', import.meta.url), 'utf8')).version.split('.').map(Number); assert(v[0] > 0 || v[1] > 4 || (v[1] === 4 && v[2] >= 3), 'at least 0.4.3') })

if (fails.length) { console.error(fails.join('\n')); process.exit(1) }
console.log('check25 ok')
