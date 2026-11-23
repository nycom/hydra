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
  const wbQ = Q('a:c1-F1: the user has not answered whether b/old.test.js may change')
  const { r } = await go(one, carry(Q('unrelated'), { 'one validate': () => ({ verdict: 'fail', findings: [F('V-F1', 'critical', 'b/old.test.js:3')], questions: [wbQ] }) }))
  assert(r.repos[0].verdict === 'pass' && !r.questions.some(q => q.q.includes(wbQ.q)) && !r.repos[0].questions.some(q => q.q === wbQ.q), JSON.stringify(r.questions))
  assert(asked(r, Q('unrelated')), 'the unrelated question stays') })

// ---- 2. every prompt on the handed path gives the same answer ----
await t('2a the delta validator that verifies a carried claim is told what that licenses, and to start any question about it with the id', async () => {
  const p = (await go(one, carry(stale))).prompts['a validate c1']
  assert(/Once you verify a "carried" claim, the whole-branch pass fixes that finding in any file, pre-existing tests included \(except a file a brief names as not to be edited\); that needs no question\./.test(p), 'licence')
  assert(/start it with the finding's id \(e\.g\. "c1-F1: \.\.\."\)/.test(p), 'id sentence') })
await t('2b (control) with no carried claim the delta validator gets no such sentence', async () => {
  const { prompts } = await go(one, { 'a review c1': () => ({ findings: [F('c1-F1')] }), 'a validate c1': () => ({ verified: ['c1-F1'] }) })
  assert(prompts['a validate c1'] && !/Once you verify a "carried" claim/.test(prompts['a validate c1'])) })
const RULE = tail => new RegExp(`Handed findings \\(a:c1-F1 \\(b/old\\.test\\.js:3\\)\\) are this pass's to fix in any file, pre-existing tests included, except a file a brief names as not to be edited: ${tail}\\. An open question about a handed finding never holds its fix\\.`)
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
  assert(/pre-existing tests included \(never escalated for that\), unless a finding says a brief names that file as not to be edited: escalate that one\./.test(prompts['one fix r1'])) })

// ---- 4. S21's resume leg (spec only: no red test of its own beyond the text pin) ----
const ANSWER = 'The brief stands as written. Change only this workstream\'s files; a test that then fails is for the later stages.'
await t('4a fixture-scenarios.md gives S21 its resume leg, the exact answer and the new void reason', async () => {
  const s = readFileSync(new URL('./fixture-scenarios.md', import.meta.url), 'utf8')
  assert(/1 call, or 2 when the author hard-blocks/.test(s) && s.includes(`"${ANSWER}"`) && /the resumed author edits the stale test under the answer/.test(s), 'S21 bullet') })
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
  const v = JSON.parse(readFileSync(new URL('../../../.claude-plugin/plugin.json', import.meta.url), 'utf8')).version.split('.').map(Number); assert(v[0] > 0 || v[1] > 4 || (v[1] === 4 && v[2] >= 3), 'at least 0.4.3') })

if (fails.length) { console.error(fails.join('\n')); process.exit(1) }
console.log('check25 ok')
