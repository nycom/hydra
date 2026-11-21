// Stop rule, acceptance table, decision log + drift audit, churn detector, known-gaps offer, wbReviewModel. Every scenario fails against the 0.3.8 script except the ones marked (control).
import { Run } from './run.mjs'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
const SHA = n => (n + '').padStart(40, 'a')
const parallel = fs => Promise.all(fs.map(f => f().catch(() => null)))
const free = { total: null, spent: () => 0, remaining: () => Infinity }
const push = { status: 'done', ok: true, tests: 't', gateTail: 'exit 0', sharedEdits: [], decisions: [], questions: [], notes: [] }
const green = { green: true, summary: '12 passed', command: 'npm test', flaky: [] }
const F = (id, severity = 'major', where = 'x.py:3') => ({ id, severity, kind: 'bug', where, issue: `issue ${id}`, evidence: 'test t1 red' })
const Q = q => ({ q, options: ['keep', 'change'], default: 'keep' })
function mock(args, sc = {}) {
  const prompts = {}, opts = {}, all = {}, order = [], merges = {}, events = []
  const head = {}
  let n = 0
  const repoOf = L => { const w = args.workstreams.find(w => L.startsWith(`${w.id} `)); return w ? w.repo : `/r/${L.split(' ')[0]}` }
  const agent = async (p, o) => {
    const L = o.label.replace(/ attempt \d$/, '')
    events.push(`start ${L}`)
    if (sc.__delay?.[L]) await new Promise(r => setTimeout(r, sc.__delay[L]))
    const res = await reply(p, o, L)
    events.push(`end ${L}`)
    return res
  }
  const reply = async (p, o, L) => {
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
    if (/ shared check m\d+$/.test(L)) return { verdict: 'pass', sections: 's', sha: head[repo], tests: 't', gate: green, findings: [], ...own }
    if (L.endsWith(' review')) return { headSha: head[repo], findings: [], seams: 'none', ...own }
    if (L.endsWith(' docs validate')) return { verdict: 'pass', sections: 's', sha: SHA(900), tests: 't', gate: green, findings: [], ...own }
    if (L.endsWith(' validate')) return { verdict: 'pass', sections: 's', sha: head[repo], tests: 't', gate: green, findings: [], verified: [], ...own }
    if (/fix r(\d)/.test(L)) { const r = { ...push, sha: SHA(70 + +L.at(-1)), answers: [], ...own }; head[repo] = r.sha; return r }
    if (/recheck r\d/.test(L)) return { verdict: 'pass', sections: 's', sha: head[repo], tests: 't', gate: green, findings: [], verified: [], ...own }
    if (L.endsWith(' docs')) return { baseSha: head[repo], sha: '', files: [], prBody: false, ok: true, tests: 't', notes: [], ...own }
    if (L.endsWith(' promote')) return { ok: true, sha: (p.match(/ to ([0-9a-f]{40})\./) || [])[1], notes: [], ...own }
    if (L === 'contracts') return { verdict: 'pass', sections: 's', findings: [], ...own }
    if (L === 'drift') return { ok: true, notes: [], sections: 's', drift: [], ...own }
    throw new Error('unmocked ' + L)
  }
  return { agent, prompts, opts, all, order, merges, events }
}
const ws = (id, extra = {}) => ({ id, repo: '/r/one', featureBranch: 'f', branch: `f--${id}`, model: 'sonnet', brief: `brief ${id}`, gate: 'npm test', files: [`${id}/`], ...extra })
// a run that never settles (a hold nobody releases) fails instead of hanging the suite
const go = async (args, sc, b = free) => {
  const m = mock(args, sc)
  let timer
  const hung = new Promise((_, no) => { timer = setTimeout(() => no(new Error('the run hung')), 2000) })
  const r = await Promise.race([Run(args, m.agent, parallel, () => {}, b), hung]).finally(() => clearTimeout(timer))
  return { r, ...m }
}
const throwsOn = async (args, re) => { let e = null; try { await go(args, {}) } catch (x) { e = x } assert(e && re.test(e.message), `expected ${re}, got ${e?.message}`) }
const fails = []
const t = async (name, fn) => { try { await fn() } catch (e) { fails.push(`${name}: ${e.message.split('\n')[0]}`) } }
const idx = (order, L) => order.indexOf(L)
const dirtyB = { 'b review c1': () => ({ findings: [F('c1-F1')] }), 'b validate c1': () => ({ verified: ['c1-F1'] }) } // b merges after a

const KEEP = 'Checks these instructions rate explicitly (hygiene, test integrity, smoke, checks) keep that severity, a broken wire contract between repos stays critical, and a break between workstreams (kind integration) stays major.'
const SR = 'wrong output for a listed case, lost user data, a crash'
await t('1a stopRule: every prompt that carried SEV carries the stop rule with the wrong-action list, and the 0.3.8 definition is gone', async () => {
  const { all } = await go({ cycles: 1, stopRule: SR, workstreams: [ws('a'), ws('b')] }, { 'a review c1': () => ({ findings: [F('c1-F1')] }), 'a validate c1': () => ({ verified: ['c1-F1'] }) })
  const ps = Object.values(all).flat()
  const judged = ps.filter(p => /Critical and major block the merge/.test(p))
  assert(judged.length >= 4)
  assert(judged.every(p => p.includes(`a wrong action: ${SR}`) && /A miss the base also has is a known gap: minor/.test(p)))
  assert(!ps.some(p => p.includes('major = real bug or design flaw'))) })
await t('1b stopRule: both fixer prompts tell the fixer to decline known gaps instead of adding a word list', async () => {
  const { prompts } = await go({ cycles: 1, stopRule: SR, workstreams: [ws('a')] }, { 'a review c1': () => ({ findings: [F('c1-F1')] }), 'a validate c1': () => ({ verified: ['c1-F1'] }), 'one validate': () => ({ verdict: 'fail', findings: [F('V-F1')] }), 'one recheck r1': () => ({ verified: ['V-F1'] }) })
  for (const L of ['a fix c1', 'one fix r1']) assert(/decline it as "known gap"; never add a word list, pattern or matcher branch for it/.test(prompts[L]), L) })
await t('1c (control) without stopRule SEV is the 0.3.8 text; a non-string or blank stopRule throws', async () => {
  const { all } = await go({ cycles: 1, workstreams: [ws('a')] }, {})
  assert(Object.values(all).flat().some(p => p.includes('major = real bug or design flaw')))
  await throwsOn({ stopRule: true, workstreams: [ws('a')] }, /stopRule must be a non-empty string/)
  await throwsOn({ stopRule: ' ', workstreams: [ws('a')] }, /stopRule must be a non-empty string/) })

const TBL = '/tmp/acc.md'
const busyAcc = { 'a review c1': () => ({ findings: [F('c1-F1')] }), 'a validate c1': () => ({ verified: ['c1-F1'] }), 'one validate': () => ({ verdict: 'fail', findings: [F('V-F1')] }), 'one recheck r1': () => ({ verified: ['V-F1'] }) }
await t('2a acceptance: authors and fixers read the table, a missing file blocks them', async () => {
  const { prompts } = await go({ cycles: 1, acceptance: TBL, workstreams: [ws('a')] }, busyAcc)
  for (const L of ['a implement', 'a fix c1', 'one fix r1']) assert(prompts[L].includes(`Acceptance table (user-approved, binding): ${TBL}`) && /missing or unreadable: stop with status "blocked"/.test(prompts[L]), L) })
await t('2b acceptance: every validator runs every row black-box at its sha; reviewers may block only on a broken row or a regression', async () => {
  const { prompts } = await go({ cycles: 1, acceptance: TBL, workstreams: [ws('a'), ws('b')] }, busyAcc) // two workstreams, so the integrated review runs
  for (const L of ['a validate c1', 'one validate', 'one recheck r1']) assert(/run every row of the acceptance table that this change touches, black-box/.test(prompts[L]) && prompts[L].includes(TBL), L)
  for (const L of ['a review c1', 'one review']) assert(/critical or major only if it breaks a row of the acceptance table or is a regression vs the base branch/.test(prompts[L]) && prompts[L].includes('anything else is minor (this overrides the severity definitions below).') && prompts[L].includes(`Security, data loss and a red gate stay critical. ${KEEP}`) && prompts[L].includes('The known-gap exemption never covers a row.'), L) })
await t('2c acceptance + stopRule: a failing row blocks even when the base fails it too', async () => {
  const { prompts } = await go({ cycles: 1, acceptance: TBL, stopRule: SR, workstreams: [ws('a')] }, {})
  assert(/A failing row is major even when the base fails it too/.test(prompts['a validate c1']) && prompts['a validate c1'].includes('The known-gap exemption never covers a row.')) })
await t('2d (control) no acceptance text without the arg; a relative path throws', async () => {
  const { all } = await go({ cycles: 1, workstreams: [ws('a')] }, busyAcc)
  assert(!Object.values(all).flat().some(p => /Acceptance table|acceptance table/.test(p)))
  await throwsOn({ acceptance: 'acc.md', workstreams: [ws('a')] }, /acceptance must be an absolute path/) })

const LOG = '/tmp/decisions.md'
await t('3a decisionLog: every prompt carries the binding-decisions clause with the path and the missing-file rule', async () => {
  const { all } = await go({ cycles: 1, decisionLog: LOG, workstreams: [ws('a'), ws('c', { repo: '/r/two' })] }, busyAcc)
  const ps = Object.values(all).flat()
  assert(ps.length > 8 && ps.every(p => p.includes(`Binding decisions (user-approved): ${LOG}`) && /missing or unreadable: a critical finding/.test(p))) })
await t('3b decisionLog: a finding that asks for what a decision rules out is dropped; a brief that contradicts one goes to questions, default keeps the decision', async () => {
  const { prompts } = await go({ cycles: 1, decisionLog: LOG, workstreams: [ws('a')] }, {})
  assert(/A finding that asks for what a decision rules out is dropped/.test(prompts['a review c1']))
  assert(/a brief clause that contradicts a decision goes to questions, the default keeping the decision/.test(prompts['a implement'])) })
await t('3c (control) no decision text without the arg; a relative path throws', async () => {
  const { all } = await go({ cycles: 1, workstreams: [ws('a')] }, {})
  assert(!Object.values(all).flat().some(p => p.includes('Binding decisions')))
  await throwsOn({ decisionLog: 'd.md', workstreams: [ws('a')] }, /decisionLog must be an absolute path/) })

await t('4a drift: one fable agent after every repo is final, with the log, the briefs and each repo pin; an item becomes result.drift and a revert-by-default question', async () => {
  const item = { repo: '/r/one', where: 'a/x.py:9', change: 'default greeting text changed' }
  const { r, order, prompts, opts } = await go({ cycles: 1, decisionLog: LOG, workstreams: [ws('a')] }, { drift: () => ({ drift: [item] }) })
  assert(idx(order, 'drift') > idx(order, 'one validate') && opts.drift.model === 'fable' && opts.drift.phase === 'Drift audit')
  assert(prompts.drift.includes(LOG) && prompts.drift.includes('brief a') && /\/r\/one @ f = /.test(prompts.drift) && prompts.drift.includes('/r/one: base origin/main'))
  assert.deepEqual(r.drift, { verdict: 'drift', items: [item], sections: 's', notes: [] })
  assert(r.questions.some(q => q.q === 'drift: /r/one a/x.py:9: default greeting text changed' && q.default.startsWith('revert'))) })
await t('4b drift: a dead drift agent is verdict died, never a silent pass', async () => {
  const { r } = await go({ cycles: 1, decisionLog: LOG, workstreams: [ws('a')] }, { drift: () => null })
  assert.equal(r.drift.verdict, 'died')
  const q = r.questions.find(q => q.q.startsWith('drift audit died: '))
  assert(q && q.default === 're-run stage wholeBranch to audit drift' && q.options.includes('ship without the drift audit'), JSON.stringify(r.questions)) })
await t('4c drift: runs on stage wholeBranch; never while a humanCheck pause holds a repo', async () => {
  const wb = await go({ stage: 'wholeBranch', decisionLog: LOG, workstreams: [ws('a')] }, {})
  assert(wb.order.includes('drift'))
  const held = await go({ cycles: 1, decisionLog: LOG, workstreams: [ws('a', { humanCheck: 'look at it' })] }, {})
  assert(!held.order.includes('drift') && held.r.drift.verdict === 'skipped') })
await t('4e drift: a budget below the reserve keeps the audit from starting, reads as skipped and names the stop', async () => {
  let spent = 0
  const b = { total: null, spent: () => spent, remaining: () => Infinity }
  const { r, order } = await go({ cycles: 1, decisionLog: LOG, tokenBudget: 1e8, workstreams: [ws('a')] }, { 'one validate': () => { spent = 1e9; return {} } }, b)
  assert(order.includes('one validate') && !order.includes('drift') && r.drift.verdict === 'skipped' && r.budget.stoppedBy.includes('drift audit'), JSON.stringify(r.budget))
  assert(r.questions.some(q => q.q.startsWith('drift audit skipped: ') && q.default === 're-run stage wholeBranch to audit drift'), JSON.stringify(r.questions)) })
await t('4d (control) without decisionLog no drift agent and drift is skipped', async () => {
  const { r, order } = await go({ cycles: 1, workstreams: [ws('a')] }, {})
  assert(!order.includes('drift') && r.drift.verdict === 'skipped' && !r.questions.some(q => /drift audit/.test(q.q))) })

const churnSc = (rounds, file = 'x.py') => ({ 'one validate': () => ({ verdict: 'fail', findings: [F('V-F1', 'major', `${file}:3`)] }),
  ...Object.fromEntries(rounds.map(k => [`one recheck r${k}`, () => ({ verdict: 'fail', verified: [], findings: [{ ...F(`R${k}-F1`, 'major', `${file}:${10 + k}`), kind: 'regression' }] })])) })
await t('5a churn: a regression in a file the fix touched, two rounds in a row, stops before round 3 with a question', async () => {
  const { r, order } = await go({ cycles: 1, wbRounds: 3, workstreams: [ws('a')] }, churnSc([1, 2]))
  const one = r.repos.find(x => x.repo === '/r/one')
  assert(!order.includes('one fix r3') && one.verdict === 'fail' && /heuristic churn/.test(one.escalations.join(' ')))
  assert.deepEqual(one.churn, [{ round: 1, files: ['x.py'] }, { round: 2, files: ['x.py'] }])
  assert(one.open.some(o => o.includes('x.py:12')), 'the stopping round\'s regression is reported open')
  assert(r.questions.some(q => q.q === 'one: heuristic churn in one: fix rounds 1 and 2 broke x.py (r1, r2) again' && q.default.startsWith('stop and simplify')), JSON.stringify(r.questions)) })
await t('5b churn: a single churn round is recorded and the loop continues', async () => {
  const sc = churnSc([1]); sc['one recheck r2'] = () => ({ verified: ['R1-F1'] })
  const { r, order } = await go({ cycles: 1, wbRounds: 3, workstreams: [ws('a')] }, sc)
  assert(order.includes('one fix r2') && r.repos[0].churn.length === 1) })
await t('5c (control) a regression in an untouched file, or at a where without path:line, never counts', async () => {
  const sc = churnSc([1, 2]); for (const k of [1, 2]) sc[`one recheck r${k}`] = () => ({ verdict: 'fail', findings: [{ ...F(`R${k}-F1`, 'major', k === 1 ? 'other.py:4' : 'gate'), kind: 'regression' }] })
  const { r, order } = await go({ cycles: 1, wbRounds: 3, workstreams: [ws('a')] }, sc)
  assert(order.includes('one fix r3') && r.repos[0].churn.length === 0) })

await t('5d (control) an absorbed regression re-filed open under its own id is not a new regression', async () => {
  const sc = { 'one review': () => ({ findings: [F('W-F1', 'major', 'x.py:3')] }), 'one validate': () => ({ verdict: 'fail', findings: [{ ...F('V-F1', 'major', 'x.py:3'), kind: 'regression' }] }),
    'one recheck r1': () => ({ verdict: 'fail', verified: ['W-F1'], findings: [{ ...F('V-F1', 'major', 'x.py:3'), kind: 'regression' }] }) }
  const { r } = await go({ cycles: 1, workstreams: [ws('a'), ws('b')] }, sc)
  assert.deepEqual(r.repos.find(x => x.repo === '/r/one').churn, []) })

const gapSc = { 'one validate': () => ({ verdict: 'fail', findings: [F('V-F1')] }), 'one recheck r1': () => ({ verdict: 'fail', verified: [], findings: [F('V-F1')] }) }
await t('6a known gaps: rounds out, gate green, only non-regression majors open: offer promote of the checked head, default leave', async () => {
  const { r } = await go({ cycles: 1, wbRounds: 1, workstreams: [ws('a')] }, gapSc)
  const q = r.questions.find(x => /Promote them as known gaps\?/.test(x.q))
  assert(q && q.q.includes('f--wbfix1') && q.q.includes(SHA(71)) && q.default === 'leave unpromoted' && q.q.startsWith('one: ') && !q.q.includes('one: one:'), q?.q) })
await t('6b known gaps: no offer when a critical or a regression is open', async () => {
  for (const f of [F('V-F1', 'critical'), { ...F('V-F1'), kind: 'regression' }]) {
    const { r } = await go({ cycles: 1, wbRounds: 1, workstreams: [ws('a')] }, { ...gapSc, 'one recheck r1': () => ({ verdict: 'fail', findings: [f] }) })
    assert(!r.questions.some(x => /known gaps\?/.test(x.q))) } })
await t('6c known gaps: no offer when the recheck died, saw another sha, or the gate was red', async () => {
  for (const own of [() => null, () => ({ verdict: 'fail', sha: SHA(5), findings: [F('V-F1')] }), () => ({ verdict: 'fail', gate: { ...green, green: false }, findings: [F('V-F1')] })]) {
    const { r } = await go({ cycles: 1, wbRounds: 1, workstreams: [ws('a')] }, { ...gapSc, 'one recheck r1': own })
    assert(!r.questions.some(x => /known gaps\?/.test(x.q))) } })

await t('7a wbReviewModel overrides the whole-branch review model only', async () => {
  const { opts } = await go({ cycles: 1, wbReviewModel: 'opus', workstreams: [ws('a', { model: 'opus' }), ws('b', { files: ['b/'] })] }, {})
  assert(opts['one review'].model === 'opus' && opts['a review c1'].model === 'fable') })
await t('7b (control) default stays the repo top reviewModel; an unknown model throws', async () => {
  const { opts } = await go({ cycles: 1, workstreams: [ws('a', { model: 'opus' }), ws('b', { files: ['b/'] })] }, {})
  assert(opts['one review'].model === 'fable')
  await throwsOn({ wbReviewModel: 'haiku', workstreams: [ws('a')] }, /wbReviewModel must be sonnet\|opus\|fable/) })

await t('9a stopRule: explicit severities survive it in the contracts and whole-branch validate prompts', async () => {
  const { prompts } = await go({ cycles: 1, stopRule: SR, workstreams: [ws('a'), ws('c', { repo: '/r/two' })] }, {})
  for (const L of ['contracts', 'one validate']) assert(prompts[L].includes(`Security and data loss stay critical. ${KEEP}`), L) })
await t('9b known gaps: no offer when an acceptance table is set', async () => {
  const { r } = await go({ cycles: 1, wbRounds: 1, acceptance: TBL, workstreams: [ws('a')] }, gapSc)
  assert(!r.questions.some(x => /known gaps\?/.test(x.q))) })
await t('9c churn: the question offers stop-and-simplify or more rounds only, default stop', async () => {
  const { r } = await go({ cycles: 1, wbRounds: 3, workstreams: [ws('a')] }, churnSc([1, 2]))
  const q = r.questions.find(q => /heuristic churn/.test(q.q))
  assert.deepEqual(q.options, ['stop and simplify: one predicate with one owner, re-run stage wholeBranch', 'run more fix rounds'])
  assert.equal(q.default, q.options[0]) })
await t('9d acceptance + stopRule: reviewers may also block on a wrong action; acceptance alone keeps the old clause', async () => {
  const both = await go({ cycles: 1, acceptance: TBL, stopRule: SR, workstreams: [ws('a')] }, {})
  assert(both.prompts['a review c1'].includes('or is a regression vs the base branch or is a wrong action under the stop rule; anything else is minor'))
  const acc = await go({ cycles: 1, acceptance: TBL, workstreams: [ws('a')] }, {})
  assert(acc.prompts['a review c1'].includes('or is a regression vs the base branch; anything else is minor') && !acc.prompts['a review c1'].includes('wrong action under the stop rule'))
  assert.equal(both.prompts['a review c1'].split(KEEP).length, 3, 'KEEP in ACC_REVIEW and in the stop-rule SEV')
  assert.equal(acc.prompts['a review c1'].split(KEEP).length, 2, 'KEEP in ACC_REVIEW; SEV stays 0.3.8') })
await t('9e stopRule example names no domain', async () => {
  let e = null; try { await go({ stopRule: '', workstreams: [ws('a')] }, {}) } catch (x) { e = x }
  assert(e.message.includes('"wrong output for a listed case, lost user data, a crash"'), e.message) })


// PR #20 review fixes
await t('10a drift: ok=false is verdict failed with the agent notes, its items dropped, and a re-run question', async () => {
  const { r } = await go({ cycles: 1, decisionLog: LOG, workstreams: [ws('a')] }, { drift: () => ({ ok: false, notes: ['decision log unreadable'], drift: [{ repo: '/r/one', where: 'a/x.py:9', change: 'c' }] }) })
  assert.deepEqual(r.drift, { verdict: 'failed', items: [], sections: 's', notes: ['decision log unreadable'] })
  assert(!r.questions.some(q => q.q.startsWith('drift: ')), 'no revert-by-default question from an audit that could not read the log')
  const q = r.questions.find(q => q.q === 'drift audit failed: decision log unreadable')
  assert(q && q.default === q.options[0] && q.options[0] === 're-run stage wholeBranch to audit drift' && q.options[1] === 'ship without the drift audit', JSON.stringify(r.questions)) })
await t('10b drift: nothing shipped (every repo skipped) runs no drift agent, verdict skipped, no question', async () => {
  const { r, order } = await go({ cycles: 1, decisionLog: LOG, workstreams: [ws('a')] }, { 'a implement': () => ({ status: 'blocked', ok: false, sha: '' }) })
  assert(r.repos[0].verdict === 'skipped' && !order.includes('drift') && r.drift.verdict === 'skipped' && !r.questions.some(q => /drift audit/.test(q.q)), JSON.stringify(r.drift)) })
await t('10c drift: no decisionLog and a short budget never record a drift-audit stop', async () => {
  let spent = 0
  const b = { total: null, spent: () => spent, remaining: () => Infinity }
  const { r } = await go({ cycles: 1, tokenBudget: 1e8, workstreams: [ws('a')] }, { 'one validate': () => { spent = 1e9; return {} } }, b)
  assert(!r.budget.stoppedBy.includes('drift audit'), JSON.stringify(r.budget)) })
await t('10d decisionLog: pushing agents stop and report a missing log (blocked, or ok=false with notes)', async () => {
  const { prompts } = await go({ cycles: 1, decisionLog: LOG, workstreams: [ws('a')] }, {})
  assert(prompts['a implement'].includes('File missing or unreadable: a critical finding (kind question), or, if you push, stop and report it (status "blocked", or ok=false with the reason in notes).'))
  assert(!prompts['a implement'].includes('or status "blocked" if you push')) })
await t('10e acceptance: validators never waive a row from a decision-log line', async () => {
  const { prompts } = await go({ cycles: 1, acceptance: TBL, workstreams: [ws('a')] }, {})
  assert(prompts['a validate c1'].includes('The known-gap exemption never covers a row. A decision-log line never waives a row; only a changed table does.')) })
await t('10f stopRule: the whole-branch recheck files each break a fix introduced as a regression; no text without it', async () => {
  const sr = await go({ cycles: 1, stopRule: SR, workstreams: [ws('a')] }, busyAcc)
  const step2 = sr.prompts['one recheck r1'].split('\n').find(l => l.startsWith('2. Hunt regressions the fixes introduced.'))
  assert(step2.endsWith(' File each break a fix introduced as kind "regression", even when the base lacks the feature.'), step2)
  const none = await go({ cycles: 1, workstreams: [ws('a')] }, busyAcc)
  assert(!none.prompts['one recheck r1'].includes('even when the base lacks the feature')) })
await t('10g churn: the question names each round\'s files', async () => {
  const sc = { 'one validate': () => ({ verdict: 'fail', findings: [F('V-F1', 'major', 'a.py:3'), F('V-F2', 'major', 'b.py:3')] }),
    'one recheck r1': () => ({ verdict: 'fail', findings: [F('V-F2', 'major', 'b.py:3'), { ...F('R1-F1', 'major', 'a.py:11'), kind: 'regression' }] }),
    'one recheck r2': () => ({ verdict: 'fail', findings: [{ ...F('R2-F1', 'major', 'b.py:12'), kind: 'regression' }] }) }
  const { r, order } = await go({ cycles: 1, wbRounds: 3, workstreams: [ws('a')] }, sc)
  assert(!order.includes('one fix r3'))
  const q = r.questions.find(q => /heuristic churn/.test(q.q))
  assert.equal(q?.q, 'one: heuristic churn in one: fix rounds 1 and 2 broke a.py (r1), b.py (r2) again') })
await t('10h churn: a where that names path:line after text ("in x.py:12") counts', async () => {
  const sc = churnSc([1, 2]); for (const k of [1, 2]) sc[`one recheck r${k}`] = () => ({ verdict: 'fail', findings: [{ ...F(`R${k}-F1`, 'major', `in x.py:${10 + k}`), kind: 'regression' }] })
  const { r, order } = await go({ cycles: 1, wbRounds: 3, workstreams: [ws('a')] }, sc)
  assert(!order.includes('one fix r3') && r.repos[0].churn.length === 2, JSON.stringify(r.repos[0].churn)) })
await t('10i (control) churn: a MINOR regression in an asked file two rounds in a row never stops the loop', async () => {
  const sc = churnSc([1, 2]); for (const k of [1, 2]) sc[`one recheck r${k}`] = () => ({ verdict: 'fail', findings: [F('V-F1', 'major', 'x.py:3'), { ...F(`R${k}-F1`, 'minor', `x.py:${10 + k}`), kind: 'regression' }] })
  const { r, order } = await go({ cycles: 1, wbRounds: 3, workstreams: [ws('a')] }, sc)
  assert(order.includes('one fix r3') && r.repos[0].churn.length === 0) })
await t('10j (control) churn: a kind bug MAJOR in an asked file two rounds in a row never stops the loop', async () => {
  const sc = churnSc([1, 2]); for (const k of [1, 2]) sc[`one recheck r${k}`] = () => ({ verdict: 'fail', findings: [F(`R${k}-F1`, 'major', `x.py:${10 + k}`)] })
  const { r, order } = await go({ cycles: 1, wbRounds: 3, workstreams: [ws('a')] }, sc)
  assert(order.includes('one fix r3') && r.repos[0].churn.length === 0) })
await t('10k (control) churn: rounds 1 and 3 but not 2 never stop the loop', async () => {
  const sc = churnSc([1, 3]); sc['one recheck r2'] = () => ({ verdict: 'fail', findings: [F('R2-F1', 'major', 'x.py:12')] })
  const three = await go({ cycles: 1, wbRounds: 3, workstreams: [ws('a')] }, sc)
  assert.deepEqual(three.r.repos[0].churn.map(c => c.round), [1, 3])
  assert(!three.r.questions.some(q => /heuristic churn/.test(q.q)) && /still open after 3/.test(three.r.repos[0].escalations.join(' ')), three.r.repos[0].escalations.join(' '))
  const four = await go({ cycles: 1, wbRounds: 4, workstreams: [ws('a')] }, sc)
  assert(four.order.includes('one fix r4')) })
await t('10l known gaps: no offer under a stop rule', async () => {
  const { r } = await go({ cycles: 1, wbRounds: 1, stopRule: SR, workstreams: [ws('a')] }, gapSc)
  assert(!r.questions.some(x => /known gaps\?/.test(x.q))) })
await t('10m known gaps: no offer while an integration major is open', async () => {
  const { r } = await go({ cycles: 1, wbRounds: 1, workstreams: [ws('a')] }, { ...gapSc, 'one recheck r1': () => ({ verdict: 'fail', findings: [{ ...F('V-F1'), kind: 'integration' }] }) })
  assert(!r.questions.some(x => /known gaps\?/.test(x.q))) })
await t('10n known gaps: no offer when no round pushed a delta (nothing on a side branch)', async () => {
  const { r } = await go({ cycles: 1, wbRounds: 1, workstreams: [ws('a')] }, { ...gapSc, 'one fix r1': p => ({ sha: p.match(/sha = ([0-9a-f]{40})/)[1] }) })
  assert(r.repos[0].fixRounds === 1 && !r.questions.some(x => /known gaps\?/.test(x.q))) })

if (fails.length) { console.error(fails.join('\n')); process.exit(1) }
console.log('stop-rule, acceptance, decision-log, drift, churn, known-gaps and wbReviewModel checks ok')
