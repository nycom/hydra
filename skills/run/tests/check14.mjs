// Full-range test guard in a workstream's first validator, brief conflicts as questions (fixers and validators),
// fixes judged against the brief's hard clauses, the reviewer told it never sees notes, and every question rolled up top-level.
// Every scenario fails against the 0.3.6 script except the ones marked (control).
import { Run } from './run.mjs'
import assert from 'node:assert'
const SHA = n => (n + '').padStart(40, 'a')
const parallel = fs => Promise.all(fs.map(f => f().catch(() => null)))
const free = { total: null, spent: () => 0, remaining: () => Infinity }
const push = { status: 'done', ok: true, tests: 't', gateTail: 'exit 0', sharedEdits: [], decisions: [], questions: [], notes: [] }
const green = { green: true, summary: '12 passed', command: 'npm test', flaky: [] }
const F = (id, severity = 'major', where = 'x.py:3') => ({ id, severity, kind: 'bug', where, issue: `issue ${id}`, evidence: 'test t1 red' })
const Q = q => ({ q, options: ['keep the brief as is', 'change the brief'], default: 'keep the brief as is' })
function mock(args, sc = {}) {
  const prompts = {}, schemas = {}, all = {}
  const head = {}
  const repoOf = L => { const w = args.workstreams.find(w => L.startsWith(`${w.id} `)); return w ? w.repo : `/r/${L.split(' ')[0]}` }
  const agent = async (p, o) => {
    const L = o.label.replace(/ attempt \d$/, '')
    prompts[L] = p; schemas[L] = o.schema; (all[L] ||= []).push(p)
    const id = L.split(' ')[0]
    const repo = repoOf(L)
    const own = sc[L]?.(p, all[L].length)
    if (own === null) return null
    if (L.endsWith('implement')) return (head[id] = SHA(id.length), { ...push, sha: head[id], ...own })
    if (/fix c(\d)/.test(L)) { const r = { ...push, sha: SHA(10 + +L.at(-1)), answers: [], ...own }; head[id] = r.sha; return r }
    if (/review c\d/.test(L)) return { headSha: head[id], findings: [], ...own }
    if (/validate c\d/.test(L)) return { headSha: head[id], gate: green, evidence: 'e', verified: [], open: [], ...own }
    if (L.endsWith('merge')) { const pre = head[repo] || SHA(40); head[repo] = SHA(50 + Object.keys(head).length); return { ...push, sha: head[repo], preMergeSha: pre, baseAtMerge: SHA(40), ...own } }
    if (L.endsWith(' review')) return { headSha: head[repo], findings: [], seams: 'none', ...own }
    if (L.endsWith(' validate')) return { verdict: 'pass', sections: 's', sha: head[repo], tests: 't', gate: green, findings: [], verified: [], ...own }
    if (/fix r(\d)/.test(L)) { const r = { ...push, sha: SHA(70 + +L.at(-1)), answers: [], ...own }; head[repo] = r.sha; return r }
    if (/recheck r\d/.test(L)) return { verdict: 'pass', sections: 's', sha: head[repo], tests: 't', gate: green, findings: [], verified: [], ...own }
    if (L.endsWith(' docs')) return { baseSha: head[repo], sha: '', files: [], prBody: false, ok: true, tests: 't', notes: [], ...own }
    if (L.endsWith(' promote')) return { ok: true, sha: (p.match(/ to ([0-9a-f]{40})\./) || [])[1], notes: [], ...own }
    if (L === 'contracts') return { verdict: 'pass', sections: 's', findings: [], ...own }
    throw new Error('unmocked ' + L)
  }
  return { agent, prompts, schemas, all }
}
const BRIEF = 'Finish summary(); call ledger.owners.distinct_owners and do not edit ledger/owners.py.'
const ws = (id, extra = {}) => ({ id, repo: '/r/one', featureBranch: 'f', branch: `f--${id}`, model: 'sonnet', brief: BRIEF, gate: 'npm test', ...extra })
const go = async (args, sc) => { const m = mock(args, sc); const r = await Run(args, m.agent, parallel, () => {}, free); return { r, ...m } }
const fails = []
const t = async (name, fn) => { try { await fn() } catch (e) { fails.push(`${name}: ${e.message.split('\n')[0]}`) } }
const one = { cycles: 1, workstreams: [ws('a')] }
const FULL = h => `git diff --diff-filter=MDR --name-only origin/f...${h}`
const dirty = { 'a review c1': () => ({ findings: [F('c1-F1')] }), 'a validate c1': () => ({ verified: ['c1-F1'] }) }

// H1. the first validator of a workstream runs the test guard over the whole workstream range
await t('1a after a non-clean c1 review the delta validator is the first: its test guard covers origin/<feature>...head, the rest stays on the delta', async () => {
  const { prompts } = await go(one, dirty)
  const p = prompts['a validate c1']
  assert(p.includes(FULL(SHA(11))), 'full-range guard command')
  assert(/whole workstream range/.test(p) && /weakened pre-existing test there is a finding/.test(p), 'files a weakened pre-existing test outside the delta')
  assert(/Everything else in this step judges the delta only/.test(p), 'test integrity only, not the acceptance criteria') })
await t('1b (control) a later delta validator, or one after a clean-review validator, judges only its delta', async () => {
  const { all } = await go({ cycles: 2, workstreams: [ws('a')] }, {
    'a review c1': () => ({ findings: [F('c1-F1')] }), 'a review c2': () => ({ findings: [F('c2-F1')] }),
    'a validate c1': () => ({ verified: ['c1-F1'] }), 'a validate c2': () => ({ verified: ['c2-F1'] }),
  })
  assert(!all['a validate c2'][0].includes('whole workstream range'), 'c2 delta stays on its delta')
  const { all: a2 } = await go(one, { 'a validate c1': (p, n) => n === 1 ? { open: [F('v1-F1')] } : { verified: ['v1-F1'] } })
  assert.equal(a2['a validate c1'].length, 2)
  assert(!a2['a validate c1'][1].includes('whole workstream range'), 'the clean-review validator already covered the range') })

// H2a. fixers turn a brief conflict into a question
await t('2a the workstream and whole-branch fixers escalate a brief conflict as a question and leave the code', async () => {
  const { prompts } = await go(one, { ...dirty, 'one validate': () => ({ verdict: 'fail', findings: [F('V-F1')] }), 'one recheck r1': () => ({ verified: ['V-F1'] }) })
  for (const L of ['a fix c1', 'one fix r1']) {
    const p = prompts[L]
    assert(/can only be fixed by breaking another clause of the brief/.test(p) && /the brief contradicts the repo/.test(p), `${L}: names both shapes`)
    assert(/do not pick a side and leave the code/.test(p) && /answer it "escalated"/.test(p) && /default keeping the current behaviour and tests/.test(p), `${L}: escalated + question, default keeps behaviour`)
  } })

// H2b. validators send a brief conflict or a reversal of a verified fix to questions, not the fix loop
await t('2b every workstream and whole-branch validator prompt routes conflicts to questions, and their schemas carry them', async () => {
  const { prompts, schemas } = await go(one, { ...dirty, 'one validate': () => ({ verdict: 'fail', findings: [F('V-F1')] }), 'one recheck r1': () => ({ verified: ['V-F1'] }) })
  const { prompts: p2 } = await go(one, {})
  for (const [L, p, s] of [['clean-review validate c1', p2['a validate c1'], schemas['a validate c1']], ['delta validate c1', prompts['a validate c1'], schemas['a validate c1']], ['one validate', prompts['one validate'], schemas['one validate']], ['one recheck r1', prompts['one recheck r1'], schemas['one recheck r1']]]) {
    assert(/would reverse a fix verified earlier in this run, is not a finding: return it in questions/.test(p), `${L} prompt`)
    assert(s.properties.questions?.items?.required?.includes('default'), `${L} schema`)
  } })
await t('2c a clean-review validator question does not block: the workstream merges and the question reaches the top level', async () => {
  const q = Q('The brief says the owners team wrote ledger/owners.py, but this range adds it. Which holds?')
  const { r, all } = await go(one, { 'a validate c1': () => ({ questions: [q] }) })
  const w = r.workstreams[0]
  assert(w.merged && !all['a fix c1'], 'no fix round for a question')
  assert(w.questions.some(x => x.q === q.q), 'workstream questions')
  assert(r.questions.some(x => x.q === `a: ${q.q}` && x.default === q.default), JSON.stringify(r.questions)) })
await t('2d whole-branch validator and recheck questions reach repos[].questions and the top level; so do fixer escalations', async () => {
  const qv = Q('V says reverse c1-F1?'), qr = Q('R says?'), qf = Q('fixer: the brief clause conflicts'), qw = Q('wb fixer: conflict')
  const { r } = await go(one, {
    'a review c1': () => ({ findings: [F('c1-F1')] }),
    'a fix c1': () => ({ answers: [{ id: 'c1-F1', action: 'escalated', note: 'brief conflict' }], questions: [qf] }),
    'a validate c1': () => ({ verified: ['c1-F1'] }),
    'one validate': () => ({ verdict: 'fail', findings: [F('V-F2')], questions: [qv] }),
    'one fix r1': () => ({ answers: [{ id: 'V-F2', action: 'escalated', note: 'conflict' }], questions: [qw] }),
    'one recheck r1': () => ({ verified: ['V-F2'], questions: [qr] }),
  })
  const x = r.repos[0]
  assert(x.verdict === 'pass' && r.workstreams[0].merged, JSON.stringify(x))
  for (const q of [qv, qr, qw]) assert(x.questions.some(y => y.q === q.q), `repo has ${q.q}`)
  assert.deepEqual(r.questions.map(y => y.q), [`a: ${qf.q}`, ...[qv, qw, qr].map(q => `one: ${q.q}`)])
  assert.equal(r.workstreams[0].findings.find(e => e.id === 'c1-F1').status, 'open', 'an escalated finding stays the user\'s call') })
await t('2e the whole-branch validator and recheck see the workstream findings verified in its cycles', async () => {
  const { prompts } = await go(one, { ...dirty, 'one validate': () => ({ verdict: 'fail', findings: [F('V-F1')] }), 'one recheck r1': () => ({ verified: ['V-F1'] }) })
  for (const L of ['one validate', 'one recheck r1']) {
    const m = prompts[L].match(/Verified in the workstream cycles[^\n]*: (\[.*\])/)
    assert(m, `${L} lists them`)
    assert.deepEqual(JSON.parse(m[1]).map(e => [e.id, e.status]), [['a:c1-F1', 'fixed']], L)
  } })
await t('2f (control) with nothing verified in the cycles, or a validator with no questions, nothing is added', async () => {
  const { r, prompts } = await go(one, {})
  assert(!/Verified in the workstream cycles/.test(prompts['one validate']), 'no empty list')
  assert.deepEqual(r.questions, []) })
await t('2g delta validators and rechecks accept an escalated brief conflict instead of keeping it open', async () => {
  const { prompts } = await go(one, { ...dirty, 'one validate': () => ({ verdict: 'fail', findings: [F('V-F1')] }), 'one recheck r1': () => ({ verified: ['V-F1'] }) })
  for (const L of ['a validate c1', 'one recheck r1']) assert(/Accept \(verified\) an answer escalated as a brief conflict when no fix keeps every clause/.test(prompts[L]), L) })

// H3. fix validators and rechecks judge each fix against the brief's hard clauses
await t('3a the delta validator and the recheck carry the brief and hold off-brief fixes open as regressions', async () => {
  const { prompts } = await go(one, { ...dirty, 'one validate': () => ({ verdict: 'fail', findings: [F('V-F1')] }), 'one recheck r1': () => ({ verified: ['V-F1'] }) })
  for (const L of ['a validate c1', 'one recheck r1']) {
    const p = prompts[L]
    assert(p.includes(BRIEF), `${L} carries the brief`)
    assert(/removes a call the brief mandates, edits or deletes a file the brief says not to edit, or deletes or weakens a test an earlier stage verified as guarding a fix stays open as a regression unless the user answered a question allowing it/.test(p), `${L} rule`)
  } })

// H4. the reviewer never claims what the author's notes say
await t('4a the workstream reviewer is told notes and questions are hidden from it', async () => {
  const { prompts } = await go(one, {})
  assert(/The author's notes and questions are not shown to you: never claim what they say\./.test(prompts['a review c1'])) })

if (fails.length) { console.error(fails.join('\n')); process.exit(1) }
console.log('full-range guard, brief-conflict questions, hard-clause and reviewer-notes checks ok')
