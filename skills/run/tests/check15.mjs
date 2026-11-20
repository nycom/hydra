// Local-only remote, after-ordering, lite workstreams, copied git-excluded files, the shared-edits check,
// human checks that pause and resume the run, per-id escalation questions, and the progress-panel phase.
// Every scenario fails against the 0.3.7 script except the ones marked (control).
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
    throw new Error('unmocked ' + L)
  }
  return { agent, prompts, opts, all, order, merges, events }
}
const ws = (id, extra = {}) => ({ id, repo: '/r/one', featureBranch: 'f', branch: `f--${id}`, model: 'sonnet', brief: `brief ${id}`, gate: 'npm test', files: [`${id}/`], ...extra })
// a run that never settles (a hold nobody releases) fails instead of hanging the suite
const go = async (args, sc) => {
  const m = mock(args, sc)
  let timer
  const hung = new Promise((_, no) => { timer = setTimeout(() => no(new Error('the run hung')), 2000) })
  const r = await Promise.race([Run(args, m.agent, parallel, () => {}, free), hung]).finally(() => clearTimeout(timer))
  return { r, ...m }
}
const throwsOn = async (args, re) => { let e = null; try { await go(args, {}) } catch (x) { e = x } assert(e && re.test(e.message), `expected ${re}, got ${e?.message}`) }
const fails = []
const t = async (name, fn) => { try { await fn() } catch (e) { fails.push(`${name}: ${e.message.split('\n')[0]}`) } }
const idx = (order, L) => order.indexOf(L)
const dirtyB = { 'b review c1': () => ({ findings: [F('c1-F1')] }), 'b validate c1': () => ({ verified: ['c1-F1'] }) } // b merges after a

// B1. the progress panel's phase enum has no "hydra"
await t('B1 SKILL.md calls the progress panel with phase delegate while running and close at the end', async () => {
  const s = readFileSync(new URL('../SKILL.md', import.meta.url), 'utf8')
  assert(!/phase: "hydra"/.test(s) && /phase: "delegate"/.test(s) && /phase: "close"/.test(s)) })

// F1. local-only: every git step targets a local bare remote, and hygiene checks no network remote got a run branch
const twoRepos = extra => ({ cycles: 1, ...extra, workstreams: [ws('a'), ws('c', { repo: '/r/two' })], docsRepos: [{ repo: '/r/one', featureBranch: 'f' }, { repo: '/r/two', featureBranch: 'f' }, { repo: '/r/d', featureBranch: 'f' }] })
const busy = { 'a review c1': () => ({ findings: [F('c1-F1')] }), 'a validate c1': () => ({ verified: ['c1-F1'] }), 'one validate': () => ({ verdict: 'fail', findings: [F('V-F1')] }), 'one recheck r1': () => ({ verified: ['V-F1'] }), 'one docs': () => ({ sha: SHA(900) }) }
const RULE = /Local-only run: nothing may reach the network\. hydra-local is a bare repo on local disk and the only remote you may fetch from, push to or ls-remote; never fetch from or push to origin or any other remote, and run no gh command\./
await t('1a localOnly: no prompt names origin outside the rule, every prompt carries the rule, and the docs step skips gh', async () => {
  const { prompts, r } = await go(twoRepos({ localOnly: true }), busy)
  const { prompts: clean } = await go(twoRepos({ localOnly: true }), {}) // the clean-review validator
  prompts['a validate c1 (clean)'] = clean['a validate c1']
  const { prompts: seam } = await go({ localOnly: true, cycles: 1, workstreams: [ws('a'), ws('b')] }, {}) // the integrated review
  prompts['one review'] = seam['one review']
  for (const L of ['a implement', 'a review c1', 'a fix c1', 'a validate c1', 'a validate c1 (clean)', 'a merge', 'one review', 'one validate', 'one fix r1', 'one recheck r1', 'one promote', 'one docs', 'one docs validate', 'contracts', 'd docs']) {
    const p = prompts[L]
    assert(p, `${L} ran`)
    assert(RULE.test(p), `${L}: carries the local-only rule`)
    assert(!/\borigin\b/.test(p.replace(RULE, '')), `${L}: names origin: ${p.replace(RULE, '').match(/.{40}\borigin\b.{20}/)?.[0]}`)
    assert(/hydra-local/.test(p.replace(RULE, '')), `${L}: uses hydra-local`)
    assert(!/git fetch(?! hydra-local)/.test(p), `${L}: bare git fetch: ${p.match(/.{30}git fetch(?! hydra-local).{20}/)?.[0]}`)
  }
  assert(!/gh pr (view|edit)/.test(prompts['one docs']) && /Local-only run: no PR exists and gh never runs; skip this step\./.test(prompts['one docs']), 'no PR step')
  assert(r.repos.every(x => x.verdict === 'pass'), JSON.stringify(r.repos.map(x => x.escalations))) })
await t('1b localOnly hygiene: every hygiene section lists the repo\'s run branches on any remote but hydra-local', async () => {
  const { prompts } = await go(twoRepos({ localOnly: true }), busy)
  const want = "git -C /r/one for-each-ref --format='%(refname)' 'refs/remotes/*/f' 'refs/remotes/*/f--*' 'refs/remotes/*/f--a' 'refs/remotes/*/f--a--*' | grep -v '^refs/remotes/hydra-local/' must print nothing"
  for (const L of ['a merge', 'one validate', 'one recheck r1', 'one docs', 'one docs validate']) assert(prompts[L].includes(want), `${L}: ${prompts[L].match(/Local-only run: git[^\n]*/)?.[0]}`)
  assert(prompts['d docs'].includes("git -C /r/d for-each-ref --format='%(refname)' 'refs/remotes/*/f' 'refs/remotes/*/f--*' |"), 'docs-only repo') })
await t('1c (control) without localOnly nothing names hydra-local; a non-boolean throws', async () => {
  const { prompts } = await go(twoRepos({}), busy)
  assert(!Object.values(prompts).some(p => /hydra-local|for-each-ref|Local-only/.test(p)))
  await throwsOn(twoRepos({ localOnly: 'yes' }), /localOnly must be a boolean/) })

// F2. after: a workstream implements only once its predecessors merged, from the head that carries them
const chain = (extra = {}) => ({ cycles: 1, workstreams: [ws('a'), ws('b', { after: ['a'], ...extra }), ws('c')] })
await t('2a b after a implements only after a merged and checks a\'s merge is on the feature branch; c still runs in parallel', async () => {
  const { order, prompts, merges, r } = await go(chain(), {})
  assert(idx(order, 'b implement') > idx(order, 'a merge'), order.join())
  assert(idx(order, 'c implement') < idx(order, 'a merge'), 'c is not held back')
  const p = prompts['b implement']
  assert(p.includes(`ordered after a`) && p.includes(`git merge-base --is-ancestor <sha> origin/f for each of ${merges.a[0]}`), p.split('\n')[1])
  assert(r.workstreams.every(w => w.merged)) })
await t('2b a predecessor that does not merge leaves b not started, with an escalation', async () => {
  const { all, r } = await go(chain(), { 'a implement': () => ({ ok: false, status: 'blocked' }) })
  assert(!all['b implement'], 'b never started')
  const b = r.workstreams.find(w => w.id === 'b')
  assert(!b.merged && b.escalations.some(e => /ordered after a, which did not merge into f; NOT started/.test(e)), JSON.stringify(b.escalations))
  assert(r.workstreams.find(w => w.id === 'c').merged, 'c unaffected') })
await t('2c after is validated up front: unknown id, itself, a cycle, another repo', async () => {
  await throwsOn({ workstreams: [ws('a', { after: ['zz'] })] }, /after names unknown workstream zz/)
  await throwsOn({ workstreams: [ws('a', { after: ['a'] })] }, /after names itself/)
  await throwsOn({ workstreams: [ws('a', { after: ['c'] }), ws('b', { after: ['a'] }), ws('c', { after: ['b'] })] }, /after forms a cycle: a -> c -> b -> a/)
  await throwsOn({ workstreams: [ws('a'), ws('b', { repo: '/r/two', after: ['a'] })] }, /after a is in another repo/)
  await throwsOn({ workstreams: [ws('a', { after: [] })] }, /after must be a non-empty array/) })

// F3. lite: implement plus one validator; a blocker it files gets fix + delta validate, never a review
await t('3a a clean lite workstream runs implement, the clean-review validator and merge, with no review', async () => {
  const { all, prompts, r } = await go({ cycles: null, workstreams: [ws('a', { lite: true })] }, {})
  assert(!Object.keys(all).some(L => /^a review/.test(L)), Object.keys(all).join())
  const p = prompts['a validate c1']
  assert(/Lite workstream: no review runs, so you are its only independent check\./.test(p), 'told it is the only check')
  assert(p.includes(`origin/f...${SHA(1)}`) && /Test integrity:/.test(p) && /trial-merge origin\/f/.test(p) && /^0\. Before you read the diff/m.test(p), 'acceptance tests, full-range guard, gate, trial merge')
  assert(r.workstreams[0].merged && r.workstreams[0].cyclesRun === 1) })
await t('3b a lite validator blocker gets one fix and a delta validation, then merges with no review even in converge mode', async () => {
  const { all, r } = await go({ cycles: null, workstreams: [ws('a', { lite: true })] }, { 'a validate c1': (p, n) => n === 1 ? { open: [F('v1-F1')] } : { verified: ['v1-F1'] } })
  assert(all['a fix c1'] && all['a validate c1'].length === 2 && !Object.keys(all).some(L => /^a review/.test(L)), Object.keys(all).join())
  assert(r.workstreams[0].merged) })
await t('3c a blocker the delta validator keeps open gets the next fix + validate, still with no review', async () => {
  const { all, r } = await go({ cycles: null, workstreams: [ws('a', { lite: true })] }, {
    'a validate c1': (p, n) => n === 1 ? { open: [F('v1-F1')] } : { open: [F('v1-F1')] }, 'a validate c2': () => ({ verified: ['v1-F1'] }) })
  assert(all['a fix c2'] && all['a fix c2'][0].includes('"v1-F1"') && !Object.keys(all).some(L => /^a review/.test(L)), Object.keys(all).join())
  assert(r.workstreams[0].merged && r.workstreams[0].cyclesRun === 2, JSON.stringify(r.workstreams[0].escalations)) })
await t('3d (control) a non-lite workstream is still reviewed; lite must be a boolean', async () => {
  const { all } = await go({ cycles: 1, workstreams: [ws('a')] }, {})
  assert(all['a review c1'])
  await throwsOn({ workstreams: [ws('a', { lite: 'yes' })] }, /lite must be a boolean/) })

// F4. copyExcluded: git-excluded files reach every agent worktree before the gate and never a commit
const PREVIEW = 'tests/preview_test.py'
const copying = extra => ({ cycles: 1, ...extra, workstreams: [ws('a')], repos: [{ repo: '/r/one', copyExcluded: [PREVIEW] }] })
await t('4a every agent that creates a worktree copies the excluded paths after checking they are ignored; hygiene keeps them out', async () => {
  const { prompts } = await go(copying({}), busy)
  for (const L of ['a implement', 'a review c1', 'a fix c1', 'a validate c1', 'a merge', 'one validate', 'one fix r1', 'one recheck r1', 'one docs', 'one docs validate']) {
    const p = prompts[L]
    assert(p.includes(`copy these paths from the user's checkout /r/one to the same path in it (mkdir -p the parent, then cp -Rp): ${PREVIEW}.`), `${L}: copies`)
    assert(/before any gate or test/.test(p) && p.includes('git -C /r/one check-ignore -q <path> succeeds; otherwise copy nothing') && /Never commit them \(no git add -f\)/.test(p), `${L}: ignored-only, never committed`)
  }
  for (const L of ['a merge', 'one validate', 'one recheck r1', 'one docs', 'one docs validate']) assert(new RegExp(`Git-excluded copies stay out of every commit: git diff --name-only \\S+ -- '${PREVIEW}' must print nothing`).test(prompts[L]), `${L}: hygiene`) })
await t('4c the copyExcluded hygiene diff runs in the agent\'s worktree, never against the user\'s checkout HEAD', async () => {
  const { prompts } = await go(copying({}), busy)
  for (const L of ['a merge', 'one docs']) assert(/git diff --name-only origin\/f\.\.HEAD -- /.test(prompts[L]) && !/git -C \/r\/one diff --name-only/.test(prompts[L]), L) })
await t('4b copyExcluded refuses paths outside the repo; (control) none without the option', async () => {
  for (const p of ['/etc/passwd', '../x', 'a/../../b', '~/x', '', ' tests/x.py', 'tests/x.py '])
    await throwsOn({ workstreams: [ws('a')], repos: [{ repo: '/r/one', copyExcluded: [p] }] }, /copyExcluded must be an array of paths inside the repo/)
  const { prompts } = await go({ cycles: 1, workstreams: [ws('a')] }, {})
  assert(!Object.values(prompts).some(p => /Git-excluded/.test(p))) })

// F5. reviewSharedEdits: a gate and an opus validator on exactly the shared-edits commits, before the next merge
const EDITS = [{ file: 'README.md', intent: 'document --dry-run' }]
const sharing = (on = true) => ({ cycles: 1, workstreams: [ws('a'), ws('b')], repos: [{ repo: '/r/one', reviewSharedEdits: on }] })
await t('5a the shared-edits check runs between a\'s merge and the next merge, on a\'s shared-edits commits only', async () => {
  const { order, prompts, opts, merges } = await go(sharing(), { 'a implement': () => ({ sharedEdits: EDITS }), ...dirtyB })
  assert(idx(order, 'a merge') < idx(order, 'a shared check m1') && idx(order, 'a shared check m1') < idx(order, 'b merge'), order.join())
  const p = prompts['a shared check m1']
  assert(p.includes(`git log --first-parent --no-merges ${SHA(40)}..${merges.a[0]}`) && p.includes(JSON.stringify(EDITS)) && /npm test/.test(p), p.slice(0, 300))
  assert.equal(opts['a shared check m1'].agentType, 'validator'); assert.equal(opts['a shared check m1'].model, 'opus')
  assert(!order.includes('b shared check m1'), 'b had no shared edits') })
await t('5b its findings and a red gate go through the whole-branch fix path', async () => {
  const { prompts, r } = await go(sharing(), {
    'a implement': () => ({ sharedEdits: EDITS }), ...dirtyB,
    'a shared check m1': () => ({ verdict: 'fail', findings: [F('S-a-m1-F1', 'major', 'README.md:4')], gate: { ...green, green: false, summary: '1 failed' } }),
    'one recheck r1': () => ({ verified: ['S-a-m1-F1', 'S-a-m1-G'] }) })
  assert(prompts['one fix r1']?.includes('"S-a-m1-F1"') && prompts['one fix r1'].includes('"S-a-m1-G"'), 'fix round has them')
  const x = r.repos[0]
  assert.equal(x.verdict, 'pass', JSON.stringify(x.escalations))
  assert.equal(x.findings.find(e => e.id === 'S-a-m1-F1')?.stage, 'shared-edits') })
await t('5c a dead shared-edits validator is an unchecked critical, not a silent pass', async () => {
  const { prompts } = await go(sharing(), { 'a implement': () => ({ sharedEdits: EDITS }), 'a shared check m1': () => null, 'one recheck r1': () => ({ verified: ['S-a-m1-X'] }) })
  assert(/"S-a-m1-X"/.test(prompts['one fix r1'] || ''), 'reaches the fix round') })
await t('5d (control) off by default, and on with no shared edits it never runs', async () => {
  const { order } = await go(sharing(false), { 'a implement': () => ({ sharedEdits: EDITS }) })
  assert(!order.some(L => / shared check m\d+$/.test(L)))
  const { order: o2 } = await go(sharing(), {})
  assert(!o2.some(L => / shared check m\d+$/.test(L)))
  await throwsOn({ workstreams: [ws('a')], repos: [{ repo: '/r/one', reviewSharedEdits: 'yes' }] }, /reviewSharedEdits must be a boolean/) })

await t('5e a shared-edits validator that saw another sha leaves the range unchecked', async () => {
  const { prompts } = await go(sharing(), { 'a implement': () => ({ sharedEdits: EDITS }), 'a shared check m1': () => ({ sha: SHA(999) }), 'one recheck r1': () => ({ verified: ['S-a-m1-X'] }) })
  assert(/"S-a-m1-X"/.test(prompts['one fix r1'] || '') && /saw a{37}999/.test(prompts['one fix r1']), 'unchecked critical') })
await t('5f the next merge starts only after the shared-edits check finished, not just started', async () => {
  const { events } = await go(sharing(), { 'a implement': () => ({ sharedEdits: EDITS }), ...dirtyB, __delay: { 'a shared check m1': 30 } })
  assert(events.indexOf('end a shared check m1') >= 0 && events.indexOf('end a shared check m1') < events.indexOf('start b merge'), events.join()) })
await t('5g shared-check findings reach the result when the repo pauses or its whole-branch validator dies', async () => {
  const bad = { 'a implement': () => ({ sharedEdits: EDITS }), 'a shared check m1': () => ({ findings: [F('S-a-m1-F1', 'major', 'README.md:4')] }) }
  const { r: paused } = await go({ ...sharing(), workstreams: [ws('a', { humanCheck: 'look' }), ws('b')] }, { ...bad, ...dirtyB })
  assert(paused.repos[0].verdict === 'paused' && paused.repos[0].open.some(x => /README\.md:4/.test(x)) && paused.repos[0].findings.some(e => e.id === 'S-a-m1-F1'), JSON.stringify(paused.repos[0]))
  const { r: dead } = await go(sharing(), { ...bad, ...dirtyB, 'one validate': () => null })
  assert(dead.repos[0].verdict === 'fail' && dead.repos[0].open.some(x => /README\.md:4/.test(x)) && dead.repos[0].findings.some(e => e.id === 'S-a-m1-F1'), JSON.stringify(dead.repos[0])) })

await t('5h a re-merge after a human-check problem gets its own shared check: label and ids carry the merge round', async () => {
  const sc = { 'a implement': () => ({ sharedEdits: EDITS }), 'a fix c2': () => ({ sharedEdits: EDITS }), 'a validate c2': () => ({ verified: ['H1-F1'] }),
    'a shared check m1': () => ({ findings: [F('S-a-m1-F1', 'minor', 'README.md:1')] }), 'a shared check m2': () => ({ findings: [F('S-a-m2-F1', 'minor', 'README.md:2')] }) }
  const args = h => ({ cycles: 1, workstreams: [ws('a', { humanCheck: 'look' })], repos: [{ repo: '/r/one', reviewSharedEdits: true }], ...(h && { humanChecks: h }) })
  const S1 = (await go(args(), sc)).r.humanCheck[0].sha
  const { all, r } = await go(args({ a: { sha: S1, answer: 'grey' } }), sc)
  assert(all['a shared check m1']?.length === 1 && all['a shared check m2']?.length === 1 && /Ids: S-a-m2-F1/.test(all['a shared check m2'][0]), Object.keys(all).join())
  assert(['S-a-m1-F1', 'S-a-m2-F1'].every(id => r.repos[0].findings.some(e => e.id === id)), JSON.stringify(r.repos[0].findings)) })

// a merge whose sha a later step reads gets the malformed-sha repair; one nobody reads does not
await t('3m a malformed merge sha is repaired when reviewSharedEdits, humanCheck or after reads it', async () => {
  const bad = { 'a merge': (p, n) => n === 1 ? { sha: '' } : {} }
  const shared = await go(sharing(), { ...bad, 'a implement': () => ({ sharedEdits: EDITS }) })
  assert(shared.all['a merge'].length === 2 && /--no-merges [0-9a-f]{40}\.\.[0-9a-f]{40} /.test(shared.prompts['a shared check m1']), shared.prompts['a shared check m1']?.slice(0, 260))
  const held = await go({ cycles: 1, workstreams: [ws('a', { humanCheck: 'look' })] }, bad)
  assert(/^[0-9a-f]{40}$/.test(held.r.humanCheck?.[0]?.sha || ''), JSON.stringify(held.r.humanCheck))
  const after = await go({ cycles: 1, workstreams: [ws('a'), ws('b', { after: ['a'] })] }, bad)
  assert(/for each of [0-9a-f]{40}\)/.test(after.prompts['b implement']), after.prompts['b implement'].split('\n')[1])
  const plain = await go({ cycles: 1, workstreams: [ws('a')] }, bad)
  assert.equal(plain.all['a merge'].length, 1, '(control) nobody reads it: no repair call') })

// F6. humanCheck: the run pauses after the workstream merges; humanChecks answers continue it
const CHECK = 'open the preview and confirm the button is blue'
const human = answers => ({ cycles: 1, workstreams: [ws('a', { humanCheck: CHECK }), ws('b')], ...(answers && { humanChecks: answers }) })
const heldB = { ...dirtyB, 'a validate c2': () => ({ verified: ['H1-F1'] }) } // the fix of a's human-check problem holds
const A = (sha, answer) => ({ sha, answer })
const pausedAt = async (answers, sc) => (await go(human(answers), sc)).r.humanCheck?.[0]?.sha // the sha the next check asks about
await t('6a unanswered: a merges, b is held before its merge, the whole-branch pass, contracts and docs wait, and the result asks', async () => {
  const { r, order, merges } = await go(human(), dirtyB)
  const a = r.workstreams.find(w => w.id === 'a'), b = r.workstreams.find(w => w.id === 'b')
  assert(a.merged && !b.merged && !order.includes('b merge'), order.join())
  assert(b.escalations.some(e => /awaiting the user's human check 1 of a/.test(e)), JSON.stringify(b.escalations))
  assert(!order.includes('one validate') && !order.includes('one docs'), 'no whole-branch pass, no docs')
  assert.equal(r.repos[0].verdict, 'paused')
  assert.equal(r.humanCheck?.length, 1)
  const h = r.humanCheck[0]
  assert(h.id === 'a' && h.sha === merges.a[0] && h.featureBranch === 'f' && h.check === CHECK && h.round === 1 && /resumeFromRunId/.test(h.answer), JSON.stringify(h))
  assert(h.answer.includes(`humanChecks.a = [{"sha":"${merges.a[0]}","answer":"<ok, or the problem in words>"}]`), h.answer) })
await t('6b (control: 0.3.7 ignores humanCheck) "ok" on the checked sha: b merges after a, the whole-branch pass runs, no humanCheck block', async () => {
  const S1 = await pausedAt(undefined, dirtyB)
  for (const ok of ['ok', 'OK.', ' Ok! ']) {
    const { r, order } = await go(human({ a: A(S1, ok) }), dirtyB)
    assert(r.workstreams.every(w => w.merged) && idx(order, 'a merge') < idx(order, 'b merge') && order.includes('one validate'), `${ok}: ${order.join()}`)
    assert(r.repos[0].verdict === 'pass' && !('humanCheck' in r), ok)
  } })
await t('6c a problem becomes a critical for a\'s fix path; b stays held until a re-merges and is checked again', async () => {
  const S1 = await pausedAt(undefined, heldB)
  const { r, order, all, merges } = await go({ ...human({ a: A(S1, 'the button is grey') }), repos: [{ repo: '/r/one', reviewSharedEdits: false }] }, { ...heldB, 'a implement': () => ({ sharedEdits: EDITS }), 'a fix c2': () => ({ sharedEdits: EDITS }) })
  const fixL = Object.keys(all).find(L => /^a fix c/.test(L))
  assert(fixL && all[fixL][0].includes('"H1-F1"') && all[fixL][0].includes('reports: the button is grey') && all[fixL][0].includes(CHECK), fixL)
  assert.equal(all['a merge'].length, 2, 'a merged again after the fix')
  assert(!/this workstream merged before/.test(all['a merge'][0]) && /this workstream merged before: skip an edit the branch already carries/.test(all['a merge'][1]), 're-merge is told')
  assert(!order.includes('b merge'), 'b still held: check 2 is pending')
  const h = r.humanCheck?.[0]
  assert(h && h.round === 2 && h.sha === merges.a[1] && h.answer.includes(`humanChecks.a = [{"sha":"${S1}","answer":"the button is grey"},{"sha":"${merges.a[1]}","answer":"<ok, or the problem in words>"}]`), JSON.stringify(r.humanCheck))
  assert(r.workstreams.find(w => w.id === 'a').findings.some(e => e.id === 'H1-F1' && e.stage === 'human')) })
await t('6d (control: 0.3.7 ignores humanCheck) problem then ok: a re-merges, b merges after it, the repo passes', async () => {
  const S1 = await pausedAt(undefined, heldB), S2 = await pausedAt({ a: A(S1, 'the button is grey') }, heldB)
  const { r, order } = await go(human({ a: [A(S1, 'the button is grey'), A(S2, 'ok')] }), heldB)
  const second = order.lastIndexOf('a merge')
  assert(idx(order, 'b merge') > second && r.workstreams.every(w => w.merged) && r.repos[0].verdict === 'pass', order.join())
  assert(!('humanCheck' in r)) })
await t('6e a problem whose fix cannot merge releases b as stopped and keeps the escalation honest', async () => {
  const S1 = await pausedAt(undefined, dirtyB)
  const { r, order } = await go({ ...human({ a: A(S1, 'the button is grey') }), maxCycles: 1 }, dirtyB)
  const a = r.workstreams.find(w => w.id === 'a'), b = r.workstreams.find(w => w.id === 'b')
  assert(a.merged && a.escalations.some(e => /the fix NOT merged \(its earlier merge is on f\)/.test(e)), JSON.stringify(a.escalations))
  assert(!b.merged && b.escalations.some(e => /a stopped before its human check passed/.test(e)) && !order.includes('b merge'), JSON.stringify(b.escalations))
  assert.equal(r.repos[0].verdict, 'paused') })
await t('6f (control) answering does not change any earlier prompt, so a resume replays everything up to the check', async () => {
  const paused = await go(human(), dirtyB), ok = await go(human({ a: A(paused.r.humanCheck[0].sha, 'ok') }), dirtyB)
  for (const [L, ps] of Object.entries(paused.all)) assert.deepEqual(ok.all[L]?.slice(0, ps.length), ps, `${L} differs`) })
await t('6h an answer for another sha is not applied: a cache miss that merged a new commit pauses again on the new sha', async () => {
  const { r, order, merges } = await go(human({ a: A(SHA(777), 'ok') }), dirtyB)
  assert(!order.includes('b merge') && r.repos[0].verdict === 'paused', order.join())
  assert(r.humanCheck?.[0]?.sha === merges.a[0] && r.humanCheck[0].round === 1, JSON.stringify(r.humanCheck)) })
await t('6i a crash while holding releases the held merges instead of hanging the run', async () => {
  const S1 = await pausedAt(undefined, dirtyB)
  const { r, order } = await go(human({ a: A(S1, 'the button is grey') }), { ...dirtyB, 'a fix c2': () => { throw new Error('boom') } })
  const b = r.workstreams.find(w => w.id === 'b')
  assert(!b.merged && b.escalations.some(e => /a crashed/.test(e)) && !order.includes('b merge'), JSON.stringify(b.escalations))
  assert.equal(r.repos[0].verdict, 'paused') })
await t('6j a paused repo holds the cross-repo contract check too', async () => {
  const { r, order } = await go({ cycles: 1, workstreams: [ws('a', { humanCheck: CHECK }), ws('c', { repo: '/r/two' })] }, {})
  assert(r.repos.find(x => x.repo === '/r/two').verdict === 'pass' && !order.includes('contracts') && r.crossRepo === null, order.join()) })
await t('6g humanCheck and humanChecks are validated; (control) none set returns no humanCheck', async () => {
  await throwsOn({ workstreams: [ws('a', { humanCheck: ' ' })] }, /humanCheck must be non-empty instructions/)
  await throwsOn({ workstreams: [ws('a')], humanChecks: { a: A(SHA(1), 'ok') } }, /humanChecks\.a: no workstream a with a humanCheck/)
  for (const bad of [[], 'ok', { sha: 'xyz', answer: 'ok' }, { sha: SHA(1), answer: ' ' }, [A(SHA(1), 'ok'), 'ok']])
    await throwsOn({ workstreams: [ws('a', { humanCheck: CHECK })], humanChecks: { a: bad } }, /humanChecks\.a: \{sha, answer\}/)
  const { r } = await go({ cycles: 1, workstreams: [ws('a')] }, {})
  assert(!('humanCheck' in r)) })

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

await t('M1c a question names an id only when it starts with it: mid-sentence mentions and c1-F10 do not cover c1-F1', async () => {
  for (const q of ['keep c1-F1 or change the brief?', 'c1-F10: keep or change?', 'c1-F1x: keep?']) {
    const { r } = await go(two, escalate([Q(q)], ['c1-F1', 'c1-F2']))
    assert(r.questions.some(x => x.q.startsWith('a: c1-F1 (a/x.py:9')), `${q}: ${JSON.stringify(r.questions.map(x => x.q))}`)
  }
  for (const q of ['c1-F1: keep or change?', '"c1-F1" keep?', '- c1-F1, keep?']) {
    const { r } = await go(two, escalate([Q(q)], ['c1-F1', 'c1-F2']))
    assert(!r.questions.some(x => x.q.startsWith('a: c1-F1 (')), `${q} covers it`)
  } })
if (fails.length) { console.error(fails.join('\n')); process.exit(1) }
console.log('local-only, after, lite, copyExcluded, shared-edits check, human-check and escalation-question checks ok')
