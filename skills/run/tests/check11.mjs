// Typed merge/promote/docs agents, shared-edit criteria for the workstream validators, carried minors settled by the
// first whole-branch validator, and W/V findings at one file:line collapsed before a whole-branch fix round.
// Every scenario fails against the 0.3.3 script except the ones marked (control).
import { Run } from './run.mjs'
import assert from 'node:assert'
const SHA = n => (n + '').padStart(40, 'a')
const parallel = fs => Promise.all(fs.map(f => f().catch(() => null)))
const free = { total: null, spent: () => 0, remaining: () => Infinity }
const push = { status: 'done', ok: true, tests: 't', gateTail: 'exit 0', sharedEdits: [], decisions: [], questions: [], notes: [] }
const green = { command: 'npm test', green: true, summary: '', flaky: [] }
const F = (id, severity = 'major', where = 'x.py:3') => ({ id, severity, kind: 'bug', where, issue: `issue ${id}`, evidence: 'test t1 red' })
// sc[label](prompt) overrides a step (the implement step included); all[label] keeps every call in order.
function mock(sc = {}) {
  const prompts = {}, opts = {}, all = {}
  const head = {}
  const agent = async (p, o) => {
    const L = o.label.replace(/ attempt \d$/, '')
    prompts[L] = p; opts[L] = o; (all[L] ||= []).push({ p, o })
    const id = L.split(' ')[0]
    const repo = '/r/one'
    const own = sc[L]?.(p)
    if (L.endsWith('implement')) return (head[id] = SHA(id.length), { ...push, sha: head[id], ...own })
    if (/fix c(\d)/.test(L)) { const r = { ...push, sha: SHA(10 + +L.at(-1)), answers: [], ...own }; head[id] = r.sha; return r }
    if (/review c\d/.test(L)) return { headSha: head[id], findings: [], ...own }
    if (/validate c\d/.test(L)) return { headSha: head[id], gate: green, verified: [], open: [], ...own }
    if (L.endsWith('merge')) return (head[repo] = SHA(50), { ...push, sha: SHA(50), ...own })
    if (L.endsWith(' review')) return { headSha: head[repo], findings: [], seams: 'none', ...own }
    if (L.endsWith('docs validate')) return { verdict: 'pass', sections: 's', sha: (p.match(/\.\.([0-9a-f]{40})/) || [])[1], tests: 't', gate: green, findings: [], ...own }
    if (L.endsWith(' validate')) return { verdict: 'pass', sections: 's', sha: head[repo], tests: 't', gate: green, findings: [], verified: [], ...own }
    if (/fix r(\d)/.test(L)) { const r = { ...push, sha: SHA(70 + +L.at(-1)), answers: [], ...own }; head[repo] = r.sha; return r }
    if (/recheck r\d/.test(L)) return { verdict: 'pass', sections: 's', sha: head[repo], tests: 't', gate: green, findings: [], verified: [], ...own }
    if (L.endsWith(' docs')) return { baseSha: head[repo], sha: '', files: [], prBody: false, ok: true, tests: 't', notes: [], ...own }
    if (L.endsWith(' promote')) return { ok: true, sha: (p.match(/ to ([0-9a-f]{40})\./) || [])[1], notes: [], ...own }
    throw new Error('unmocked ' + L)
  }
  return { agent, prompts, opts, all }
}
const ws = (id, extra = {}) => ({ id, repo: '/r/one', featureBranch: 'f', branch: `f--${id}`, model: 'sonnet', brief: 'b', gate: 'npm test', ...extra })
const go = async (args, sc) => { const m = mock(sc); const r = await Run(args, m.agent, parallel, () => {}, free); return { r, p: m.prompts, o: m.opts, all: m.all } }
const fails = []
const t = async (name, fn) => { try { await fn() } catch (e) { fails.push(`${name}: ${e.message.split('\n')[0]}`) } }
const ALSO = 'An entry with `also` holds a second finding at the same line: resolve and verify both; if the `also` one still holds, return it open under its own id.'
const status = (book, id) => book.find(e => e.id === id)?.status
const after = head => p => JSON.parse(p.split(`${head}\n`)[1].split('\n')[0]) // the JSON line a prompt puts under head
const fixFindings = after('Findings:')
const recheckFindings = after('Findings with claimed resolutions — judge the code first, then read each claim:')

// 1. typed agents: merge, promote and docs run as the lean implementer type, told they are not feature tasks
const NOT_FEATURE = "This step is not a feature task: write no tests, skip test-first and the self-review fix pass; change nothing these instructions don't name; follow everything below in order and return the schema."
await t('T1a every step names an agentType; merge, promote and docs run as implementer', async () => {
  const { o, p } = await go({ cycles: 1, workstreams: [ws('a')] }, {
    'one review': () => ({ findings: [F('W-F1')] }),
    'one recheck r1': () => ({ verified: ['W-F1'] }),
    'one docs': () => ({ sha: SHA(80) }),
  })
  const untyped = Object.keys(o).filter(L => !o[L].agentType)
  assert.deepEqual(untyped, [], 'untyped steps')
  for (const L of ['a merge', 'one promote', 'one docs', 'one docs promote']) {
    assert.equal(o[L].agentType, 'implementer', L)
    assert(p[L].includes(NOT_FEATURE), `${L} prompt overrides the implementer's test-first default`)
  }
  for (const L of ['a implement', 'a merge', 'one docs']) assert.equal(o[L].model, 'sonnet', `${L} keeps its explicit model`) })

// 2a. shared-file edits are applied by the merge, so the workstream validators never file their absence
const EDITS = [{ file: 'README.md', intent: 'add the Modules line' }]
const MERGE_TEXT = hot => `Shared-file edits are applied by the merge on the feature-branch tip, never in this range (shared files = ${hot}): a brief criterion on a shared file is met when the author's sharedEdits carry it`
const NEVER = 'Its absence from this range or head is never a finding; only a brief shared edit missing from that list is a finding.'
const HOT1 = { repos: [{ repo: '/r/one', hot: ['README.md', 'docs/**'] }] }
await t('T2a the clean-review validator is told the merge applies the sharedEdits it is given', async () => {
  const { p } = await go({ cycles: 1, workstreams: [ws('a')], ...HOT1 }, { 'a implement': () => ({ sharedEdits: EDITS }) })
  const v = p['a validate c1']
  assert(v.includes(`${MERGE_TEXT('README.md, docs/**')} (${JSON.stringify(EDITS)}).`) && v.includes(NEVER), v)
  assert(!v.includes('is (minor)'), 'severity is left to SEV') })
await t('T2b the delta validator gets the fixer\'s current sharedEdits and the default hot list', async () => {
  const later = [...EDITS, { file: 'CHANGELOG.md', intent: 'note the report' }]
  const { p } = await go({ cycles: 1, workstreams: [ws('a')] }, {
    'a implement': () => ({ sharedEdits: EDITS }),
    'a review c1': () => ({ findings: [F('c1-F1')] }),
    'a fix c1': () => ({ sharedEdits: later, answers: [{ id: 'c1-F1', action: 'fixed', note: 'n' }] }),
    'a validate c1': () => ({ verified: ['c1-F1'] }),
  })
  const v = p['a validate c1']
  assert(v.includes('(shared files = **/README*, **/CHANGELOG*, docs/**,') && v.includes(`(${JSON.stringify(later)}).`) && v.includes(NEVER), v) })
await t('T2c no sharedEdits says so', async () => {
  const { p } = await go({ cycles: 1, workstreams: [ws('a')], ...HOT1 })
  assert(p['a validate c1'].includes(`${MERGE_TEXT('README.md, docs/**')} (none returned).`), p['a validate c1']) })
await t('T2d a repo with no shared files gets no shared-edit text', async () => {
  const { p } = await go({ cycles: 1, workstreams: [ws('a')], repos: [{ repo: '/r/one', hot: [] }] }, {
    'a review c1': () => ({ findings: [F('c1-F1')] }),
    'a validate c1': () => ({ verified: ['c1-F1'] }),
  })
  const { p: p2 } = await go({ cycles: 1, workstreams: [ws('a')], repos: [{ repo: '/r/one', hot: [] }] })
  for (const v of [p['a validate c1'], p2['a validate c1']]) assert(!v.includes('Shared-file edits are applied') && !v.includes('  '), v) })

// 2b. the first whole-branch validator verifies carried minors; verified ones settle fixed and leave open
const MINOR = F('v1-F1', 'minor', 'README.md')
await t('T3a a carried minor the whole-branch validator verifies is fixed in the ledger and gone from open', async () => {
  const { r, p, o, all } = await go({ cycles: 1, workstreams: [ws('a')] }, {
    'a validate c1': () => ({ open: [MINOR] }),
    'one review': () => ({ findings: [F('W-F1', 'minor', 'y.py:9')] }),
    'one validate': () => ({ verified: ['a:v1-F1', 'W-F1'] }),
  })
  const x = r.repos[0]
  const v = p['one validate']
  assert(v.includes('Minors carried from the workstream cycles:') && v.includes('"id":"a:v1-F1"'), 'carried minors in the prompt')
  assert(o['one validate'].schema.properties.verified && o['one validate'].schema.required.includes('verified'), 'RECHECK schema')
  assert.equal(status(x.findings, 'a:v1-F1'), 'fixed')
  assert(!x.open.some(s => s.includes('issue v1-F1')), `still open: ${x.open}`)
  assert.equal(status(x.findings, 'W-F1'), 'open', 'only carried ids settle here; a reviewer finding waits for a fix round')
  assert(x.open.some(s => s.includes('issue W-F1')), 'W-F1 stays open')
  assert(!all['one fix r1'], 'no fix round for minors') })
await t('T3b (control) an unverified carried minor stays open and rides into the fix round', async () => {
  const { r, p } = await go({ cycles: 1, workstreams: [ws('a')] }, {
    'a validate c1': () => ({ open: [MINOR] }),
    'one review': () => ({ findings: [F('W-F1')] }),
    'one recheck r1': () => ({ verified: ['W-F1'] }),
  })
  assert(p['one fix r1'].includes('"id":"a:v1-F1"'), 'carried minor in the fix round')
  assert.equal(status(r.repos[0].findings, 'a:v1-F1'), 'open') })

// 3. reviewer and validator findings at one file:line collapse into one entry before the fix round
const strip = ({ claim, also, ...f }) => f // a schema reply carries neither
await t('T4a W and V at the same file:line reach the fixer and recheck once, and both ids settle', async () => {
  const { r, p } = await go({ cycles: 1, workstreams: [ws('a')] }, {
    'one review': () => ({ findings: [F('W-F1', 'major', 'x.py:3'), F('W-F2', 'major', 'y.py:9'), F('W-F3', 'minor', 'y.py:9'), F('W-F4', 'major', 'auth module')] }),
    'one validate': () => ({ findings: [F('V-F1', 'critical', 'x.py:3'), F('V-F2', 'major', 'x.py:30'), F('V-F3', 'major', 'auth module'), F('V-F4', 'major', 'x.py:3')] }),
    'one fix r1': p => ({ answers: fixFindings(p).map(f => ({ id: f.id, action: 'fixed', note: 'n' })) }),
    'one recheck r1': p => ({ verified: recheckFindings(p).map(f => f.id) }),
  })
  const fs = fixFindings(p['one fix r1'])
  const both = fs.filter(f => JSON.stringify(f).includes('"W-F1"'))
  assert.equal(both.length, 1, `one entry holds W-F1: ${JSON.stringify(both)}`)
  const e = both[0]
  assert(e.where === 'x.py:3' && JSON.stringify(e).includes('"V-F1"'), `both ids listed: ${JSON.stringify(e)}`)
  assert.equal(e.severity, 'critical', 'the merged entry keeps the higher severity')
  assert.deepEqual(e.also, { id: 'W-F1', severity: 'major', kind: 'bug', where: 'x.py:3', issue: 'issue W-F1', evidence: 'test t1 red' }, 'also keeps the absorbed finding whole')
  assert(fs.some(f => f.id === 'V-F4' && !f.also), 'each reviewer entry pairs once: a second V at that line stays its own entry')
  assert.equal(fs.filter(f => f.where === 'y.py:9').length, 2, 'two reviewer findings at one line stay apart')
  assert.equal(fs.filter(f => f.where === 'auth module').length, 2, 'an area with no line never collapses')
  assert(fs.some(f => f.id === 'V-F2'), 'another line stays apart')
  assert.equal(recheckFindings(p['one recheck r1']).filter(f => JSON.stringify(f).includes('"W-F1"')).length, 1, 'recheck sees it once')
  for (const L of ['one fix r1', 'one recheck r1']) assert(p[L].includes(ALSO), `${L} explains also`)
  const x = r.repos[0]
  for (const id of ['W-F1', 'V-F1', 'W-F2', 'W-F3', 'V-F2', 'V-F4']) assert.equal(status(x.findings, id), 'fixed', id)
  assert(x.verdict === 'pass' && x.open.length === 0, JSON.stringify(x.open)) })
await t('T4b a collapsed entry re-filed without also keeps it, and verified in round 2 settles both ids', async () => {
  const { r, p } = await go({ cycles: 1, workstreams: [ws('a')] }, {
    'one review': () => ({ findings: [F('W-F1', 'major', 'x.py:3')] }),
    'one validate': () => ({ findings: [F('V-F1', 'major', 'x.py:3')] }),
    'one recheck r1': p => ({ verdict: 'fail', findings: recheckFindings(p).map(strip) }),
    'one recheck r2': p => ({ verified: recheckFindings(p).map(f => f.id) }),
  })
  assert.equal(fixFindings(p['one fix r1']).length, 1)
  const r2 = fixFindings(p['one fix r2'])
  assert(r2.length === 1 && r2[0].also?.id === 'V-F1', `also re-attached: ${JSON.stringify(r2)}`)
  const x = r.repos[0]
  assert(status(x.findings, 'W-F1') === 'fixed' && status(x.findings, 'V-F1') === 'fixed', JSON.stringify(x.findings)) })
await t('T4c two distinct issues on one line: the absorbed one returned open under its own id is not settled', async () => {
  const { r, p } = await go({ cycles: 1, workstreams: [ws('a')] }, {
    'one review': () => ({ findings: [F('W-F1', 'major', 'x.py:3')] }),
    'one validate': () => ({ findings: [{ ...F('V-F1', 'major', 'x.py:3'), issue: 'a different bug on that line' }] }),
    'one recheck r1': () => ({ verdict: 'fail', verified: ['W-F1'], findings: [{ ...F('V-F1', 'major', 'x.py:3'), issue: 'a different bug on that line' }] }),
    'one recheck r2': () => ({ verified: [], findings: [{ ...F('V-F1', 'major', 'x.py:3'), issue: 'a different bug on that line' }] }),
  })
  assert(fixFindings(p['one fix r1'])[0].also.issue === 'a different bug on that line', 'the second issue reaches the fixer')
  for (const L of ['one fix r1', 'one recheck r1']) assert(p[L].includes(ALSO), `${L} explains also`)
  const r2 = fixFindings(p['one fix r2'])
  assert(r2.length === 1 && r2[0].id === 'V-F1' && !r2[0].also, `V-F1 rides on alone: ${JSON.stringify(r2)}`)
  const x = r.repos[0]
  assert.equal(status(x.findings, 'W-F1'), 'fixed')
  assert.equal(status(x.findings, 'V-F1'), 'open', 'never settled while it is open')
  assert(x.verdict === 'fail' && x.open.some(s => s.includes('a different bug')), JSON.stringify(x.open)) })
await t('T4d real where strings: a trailing note still collapses; a multi-file where does not crash', async () => {
  const { r, p } = await go({ cycles: 1, workstreams: [ws('a')] }, {
    'one review': () => ({ findings: [F('W-F1', 'major', 'ledger/api.py:12'), F('W-F2', 'major', 'ledger/report.py:7')] }),
    'one validate': () => ({ findings: [F('V-F1', 'critical', 'ledger/api.py:12 (commit 1e167de)'), F('V-F2', 'major', 'ledger/report.py:70'), F('V-F3', 'major', 'tests/test_report.py:5, ledger/report.py:7'), F('V-F4', 'major', 'tests/test_report.py (deleted test)'), F('V-F5', 'major', 'gate')] }),
    'one recheck r1': p => ({ verified: recheckFindings(p).map(f => f.id) }),
  })
  const fs = fixFindings(p['one fix r1'])
  assert.deepEqual(fs.map(f => [f.id, f.also?.id ?? null]), [['V-F1', 'W-F1'], ['W-F2', null], ['V-F2', null], ['V-F3', null], ['V-F4', null], ['V-F5', null]], JSON.stringify(fs))
  assert(r.repos[0].verdict === 'pass', JSON.stringify(r.repos[0].escalations)) })

const W1 = F('W-F1', 'major', 'x.py:3'), V1 = F('V-F1', 'major', 'x.py:3 (commit abc)')
await t('T4e a kept entry demoted to minor still blocks while its absorbed critical is unverified, as in the non-collapsed control', async () => {
  for (const vWhere of ['x.py:3 (commit abc)', 'x.py:4 (commit abc)']) {
    const { r } = await go({ cycles: 1, workstreams: [ws('a')] }, {
      'one review': () => ({ findings: [F('W-F1', 'critical', 'x.py:3', 'none')] }),
      'one validate': () => ({ findings: [F('V-F1', 'critical', vWhere)] }),
      'one recheck r1': () => ({ findings: [F('W-F1', 'minor', 'x.py:3', 'none')] }),
    })
    const x = r.repos[0]
    assert(x.verdict === 'fail' && status(x.findings, 'V-F1') === 'open', `${vWhere}: ${JSON.stringify({ verdict: x.verdict, open: x.open })}`)
  } })
await t('T4f kept and absorbed both returned open: the absorbed one rides as its own entry, never re-attached', async () => {
  const { p } = await go({ cycles: 1, workstreams: [ws('a')] }, {
    'one review': () => ({ findings: [W1] }), 'one validate': () => ({ findings: [V1] }),
    'one recheck r1': () => ({ verdict: 'fail', findings: [W1, V1] }),
  })
  const r2 = fixFindings(p['one fix r2'])
  assert(r2.length === 2 && r2.every(f => !f.also), JSON.stringify(r2)) })
await t('T4g re-attach respects the ledger: an absorbed id the recheck verified is not re-attached', async () => {
  const { r, p } = await go({ cycles: 1, workstreams: [ws('a')] }, {
    'one review': () => ({ findings: [W1] }), 'one validate': () => ({ findings: [V1] }),
    'one recheck r1': () => ({ verdict: 'fail', verified: ['V-F1'], findings: [W1] }),
  })
  const r2 = fixFindings(p['one fix r2'])
  assert(r2.length === 1 && r2[0].id === 'W-F1' && !r2[0].also, JSON.stringify(r2))
  assert.equal(status(r.repos[0].findings, 'V-F1'), 'fixed')
  assert(!p['one fix r2'].includes(ALSO) && !p['one recheck r2'].includes(ALSO), 'ALSO only when an entry has also') })
await t('T4h (control for ALSO) a fix round with no collapsed entry gets no also sentence', async () => {
  const { p } = await go({ cycles: 1, workstreams: [ws('a')] }, { 'one review': () => ({ findings: [W1] }), 'one recheck r1': () => ({ verified: ['W-F1'] }) })
  assert(!p['one fix r1'].includes(ALSO) && !p['one recheck r1'].includes(ALSO), 'no ALSO') })
await t('T4i the absorbed id settles with its own answer, else the kept entry\'s', async () => {
  for (const [answers, want] of [[[{ id: 'W-F1', action: 'fixed', note: 'n' }, { id: 'V-F1', action: 'answered', note: 'n' }], 'answered'], [[{ id: 'W-F1', action: 'declined', note: 'n' }], 'declined']]) {
    const { r } = await go({ cycles: 1, workstreams: [ws('a')] }, {
      'one review': () => ({ findings: [W1] }), 'one validate': () => ({ findings: [V1] }),
      'one fix r1': () => ({ answers }), 'one recheck r1': () => ({ verified: ['W-F1'] }),
    })
    assert.equal(status(r.repos[0].findings, 'V-F1'), want, JSON.stringify(answers))
  } })

if (fails.length) { console.error(fails.join('\n')); process.exit(1) }
console.log('typed-agent, shared-edit and dedupe checks ok')
