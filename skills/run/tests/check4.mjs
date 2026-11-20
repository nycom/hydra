// Live fixture eval (wf_ed158140-fb3) fixes; each scenario failed on the pre-fix script.
import { Run } from './run.mjs'
import assert from 'node:assert'
const SHA = n => (n + '').padStart(40, 'a')
const parallel = fs => Promise.all(fs.map(f => f().catch(() => null)))
const free = { total: null, spent: () => 0, remaining: () => Infinity }
const push = { status: 'done', ok: true, tests: 't', gateTail: 'exit 0', sharedEdits: [], decisions: [], questions: [], notes: [] }
const pass = sha => ({ verdict: 'pass', sections: 's', sha, tests: 't', gate: { command: 'npm test', green: true, summary: '' }, findings: [] })
const CRIT = { id: 'c1-F1', severity: 'critical', kind: 'integration', where: 'ledger/discount.py:9', issue: "KeyError 'total' after merge" }
const fails = []
const t = async (name, fn) => { try { await fn() } catch (e) { fails.push(`${name}: ${e.message.split('\n')[0]}`) } }
const wait = ms => new Promise(r => setTimeout(r, ms))
function mock(sc = {}) {
  const prompts = {}
  let aMerged, aMergedP = new Promise(r => (aMerged = r))
  const fixed = {}
  const agent = async (p, o) => {
    if (sc.die?.(o.label)) return null
    const L = o.label.replace(/ attempt \d$/, '')
    prompts[L] = p
    const id = L.split(' ')[0]
    if (L.endsWith('implement')) { if (sc.waitFor?.[id]) await aMergedP; return { ...push, sha: SHA(id.length), sharedEdits: sc.implShared || [] } }
    if (/review c\d/.test(L)) return { headSha: (p.match(/\.\.\.([0-9a-f]{40})/) || [])[1], findings: sc.reviewCrit?.[id] && !fixed[id] ? [CRIT] : [] }
    if (/fix c\d/.test(L)) { fixed[id] = true; return { ...push, sha: SHA(20 + id.length), answers: [{ id: 'c1-F1', action: 'fixed', note: 'n' }], sharedEdits: sc.fixShared || [] } }
    if (/validate c\d/.test(L)) { const h = (p.match(/([0-9a-f]{40})(?: on |\. The review)/) || [])[1]; return { headSha: h, gate: { command: 'npm test', green: true, summary: '' }, verified: ['c1-F1'], open: [] } }
    if (L.endsWith('merge')) { if (id === 'alpha-discount') setTimeout(aMerged, 5); return { ...push, sha: SHA(50) } }
    if (L.endsWith(' review')) return { headSha: SHA(50), findings: [] }
    if (L.endsWith(' validate')) return pass(SHA(50))
    if (L.endsWith(' docs')) return { baseSha: SHA(50), sha: '', files: [], prBody: false, ok: true, tests: 't', notes: [] }
    if (L === 'contracts') return { verdict: 'pass', sections: 's', findings: [] }
    throw new Error('unmocked ' + L)
  }
  return { agent, prompts }
}
const ws = (id, files) => ({ id, repo: '/r/alpha', featureBranch: 'feat/eval', branch: `feat/eval--${id}`, model: 'sonnet', brief: 'b', gate: 'pytest', files })
const go = async (args, sc, b = free) => { const m = mock(sc); const r = await Run(args, m.agent, parallel, () => {}, b); return { r, p: m.prompts } }
const three = [ws('alpha-discount', ['ledger/discount.py', 'tests/test_discount.py']), ws('alpha-cents', ['ledger/api.py', 'tests/test_api.py']), ws('alpha-z', ['ledger/z.py'])]
const sc3 = { waitFor: { 'alpha-cents': true }, reviewCrit: { 'alpha-cents': true }, die: l => l.startsWith('alpha-z implement') }

await t('1b integration-fix rule names merged and unmerged owners', async () => {
  const { r, p } = await go({ cycles: null, workstreams: three }, sc3)
  const f = p['alpha-cents fix c1']
  assert(/git merge origin\/feat\/eval/.test(f), 'merge feature branch first')
  const [mergedPart, pendingPart] = f.split(/not merged yet/)
  assert(mergedPart.includes('alpha-discount') && mergedPart.includes('ledger/discount.py'), 'merged owner + files')
  assert(pendingPart && pendingPart.includes('ledger/z.py'), 'unmerged owner files are off-limits')
  assert(r.workstreams.find(w => w.id === 'alpha-cents').merged) })
await t('1c merge backstop allows files of already-merged workstreams', async () => {
  const { p } = await go({ cycles: null, workstreams: three }, sc3)
  const m = p['alpha-cents merge']
  assert(m.includes(`':(glob,exclude)ledger/api.py'`) && m.includes(`':(glob,exclude)ledger/discount.py'`) && !m.includes(`':(glob,exclude)ledger/z.py'`)) })
await t('1d validators trial-merge the feature branch; failures are kind integration', async () => {
  const { p } = await go({ cycles: null, workstreams: three }, sc3)
  for (const k of ['alpha-cents validate c1', 'alpha-discount validate c1'])
    assert(/trial-merge origin\/feat\/eval/.test(p[k]) && /kind "integration"/.test(p[k]), k) })
await t('2 fixer sharedEdits replace the list', async () => {
  const { r, p } = await go({ cycles: null, workstreams: [ws('alpha-cents')] }, { reviewCrit: { 'alpha-cents': true }, implShared: [{ file: 'README.md', intent: 'document total_cents' }], fixShared: [{ file: 'README.md', intent: 'document total_cents (integer cents)' }] })
  assert.equal(r.workstreams[0].sharedEdits.length, 1)
  assert(p['alpha-cents merge'].includes('integer cents') && !p['alpha-cents merge'].includes('"document total_cents"'))
  assert(/complete current list/.test(p['alpha-cents fix c1']) && p['alpha-cents fix c1'].includes('document total_cents'), 'fixer told + sees current list') })
await t('3 result reports budget use', async () => {
  let spent = 0
  const b = { total: null, spent: () => spent, remaining: () => Infinity }
  const { r } = await go({ cycles: null, tokenBudget: 1000, tokenReserve: 10, workstreams: [ws('alpha-cents')] }, {}, b)
  assert(r.budget && r.budget.tokenBudget === 1000 && r.budget.reserve === 10 && r.budget.spent === 0 && Array.isArray(r.budget.stoppedBy) && r.budget.stoppedBy.length === 0, JSON.stringify(r.budget))
  const s = await go({ cycles: null, tokenBudget: 5, tokenReserve: 10, workstreams: [ws('alpha-cents')] }, {})
  assert(s.r.budget.stoppedBy.some(x => /alpha-cents/.test(x)), JSON.stringify(s.r.budget)) })
if (fails.length) { console.log('FAILED:\n' + fails.join('\n')); process.exit(1) }
console.log('eval-fix checks ok')
