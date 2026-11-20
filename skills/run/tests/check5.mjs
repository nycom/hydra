// Review-loop correctness and test-integrity scenarios; every scenario except the 2c control fails against main
// (1d-1g guard the gate-finding carry: they pass on main and failed on this suite's first fix).
import { Run } from './run.mjs'
import assert from 'node:assert'
const SHA = n => (n + '').padStart(40, 'a')
const parallel = fs => Promise.all(fs.map(f => f().catch(() => null)))
const budget = { total: null, spent: () => 0, remaining: () => Infinity }
const push = { status: 'done', ok: true, tests: 't', gateTail: 'exit 0', sharedEdits: [], decisions: [], questions: [], notes: [] }
const green = { green: true, summary: '' }
const F = (id, severity, kind = 'bug', evidence = 'test t1 red') => ({ id, severity, kind, where: 'a:1', issue: `issue ${id}`, evidence })
// sc[label](prompt) overrides a step; otherwise every reviewer/validator reports the last pushed head.
function mock(sc = {}) {
  const prompts = {}, opts = {}
  const head = {}
  const agent = async (p, o) => {
    const L = o.label.replace(/ attempt \d$/, '')
    prompts[L] = p; opts[L] = o
    const id = L.split(' ')[0]
    const repo = '/r/one'
    const own = sc[L]?.(p)
    if (L.endsWith('implement')) return (head[id] = SHA(id.length), { ...push, sha: head[id] })
    if (/fix c(\d)/.test(L)) { const r = { ...push, sha: SHA(10 + +L.at(-1)), answers: [], ...own }; head[id] = r.sha; return r }
    if (/review c\d/.test(L)) return { headSha: head[id], findings: [], ...own }
    if (/validate c\d/.test(L)) return { headSha: head[id], gate: green, verified: [], open: [], ...own }
    if (L.endsWith('merge')) return (head[repo] = SHA(50), { ...push, sha: SHA(50) })
    if (L.endsWith(' review')) return { headSha: head[repo], findings: [], ...own }
    if (L.endsWith(' validate') && o.phase === 'Whole-branch') return { verdict: 'pass', sections: 's', sha: head[repo], tests: 't', gate: green, findings: [], ...own }
    if (/fix r(\d)/.test(L)) { const r = { ...push, sha: SHA(70 + +L.at(-1)), answers: [], ...own }; head[repo] = r.sha; return r }
    if (/recheck r\d/.test(L)) return { verdict: 'pass', sections: 's', sha: head[repo], tests: 't', gate: green, findings: [], verified: [], ...own }
    if (L.endsWith(' docs')) return { baseSha: head[repo], sha: '', files: [], prBody: false, ok: true, tests: 't', notes: [] }
    if (L.endsWith(' promote')) return { ok: true, sha: (p.match(/ to ([0-9a-f]{40})\./) || [])[1], notes: [] }
    throw new Error('unmocked ' + L)
  }
  return { agent, prompts, opts }
}
const ws = (id, extra = {}) => ({ id, repo: '/r/one', featureBranch: 'f', branch: `f--${id}`, model: 'sonnet', brief: 'b', gate: 'npm test', ...extra })
const go = async (args, sc) => { const m = mock(sc); const r = await Run(args, m.agent, parallel, () => {}, budget); return { r, p: m.prompts, o: m.opts } }
const fails = []
const t = async (name, fn) => { try { await fn() } catch (e) { fails.push(`${name}: ${e.message.split('\n')[0]}`) } }

// row 1: a blocker the delta-validator neither verified nor re-opened stays open
await t('1a unaccounted workstream blocker is kept', async () => {
  const { r, p } = await go({ cycles: 1, workstreams: [ws('a')] }, {
    'a review c1': () => ({ findings: [F('c1-F1', 'major'), F('c1-F2', 'major')] }),
    'a fix c1': () => ({ answers: [{ id: 'c1-F1', action: 'fixed', note: 'n' }] }),
    'a validate c1': () => ({ verified: ['c1-F1'] }),
  })
  const w = r.workstreams[0]
  assert(!w.merged && w.cyclesRun === 3, JSON.stringify(w))
  const carried = p['a review c2'].split('The last validation left these open')[1] || ''
  assert(carried.includes('"c1-F2"') && !carried.includes('"c1-F1"'), 'c1-F2 carried, verified c1-F1 not') })
await t('1b the kept blocker clears once a validator verifies it', async () => {
  const { r } = await go({ cycles: 1, workstreams: [ws('a')] }, {
    'a review c1': () => ({ findings: [F('c1-F1', 'major'), F('c1-F2', 'major')] }),
    'a validate c1': () => ({ verified: ['c1-F1'] }),
    'a validate c2': () => ({ verified: ['c1-F2'] }),
  })
  const w = r.workstreams[0]
  assert(w.merged && w.cyclesRun === 2, JSON.stringify(w)) })
await t('1c unaccounted whole-branch blocker is kept', async () => {
  const { r, o } = await go({ cycles: null, workstreams: [ws('a')] }, {
    'one review': () => ({ findings: [F('W-F1', 'major'), F('W-F2', 'major')] }),
    'one recheck r1': () => ({ verified: ['W-F1'] }),
  })
  assert(o['one recheck r1'].schema.required.includes('verified'), 'recheck schema has verified')
  const x = r.repos[0]
  assert(x.verdict === 'fail' && x.fixRounds === 2 && x.open.some(s => s.includes('issue W-F2')) && !x.open.some(s => s.includes('issue W-F1')), JSON.stringify(x)) })

// row 1 follow-up: script-built gate findings are rebuilt from each gate run, never kept as unaccounted
const red = { green: false, summary: 'suite x red' }
const delta = p => p.includes('review-fix delta')
const gates = xs => xs.filter(s => /gate: suite x red/.test(s)).length
await t('1d green gate after red clears the gate finding (workstream)', async () => {
  const { r } = await go({ cycles: null, workstreams: [ws('a')] }, { 'a validate c1': p => delta(p) ? {} : { gate: red } })
  const w = r.workstreams[0]
  assert(w.merged && gates(w.open) === 0, JSON.stringify(w)) })
await t('1e still-red gate yields exactly one gate finding (workstream)', async () => {
  const { r } = await go({ cycles: 1, maxCycles: 1, workstreams: [ws('a')] }, { 'a validate c1': () => ({ gate: red }) })
  const w = r.workstreams[0]
  assert(!w.merged && gates(w.open) === 1, JSON.stringify(w.open)) })
await t('1f green gate after red clears the gate finding (whole-branch)', async () => {
  const { r } = await go({ cycles: null, workstreams: [ws('a')] }, { 'one validate': () => ({ gate: red }) })
  assert(r.repos[0].verdict === 'pass' && r.repos[0].fixRounds === 1, JSON.stringify(r.repos[0])) })
await t('1g still-red gate yields exactly one gate finding (whole-branch)', async () => {
  const { r } = await go({ cycles: null, workstreams: [ws('a')] }, { 'one validate': () => ({ gate: red }), 'one recheck r1': () => ({ gate: red }), 'one recheck r2': () => ({ gate: red }) })
  const x = r.repos[0]
  assert(x.verdict === 'fail' && gates(x.open) === 1, JSON.stringify(x.open)) })

// row 2: a fix round with nothing to change keeps the head and is still validated
await t('2a workstream fix with no commit', async () => {
  const { r, p, o } = await go({ cycles: null, workstreams: [ws('a')] }, {
    'a review c1': () => ({ findings: [F('c1-F1', 'major', 'question')] }),
    'a fix c1': () => ({ sha: SHA(1), answers: [{ id: 'c1-F1', action: 'answered', note: 'n' }] }),
    'a validate c1': () => ({ verified: ['c1-F1'] }),
  })
  assert(p['a fix c1'].includes(`Nothing to change (all answered or declined): no commit, no push, sha = the current origin/f--a head (${SHA(1)} unless an earlier attempt moved it), ok = true.`), 'fixer told')
  assert(/nothing to change/i.test(o['a fix c1'].schema.properties.ok.description), 'ok description allows no push')
  assert(p['a validate c1'].includes('No delta: skip the delta hunt and judge the answers and declines; still run the gate, the test-integrity check and the trial merge at this head.'), 'validator told')
  const w = r.workstreams[0]
  assert(w.merged && w.validatedSha === SHA(1), JSON.stringify(w)) })
await t('2b whole-branch fix with no commit', async () => {
  const { r, p } = await go({ cycles: null, workstreams: [ws('a')] }, {
    'one review': () => ({ findings: [F('W-F1', 'major', 'question')] }),
    'one fix r1': () => ({ sha: SHA(50), answers: [{ id: 'W-F1', action: 'answered', note: 'n' }] }),
    'one recheck r1': () => ({ verified: ['W-F1'] }),
  })
  assert(p['one fix r1'].includes(`no commit, no push, sha = ${SHA(50)} (or the origin/f--wbfix1 head if an earlier attempt pushed it), ok = true.`), 'wb fixer told')
  assert(p['one recheck r1'].includes('No delta:'), 'recheck told')
  assert.equal(r.repos[0].verdict, 'pass') })
await t('2c a real delta gets no "No delta" line', async () => {
  const { p } = await go({ cycles: null, workstreams: [ws('a')] }, { 'a review c1': () => ({ findings: [F('c1-F1', 'major')] }), 'a validate c1': () => ({ verified: ['c1-F1'] }) })
  assert(!p['a validate c1'].includes('No delta')) })

// row 4: carried minors from different workstreams get unique ids at whole-branch, and answers still pair
await t('4 whole-branch ids prefixed by workstream', async () => {
  const minor = () => ({ findings: [F('c1-F1', 'minor')] })
  const { r, p } = await go({ cycles: null, workstreams: [ws('a'), ws('b')] }, {
    'a review c1': minor, 'b review c1': minor,
    'one review': () => ({ findings: [F('W-F1', 'major')] }),
    'one fix r1': () => ({ answers: [{ id: 'W-F1', action: 'fixed', note: 'n' }, { id: 'a:c1-F1', action: 'declined', note: 'later' }] }),
    'one recheck r1': () => ({ verified: ['W-F1', 'a:c1-F1'] }),
  })
  const ids = JSON.parse(p['one fix r1'].split('\n')[1]).map(f => f.id)
  assert(new Set(ids).size === ids.length && ids.includes('a:c1-F1') && ids.includes('b:c1-F1'), ids.join())
  assert(p['one recheck r1'].includes('"claim":{"id":"a:c1-F1","action":"declined"'), 'answer paired to prefixed id')
  assert.equal(r.repos[0].verdict, 'pass') })

// row 7: precision rules, required evidence, debiasing; an evidence-less major the validator can't reproduce is demoted
await t('7 evidence + drop rules + debias', async () => {
  const { r, p, o } = await go({ cycles: null, workstreams: [ws('a')] }, {
    'a review c1': () => ({ findings: [F('c1-F1', 'major', 'bug', 'none')] }),
    'a validate c1': () => ({ open: [F('c1-F1', 'minor', 'bug', 'could not reproduce')] }),
    'one review': () => ({ findings: [F('W-F1', 'major')] }),
    'one recheck r1': () => ({ verified: ['W-F1'] }),
  })
  for (const k of ['a review c1', 'one review']) {
    assert(o[k].schema.properties.findings.items.required.includes('evidence'), `${k}: evidence required`)
    assert(/predate the diff/.test(p[k]) && /linter\/formatter/.test(p[k]) && p[k].includes('A comment added in this diff is a claim to grill') && p[k].includes('`shortcut:`'), `${k}: DROP`)
  }
  for (const k of ['a validate c1', 'one recheck r1']) {
    assert(/evidence "none" and not resolved at this head: reproduce it here/.test(p[k]) && /demote/.test(p[k]) && /Design, question and overengineering kinds are exempt/.test(p[k]), `${k}: evidence rule`)
    assert(/judge the code first/.test(p[k]) && /claims, not evidence/.test(p[k]), `${k}: debias`)
  }
  assert(r.workstreams[0].merged, 'demoted to minor -> merges') })
await t('7b reviewer reads author decisions after forming findings', async () => {
  const { p } = await go({ cycles: null, workstreams: [ws('a')] }, {
    'a review c1': () => ({ findings: [F('c1-F1', 'major')] }),
    'a fix c1': () => ({ decisions: [{ what: 'w', why: 'y' }] }),
    'a validate c1': () => ({ verified: ['c1-F1'] }),
  })
  assert(/form your findings from the diff and brief first/.test(p['a review c2'])) })

// prompt rows 3, 5, 6, 8, 9
await t('3/5/6/8/9 prompt asserts', async () => {
  const { p } = await go({ cycles: null, workstreams: [ws('a')] }, {
    'a review c1': () => ({ findings: [F('c1-F1', 'major')] }),
    'a validate c1': () => ({ verified: ['c1-F1'] }),
    'one review': () => ({ findings: [F('W-F1', 'major')] }),
    'one recheck r1': () => ({ verified: ['W-F1'] }),
  })
  // 3: hygiene scoped by email, not by name
  for (const k of ['a merge', 'one validate', 'one recheck r1']) assert(p[k].includes('--author="$(git config user.email)"') && !p[k].includes('user.name'), `3: ${k}`)
  // 5: read-only worktree clears a leftover path first
  for (const k of ['a review c1', 'a validate c1', 'one review', 'one recheck r1']) assert(p[k].includes('if that path still exists, git worktree remove --force it'), `5: ${k}`)
  // 6: test-integrity guard, cheat lens, read-only tests for authors
  for (const k of ['a validate c1', 'one validate', 'one recheck r1']) {
    assert(p[k].includes('--diff-filter=MDR') && /deleted or renamed/.test(p[k]), `6: ${k} MDR`)
    for (const s of ['xfail', '\\.only\\(', '@Disabled', 'pytest.mark.skip', 'it.todo', 'describe.skip', 'conftest', '[tool.pytest]', 'coverage thresholds', 'snapshot'])
      assert(p[k].includes(s), `6: ${k} lacks ${s}`)
    assert(/critical unless the brief names it/.test(p[k]), `6: ${k} severity`)
  }
  for (const k of ['a review c1', 'one review']) assert(p[k].includes('__eq__') && /call counters/.test(p[k]) && /test-environment detection/.test(p[k]), `6: ${k} cheat lens`)
  const RO_TESTS = 'Pre-existing tests are read-only unless the brief names them. If a test or the gate contradicts the brief, or passing would need special-casing, return status blocked with a question — that is a valid outcome.'
  for (const k of ['a implement', 'a fix c1']) assert(p[k].includes(RO_TESTS), `6: ${k} read-only tests`)
  // 8: red-verify at the pre-fix sha in a worktree under .claude/worktrees/, hunk-revert only as a stated fallback
  for (const [k, pre] of [['a validate c1', SHA(1)], ['one recheck r1', SHA(50)]])
    assert(p[k].includes(`must fail at ${pre}`) && /\/\.claude\/worktrees\//.test(p[k].split(`must fail at ${pre}`)[1]) && /never mktemp/.test(p[k]) && /fallback/.test(p[k]) && /evidence/.test(p[k]) && p[k].includes('-red (same rules: clear a leftover path first, remove it when done'), `8: ${k}`)
  // 9: after an integration fix, skip the merged-in side
  assert(p['a validate c1'].includes(`git diff origin/f...${SHA(11)}`), '9: merged-in side skipped')
  assert(p['a validate c1'].includes('open (same id for an unresolved finding;'), 'delta validator keeps ids') })

if (fails.length) { console.log('FAILED:\n' + fails.join('\n')); process.exit(1) }
console.log('tier-1 checks ok')
