// Per-id escalation questions: one is made for every accepted escalation no fixer question names.
// Every scenario fails against the 0.3.7 script except the ones marked (control).
import { Run } from './run.mjs'
import assert from 'node:assert'
const SHA = n => (n + '').padStart(40, 'a')
const parallel = fs => Promise.all(fs.map(f => f().catch(() => null)))
const free = { total: null, spent: () => 0, remaining: () => Infinity }
const push = { status: 'done', ok: true, tests: 't', gateTail: 'exit 0', sharedEdits: [], decisions: [], questions: [], notes: [] }
const green = { green: true, summary: '12 passed', command: 'npm test', flaky: [] }
const F = (id, severity = 'major', where = 'x.py:3') => ({ id, severity, kind: 'bug', where, issue: `issue ${id}`, evidence: 'test t1 red' })
const Q = q => ({ q, options: ['keep', 'change'], default: 'keep' })
function mock(args, sc = {}) {
  const prompts = {}, opts = {}, all = {}, order = [], merges = {}
  const head = {}
  let n = 0
  const repoOf = L => { const w = args.workstreams.find(w => L.startsWith(`${w.id} `)); return w ? w.repo : `/r/${L.split(' ')[0]}` }
  const agent = async (p, o) => {
    const L = o.label.replace(/ attempt \d$/, '')
    prompts[L] = p; opts[L] = o; (all[L] ||= []).push(p); order.push(L)
    const id = L.split(' ')[0]
    const repo = repoOf(L)
    const own = sc[L]?.(p, all[L].length)
    if (own === null) return null
    if (L.endsWith('implement')) return (head[id] = SHA(id.length), { ...push, sha: head[id], ...own })
    if (/fix c(\d)/.test(L)) { const r = { ...push, sha: SHA(200 + ++n), answers: [], ...own }; head[id] = r.sha; return r }
    if (/review c\d/.test(L)) return { headSha: head[id], findings: [], ...own }
    if (/validate c\d/.test(L)) return { headSha: head[id], gate: green, evidence: 'e', verified: [], open: [], ...own }
    if (L.endsWith('merge')) { const pre = head[repo] || SHA(40); head[repo] = SHA(500 + ++n); (merges[id] ||= []).push(head[repo]); return { ...push, sha: head[repo], preMergeSha: pre, baseAtMerge: SHA(40), ...own } }
    if (L.endsWith(' shared check')) return { verdict: 'pass', sections: 's', sha: head[repo], tests: 't', gate: green, findings: [], ...own }
    if (L.endsWith(' review')) return { headSha: head[repo], findings: [], seams: 'none', ...own }
    if (L.endsWith(' docs validate')) return { verdict: 'pass', sections: 's', sha: SHA(900), tests: 't', gate: green, findings: [], ...own }
    if (L.endsWith(' validate')) return { verdict: 'pass', sections: 's', sha: head[repo], tests: 't', gate: green, findings: [], verified: [], ...own }
    if (/fix r(\d)/.test(L)) { const r = { ...push, sha: SHA(70 + +L.at(-1)), answers: [], ...own }; head[repo] = r.sha; return r }
    if (/recheck r\d/.test(L)) return { verdict: 'pass', sections: 's', sha: head[repo], tests: 't', gate: green, findings: [], verified: [], ...own }
    if (L.endsWith(' docs')) return { baseSha: head[repo], sha: '', files: [], prBody: false, ok: true, tests: 't', notes: [], ...own }
    if (L.endsWith(' promote')) return { ok: true, sha: (p.match(/ to ([0-9a-f]{40})\./) || [])[1], notes: [], ...own }
    if (L === 'contracts') return { verdict: 'pass', sections: 's', findings: [], ...own }
    throw new Error('unmocked ' + L)
  }
  return { agent, prompts, opts, all, order, merges }
}
const ws = (id, extra = {}) => ({ id, repo: '/r/one', featureBranch: 'f', branch: `f--${id}`, model: 'sonnet', brief: `brief ${id}`, gate: 'npm test', files: [`${id}/`], ...extra })
const go = async (args, sc) => { const m = mock(args, sc); const r = await Run(args, m.agent, parallel, () => {}, free); return { r, ...m } }
const throwsOn = async (args, re) => { let e = null; try { await go(args, {}) } catch (x) { e = x } assert(e && re.test(e.message), `expected ${re}, got ${e?.message}`) }
const fails = []
const t = async (name, fn) => { try { await fn() } catch (e) { fails.push(`${name}: ${e.message.split('\n')[0]}`) } }
const idx = (order, L) => order.indexOf(L)
const dirtyB = { 'b review c1': () => ({ findings: [F('c1-F1')] }), 'b validate c1': () => ({ verified: ['c1-F1'] }) } // b merges after a

// M1/M2. one escalation question per escalated id; only verified escalations get one
const two = { cycles: 1, workstreams: [ws('a')] }
const escalate = (questions, verified, open = []) => ({
  'a review c1': () => ({ findings: [F('c1-F1', 'critical', 'a/x.py:9'), F('c1-F2', 'major', 'a/y.py:4')] }),
  'a fix c1': () => ({ answers: [{ id: 'c1-F1', action: 'escalated', note: 'n1' }, { id: 'c1-F2', action: 'escalated', note: 'n2' }], questions }),
  'a validate c1': () => ({ verified, open }) })
await t('M1a two verified escalations and one unrelated fixer question: a question is made for each id', async () => {
  const qf = Q('should the helper move to a shared module?')
  const { r, prompts } = await go(two, escalate([qf], ['c1-F1', 'c1-F2']))
  assert(/Start each such question with the finding id/.test(prompts['a fix c1']), 'fixer told')
  const qs = r.questions.map(q => q.q)
  assert(qs.includes(`a: ${qf.q}`) && qs.some(q => q.startsWith('a: c1-F1 (a/x.py:9')) && qs.some(q => q.startsWith('a: c1-F2 (a/y.py:4')), JSON.stringify(qs)) })
await t('M1b a fixer question that names an id covers it; the other id still gets one', async () => {
  const qf = Q('c1-F1: keep the protected call or change the brief?')
  const { r } = await go(two, escalate([qf], ['c1-F1', 'c1-F2']))
  const qs = r.questions.map(q => q.q)
  assert(qs.filter(q => /c1-F1/.test(q)).length === 1 && qs.some(q => q.startsWith('a: c1-F2 (')), JSON.stringify(qs)) })
await t('M2 (control) an escalation the validator leaves open gets no synthesized question', async () => {
  const { r } = await go(two, { ...escalate([], ['c1-F1'], [F('c1-F2', 'major', 'a/y.py:4')]), 'a fix c2': () => ({ answers: [{ id: 'c1-F2', action: 'fixed', note: 'n' }] }), 'a validate c2': () => ({ verified: ['c1-F2'] }) })
  const qs = r.questions.map(q => q.q)
  assert(qs.some(q => q.startsWith('a: c1-F1 (')) && !qs.some(q => /c1-F2/.test(q)), JSON.stringify(qs)) })

if (fails.length) { console.error(fails.join('\n')); process.exit(1) }
console.log('escalation-question checks ok')
