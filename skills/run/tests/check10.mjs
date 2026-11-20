// A malformed self-reported sha is a dead attempt, not a lost fix; a blocked question's default never weakens tests.
import { Run } from './run.mjs'
import assert from 'node:assert'
const SHA = n => (n + '').padStart(40, 'a')
const parallel = fs => Promise.all(fs.map(f => f().catch(() => null)))
const budget = { total: null, spent: () => 0, remaining: () => Infinity }
const push = { status: 'done', ok: true, tests: 't', gateTail: 'exit 0', sharedEdits: [], decisions: [], questions: [], notes: [] }
const green = { green: true, summary: '' }
// sc[label](prompt) overrides a step, keyed by the full label (attempts included); calls counts agents per base label.
function mock(sc = {}) {
  const prompts = {}, opts = {}, calls = {}
  const head = {}
  const agent = async (p, o) => {
    const L = o.label.replace(/ attempt \d$/, '')
    prompts[o.label] = p; opts[L] = o; calls[L] = (calls[L] || 0) + 1
    const id = L.split(' ')[0]
    const repo = '/r/one'
    const own = sc[o.label]?.(p)
    if (L.endsWith('implement')) return (head[id] = SHA(1), { ...push, sha: head[id], ...own })
    if (/fix c(\d)/.test(L)) { head[id] = SHA(10 + +L.at(-1)); return { ...push, sha: head[id], answers: [], ...own } } // the push lands whatever sha the agent reports
    if (/review c\d/.test(L)) return { headSha: head[id], findings: [], ...own }
    if (/validate c\d/.test(L)) return { headSha: head[id], gate: green, verified: [], open: [], ...own }
    if (L.endsWith('merge')) return (head[repo] = SHA(50), { ...push, sha: SHA(50) })
    if (L.endsWith(' review')) return { headSha: head[repo], findings: [] }
    if (L.endsWith(' validate')) return { verdict: 'pass', sections: 's', sha: head[repo], tests: 't', gate: green, findings: [] }
    if (L.endsWith(' docs')) return { baseSha: head[repo], sha: '', files: [], prBody: false, ok: true, tests: 't', notes: [] }
    throw new Error('unmocked ' + L)
  }
  return { agent, prompts, opts, calls }
}
const ws = id => ({ id, repo: '/r/one', featureBranch: 'f', branch: `f--${id}`, model: 'sonnet', brief: 'b', gate: 'npm test' })
const go = async (args, sc) => { const m = mock(sc); const r = await Run(args, m.agent, parallel, () => {}, budget); return { r, ...m } }
const fails = []
const t = async (name, fn) => { try { await fn() } catch (e) { fails.push(`${name}: ${e.message.split('\n')[0]}`) } }
const F1 = { id: 'c1-F1', severity: 'major', kind: 'bug', where: 'a:1', issue: 'issue', evidence: 'test t1 red' }

await t('H1a a done fix with a placeholder sha is replaced and the real fix merges', async () => {
  const { r, calls, prompts } = await go({ cycles: 1, workstreams: [ws('a')] }, {
    'a review c1': () => ({ findings: [F1] }),
    'a fix c1': () => ({ sha: 'PLACEHOLDER', answers: [{ id: 'c1-F1', action: 'fixed', note: 'n' }] }),
    'a fix c1 attempt 2': () => ({ answers: [{ id: 'c1-F1', action: 'fixed', note: 'n' }] }),
    'a validate c1': () => ({ verified: ['c1-F1'] }),
  })
  const w = r.workstreams[0]
  assert.equal(calls['a fix c1'], 2, 'attempt 2 ran')
  assert(prompts['a fix c1 attempt 2'].includes('first check the remote for anything it already pushed'), 'attempt 2 told to check the remote')
  assert(w.merged && w.validatedSha === SHA(11), JSON.stringify({ merged: w.merged, validatedSha: w.validatedSha, escalations: w.escalations }))
  assert(!prompts['a validate c1'].includes('PLACEHOLDER'), 'validator never sees the placeholder') })
await t('H1b a short sha on a done result is a dead attempt too', async () => {
  const { r, calls } = await go({ cycles: 1, workstreams: [ws('a')] }, { 'a implement': () => ({ sha: 'aaaaaaa' }) })
  assert(calls['a implement'] === 2 && r.workstreams[0].merged, JSON.stringify(r.workstreams[0])) })
await t('H1c blocked with an empty sha returns once, normally', async () => {
  const q = { q: 'which?', options: ['keep', 'other'], default: 'keep' }
  const { r, calls } = await go({ cycles: 1, workstreams: [ws('a')] }, { 'a implement': () => ({ status: 'blocked', ok: false, sha: '', questions: [q] }) })
  const w = r.workstreams[0]
  assert.equal(calls['a implement'], 1, 'no replacement for an honest block')
  assert(!w.merged && w.escalations.some(e => e.startsWith('implement blocked')) && w.questions.length === 1, JSON.stringify(w)) })
await t('H1d the pushed-sha schema pins 40-hex or empty', async () => {
  const { opts } = await go({ cycles: 1, workstreams: [ws('a')] }, { 'a review c1': () => ({ findings: [F1] }), 'a validate c1': () => ({ verified: ['c1-F1'] }) })
  for (const L of ['a implement', 'a fix c1', 'a merge']) assert.equal(opts[L].schema.properties.sha.pattern, '^([0-9a-f]{40})?$', L) })

const KEEP = 'the default must keep every pre-existing test unchanged and stay within the brief; offer a test edit only as a non-default option.'
await t('H2 question defaults keep every pre-existing test', async () => {
  const { prompts, opts } = await go({ cycles: 1, workstreams: [ws('a')] }, { 'a review c1': () => ({ findings: [F1] }), 'a validate c1': () => ({ verified: ['c1-F1'] }) })
  for (const L of ['a implement', 'a fix c1']) {
    assert(prompts[L].includes(KEEP), `${L} prompt`)
    assert(opts[L].schema.properties.questions.items.properties.default.description.includes(KEEP), `${L} schema`)
  } })

if (fails.length) { console.error(fails.join('\n')); process.exit(1) }
console.log('sha-guard checks ok')
