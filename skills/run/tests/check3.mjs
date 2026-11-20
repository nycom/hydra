// One scenario per Fable review fix; each failed on the pre-fix script.
import { Run } from './run.mjs'
import assert from 'node:assert'
const SHA = n => (n + '').padStart(40, 'a')
const parallel = fs => Promise.all(fs.map(f => f().catch(() => null)))
const budget = { total: null, spent: () => 0, remaining: () => Infinity }
const push = { status: 'done', ok: true, tests: 't', gateTail: 'exit 0', sharedEdits: [], decisions: [], questions: [], notes: [] }
const pass = sha => ({ verdict: 'pass', sections: 's', sha, tests: 't', gate: { command: 'npm test', green: true, summary: '' }, findings: [] })
const M = { id: 'v1-F1', severity: 'major', kind: 'bug', where: 'a:1', issue: 'x' }
function mock(sc = {}) {
  const prompts = {}
  let vals = 0
  const agent = async (p, o) => {
    if (sc.die?.(o.label)) return null
    const L = o.label.replace(/ attempt \d$/, '')
    prompts[L] = p
    if (L.endsWith('implement')) return { ...push, sha: SHA(1) }
    if (/review c\d/.test(L)) return { headSha: (p.match(/\.\.\.([0-9a-f]{40})/) || [])[1], findings: [] }
    if (/validate c\d/.test(L)) { vals++; const h = (p.match(/([0-9a-f]{40})(?: on |\. The review)/) || [])[1]; return { headSha: h, gate: { command: 'npm test', green: true, summary: '' }, verified: vals > 1 ? ['v1-F1'] : [], open: vals === 1 && sc.cleanValMajor ? [M] : [] } }
    if (/fix c\d/.test(L)) return { ...push, sha: SHA(2), answers: [{ id: 'v1-F1', action: 'fixed', note: 'n' }] }
    if (L.endsWith('merge')) return { ...push, sha: SHA(3) }
    if (L.endsWith(' review')) return { headSha: SHA(3), findings: [] }
    if (L.endsWith('docs validate')) return pass(SHA(5))
    if (L.endsWith(' validate')) return pass(SHA(3))
    if (L.endsWith(' docs')) return { baseSha: SHA(3), sha: '', files: [], prBody: false, ok: true, tests: 't', notes: [] }
    throw new Error('unmocked ' + L)
  }
  return { agent, prompts }
}
const ws = { id: 'a', repo: '/r/one', featureBranch: 'f', branch: 'f--a', model: 'sonnet', brief: 'b', gate: 'npm test' }
const fails = []
const t = async (name, fn) => { try { await fn() } catch (e) { fails.push(`${name}: ${e.message.split('\n')[0]}`) } }
const go = async (args, sc) => { const m = mock(sc); const r = await Run(args, m.agent, parallel, () => {}, budget); return { r, p: m.prompts } }

// fix 1: hot: [] is an escape hatch, not "every changed file is hot"
await t('fix 1', async () => { const { r, p } = await go({ cycles: null, repos: [{ repo: '/r/one', hot: [] }], workstreams: [ws] })
  assert(!/--\s+must/.test(p['a merge']) && !/-- \./.test(p['a merge']), 'fix1: empty pathspec backstop')
  assert(!p['a implement'].includes('commit: .'), 'fix1: SHARED with empty hot list')
  assert(r.workstreams[0].merged) })
// fix 1b: hot: [] plus files[] keeps only the files check
await t('fix 1b', async () => { const { p } = await go({ cycles: null, repos: [{ repo: '/r/one', hot: [] }], workstreams: [{ ...ws, files: ['src/'] }] })
  assert(p['a merge'].includes(`':(glob,exclude)src/**'`) && !p['a merge'].includes(`':(glob)`), 'fix1b') })
// fix 2: everyone who runs the gate on a workstream SHA runs regen first; its diffs are not findings
await t('fix 2', async () => { const { p } = await go({ cycles: null, repos: [{ repo: '/r/one', regen: 'npm run gen:types' }], workstreams: [ws] }, { cleanValMajor: true })
  for (const k of ['a review c1', 'a validate c1', 'a validate c1', 'a implement', 'a fix c1'])
    assert(p[k].includes('npm run gen:types'), `fix2: ${k} lacks regen`)
  assert(/not findings/.test(p['a validate c1']), 'fix2: regen diffs are not findings') })
// fix 3: an AI-trace hit in a run-authored commit blocks
await t('fix 3', async () => { const { p } = await go({ cycles: null, workstreams: [ws] })
  assert(p['a merge'].includes('is critical (kind hygiene)') && p['a merge'].includes('do not push and return ok=false'), 'fix3') })
// fix 4: clean review + validator major at the cap -> fixed in the same cycle, not dropped
await t('fix 4', async () => { const { r, p } = await go({ cycles: 1, maxCycles: 1, workstreams: [ws] }, { cleanValMajor: true })
  const w = r.workstreams[0]
  assert(p['a fix c1'] && w.merged && w.cyclesRun === 1 && w.validatedSha === SHA(2), 'fix4: ' + JSON.stringify(w)) })
// fix 5: a docs agent that dies 3 times fails the repo
await t('fix 5', async () => { const { r } = await go({ cycles: null, workstreams: [ws] }, { die: l => l.includes(' docs') && !l.includes('validate') })
  assert(r.repos[0].verdict === 'fail' && r.repos[0].escalations.some(e => /docs/.test(e)), 'fix5: ' + JSON.stringify(r.repos[0])) })
if (fails.length) { console.log('FAILED:\n' + fails.join('\n')); process.exit(1) }
console.log('fable-fix checks ok')
