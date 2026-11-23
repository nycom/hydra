// A resume probe unique per call (so a second resume never replays the first's git state) and soft-block questions a later validated fix settled.
// Every scenario fails against the 0.4.0 script except the ones marked (control).
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
const W = (r, id) => r.workstreams.find(w => w.id === id)
const HA = SHA(1001)

// ---- 1. the resume probe is new on every call ----
// b's review dies on every call; a merged in call 1 and is carried after that
const dies = { 'b review c1': () => null }
const carriedA = { ...dies, 'one state': () => ({ workstreams: [{ id: 'a', head: HA, merged: true }] }) }
const base = x => ({ cycles: 1, workstreams: [ws('a'), ws('b')], ...x })
await t('1a a 3-call run (call 1, resume, resume again) with no new humanChecks or decisions sends a different probe on calls 2 and 3', async () => {
  const { r: r1 } = await go(base(), dies)
  const c2 = await go(base({ resume: 'run-1', carryForward: r1.carryForward }), carriedA)
  const c3 = await go(base({ resume: 'run-1', carryForward: c2.r.carryForward }), carriedA)
  const [p2, p3] = [c2.prompts['one state'], c3.prompts['one state']]
  assert(p2 && p3 && /Resume of run run-1/.test(p2) && /Resume of run run-1/.test(p3), 'both calls probe')
  assert.notEqual(p3, p2, 'the 3rd call\'s probe must not be a cached replay of the 2nd\'s') })
await t('1b the call ordinal rides in carryForward: 1 after the first call, one more after each resume', async () => {
  const { r: r1 } = await go(base(), dies)
  const c2 = await go(base({ resume: 'run-1', carryForward: r1.carryForward }), carriedA)
  const c3 = await go(base({ resume: 'run-1', carryForward: c2.r.carryForward }), carriedA)
  assert.deepEqual([r1.carryForward.call, c2.r.carryForward.call, c3.r.carryForward.call], [1, 2, 3])
  assert(/\bcall 2\b/.test(c2.prompts['one state']) && /\bcall 3\b/.test(c3.prompts['one state']), c3.prompts['one state'].split('\n')[0]) })
await t('1c with the same carryForward, a change to humanChecks or decisions alone gives a new probe', async () => {
  const { r: r1 } = await go(base({ workstreams: [ws('a', { humanCheck: 'look at it' }), ws('b')] }), dies)
  const args = x => base({ workstreams: [ws('a', { humanCheck: 'look at it' }), ws('b')], resume: 'run-1', carryForward: r1.carryForward, ...x })
  const p = async x => (await go(args(x), carriedA)).prompts['one state']
  const plain = await p({}), human = await p({ humanChecks: { a: { sha: HA, answer: 'ok' } } }), decided = await p({ decisions: { b: 'keep it' } })
  assert(new Set([plain, human, decided]).size === 3, 'each resume input changes the probe') })
await t('1d (control) the probe is deterministic: the same args give the same probe text', async () => {
  const { r: r1 } = await go(base(), dies)
  const args = base({ resume: 'run-1', carryForward: r1.carryForward, decisions: { b: 'keep it' } })
  assert.equal((await go(args, carriedA)).prompts['one state'], (await go(args, carriedA)).prompts['one state']) })
await t('1e a carryForward call that is not a positive integer throws', async () => {
  for (const call of [0, 1.5, '2']) await assert.rejects(go(base({ resume: 'r', carryForward: { call } }), {}), /carryForward\.call/, String(call)) })

// ---- 2. a question a later fix of the same workstream settled leaves questions ----
const optional = Q('optional: also flip the stale assertion in b/old.test.js?')
const softBlock = { 'a implement': () => ({ status: 'blocked', ok: true, questions: [optional] }), 'a review c1': () => ({ findings: [F('c1-F1')] }), 'a validate c1': () => ({ verified: ['c1-F1'] }) }
const fixWith = own => ({ ...softBlock, 'a fix c1': () => ({ answers: [{ id: 'c1-F1', action: 'fixed', note: 'flipped it under the integration-fix exception' }], ...own }) })
await t('2a the fix prompt lists the open questions by id, and a settled one never reaches the top-level questions', async () => {
  const { r, prompts } = await go({ cycles: 1, workstreams: [ws('a')] }, fixWith({ settles: ['Q1'] }))
  assert(prompts['a fix c1'].includes('"id":"Q1"') && prompts['a fix c1'].includes(optional.q) && /settles/.test(prompts['a fix c1']), 'the fixer sees the question and how to settle it')
  assert(W(r, 'a').merged, 'merged')
  assert(!r.questions.some(q => q.q.includes(optional.q)) && !W(r, 'a').questions.some(q => q.q === optional.q), JSON.stringify(r.questions))
  assert(W(r, 'a').notes.some(x => x.includes('fix c1 settled') && x.includes(optional.q)), JSON.stringify(W(r, 'a').notes)) })
await t('2b (control) a fix that settles nothing leaves the question with the user', async () => {
  const { r } = await go({ cycles: 1, workstreams: [ws('a')] }, fixWith({}))
  assert(r.questions.some(q => q.q === `a: ${optional.q}`), JSON.stringify(r.questions)) })
await t('2c (control) an unknown id in settles changes nothing', async () => {
  const { r } = await go({ cycles: 1, workstreams: [ws('a')] }, fixWith({ settles: ['Q9'] }))
  assert(r.questions.some(q => q.q === `a: ${optional.q}`), JSON.stringify(r.questions)) })
await t('2d (control) with no open question the fix prompt says nothing about settling', async () => {
  const { prompts } = await go({ cycles: 1, workstreams: [ws('a')] }, { 'a review c1': () => ({ findings: [F('c1-F1')] }), 'a validate c1': () => ({ verified: ['c1-F1'] }) })
  assert(prompts['a fix c1'] && !/settles/.test(prompts['a fix c1'])) })
await t('2e (control) a validator\'s brief-conflict question is never offered to the fixer to settle: it stays the user\'s', async () => {
  const conflict = Q('the brief and the repo disagree on the field name')
  const { r, prompts } = await go({ cycles: 1, workstreams: [ws('a')] }, { 'a validate c1': (p, k) => k === 1 ? { open: [F('v1-F1')], questions: [conflict] } : { verified: ['v1-F1'] }, 'a fix c1': () => ({ settles: ['Q1'] }) })
  assert(prompts['a fix c1'] && !prompts['a fix c1'].includes(conflict.q), 'not listed')
  assert(r.questions.some(q => q.q === `a: ${conflict.q}`), JSON.stringify(r.questions)) })

await t('2f a settle the delta validator rejects is not applied: fix c2 reverts, the question stays and is offered again', async () => {
  const { r, prompts } = await go({ cycles: 1, workstreams: [ws('a')] }, { ...fixWith({ settles: ['Q1'] }),
    'a validate c1': () => ({ verified: ['c1-F1'], open: [{ ...F('v1-R1'), kind: 'regression' }] }), 'a validate c2': () => ({ verified: ['v1-R1'] }),
    'a fix c2': () => ({ answers: [{ id: 'v1-R1', action: 'fixed', note: 'reverted the flip' }] }) })
  assert(W(r, 'a').merged && prompts['a fix c2']?.includes(optional.q), 'offered to fix c2')
  assert(r.questions.some(q => q.q === `a: ${optional.q}`) && !W(r, 'a').notes.some(x => /settled the open question/.test(x)), JSON.stringify(r.questions)) })
await t('2g an escalation question is never offered as settleable: a later settles leaves it with the user', async () => {
  const esc = Q('c1-F1: the brief and the repo disagree on the field name')
  const { r, prompts } = await go({ cycles: 1, workstreams: [ws('a')] }, {
    'a review c1': () => ({ findings: [F('c1-F1'), F('c1-F2', 'major', 'y.py:4')] }),
    'a fix c1': () => ({ answers: [{ id: 'c1-F1', action: 'escalated', note: 'brief vs repo' }, { id: 'c1-F2', action: 'fixed', note: 'n' }], questions: [esc] }),
    'a validate c1': () => ({ verified: ['c1-F1'], open: [F('c1-F2', 'major', 'y.py:4')] }), 'a validate c2': () => ({ verified: ['c1-F2'] }),
    'a fix c2': () => ({ settles: ['Q1'] }) })
  assert(prompts['a fix c2'] && !prompts['a fix c2'].includes(esc.q), 'not listed')
  assert(r.questions.some(q => q.q === `a: ${esc.q}`), JSON.stringify(r.questions)) })

// ---- 3. the whole-branch fixer can settle a workstream's open soft-block question ----
const wbSoft = { 'a implement': () => ({ status: 'blocked', ok: true, questions: [optional] }), 'one validate': () => ({ verdict: 'fail', findings: [F('V-F1')] }) }
await t('3a the whole-branch fixer sees the open soft-block questions; a settle the recheck passes drops it with a repo note', async () => {
  const { r, prompts } = await go({ cycles: 1, workstreams: [ws('a')] }, { ...wbSoft, 'one fix r1': () => ({ answers: [{ id: 'V-F1', action: 'fixed', note: 'flipped' }], settles: ['a:Q1'] }), 'one recheck r1': () => ({ verified: ['V-F1'] }) })
  assert(prompts['one fix r1']?.includes('"id":"a:Q1"') && /settles/.test(prompts['one fix r1']), 'listed to the whole-branch fixer')
  assert(r.repos[0].verdict === 'pass' && !r.questions.some(q => q.q.includes(optional.q)), JSON.stringify(r.questions))
  assert(r.repos[0].notes.some(x => /settled the open question/.test(x) && x.includes(optional.q)), JSON.stringify(r.repos[0].notes)) })
await t('3b (control) a whole-branch settle whose pass fails is not applied', async () => {
  const { r } = await go({ cycles: 1, workstreams: [ws('a')] }, { ...wbSoft, 'one fix r1': () => ({ settles: ['a:Q1'] }), 'one fix r2': () => ({ settles: ['a:Q1'] }), 'one recheck r1': () => ({ verdict: 'fail', findings: [F('V-F1')] }), 'one recheck r2': () => ({ verdict: 'fail', findings: [F('V-F1')] }) })
  assert(r.repos[0].verdict === 'fail' && r.questions.some(q => q.q === `a: ${optional.q}`), JSON.stringify(r.questions)) })

// ---- docs and version ----
await t('6a SKILL.md states the per-call probe and settled questions; plugin.json is at least 0.4.1', async () => {
  const s = readFileSync(new URL('../SKILL.md', import.meta.url), 'utf8')
  const row = s.split('\n').find(l => l.startsWith('| `resume` |'))
  assert(/call ordinal/.test(row) && /digest/.test(row) && !/its prompt names that id, so it always runs live/.test(row), 'resume row')
  assert(/`settles`/.test(s), 'settled questions')
  const v = JSON.parse(readFileSync(new URL('../../../.claude-plugin/plugin.json', import.meta.url), 'utf8')).version.split('.').map(Number); assert(v[0] > 0 || v[1] > 4 || (v[1] === 4 && v[2] >= 1), 'at least 0.4.1') })

if (fails.length) { console.error(fails.join('\n')); process.exit(1) }
console.log('check23 ok')
