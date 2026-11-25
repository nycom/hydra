// Typed checks: checkExits in the schema, a red check folded into the gate, known-red checks, the unrun guard, false greens, the merged tip.
// Every scenario fails against the 0.3.10 script except the ones marked (control).
import { Run } from './run.mjs'
import assert from 'node:assert'
import { skillText } from './skill-text.mjs'
const SHA = n => (n + '').padStart(40, 'a')
const parallel = fs => Promise.all(fs.map(f => f().catch(() => null)))
const free = { total: null, spent: () => 0, remaining: () => Infinity }
const push = { status: 'done', ok: true, tests: 't', gateTail: 'gate exit=0', sharedEdits: [], decisions: [], questions: [], notes: [] }
const green = { green: true, summary: '12 passed', command: 'npm test', flaky: [] }
const F = (id, severity = 'major', where = 'x.py:3') => ({ id, severity, kind: 'bug', where, issue: `issue ${id}`, evidence: 'test t1 red' })
// every agent whose schema asks for checkExits reports all green unless the scenario says otherwise
const exits = o => { const n = o.schema?.properties?.checkExits?.minItems; return n ? { checkExits: Array(n).fill(0) } : {} }
function mock(args, sc = {}) {
  const all = {}, opts = {}
  const head = {}
  let n = 0
  const repoOf = L => { const w = args.workstreams.find(w => L.startsWith(`${w.id} `)); return w ? w.repo : `/r/${L.split(' ')[0]}` }
  const agent = async (p, o) => {
    const L = o.label.replace(/ attempt \d$/, '')
    ;(all[L] ||= []).push(p); (opts[L] ||= []).push(o)
    const id = L.split(' ')[0]
    const repo = repoOf(L)
    const own = { ...exits(o), ...sc[L]?.(p, all[L].length) }
    if (L.startsWith('health ')) return { ok: true, notes: 'git version 2', ...own }
    if (L.endsWith('implement')) return (head[id] = SHA(id.charCodeAt(0)), { ...push, sha: head[id], ...own })
    if (/fix c(\d)/.test(L)) { const r = { ...push, sha: SHA(200 + ++n), answers: [], ...own }; head[id] = r.sha; return r }
    if (/review c\d/.test(L)) return { headSha: head[id], findings: [], ...own }
    if (/validate c\d/.test(L)) return { headSha: head[id], gate: green, evidence: 'e', verified: [], open: [], questions: [], ...own }
    if (L.endsWith('merge')) { const pre = head[repo] || SHA(40); head[repo] = SHA(500 + ++n); return { ...push, sha: head[repo], preMergeSha: pre, baseAtMerge: SHA(40), ...own } }
    if (L.endsWith(' review')) return { headSha: head[repo] || SHA(4000), findings: [], seams: 'none', ...own }
    if (L.endsWith(' docs validate')) return { verdict: 'pass', sections: 's', sha: SHA(900), tests: 't', gate: green, findings: [], ...own }
    if (L.endsWith(' validate')) return { verdict: 'pass', sections: 's', sha: head[repo] || SHA(4000), tests: 't', gate: green, findings: [], verified: [], questions: [], ...own }
    if (/fix r(\d)/.test(L)) { const r = { ...push, sha: SHA(70 + +L.at(-1)), answers: [], ...own }; head[repo] = r.sha; return r }
    if (/recheck r\d/.test(L)) return { verdict: 'pass', sections: 's', sha: head[repo], tests: 't', gate: green, findings: [], verified: [], questions: [], ...own }
    if (L.endsWith(' docs')) return { baseSha: head[repo] || SHA(4000), sha: '', files: [], prBody: false, ok: true, tests: 't', notes: [], ...own }
    if (L.endsWith(' promote')) return { ok: true, sha: (p.match(/ to ([0-9a-f]{40})\./) || [])[1], notes: [], ...own }
    throw new Error('unmocked ' + L)
  }
  return { agent, all, opts }
}
const ws = (id, extra = {}) => ({ id, repo: '/r/one', featureBranch: 'f', branch: `f--${id}`, model: 'sonnet', brief: `brief ${id}`, gate: 'npm test', files: [`${id}/`], ...extra })
const go = async (args, sc) => {
  const m = mock(args, sc)
  let timer
  const hung = new Promise((_, no) => { timer = setTimeout(() => no(new Error('the run hung')), 2000) })
  const r = await Promise.race([Run({ skillDir: '/s', ...args }, m.agent, parallel, () => {}, free), hung]).finally(() => clearTimeout(timer))
  return { r, ...m }
}
const fails = []
const t = async (name, fn) => { try { await fn() } catch (e) { fails.push(`${name}: ${e.message.split('\n')[0]}`) } }
const W = (r, id) => r.workstreams.find(w => w.id === id)
const E2E = 'npm run e2e'
const runs = (p, cmd) => p.split('\n').filter(l => l.includes('run-cmd.mjs') && l.endsWith(`540 '${cmd}'`)).length
// review c1 clean, the clean-review validator opens v1-F1, the fix and its delta validator close it
const twoShapes = { 'a validate c1': (p, k) => k === 1 ? { open: [F('v1-F1')] } : { verified: ['v1-F1'] } }

await t('T1a schema and prompt carry checkExits in every step that runs checks', async () => {
  const { r, all, opts } = await go({ cycles: 1, workstreams: [ws('a', { checks: [E2E] })] }, twoShapes)
  assert(W(r, 'a').merged, JSON.stringify(W(r, 'a').escalations))
  assert.equal(all['a validate c1'].length, 2, 'both validator shapes ran')
  for (const L of ['a implement', 'a fix c1', 'a validate c1'])
    for (const [i, o] of opts[L].entries()) {
      assert(o.schema.properties.checkExits && o.schema.required.includes('checkExits'), `${L} #${i + 1}: schema`)
      assert(all[L][i].includes('checkExits'), `${L} #${i + 1}: prompt`)
    }
})
await t('T1a control: without checks no schema has checkExits and no prompt names it', async () => {
  const { all, opts } = await go({ cycles: 1, workstreams: [ws('a')] }, { ...twoShapes, 'one validate': (p, k) => k > 1 ? {} : { verdict: 'fail', findings: [F('V-F1')] }, 'one recheck r1': () => ({ verified: ['V-F1'] }) })
  assert('one recheck r1' in all, 'recheck ran')
  for (const [L, os] of Object.entries(opts)) os.forEach((o, i) => {
    assert(!o.schema?.properties?.checkExits, `${L}: schema`)
    assert(!all[L][i].includes('checkExits'), `${L}: prompt`)
  })
})

await t('T1b a red check with a green gate is a critical v1-G; still red at the cap, NOT merged', async () => {
  const { r, all } = await go({ cycles: 1, maxCycles: 1, workstreams: [ws('a', { checks: [E2E] })] }, { 'a validate c1': () => ({ checkExits: [1] }) })
  const x = W(r, 'a')
  const g = x.findings.find(f => f.id === 'v1-G')
  assert(g && g.severity === 'critical' && g.issue.includes(`red check(s): ${E2E} exit 1`), JSON.stringify(x.findings))
  assert('a fix c1' in all && all['a fix c1'][0].includes('v1-G'), 'the fix gets the red check')
  assert(!x.merged && !('a merge' in all), JSON.stringify(x.escalations))
})
await t('T1b timeout: exit 124 is red', async () => {
  const { r } = await go({ cycles: 1, maxCycles: 1, workstreams: [ws('a', { checks: [E2E] })] }, { 'a validate c1': () => ({ checkExits: [124] }) })
  assert(!W(r, 'a').merged && W(r, 'a').findings.some(f => f.id === 'v1-G' && f.issue.includes('exit 124')))
})

await t('T1c a known-red check is no finding and merges', async () => {
  const { r, all } = await go({ cycles: 1, maxCycles: 1, workstreams: [ws('a', { checks: [E2E, 'true'], knownRedChecks: [E2E] })] }, { 'a validate c1': () => ({ checkExits: [1, 0] }) })
  assert(W(r, 'a').merged && !W(r, 'a').findings.some(f => f.id === 'v1-G'), JSON.stringify(W(r, 'a')))
  assert(all['a implement'][0].includes(`Known-red checks (red at the base; report the exit, never a finding): ${JSON.stringify([E2E])}`), 'known-red listed')
  assert(all['a implement'][0].includes('never pushes with one red that is not known-red'), 'author rule')
})
await t('T1c knownRedChecks must name entries of checks', async () => {
  for (const w of [ws('a', { checks: [E2E], knownRedChecks: ['nope'] }), ws('a', { knownRedChecks: [E2E] }), ws('a', { checks: [E2E], knownRedChecks: [] }), ws('a', { checks: [E2E], knownRedChecks: E2E })])
    await assert.rejects(go({ workstreams: [w] }), /knownRedChecks/)
})

await t('T1d malformed checkExits is an unrun attempt, retried; three times never ran its gate', async () => {
  for (const bad of [undefined, [], [0], ['0', 0], [0.5, 0]]) {
    const { r, all } = await go({ cycles: 1, workstreams: [ws('a', { checks: [E2E, 'true'] })] }, { 'a validate c1': () => ({ checkExits: bad }) })
    const x = W(r, 'a')
    assert.equal(all['a validate c1'].length, 3, `${JSON.stringify(bad)}: three attempts`)
    assert(all['a validate c1'][1].includes('the previous attempt returned without running the gate or every check;'), `${JSON.stringify(bad)}: unrun tail`)
    assert(!x.merged && x.escalations.some(e => /never ran its gate/.test(e)), `${JSON.stringify(bad)}: ${JSON.stringify(x.escalations)}`)
  }
})
await t('T1d control: a well-formed checkExits on the second attempt is kept', async () => {
  const { r, all } = await go({ cycles: 1, workstreams: [ws('a', { checks: [E2E, 'true'] })] }, { 'a validate c1': (p, k) => k === 1 ? { checkExits: [0] } : {} })
  assert(W(r, 'a').merged && all['a validate c1'].length === 2)
})

await t('T1e false green: the fixer reported 0, the validator of the same head reports red', async () => {
  const sc = fixer => ({ 'a review c1': () => ({ findings: [F('c1-F1')] }), 'a fix c1': () => ({ checkExits: [fixer] }), 'a validate c1': () => ({ verified: ['c1-F1'], checkExits: [2] }) })
  const { r } = await go({ cycles: 1, maxCycles: 1, workstreams: [ws('a', { checks: [E2E] })] }, sc(0))
  const g = W(r, 'a').findings.find(f => f.id === 'v1-G')
  assert(g && g.severity === 'critical' && g.issue.includes(`${E2E} exit 2 (false green: its author reported exit 0)`), JSON.stringify(W(r, 'a').findings))
  // (control) the fixer reported the same red: still critical, no false-green label
  const c = await go({ cycles: 1, maxCycles: 1, workstreams: [ws('a', { checks: [E2E] })] }, sc(2))
  const h = W(c.r, 'a').findings.find(f => f.id === 'v1-G')
  assert(h && h.severity === 'critical' && !h.issue.includes('false green'), JSON.stringify(W(c.r, 'a').findings))
  // the implementer is the author when the validator runs straight after it
  const i = await go({ cycles: 1, maxCycles: 1, workstreams: [ws('a', { checks: [E2E] })] }, { 'a validate c1': (p, k) => k === 1 ? { checkExits: [3] } : {} })
  assert(W(i.r, 'a').findings.some(f => f.id === 'v1-G' && f.issue.includes(`${E2E} exit 3 (false green: its author reported exit 0)`)), JSON.stringify(W(i.r, 'a').findings))
})

const tip = [ws('a', { checks: ['shared', 'own-a'] }), ws('b', { checks: ['shared', 'own-b'] })]
await t('T1f the whole-branch validator and each recheck run the union of the merged checks once each', async () => {
  const { all, opts } = await go({ cycles: 1, workstreams: tip }, { 'one validate': () => ({ verdict: 'fail', findings: [F('V-F1')] }), 'one recheck r1': () => ({ verified: ['V-F1'] }) })
  for (const L of ['one validate', 'one recheck r1']) {
    for (const c of ['shared', 'own-a', 'own-b']) assert.equal(runs(all[L][0], c), 1, `${L}: ${c}`)
    assert.equal(opts[L][0].schema.properties.checkExits.minItems, 3, `${L}: schema`)
  }
  assert(!all['one fix r1'][0].includes('run-cmd.mjs'), 'the whole-branch fixer gets no checks')
})
await t('T1f a red check on the merged tip is a critical V-G for the whole-branch fixer', async () => {
  const { r, all } = await go({ cycles: 1, workstreams: tip }, { 'one validate': () => ({ checkExits: [0, 1, 0] }) })
  assert(all['one fix r1'][0].includes('"id":"V-G"') && all['one fix r1'][0].includes('red check(s): own-a exit 1'), 'V-G to the fixer')
  assert(r.repos[0].findings.some(f => f.id === 'V-G' && f.severity === 'critical'))
})
await t('T1f a red check in a recheck is a critical R1-G and fails the repo', async () => {
  const { r } = await go({ cycles: 1, wbRounds: 1, workstreams: tip }, { 'one validate': () => ({ verdict: 'fail', findings: [F('V-F1')] }), 'one recheck r1': () => ({ verified: ['V-F1'], checkExits: [0, 0, 5] }) })
  assert(r.repos[0].verdict === 'fail' && r.repos[0].findings.some(f => f.id === 'R1-G' && f.severity === 'critical' && f.issue.includes('red check(s): own-b exit 5')), JSON.stringify(r.repos[0].findings)) })
await t('T1f known-red on the tip is the union, and a dropped workstream adds no check', async () => {
  const { r, all } = await go({ cycles: 1, workstreams: [ws('a', { checks: ['shared'], knownRedChecks: ['shared'] }), ws('b', { checks: ['shared', 'own-b'] })] }, { 'one validate': () => ({ checkExits: [1, 0] }) })
  assert(r.repos[0].verdict === 'pass' && !('one fix r1' in all), JSON.stringify(r.repos[0].findings))
  assert(all['one validate'][0].includes(`Known-red checks (red at the base; report the exit, never a finding): ${JSON.stringify(['shared'])}`))
  const d = await go({ cycles: 1, dropped: ['b'], workstreams: tip })
  assert(runs(d.all['one validate'][0], 'shared') === 1 && runs(d.all['one validate'][0], 'own-b') === 0, 'dropped b')
})
await t('T1f stage wholeBranch runs every passed workstream\'s checks', async () => {
  const { all } = await go({ stage: 'wholeBranch', workstreams: tip })
  for (const c of ['shared', 'own-a', 'own-b']) assert.equal(runs(all['one validate'][0], c), 1, c)
})

await t('T1g controls: the merge and the docs steps carry no checks', async () => {
  const { all, opts } = await go({ cycles: 1, workstreams: [ws('a', { checks: [E2E] })] }, { 'one docs': () => ({ sha: SHA(900), files: ['README.md'] }) })
  for (const L of ['a merge', 'one docs', 'one docs validate']) {
    assert(L in all, `${L} ran`)
    assert(!all[L][0].includes('checkExits') && !all[L][0].includes(E2E) && !opts[L][0].schema.properties.checkExits, L)
  }
})

await t('T1h a red check is never rerun', async () => {
  const { all } = await go({ cycles: 1, workstreams: [ws('a', { checks: [E2E] })] })
  for (const L of ['a implement', 'a validate c1', 'one validate']) assert(all[L][0].includes('A red check is a critical finding and is never rerun'), L)
})

await t('T1 docs: SKILL.md has the knownRedChecks row and the coordinator re-run', async () => {
  const s = skillText
  assert(/^\| `workstreams\[\]\.knownRedChecks` \| none \|/m.test(s), 'args row')
  assert(s.includes("run each merged workstream's `checks` once yourself at `finalSha`"), 'final-call re-run')
})

if (fails.length) { console.error(fails.join('\n')); process.exit(1) }
console.log('check21 ok')
