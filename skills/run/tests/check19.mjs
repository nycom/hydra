// Minor text fixes: churn question, decision-log sentence, regression meaning, drift prompt, infra stops, gate pipes, fixer notes, prompt-size pin, commit prefix.
// Every scenario fails against the 0.3.10 script except the ones marked (control).
import { Run } from './run.mjs'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
const SHA = n => (n + '').padStart(40, 'a')
const parallel = fs => Promise.all(fs.map(f => f().catch(() => null)))
const free = { total: null, spent: () => 0, remaining: () => Infinity }
const push = { status: 'done', ok: true, tests: 't', gateTail: 'gate exit=0', sharedEdits: [], decisions: [], questions: [], notes: [] }
const green = { green: true, summary: '12 passed', command: 'npm test', flaky: [] }
const F = (id, severity = 'major', where = 'x.py:3') => ({ id, severity, kind: 'bug', where, issue: `issue ${id}`, evidence: 'test t1 red' })
const Q = q => ({ q, options: ['keep the tests', 'edit the test'], default: 'keep the tests' })
function mock(args, sc = {}) {
  const prompts = {}, all = {}, order = [], merges = {}
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
    if (L.endsWith('merge')) { const pre = head[repo] || SHA(40); head[repo] = SHA(500 + ++n); (merges[id] ||= []).push(head[repo]); return { ...push, sha: head[repo], preMergeSha: pre, baseAtMerge: SHA(40), ...own } }
    if (/ shared check m\d+$/.test(L)) return { verdict: 'pass', sections: 's', sha: head[repo], tests: 't', gate: green, findings: [], ...own }
    if (L.endsWith(' review')) return { headSha: head[repo] || SHA(4000), findings: [], seams: 'none', ...own }
    if (L.endsWith(' docs validate')) return { verdict: 'pass', sections: 's', sha: SHA(900), tests: 't', gate: green, findings: [], ...own }
    if (L.endsWith(' validate')) return { verdict: 'pass', sections: 's', sha: head[repo] || SHA(4000), tests: 't', gate: green, findings: [], verified: [], questions: [], ...own }
    if (/fix r(\d)/.test(L)) { const r = { ...push, sha: SHA(70 + +L.at(-1)), answers: [], ...own }; head[repo] = r.sha; return r }
    if (/recheck r\d/.test(L)) return { verdict: 'pass', sections: 's', sha: head[repo], tests: 't', gate: green, findings: [], verified: [], questions: [], ...own }
    if (L.endsWith(' docs')) return { baseSha: head[repo] || SHA(4000), sha: '', files: [], prBody: false, ok: true, tests: 't', notes: [], ...own }
    if (L.endsWith(' promote')) return { ok: true, sha: (p.match(/ to ([0-9a-f]{40})\./) || [])[1], notes: [], ...own }
    if (L === 'drift') return { ok: true, notes: [], sections: 's', drift: [], ...own }
    if (L === 'contracts') return { verdict: 'pass', sections: 's', findings: [], ...own }
    throw new Error('unmocked ' + L)
  }
  return { agent, prompts, all, order, merges, head }
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
const W = (r, id) => r.workstreams.find(w => w.id === id)
const ran = (order, id) => order.filter(L => L.startsWith(`${id} `))
const state = (...xs) => ({ 'one state': () => ({ workstreams: xs }) })
const HA = SHA(1001), HB = SHA(1002), HC = SHA(1003)

// default-run prompt size in characters; lower it when a default prompt shrinks, never raise it
const PIN = 75253

const TBL = '/t/acceptance.md', LOG = '/t/decisions.md', SR = 'wrong output for a listed case, lost user data, a crash'
const busy = { 'a review c1': () => ({ findings: [F('c1-F1')] }), 'a validate c1': () => ({ verified: ['c1-F1'] }), 'one validate': (p, k) => k > 1 ? {} : { verdict: 'fail', findings: [F('V-F1', 'major', 'x.py:3')] } }

// ---- C4.5 one meaning of regression under a stop rule ----
await t('C4.5 a stop rule defines regression once, and the whole-branch hunt is a case of it', async () => {
  const { all } = await go({ cycles: 1, stopRule: SR, workstreams: [ws('a')] }, busy)
  const ps = Object.values(all).flat()
  assert(/a regression \(behaviour that works at the base branch, or worked before a fix made in this run, and breaks at this head\)/.test(all['one recheck r1'][0]))
  assert(all['one recheck r1'][0].includes('even when the base lacks the feature'))
  assert(!ps.some(p => p.includes('a regression vs the base branch (behaviour that works at the base and breaks at this head)'))) })

// ---- C4.1 drift prompt ----
await t('C4.1 the drift prompt names its task and its unreadable-log rule', async () => {
  const { prompts } = await go({ cycles: 1, decisionLog: LOG, workstreams: [ws('a')] }, {})
  assert(prompts.drift.startsWith('Drift audit, read-only: find every user-visible change that no decision-log line and no brief clause covers.'))
  assert(prompts.drift.includes('If you cannot read the decision log or a repo: ok=false, the reason in notes; still list what you could check.')) })

// ---- C1.3 infra stops ----
const dead = L => ({ [L]: () => null, [`health ${L}`]: () => null })
const INFRA_RE = /died twice and the health probe failed.*infra fault/
await t('C1.3a contracts', async () => {
  const { r, order } = await go({ cycles: 1, workstreams: [ws('a'), ws('b', { repo: '/r/two' })] }, dead('contracts'))
  assert(!order.includes('contracts attempt 3') && INFRA_RE.test(r.crossRepo.sections), r.crossRepo.sections) })
await t('C1.3b drift', async () => {
  const { r, order } = await go({ cycles: 1, decisionLog: LOG, workstreams: [ws('a')] }, dead('drift'))
  assert(!order.includes('drift attempt 3') && r.drift.notes.some(n => INFRA_RE.test(n)), JSON.stringify(r.drift.notes)) })
await t('C1.3c docs', async () => {
  const { r, order } = await go({ cycles: 1, workstreams: [ws('a')] }, dead('one docs'))
  assert(!order.includes('one docs attempt 3') && r.repos[0].docs.notes.some(n => INFRA_RE.test(n)) && r.repos[0].escalations.some(n => INFRA_RE.test(n) && /docs not synced/.test(n)), JSON.stringify(r.repos[0])) })
await t('C1.3d promote', async () => {
  const { r, order } = await go({ cycles: 1, workstreams: [ws('a')] }, { ...busy, 'one recheck r1': () => ({ verified: ['V-F1'] }), ...dead('one promote') })
  assert(!order.includes('one promote attempt 3') && r.repos[0].escalations.some(n => INFRA_RE.test(n)), JSON.stringify(r.repos[0].escalations)) })
await t('C1.3e (control) a dead agent with a healthy probe still reads "died 3 times"', async () => {
  const { r } = await go({ cycles: 1, decisionLog: LOG, workstreams: [ws('a')] }, { drift: () => null })
  assert(r.drift.notes.includes('drift agent died 3 times'), JSON.stringify(r.drift.notes)) })

// ---- C1.5 gate pipes ----
const rejects = async (args, re) => { let e = null; try { await go(args, {}) } catch (x) { e = x } assert(e && re.test(e.message), `expected ${re}, got ${e?.message}`) }
await t('C1.5 a gate that pipes into head or grep -q is rejected, tee and tail pass', async () => {
  await rejects({ cycles: 1, workstreams: [ws('a', { gate: 'npm test | head -50' })] }, /SIGPIPE/)
  await rejects({ cycles: 1, workstreams: [ws('a', { quickGate: 'x | grep -q ok' })] }, /SIGPIPE/)
  await rejects({ cycles: 1, workstreams: [ws('a')], docsRepos: [{ repo: '/r/one', featureBranch: 'f', gate: 'npm test | head -5' }] }, /SIGPIPE/)
  await go({ cycles: 1, workstreams: [ws('a', { gate: 'npm test | tee log; npm run lint' })] }, {})
  await go({ cycles: 1, workstreams: [ws('a', { gate: 'npm test | tail -5' })] }, {})
  await go({ cycles: 1, workstreams: [ws('a', { gate: 'npm test || head -50 err.log' })] }, {}) })

// ---- C1.6 whole-branch fixer notes ----
await t('C1.6 the whole-branch fixer lists changed files; its notes reach the repo', async () => {
  const { r, prompts } = await go({ cycles: 1, workstreams: [ws('a')] }, { ...busy, 'one fix r1': () => ({ notes: ['changed: a/x.py'] }) })
  assert(prompts['one fix r1'].includes('In notes, list each file you changed as "changed: <path>".') && !/name each workstream of this run/.test(prompts['one fix r1']))
  assert(r.repos[0].notes.includes('changed: a/x.py'), JSON.stringify(r.repos[0].notes)) })

// ---- FB commit prefix ----
await t('FB commitPrefix goes on the merge step\'s fixed subjects only', async () => {
  const sc = { 'a implement': () => ({ sharedEdits: [{ file: 'README.md', intent: 'x' }] }) }
  const args = pre => ({ cycles: 1, workstreams: [ws('a')], repos: [{ repo: '/r/one', regen: 'make gen', ...(pre !== undefined && { commitPrefix: pre }) }] })
  const on = await go(args('chore: '), sc), off = await go(args(), sc)
  assert(on.prompts['a merge'].includes('"chore: Update shared files for a"') && on.prompts['a merge'].includes('"chore: Regenerate generated files"'), on.prompts['a merge'])
  assert(on.prompts['a merge'].includes('-m "Merge f--a into f"'))
  assert(off.prompts['a merge'].includes('"Update shared files for a"') && off.prompts['a merge'].includes('"Regenerate generated files"') && !off.prompts['a merge'].includes('chore:'))
  for (const bad of ['a"b', 'a\nb', '']) await rejects(args(bad), /commitPrefix/)
  assert(!(await go(args(null), sc)).prompts['a merge'].includes('null')) })
await t('FB commitPrefix goes on the docs graph commit', async () => {
  const { prompts } = await go({ cycles: 1, workstreams: [ws('a')], repos: [{ repo: '/r/one', commitPrefix: 'chore: ' }] }, {})
  assert(prompts['one docs'].includes('"chore: Refresh the knowledge graph"')) })

// ---- Z1 default prompt size ----
await t('Z1 the prompt size of a default run only shrinks', async () => {
  const { r, all } = await go({ cycles: 1, workstreams: [ws('a'), ws('b')] }, { ...busy, 'one recheck r1': () => ({ verified: ['V-F1'] }), 'one docs': () => ({ sha: SHA(900), files: ['README.md'] }) })
  assert(r.repos[0].verdict === 'pass' && 'one docs' in all, `repo ${r.repos[0].verdict}: the pin must cover the docs commit`)
  const total = Object.values(all).flat().reduce((n, p) => n + p.length, 0)
  assert(total <= PIN, `default prompts total ${total} chars, pin ${PIN}`) })

if (fails.length) { console.error(fails.join('\n')); process.exit(1) }
console.log('check19 ok')
