// Agent types: `agentTypes` replaces a role's agent type, unset keeps the bare names, and the plugin ships one lean agent per role.
// Every scenario fails against the 0.4.5 script and tree except the ones marked (control).
import { Run } from './run.mjs'
import assert from 'node:assert'
import { readFileSync, readdirSync } from 'node:fs'
import { core, refs } from './skill-text.mjs'
const SHA = n => (n + '').padStart(40, 'a')
const parallel = fs => Promise.all(fs.map(f => f().catch(() => null)))
const free = { total: null, spent: () => 0, remaining: () => Infinity }
const green = { green: true, summary: '12 passed', command: 'npm test', flaky: [] }
const push = { status: 'done', ok: true, tests: 't', gateTail: 'gate exit=0', sharedEdits: [], decisions: [], questions: [], notes: [] }
const ROLES = ['implementer', 'reviewer', 'validator']
const src = readFileSync(process.argv[2], 'utf8')
const root = new URL('../../../', import.meta.url)

// one workstream with a fix cycle, plus a first implement attempt that dies twice so the health probe runs
const run = async agentTypes => {
  const types = {}
  let head = SHA(1), tries = 0, n = 0
  const agent = async (p, o) => {
    const L = o.label.replace(/ attempt \d$/, '')
    ;(types[L] ||= new Set()).add(o.agentType)
    if (L.startsWith('health ')) return { ok: true, notes: 'git version 2' }
    if (L === 'a implement') return ++tries < 3 ? null : { ...push, sha: head }
    if (/review c\d/.test(L)) return { headSha: head, findings: ++n === 1 ? [{ id: 'F1', severity: 'major', kind: 'bug', where: 'a/x.py:3', issue: 'i', evidence: 'red' }] : [] }
    if (/fix c\d/.test(L)) return { ...push, sha: head = SHA(2), answers: [{ id: 'F1', answer: 'fixed', note: 'n' }] }
    if (/validate c\d/.test(L)) return { headSha: head, gate: green, evidence: 'e', verified: ['F1'], open: [], questions: [] }
    if (L.endsWith('merge')) return { ...push, sha: head = SHA(3), preMergeSha: SHA(40), baseAtMerge: SHA(40) }
    if (L.endsWith(' review')) return { headSha: head, findings: [], seams: 'none' }
    if (L.endsWith(' docs')) return { baseSha: head, sha: '', files: [], prBody: false, ok: true, tests: 't', notes: [] }
    if (L.endsWith('validate')) return { verdict: 'pass', sections: 's', sha: head, tests: 't', gate: green, findings: [], verified: [], questions: [] }
    if (L.endsWith(' promote')) return { ok: true, sha: head, notes: [] }
    throw new Error('unmocked ' + L)
  }
  const args = { skillDir: '/s', cycles: 1, workstreams: [{ id: 'a', repo: '/r/one', featureBranch: 'f', branch: 'f--a', model: 'sonnet', brief: 'b', gate: 'npm test', files: ['a/'] }], ...(agentTypes === undefined ? {} : { agentTypes }) }
  const r = await Run(args, agent, parallel, () => {}, free)
  return { r, types, used: [...new Set(Object.values(types).flatMap(s => [...s]))].sort() }
}
const fails = []
const t = async (name, fn) => { try { await fn() } catch (e) { fails.push(`${name}: ${e.message.split('\n')[0]}`) } }

await t('1 (control) unset: every agent runs on a bare role name', async () => {
  const { r, types, used } = await run()
  assert(r.workstreams[0].merged, 'merged')
  assert(Object.keys(types).some(L => L.startsWith('health ')), 'a health probe ran')
  assert.deepEqual(used, ROLES) })
await t('2 one role replaced: only that role changes, health probe included', async () => {
  const bare = (await run()).types
  const { types } = await run({ validator: 'hydra:validator' })
  assert.deepEqual(Object.keys(types), Object.keys(bare))
  for (const [L, s] of Object.entries(bare)) assert.deepEqual([...types[L]], [...s].map(x => x === 'validator' ? 'hydra:validator' : x), L) })
await t('3 all roles replaced: no bare name is left', async () => {
  const { used } = await run({ implementer: 'hydra:implementer', reviewer: 'my-reviewer', validator: 'a:b:c' })
  assert.deepEqual(used, ['a:b:c', 'hydra:implementer', 'my-reviewer']) })
await t('4 (control) null and {} behave as unset', async () => {
  for (const v of [null, {}]) assert.deepEqual((await run(v)).used, ROLES) })
await t('5 an unknown role or a bad name throws', async () => {
  for (const v of [{ author: 'x' }, { reviewer: '' }, { reviewer: 'a b' }, { reviewer: 5 }, { reviewer: null }, { reviewer: 'a:' }, [], 'reviewer'])
    await assert.rejects(run(v), /agentTypes/, JSON.stringify(v)) })
// the run in 1-3 reaches 10 of the 19 sites; the source pins all of them, in order: V validator, I implementer, R reviewer
await t('6 every agent call takes its type from TYPE, on its own role', () => {
  const sites = [...src.matchAll(/agentType:\s*([^,}\s]+)/g)].map(m => m[1])
  assert.equal(sites.map(s => ({ 'TYPE.implementer': 'I', 'TYPE.reviewer': 'R', 'TYPE.validator': 'V' })[s] ?? `?${s}`).join(''), 'VIVIRVIVIRVIVVVIVIR') })

await t('7 the plugin ships exactly the three agents, lean and untied to a model', () => {
  assert.deepEqual(readdirSync(new URL('agents/', root)).sort(), ROLES.map(r => `${r}.md`))
  for (const r of ROLES) {
    const [, fm, body] = readFileSync(new URL(`agents/${r}.md`, root), 'utf8').match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
    const f = Object.fromEntries(fm.split('\n').map(l => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]))
    assert.equal(f.name, r)
    assert.equal(f.omitClaudeMd, 'true', `${r}: omitClaudeMd`)
    assert.equal(f.model, 'inherit', `${r}: model`)
    assert.equal(/\bEdit\b/.test(f.tools) && /\bWrite\b/.test(f.tools), r === 'implementer', `${r}: edit tools`)
    assert(!/\b(Agent|Task|Workflow)\b/.test(f.tools), `${r}: no spawning`)
    assert(/CLAUDE\.md/.test(body) && /AGENTS\.md/.test(body), `${r}: reads the repo's rules`) } })
await t('8 SKILL.md states the resolution: own agent first, then the shipped one, then stop; same types on a resume', () => {
  const p = core.split('\n\n').find(s => s.startsWith('**Agent types.**'))
  assert(p, 'the paragraph')
  for (const re of [/agentTypes/, /hydra:<role>/, /bare name/, /resume/, /your own spawns/, /name a model on every/, /before your first spawn/i, /`Agent types: implementer = <type>, reviewer = <type>, validator = <type>`/, /lacks Bash/]) assert(re.test(p.replace(/\n/g, ' ')), String(re))
  assert(core.indexOf('**Agent types.**') < core.indexOf('## 1. Decompose'), 'before section 1')
  assert(/^\| `agentTypes` \| none \|/m.test(refs['args-and-sizing.md']), 'the args row')
  assert(/^ {4}agentTypes: /m.test(refs['questions-and-resume.md'].split('```')[1]), 'the resumed call') })

await t('9 SKILL.md shows the shape of agentTypes in its call, so a run on the shipped agents guesses nothing', () => {
  const call = core.split('```').find(b => b.includes('Workflow({'))
  assert(/^ {4}agentTypes: \{ implementer: "hydra:implementer", reviewer: "hydra:reviewer", validator: "hydra:validator" \},/m.test(call), 'the call example') })
await t('10 SKILL.md: an order between two workstreams in one shared file goes in both briefs', () => {
  const b = core.replace(/\n\s*/g, ' ')
  assert(/same shared file[^.]*order matters[^.]*both briefs/.test(b), 'the brief rule') })
await t('11 SKILL.md gives the cron tool\'s own expiry', () => assert(/expire after 30 days/.test(core) && !/7 days/.test(core)))

if (fails.length) { console.error(fails.join('\n')); process.exit(1) }
console.log('agent type checks ok')
