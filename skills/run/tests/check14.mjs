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
    assert(/Only a contradiction between the brief and the repo itself \(a premise the history disproves, or two brief clauses that cannot both hold\) goes to questions instead of findings/.test(p), `${L} prompt: contradictions to questions`)
    assert(/A real defect is always a finding, even in code or tests the brief protects or where its fix would reverse a fix verified earlier; the fixer escalates it\./.test(p), `${L} prompt: protected defects stay findings`)
    assert(s.properties.questions?.items?.required?.includes('default') && s.required.includes('questions'), `${L} schema`)
  } })
await t('2c a clean-review validator question does not block: the workstream merges and the question reaches the top level', async () => {
  const q = Q('The brief says the owners team wrote ledger/owners.py, but this range adds it. Which holds?')
  const { r, all } = await go(one, { 'a validate c1': () => ({ questions: [q] }) })
  const w = r.workstreams[0]
  assert(w.merged && !all['a fix c1'], 'no fix round for a question')
  assert(w.questions.some(x => x.q === q.q), 'workstream questions')
  assert(r.questions.some(x => x.q === `a: ${q.q}` && x.default === q.default), JSON.stringify(r.questions)) })
await t('2d whole-branch validator and recheck questions reach repos[].questions and the top level; so do fixer escalations', async () => {
  const qv = Q('V says reverse c1-F1?'), qr = Q('R says?'), qf = Q('c1-F1: fixer: the brief clause conflicts'), qw = Q('V-F2: wb fixer: conflict'), qd = Q('delta validator: the brief premise is false')
  const { r } = await go(one, {
    'a review c1': () => ({ findings: [F('c1-F1')] }),
    'a fix c1': () => ({ answers: [{ id: 'c1-F1', action: 'escalated', note: 'brief conflict' }], questions: [qf] }),
    'a validate c1': () => ({ verified: ['c1-F1'], questions: [qd] }),
    'one validate': () => ({ verdict: 'fail', findings: [F('V-F2')], questions: [qv] }),
    'one fix r1': () => ({ answers: [{ id: 'V-F2', action: 'escalated', note: 'conflict' }], questions: [qw] }),
    'one recheck r1': () => ({ verified: ['V-F2'], questions: [qr] }),
  })
  const x = r.repos[0]
  assert(x.verdict === 'pass' && r.workstreams[0].merged, JSON.stringify(x))
  for (const q of [qv, qr, qw]) assert(x.questions.some(y => y.q === q.q), `repo has ${q.q}`)
  assert.deepEqual(r.questions.map(y => y.q), [`a: ${qf.q}`, `a: ${qd.q}`, ...[qv, qw, qr].map(q => `one: ${q.q}`)])
  assert.equal(r.workstreams[0].findings.find(e => e.id === 'c1-F1').status, 'open', 'an escalated finding stays the user\'s call') })
const listed = (p, head) => { const m = p.match(new RegExp(`${head} \\([^)]*\\): (\\[[^\\n]*?\\])(?= Already asked|\\n|$)`)); return m && JSON.parse(m[1]) }
await t('2e the whole-branch validator and recheck see the fixes verified in the cycles: fixed only, never a gate, never an open one', async () => {
  const { prompts } = await go(one, {
    'a review c1': () => ({ findings: [F('c1-F1'), { ...F('c1-F2'), kind: 'question' }, F('c1-F3', 'minor')] }),
    'a fix c1': () => ({ answers: [{ id: 'c1-F1', action: 'fixed', note: 't1 red then green' }, { id: 'c1-F2', action: 'answered', note: 'defensible' }, { id: 'c1-F3', action: 'declined', note: 'not a one-liner' }] }),
    'a validate c1': () => ({ verified: ['c1-F1', 'c1-F2'], gate: { ...green, green: false, summary: '1 failed' } }),
    'a validate c2': () => ({ verified: ['v1-G'] }), // the green gate settles v1-G fixed, a gate entry the list must skip
    'one validate': () => ({ verdict: 'fail', findings: [F('V-F1')] }), 'one recheck r1': () => ({ verified: ['V-F1'] }),
  })
  assert(prompts['a fix c2']?.includes('"v1-G"'), 'the red gate reached a second cycle')
  for (const L of ['one validate', 'one recheck r1']) {
    const fs = listed(prompts[L], 'Fixes verified earlier in this run')
    assert(fs, `${L} lists them`)
    assert.deepEqual(fs.map(e => e.id), ['a:c1-F1'], `${L}: ${JSON.stringify(fs)}`)
  } })
await t('2f (control) with nothing verified in the cycles, or a validator with no questions, nothing is added', async () => {
  const { r, prompts } = await go(one, {})
  assert(!/Verified in the workstream cycles/.test(prompts['one validate']), 'no empty list')
  assert.deepEqual(r.questions, []) })
await t('2g delta validators and rechecks accept an escalated brief conflict instead of keeping it open', async () => {
  const { prompts } = await go(one, { ...dirty, 'one validate': () => ({ verdict: 'fail', findings: [F('V-F1')] }), 'one recheck r1': () => ({ verified: ['V-F1'] }) })
  for (const L of ['a validate c1', 'one recheck r1']) assert(/Accept \(verified\) an answer escalated as a brief conflict when no fix keeps every clause/.test(prompts[L]), L) })

// I1. an accepted escalation is never counted fixed, and always reaches the user as a question
const esc = (id, note = 'only a brief change settles this') => ({ answers: [{ id, action: 'escalated', note }], questions: [] })
await t('5a workstream: a verified escalation with no fixer question is not fixed and gets a synthesized top-level question', async () => {
  const { r } = await go(one, { 'a review c1': () => ({ findings: [F('c1-F1', 'critical', 'ledger/owners.py:9')] }), 'a fix c1': () => esc('c1-F1'), 'a validate c1': () => ({ verified: ['c1-F1'] }) })
  const w = r.workstreams[0]
  assert(w.merged, 'the default keeps the code, so it merges')
  assert.equal(w.findingsFixed, 0, 'not counted fixed')
  assert.notEqual(w.findings.find(e => e.id === 'c1-F1').status, 'fixed')
  const q = r.questions.find(x => x.q.startsWith('a: c1-F1'))
  assert(q && /ledger\/owners\.py:9/.test(q.q) && /only a brief change settles this/.test(q.q) && q.options.includes(q.default), JSON.stringify(r.questions)) })
await t('5b whole-branch: a recheck-verified escalation with no fixer question gets a synthesized repo and top-level question', async () => {
  const { r } = await go(one, { 'one validate': () => ({ verdict: 'fail', findings: [F('V-F1', 'critical')] }), 'one fix r1': () => esc('V-F1'), 'one recheck r1': () => ({ verified: ['V-F1'] }) })
  const x = r.repos[0]
  assert.notEqual(x.findings.find(e => e.id === 'V-F1').status, 'fixed')
  assert(x.questions.some(q => q.q.startsWith('V-F1')), JSON.stringify(x.questions))
  assert(r.questions.some(q => q.q.startsWith('one: V-F1')), JSON.stringify(r.questions)) })
await t('5c an escalation that came with its own question gets no second one, and only the plain fix counts', async () => {
  const qf = Q('c1-F1: keep the helper call or change the brief?')
  const { r } = await go(one, { 'a review c1': () => ({ findings: [F('c1-F1'), F('c1-F2')] }), 'a fix c1': () => ({ answers: [{ id: 'c1-F1', action: 'escalated', note: 'n' }, { id: 'c1-F2', action: 'fixed', note: 'n' }], questions: [qf] }), 'a validate c1': () => ({ verified: ['c1-F1', 'c1-F2'] }) })
  assert.deepEqual(r.questions.map(q => q.q), [`a: ${qf.q}`])
  assert.equal(r.workstreams[0].findingsFixed, 1) })

// I2. a real defect in protected code is a finding the fixer escalates; only a brief/repo contradiction goes straight to questions
await t('6a fullGuard files a weakened protected test; fixers escalate protected-code fixes and reversals without blocking', async () => {
  const { prompts } = await go(one, { ...dirty, 'one validate': () => ({ verdict: 'fail', findings: [F('V-F1')] }), 'one recheck r1': () => ({ verified: ['V-F1'] }) })
  assert(/a weakened pre-existing test there is a finding, even when the brief protects that file/.test(prompts['a validate c1']), 'fullGuard')
  for (const L of ['a fix c1', 'one fix r1']) {
    const p = prompts[L]
    assert(/editing a file or test the brief protects/.test(p) && /or by reversing a fix verified earlier in this run/.test(p), `${L}: protected code and reversals`)
    assert(/answer it "escalated" with status still done \(not blocked\)/.test(p), `${L}: not a block`)
    assert(/Nothing to change \(all answered, declined or escalated\)/.test(p), `${L}: nothing-to-change names escalated`)
  } })

// minors: the fix validator sees what earlier cycles settled; rechecks see earlier rounds; asked questions are never re-asked
await t('7a a later fix validator lists the findings verified in earlier cycles', async () => {
  const { prompts } = await go({ cycles: 2, workstreams: [ws('a')] }, {
    'a review c1': () => ({ findings: [F('c1-F1')] }), 'a review c2': () => ({ findings: [F('c2-F1', 'major', 'y.py:1')] }),
    'a validate c1': () => ({ verified: ['c1-F1'] }), 'a validate c2': () => ({ verified: ['c2-F1'] }),
  })
  assert(!/Verified in earlier cycles/.test(prompts['a validate c1']), 'nothing yet at c1')
  const m = prompts['a validate c2'].match(/Verified in earlier cycles[^:]*: (\[.*\])/)
  assert(m && JSON.parse(m[1]).map(e => e.id).join() === 'c1-F1', 'c2 lists c1-F1') })
await t('7b recheck round 2 lists what round 1 verified', async () => {
  const { prompts } = await go({ cycles: 1, workstreams: [ws('a')] }, {
    'one validate': () => ({ verdict: 'fail', findings: [F('V-F1'), F('V-F2', 'major', 'z.py:2')] }),
    'one recheck r1': () => ({ verdict: 'fail', verified: ['V-F1'], findings: [F('V-F2', 'major', 'z.py:2')] }),
    'one recheck r2': () => ({ verified: ['V-F2'] }),
  })
  const fs = listed(prompts['one recheck r2'], 'Fixes verified earlier in this run')
  assert(fs && fs.some(e => e.id === 'V-F1'), JSON.stringify(fs)) })
await t('7c the whole-branch validator and rechecks are told which questions are already with the user', async () => {
  const qa = Q('the brief premise is false: keep or change?')
  const { prompts } = await go(one, { 'a validate c1': () => ({ questions: [qa] }), 'one validate': () => ({ verdict: 'fail', findings: [F('V-F1')] }), 'one recheck r1': () => ({ verified: ['V-F1'] }) })
  for (const L of ['one validate', 'one recheck r1']) {
    const m = prompts[L].match(/Already asked of the user, never re-ask: (\[[^\n]*?\])/)
    assert(m && JSON.parse(m[1]).includes(qa.q), L)
  } })

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
