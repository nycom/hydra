// Progress: every agent label keeps the shapes a progress mod matches, the coordinator's progress calls, and the opt-in step-report text.
// Every scenario fails against the 0.3.10 script except the ones marked (control) and the pins B1a-e and B4d.
import { Run } from './run.mjs'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
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
    const given = sc[L]?.(p, all[L].length)
    if (given === null) return null
    const own = { ...exits(o), ...given }
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
    if (/ shared check m\d$/.test(L)) return { verdict: 'pass', sections: 's', sha: head[repo], tests: 't', gate: green, findings: [], ...own }
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
const sk = readFileSync(new URL('../SKILL.md', import.meta.url), 'utf8')
const norm = s => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// two repos, ids with - _ . and capitals, a fix cycle, a shared-edits check, a whole-branch fix round, docs, a dead agent
const IDS = ['Api_v2.x', 'b-two', 'c.3']
const rich = () => ({ cycles: 2, workstreams: [ws(IDS[0]), ws(IDS[1]), ws(IDS[2], { repo: '/r/two' })], repos: [{ repo: '/r/one', reviewSharedEdits: true }],
  docsRepos: [{ repo: '/r/one', featureBranch: 'f' }, { repo: '/r/two', featureBranch: 'f' }] })
const richSc = {
  'Api_v2.x implement': (p, k) => k < 3 ? null : { sharedEdits: [{ file: 'README.md', intent: 'x' }] },
  'b-two review c1': () => ({ findings: [F('c1-F1')] }),
  'b-two validate c1': () => ({ verified: ['c1-F1'] }),
  'one review': () => ({ findings: [{ ...F('W-F1'), where: 'seam.py:1' }], seams: 's' }),
  'one recheck r1': () => ({ verified: ['W-F1'] }),
  'one docs': () => ({ sha: SHA(90) }),
}
const labels = async () => { const { r, opts } = await go(rich(), richSc); return { r, labels: Object.keys(opts) } }

await t('B1a task labels keep their exact shapes', async () => {
  const { labels: L } = await labels()
  for (const need of ['implement', 'review c1', 'fix c1', 'validate c1', 'merge', 'shared check m1']) assert(L.some(l => l.endsWith(` ${need}`) && IDS.some(i => l.startsWith(i + ' '))), `no ${need} label`)
  const seen = L.filter(l => IDS.some(i => norm(l).startsWith(norm(i) + ' ')))
  assert(seen.length >= 8, `only ${seen.length} task labels`)
  for (const l of seen) {
    const id = IDS.find(i => norm(l).startsWith(norm(i) + ' '))
    const stage = norm(l).slice(norm(id).length + 1).split(' ')[0]
    assert(['implement', 'review', 'fix', 'validate', 'merge', 'shared'].includes(stage), `${l}: stage word ${stage}`)
    assert(new RegExp(`^${esc(id)} (implement|(review|fix|validate) c\\d+|merge|shared check m\\d+)( attempt [23])?$`).test(l), `${l}: shape`)
  }
})
await t('B1b every merged workstream has an "<id> merge" label; no other label has merge as a word', async () => {
  const { r, labels: L } = await labels()
  for (const w of r.workstreams) { assert(w.merged, `${w.id} merged`); assert(L.includes(`${w.id} merge`), `${w.id} merge label`) }
  for (const l of L.filter(l => !IDS.some(i => l.startsWith(i + ' ')))) assert(!norm(l).split(' ').includes('merge'), l)
})
await t('B1c only the docs agent label ends in docs', async () => {
  const { labels: L } = await labels()
  assert.deepEqual(L.filter(l => norm(l).endsWith(' docs')).sort(), ['one docs', 'two docs'])
  assert(L.includes('one docs validate') || L.includes('one docs promote'), 'a docs sub-step ran')
})
await t('B1d a task titled with the id matches every workstream label', async () => {
  const { labels: L } = await labels()
  for (const l of L.filter(l => IDS.some(i => l.startsWith(i + ' ')))) assert(IDS.some(i => norm(l).startsWith(norm(i) + ' ')), l)
})
await t('B1e no repo-level label is claimed by a task title', async () => {
  const { labels: L } = await labels()
  for (const l of L.filter(l => !IDS.some(i => l.startsWith(i + ' ')))) assert(!IDS.some(i => norm(l) === norm(i) || norm(l).startsWith(norm(i) + ' ')), l)
})

await t('B2 SKILL.md: a progress call after every return, enum phases only, the dropped total', async () => {
  const phases = [...sk.matchAll(/phase: "(\w+)"/g)].map(m => m[1])
  assert(phases.includes('review'), 'review phase')
  for (const p of phases) assert(['plan', 'design', 'delegate', 'review', 'close'].includes(p), p)
  assert(sk.includes('after every Workflow return'), 'every return')
  assert(/dropped[^.]*`total`|`total`[^.]*dropped/.test(sk), 'dropped total')
})
await t('B5 SKILL.md: questions go through AskUserQuestion in the final call and the human checks', async () => {
  const fin = sk.slice(sk.indexOf('## 4. Final call'), sk.indexOf('## 5. Finish'))
  assert(fin.includes('AskUserQuestion'), 'final call')
  const hc = sk.slice(sk.indexOf('**Human checks**'), sk.indexOf('**Whole-branch pass only'))
  assert(hc.includes('AskUserQuestion'), 'human checks')
  assert(sk.includes('stepTool'), 'stepTool documented')
})

const TAIL = 'Progress: report your steps with the x__step tool'
await t('B4a stepTool: every prompt but the health probe ends with the step-report paragraph', async () => {
  const { all, r } = await go({ ...rich(), stepTool: 'x__step' }, richSc)
  assert(r.workstreams.every(w => w.merged))
  for (const [L, ps] of Object.entries(all)) for (const p of ps) {
    if (L.startsWith('health ')) assert(!p.includes('Progress: report'), L)
    else { assert(p.includes(TAIL), `${L}: tool named`); assert(p.includes('Send failed: true, with reason and error, only when your own attempt at this step failed.'), `${L}: failed rule`); assert(/Findings you report, and a red gate or check you were asked to run, are results, not failures\.$/.test(p), `${L}: ends with it`) }
  }
  assert(Object.keys(all).some(L => L.startsWith('health ')), 'a health probe ran')
})
await t('B4b control: unset, no prompt carries the paragraph', async () => {
  const { all } = await go(rich(), richSc)
  for (const [L, ps] of Object.entries(all)) for (const p of ps) assert(!p.includes('Progress: report your steps'), L)
})
await t('B4c a tool name with a space throws', async () => {
  await assert.rejects(go({ ...rich(), stepTool: 'a b' }, richSc), /stepTool/)
})
await t('B4d the script names no mod or tool', async () => {
  assert(!/savvy|mcp__/.test(readFileSync(new URL('../workflow.js', import.meta.url), 'utf8')))
})

if (fails.length) { console.error(fails.join('\n')); process.exit(1) }
console.log('check22 ok')
