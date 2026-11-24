// Each fixer gets the brief it must not break: the cycle fixer its own workstream's, the whole-branch fixer every brief of its repo.
// 1, 2 and 4 fail against the 0.4.3 script; 3 is a control.
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
const major = { 'a review c1': () => ({ findings: [F('c1-F1')] }), 'a validate c1': () => ({ verified: ['c1-F1'] }) }
const wbMajor = { 'one review': () => ({ findings: [F('I-F1')] }), 'one recheck r1': () => ({ verified: ['I-F1'] }) }

await t('1 the cycle fixer gets its own brief, once', async () => {
  const { prompts } = await go({ cycles: 1, workstreams: [ws('a'), ws('b')] }, major)
  assert.equal(prompts['a fix c1'].split('brief a').length, 2) })
await t('2 the whole-branch fixer gets every brief of its repo, as its validator does', async () => {
  const { prompts } = await go({ cycles: 1, workstreams: [ws('a'), ws('b'), ws('z', { repo: '/r/two' })] }, wbMajor)
  for (const p of [prompts['one fix r1'], prompts['one validate']]) assert(p.includes('## a\nbrief a\n\n## b\nbrief b') && !p.includes('brief z')) })
await t('3 (control) no fixer or author sees a brief that is not its own', async () => {
  const { prompts } = await go({ cycles: 1, workstreams: [ws('a'), ws('b')] }, major)
  for (const L of ['a implement', 'a review c1', 'a fix c1', 'a validate c1']) assert(prompts[L] && !prompts[L].includes('brief b'), L) })
await t('4 an answer to a blocked question reaches the cycle fixer too', async () => {
  const { prompts } = await go({ cycles: 1, decisions: { a: 'keep the owners helper' }, workstreams: [ws('a')] }, major)
  assert(prompts['a fix c1'].includes('keep the owners helper')) })

// ---- cheaper steps: typed probes, no dead result fields, no placeholder a step cannot fill ----
await t('5 the state probe and the health probe name an agentType', async () => {
  const opts = {}
  const spy = m => (p, o) => { opts[o.label] = o; return m.agent(p, o) }
  const args = { cycles: 1, resume: 'wf_old-123', carryForward: { call: 1 }, workstreams: [ws('a')] }
  const m = mock(args, { 'a implement': () => null })
  await Run(args, spy(m), parallel, () => {}, free).catch(() => {})
  const probes = Object.keys(opts).filter(L => L.endsWith(' state') || L.startsWith('health '))
  assert(probes.some(L => L.endsWith(' state')), `no state probe ran: ${Object.keys(opts)}`)
  assert(probes.some(L => L.startsWith('health ')), `no health probe ran: ${Object.keys(opts)}`)
  for (const L of probes) assert(opts[L].agentType, L) })
await t('6 the merge and the whole-branch fix are not asked for fields the script never reads', async () => {
  const opts = {}
  const args = { cycles: 1, workstreams: [ws('a'), ws('b')] }
  const m = mock(args, wbMajor)
  await Run(args, (p, o) => { opts[o.label] = o; return m.agent(p, o) }, parallel, () => {}, free)
  const has = (L, k) => k in opts[L].schema.properties || opts[L].schema.required.includes(k)
  for (const k of ['sharedEdits', 'decisions', 'questions']) assert(!has('a merge', k), `merge ${k}`)
  for (const k of ['sharedEdits', 'decisions']) assert(!has('one fix r1', k), `whole-branch fix ${k}`)
  for (const k of ['questions', 'answers', 'notes']) assert(has('one fix r1', k), `whole-branch fix keeps ${k}`)
  for (const k of ['sharedEdits', 'decisions', 'questions']) assert(has('a implement', k), `implement keeps ${k}`)
  assert(!/(decisions|questions) empty/.test(m.prompts['a merge'] + m.prompts['one fix r1'])) })
await t('7 contracts and docs get each repo\'s base by name', async () => {
  const { prompts } = await go({ cycles: 1, docsRepos: [{ repo: '/r/one', featureBranch: 'f' }], workstreams: [ws('a', { base: 'develop' }), ws('z', { repo: '/r/two' })] }, {})
  for (const L of ['contracts', 'one docs']) assert(/\/r\/one @ f = [0-9a-f]{40} \(base origin\/develop\)/.test(prompts[L]), L) })
await t('8 no prompt names a script constant', async () => {
  const { prompts } = await go({ cycles: 1, workstreams: [ws('a'), ws('b')] }, {})
  for (const L in prompts) assert(!/by SEV\b/.test(prompts[L]), L) })

if (fails.length) { console.error(fails.join('\n')); process.exit(1) }
console.log('check26 ok')
