// Promote-on-green, fixer escalation, merge retry, flaky registry, acceptance tests and quickGate scenarios.
// Every scenario fails against the tier-2 script except the ones marked (control); 17l-17p, 18g and 20d also failed
// against this PR's first revision (review follow-ups; 18g is a control against tier-2, which never escalates).
import { Run } from './run.mjs'
import assert from 'node:assert'
const SHA = n => (n + '').padStart(40, 'a')
const parallel = fs => Promise.all(fs.map(f => f().catch(() => null)))
const free = { total: null, spent: () => 0, remaining: () => Infinity }
const push = { status: 'done', ok: true, tests: 't', gateTail: 'exit 0', sharedEdits: [], decisions: [], questions: [], notes: [] }
const green = { green: true, summary: '', flaky: [] }
const F = (id, severity = 'major', where = 'x.py:3') => ({ id, severity, kind: 'bug', where, issue: `issue ${id}`, evidence: 'test t1 red' })
// sc[label](prompt) overrides a step; all[label] keeps every prompt and opts, in call order.
function mock(sc = {}) {
  const prompts = {}, opts = {}, all = {}
  const head = {}
  const agent = async (p, o) => {
    const L = o.label.replace(/ attempt \d$/, '')
    prompts[L] = p; opts[L] = o; (all[L] ||= []).push({ p, o })
    const id = L.split(' ')[0]
    const repo = '/r/one'
    const own = sc[L]?.(p)
    if (L.endsWith('implement')) return (head[id] = SHA(id.length), { ...push, sha: head[id] })
    if (/fix c(\d)/.test(L)) { const r = { ...push, sha: SHA(10 + +L.at(-1)), answers: [], ...own }; head[id] = r.sha; return r }
    if (/review c\d/.test(L)) return { headSha: head[id], findings: [], ...own }
    if (/validate c\d/.test(L)) return { headSha: head[id], gate: green, verified: [], open: [], ...own }
    if (L.endsWith('merge')) return (head[repo] = SHA(50), { ...push, sha: SHA(50), ...own })
    if (L.endsWith(' review')) return { headSha: head[repo], findings: [], seams: 'none', ...own }
    if (L.endsWith('docs validate')) return { verdict: 'pass', sections: 's', sha: (p.match(/\.\.([0-9a-f]{40})/) || [])[1], tests: 't', gate: green, findings: [], ...own }
    if (L.endsWith(' validate')) return { verdict: 'pass', sections: 's', sha: head[repo], tests: 't', gate: green, findings: [], ...own }
    if (/fix r(\d)/.test(L)) { const r = { ...push, sha: SHA(70 + +L.at(-1)), answers: [], ...own }; head[repo] = r.sha; return r }
    if (/recheck r\d/.test(L)) return { verdict: 'pass', sections: 's', sha: head[repo], tests: 't', gate: green, findings: [], verified: [], ...own }
    if (L.endsWith(' docs')) return { baseSha: head[repo], sha: '', files: [], prBody: false, ok: true, tests: 't', notes: [], ...own }
    if (L.endsWith(' promote')) return { ok: true, sha: (p.match(/ to ([0-9a-f]{40})\./) || [])[1], notes: [], ...own }
    throw new Error('unmocked ' + L)
  }
  return { agent, prompts, opts, all }
}
const ws = (id, extra = {}) => ({ id, repo: '/r/one', featureBranch: 'f', branch: `f--${id}`, model: 'sonnet', brief: 'b', gate: 'npm test', ...extra })
const go = async (args, sc, b = free) => { const m = mock(sc); const r = await Run(args, m.agent, parallel, () => {}, b); return { r, p: m.prompts, o: m.opts, all: m.all } }
const rejects = (args, re) => assert.rejects(go(args), re)
const fails = []
const t = async (name, fn) => { try { await fn() } catch (e) { fails.push(`${name}: ${e.message.split('\n')[0]}`) } }
const wbMajor = { 'one review': () => ({ findings: [F('W-F1')] }) }
const promotes = p => Object.keys(p).filter(k => k.endsWith(' promote'))

// row 17: whole-branch fixes and docs land on side branches; the feature branch only fast-forwards to a validated sha
await t('17a whole-branch fix goes to a side branch and is promoted after a passing recheck', async () => {
  const { r, p, o } = await go({ cycles: null, workstreams: [ws('a')] }, { ...wbMajor, 'one recheck r1': () => ({ verified: ['W-F1'] }) })
  assert(p['one fix r1'].includes(`detached at ${SHA(50)}`) && p['one fix r1'].includes('push to the side branch f--wbfix1, never to f:'), 'fixer pushes to the side branch')
  const pr = p['one promote'] || ''
  assert(pr.includes(`fast-forward f from ${SHA(50)} to ${SHA(71)}.`) && pr.includes(`ls-remote origin refs/heads/f must equal ${SHA(50)}`) && pr.includes(`merge-base --is-ancestor ${SHA(50)} ${SHA(71)}`), 'promote checks the expected head')
  assert(pr.includes('never --force') && pr.includes('--delete f--wbfix1'), 'plain push, side deleted after')
  assert(o['one promote'].model === 'sonnet' && o['one promote'].effort === 'low', 'low-effort sonnet')
  const x = r.repos[0]
  assert(x.verdict === 'pass' && x.sha === SHA(71) && x.finalSha === SHA(71), JSON.stringify(x))
})
await t('17b a failed promotion leaves the feature branch at the validated tip', async () => {
  const { r } = await go({ cycles: null, workstreams: [ws('a')] }, { ...wbMajor, 'one recheck r1': () => ({ verified: ['W-F1'] }), 'one promote': () => ({ ok: false, sha: SHA(99), notes: ['f moved'] }) })
  const x = r.repos[0]
  assert(x.verdict === 'fail' && x.sha === SHA(50) && x.finalSha === SHA(50), JSON.stringify(x))
  assert(x.escalations.some(e => /not promoted: f moved/.test(e) && /f--wbfix1/.test(e)), x.escalations.join())
})
await t('17c still blocking after every round: no promotion, round 2 builds on round 1', async () => {
  const keep = () => ({ findings: [F('W-F1')] })
  const { r, p } = await go({ cycles: null, workstreams: [ws('a')] }, { ...wbMajor, 'one recheck r1': keep, 'one recheck r2': keep })
  assert(promotes(p).length === 0, promotes(p).join())
  assert(p['one fix r2'].includes(`detached at ${SHA(71)}`) && p['one fix r2'].includes('side branch f--wbfix2'), 'round 2 starts from round 1')
  assert(p['one recheck r2'].includes(`${SHA(71)}..${SHA(72)}`), 'round 2 delta')
  const x = r.repos[0]
  assert(x.verdict === 'fail' && x.finalSha === SHA(50), JSON.stringify(x))
  assert(x.escalations.some(e => /unpromoted on f--wbfix2, f unchanged/.test(e)), x.escalations.join())
})
await t('17d two rounds then green: one promotion to the last checked head, both side branches deleted', async () => {
  const { r, p } = await go({ cycles: null, workstreams: [ws('a')] }, { ...wbMajor, 'one recheck r1': () => ({ findings: [F('W-F1')] }), 'one recheck r2': () => ({ verified: ['W-F1'] }) })
  assert(p['one promote'].includes(`from ${SHA(50)} to ${SHA(72)}.`) && p['one promote'].includes('--delete f--wbfix1 f--wbfix2'), p['one promote'])
  assert.equal(r.repos[0].finalSha, SHA(72))
})
await t('17e docs go to a side branch and are promoted after their validator passes', async () => {
  const { r, p } = await go({ cycles: null, workstreams: [ws('a')] }, { 'one docs': () => ({ sha: SHA(80) }) })
  assert(p['one docs'].includes('push to the side branch f--docs, never to f:'), 'docs agent pushes to the side branch')
  assert(p['one docs promote']?.includes(`fast-forward f from ${SHA(50)} to ${SHA(80)}.`) && p['one docs promote'].includes('--delete f--docs'), 'docs promote')
  assert(r.repos[0].verdict === 'pass' && r.repos[0].finalSha === SHA(80), JSON.stringify(r.repos[0]))
})
await t('17f failed docs validation: no promotion, finalSha stays validated', async () => {
  const { r, p } = await go({ cycles: null, workstreams: [ws('a')] }, { 'one docs': () => ({ sha: SHA(80) }), 'one docs validate': () => ({ verdict: 'fail', findings: [{ ...F('D-F1'), kind: 'docs' }] }) })
  assert(promotes(p).length === 0, promotes(p).join())
  assert(r.repos[0].verdict === 'fail' && r.repos[0].finalSha === SHA(50), JSON.stringify(r.repos[0]))
})
await t('17g docs validator passes with a red gate: no promotion', async () => {
  const { r, p } = await go({ cycles: null, workstreams: [ws('a')] }, { 'one docs': () => ({ sha: SHA(80) }), 'one docs validate': () => ({ gate: { green: false, summary: 'red', flaky: [] } }) })
  assert(promotes(p).length === 0 && r.repos[0].verdict === 'fail' && r.repos[0].finalSha === SHA(50), JSON.stringify(r.repos[0]))
})
await t('17h failed docs promotion fails the repo', async () => {
  const { r } = await go({ cycles: null, workstreams: [ws('a')] }, { 'one docs': () => ({ sha: SHA(80) }), 'one docs promote': () => ({ ok: false, sha: SHA(99), notes: ['f moved'] }) })
  const x = r.repos[0]
  assert(x.verdict === 'fail' && x.finalSha === SHA(50) && x.open.some(s => /not promoted to f: f moved/.test(s)), JSON.stringify(x))
})
await t('17i (control) wbRounds 0 + docsRepos []: nothing to promote, finalSha = reviewed sha', async () => {
  const { r, p } = await go({ cycles: null, wbRounds: 0, docsRepos: [], workstreams: [ws('a')] }, wbMajor)
  assert(promotes(p).length === 0 && r.repos[0].finalSha === SHA(50), JSON.stringify(r.repos[0]))
})
await t('17j (control) a no-delta fix round promotes nothing', async () => {
  const { r, p } = await go({ cycles: null, workstreams: [ws('a')] }, { ...wbMajor, 'one fix r1': () => ({ sha: SHA(50) }), 'one recheck r1': () => ({ verified: ['W-F1'] }) })
  assert(promotes(p).length === 0 && r.repos[0].verdict === 'pass' && r.repos[0].finalSha === SHA(50), JSON.stringify(r.repos[0]))
})
await t('17k stacked slice: side branch and promotion target the slice', async () => {
  const { r, p } = await go({ cycles: null, workstreams: [ws('a', { featureBranch: 'f2', base: 'f1', branch: 'f2--a' })] }, { ...wbMajor, 'one recheck r1': () => ({ verified: ['W-F1'] }) })
  assert(p['one fix r1'].includes('side branch f2--wbfix1, never to f2:') && p['one promote'].includes(`fast-forward f2 from ${SHA(50)} to ${SHA(71)}.`), 'slice names')
  assert.equal(r.repos[0].finalSha, SHA(71))
})

await t('17l docs that started from a head the whole-branch pass did not validate are never promoted', async () => {
  const { r, p } = await go({ cycles: null, workstreams: [ws('a')] }, { 'one docs': () => ({ baseSha: SHA(99), sha: SHA(80) }) })
  assert(promotes(p).length === 0 && !p['one docs validate'], Object.keys(p).join())
  const x = r.repos[0]
  assert(x.verdict === 'fail' && x.finalSha === SHA(50) && x.open.some(s => s.includes(SHA(99)) && s.includes(SHA(50))), JSON.stringify(x))
})
await t('17m a failed whole-branch pass skips docs', async () => {
  const keep = () => ({ findings: [F('W-F1')] })
  const { r, p } = await go({ cycles: null, workstreams: [ws('a')] }, { ...wbMajor, 'one recheck r1': keep, 'one recheck r2': keep, 'one docs': () => ({ sha: SHA(80) }) })
  assert(!p['one docs'] && promotes(p).length === 0, Object.keys(p).join())
  const x = r.repos[0]
  assert(x.verdict === 'fail' && x.finalSha === SHA(50) && x.docs.notes.some(n => /^skipped: /.test(n)), JSON.stringify(x))
})
await t('17n workstream branches may not take a side-branch name', async () => {
  await rejects({ workstreams: [ws('docs')] }, /f--docs/)
  await rejects({ workstreams: [ws('a', { branch: 'f--wbfix3' })] }, /f--wbfix3/)
  await go({ cycles: null, workstreams: [ws('a', { branch: 'f--wbfixer' }), ws('b', { branch: 'g--docs' })] })
})
await t('17o an unpromoted docs commit is named in escalations', async () => {
  const { r } = await go({ cycles: null, workstreams: [ws('a')] }, { 'one docs': () => ({ sha: SHA(80) }), 'one docs validate': () => ({ verdict: 'fail', findings: [{ ...F('D-F1'), kind: 'docs' }] }) })
  assert(r.repos[0].escalations.some(e => e.includes('f--docs') && e.includes(SHA(80))), r.repos[0].escalations.join())
})
await t('17p promote resumes when an earlier attempt already pushed', async () => {
  const { p } = await go({ cycles: null, workstreams: [ws('a')] }, { ...wbMajor, 'one recheck r1': () => ({ verified: ['W-F1'] }) })
  assert(p['one promote'].includes(`If ls-remote already shows ${SHA(71)}, an earlier attempt pushed it: go to step 3.`), p['one promote'])
})

// row 18: a blocker that survives two fix rounds gets an opus fixer with the prior attempts; surviving that, it is a question
const stubborn = (extra = {}) => ({
  'a review c1': () => ({ findings: [F('c1-F1')] }),
  'a fix c1': () => ({ answers: [{ id: 'c1-F1', action: 'fixed', note: 'tried A' }] }),
  'a validate c1': () => ({ open: [F('c1-F1')] }),
  'a fix c2': () => ({ answers: [{ id: 'c1-F1', action: 'fixed', note: 'tried B' }] }),
  'a validate c2': () => ({ open: [F('c1-F1')] }),
  ...extra,
})
await t('18a cycle-3 fix escalates to opus with the prior attempts', async () => {
  const { r, p, o } = await go({ cycles: null, workstreams: [ws('a')] }, stubborn({ 'a validate c3': () => ({ verified: ['c1-F1'] }) }))
  assert(o['a fix c1'].model === 'sonnet' && o['a fix c2'].model === 'sonnet' && o['a fix c3'].model === 'opus', ['c1', 'c2', 'c3'].map(c => o[`a fix ${c}`].model).join())
  assert(p['a fix c3'].includes('c1-F1: a prior fixer attempted this 2 times') && p['a fix c3'].includes('tried A') && p['a fix c3'].includes('tried B'), 'framing')
  assert(!p['a fix c2'].includes('a prior fixer attempted'), 'no framing before two survived rounds')
  assert(r.workstreams[0].merged, JSON.stringify(r.workstreams[0]))
})
await t('18b surviving the opus round becomes a question, not another patch', async () => {
  const { r, p } = await go({ cycles: null, workstreams: [ws('a')] }, stubborn({ 'a validate c3': () => ({ open: [F('c1-F1')] }) }))
  assert(!p['a fix c4'] && !p['a review c4'], 'no fourth patch, no wasted review')
  const w = r.workstreams[0]
  assert(!w.merged && w.questions.some(q => /c1-F1/.test(q.q) && /3 fix rounds/.test(q.q) && q.options.length && q.default), JSON.stringify(w.questions))
  assert(w.escalations.some(e => /returned to the user as a question/.test(e)), w.escalations.join())
})
await t('18f the question also comes when the opus round was the last cycle the cap allowed', async () => {
  const { r } = await go({ cycles: 1, workstreams: [ws('a')] }, stubborn({ 'a validate c3': () => ({ open: [F('c1-F1')] }) }))
  const w = r.workstreams[0]
  assert(!w.merged && w.cyclesRun === 3 && w.questions.some(q => /c1-F1/.test(q.q)) && w.open.some(s => /c1-F1/.test(s)), JSON.stringify(w))
})
await t('18c a new id at the same where counts as the same finding', async () => {
  const { o } = await go({ cycles: null, workstreams: [ws('a')] }, {
    'a review c1': () => ({ findings: [F('c1-F1')] }),
    'a validate c1': () => ({ verified: ['c1-F1'], open: [F('v1-R1')] }),
    'a validate c2': () => ({ verified: ['v1-R1'], open: [F('v2-R1')] }),
    'a validate c3': () => ({ verified: ['v2-R1'] }),
  })
  assert.equal(o['a fix c3'].model, 'opus')
})
await t('18d (control) different findings each surviving one round stay on sonnet', async () => {
  const { o } = await go({ cycles: null, workstreams: [ws('a')] }, {
    'a review c1': () => ({ findings: [F('c1-F1')] }),
    'a validate c1': () => ({ open: [F('c1-F1')] }),
    'a review c2': () => ({ findings: [F('c2-F1', 'major', 'y.py:9')] }),
    'a validate c2': () => ({ verified: ['c1-F1'], open: [F('c2-F1', 'major', 'y.py:9')] }),
    'a validate c3': () => ({ verified: ['c2-F1'] }),
  })
  assert.equal(o['a fix c3'].model, 'sonnet')
})
await t('18e (control) an opus author escalates on opus, never fable', async () => {
  const { o } = await go({ cycles: null, workstreams: [ws('a', { model: 'opus' })] }, stubborn({ 'a validate c3': () => ({ verified: ['c1-F1'] }) }))
  assert(['c1', 'c2', 'c3'].every(c => o[`a fix ${c}`].model === 'opus'))
})

await t('18g (control vs tier-2) red gates with different failures are not one survivor', async () => {
  const red = x => ({ gate: { green: false, summary: x, flaky: [] } })
  const { r, o } = await go({ cycles: null, workstreams: [ws('a')] }, { 'a review c1': () => ({ findings: [F('c1-F1')] }), 'a validate c1': () => ({ verified: ['c1-F1'], ...red('A') }), 'a validate c2': () => red('B'), 'a validate c3': () => red('C'), 'a validate c4': () => red('D') })
  assert(['c1', 'c2', 'c3', 'c4'].every(c => o[`a fix ${c}`].model === 'sonnet') && r.workstreams[0].questions.length === 0, JSON.stringify(r.workstreams[0]))
})

// row 19: a rejected merge returns to its author once
const rejectN = n => { let k = 0; return () => k++ < n ? { ok: false, status: 'failed', notes: ['conflict in x.py'] } : {} }
await t('19a rejected merge: one fix cycle without a re-review, revalidated, merged on the retry', async () => {
  const { r, p, all } = await go({ cycles: null, workstreams: [ws('a')] }, { 'a review c1': () => ({ findings: [F('c1-F1', 'minor')] }), 'a merge': rejectN(1), 'a validate c2': () => ({ verified: ['M-F1'] }) })
  assert(!p['a review c2'], 'the unchanged head is not re-reviewed')
  assert(p['a fix c2']?.includes('"c1-F1"'), 'carried minors ride along')
  const f = p['a fix c2'] || ''
  assert(f.includes('"M-F1"') && f.includes('"integration"') && f.includes('conflict in x.py') && f.includes('git merge origin/f into your branch'), 'merge notes become an integration critical')
  assert(p['a validate c2']?.includes('review-fix delta'), 'delta validator')
  assert(all['a merge'].length === 2 && all['a merge'][1].p.includes(`must equal ${SHA(12)}`), 'requeued with the new validated head')
  assert(r.workstreams[0].merged, JSON.stringify(r.workstreams[0]))
})
await t('19b rejected twice: no second retry', async () => {
  const { r, all } = await go({ cycles: null, workstreams: [ws('a')] }, { 'a merge': rejectN(9), 'a validate c2': () => ({ verified: ['M-F1'] }) })
  const w = r.workstreams[0]
  assert(all['a merge'].length === 2 && !w.merged && w.escalations.some(e => /merge failed: conflict in x.py/.test(e)), JSON.stringify(w))
})
await t('19c (control) rejected at the cycle cap: no retry', async () => {
  const { r, p, all } = await go({ cycles: 1, maxCycles: 1, workstreams: [ws('a')] }, { 'a merge': rejectN(9) })
  assert(all['a merge'].length === 1 && !p['a fix c2'] && !r.workstreams[0].merged)
})
await t('19d rejected with the budget below the reserve: no retry, reported as a budget stop', async () => {
  let spent = 0
  const b = { total: null, spent: () => spent, remaining: () => Infinity }
  const { r, p, all } = await go({ cycles: null, tokenBudget: 1e8, workstreams: [ws('a')] }, { 'a merge': () => { spent = 1e9; return { ok: false, status: 'failed', notes: ['conflict'] } } }, b)
  assert(all['a merge'].length === 1 && !p['a fix c2'] && r.budget.stoppedBy.includes('a cycle 2'), JSON.stringify(r.budget))
})

// row 20: run-wide flaky registry; new or changed tests must pass 3 consecutive runs
await t('20a a validator-proven flaky test reaches later gates and the result', async () => {
  const { r, p, o } = await go({ cycles: null, workstreams: [ws('a')] }, { 'a validate c1': () => ({ gate: { ...green, flaky: ['t/a.spec'] } }) })
  assert(o['a validate c1'].schema.properties.gate.required.includes('flaky'), 'gate.flaky required')
  assert(!p['a implement'].includes('Known flaky'), 'nothing known before a validator ran')
  for (const k of ['a merge', 'one validate', 'one docs'])
    assert(p[k].includes('Known flaky in this run (intermittent at head and base): t/a.spec') && p[k].includes('skip the base rerun'), k)
  assert(/gate\.flaky only tests that were intermittent on head AND failed at the base/.test(p['a validate c1']), 'registry admits base-flaky only')
  assert.deepEqual(r.repos[0].flaky, ['t/a.spec'])
})
await t('20b validators require 3 consecutive passes of new or changed tests', async () => {
  const { p } = await go({ cycles: null, workstreams: [ws('a')] }, { 'a review c1': () => ({ findings: [F('c1-F1')] }), 'a validate c1': () => ({ verified: ['c1-F1'] }), ...wbMajor, 'one recheck r1': () => ({ verified: ['W-F1'] }) })
  for (const k of ['a validate c1', 'one validate', 'one recheck r1']) assert(p[k].includes('Each new or changed test must pass 3 consecutive runs'), k)
})
await t('20c (control) no flaky test reported: no known-flaky line', async () => {
  const { r, p } = await go({ cycles: null, workstreams: [ws('a')] })
  assert(!Object.values(p).some(v => v.includes('Known flaky')) && !r.repos[0].flaky?.length)
})

await t('20d the base-rerun rule exempts known-flaky tests too', async () => {
  const { p } = await go({ cycles: null, workstreams: [ws('a')] })
  assert(p['one validate'].includes('A failure outside the known-red and known-flaky lists:'))
})

// row 21: the first validator of a workstream writes black-box acceptance tests before reading the diff
const ACCEPT = '0. Before you read the diff: from the brief\'s acceptance criteria alone, write 2-5 black-box tests'
await t('21a clean-review validator writes acceptance tests first; later validators do not', async () => {
  const { all } = await go({ cycles: null, workstreams: [ws('a')] }, { 'a validate c1': p => p.includes('review-fix delta') ? { verified: ['v1-F1'] } : { open: [F('v1-F1')] } })
  const [first, second] = all['a validate c1'].map(x => x.p)
  assert(first.includes(ACCEPT) && first.indexOf(ACCEPT) < first.indexOf('1. Check every acceptance criterion'), 'step 0 comes first')
  assert(first.includes('never commit or push them') && first.includes('evidence, the reproducer') && first.includes(`no behaviour change, instead run the same inputs at git merge-base origin/f ${SHA(1)} and at ${SHA(1)}`), 'rules')
  assert(second && !second.includes(ACCEPT), 'once per workstream')
})
await t('21b when the first validator is a delta validator, it writes them', async () => {
  const { p } = await go({ cycles: null, workstreams: [ws('a')] }, {
    'a review c1': () => ({ findings: [F('c1-F1')] }),
    'a validate c1': () => ({ verified: ['c1-F1'], open: [F('v1-F1', 'major', 'z.py:1')] }),
    'a validate c2': () => ({ verified: ['v1-F1'] }),
  })
  assert(p['a validate c1'].includes(ACCEPT) && p['a validate c1'].includes(`at ${SHA(11)}`), 'delta c1 has it')
  assert(!p['a validate c2'].includes(ACCEPT), 'c2 does not')
})

// row 22: optional quickGate for author/fixer pushes and reviewer probes; the full gate stays everywhere else
await t('22a quickGate for authors, fixers and reviewer probes only', async () => {
  const { p } = await go({ cycles: null, workstreams: [ws('a', { quickGate: 'npm run test:unit' })] }, { 'a review c1': () => ({ findings: [F('c1-F1')] }), 'a validate c1': () => ({ verified: ['c1-F1'] }), ...wbMajor, 'one recheck r1': () => ({ verified: ['W-F1'] }) })
  for (const k of ['a implement', 'a fix c1']) assert(p[k].includes('Quick gate, green before every push') && p[k].includes('npm run test:unit') && !p[k].includes('Full gate'), k)
  assert(p['a review c1'].includes('use the quick gate (npm run test:unit)'), 'reviewer probes')
  for (const k of ['a validate c1', 'a merge', 'one validate', 'one fix r1', 'one recheck r1', 'one docs'])
    assert(p[k].includes('npm test') && !p[k].includes('npm run test:unit'), `${k}: full gate`)
})
await t('22b quickGate validation', async () => {
  for (const quickGate of ['', '  ', ['npm test'], 3]) await rejects({ workstreams: [ws('a', { quickGate })] }, /quickGate/)
})
await t('22c (control) no quickGate: the full gate before every push', async () => {
  const { p } = await go({ cycles: null, workstreams: [ws('a')] })
  assert(p['a implement'].includes('Full gate, green before every push') && !p['a implement'].includes('Quick gate') && !p['a review c1'].includes('quick gate'))
})

if (fails.length) { console.log('FAILED:\n' + fails.join('\n')); process.exit(1) }
console.log('tier-3 checks ok')
