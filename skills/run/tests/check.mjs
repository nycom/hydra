import { meta, Run } from './run.mjs'
import assert from 'node:assert'
const SHA = n => (n + '').padStart(40, 'a')
const parallel = fs => Promise.all(fs.map(f => f().catch(() => null)))
const ws = (id, repo, extra = {}) => ({ id, repo, featureBranch: 'feat/x', branch: `feat/x--${id}`, model: 'sonnet', brief: 'b', gate: 'npm test', ...extra })
// scenario-driven mock: returns schema-shaped objects; counts calls
function mock(sc) {
  let n = 0; const calls = []
  const push = { status: 'done', ok: true, tests: 't', gateTail: 'exit 0', sharedEdits: [], decisions: [], questions: [], notes: [] }
  const agent = async (prompt, o) => {
    calls.push(o); n++
    if (sc.die && sc.die(o)) return null
    o = { ...o, label: o.label.replace(/ attempt \d$/, '') }
    const head = (prompt.match(/\.\.\.?([0-9a-f]{40})/) || [])[1]
    if (o.label.endsWith('implement')) return { ...push, sha: SHA(1), sharedEdits: sc.shared || [] }
    if (/review c\d/.test(o.label)) return { headSha: sc.lieHead ? SHA(9) : head, findings: sc.review ? sc.review(o.label) : [] }
    if (/fix c(\d)/.test(o.label)) { const i = +o.label.match(/fix c(\d)/)[1]; return { ...push, sha: SHA(10 + i), answers: [] } }
    if (/validate c\d/.test(o.label)) { const h = prompt.match(/([0-9a-f]{40})\b(?! on)?/g); return { headSha: (prompt.match(/\.\.\.?([0-9a-f]{40})/) || [])[1], gate: { command: 'npm test', green: !sc.red, summary: 's' }, verified: [], open: sc.valOpen ? sc.valOpen(o.label) : [] } }
    if (o.label.endsWith('merge')) return { ...push, sha: SHA(50) }
    if (o.label.endsWith(' review')) return { headSha: SHA(60), findings: sc.wbFind || [] }
    if (o.label.endsWith(' validate') && o.phase === 'Whole-branch') return { verdict: 'pass', sections: 's', sha: SHA(60), tests: 't', gate: { command: 'npm test', green: true, summary: '' }, findings: [] }
    if (/fix r\d/.test(o.label)) return { ...push, sha: SHA(70), answers: [] }
    if (/recheck r\d/.test(o.label)) return { verdict: 'pass', sections: 's', sha: SHA(70), tests: 't', gate: { command: 'npm test', green: true, summary: '' }, findings: [], verified: (sc.wbFind || []).map(f => f.id) }
    if (o.label === 'contracts') return { verdict: 'pass', sections: 's', findings: [] }
    if (o.label.endsWith(' docs')) return { baseSha: SHA(60), sha: sc.docsSha || '', files: [], prBody: false, ok: true, tests: 't', notes: [] }
    if (o.label.endsWith('docs validate')) return { verdict: 'pass', sections: 's', sha: sc.docsSha, tests: 't', gate: { command: 'npm test', green: true, summary: '' }, findings: [] }
    if (o.label.endsWith(' promote')) return { ok: true, sha: (prompt.match(/ to ([0-9a-f]{40})\./) || [])[1], notes: [] }
    throw new Error('unmocked ' + o.label)
  }
  return { agent, calls }
}
const budget = (total = null, spent = 0) => ({ total, spent: () => spent, remaining: () => total == null ? Infinity : Math.max(0, total - spent) })
const run = (args, sc = {}, b = budget()) => { const m = mock(sc); return Run(args, m.agent, parallel, () => {}, b).then(r => ({ r, calls: m.calls })) }
const F = (id, severity) => ({ id, severity, kind: 'bug', where: 'a:1', issue: 'x' })

assert.deepEqual(meta.phases.map(p => p.title), ['Implement', 'Review cycles', 'Merge', 'Whole-branch', 'Contracts', 'Docs sync'])
// 1. clean c1 -> one validator, merge validated sha, docs commit validated
{ const { r, calls } = await run({ cycles: null, workstreams: [ws('a', '/r/one/')] }, { docsSha: SHA(80) })
  const w = r.workstreams[0]; assert(w.merged && w.cyclesRun === 1 && w.validatedSha === SHA(1), JSON.stringify(w))
  assert(calls.some(c => c.label === 'a validate c1'))
  assert.equal(calls.find(c => c.label === 'a review c1').model, 'opus'); assert.equal(calls.find(c => c.label === 'a review c1').agentType, 'reviewer')
  assert.equal(r.repos[0].repo, '/r/one'); assert.equal(r.repos[0].finalSha, SHA(80)); assert.equal(r.repos[0].verdict, 'pass'); assert.equal(r.crossRepo, null) }
// 2. minors only -> carried, not cycled
{ const { r, calls } = await run({ cycles: null, workstreams: [ws('a', '/r/one', { model: 'opus' })] }, { review: () => [F('m1', 'minor')] })
  assert(r.workstreams[0].merged && r.workstreams[0].open.length === 1 && !calls.some(c => /fix c/.test(c.label)))
  assert.equal(calls.find(c => c.label === 'a review c1').model, 'fable') }
// 3. major persists -> named N=1 extends to cap, never merges
{ const { r } = await run({ cycles: 1, workstreams: [ws('a', '/r/one')] }, { review: () => [F('M', 'major')], valOpen: () => [F('M', 'major')] })
  const w = r.workstreams[0]; assert(!w.merged && w.extended && w.cyclesRun === 3, JSON.stringify(w)); assert.equal(r.repos[0].verdict, 'skipped') }
// 3b. maxCycles caps
{ const { r } = await run({ cycles: 1, maxCycles: 2, workstreams: [ws('a', '/r/one')] }, { review: () => [F('M', 'major')], valOpen: () => [F('M', 'major')] })
  assert.equal(r.workstreams[0].cyclesRun, 2) }
// 4. dead reviewer -> 2 replacements with attempt labels, then not merged
{ const { r, calls } = await run({ cycles: null, workstreams: [ws('a', '/r/one')] }, { die: o => o.label.startsWith('a review c1') })
  assert.deepEqual(calls.filter(c => c.label.startsWith('a review')).map(c => c.label), ['a review c1', 'a review c1 attempt 2', 'a review c1 attempt 3'])
  assert(!r.workstreams[0].merged) }
// 4b. one death then recovery
{ let k = 0; const { r } = await run({ cycles: null, workstreams: [ws('a', '/r/one')] }, { die: o => o.label.endsWith('merge') && k++ === 0 })
  assert(r.workstreams[0].merged) }
// 5. head mismatch -> not merged
{ const { r } = await run({ cycles: null, workstreams: [ws('a', '/r/one')] }, { lieHead: true }); assert(!r.workstreams[0].merged) }
// 6. red gate on clean validator -> critical -> cycles
{ const { r } = await run({ cycles: null, workstreams: [ws('a', '/r/one')] }, { red: true }); assert(!r.workstreams[0].merged) }
// 7. budget short -> nothing new starts
{ const { r, calls } = await run({ cycles: null, tokenBudget: 100, workstreams: [ws('a', '/r/one')] }, {})
  assert(!r.workstreams[0].merged && calls.length === 1 && /token budget/.test(r.workstreams[0].escalations[0])) }
// 8. two repos -> contract check; wb major -> fix round + recheck with pinned range
{ const { r, calls } = await run({ cycles: null, workstreams: [ws('a', '/r/one'), ws('b', '/r/two')] }, { wbFind: [F('W', 'major')] })
  assert(r.crossRepo && r.repos.every(x => x.fixRounds === 1 && x.verdict === 'pass'), JSON.stringify(r.repos)) }
// 9. stage wholeBranch skips workstreams
{ const { r, calls } = await run({ stage: 'wholeBranch', workstreams: [ws('a', '/r/one')] }, {})
  assert(r.workstreams.length === 0 && !calls.some(c => c.phase === 'Implement' || c.phase === 'Merge') && r.repos[0].verdict === 'pass') }
// 10. files overlap throws; sharedEdits reach the merge prompt
await assert.rejects(run({ workstreams: [ws('a', '/r/one', { files: ['src/'] }), ws('b', '/r/one', { files: ['src/x.js'] })] }), /overlap/)
await run({ workstreams: [ws('a', '/r/one', { files: ['src/a/**'] }), ws('b', '/r/one', { files: ['src/b.js'] })] })
// 11. nothing shipped -> no docs at all, even for docs-only repos
{ const { calls } = await run({ workstreams: [ws('a', '/r/one')], docsRepos: [{ repo: '/r/design', featureBranch: 'feat/x' }] }, { die: o => o.label.includes('implement') })
  assert(!calls.some(c => c.phase === 'Docs sync')) }
console.log('harness ok')
