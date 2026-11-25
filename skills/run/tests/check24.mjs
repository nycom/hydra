// A merged sibling's base tests stay read-only under the integration-fix exception (tests it added in this run do not), and every workstream validator holds the rule.
// Every scenario fails against the 0.4.1 script except the ones marked (control).
import { Run } from './run.mjs'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { skillText } from './skill-text.mjs'
const SHA = n => (n + '').padStart(40, 'a')
const parallel = fs => Promise.all(fs.map(f => f().catch(() => null)))
const free = { total: null, spent: () => 0, remaining: () => Infinity }
const push = { status: 'done', ok: true, tests: 't', gateTail: 'gate exit=0', sharedEdits: [], decisions: [], questions: [], notes: [] }
const green = { green: true, summary: '12 passed', command: 'npm test', flaky: [] }
const F = (id, severity = 'major', where = 'x.py:3') => ({ id, severity, kind: 'bug', where, issue: `issue ${id}`, evidence: 'test t1 red' })
const Q = q => ({ q, options: ['keep the test', 'edit the test'], default: 'keep the test' })
function mock(args, sc = {}) {
  const prompts = {}, all = {}, order = []
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
    if (L.endsWith('merge')) { const pre = head[repo] || SHA(40); head[repo] = SHA(500 + ++n); return { ...push, sha: head[repo], preMergeSha: pre, baseAtMerge: SHA(40), ...own } }
    if (L.endsWith(' review')) return { headSha: head[repo] || SHA(4000), findings: [], seams: 'none', ...own }
    if (L.endsWith(' validate')) return { verdict: 'pass', sections: 's', sha: head[repo] || SHA(4000), tests: 't', gate: green, findings: [], verified: [], questions: [], ...own }
    if (/fix r(\d)/.test(L)) { const r = { ...push, sha: SHA(70 + +L.at(-1)), answers: [], ...own }; head[repo] = r.sha; return r }
    if (/recheck r\d/.test(L)) return { verdict: 'pass', sections: 's', sha: head[repo], tests: 't', gate: green, findings: [], verified: [], questions: [], ...own }
    if (L.endsWith(' docs')) return { baseSha: head[repo] || SHA(4000), sha: '', files: [], prBody: false, ok: true, tests: 't', notes: [], ...own }
    if (L.endsWith(' promote')) return { ok: true, sha: (p.match(/ to ([0-9a-f]{40})\./) || [])[1], notes: [], ...own }
    if (L === 'contracts') return { verdict: 'pass', sections: 's', findings: [], ...own }
    throw new Error('unmocked ' + L)
  }
  return { agent, prompts, all, order }
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
const HA = SHA(1001)

// discount runs after cents, so cents' files (its code and its pre-existing test) are a merged sibling's at discount's fix
const flow = x => ({ cycles: 1, workstreams: [ws('d', { files: ['ledger/discount.py', 'tests/test_discount.py'], after: ['c'] }), ws('c', { files: ['ledger/api.py', 'tests/test_api.py'] })], ...x })
const review = { 'd review c1': () => ({ findings: [F('c1-F1', 'critical', 'tests/test_api.py:20')] }), 'd validate c1': () => ({ verified: ['c1-F1'] }) }
const line = (p, start) => p.split('\n').find(l => l.startsWith(start)) || ''
const RULE = /Read-only unless the brief names it: any test already on \S+ .*editing one is a major regression/

await t('a the integration exception offers a sibling\'s tests added in this run, keeps its base tests read-only and routes their only fix to "carried"', async () => {
  const { prompts } = await go(flow(), review)
  const s = line(prompts['d fix c1'] || '', 'Integration fix:')
  assert(/the tests they added in this run, which are not pre-existing/.test(s) && /never a test that is already on origin\/main and the brief does not name/.test(s) && /stays read-only/.test(s) && /answered "carried"/.test(s), s) })
await t('b the delta validator carries the read-only rule with nothing claimed "carried"', async () => {
  const { prompts } = await go(flow(), review)
  const p = prompts['d validate c1'] || ''
  assert(!/A claim "carried" holds/.test(p), 'nothing was claimed')
  assert(RULE.test(p) && p.includes('ledger/discount.py, tests/test_discount.py'), 'rule missing') })
await t('b2 the clean-review validator carries it too', async () => {
  const { prompts } = await go(flow(), {})
  assert(RULE.test(prompts['d validate c1'] || ''), 'rule missing') })
await t('a2 a test a sibling added in this run to a file that is on the base is judged per test: offered under the exception, not guarded', async () => {
  const { prompts } = await go(flow(), review)
  const s = line(prompts['d fix c1'] || '', 'Integration fix:'), v = prompts['d validate c1'] || ''
  assert(!/test file/.test(s) && /never a test that is already on origin\/main/.test(s), s)
  assert(!/any test file on/.test(v) && /any test already on origin\/main \(git show origin\/main:<path> has it\)/.test(v), 'guard is per file') })
await t('b3 a workstream with files[] gets the rule before any sibling merged (the backstop is computed later, at merge time)', async () => {
  const { prompts } = await go({ cycles: 1, workstreams: [ws('a')] }, {})
  assert(RULE.test(prompts['a validate c1'] || '') && prompts['a validate c1'].includes("outside this workstream's files (a/)"), 'rule missing') })
await t('b4 a workstream with no files[] gets the rule over a merged sibling\'s files', async () => {
  const { prompts } = await go(flow({ workstreams: [ws('d', { files: undefined, after: ['c'] }), ws('c', { files: ['ledger/api.py', 'tests/test_api.py'] })] }), {})
  const p = prompts['d validate c1'] || ''
  assert(RULE.test(p) && p.includes("in the files of c (ledger/api.py, tests/test_api.py)"), 'rule missing') })
await t('b5 a carried claim is judged by the same base rule: a sibling\'s test added in this run is not outside the files it may edit', async () => {
  const { prompts } = await go(flow(), { ...review, 'd fix c1': () => ({ answers: [{ id: 'c1-F1', action: 'carried', note: 'tests/test_api.py' }] }) })
  const p = prompts['d validate c1'] || ''
  assert(/A claim "carried" holds/.test(p) && /A pre-existing test the brief does not name is read-only, so it counts as outside them\. Pre-existing means on origin\/main: a test a merged sibling added in this run does not count\./.test(p), 'claim line') })
await t('c (control) a merged sibling\'s files are still offered under the exception', async () => {
  const { prompts } = await go(flow(), review)
  const s = line(prompts['d fix c1'] || '', 'Integration fix:')
  assert(s.includes('c (ledger/api.py, tests/test_api.py)') && /fix those files too \(the one exception to your file list/.test(s), s) })
await t('d (control) a workstream with no files[] gets no files-based rule', async () => {
  const { prompts } = await go({ cycles: 1, workstreams: [ws('a', { files: undefined })] }, {})
  assert(prompts['a validate c1'] && !RULE.test(prompts['a validate c1'])) })
await t('e SKILL.md states the carve-out; plugin.json is at least 0.4.2', async () => {
  const s = skillText
  assert(/tests they added in this run/.test(s.replace(/\s+/g, ' ')) && /test that already exists on the run's base/.test(s.replace(/\s+/g, ' ')) && !/test file that already exists/.test(s.replace(/\s+/g, ' ')), 'SKILL.md carve-out')
  const v = JSON.parse(readFileSync(new URL('../../../.claude-plugin/plugin.json', import.meta.url), 'utf8')).version.split('.').map(Number); assert(v[0] > 0 || v[1] > 4 || (v[1] === 4 && v[2] >= 2), 'at least 0.4.2') })

// ---- the whole-PR review: one answer per case, one anchor, the whole-branch fixer's licence ----
const anchors = { exception: /never a test that is already on (\S+) and/, guard: /any test already on (\S+) \(git show/, claim: /Pre-existing means on (\S+?):/ }
await t('f the exception, the read-only rule and the claim sentence all name the same base ref', async () => {
  const dev = x => ws(x.id, { base: 'develop', ...x })
  const { prompts } = await go({ cycles: 1, localOnly: true, workstreams: [dev({ id: 'd', files: ['ledger/discount.py', 'tests/test_discount.py'], after: ['c'] }), dev({ id: 'c', files: ['ledger/api.py', 'tests/test_api.py'] })] },
    { ...review, 'd fix c1': () => ({ answers: [{ id: 'c1-F1', action: 'carried', note: 'tests/test_api.py' }] }) })
  const got = { exception: (line(prompts['d fix c1'] || '', 'Integration fix:').match(anchors.exception) || [])[1], guard: ((prompts['d validate c1'] || '').match(anchors.guard) || [])[1], claim: ((prompts['d validate c1'] || '').match(anchors.claim) || [])[1] }
  assert.deepEqual(got, { exception: 'hydra-local/develop', guard: 'hydra-local/develop', claim: 'hydra-local/develop' }) })
await t('g a files[] fixer answers a fix outside its files "carried", not blocked and not escalated', async () => {
  const { prompts } = await go(flow(), review)
  assert(/answer it "carried" \(not blocked, not escalated\), naming that file in the note/.test(prompts['d fix c1'] || ''), 'precedence') })
await t('h the whole-branch fixer is told handed findings are its to fix in any file, pre-existing tests included', async () => {
  const sc = { ...review, 'd fix c1': () => ({ answers: [{ id: 'c1-F1', action: 'carried', note: 'tests/test_api.py' }] }) }
  const { prompts } = await go(flow(), sc)
  assert(/Handed findings \(d:c1-F1\) are this pass's to fix in any file, pre-existing tests included \(never escalated for that\)/.test(prompts['one fix r1'] || ''), Object.keys(prompts).join()) })
await t('h2 (control) with nothing handed the whole-branch fixer gets no such sentence', async () => {
  const { prompts } = await go({ cycles: 1, workstreams: [ws('a')] }, { 'one validate': () => ({ verdict: 'fail', findings: [F('V-F1')] }), 'one recheck r1': () => ({ verified: ['V-F1'] }) })
  assert(prompts['one fix r1'] && !/Handed findings/.test(prompts['one fix r1'])) })
await t('i no files[] here and none on the merged siblings: no read-only sentence', async () => {
  const { prompts } = await go(flow({ workstreams: [ws('d', { files: undefined, after: ['c'] }), ws('c', { files: undefined })] }), {})
  const p = prompts['d validate c1'] || ''
  assert(p && !RULE.test(p) && !/no files\[\] declared\)/.test(p.split('Read-only unless')[1] || ''), 'sentence') })

if (fails.length) { console.error(fails.join('\n')); process.exit(1) }
console.log('check24 ok')
