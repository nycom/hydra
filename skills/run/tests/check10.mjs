// A malformed self-reported sha gets a repair call that keeps the result, never a redo; a blocked question's default never weakens tests; an up-merge is defined.
import { Run } from './run.mjs'
import assert from 'node:assert'
const SHA = n => (n + '').padStart(40, 'a')
const parallel = fs => Promise.all(fs.map(f => f().catch(() => null)))
const budget = { total: null, spent: () => 0, remaining: () => Infinity }
const push = { status: 'done', ok: true, tests: 't', gateTail: 'exit 0', sharedEdits: [], decisions: [], questions: [], notes: [] }
const green = { green: true, summary: '' }
// sc[label](prompt) overrides a step, keyed by the full label (attempts included), null = the agent died; calls counts agents per base label.
function mock(sc = {}) {
  const prompts = {}, opts = {}, calls = {}
  const head = {}
  const agent = async (p, o) => {
    const L = o.label.replace(/ attempt \d$/, '')
    prompts[o.label] = p; opts[L] = o; calls[L] = (calls[L] || 0) + 1
    const id = L.split(' ')[0]
    const repo = '/r/one'
    const own = sc[o.label]?.(p)
    if (own === null) return null
    if (L.endsWith('implement')) return (head[id] = SHA(1), { ...push, sha: head[id], ...own })
    if (/fix c(\d)/.test(L)) { head[id] = SHA(10 + +L.at(-1)); return { ...push, sha: head[id], answers: [], ...own } } // the push lands whatever sha the agent reports
    if (/review c\d/.test(L)) return { headSha: head[id], findings: [], ...own }
    if (/validate c\d/.test(L)) return { headSha: head[id], gate: green, verified: [], open: [], ...own }
    if (L.endsWith('merge')) return (head[repo] = SHA(50), { ...push, sha: SHA(50), ...own })
    if (L.endsWith(' review')) return { headSha: head[repo], findings: [], ...own }
    if (L.endsWith(' validate')) return { verdict: 'pass', sections: 's', sha: head[repo], tests: 't', gate: green, findings: [], ...own }
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

const REPAIR = 'is not a full 40-hex SHA. Do not redo the work: git ls-remote the branch and return the same result with the verified sha'
await t('H1a a done fix with a placeholder sha gets a repair call and the real fix merges', async () => {
  const answers = [{ id: 'c1-F1', action: 'fixed', note: 'n' }]
  const { r, calls, prompts } = await go({ cycles: 1, workstreams: [ws('a')] }, {
    'a review c1': () => ({ findings: [F1] }),
    'a fix c1': () => ({ sha: 'PLACEHOLDER', answers }),
    'a fix c1 attempt 2': () => ({ answers: [] }), // a lossy repair: the script keeps attempt 1's result
    'a validate c1': () => ({ verified: ['c1-F1'] }),
  })
  const w = r.workstreams[0]
  assert.equal(calls['a fix c1'], 2, 'one repair call')
  const rp = prompts['a fix c1 attempt 2']
  assert(rp.includes(`its sha "PLACEHOLDER" ${REPAIR}`) && !rp.includes('died mid-step'), 'repair, not redo')
  assert(rp.includes(JSON.stringify(answers)), 'the earlier result rides along')
  assert(w.merged && w.validatedSha === SHA(11), JSON.stringify({ merged: w.merged, validatedSha: w.validatedSha, escalations: w.escalations }))
  assert(prompts['a validate c1'].includes(JSON.stringify(answers[0].id)) && !prompts['a validate c1'].includes('PLACEHOLDER'), 'validator gets the answers, never the placeholder') })
await t('H1b a short implement sha is repaired; sharedEdits, questions and notes survive', async () => {
  const kept = { sharedEdits: [{ file: 'README.md', intent: 'doc X' }], questions: [{ q: 'which?', options: ['keep', 'other'], default: 'keep' }], notes: ['n1'] }
  const { r, calls, prompts } = await go({ cycles: 1, workstreams: [ws('a')] }, { 'a implement': () => ({ sha: 'aaaaaaa', ...kept }) })
  const w = r.workstreams[0]
  assert(calls['a implement'] === 2 && prompts['a implement attempt 2'].includes(REPAIR), 'one repair call')
  assert(w.merged && w.validatedSha === SHA(1), JSON.stringify(w))
  assert.deepEqual(w.sharedEdits, kept.sharedEdits); assert.deepEqual(w.questions, kept.questions); assert(w.notes.includes('n1'), 'notes kept')
  assert(prompts['a merge'].includes('doc X'), 'merge applies the kept sharedEdits') })
await t('H1e a short merge sha costs no repair and never reruns the merge', async () => {
  const { r, calls } = await go({ cycles: 1, workstreams: [ws('a')] }, { 'a merge': () => ({ sha: 'aaaaaaa' }) })
  assert(calls['a merge'] === 1 && r.workstreams[0].merged, JSON.stringify({ calls: calls['a merge'], w: r.workstreams[0] })) })
await t('H1f done with ok false and an empty sha returns once, as before', async () => {
  const { r, calls } = await go({ cycles: 1, workstreams: [ws('a')] }, { 'a implement': () => ({ ok: false, sha: '', tests: 'gate red' }) })
  const w = r.workstreams[0]
  assert(calls['a implement'] === 1 && !w.merged && w.escalations.some(e => e.startsWith('implement done: gate red')), JSON.stringify(w)) })
await t('H1g a push step with no usable result says where to look', async () => {
  const { r, calls } = await go({ cycles: 1, workstreams: [ws('a')] }, { 'a implement': () => null, 'a implement attempt 2': () => ({ sha: 'PLACEHOLDER' }), 'a implement attempt 3': () => null })
  assert.equal(calls['a implement'], 3)
  assert(r.workstreams[0].escalations.includes('implement returned no usable result 3 times (died or malformed sha); check origin/f--a for an unvalidated push; NOT merged'), JSON.stringify(r.workstreams[0].escalations)) })
await t('H1h same() needs hex: a ref name is no sha', async () => {
  const { r } = await go({ cycles: 1, workstreams: [ws('a')] }, { 'one review': () => ({ headSha: 'origin/fx' }), 'one validate': () => ({ sha: 'origin/fx' }) })
  assert(r.repos[0].verdict === 'fail' && r.repos[0].escalations.some(e => e.includes('origin/fx')), JSON.stringify(r.repos[0])) })
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

await t('H3 the seam prompt defines an up-merge', async () => {
  const { prompts } = await go({ cycles: 1, workstreams: [ws('a')] })
  assert(prompts['one review'].includes('a first-parent merge of the base or parent branch into this branch is an up-merge: use it as a producer only and file nothing inside it when its diff lies outside the review range; any other merge whose diff lies inside the review range is reviewable code, whoever authored it.')) })

if (fails.length) { console.error(fails.join('\n')); process.exit(1) }
console.log('sha-guard checks ok')
