// Resume from git, human checks bound to the workstream head, resumable blocks, fixes outside files[], gate wrapper + health probe.
// Every scenario fails against the 0.3.9 script except the ones marked (control).
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

// ---- 1. resume rebuilds workstream state from git ----
await t('1a resume: merged workstreams are carried merged:true with no agent of theirs; the unmerged one re-runs live; the repo passes', async () => {
  const args = { cycles: 1, resume: 'run-1', workstreams: [ws('a'), ws('b'), ws('c')] }
  const { r, order, prompts } = await go(args, state({ id: 'a', head: HA, merged: true }, { id: 'b', head: HB, merged: true }, { id: 'c', head: HC, merged: false }))
  assert(/Resume of run run-1/.test(prompts['one state'] || ''), 'the probe names the resumed run, so its prompt is never a cached one')
  assert.deepEqual([...ran(order, 'a'), ...ran(order, 'b')], [], order.join())
  assert(W(r, 'a').merged && W(r, 'b').merged && W(r, 'a').validatedSha === HA && !W(r, 'a').escalations.length, JSON.stringify(W(r, 'a')))
  assert(order.includes('c implement') && order.includes('c merge') && W(r, 'c').merged, order.join())
  assert.equal(r.repos[0].verdict, 'pass') })
await t('1b resume: a dependent of a carried workstream starts, and its prompt names the carried head', async () => {
  const { r, prompts } = await go({ cycles: 1, resume: 'run-1', workstreams: [ws('a'), ws('c', { after: ['a'] })] }, state({ id: 'a', head: HA, merged: true }))
  assert(W(r, 'c').merged && prompts['c implement'].includes(`for each of ${HA}`), JSON.stringify(W(r, 'c').escalations)) })
await t('1c an implement step that finds its branch already merged is success: carried, no review or merge, dependents start', async () => {
  const { r, order, prompts } = await go({ cycles: 1, workstreams: [ws('a'), ws('c', { after: ['a'] })] }, { 'a implement': () => ({ alreadyMerged: true }) })
  assert(/that is success, not a block/.test(prompts['a implement']) && !/if it is already merged, stop with status "blocked"/.test(prompts['a implement']))
  assert(W(r, 'a').merged && !order.includes('a review c1') && !order.includes('a merge') && W(r, 'c').merged, order.join()) })
await t('1d no whole-branch pass while a planned workstream is unmerged: verdict incomplete, no wb agents, no contracts or docs', async () => {
  const { r, order } = await go({ cycles: 1, workstreams: [ws('a'), ws('b'), ws('c', { repo: '/r/two' })] }, { 'b review c1': () => null })
  assert(W(r, 'a').merged && !W(r, 'b').merged)
  const one = r.repos.find(x => x.repo === '/r/one')
  assert(one.verdict === 'incomplete' && /b not merged/.test(one.sections) && !order.includes('one review') && !order.includes('one validate'), JSON.stringify(one))
  assert(!order.includes('contracts') && !order.some(L => / docs$/.test(L)), order.join()) })
await t('1e (control) stage wholeBranch still runs on the tips it is given', async () => {
  const { r } = await go({ stage: 'wholeBranch', workstreams: [ws('a')] }, {})
  assert.equal(r.repos[0].verdict, 'pass') })

// ---- 2. human checks bind to the workstream's own head ----
const look = 'open the preview and look at the chart'
await t('2a a re-merge on a moved feature tip with no new workstream commit keeps the answer', async () => {
  const args = h => ({ cycles: 1, workstreams: [ws('a', { humanCheck: look })], ...(h && { humanChecks: h }) })
  const first = (await go(args(), {})).r.humanCheck[0]
  assert.equal(first.sha, SHA('a'.charCodeAt(0)), 'the bind key is the workstream head')
  const { r } = await go(args({ a: { sha: first.sha, answer: 'ok' } }), { 'a merge': () => ({ sha: SHA(4242) }) }) // another merge moved the tip
  assert(!('humanCheck' in r) && r.repos[0].verdict === 'pass', JSON.stringify(r.humanCheck)) })
await t('2b two checks in one repo are asked in one pause, both workstreams merged', async () => {
  const { r, order } = await go({ cycles: 1, workstreams: [ws('a', { humanCheck: look }), ws('b', { humanCheck: 'and the sidebar' })] }, {})
  assert(order.includes('a merge') && order.includes('b merge') && r.humanCheck?.length === 2, JSON.stringify(r.humanCheck))
  assert(r.repos[0].verdict === 'paused' && /check 1 of a/.test(r.repos[0].sections) && /check 1 of b/.test(r.repos[0].sections), r.repos[0].sections) })
await t('2c a carried workstream is checked on its own head; an ok on it settles the check with no agent re-run', async () => {
  const args = h => ({ cycles: 1, resume: 'run-2', workstreams: [ws('a', { humanCheck: look })], ...(h && { humanChecks: h }) })
  const sc = state({ id: 'a', head: HA, merged: true })
  const asked = (await go(args(), sc)).r.humanCheck?.[0]
  assert(asked && asked.sha === HA && asked.checkAt === SHA(4000) && asked.round === 1 && /resume = this run's id/.test(asked.answer), JSON.stringify(asked))
  const { r, order } = await go(args({ a: { sha: HA, answer: 'ok' } }), sc)
  assert(!('humanCheck' in r) && !ran(order, 'a').length && r.repos[0].verdict === 'pass', order.join()) })
await t('2d round keeps counting across calls: a problem on a carried head is fixed and asked again as round 2', async () => {
  const { r, order } = await go({ cycles: 1, resume: 'run-3', workstreams: [ws('a', { humanCheck: look })], humanChecks: { a: [{ sha: HA, answer: 'the label is cut off' }] } },
    { ...state({ id: 'a', head: HA, merged: true }), 'a validate c1': () => ({ verified: ['H1-F1'] }) })
  assert(order.includes('a fix c1') && !order.includes('a implement'), order.join())
  const h = r.humanCheck?.[0]
  assert(h && h.round === 2 && h.sha === W(r, 'a').validatedSha && h.sha !== HA && h.answer.includes(`{"sha":"${HA}","answer":"the label is cut off"}`), JSON.stringify(h)) })
await t('2e the merge accepts a head reached only through commits already on the feature branch, and "already up to date" is merged', async () => {
  const { r, prompts } = await go({ cycles: 1, workstreams: [ws('a')] }, { 'a merge': () => ({ alreadyMerged: true, notes: ['Already up to date'] }) })
  assert(/descend from it only through commits already on origin\/f/.test(prompts['a merge']) && /it is merged, never a failure \("Already up to date"\)/.test(prompts['a merge']))
  assert(W(r, 'a').merged && !W(r, 'a').findings.some(e => e.id === 'M-F1')) })

// ---- 3. a block on a contradicting pre-existing test resumes the same workstream ----
await t('3a a blocked author leaves a decision; the re-run with decisions.<id> resumes that workstream with the answer in every prompt', async () => {
  const args = d => ({ cycles: 1, resume: 'run-4', workstreams: [ws('a')], ...(d && { decisions: d }) })
  const { r } = await go(args(), { 'a implement': () => ({ status: 'blocked', ok: false, sha: '', questions: [Q('a test pins the old rounding')] }) })
  assert(W(r, 'a').decision?.answer.includes('decisions.a = ') && W(r, 'a').decision.questions.length === 1, JSON.stringify(W(r, 'a').decision))
  const { r: r2, prompts } = await go(args({ a: 'edit the test to half up' }), state({ id: 'a', head: HA, merged: false }))
  for (const L of ['a implement', 'a review c1', 'a validate c1']) assert(prompts[L].includes('edit the test to half up') && /authorised test edit: <path>/.test(prompts[L]), L)
  assert(W(r2, 'a').merged) })
await t('3b blocked only on an optional sub-part with a green, pushed head: it continues to review and merge, the question carried', async () => {
  const { r, order } = await go({ cycles: 1, workstreams: [ws('a')] }, { 'a implement': () => ({ status: 'blocked', ok: true, questions: [Q('optional: also tint the label?')] }) })
  assert(W(r, 'a').merged && order.includes('a review c1'), order.join())
  assert(r.questions.some(q => /optional: also tint the label/.test(q.q))) })
await t('3c a hard block still stops (control), and decisions for an unknown workstream throw', async () => {
  const { r } = await go({ cycles: 1, workstreams: [ws('a')] }, { 'a implement': () => ({ status: 'blocked', ok: false, sha: '', questions: [Q('contradiction')] }) })
  assert(!W(r, 'a').merged)
  let e = null; try { await go({ workstreams: [ws('a')], decisions: { zz: 'x' } }, {}) } catch (x) { e = x }
  assert(e && /decisions\.zz: no workstream zz/.test(e.message), e?.message) })

// ---- 4. a fix outside files[] is handed to the whole-branch pass ----
const outside = { 'a review c1': () => ({ findings: [F('c1-F1', 'major', 'b/util.js:9')] }), 'a fix c1': () => ({ answers: [{ id: 'c1-F1', action: 'carried', note: 'the fix flips a pre-existing assertion in b/util.test.js' }] }) }
await t('4a a carried finding stops counting: the workstream merges on the next clean review, not at the cap, and the whole-branch fixer gets it', async () => {
  const { r, order, prompts } = await go({ cycles: null, workstreams: [ws('a'), ws('b')] }, outside)
  const a = W(r, 'a')
  assert(a.merged && a.cyclesRun === 2 && a.handed.length === 1 && a.findings.find(e => e.id === 'c1-F1')?.status === 'carried', JSON.stringify(a))
  assert(/answer it "carried"/.test(prompts['a fix c1']) && /Handed to the whole-branch pass .*c1-F1/.test(prompts['a validate c1']))
  assert(!/Needing anything else is status "blocked"|a blocker outside your files is status "blocked"/.test(prompts['a fix c1']) && /a blocker outside your files is answered "carried"/.test(prompts['a fix c1']), 'the fix prompt never also tells a files[] workstream to block on an out-of-files fix')
  assert(order.includes('one fix r1') && prompts['one fix r1'].includes('"a:c1-F1"') && /name each workstream of this run whose brief reads or edits a file you changed/.test(prompts['one fix r1']), order.join()) })
await t('4b (control) with no files[] declared, "carried" is not offered and the finding stays open', async () => {
  const { r, prompts } = await go({ cycles: 1, maxCycles: 1, workstreams: [ws('a', { files: undefined })] }, outside)
  assert(!/answer it "carried"/.test(prompts['a fix c1']) && /a blocker outside your files is status "blocked"/.test(prompts['a fix c1']) && !W(r, 'a').merged) })

// ---- 5. gate wrapper and health probe ----
await t('5a every gate run goes through the pipefail wrapper that prints the exit code last', async () => {
  const { all } = await go({ cycles: 1, workstreams: [ws('a', { gate: 'npm test | tee log; npm run lint' })] }, {})
  const cmd = `bash -c 'set -eo pipefail\nnpm test | tee log; npm run lint'; echo "gate exit=$?"`
  for (const L of ['a implement', 'a validate c1', 'a merge', 'one validate']) assert(all[L][0].includes(cmd) && /"gate exit=0" is green\. Any other exit is red/.test(all[L][0]), L) })
await t('5d a known-red failure stops the wrapper\'s chain, so the gate prompt says it is allowed and the commands after it still run', async () => {
  const { all } = await go({ cycles: 1, workstreams: [ws('a')], repos: [{ repo: '/r/one', knownRed: ['t_upstream'] }] }, {})
  for (const L of ['a implement', 'a validate c1', 'a merge', 'one validate'])
    assert(/red unless every failure it printed is allowed by the green rules below/.test(all[L][0]) && /run each command after the failing one through the same wrapper too, so no suite stays unrun/.test(all[L][0]) && all[L][0].includes('t_upstream'), L) })
await t('5b a second death with a failed health probe ends as an infra fault instead of a third blind attempt', async () => {
  const { r, order } = await go({ cycles: 1, workstreams: [ws('a')] }, { 'a review c1': () => null, 'health a review c1': () => null })
  assert(!order.includes('a review c1 attempt 3') && order.includes('health a review c1'), order.join())
  assert(W(r, 'a').escalations.some(e => /review c1 died twice and the health probe failed.*infra fault.*resume/.test(e)), JSON.stringify(W(r, 'a').escalations)) })
await t('5c (control) a healthy probe lets the third attempt run', async () => {
  const { order } = await go({ cycles: 1, workstreams: [ws('a')] }, { 'a review c1': (p, k) => k < 3 ? null : {} })
  assert(order.includes('a review c1 attempt 3'), order.join()) })

// ---- 7. a resume keeps what git cannot say (carryForward) ----
await t('7a a finding handed over in call 1 reaches the whole-branch fixer in the resume, never a silent pass', async () => {
  const args = x => ({ cycles: null, workstreams: [ws('a'), ws('b')], ...x })
  const { r: r1 } = await go(args(), { ...outside, 'b review c1': () => null })
  assert(r1.repos[0].verdict === 'incomplete' && r1.carryForward?.workstreams?.a?.handed?.length === 1, JSON.stringify(r1.carryForward))
  const { r, prompts } = await go(args({ resume: 'run-5', carryForward: r1.carryForward }), state({ id: 'a', head: W(r1, 'a').validatedSha, merged: true }))
  assert(W(r, 'a').merged && W(r, 'b').merged && (prompts['one fix r1'] || '').includes('"a:p:c1-F1"'), Object.keys(prompts).join())
  assert(r.repos[0].findings.some(e => e.id === 'a:p:c1-F1' && e.stage === 'handed'), JSON.stringify(r.repos[0].findings)) })
await t('7b a shared-edits blocker from the paused call reaches the whole-branch fixer after a human-check resume', async () => {
  const EDITS = [{ file: 'README.md', intent: 'add a row' }]
  const args = x => ({ cycles: 1, workstreams: [ws('a', { humanCheck: look })], repos: [{ repo: '/r/one', reviewSharedEdits: true }], ...x })
  const sc = { 'a implement': () => ({ sharedEdits: EDITS }), 'a shared check m1': () => ({ verdict: 'fail', findings: [F('S-a-m1-F1', 'major', 'README.md:4')] }) }
  const { r: r1 } = await go(args(), sc)
  const H = r1.humanCheck[0].sha
  const { prompts } = await go(args({ resume: 'run-6', carryForward: r1.carryForward, humanChecks: { a: { sha: H, answer: 'ok' } } }), state({ id: 'a', head: H, merged: true }))
  assert((prompts['one fix r1'] || '').includes('"p:S-a-m1-F1"'), Object.keys(prompts).join()) })
await t('7c a whole-branch pass that passed in the paused call is kept when its feature branch has not moved', async () => {
  const args = x => ({ cycles: 1, workstreams: [ws('a', { humanCheck: look }), ws('c', { repo: '/r/two' })], ...x })
  const { r: r1 } = await go(args(), {})
  const two = r1.repos.find(x => x.repo === '/r/two'), H = r1.humanCheck[0].sha
  assert(two.verdict === 'pass' && r1.carryForward.repos['/r/two'].passed?.sha === two.sha)
  const sc = tip => ({ ...state({ id: 'a', head: H, merged: true }), 'two state': () => ({ featureSha: tip, workstreams: [{ id: 'c', head: W(r1, 'c').validatedSha, merged: true }] }) })
  const again = args({ resume: 'run-7', carryForward: r1.carryForward, humanChecks: { a: { sha: H, answer: 'ok' } } })
  const { r, order } = await go(again, sc(two.sha))
  assert(!order.includes('two review') && !order.includes('two validate') && r.repos.find(x => x.repo === '/r/two').verdict === 'pass' && order.includes('contracts'), order.join())
  const moved = await go(again, sc(SHA(4321))) // (control) the tip moved: the pass runs again
  assert(moved.order.includes('two validate'), moved.order.join()) })
await t('7d round and spent answers survive a resume: a third call on a carried head files H2-F1 and asks round 3', async () => {
  const { r, order } = await go({ cycles: 1, resume: 'run-8', workstreams: [ws('a', { humanCheck: look })], humanChecks: { a: [{ sha: HA, answer: 'grey' }, { sha: HB, answer: 'still grey' }] } },
    { ...state({ id: 'a', head: HB, merged: true }), 'a validate c1': () => ({ verified: ['H2-F1'] }) })
  assert(W(r, 'a').findings.some(e => e.id === 'H2-F1') && !W(r, 'a').findings.some(e => e.id === 'H1-F1'), order.join())
  const h = r.humanCheck?.[0]
  assert(h?.round === 3 && h.answer.includes(`[{"sha":"${HA}","answer":"grey"},{"sha":"${HB}","answer":"still grey"},`), JSON.stringify(h)) })
await t('7e a no-commit fix answered ok on the same head: the resume applies the ok, never the spent problem', async () => {
  const { r, order } = await go({ cycles: 1, resume: 'run-9', workstreams: [ws('a', { humanCheck: look })], humanChecks: { a: [{ sha: HA, answer: 'grey' }, { sha: HA, answer: 'ok' }] } }, state({ id: 'a', head: HA, merged: true }))
  assert(!ran(order, 'a').length && !('humanCheck' in r) && r.repos[0].verdict === 'pass', order.join()) })
await t('7f a fix pushed but not merged at the resume lands on a new head and is asked as round 2', async () => {
  const { r } = await go({ cycles: 1, resume: 'run-10', workstreams: [ws('a', { humanCheck: look })], humanChecks: { a: [{ sha: HA, answer: 'grey' }] } }, state({ id: 'a', head: HB, merged: false }))
  assert(r.humanCheck?.[0]?.round === 2, JSON.stringify(r.humanCheck)) })
await t('7g carryForward without resume, or naming an unknown workstream, throws', async () => {
  for (const [x, re] of [[{ carryForward: {} }, /only for a resume/], [{ resume: 'r', carryForward: { workstreams: { zz: {} } } }, /carryForward\.workstreams\.zz/]]) {
    let e = null; try { await go({ workstreams: [ws('a')], ...x }, {}) } catch (y) { e = y }
    assert(e && re.test(e.message), e?.message)
  } })

// ---- 8. restored ids never collide; every result can be resumed ----
await t('8a a restarted workstream whose new c1-F1 shares an id with a restored handed finding stays open and does not merge', async () => {
  const old = F('c1-F1', 'major', 'a/old.test.js:2')
  const carryForward = { workstreams: { a: { handed: [old], open: [], findings: [{ ...old, stage: 'review', status: 'carried' }] } }, repos: {} }
  const { r, prompts } = await go({ cycles: 1, maxCycles: 1, resume: 'run-11', carryForward, workstreams: [ws('a')] },
    { ...state({ id: 'a', head: HA, merged: false }), 'a review c1': () => ({ findings: [F('c1-F1', 'critical', 'a/core.js:5')] }), 'a fix c1': () => ({ answers: [{ id: 'c1-F1', action: 'fixed', note: 'n' }] }), 'a validate c1': () => ({ open: [F('c1-F1', 'critical', 'a/core.js:5')] }) })
  assert(!W(r, 'a').merged && W(r, 'a').open.some(x => /a\/core\.js:5/.test(x)), JSON.stringify(W(r, 'a')))
  assert(/Handed to the whole-branch pass .*: p:c1-F1\n/.test(prompts['a validate c1']), 'the validator is told only about the restored id')
  assert(W(r, 'a').findings.some(e => e.id === 'p:c1-F1' && e.status === 'carried') && W(r, 'a').findings.some(e => e.id === 'c1-F1' && e.status === 'open')) })
await t('8b a whole-branch fail the escalation calls resumable carries the handed finding into that resume', async () => {
  const args = x => ({ cycles: null, workstreams: [ws('a'), ws('b')], ...x })
  const { r: r1 } = await go(args(), { ...outside, 'one validate': () => null, 'health one validate': () => null })
  assert(r1.repos[0].verdict === 'fail' && r1.repos[0].escalations.some(e => /carryForward = this result's carryForward/.test(e)) && r1.carryForward?.workstreams?.a?.handed?.length === 1, JSON.stringify(r1.repos[0].escalations))
  const { r, prompts } = await go(args({ resume: 'run-12', carryForward: r1.carryForward }), { ...state({ id: 'a', head: W(r1, 'a').validatedSha, merged: true }, { id: 'b', head: W(r1, 'b').validatedSha, merged: true }), 'one recheck r1': () => ({ verified: ['a:p:c1-F1'] }) })
  assert((prompts['one fix r1'] || '').includes('"a:p:c1-F1"') && r.repos[0].verdict === 'pass', Object.keys(prompts).join()) })
await t('8c a re-merge\'s shared check in the resume files its own S-a-m1-F1 next to the restored one, under a different id', async () => {
  const EDITS = [{ file: 'README.md', intent: 'add a row' }]
  const args = x => ({ cycles: 1, workstreams: [ws('a', { humanCheck: look })], repos: [{ repo: '/r/one', reviewSharedEdits: true }], ...x })
  const sc = { 'a implement': () => ({ sharedEdits: EDITS }), 'a fix c1': () => ({ sharedEdits: EDITS }), 'a validate c1': () => ({ verified: ['H1-F1'] }), 'a shared check m1': () => ({ verdict: 'fail', findings: [F('S-a-m1-F1', 'major', 'README.md:4')] }) }
  const { r: r1 } = await go(args(), sc)
  const H = r1.humanCheck[0].sha
  const { r } = await go(args({ resume: 'run-13', carryForward: r1.carryForward, humanChecks: { a: { sha: H, answer: 'grey' } } }), { ...sc, ...state({ id: 'a', head: H, merged: true }) })
  const ids = r.repos[0].findings.map(e => e.id)
  assert(ids.includes('p:S-a-m1-F1') && ids.includes('S-a-m1-F1') && new Set(ids).size === ids.length, ids.join()) })
await t('8d a malformed carryForward passed result throws at the args check', async () => {
  let e = null; try { await go({ resume: 'r', carryForward: { repos: { '/r/one': { passed: { verdict: 'pass', sha: SHA(1) } } } }, workstreams: [ws('a')] }, {}) } catch (y) { e = y }
  assert(e && /passed must be the repo result of a passed whole-branch pass/.test(e.message), e?.message) })

// ---- 9. carryForward round-trips cleanly ----
await t('9a a pass on a 12-hex whole-branch sha emits a carryForward its resume accepts', async () => {
  const short12 = SHA(4000).slice(0, 12)
  const args = x => ({ cycles: 1, workstreams: [ws('a', { humanCheck: look }), ws('c', { repo: '/r/two' })], ...x })
  const sc = { 'two validate': () => ({ sha: short12 }), 'two review': () => ({ headSha: short12 }) }
  const { r: r1 } = await go(args(), sc)
  assert.equal(r1.carryForward.repos['/r/two'].passed?.sha, short12)
  const { r } = await go(args({ resume: 'run-14', carryForward: r1.carryForward }), { ...sc, ...state({ id: 'a', head: r1.humanCheck[0].sha, merged: true }) })
  assert(r.repos.length === 2, 'the resume ran instead of throwing on its own carryForward') })
await t('9b a handed finding the resumed whole-branch pass fixed leaves the next carryForward', async () => {
  const args = x => ({ cycles: null, workstreams: [ws('a'), ws('b')], ...x })
  const { r: r1 } = await go(args(), { ...outside, 'one validate': () => null, 'health one validate': () => null })
  const { r } = await go(args({ resume: 'run-15', carryForward: r1.carryForward }), { ...state({ id: 'a', head: W(r1, 'a').validatedSha, merged: true }, { id: 'b', head: W(r1, 'b').validatedSha, merged: true }), 'one recheck r1': () => ({ verified: ['a:p:c1-F1'] }) })
  assert(r.repos[0].verdict === 'pass' && r.carryForward.workstreams.a.handed.length === 0, JSON.stringify(r.carryForward.workstreams.a)) })
await t('9c a blocker open when the resumed call stopped goes to the restarted review as carried, and only a validator clears it', async () => {
  const carryForward = { workstreams: { a: { handed: [], open: [], findings: [{ ...F('c1-F2', 'major', 'a/core.js:7'), stage: 'review', status: 'open' }] } }, repos: {} }
  const { r, prompts } = await go({ cycles: 1, resume: 'run-16', carryForward, workstreams: [ws('a')] }, { ...state({ id: 'a', head: HA, merged: false }), 'a validate c1': () => ({ verified: ['p:c1-F2'] }) })
  assert(/The last validation left these open[^\n]*\n[^\n]*"p:c1-F2"/.test(prompts['a review c1']), 'shown to the restarted review')
  assert(prompts['a fix c1']?.includes('"p:c1-F2"'), 'a silent review does not clear it')
  assert(W(r, 'a').merged && W(r, 'a').findings.find(e => e.id === 'p:c1-F2')?.status === 'fixed', JSON.stringify(W(r, 'a').findings)) })

// ---- docs and version ----
await t('6a SKILL.md documents resume, decisions, the head-bound checks and the handed findings; plugin.json is 0.3.10', async () => {
  const s = readFileSync(new URL('../SKILL.md', import.meta.url), 'utf8')
  for (const k of ['resume', 'decisions', 'carryForward']) assert(new RegExp('\\| `' + k + '` \\|').test(s), k)
  assert(/one `p:` fewer than the workstream ledgers/.test(s) && /`checkAt`/.test(s) && /"carried"/.test(s) && /`incomplete`/.test(s) && /health probe/.test(s) && /gate exit=/.test(s))
  assert.equal(JSON.parse(readFileSync(new URL('../../../.claude-plugin/plugin.json', import.meta.url), 'utf8')).version, '0.3.10') })
await t('6b fixture-scenarios.md carries S18-S21 and the S13 pipe seed', async () => {
  const s = readFileSync(new URL('./fixture-scenarios.md', import.meta.url), 'utf8')
  for (const k of ['S18', 'S19', 'S20', 'S21']) assert(new RegExp(`\\| ${k} \\|`).test(s), k)
  assert(/S13 variant/.test(s)) })

if (fails.length) { console.error(fails.join('\n')); process.exit(1) }
console.log('resume, human-check binding, resumable-block, handed-finding and gate-wrapper checks ok')
