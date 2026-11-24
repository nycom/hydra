// Everything checkable before a live eval spends tokens; calls no model. One line per check, exit 1 on the first failure.
// It checks the plugin under test, builds a fresh fixture in <dest>, proves the scenario's planted condition fires
// (in throwaway clones), and writes the call-1 workflow.js and args.json into the run dir.
//   node evals/preflight.mjs <scenario> <dest> --version X.Y.Z [--skill-dir DIR] [--run-dir DIR] [--skip-checks]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const FULL = 'python3 -m unittest discover -s tests -t .', SCOPED = 'python3 -m unittest tests.test_discount'
const SHAPE = 'tests.test_api.ApiTest.test_discounted_total_shape'
const WS_BRANCH = 'feat/eval--alpha-report'

// ---- the scenarios: build.sh mode, the changes to its printed args, the planted checks, extra files beside workflow.js ----
const patch = (args, id, fields) => Object.assign(args.workstreams.find(w => w.id === id), fields)
const ordered = args => patch(args, 'alpha-discount', { after: ['alpha-cents'], gate: SCOPED })
const noDocs = args => { args.docsRepos = [] }
// plain commands and what to look for, nothing on what the scripted answers will say
const humanChecks = args => {
  patch(args, 'alpha-cents', { humanCheck: `In a checkout of the feature branch run python3 -c 'from ledger.api import total; print(total([{"amount": 3500}]))' and read the field name and the value (350 whole cents).` })
  patch(args, 'alpha-discount', { humanCheck: `In a checkout of the feature branch run python3 -c 'from ledger.discount import discounted_total; print(discounted_total([{"amount": 10000}], "SAVE10"))' and read the field name and the value (950 whole cents).` })
}
const SCENARIOS = {
  'S15-seeded': { mode: 'seed', planted: [seedsPresent] },
  'S15-control': { mode: 'control', planted: [seedsAbsent] },
  'S17-seeded': { mode: 'ws-seed', planted: [oracle('W1 W2 W3 W4')] },
  'S17-control': { mode: 'ws-control', planted: [oracle(''), outcome] },
  S18: { mode: 'flow', args: [ordered], planted: [staleTest, faultFires], files: { 'workflow-fault.js': fault } },
  S19: { mode: 'flow', args: [ordered, humanChecks, noDocs], planted: [staleTest, bothChecksAsked, probesDiffer] },
  S20: { mode: 'impossible', args: [noDocs], planted: [halfUpRed] },
  S21: { mode: 'flow', args: [ordered, noDocs], planted: [staleTest] },
}

// ---- helpers ----
const SEED_SHAPES = [ // fixture-scenarios.md's S15 table: the text a seed puts on feat/eval, or takes away ('gone')
  ['D1', 'alpha', 'ledger/api.py', 'if balance > limit:'],
  ['D2', 'alpha', 'ledger/pager.py', 'items[start:start+size-1]'],
  ['D3', 'alpha', 'ledger/discount.py', 'elif code == "EXPIRED":', 'gone'],
  ['D4', 'alpha', 'ledger/routes.py', /def delete_entry\(.*\n    entries\.remove/],
  ['D5', 'alpha', 'ledger/store.py', /except StoreError:\n\s+pass/],
  ['D6', 'alpha', 'ledger/api.py', '{"total": '],
  ['D7', 'alpha', 'ledger/rounding.py', 'if amount == 1005:\n        return 101'],
  ['D8', 'alpha', 'tests/test_pager.py', 'def test_last_page_partial', 'gone'],
  ['D9', 'beta', 'vendor/alpha-contract.yaml', 'total_cents: string'],
  ['D10', 'alpha', 'tests/test_discount.py', 'apply("SAVE10", 200), 180'],
]
const DISCOUNTED = `
from ledger.api import total

LEDGER_MAX_DISCOUNT = 500


def discounted_total(entries, code):
    amount = sum(e["amount"] for e in entries)
    return total([{"amount": max(apply(code, amount), amount - LEDGER_MAX_DISCOUNT)}])
`
const usage = msg => { console.error(`preflight: ${msg}\nusage: node evals/preflight.mjs <${Object.keys(SCENARIOS).join('|')}> <dest> --version X.Y.Z [--skill-dir DIR] [--run-dir DIR] [--skip-checks]`); process.exit(2) }
const tail = s => s.trim().split('\n').slice(-25).join('\n')
function sh(cmd, args, { cwd, env } = {}) { // stdout and the combined output, whatever the exit code
  const r = spawnSync(cmd, args, { cwd, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', ...env }, encoding: 'utf8', timeout: 900000, maxBuffer: 1 << 26 })
  if (r.error) throw new Error(`${cmd}: ${r.error.message}`)
  return { code: r.status, stdout: r.stdout, out: r.stdout + r.stderr }
}
function must(cmd, args, opts) {
  const r = sh(cmd, args, opts)
  if (r.code !== 0) throw new Error(`${tail(r.out)}\n(${[cmd, ...args].join(' ')} exited ${r.code})`)
  return r.stdout.trim()
}
const NO_GIT_CONFIG = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } // no hooks or templates in the clones
let trees = 0
function tree(c, repo = 'alpha', ref = 'feat/eval') { // a throwaway clone: nothing ever runs in <dest>
  const dir = path.join(c.tmp, `tree${++trees}`)
  must('git', ['clone', '-q', '-b', ref, path.join(c.dest, 'remotes', `${repo}.git`), dir], { env: NO_GIT_CONFIG })
  return dir
}
function failing(dir, gate) { // the failing test ids of a unittest gate, sorted
  const { out } = sh('bash', ['-c', gate], { cwd: dir })
  if (!/^Ran [1-9]\d* tests?/m.test(out)) throw new Error(`no test ran in ${gate}\n${tail(out)}`)
  return [...out.matchAll(/^(?:FAIL|ERROR): \S+ \(([^)]+)\)$/gm)].map(m => m[1]).sort()
}
const knownRed = c => c.args.repos.find(r => r.repo === path.join(c.dest, 'alpha')).knownRed
const gateOf = (c, id) => c.args.workstreams.find(w => w.id === id).gate
const same = (got, want, what) => assert.deepEqual(got, want, `${what}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`)

// ---- planted conditions: each [what it proves, check(c)], run against a fixture that was really built ----
function seedsPresent(c) { return seedLines(c, 'present') }
function seedsAbsent(c) { return seedLines(c, 'absent') }
function seedLines(c, want) {
  const at = ref => { // the shapes a ref of alpha (and beta's feat/eval) holds
    const dirs = { alpha: tree(c, 'alpha', ref), beta: tree(c, 'beta') }
    return SEED_SHAPES.filter(([, repo, file, text, gone]) => {
      const s = fs.readFileSync(path.join(dirs[repo], file), 'utf8')
      return (text instanceof RegExp ? text.test(s) : s.includes(text)) !== !!gone
    }).map(([id]) => id)
  }
  const ids = SEED_SHAPES.map(([id]) => id)
  return [
    ['feat/eval: the gate fails only the known-red', () => same(failing(tree(c), FULL), knownRed(c), 'alpha gate on feat/eval')],
    [`feat/eval: ${want === 'present' ? 'every seed\'s text is there' : 'no seed\'s text is there'} (D1-D10)`, () => {
      const got = at('feat/eval'), wrong = ids.filter(d => got.includes(d) !== (want === 'present'))
      assert.equal(wrong.length, 0, `${wrong.join(' ')} ${want === 'present' ? 'missing from' : 'present on'} feat/eval`) }],
    ['feat/eval-base: alpha holds no seed, so all of them are inside the whole-branch range', () => same(at('feat/eval-base').filter(d => d !== 'D9'), [], 'seeds on feat/eval-base')],
  ]
}
function oracle(want) {
  return c => [[`ws-oracle.sh on the pre-pushed ${WS_BRANCH}: ${want || 'nothing'}`, () =>
    same(must('bash', [path.join(c.fixture, 'ws-oracle.sh'), tree(c, 'alpha', WS_BRANCH), 'HEAD']), want, 'oracle')]]
}
function outcome(c) {
  return [['ws-outcome.sh is clean on the attempt', () => same(must('bash', [path.join(c.fixture, 'ws-outcome.sh'), tree(c, 'alpha', WS_BRANCH), 'HEAD']), '', 'outcome')]]
}
function halfUpRed(c) {
  const HALF_EVEN = 'tests.test_rounding.RoundingTest.test_half_even'
  return [
    ['baseline gate fails only the known-red', () => same(failing(tree(c), gateOf(c, 'alpha-rounding')), knownRed(c), 'baseline gate')],
    ['rounding half up turns the pinned test_half_even red', () => {
      const dir = tree(c)
      fs.appendFileSync(path.join(dir, 'ledger/rounding.py'), '\n\ndef round_total(amount):\n    return (amount + 5) // 10\n')
      same(failing(dir, gateOf(c, 'alpha-rounding')), [...knownRed(c), HALF_EVEN].sort(), 'gate after half up') }],
  ]
}
function staleTest(c) { // the test that pins the old field: skips until discounted_total exists, red once it answers in the renamed shape
  const renamed = () => {
    const dir = tree(c), file = path.join(dir, 'ledger/api.py'), parts = fs.readFileSync(file, 'utf8').split('{"total": ')
    assert.equal(parts.length, 2, 'ledger/api.py: expected exactly one {"total": to rename')
    fs.writeFileSync(file, parts.join('{"total_cents": '))
    return dir
  }
  return [
    ['baseline gate fails only the known-red', () => same(failing(tree(c), FULL), knownRed(c), 'baseline gate')],
    ['after the cents rename alone test_discounted_total_shape skips and alpha-cents\' gate stays green', () => {
      const dir = renamed()
      same(failing(dir, gateOf(c, 'alpha-cents')), knownRed(c), 'alpha-cents gate')
      assert.match(sh('python3', ['-m', 'unittest', '-v', SHAPE], { cwd: dir }).out, /skipped/, 'the stale test did not skip') }],
    ['after the rename and a correct discounted_total only test_discounted_total_shape joins the known-red, and alpha-discount\'s scoped gate is green', () => {
      const dir = renamed()
      fs.appendFileSync(path.join(dir, 'ledger/discount.py'), DISCOUNTED)
      same(failing(dir, FULL), [...knownRed(c), SHAPE].sort(), 'full gate')
      same(failing(dir, gateOf(c, 'alpha-discount')), [], 'scoped gate') }],
  ]
}
// S18: in step() the one agent call answers null for alpha-discount's cycle-1 review, so it dies on every attempt while the health probe passes
function fault(src) {
  const at = src.indexOf('async function step('), end = src.indexOf('\n}\n', at), call = 'await agent('
  const calls = at < 0 ? 0 : src.slice(at, end).split(call).length - 1
  if (calls !== 1) throw new Error(`step() holds ${calls} \`${call}\`, the fault needs exactly one`)
  const i = src.indexOf(call, at)
  return `${src.slice(0, i)}opts.label.startsWith('alpha-discount review c1') ? null : ${src.slice(i)}`
}
function faultFires(c) {
  return [['the one-line step() fault applies exactly once and leaves alpha-discount unmerged, alpha incomplete', async () => {
    const { r, labels } = await dry(c, c.args, { file: 'workflow-fault.js' })
    same(labels.filter(l => l.startsWith('alpha-discount review')), [], 'reviews that ran under the fault')
    assert.ok(labels.includes('health alpha-discount review c1'), 'no health probe ran')
    same(r.workstreams.filter(w => w.merged).map(w => w.id).sort(), ['alpha-cents', 'beta-cents'], 'merged')
    same(r.repos.find(x => x.repo === path.join(c.dest, 'alpha')).verdict, 'incomplete', 'alpha verdict') }]]
}
function bothChecksAsked(c) {
  return [['the dry run pauses with both human checks', async () => same((await dry(c, c.args)).r.humanCheck?.map(h => h.id).sort(), ['alpha-cents', 'alpha-discount'], 'checks asked')]]
}
function probesDiffer(c) {
  return [['every resume sends its own state probe, so a resumeFromRunId cache cannot replay an earlier one', async () => {
    const r1 = await dry(c, c.args)
    const state = repo => ({ [`${repo} state`]: () => ({ workstreams: c.args.workstreams.filter(w => path.basename(w.repo) === repo).map(w => ({ id: w.id, head: r1.heads[w.id], merged: true })) }) })
    const resume = (from, extra = {}) => dry(c, { ...c.args, resume: 'run-1', carryForward: from.r.carryForward, ...extra }, { own: { ...state('alpha'), ...state('beta') } })
    const [ask] = r1.r.humanCheck, answer = { humanChecks: { [ask.id]: { sha: ask.sha, answer: 'ok' } } }
    const r2 = await resume(r1), r2b = await resume(r1, answer), r3 = await resume(r2, answer), r4 = await resume(r3, answer)
    for (const repo of ['alpha', 'beta']) {
      const probe = run => run.prompts[`${repo} state`]
      assert.equal(probe(r1), undefined, `call 1 probes ${repo}`)
      const sent = [r2, r2b, r3, r4].map(probe)
      assert.ok(sent.every(Boolean), `a resume sent no ${repo} state probe`)
      assert.equal(new Set(sent).size, sent.length, `two resumes sent the same ${repo} state probe`)
    } }]]
}

// ---- dry run: the real script against a mock agent that always succeeds (the checks' mock), so a rejected arg fails here ----
const SHA = n => String(n).padStart(40, 'a')
const PUSH = { status: 'done', ok: true, tests: 't', gateTail: 'gate exit=0', sharedEdits: [], decisions: [], questions: [], notes: [] }
const GREEN = { green: true, summary: '12 passed', command: 'mock gate', flaky: [] }
async function dry(c, args, { file = 'workflow.js', own = {} } = {}) {
  process.argv[2] = path.join(c.runDir, file) // run.mjs loads the script named there, as for the checks
  const { Run } = await import(`${pathToFileURL(path.join(c.skill, 'tests/run.mjs'))}?${file}`)
  const prompts = {}, labels = [], heads = {}, tips = {}, unknown = []
  let n = 1000
  const next = () => SHA(++n)
  const agent = async (prompt, o) => {
    const label = o.label.replace(/ attempt \d+$/, ''), id = label.split(' ')[0], w = args.workstreams.find(x => x.id === id)
    const tip = tips[w ? path.basename(w.repo) : id] ||= next()
    prompts[label] = prompt; labels.push(label)
    const mine = own[label]?.(prompt)
    const verdict = { verdict: 'pass', sections: 's', sha: tip, tests: 't', gate: GREEN, findings: [], verified: [], questions: [] }
    const reply = x => ({ ...x, ...mine })
    if (label.startsWith('health ')) return reply({ ok: true, notes: 'git version 2' })
    if (label.endsWith(' state')) return reply({ featureSha: tip, workstreams: [] })
    if (label.endsWith(' implement')) return reply({ ...PUSH, sha: heads[id] = next() })
    if (/ review c\d+$/.test(label)) return reply({ headSha: heads[id], findings: [] })
    if (/ validate c\d+$/.test(label)) return reply({ headSha: heads[id], gate: GREEN, evidence: 'e', verified: [], open: [], questions: [] })
    if (label.endsWith(' merge')) return reply({ ...PUSH, sha: tips[path.basename(w.repo)] = next(), preMergeSha: tip, baseAtMerge: tip })
    if (label.endsWith(' review')) return reply({ headSha: tip, findings: [], seams: 'none' })
    if (label.endsWith(' docs')) return reply({ baseSha: tip, sha: '', files: [], prBody: false, ok: true, tests: 't', notes: [] })
    if (label.endsWith(' validate')) return reply(verdict)
    if (label === 'contracts') return reply({ verdict: 'pass', sections: 's', findings: [] })
    unknown.push(label)
    throw new Error(`no mock for ${label}`)
  }
  const parallel = fs => Promise.all(fs.map(f => f().catch(() => null)))
  let timer
  const hung = new Promise((_, no) => { timer = setTimeout(() => no(new Error('the dry run hung')), 120000) })
  const r = await Promise.race([Run(structuredClone(args), agent, parallel, () => {}, { total: null, spent: () => 0, remaining: () => Infinity }), hung]).finally(() => clearTimeout(timer))
  assert.deepEqual(unknown, [], `the dry run's mock does not know the steps ${unknown.join(', ')}: teach dry() about them`)
  return { r, prompts, labels, heads }
}

// ---- main ----
let opt
try { opt = parseArgs({ allowPositionals: true, options: { version: { type: 'string' }, 'skill-dir': { type: 'string' }, 'run-dir': { type: 'string' }, 'skip-checks': { type: 'boolean' } } }) } catch (e) { usage(e.message) }
const [scenario, destArg, ...rest] = opt.positionals, sc = Object.hasOwn(SCENARIOS, scenario ?? '') ? SCENARIOS[scenario] : null
if (scenario === 'S16') { console.error('preflight: S16 has no run of its own: it is scored from S20\'s call 1; preflight S20'); process.exit(2) }
if (!sc) usage(`unknown scenario ${scenario ?? ''}`)
if (!destArg || rest.length) usage('exactly one dest is needed')
if (!/^\d+\.\d+\.\d+$/.test(opt.values.version ?? '')) usage('--version X.Y.Z is needed')

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-')))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))
async function check(name, fn) {
  try {
    const more = await fn()
    console.log(`ok   ${name}${more ? `: ${more}` : ''}`)
    return more
  } catch (e) {
    console.log(`FAIL ${name}\n${tail(e.message)}`)
    process.exit(1)
  }
}
const skillArg = path.resolve(opt.values['skill-dir'] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '../skills/run'))
const c = { tmp, skill: skillArg, dest: path.resolve(destArg) }

await check(`plugin under test is ${opt.values.version}`, () => {
  c.skill = fs.realpathSync(skillArg); c.root = path.resolve(c.skill, '../..'); c.fixture = path.join(c.skill, 'tests/fixture')
  const { version } = JSON.parse(fs.readFileSync(path.join(c.root, '.claude-plugin/plugin.json'), 'utf8'))
  assert.equal(version, opt.values.version, `${c.root}/.claude-plugin/plugin.json says ${version}, not ${opt.values.version}`)
})
await check('what the run executes is committed', () => {
  // the skill's scripts and the fixture; docs and check files run in no eval, so an edit there does not block one
  const dirty = must('git', ['-C', c.root, 'status', '--porcelain', '-uall', '--', '.claude-plugin', 'skills/run',
    ...['skills/run/*.md', 'skills/run/tests/*.md', 'skills/run/tests/*.mjs'].map(g => `:(exclude,glob)${g}`)])
  assert.equal(dirty, '', `uncommitted:\n${dirty}`)
  c.sha = must('git', ['-C', c.root, 'rev-parse', 'HEAD'])
  return `${must('git', ['-C', c.root, 'rev-parse', '--abbrev-ref', 'HEAD'])} ${c.sha.slice(0, 7)}`
})
await check('run dir is free', () => {
  if (opt.values['run-dir']) fs.mkdirSync(c.runDir = path.resolve(opt.values['run-dir']), { recursive: true })
  else c.runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-'))
  for (const f of ['workflow.js', 'args.json', ...Object.keys(sc.files || {})]) assert.ok(!fs.existsSync(path.join(c.runDir, f)), `${c.runDir} already holds ${f}: one run dir per run`)
  return c.runDir
})
await check(`fixture --${sc.mode}`, () => {
  c.args = JSON.parse(must('bash', [path.join(c.fixture, 'build.sh'), destArg, `--${sc.mode}`]))
  return (c.dest = fs.realpathSync(destArg))
})

if (opt.values['skip-checks']) console.log('skip build.test.sh, check*.mjs, run-cmd.test.mjs, report.test.mjs (--skip-checks)')
else {
  // on a clone of HEAD: build.test.sh fails when anyone edits the checkout while it runs
  const at = path.join(tmp, 'head'), tests = path.join(at, 'skills/run/tests')
  await check('clone of HEAD for the checks', () => { must('git', ['clone', '-q', '--shared', '--no-checkout', c.root, at]); must('git', ['-C', at, 'checkout', '-q', c.sha]) })
  // some checks time things, and a loaded machine fails one that a second try passes
  const test = (name, cmd, args, opts) => check(name, () => {
    try { must(cmd, args, opts) } catch (e) { must(cmd, args, opts); return `passed on a retry, first:\n${tail(e.message)}` }
  })
  await test('skills/run/tests/fixture/build.test.sh', 'bash', [path.join(tests, 'fixture/build.test.sh')])
  for (const f of fs.readdirSync(tests).filter(f => /^check\d*\.mjs$/.test(f)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })))
    await test(`skills/run/tests/${f}`, process.execPath, [f, '../workflow.js'], { cwd: tests })
  await test('skills/run/tests/run-cmd.test.mjs', process.execPath, ['run-cmd.test.mjs'], { cwd: tests })
  await test('evals/report.test.mjs', process.execPath, ['evals/report.test.mjs'], { cwd: at })
}

await check('call-1 workflow.js and args.json', () => {
  for (const f of sc.args || []) f(c.args)
  if ('skillDir' in c.args) c.args.skillDir = c.skill
  const src = path.join(c.skill, 'workflow.js')
  fs.copyFileSync(src, path.join(c.runDir, 'workflow.js'))
  for (const [f, make] of Object.entries(sc.files || {})) fs.writeFileSync(path.join(c.runDir, f), make(fs.readFileSync(src, 'utf8')))
  fs.writeFileSync(path.join(c.runDir, 'args.json'), `${JSON.stringify(c.args, null, 2)}\n`)
})
await check('the workflow accepts the args, and a dry run on a mock agent merges every workstream', async () => {
  const { r, labels } = await dry(c, c.args)
  assert.deepEqual(r.workstreams.filter(w => !w.merged).map(w => [w.id, ...w.escalations]), [], 'workstreams that did not merge')
  if (c.args.docsRepos.length === 0) same(labels.filter(l => l.endsWith(' docs')), [], 'docs agents with docsRepos []')
})
for (const planted of sc.planted) for (const [name, fn] of planted(c)) await check(name, fn)

console.log(`run dir ${c.runDir}`)
console.log(`args ${JSON.stringify(c.args)}`)
console.log(`preflight ok ${scenario} ${c.dest}`)
