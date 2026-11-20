// Unrun-gate guard, cross-repo fail as a question, promote warnings on success, overlapping-range W/V dedupe,
// delta evidence, and the single-workstream seam-review skip.
// Every scenario fails against the 0.3.5 script except the ones marked (control).
import { Run } from './run.mjs'
import assert from 'node:assert'
const SHA = n => (n + '').padStart(40, 'a')
const parallel = fs => Promise.all(fs.map(f => f().catch(() => null)))
const free = { total: null, spent: () => 0, remaining: () => Infinity }
const push = { status: 'done', ok: true, tests: 't', gateTail: 'exit 0', sharedEdits: [], decisions: [], questions: [], notes: [] }
const green = { green: true, summary: '12 passed', command: 'npm test', flaky: [] }
const SKIPPED = { green: true, summary: 'skipped', flaky: [] } // the 0.3.5 validator's gate, verbatim
const F = (id, severity = 'major', where = 'x.py:3') => ({ id, severity, kind: 'bug', where, issue: `issue ${id}`, evidence: 'test t1 red' })
// sc[label](prompt, attempt) overrides a step; all[label] keeps every call in order, attempts included.
function mock(args, sc = {}) {
  const prompts = {}, opts = {}, all = {}, schemas = {}
  const head = {}
  const repoOf = L => { const w = args.workstreams.find(w => L.startsWith(`${w.id} `)); return w ? w.repo : `/r/${L.split(' ')[0]}` }
  const agent = async (p, o) => {
    const n = +(o.label.match(/ attempt (\d)$/)?.[1] || 1)
    const L = o.label.replace(/ attempt \d$/, '')
    prompts[L] = p; opts[L] = o; schemas[L] = o.schema; (all[L] ||= []).push({ p, o })
    const id = L.split(' ')[0]
    const repo = repoOf(L)
    const own = sc[L]?.(p, n)
    if (own === null) return null
    if (L.endsWith('implement')) return (head[id] = SHA(id.length), { ...push, sha: head[id], ...own })
    if (/fix c(\d)/.test(L)) { const r = { ...push, sha: SHA(10 + +L.at(-1)), answers: [], ...own }; head[id] = r.sha; return r }
    if (/review c\d/.test(L)) return { headSha: head[id], findings: [], ...own }
    if (/validate c\d/.test(L)) return { headSha: head[id], gate: green, evidence: 'e', verified: [], open: [], ...own }
    if (L.endsWith('merge')) { const pre = head[repo] || SHA(40); head[repo] = SHA(50 + Object.keys(head).length); return { ...push, sha: head[repo], preMergeSha: pre, baseAtMerge: SHA(40), ...own } }
    if (L.endsWith(' review')) return { headSha: head[repo], findings: [], seams: 'none', ...own }
    if (L.endsWith('docs validate')) return { verdict: 'pass', sections: 's', sha: (p.match(/\.\.([0-9a-f]{40})/) || [])[1], tests: 't', gate: green, findings: [], ...own }
    if (L.endsWith(' validate')) return { verdict: 'pass', sections: 's', sha: head[repo], tests: 't', gate: green, findings: [], verified: [], ...own }
    if (/fix r(\d)/.test(L)) { const r = { ...push, sha: SHA(70 + +L.at(-1)), answers: [], ...own }; head[repo] = r.sha; return r }
    if (/recheck r\d/.test(L)) return { verdict: 'pass', sections: 's', sha: head[repo], tests: 't', gate: green, findings: [], verified: [], ...own }
    if (L.endsWith(' docs')) return { baseSha: head[repo], sha: '', files: [], prBody: false, ok: true, tests: 't', notes: [], ...own }
    if (L.endsWith(' promote')) return { ok: true, sha: (p.match(/ to ([0-9a-f]{40})\./) || [])[1], notes: [], ...own }
    if (L === 'contracts') return { verdict: 'pass', sections: 's', findings: [], ...own }
    throw new Error('unmocked ' + L)
  }
  return { agent, prompts, opts, all, schemas }
}
const ws = (id, extra = {}) => ({ id, repo: '/r/one', featureBranch: 'f', branch: `f--${id}`, model: 'sonnet', brief: 'b', gate: 'npm test', ...extra })
const go = async (args, sc) => { const m = mock(args, sc); const r = await Run(args, m.agent, parallel, () => {}, free); return { r, ...m } }
const fails = []
const t = async (name, fn) => { try { await fn() } catch (e) { fails.push(`${name}: ${e.message.split('\n')[0]}`) } }
const UNRUN_TAIL = 'the previous attempt returned without running the gate; redo the whole step, run every command, and report the command you ran in gate.command'
const fixFindings = p => JSON.parse(p.match(/Findings:\n(.*)\n/)[1])
const moved = { 'a merge': () => ({ preMergeSha: SHA(41) }) } // the feature branch had moved past its base: the integrated review runs

// 1. a gated step whose gate never ran is a dead attempt
await t('1a the 0.3.5 "skipped" clean-review validator is retried, and the retry carries the unrun tail, not the sha repair', async () => {
  const { r, all } = await go({ cycles: 1, workstreams: [ws('a')] }, { 'a validate c1': (p, n) => n === 1 ? { gate: SKIPPED, verified: [], open: [] } : {} })
  const v = all['a validate c1']
  assert.equal(v.length, 2, 'a second validate agent')
  assert(v[1].p.includes(`Attempt 2: ${UNRUN_TAIL}`), 'the retry says why')
  assert(!v[1].p.includes('is not a full 40-hex SHA'), 'never the sha-repair tail')
  assert.equal(r.workstreams[0].merged, true, 'merged on the honest retry') })
await t('1b all three attempts unrun: NOT merged, and the escalation names it', async () => {
  const { r, all } = await go({ cycles: 1, workstreams: [ws('a')] }, { 'a validate c1': () => ({ gate: SKIPPED }) })
  assert.equal(all['a validate c1'].length, 3)
  assert(!all['a merge'], 'no merge agent')
  const x = r.workstreams[0]
  assert(!x.merged && x.escalations.some(e => /never ran its gate/.test(e) && /NOT merged/.test(e)), JSON.stringify(x.escalations)) })
await t('1c an empty or sentinel command is unrun whatever the summary; a sentinel-led summary is unrun whatever the command', async () => {
  for (const gate of [{ ...green, command: '' }, { ...green, command: '  ' }, { green: true, summary: '12 passed', flaky: [] }, { ...green, summary: 'n/a' }, { ...green, summary: 'NOT RUN' }, { ...green, summary: '(Skipped.)' },
    { ...green, command: 'none', summary: 'Gate not run: the review was clean' }, { ...green, command: 'n/a', summary: 'skipped: clean review' }, { ...green, command: 'not run', summary: 'not run (no time)' },
    { ...green, summary: 'skipped: clean review' }, { ...green, summary: 'not run (no time)' }, { green: false, summary: 'red', command: '', flaky: [] }]) {
    const { all } = await go({ cycles: 1, workstreams: [ws('a')] }, { 'a validate c1': (p, n) => n === 1 ? { gate } : {} })
    assert.equal(all['a validate c1'].length, 2, JSON.stringify(gate))
  } })
await t('1d (control) an honest gate runs once; a summary that merely mentions a skip is honest', async () => {
  for (const gate of [green, { ...green, summary: '12 passed, 1 skipped' }, { green: true, summary: 'OK (skipped=1)', command: 'python -m unittest discover -s tests', flaky: [] }]) {
    const { r, all } = await go({ cycles: 1, workstreams: [ws('a')] }, { 'a validate c1': () => ({ gate }) })
    assert(all['a validate c1'].length === 1 && r.workstreams[0].merged, JSON.stringify(gate))
  } })
await t('1e the delta validate, the whole-branch validator, the recheck and a gated docs validator are guarded too', async () => {
  const once = gate => (p, n) => n === 1 ? { gate } : {}
  const { all } = await go({ cycles: 1, workstreams: [ws('a')] }, { ...moved,
    'a review c1': () => ({ findings: [F('c1-F1')] }),
    'a validate c1': (p, n) => n === 1 ? { gate: SKIPPED } : { verified: ['c1-F1'] },
    'one validate': once(SKIPPED),
    'one review': () => ({ findings: [F('W-F1')] }),
    'one recheck r1': (p, n) => n === 1 ? { gate: SKIPPED } : { verified: ['W-F1'] },
    'one docs': () => ({ sha: SHA(90) }),
    'one docs validate': once({ ...green, command: '' }),
  })
  for (const L of ['a validate c1', 'one validate', 'one recheck r1', 'one docs validate']) assert.equal(all[L].length, 2, L) })
await t('1f (control) a docs validator with no gate is exempt; ungated steps are never retried for a missing command', async () => {
  const { r, all } = await go({ cycles: 1, workstreams: [ws('a')], docsRepos: [{ repo: '/r/one', featureBranch: 'f' }, { repo: '/r/notes', featureBranch: 'f' }] }, { ...moved,
    'notes docs': () => ({ baseSha: SHA(5), sha: SHA(91) }),
    'notes docs validate': () => ({ gate: { green: true, summary: 'no gate', command: '', flaky: [] } }),
  })
  assert.equal(all['notes docs validate'].length, 1)
  for (const L of ['a implement', 'a review c1', 'a merge', 'one review', 'notes docs', 'notes docs promote']) assert.equal(all[L].length, 1, L)
  assert.equal(r.otherDocs[0].docs.verdict, 'pass') })
await t('1g every gate schema requires the command, and every gated prompt asks for it', async () => {
  const { schemas, prompts, opts } = await go({ cycles: 1, workstreams: [ws('a')] }, {})
  for (const L of ['a validate c1', 'one validate']) {
    const g = schemas[L].properties.gate
    assert(g.required.includes('command') && /exact gate command/.test(g.properties.command.description), L)
    assert(/gate \{green, summary, command, flaky\}/.test(prompts[L]), `${L} prompt`)
    assert(!('gated' in opts[L]), `${L}: gated stays in the script`)
  } })

// 2. a cross-repo fail with an open blocker becomes one top-level question
const two = { cycles: 1, workstreams: [ws('a'), ws('b', { repo: '/r/two' })] }
const D9 = { verdict: 'fail', sections: '1. fail: amount is a string in the vendored copy. 2. fail: re-vendor vendor/alpha-contract.yaml from alpha and refresh its digest', findings: [F('X-F1', 'critical', 'vendor/alpha-contract.yaml:12'), F('X-F2', 'minor', 'beta/client.py:4')] }
await t('2a contract fail with an open critical: one top-level question carrying the recipe, no fix agent', async () => {
  const { r, all } = await go(two, { contracts: () => D9 })
  assert(Array.isArray(r.questions) && r.questions.length === 1, JSON.stringify(r.questions))
  const q = r.questions[0]
  assert(q.q.includes('re-vendor vendor/alpha-contract.yaml from alpha and refresh its digest') && q.q.includes('X-F1'), q.q)
  assert(q.options.length >= 2 && q.options.includes(q.default) && /re-run stage "wholeBranch" with every repo of the contract/.test(q.default), JSON.stringify(q))
  assert(!Object.keys(all).some(L => /contract.*fix|fix.*contract/.test(L)), 'never auto-fixed') })
await t('2b with no sections the finding issue is the recipe', async () => {
  const { r } = await go(two, { contracts: () => ({ ...D9, sections: '', findings: [{ ...F('X-F1', 'major'), issue: 'beta reads amount as a string; re-vendor the contract' }] }) })
  assert(r.questions.length === 1 && r.questions[0].q.includes('beta reads amount as a string; re-vendor the contract'), JSON.stringify(r.questions)) })
await t('2d an open contract blocker asks even when the verdict says pass', async () => {
  const { r } = await go(two, { contracts: () => ({ ...D9, verdict: 'pass' }) })
  assert(r.questions.length === 1 && r.questions[0].q.includes('X-F1'), JSON.stringify(r.questions)) })
await t('2c (control) a pass, a minor-only fail or a dead contract agent asks nothing', async () => {
  for (const c of [{}, { ...D9, findings: [F('X-F2', 'minor')] }, null]) {
    const { r } = await go(two, { contracts: () => c })
    assert.deepEqual(r.questions || [], [], JSON.stringify(c))
  } })

// 3a. a promote that succeeded but left a step undone says so
const DENIED = 'Step 3 NOT done: git push origin --delete f--docs was denied by the auto mode classifier'
await t('3a ok promote notes reach repos[].notes, for docs and whole-branch promotes', async () => {
  const { r } = await go({ cycles: 1, workstreams: [ws('a')] }, { ...moved,
    'one review': () => ({ findings: [F('W-F1')] }), 'one recheck r1': () => ({ verified: ['W-F1'] }),
    'one promote': () => ({ notes: ['Step 3 NOT done: delete of f--wbfix1 denied'] }),
    'one docs': () => ({ sha: SHA(90) }), 'one docs promote': () => ({ notes: [DENIED] }),
  })
  const x = r.repos[0]
  assert(x.verdict === 'pass' && x.finalSha === SHA(90), JSON.stringify(x))
  assert(x.notes.some(n => n.includes(DENIED)) && x.notes.some(n => n.includes('delete of f--wbfix1 denied')), JSON.stringify(x.notes)) })
await t('3a2 a docs-only repo\'s promote notes reach its docs notes', async () => {
  const { r } = await go({ cycles: 1, workstreams: [ws('a')], docsRepos: [{ repo: '/r/notes', featureBranch: 'f', gate: 'make docs' }] }, {
    'notes docs': () => ({ baseSha: SHA(5), sha: SHA(91) }), 'notes docs promote': () => ({ notes: [DENIED] }),
  })
  assert(r.otherDocs[0].docs.notes.some(n => n.includes(DENIED)), JSON.stringify(r.otherDocs[0].docs)) })
await t('3a3 (control) a clean promote adds no notes', async () => {
  const { r } = await go({ cycles: 1, workstreams: [ws('a')] }, { 'one docs': () => ({ sha: SHA(90) }) })
  assert.deepEqual(r.repos[0].notes, []) })

// 3b. a validator finding whose first path:line range overlaps a reviewer finding in the same file joins it
await t('3b the 0.3.5 V-F1 and V-F7 shapes collapse; pair-once holds', async () => {
  const { r, prompts } = await go({ cycles: 1, workstreams: [ws('a')] }, { ...moved,
    'one review': () => ({ findings: [F('W-F4', 'critical', 'ledger/pager.py:6'), F('W-F7', 'critical', 'ledger/discount.py:6-8')] }),
    'one validate': () => ({ findings: [F('V-F1', 'critical', 'tests/test_pager.py (test_last_page_partial deleted) + ledger/pager.py:6'), F('V-F7', 'major', 'ledger/discount.py:8-9'), F('V-F8', 'major', 'ledger/discount.py:7')] }),
    'one recheck r1': () => ({ verified: ['W-F4', 'W-F7', 'V-F8'] }),
  })
  const fs = fixFindings(prompts['one fix r1'])
  assert.deepEqual(fs.map(f => [f.id, f.also?.id ?? null]), [['W-F4', 'V-F1'], ['W-F7', 'V-F7'], ['V-F8', null]], JSON.stringify(fs))
  for (const id of ['V-F1', 'V-F7']) assert.equal(r.repos[0].findings.find(e => e.id === id).status, 'fixed', id) })
await t('3b2 (control) touching but disjoint ranges, another file or a bare area stay apart', async () => {
  const { prompts } = await go({ cycles: 1, workstreams: [ws('a')] }, { ...moved,
    'one review': () => ({ findings: [F('W-F7', 'major', 'ledger/discount.py:6-8')] }),
    'one validate': () => ({ findings: [F('V-F1', 'major', 'ledger/discount.py:9-12'), F('V-F2', 'major', 'ledger/pager.py:7'), F('V-F3', 'major', 'discount module')] }),
    'one recheck r1': () => ({ verified: ['W-F7', 'V-F1', 'V-F2', 'V-F3'] }),
  })
  assert(fixFindings(prompts['one fix r1']).every(f => !f.also)) })
await t('3b3 (control: blocking-also) an overlap-collapsed entry demoted to minor still blocks while its absorbed critical is unverified', async () => {
  const { r } = await go({ cycles: 1, workstreams: [ws('a')] }, { ...moved,
    'one review': () => ({ findings: [F('W-F7', 'critical', 'ledger/discount.py:6-8')] }),
    'one validate': () => ({ findings: [F('V-F7', 'critical', 'ledger/discount.py:8-9')] }),
    'one recheck r1': () => ({ findings: [F('W-F7', 'minor', 'ledger/discount.py:6-8')] }),
  })
  const x = r.repos[0]
  assert(x.verdict === 'fail' && x.findings.find(e => e.id === 'V-F7').status === 'open', JSON.stringify(x.open)) })

// 3c. the delta validator lists the commands it ran per step
await t('3c DELTA requires an evidence string and both validate prompts ask for it', async () => {
  const { schemas, prompts } = await go({ cycles: 1, workstreams: [ws('a')] }, { 'a review c1': () => ({ findings: [F('c1-F1')] }), 'a validate c1': () => ({ verified: ['c1-F1'] }) })
  const s = schemas['a validate c1']
  assert(s.required.includes('evidence') && s.properties.evidence.type === 'string' && /command/.test(s.properties.evidence.description), JSON.stringify(s.properties.evidence))
  const { prompts: p2 } = await go({ cycles: 1, workstreams: [ws('a')] }, {})
  for (const p of [prompts['a validate c1'], p2['a validate c1']]) assert(/Return headSha, gate, evidence/.test(p), 'prompt names evidence') })
await t('3c2 each validator\'s evidence reaches workstreams[].evidence, keyed by step', async () => {
  const { r } = await go({ cycles: 1, workstreams: [ws('a')] }, {
    'a review c1': () => ({ findings: [F('c1-F1', 'minor')] }),
    'a validate c1': p => /Independently validate workstream/.test(p) ? { open: [F('v1-F1')], evidence: '1. ran npm test; 2. reverted hunks' } : { verified: ['v1-F1'], evidence: '1. ran the claimed test at both heads' },
  })
  assert.deepEqual(r.workstreams[0].evidence, { 'validate c1': '1. ran npm test; 2. reverted hunks', 'validate c1 delta': '1. ran the claimed test at both heads' }) })

// 4. one workstream merged onto an untouched base has no seam: only the whole-branch validator runs
await t('4a a single workstream merged at the base skips the integrated review; the validator keeps every section', async () => {
  const { r, all, prompts, schemas } = await go({ cycles: 1, workstreams: [ws('a')] }, {})
  assert(!all['one review'], 'no integrated review')
  assert(/TEST_GUARD|Test integrity/.test(prompts['one validate']) && /Hygiene/.test(prompts['one validate']) && /Live smoke/.test(prompts['one validate']) && /Spec compliance/.test(prompts['one validate']), 'validator unchanged')
  assert(schemas['a merge'].required.includes('preMergeSha') && schemas['a merge'].required.includes('baseAtMerge'), 'merge reports both shas')
  assert(/preMergeSha/.test(prompts['a merge']) && /baseAtMerge/.test(prompts['a merge']), 'merge prompt asks for them')
  const x = r.repos[0]
  assert(x.verdict === 'pass' && /skipped/.test(x.seams), JSON.stringify(x))
  assert.equal(r.workstreams[0].preMergeSha, SHA(40)) })
await t('4b a solo repo with a validator blocker still gets its fix round and recheck', async () => {
  const { r, all } = await go({ cycles: 1, workstreams: [ws('a')] }, { 'one validate': () => ({ verdict: 'fail', findings: [F('V-F1')] }), 'one recheck r1': () => ({ verified: ['V-F1'] }) })
  assert(!all['one review'] && all['one fix r1'] && all['one recheck r1'])
  assert(r.repos[0].verdict === 'pass', JSON.stringify(r.repos[0])) })
await t('4c (control) a moved feature branch, an old merge shape, two merged workstreams or a wholeBranch re-run keep the review', async () => {
  const cases = [
    [{ cycles: 1, workstreams: [ws('a')] }, { 'a merge': () => ({ preMergeSha: SHA(41) }) }],
    [{ cycles: 1, workstreams: [ws('a')] }, { 'a merge': () => ({ preMergeSha: undefined, baseAtMerge: undefined }) }],
    [{ cycles: 1, workstreams: [ws('a'), ws('b')] }, {}],
    [{ stage: 'wholeBranch', workstreams: [ws('a')] }, {}],
  ]
  for (const [args, sc] of cases) { const { all } = await go(args, sc); assert(all['one review'], JSON.stringify(args)) } })

if (fails.length) { console.error(fails.join('\n')); process.exit(1) }
console.log('unrun-gate, cross-repo question, promote warning, overlap, evidence and solo-review checks ok')
