// Smoke wrapper, executable checks, seam inventory and wbRounds scenarios; all but the 10c and 13b controls fail against the tier-1 script.
import { Run } from './run.mjs'
import assert from 'node:assert'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const SKILL = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')
const SHA = n => (n + '').padStart(40, 'a')
const parallel = fs => Promise.all(fs.map(f => f().catch(() => null)))
const budget = { total: null, spent: () => 0, remaining: () => Infinity }
const push = { status: 'done', ok: true, tests: 't', gateTail: 'exit 0', sharedEdits: [], decisions: [], questions: [], notes: [] }
const green = { green: true, summary: '' }
const F = (id, severity, kind = 'bug') => ({ id, severity, kind, where: 'a:1', issue: `issue ${id}`, evidence: 'test t1 red' })
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
    if (L.endsWith(' review')) return { headSha: head[repo] || SHA(50), findings: [], seams: 'none', ...own }
    if (L.endsWith(' validate') && o.phase === 'Whole-branch') return { verdict: 'pass', sections: 's', sha: head[repo] || SHA(50), tests: 't', gate: green, findings: [], ...own }
    if (/fix r(\d)/.test(L)) { const r = { ...push, sha: SHA(70 + +L.at(-1)), answers: [], ...own }; head[repo] = r.sha; return r }
    if (/recheck r\d/.test(L)) return { verdict: 'pass', sections: 's', sha: head[repo], tests: 't', gate: green, findings: [], verified: [], ...own }
    if (L.endsWith(' docs')) return { baseSha: head[repo], sha: '', files: [], prBody: false, ok: true, tests: 't', notes: [] }
    throw new Error('unmocked ' + L)
  }
  return { agent, prompts, opts }
}
const ws = (id, extra = {}) => ({ id, repo: '/r/one', featureBranch: 'f', branch: `f--${id}`, model: 'sonnet', brief: 'b', gate: 'npm test', ...extra })
const go = async (args, sc) => { const m = mock(sc); const r = await Run(args, m.agent, parallel, () => {}, budget); return { r, p: m.prompts, o: m.opts } }
const rejects = (args, re) => assert.rejects(go(args), re)
const fails = []
const t = async (name, fn) => { try { await fn() } catch (e) { fails.push(`${name}: ${e.message.split('\n')[0]}`) } }
// the run-cmd.mjs command line an agent is told to run, executed by a real shell
const runLine = (prompt, cmd) => prompt.split('\n').find(l => l.startsWith('node ') && l.includes('run-cmd.mjs') && l.includes(cmd.slice(0, 8)))
const sh = line => execFileSync('/bin/sh', ['-c', line], { encoding: 'utf8' })
const wbMajor = { 'one review': () => ({ findings: [F('W-F1', 'major')] }) }

// row 10: smoke runs through run-cmd.mjs, shell-quoted, in the validator and the recheck
const SMOKE = `node -e 'console.log("a b")' && echo "it's up"`
await t('10a quoted smoke reaches validator and recheck, and runs as written', async () => {
  const { p } = await go({ cycles: null, skillDir: SKILL, repos: [{ repo: '/r/one', smoke: SMOKE }], workstreams: [ws('a')] }, { ...wbMajor, 'one recheck r1': () => ({ verified: ['W-F1'] }) })
  for (const k of ['one validate', 'one recheck r1']) {
    const line = runLine(p[k], 'node -e')
    assert(line && line.startsWith(`node '${SKILL}/run-cmd.mjs' 540 `), `${k}: wrapped smoke line, got ${line}`)
     assert.equal(sh(line), "a b\nit's up\n", `${k}: quoting round-trips`)
    assert(/A failed or timed-out smoke is a critical finding/.test(p[k]), `${k}: critical`)
  }
})
await t('10b smokeTimeout overrides the 540 s default', async () => {
  const { p } = await go({ cycles: null, skillDir: SKILL, repos: [{ repo: '/r/one', smoke: 'true', smokeTimeout: 30 }], workstreams: [ws('a')] })
  assert(p['one validate'].includes(`node '${SKILL}/run-cmd.mjs' 30 'true'`), 'timeout 30')
})
await t('10c no smoke: skipped, no wrapper, no skillDir needed', async () => {
  const { p } = await go({ cycles: null, workstreams: [ws('a')] })
  assert(p['one validate'].includes('skipped: no smoke recipe') && !p['one validate'].includes('run-cmd.mjs'))
})
await t('10d smoke/smokeTimeout/skillDir validation', async () => {
  await rejects({ repos: [{ repo: '/r/one', smoke: 'true' }], workstreams: [ws('a')] }, /skillDir/)
  await rejects({ skillDir: 'skills/run', repos: [{ repo: '/r/one', smoke: 'true' }], workstreams: [ws('a')] }, /skillDir/)
  for (const smokeTimeout of [0, -5, 1.5, '30'])
    await rejects({ skillDir: SKILL, repos: [{ repo: '/r/one', smoke: 'true', smokeTimeout }], workstreams: [ws('a')] }, /smokeTimeout/)
})

// row 11: workstream checks, run via run-cmd.mjs by authors, fixers and both validators; gates stay unwrapped
const CHECKS = ['npm run e2e:login', `node -e 'process.exit(0)'`]
const hasChecks = (p, k) => {
  for (const c of CHECKS) assert(p[k].includes(`node '${SKILL}/run-cmd.mjs' 540 ${c === CHECKS[0] ? `'${c}'` : `'node -e '\\''process.exit(0)'\\'''`}`), `${k}: ${c} wrapped`)
  assert(/exit code per command/.test(p[k]) && /red check is a critical finding/.test(p[k]), `${k}: exit codes + critical`)
  assert(!/run-cmd\.mjs' \d+ 'npm test'/.test(p[k]), `${k}: gate has no deadline`)
}
await t('11a checks in implement + clean-review validator', async () => {
  const { p } = await go({ cycles: null, skillDir: SKILL, workstreams: [ws('a', { checks: CHECKS })] })
  for (const k of ['a implement', 'a validate c1']) hasChecks(p, k)
  assert.equal(sh(runLine(p['a implement'], 'node -e')), '', 'check line runs')
})
await t('11b checks in fix + delta validator', async () => {
  const { p } = await go({ cycles: null, skillDir: SKILL, workstreams: [ws('a', { checks: CHECKS })] }, { 'a review c1': () => ({ findings: [F('c1-F1', 'major')] }), 'a validate c1': () => ({ verified: ['c1-F1'] }) })
  for (const k of ['a fix c1', 'a validate c1']) hasChecks(p, k)
  assert(p['a validate c1'].includes('review-fix delta'), 'delta validator prompt')
})
await t('11c checks validation', async () => {
  for (const checks of ['npm test', [], [''], [3]])
    await rejects({ skillDir: SKILL, workstreams: [ws('a', { checks })] }, /checks/)
  await rejects({ workstreams: [ws('a', { checks: ['true'] })] }, /skillDir/)
})

// row 12: seam inventory in the whole-branch review, returned per repo
await t('12 seam inventory', async () => {
  const { r, p, o } = await go({ cycles: null, workstreams: [ws('a'), ws('b')] }, { 'one review': () => ({ seams: 'a: total -> total_cents; b uses total at b.py:3: incompatible' }) })
  const k = p['one review']
  assert(k.includes('git diff M^1 M') && /--first-parent --merges/.test(k), 'per-merge diff')
  for (const s of ['signatures', 'fields', 'config/env keys', 'defaults', 'enum values', 'error shapes']) assert(k.includes(s), `lists ${s}`)
  assert(/use sites in the other workstreams' diffs/.test(k) && /each intersection/.test(k), 'grep + one line per intersection')
  assert(o['one review'].schema.required.includes('seams'), 'schema requires seams')
  assert.equal(r.repos[0].seams, 'a: total -> total_cents; b uses total at b.py:3: incompatible')
})

// row 13: wbRounds; never rebase
await t('13a wbRounds 0: findings returned unfixed, no fix agent', async () => {
  const { r, p } = await go({ cycles: null, wbRounds: 0, workstreams: [ws('a')] }, wbMajor)
  assert(!Object.keys(p).some(k => / fix r\d| recheck r\d/.test(k)), Object.keys(p).join())
  const x = r.repos[0]
  assert(x.verdict === 'fail' && x.fixRounds === 0 && x.open.some(s => s.includes('issue W-F1')), JSON.stringify(x))
  assert(x.escalations.some(e => /wbRounds 0/.test(e)), x.escalations.join())
})
await t('13b wbRounds 0 with only minors passes', async () => {
  const { r } = await go({ cycles: null, wbRounds: 0, workstreams: [ws('a')] }, { 'one review': () => ({ findings: [F('W-F1', 'minor')] }) })
  assert(r.repos[0].verdict === 'pass' && r.repos[0].open.length === 1, JSON.stringify(r.repos[0]))
})
await t('13c wbRounds 1 caps the rounds', async () => {
  const { r, p } = await go({ cycles: null, wbRounds: 1, workstreams: [ws('a')] }, wbMajor)
  assert(p['one fix r1'] && !p['one fix r2'] && r.repos[0].fixRounds === 1 && r.repos[0].verdict === 'fail', JSON.stringify(r.repos[0]))
})
await t('13d wbRounds validation', async () => {
  for (const wbRounds of [-1, 1.5, '2']) await rejects({ wbRounds, workstreams: [ws('a')] }, /wbRounds/)
})
await t('13e never rebase', async () => {
  const { p } = await go({ cycles: null, workstreams: [ws('a')] }, { 'a review c1': () => ({ findings: [F('c1-F1', 'major')] }), 'a validate c1': () => ({ verified: ['c1-F1'] }) })
  for (const k of ['a implement', 'a fix c1', 'a merge']) assert(/never rebase/i.test(p[k]), k)
})

if (fails.length) { console.log('FAILED:\n' + fails.join('\n')); process.exit(1) }
console.log('tier-2 checks ok')
