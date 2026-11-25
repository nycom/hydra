// 0.4.8: one docs fix round before a failed docs validation fails the repo, and a churn stop in the workstream cycles.
// Every scenario fails against the 0.4.7 script except the ones marked (control).
import { Run } from './run.mjs'
import assert from 'node:assert'
const SHA = n => (n + '').padStart(40, 'a')
const parallel = fs => Promise.all(fs.map(f => f().catch(() => null)))
const free = { total: null, spent: () => 0, remaining: () => Infinity }
const green = { green: true, summary: '12 passed', command: 'npm test', flaky: [] }
const push = { status: 'done', ok: true, tests: 't', gateTail: 'gate exit=0', sharedEdits: [], decisions: [], questions: [], notes: [] }
const F = (id, where = 'x.py:3', kind = 'bug', severity = 'major') => ({ id, severity, kind, where, issue: `issue ${id}`, evidence: 'test t1 red' })
const ws = (id, extra = {}) => ({ id, repo: '/r/one', featureBranch: 'f', branch: `f--${id}`, model: 'sonnet', brief: `brief ${id}`, gate: 'npm test', files: [`${id}/`], ...extra })
const BASE = SHA(500), DOC = SHA(900), FIX = SHA(901)
const go = async (args, sc = {}, budget = free) => {
  const prompts = {}, opts = {}, order = []
  let head = SHA(97), n = 0
  const agent = async (p, o) => {
    const L = o.label.replace(/ attempt \d$/, '')
    prompts[L] = p; opts[L] = o; order.push(o.label)
    const own = sc[L]?.(p)
    if (own === null) return null
    if (L.startsWith('health ')) return { ok: true, notes: 'git version 2', ...own }
    if (L.endsWith('implement')) return { ...push, sha: head, ...own }
    if (/fix c\d/.test(L)) return { ...push, sha: head = SHA(200 + ++n), answers: [], ...own }
    if (/review c\d/.test(L)) return { headSha: head, findings: [], ...own }
    if (/validate c\d/.test(L)) return { headSha: head, gate: green, evidence: 'e', verified: [], open: [], questions: [], ...own }
    if (L.endsWith('merge')) return { ...push, sha: BASE, preMergeSha: SHA(40), baseAtMerge: SHA(40), ...own }
    if (L.endsWith(' docs')) return { baseSha: L === 'one docs' ? BASE : SHA(5), sha: DOC, files: ['README.md'], prBody: false, ok: true, tests: 'first', notes: ['author note'], ...own }
    if (L.endsWith(' docs validate')) return { verdict: 'pass', sections: 's', sha: DOC, tests: 't', gate: green, findings: [], ...own }
    if (L.endsWith(' docs fix')) return { baseSha: DOC, sha: FIX, files: ['README.md', 'docs/a.md'], prBody: false, ok: true, tests: 'second', notes: ['fixer note'], ...own }
    if (L.endsWith(' docs revalidate')) return { verdict: 'pass', sections: 's', sha: FIX, tests: 't', gate: green, findings: [], ...own }
    if (L.endsWith(' validate')) return { verdict: 'pass', sections: 's', sha: BASE, tests: 't', gate: green, findings: [], verified: [], questions: [], ...own }
    if (L.endsWith(' promote')) return { ok: true, sha: (p.match(/ to ([0-9a-f]{40})\./) || [])[1], notes: [], ...own }
    throw new Error('unmocked ' + L)
  }
  let timer
  const hung = new Promise((_, no) => { timer = setTimeout(() => no(new Error('the run hung')), 2000) })
  const r = await Promise.race([Run(args, agent, parallel, () => {}, budget instanceof Function ? budget(order) : budget), hung]).finally(() => clearTimeout(timer))
  return { r, one: r.repos[0], a: r.workstreams[0], prompts, opts, order, docs: order.filter(l => / docs( |$)/.test(l)) }
}
const fails = []
const t = async (name, fn) => { try { await fn() } catch (e) { fails.push(`${name}: ${e.message.split('\n').slice(0, 12).join(' ')}`) } }

// ---- one docs fix round ----
const ARGS = { cycles: 1, workstreams: [ws('a')] }
const bad = (...fs) => () => ({ verdict: 'fail', findings: fs })
const miss = { 'one docs validate': bad(F('D-F1', 'README.md:9', 'docs'), F('D-F2', 'README.md:12', 'docs', 'minor')) }
const FULL = ['one docs', 'one docs validate', 'one docs fix', 'one docs revalidate', 'one docs promote']

await t('1a fix then pass: the fixed docs are revalidated, promoted and the repo passes', async () => {
  const { one, docs, prompts, opts } = await go(ARGS, miss)
  assert.deepEqual(docs, FULL)
  assert.deepEqual([one.verdict, one.finalSha, one.sha], ['pass', FIX, BASE])
  assert.deepEqual([one.docs.verdict, one.docs.sha, one.docs.fixRounds, one.docs.findings, one.docs.files, one.docs.tests], ['pass', FIX, 1, [], ['README.md', 'docs/a.md'], 'second'])
  for (const x of ['author note', 'fixer note']) assert(one.docs.notes.includes(x), one.docs.notes.join())
  assert(one.docs.notes.some(x => x.includes(DOC) && x.includes('D-F1')), 'a note says what the round fixed')
  assert.deepEqual(one.escalations, [])
  assert(prompts['one docs promote'].includes(`fast-forward f from ${BASE} to ${FIX}.`), prompts['one docs promote'])
  const o = opts['one docs fix']
  assert.deepEqual([o.phase, o.agentType, o.model], ['Docs sync', 'implementer', 'sonnet']) })
await t('1b the fix prompt carries the findings, the side branch, the pinned heads and the gate', async () => {
  const p = (await go(ARGS, miss)).prompts['one docs fix']
  for (const x of [`left these open on the docs commit ${DOC}`, '"D-F1"', '"D-F2"', 'worktree docs-fix', `origin/f--docs (expected ${DOC}`, 'push back to f--docs, never to f.', `/r/one @ f = ${BASE}`, 'npm test', 'Red gate: do not push, ok=false.', `${DOC}..HEAD`, '/r/one/.claude/worktrees/docs-fix']) assert(p.includes(x), x)
  const ng = await go({ ...ARGS, docsRepos: [{ repo: '/r/notes', featureBranch: 'f' }] }, { 'notes docs validate': bad(F('D-F1')) })
  assert(ng.prompts['notes docs fix'].includes('No gate for this repo.'))
  assert.deepEqual([ng.r.otherDocs[0].docs.verdict, ng.r.otherDocs[0].docs.fixRounds, ng.r.otherDocs[0].docs.sha], ['pass', 1, FIX]) })
await t('1c the revalidation is the first validation on the whole range up to the fixed commit', async () => {
  const { prompts, opts } = await go(ARGS, miss)
  assert(prompts['one docs validate'].includes(`${BASE}..${DOC}`))
  assert.equal(prompts['one docs revalidate'], prompts['one docs validate'].replaceAll(DOC, FIX))
  assert.deepEqual({ ...opts['one docs revalidate'], label: '' }, { ...opts['one docs validate'], label: '' }) })
await t('1d a red gate is a blocker the round may fix', async () => {
  const { one, docs } = await go(ARGS, { 'one docs validate': () => ({ gate: { ...green, green: false, summary: 'lint red' } }) })
  assert.deepEqual([docs, one.verdict], [FULL, 'pass']) })
await t('2a fix then fail: one round only, the repo fails and the side branch\'s tip is named', async () => {
  const { one, docs, prompts } = await go(ARGS, { ...miss, 'one docs revalidate': bad(F('D-F9', 'README.md:9', 'docs')) })
  assert.deepEqual(docs, FULL.slice(0, 4))
  assert.deepEqual([one.verdict, one.finalSha, one.docs.verdict, one.docs.sha, one.docs.fixRounds], ['fail', BASE, 'fail', FIX, 1])
  for (const xs of [one.escalations, one.docs.notes]) assert(xs.some(e => e.includes(FIX) && e.includes('f--docs') && e.includes('after one docs fix round')), xs.join())
  assert(one.open.some(x => x.includes('D-F9')) && !one.open.some(x => x.includes('D-F1')), one.open.join())
  assert(!prompts['one docs promote']) })
await t('2b the fixer pushed nothing, left its gate red or died: fails on the first docs commit with the first findings', async () => {
  for (const [own, note] of [[{ sha: '' }, /pushed nothing to validate/], [{ sha: DOC }, /pushed nothing to validate/], [{ sha: 'abc' }, /pushed nothing to validate/], [{ ok: false }, /pushed nothing to validate/], [null, /docs fix.*check origin\/f--docs/]]) {
    const { one, docs } = await go(ARGS, { ...miss, 'one docs fix': () => own }), what = JSON.stringify(own)
    assert(!docs.some(l => /revalidate|promote/.test(l)), `${what}: ${docs}`)
    assert.deepEqual([one.verdict, one.finalSha, one.docs.sha, one.docs.fixRounds], ['fail', BASE, DOC, 1], what)
    assert(one.docs.notes.some(x => note.test(x)), `${what}: ${one.docs.notes}`)
    assert(one.open.some(x => x.includes('D-F1')) && one.escalations.some(e => e.includes(DOC) && e.includes('after one docs fix round')), what) } })
await t('2c a revalidation that died or saw another commit fails, and the first findings stay open', async () => {
  for (const own of [null, { sha: SHA(77) }]) {
    const { one, docs } = await go(ARGS, { ...miss, 'one docs revalidate': () => own })
    assert(!docs.includes('one docs promote') && one.verdict === 'fail' && one.finalSha === BASE && one.docs.sha === FIX)
    for (const x of ['D-F1', 'D-X']) assert(one.findings.some(f => f.id === x), `${x}: ${one.findings.map(f => f.id)}`) } })
await t('2d a fixed commit that cannot be promoted fails the repo', async () => {
  const { one } = await go(ARGS, { ...miss, 'one docs promote': () => ({ ok: false, sha: BASE, notes: ['f moved'] }) })
  assert.deepEqual([one.verdict, one.finalSha, one.docs.sha, one.docs.fixRounds], ['fail', BASE, FIX, 1])
  assert(one.open.some(x => /not promoted to f: f moved/.test(x))) })
await t('3 no round on the script\'s own D-X', async () => {
  for (const sc of [{ 'one docs validate': () => ({ ...miss['one docs validate'](), sha: SHA(77) }) }, { 'one docs validate': () => null }, { 'one docs': () => ({ baseSha: SHA(99) }) }]) {
    const { one, docs } = await go(ARGS, sc)
    assert(!docs.some(l => /fix|promote/.test(l)), docs.join())
    assert.deepEqual([one.verdict, one.docs.fixRounds, one.docs.findings.length], ['fail', 0, 1])
    assert(!one.escalations.some(e => e.includes('docs fix round'))) } })
await t('4 no round below the token reserve; stoppedBy names it', async () => {
  const low = order => ({ ...free, remaining: () => order.includes('one docs validate') ? 1000 : Infinity })
  const { r, one, docs } = await go(ARGS, miss, low)
  assert.deepEqual(docs, FULL.slice(0, 2))
  assert.deepEqual([r.budget.stoppedBy, one.verdict, one.docs.sha, one.docs.fixRounds], [['one docs fix'], 'fail', DOC, 0]) })
await t('5 (control) a passing validation spawns nothing new', async () => {
  const { one, docs } = await go(ARGS, { 'one docs validate': () => ({ findings: [F('D-F2', 'README.md:12', 'docs', 'minor')] }) })
  assert.deepEqual([docs, one.verdict, one.finalSha], [['one docs', 'one docs validate', 'one docs promote'], 'pass', DOC]) })
await t('5b a run whose docs need no round reports fixRounds 0', async () => {
  assert.equal((await go(ARGS)).one.docs.fixRounds, 0)
  assert.equal((await go(ARGS, { 'one docs': () => ({ sha: '' }) })).one.docs.fixRounds, 0)
  assert.equal((await go(ARGS, { 'one docs': () => null })).one.docs.fixRounds, 0) })
await t('5c (control) a fail verdict with nothing blocking open has nothing to fix', async () => {
  const { one, docs } = await go(ARGS, { 'one docs validate': bad(F('D-F2', 'README.md:12', 'docs', 'minor')) })
  assert.deepEqual([docs, one.verdict], [FULL.slice(0, 2), 'fail']) })

// ---- churn stop in the workstream cycles ----
const R = (k, where = `x.py:${10 + k}`) => F(`v${k}-R1`, where, 'regression')
// each cycle's fix resolves what it was given and the delta validator returns that cycle's `open`
const cycles = (opens, first = F('c1-F1')) => ({ 'a review c1': () => ({ findings: [first] }),
  ...Object.fromEntries(opens.map((open, j) => [`a validate c${j + 1}`, () => ({ verified: [j ? `v${j}-R1` : 'c1-F1'], open: [].concat(open) })])) })
const churnQ = r => r.questions.filter(q => /heuristic churn/.test(q.q))
const askSoft = { status: 'blocked', questions: [{ q: 'Round half up or down?', options: ['up', 'down'], default: 'up' }] }
const C = { cycles: null, maxCycles: 4, docsRepos: [], workstreams: [ws('a')] }

await t('6a two cycles in a row that each break a file the fix was asked to touch stop the workstream with one question', async () => {
  const { r, a, order } = await go(C, cycles([R(1), R(2), []]))
  assert(!order.includes('a review c3') && !a.merged, order.join())
  assert.deepEqual(a.churn, [{ cycle: 1, files: ['x.py'] }, { cycle: 2, files: ['x.py'] }])
  assert(a.escalations.some(e => /heuristic churn/.test(e) && /NOT merged/.test(e)), a.escalations.join())
  assert(a.open.some(o => o.includes('x.py:12')), 'the stopping cycle\'s regression is reported open')
  const [q, ...more] = churnQ(r)
  assert.equal(more.length, 0)
  assert.equal(q.q, 'a: heuristic churn: the fixes of cycles 1 and 2 broke x.py (c1, c2) again')
  assert.deepEqual([q.options.length, q.default], [3, q.options[0]])
  assert(/^change the brief or spec/.test(q.options[0]) && /^run more cycles \(raise maxCycles\)/.test(q.options[1]) && q.options[2].includes('dropped: ["a"]'), q.options.join()) })
await t('6b the question names each cycle\'s files', async () => {
  const { r } = await go(C, cycles([[R(1, 'a.py:4'), F('v1-F2', 'b.py:3')], R(2, 'b.py:7')], F('c1-F1', 'a.py:3')))
  assert.equal(churnQ(r)[0]?.q, 'a: heuristic churn: the fixes of cycles 1 and 2 broke a.py (c1), b.py (c2) again') })
await t('7a one such cycle is enough while an optional question of the workstream is still open', async () => {
  const { r, a, order } = await go(C, { ...cycles([R(1), []]), 'a implement': () => askSoft })
  assert(!order.includes('a review c2') && !a.merged, order.join())
  assert.deepEqual(a.churn, [{ cycle: 1, files: ['x.py'] }])
  assert.equal(churnQ(r).length, 1)
  assert.equal(churnQ(r)[0].q, 'a: heuristic churn: the fix of cycle 1 broke x.py (c1), with an optional question still open: Round half up or down?')
  assert(r.questions.some(q => q.q === 'a: Round half up or down?'), 'the optional question itself is kept') })
await t('7b an optional question raised by that cycle\'s own fix counts', async () => {
  const { a, order } = await go(C, { ...cycles([R(1), []]), 'a fix c1': () => askSoft })
  assert(!order.includes('a review c2') && !a.merged, order.join()) })
await t('8a (control) one such cycle with no open question is recorded and the loop continues', async () => {
  const { r, a } = await go(C, cycles([R(1), []]))
  assert(a.merged && churnQ(r).length === 0, a.escalations.join()) })
await t('8b the record of a healthy run: one entry for the one hit, none without', async () => {
  assert.deepEqual((await go(C, cycles([R(1), []]))).a.churn, [{ cycle: 1, files: ['x.py'] }])
  assert.deepEqual((await go(C)).a.churn, []) })
// a validator's finding no fix was asked about yet, in another file, then in none
await t('8c a regression in a file the fix was not asked to touch, or with no path:line, never counts', async () => {
  for (const w of ['other.py:4', 'gate']) {
    const { r, a, order } = await go(C, cycles([R(1), R(2, w), []]))
    assert(order.includes('a review c3') && churnQ(r).length === 0, w)
    assert.deepEqual(a.churn, [{ cycle: 1, files: ['x.py'] }], w) } })
await t('8d a re-opened id is not a new regression', async () => {
  const again = F('c1-F1', 'x.py:3', 'regression')
  const sc = { ...cycles([], again), 'a validate c1': () => ({ open: [again] }), 'a validate c2': () => ({ open: [again] }), 'a validate c3': () => ({ verified: ['c1-F1'] }) }
  const { r, a, order } = await go(C, { ...sc, 'a review c2': () => ({ findings: [again] }), 'a review c3': () => ({ findings: [again] }) })
  assert(order.includes('a fix c3') && churnQ(r).length === 0, order.join())
  assert.deepEqual(a.churn, []) })
await t('8e a minor regression, or a kind bug major, in an asked file never counts', async () => {
  for (const f of [F('v1-R1', 'x.py:11', 'regression', 'minor'), F('v1-R1', 'x.py:11')]) {
    const { r, a } = await go(C, { ...cycles([f, { ...f, id: 'v2-R1' }, []]), 'a implement': () => askSoft })
    assert(a.merged && churnQ(r).length === 0, a.escalations.join())
    assert.deepEqual(a.churn, []) } })
await t('8f cycles 1 and 3 but not 2 never stop the loop', async () => {
  const { r, a } = await go(C, cycles([R(1), F('v2-R1', 'x.py:12'), R(3), []]))
  assert(a.merged && churnQ(r).length === 0, a.escalations.join())
  assert.deepEqual(a.churn.map(c => c.cycle), [1, 3]) })
await t('8g an optional question the fix settled is not open', async () => {
  const { r, a } = await go(C, { ...cycles([F('v1-R1', 'other.py:4', 'regression', 'minor'), []]), 'a implement': () => askSoft, 'a fix c1': () => ({ settles: ['Q1'] }),
    'a validate c1': () => ({ verified: ['c1-F1'] }), 'a review c2': () => ({ findings: [F('c2-F1')] }), 'a validate c2': () => ({ verified: ['c2-F1'], open: [R(2)] }), 'a validate c3': () => ({ verified: ['v2-R1'] }) })
  assert(a.merged && churnQ(r).length === 0, a.escalations.join())
  assert.deepEqual(a.churn, [{ cycle: 2, files: ['x.py'] }]) })

if (fails.length) { console.error(fails.join('\n')); process.exit(1) }
console.log('docs fix round and cycle churn checks ok')
