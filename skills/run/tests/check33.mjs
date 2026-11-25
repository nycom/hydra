// 0.4.12: a fabricated author or fixer result is a dead attempt; the docs step closes open doc minors and keeps to the merge's shared edits.
// Every scenario fails against the 0.4.11 script except the ones marked (control).
import { Run } from './run.mjs'
import assert from 'node:assert'
const SHA = n => (n + '').padStart(40, 'a')
const ZERO = '0'.repeat(40)
const parallel = fs => Promise.all(fs.map(f => f().catch(() => null)))
const free = { total: null, spent: () => 0, remaining: () => Infinity }
const green = { green: true, summary: '12 passed', command: 'npm test', flaky: [] }
const push = { status: 'done', ok: true, tests: 't', gateTail: 'OK\ngate exit=0', sharedEdits: [], decisions: [], questions: [], notes: [] }
const F = (id, where = 'a/x.py:3', severity = 'major', kind = 'bug') => ({ id, severity, kind, where, issue: `issue ${id}`, evidence: 'test t1 red' })
const ROW = { file: 'README.md', intent: 'add the row | `a(x)` | Returns x. | after the b row; nothing else changes' }
const Q = q => ({ q, options: ['keep the row', 'extend the row'], default: 'keep the row' })
const ws = (id, extra = {}) => ({ id, repo: '/r/one', featureBranch: 'f', branch: `f--${id}`, model: 'sonnet', brief: `brief ${id}`, gate: 'npm test', files: [`${id}/`], ...extra })
const BASE = SHA(500), DOC = SHA(900), FIX = SHA(901)
// sc[label](prompt, k) overrides a step's k-th attempt; null = the agent died
const go = async (args, sc = {}, per = 0) => {
  const prompts = {}, all = {}, opts = {}, order = [], head = {}
  let tip = BASE, n = 0, spent = 0
  const agent = async (p, o) => {
    const L = o.label.replace(/ attempt \d$/, ''), id = L.split(' ')[0]
    prompts[L] = p; (all[L] ||= []).push(p); opts[o.label] = o; order.push(o.label); spent += per
    const own = sc[L]?.(p, all[L].length)
    if (own === null) return null
    if (L.startsWith('health ')) return { ok: true, notes: 'git version 2', ...own }
    if (L.endsWith(' state')) return { featureSha: tip, workstreams: [], ...own }
    if (L.endsWith(' implement') || / fix c\d$/.test(L)) { const r = { ...push, sha: SHA(200 + ++n), answers: [], ...own }; head[id] = r.sha; return r }
    if (/ review c\d$/.test(L)) return { headSha: head[id], findings: [], ...own }
    if (/ validate c\d$/.test(L)) return { headSha: head[id], gate: green, evidence: 'e', verified: [], open: [], questions: [], ...own }
    if (L.endsWith(' merge')) return { ...push, sha: tip, preMergeSha: SHA(40), baseAtMerge: SHA(41), ...own }
    if (/ fix r\d$/.test(L)) { const r = { ...push, sha: SHA(700 + ++n), answers: [], ...own }; tip = r.sha; return r }
    if (L.endsWith(' docs')) return { baseSha: tip, sha: DOC, files: ['README.md'], prBody: false, ok: true, tests: 't', notes: [], ...own }
    if (L.endsWith(' docs validate')) return { verdict: 'pass', sections: 's', sha: DOC, tests: 't', gate: green, findings: [], ...own }
    if (L.endsWith(' docs fix')) return { baseSha: DOC, sha: FIX, files: ['README.md'], prBody: false, ok: true, tests: 't', notes: [], ...own }
    if (L.endsWith(' docs revalidate')) return { verdict: 'pass', sections: 's', sha: FIX, tests: 't', gate: green, findings: [], ...own }
    if (L.endsWith(' review')) return { headSha: tip, findings: [], seams: 'none', ...own }
    if (/ (validate|recheck r\d)$/.test(L)) return { verdict: 'pass', sections: 's', sha: tip, tests: 't', gate: green, findings: [], verified: [], questions: [], ...own }
    if (L.endsWith(' promote')) return { ok: true, sha: (p.match(/ to ([0-9a-f]{40})\./) || [])[1], notes: [], ...own }
    throw new Error('unmocked ' + L)
  }
  let timer
  const hung = new Promise((_, no) => { timer = setTimeout(() => no(new Error('the run hung')), 2000) })
  const r = await Promise.race([Run(args, agent, parallel, () => {}, { ...free, spent: () => spent }), hung]).finally(() => clearTimeout(timer))
  return { r, one: r.repos[0], a: r.workstreams[0], prompts, all, opts, order, ran: L => order.filter(l => l.replace(/ attempt \d$/, '') === L) }
}
const fails = []
const t = async (name, fn) => { try { await fn() } catch (e) { fails.push(`${name}: ${e.message.split('\n').slice(0, 8).join(' ')}`) } }
const holds = (all, x) => Object.keys(all).filter(L => all[L].some(p => p.includes(x))).sort()
const ONE = { cycles: 1, workstreams: [ws('a')] }
const three = L => [L, `${L} attempt 2`, `${L} attempt 3`]

// ---- 1. a fabricated result is a dead attempt ----
const REPAIR = 'Do not redo the work: git ls-remote'
const zeros = [['an all-zero sha and placeholders', { sha: ZERO, tests: 'placeholder', gateTail: 'placeholder' }], ['an all-zero sha', { sha: ZERO }]]
const blanks = [['a placeholder gateTail', { tests: 'placeholder', gateTail: 'placeholder' }], ['another placeholder word', { gateTail: ' [TBD] ' }]]
const once = own => (p, k) => k === 1 ? own : undefined
const then = (own, real) => (p, k) => k === 1 ? own : real
const found = { 'a review c1': () => ({ findings: [F('c1-F1')] }), 'a validate c1': () => ({ verified: ['c1-F1'] }) }
const wb = { 'one validate': () => ({ verdict: 'fail', findings: [F('V-F1')] }), 'one recheck r1': () => ({ verified: ['V-F1'] }) }

await t('1a an author: the step is redone in full and only the real result is kept', async () => {
  for (const [what, own] of zeros) {
    const { a, prompts, ran, all } = await go(ONE, { 'a implement': then({ ...own, notes: ['made up'] }, { tests: '12 passed', sharedEdits: [ROW], notes: ['real'] }) })
    assert.deepEqual(ran('a implement'), three('a implement').slice(0, 2), what)
    const redo = all['a implement'][1]
    assert(redo.startsWith(all['a implement'][0]) && /Attempt 2: .*Redo the whole step; first check the remote for anything it already pushed/.test(redo), `${what}: ${redo.slice(-400)}`)
    assert(!redo.includes(REPAIR) && !/placeholder|made up/.test(redo), `${what}: never the repair, and nothing of the discarded result`)
    assert(a.merged && /^a+\d+$/.test(a.validatedSha), what)
    assert.deepEqual([a.tests, a.sharedEdits, a.gateTail], ['12 passed', [ROW], push.gateTail], what)
    assert(a.notes.includes('real') && !a.notes.includes('made up'), what)
    assert(prompts['a merge'].includes(JSON.stringify([ROW])), `${what}: the merge gets the real shared edits`) } })
await t('1b a workstream fixer and a whole-branch fixer, a placeholder gateTail on a new commit included: the real answers are kept', async () => {
  const answers = id => ({ answers: [{ id, action: 'fixed', note: 'the real fix' }] })
  for (const [what, own] of [...zeros, ...blanks]) {
    const c = await go(ONE, { ...found, 'a fix c1': then(own, answers('c1-F1')) })
    assert.deepEqual([c.ran('a fix c1').length, c.a.merged], [2, true], what)
    assert(c.prompts['a validate c1'].includes('the real fix') && !c.prompts['a validate c1'].includes(ZERO), what)
    const r = await go(ONE, { ...wb, 'one fix r1': then(own, answers('V-F1')) })
    assert.deepEqual([r.ran('one fix r1').length, r.one.verdict], [2, 'pass'], what)
    assert(r.prompts['one recheck r1'].includes('the real fix') && !r.prompts['one recheck r1'].includes(ZERO), what) } })
await t('1c attempts stay bounded: three fabricated results stop the workstream, and the escalation says so', async () => {
  for (const [what, own] of zeros) {
    const { a, ran, order } = await go(ONE, { 'a implement': () => own })
    assert.deepEqual(ran('a implement'), three('a implement'), what)
    assert(!a.merged && !order.some(l => /review|health/.test(l)), `${what}: ${order}`)
    assert(a.escalations.some(e => /^implement returned no usable result 3 times \(.*placeholder.*\); check origin\/f--a/.test(e)), `${what}: ${a.escalations}`) }
  const { a, one } = await go(ONE, { ...wb, 'one fix r1': () => ({ sha: ZERO }) })
  assert(a.merged && one.verdict === 'fail' && one.escalations.some(e => /whole-branch fix r1 returned no usable result 3 times/.test(e)), one.escalations.join()) })
await t('1d dead, fabricated and malformed attempts share the three', async () => {
  const seq = (...xs) => (p, k) => xs[k - 1]
  const mixed = await go(ONE, { 'a implement': seq(null, { sha: ZERO }, { sha: 'PLACEHOLDER' }) })
  assert.deepEqual([mixed.ran('a implement'), mixed.a.merged], [three('a implement'), false])
  const last = await go(ONE, { 'a implement': seq({ sha: ZERO }, null, { notes: ['third'] }) })
  assert.deepEqual([last.ran('a implement'), last.a.merged], [three('a implement'), true])
  assert(last.a.notes.includes('third')) })
await t('1e a sha repair that answers with zeros is no repair: the first full result waits for a real sha', async () => {
  const { a, all } = await go(ONE, { 'a implement': (p, k) => k === 1 ? { sha: 'aaaaaaa', sharedEdits: [ROW] } : k === 2 ? { sha: ZERO } : {} })
  assert.equal(all['a implement'].length, 3)
  assert(all['a implement'][2].includes(REPAIR) && all['a implement'][2].includes('"sha":"aaaaaaa"'))
  assert(a.merged && /^a+\d+$/.test(a.validatedSha))
  assert.deepEqual(a.sharedEdits, [ROW]) })
await t('1f a new commit with a placeholder gateTail is redone once: past attempt 1 the sha proves no new commit', async () => {
  const c = await go(ONE, { ...found, 'a fix c1': () => ({ gateTail: 'placeholder' }) })
  assert.deepEqual([c.ran('a fix c1').length, c.a.merged], [2, true])
  const r = await go(ONE, { ...wb, 'one fix r1': () => ({ gateTail: 'placeholder' }) })
  assert.deepEqual([r.ran('one fix r1').length, r.one.verdict], [2, 'pass']) })
await t('1g a soft block and an "already merged" with an all-zero sha name no head either', async () => {
  const soft = await go(ONE, { 'a implement': once({ status: 'blocked', sha: ZERO, questions: [Q('Round up?')] }) })
  assert.deepEqual([soft.ran('a implement').length, soft.a.merged], [2, true])
  const merged = await go(ONE, { 'a implement': once({ alreadyMerged: true, sha: ZERO }) })
  assert.equal(merged.ran('a implement').length, 2)
  assert(merged.ran('a merge').length === 1, 'the redo found work that still had to merge') })
await t('1h the redo runs live on a resume and counts like any other replacement', async () => {
  const run = own => go(ONE, { 'a implement': once(own) }, 1000)
  const fake = await run({ sha: ZERO }), dead = await run(null)
  assert.deepEqual(fake.order, dead.order)
  assert.deepEqual(fake.r.budget, dead.r.budget)
  assert.equal(fake.r.budget.spent, fake.order.length * 1000)
  assert.notEqual(fake.all['a implement'][1], fake.all['a implement'][0]) // a resume never hands back the discarded attempt's cached result
  const { label: l1, ...o1 } = fake.opts['a implement'], { label: l2, ...o2 } = fake.opts['a implement attempt 2']
  assert.deepEqual(o2, o1) })
// what four honest fixers that changed nothing returned in recorded runs
const QUIET = ['not run (no change made)', 'not run (no change to push)', 'gate not run (no change to push)', 'gate not run (no change made)']
const c1 = own => ({ ...found, 'a fix c1': (p, k) => ({ answers: [{ id: 'c1-F1', action: 'answered', note: 'n' }], ...own(p.match(/\(expected ([0-9a-f]{40})/)[1], k) }) })
const r1 = own => ({ ...wb, 'one fix r1': (p, k) => ({ answers: [{ id: 'V-F1', action: 'answered', note: 'n' }], ...own(p.match(/detached at ([0-9a-f]{40})/)[1], k) }) })
await t('1i (control) a fixer that changed nothing ran no gate and is never a dead attempt', async () => {
  for (const gateTail of QUIET) {
    const c = await go(ONE, c1(sha => ({ sha, gateTail }))), r = await go(ONE, r1(sha => ({ sha, gateTail })))
    assert.deepEqual([c.ran('a fix c1').length, c.a.merged, r.ran('one fix r1').length, r.one.verdict], [1, true, 1, 'pass'], gateTail) } })
await t('1i2 (control) nor when an earlier attempt moved the head: a dead one, a resumed call\'s, or a side branch left for stage wholeBranch', async () => {
  for (const gateTail of QUIET) {
    const moved = { sha: SHA(333), gateTail }
    const c = await go(ONE, { ...found, 'a fix c1': (p, k) => k === 1 ? null : { ...moved, answers: [{ id: 'c1-F1', action: 'answered', note: 'n' }] } })
    const r = await go(ONE, { ...wb, 'one fix r1': (p, k) => k === 1 ? null : { ...moved, answers: [{ id: 'V-F1', action: 'answered', note: 'n' }] } })
    assert.deepEqual([c.ran('a fix c1').length, c.a.merged, r.ran('one fix r1').length, r.one.verdict], [2, true, 2, 'pass'], gateTail)
    const back = { ...ONE, resume: 'run-1', carryForward: {} }
    const cr = await go(back, c1(() => moved)), rr = await go(back, r1(() => moved))
    assert.deepEqual([cr.ran('a fix c1').length, cr.a.merged, rr.ran('one fix r1').length, rr.one.verdict], [1, true, 1, 'pass'], `resume: ${gateTail}`)
    const again = await go({ ...ONE, stage: 'wholeBranch' }, r1(() => moved))
    assert.deepEqual([again.ran('one fix r1').length, again.one.verdict], [1, 'pass'], `wholeBranch: ${gateTail}`)
    // past the first attempt, on a resume and with nothing merged in this call even a placeholder word proves no fabrication
    const word = { sha: SHA(333), gateTail: 'placeholder' }, resumed = { ...ONE, resume: 'run-1', carryForward: {} }
    assert.deepEqual([(await go(resumed, c1(() => word))).ran('a fix c1').length, (await go(resumed, r1(() => word))).ran('one fix r1').length], [1, 1], 'resume')
    for (const [args, sc] of [[{ ...ONE, stage: 'wholeBranch' }, {}], [ONE, { 'a implement': () => ({ alreadyMerged: true }) }]]) assert.equal((await go(args, { ...r1(() => word), ...sc })).ran('one fix r1').length, 1, 'nothing merged')
    const fresh = await go(ONE, { ...r1(() => moved), 'a implement': () => ({ alreadyMerged: true }) })
    assert.deepEqual([fresh.ran('one fix r1').length, fresh.one.verdict], [1, 'pass'], `a fresh run over merged work: ${gateTail}`) } })
await t('1i3 (control) a gate output cut above its last line is a gate output, a terse gate\'s one word or nothing included', async () => {
  for (const gateTail of ['Ran 15 tests in 0.004s\n\nOK', '12 passed', '[INFO] BUILD SUCCESS\n[INFO] done', 'lint clean\nall checks passed', 'All checks passed!', 'OK', 'BUILD SUCCESSFUL', '', undefined, 'the placeholder tests pass', 'gate exit=0'])
    for (const x of [await go(ONE, c1(() => ({ gateTail }))), await go(ONE, r1(() => ({ gateTail }))), await go(ONE, { 'a implement': () => ({ gateTail }) })])
      assert(x.a.merged && x.one.verdict === 'pass' && !x.order.some(l => /attempt/.test(l)), gateTail) })
await t('1i4 (control) an author has no given head, so its gateTail is never judged; a result that claims no push is not either', async () => {
  for (const gateTail of [...QUIET, 'the branch already meets the brief'])
    assert.equal((await go(ONE, { 'a implement': () => ({ gateTail }) })).ran('a implement').length, 1, gateTail)
  const m = await go(ONE, { 'a implement': () => ({ alreadyMerged: true, gateTail: 'already merged, not run' }) })
  assert.deepEqual([m.ran('a implement').length, m.a.merged, m.ran('a merge').length], [1, true, 0], 'already merged')
  const softFix = await go(ONE, c1(() => ({ status: 'blocked', gateTail: 'placeholder', questions: [Q('Round up?')] })))
  assert.equal(softFix.ran('a fix c1').length, 1, 'a soft block is judged on its sha alone')
  for (const own of [{ ok: false, sha: '', gateTail: 'gate exit=1' }, { ok: false, sha: '', gateTail: '' }, { status: 'blocked', ok: false, sha: '', gateTail: '', questions: [Q('which?')] }, { status: 'failed', ok: false, sha: ZERO, gateTail: '' }])
    assert.equal((await go(ONE, { 'a implement': () => own })).ran('a implement').length, 1, JSON.stringify(own)) })
await t('1j (control) an honest empty sha keeps its sha repair: no redo, and the first result stays', async () => {
  for (const gateTail of [push.gateTail, 'nothing was pushed']) {
    const c = await go(ONE, { ...found, 'a fix c1': then({ sha: '', gateTail, notes: ['first'] }, {}) })
    assert(c.all['a fix c1'].length === 2 && c.all['a fix c1'][1].includes(REPAIR) && c.a.merged && c.a.notes.includes('first'), `fixer: ${gateTail}`)
    const { a, all } = await go(ONE, { 'a implement': then({ sha: '', gateTail, notes: ['first'], sharedEdits: [ROW] }, {}) })
    assert(all['a implement'].length === 2 && all['a implement'][1].includes(REPAIR), gateTail)
    assert(a.merged && a.notes.includes('first'), gateTail)
    assert.deepEqual(a.sharedEdits, [ROW]) } })
await t('1k (control) the merge and the docs steps are not authors: theirs run once', async () => {
  const { ran, one } = await go(ONE, { 'a merge': () => ({ gateTail: 'merged' }) })
  assert.deepEqual([ran('a merge').length, ran('one docs').length, one.verdict], [1, 1, 'pass']) })

// ---- 2. the docs step sees the open doc minors ----
const M = F('V-F1', 'README.md:9', 'minor', 'docs')
const open = (...fs) => ({ 'one validate': () => ({ findings: fs }) })
const status = (one, id) => one.findings.find(e => e.id === id)?.status
await t('2a an open doc minor reaches the docs prompt and its validator, is verified and settled on the promoted pass', async () => {
  const { one, all, opts } = await go(ONE, { ...open(M), 'one docs validate': () => ({ verified: ['V-F1'], questions: [] }) })
  assert.deepEqual(holds(all, JSON.stringify([M])), ['one docs', 'one docs validate'])
  assert(/Fix each one that still holds by changing the doc, never code, and list it in notes as "fixed minor: <id>"; leave one you disagree with\./.test(all['one docs'][0]))
  assert(/Return in verified each id whose issue no longer holds at this head\./.test(all['one docs validate'][0]))
  assert(opts['one docs validate'].schema.required.includes('verified'))
  assert.deepEqual([one.verdict, one.open, status(one, 'V-F1')], ['pass', [], 'fixed']) })
const REFUTED = 'A line of this range that the code refutes is always a finding, never a question, whatever minor, limit or asked question names it.'
await t('2a2 a minor that still holds is no finding of its own, but a false line of the docs commit always is, whatever minor names it', async () => {
  const { one, prompts, ran } = await go(ONE, { ...open(M), 'one docs validate': p => ({ verdict: 'fail', verified: [], questions: [], findings: p.includes(REFUTED) && !/never re-file/.test(p) ? [F('D-F1', 'README.md:9', 'major', 'docs')] : [] }) })
  assert.deepEqual([ran('one docs fix').length, one.verdict, one.docs.fixRounds], [1, 'pass', 1])
  assert(/One that still holds stays off verified; it is not a finding by itself and does not fail the verdict\./.test(prompts['one docs validate'])) })
await t('2b a minor carried from a workstream\'s cycles and one left by a recheck are given too', async () => {
  const carried = { ...F('v1-F2', 'docs/guide.md:4', 'minor', 'docs') }
  const c = await go(ONE, { 'a validate c1': () => ({ open: [carried] }), 'one docs validate': () => ({ verified: ['a:v1-F2'] }) })
  assert.deepEqual([c.one.open, status(c.one, 'a:v1-F2')], [[], 'fixed'])
  const left = F('R1-F1', 'CHANGELOG.md:2', 'minor', 'docs')
  const r = await go(ONE, { ...wb, 'one recheck r1': () => ({ verified: ['V-F1'], findings: [left] }), 'one docs validate': () => ({ verified: ['R1-F1'] }) })
  assert(r.prompts['one docs'].includes(JSON.stringify([left])))
  assert.deepEqual([r.one.open, status(r.one, 'R1-F1')], [[], 'fixed']) })
await t('2c (control) only a validator settles it, and only on a promoted pass', async () => {
  const left = async (sc, what) => {
    const { one } = await go(ONE, { ...open(M), ...sc })
    assert.deepEqual([status(one, 'V-F1'), one.open.some(o => o.includes('README.md:9'))], ['open', true], what)
    return one
  }
  await left({ 'one docs': () => ({ notes: ['fixed minor: V-F1'] }), 'one docs validate': () => ({ verified: [] }) }, 'the docs agent\'s word')
  await left({ 'one docs': () => ({ sha: '', notes: ['fixed minor: V-F1'] }) }, 'nothing committed')
  assert.equal((await left({ 'one docs validate': () => ({ verified: ['V-F1'], verdict: 'fail', findings: [F('D-F9', 'README.md:2', 'minor')] }) }, 'a failed validation')).verdict, 'fail')
  assert.equal((await left({ 'one docs validate': () => ({ verified: ['V-F1'] }), 'one docs promote': () => ({ ok: false, sha: BASE, notes: ['f moved'] }) }, 'not promoted')).verdict, 'fail') })
await t('2d after a docs fix round the revalidation decides', async () => {
  const round = { 'one docs validate': () => ({ verdict: 'fail', verified: ['V-F1'], findings: [F('D-F1', 'README.md:12')] }) }
  const kept = await go(ONE, { ...open(M), ...round, 'one docs revalidate': () => ({ verified: ['V-F1'] }) })
  assert(kept.prompts['one docs revalidate'].includes(JSON.stringify([M])))
  assert.deepEqual([kept.one.verdict, status(kept.one, 'V-F1')], ['pass', 'fixed'])
  const lost = await go(ONE, { ...open(M), ...round, 'one docs revalidate': () => ({ verified: [] }) })
  assert.deepEqual([lost.one.verdict, status(lost.one, 'V-F1')], ['pass', 'open']) })
await t('2e only open minors in doc files that are not already a question for the user are given', async () => {
  const yes = ['README.md:9', 'pkg/README.he.md:1', 'docs/a.md:3', 'x/docs/b.txt:2-4', 'app/docs/v/c.RST:2', 'CHANGELOG.md:2', 'readme:5'].map((w, i) => F(`V-F${i}`, w, 'minor', 'docs'))
  const no = ['a/x.py:3', 'a/readme_parser.py:3', 'README.md', 'a/documents.py:1', 'app/docs/views.py:3', 'docs/conf.py:9'].map((w, i) => F(`V-N${i}`, w, 'minor'))
  const asked = F('V-Q', 'README.md:7', 'minor', 'docs'), mine = F('v1-Q', 'README.md:8', 'minor', 'docs')
  const { prompts, one } = await go(ONE, { 'a validate c1': () => ({ open: [mine], questions: [Q('v1-Q: shorten it?')] }), 'one validate': () => ({ findings: [...yes, ...no, asked], questions: [Q('V-Q: which wording?')] }),
    'one docs validate': () => ({ verified: ['V-N0', 'V-Q', 'a:v1-Q', 'V-F0'] }) })
  assert(prompts['one docs'].includes(JSON.stringify(yes)), prompts['one docs'])
  for (const f of [...no, asked, mine]) assert(!prompts['one docs'].includes(`"${f.id}"`), f.id)
  assert.deepEqual(['V-F0', 'V-F1', 'V-N0', 'V-Q', 'a:v1-Q'].map(id => status(one, id)), ['fixed', 'open', 'open', 'open', 'open']) })
await t('2f (control) no open doc minor and no shared edits: the docs steps get the very prompts and schema of a clean run', async () => {
  const bad = { 'one docs validate': () => ({ verdict: 'fail', findings: [F('D-F1', 'README.md:12')] }) }
  const clean = await go(ONE, bad), code = await go(ONE, { ...bad, ...open(F('V-F1', 'a/x.py:3', 'minor')) })
  for (const L of ['one docs', 'one docs validate', 'one docs fix', 'one docs revalidate']) {
    assert.equal(code.prompts[L], clean.prompts[L], L)
    assert(!/minor|shared-file edits|never extended|Already asked|questions/i.test(clean.prompts[L].replace(/minor hygiene finding|major; minor|minor = the rest/g, '')), L)
    assert.deepEqual(code.opts[L], clean.opts[L], L) }
  assert.deepEqual(clean.opts['one docs validate'].schema.required, ['verdict', 'sections', 'sha', 'tests', 'gate', 'findings']) })

// ---- 3. the docs step keeps to the plan ----
const RULE = 'a line they put in a file may be corrected where it is false, never otherwise extended or reworded'
const edited = { 'a implement': () => ({ sharedEdits: [ROW] }) }
const reworded = F('D-F1', 'README.md:9', 'major', 'docs')
// a validator that files the reworded row only when its prompt makes it a finding
const judge = p => /extends or rewords? such a line .* is always a finding: major, kind docs/.test(p) ? { verdict: 'fail', findings: [reworded] } : {}
await t('3a the merged shared edits are limits for the docs agent, the docs fixer and their validator, and for no one else', async () => {
  const { all, opts } = await go(ONE, { ...edited, 'one docs validate': judge })
  const L = ['one docs', 'one docs fix', 'one docs revalidate', 'one docs validate']
  assert.deepEqual(holds(all, RULE), L)
  for (const l of L) assert(all[l][0].includes(`${JSON.stringify([ROW])}`) && all[l][0].split(RULE).length === 2, l)
  assert.deepEqual(holds(all, 'What a limit bars: leave it and say so in notes.'), ['one docs', 'one docs fix'])
  assert(all['one docs fix'][0].includes(`goes back to what it is at ${BASE}, keeping only a correction of what was false there.`))
  assert(opts['one docs validate'].schema.required.includes('questions')) })
await t('3b a docs commit that reworded a merged row is filed, fixed in the one round and leaves nothing open', async () => {
  const { one, ran } = await go(ONE, { ...edited, 'one docs validate': judge })
  assert.deepEqual([ran('one docs fix').length, one.verdict, one.finalSha, one.open, one.docs.fixRounds], [1, 'pass', FIX, [], 1])
  const held = await go(ONE, { ...edited, 'one docs validate': judge, 'one docs revalidate': judge })
  assert.deepEqual([held.one.verdict, held.one.finalSha], ['fail', BASE], 'still reworded: never promoted') })
await t('3c every merged workstream of the repo counts, one the user dropped and one of another repo do not', async () => {
  const other = { file: 'CHANGELOG.md', intent: 'of another repo' }, b = { file: 'README.md', intent: 'row b' }
  const { prompts } = await go({ cycles: 1, dropped: ['c'], workstreams: [ws('a'), ws('b'), ws('c'), ws('d', { repo: '/r/two' })] },
    { ...edited, 'b implement': () => ({ sharedEdits: [b] }), 'd implement': () => ({ sharedEdits: [other] }), contracts: () => ({ verdict: 'pass', sections: 's', findings: [] }) }).catch(e => { throw new Error(e.message) })
  assert(prompts['one docs'].includes(JSON.stringify([ROW, b])) && !prompts['one docs'].includes(other.intent))
  assert(prompts['two docs'].includes(JSON.stringify([other])) && !prompts['two docs'].includes('row b')) })
await t('3d a resume keeps the limits of a workstream carried as merged', async () => {
  const two = { cycles: 1, workstreams: [ws('a'), ws('b')] }
  const first = await go(two, { ...edited, 'b implement': () => ({ status: 'failed', ok: false, sha: '' }) })
  assert.equal(first.one.verdict, 'incomplete')
  const cf = JSON.parse(JSON.stringify(first.r.carryForward))
  const second = await go({ ...two, resume: 'run-1', carryForward: cf }, { 'one state': () => ({ workstreams: [{ id: 'a', head: SHA(201), merged: true }] }) })
  assert(second.prompts['one docs'].includes(JSON.stringify([ROW])) && second.prompts['one docs'].includes(RULE))
  const third = await go({ ...two, resume: 'run-1', carryForward: JSON.parse(JSON.stringify(second.r.carryForward)) }, { 'one state': () => ({ workstreams: ['a', 'b'].map(id => ({ id, head: SHA(201), merged: true })) }) })
  assert(third.prompts['one docs'].includes(JSON.stringify([ROW])), 'and hands them on')
  await assert.rejects(go({ ...two, resume: 'run-1', carryForward: { workstreams: { a: { sharedEdits: 'x' } } } }), /sharedEdits must be an array/) })
await t('3d2 a re-merge after a human check adds to the limits, and the implement step that finds its branch merged keeps its own', async () => {
  const check = { cycles: 1, workstreams: [ws('a', { humanCheck: 'look at it' })] }, extra = { file: 'README.md', intent: 'row a2' }
  const first = await go(check, edited)
  const again = await go({ ...check, resume: 'run-1', carryForward: JSON.parse(JSON.stringify(first.r.carryForward)), humanChecks: { a: [{ sha: first.a.validatedSha, answer: 'wrong colour' }] } },
    { 'one state': () => ({ workstreams: [{ id: 'a', head: first.a.validatedSha, merged: true }] }), 'a fix c1': () => ({ sha: SHA(299), sharedEdits: [ROW, extra] }), 'a validate c1': () => ({ verified: ['H1-F1'] }) })
  assert.deepEqual(again.r.carryForward.workstreams.a.sharedEdits, [ROW, extra])
  const found2 = await go({ cycles: 1, workstreams: [ws('a')], resume: 'run-1', carryForward: { workstreams: { a: {} } } }, { 'a implement': () => ({ alreadyMerged: true, sharedEdits: [ROW] }) })
  assert(found2.prompts['one docs'].includes(JSON.stringify([ROW]))) })
await t('3e a docs finding only the user can settle reaches questions, not a minor under pass', async () => {
  const ask = Q('Extend the a row with the KeyError?')
  const { r, one, prompts, ran } = await go(ONE, { ...edited, 'one docs validate': p => /only the user can settle .* goes to questions, never to findings/.test(p) ? { questions: [ask], verified: [] } : { findings: [F('D-F1', 'README.md:9', 'minor', 'docs')] } })
  assert.deepEqual([one.verdict, one.open, one.questions, ran('one docs fix').length], ['pass', [], [ask], 0])
  assert.deepEqual(r.questions, [{ ...ask, q: `one: ${ask.q}` }])
  assert(/A docs change that extends or rewords such a line .* never a question/.test(prompts['one docs validate']))
  assert(prompts['one docs validate'].includes(REFUTED) && /goes to questions, never to findings, and does not fail the verdict: both options/.test(prompts['one docs validate'])) })
await t('3f the question channel is there for open doc minors alone too, and knows what was asked', async () => {
  const { prompts, opts } = await go(ONE, { 'one validate': () => ({ findings: [M], questions: [Q('Which licence?')] }), 'a implement': () => ({ questions: [Q('Round up?')] }) })
  assert(opts['one docs validate'].schema.required.includes('questions') && /goes to questions, never to findings/.test(prompts['one docs validate']))
  assert(prompts['one docs validate'].includes(`Already asked of the user, never re-ask: ${JSON.stringify(['Which licence?', 'Round up?'])}`) && !prompts['one docs validate'].includes(RULE)) })
await t('3g a question of the first docs validation survives the fix round and is not asked twice', async () => {
  const ask = Q('Extend the a row?')
  const { r, prompts } = await go(ONE, { ...edited, 'one docs validate': () => ({ verdict: 'fail', findings: [reworded], questions: [ask] }), 'one docs revalidate': () => ({ questions: [ask] }) })
  assert(prompts['one docs revalidate'].includes(`Already asked of the user, never re-ask: ${JSON.stringify([ask.q])}`))
  assert.deepEqual(r.questions.map(q => q.q), [`one: ${ask.q}`]) })
await t('3i (control) a question of a docs validator that saw another commit is not asked', async () => {
  const { r, one } = await go(ONE, { ...edited, 'one docs validate': () => ({ sha: SHA(77), questions: [Q('Extend?')] }) })
  assert.deepEqual([one.verdict, r.questions], ['fail', []])
  assert(one.findings.some(f => f.id === 'D-X')) })
await t('3h a docs round that fails still hands its question over', async () => {
  const { r, one } = await go(ONE, { ...edited, 'one docs validate': () => ({ verdict: 'fail', findings: [reworded], questions: [Q('Extend?')] }), 'one docs fix': () => ({ sha: '' }) })
  assert.deepEqual([one.verdict, r.questions.map(q => q.q)], ['fail', ['one: Extend?']]) })

if (fails.length) { console.error(fails.join('\n')); process.exit(1) }
console.log('zero-commit guard and docs-limit checks ok')
