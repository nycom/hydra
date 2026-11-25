// preflight.mjs and publish.sh against throwaway copies of this plugin: no model, no network, nothing written in this checkout.
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const VERSION = JSON.parse(fs.readFileSync(path.join(REPO, '.claude-plugin/plugin.json'), 'utf8')).version
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pf-')))
after(() => fs.rmSync(tmp, { recursive: true, force: true }))

let n = 0
const fresh = name => path.join(tmp, `${name}-${++n}`) // dest paths stay neutral: build.sh refuses telling ones
const git = (dir, ...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=Dev', '-c', 'user.email=dev@example.invalid', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' }).trim()
const plugin = (change = () => {}) => { // a committed copy of the plugin, broken by change
  const root = fresh('root')
  for (const f of ['.claude-plugin', 'skills', 'evals', 'README.md']) fs.cpSync(path.join(REPO, f), path.join(root, f), { recursive: true, filter: p => !/__pycache__|\.DS_Store/.test(p) })
  change(root)
  git(tmp, 'init', '-q', '-b', 'main', root)
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'Plugin under test')
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
  return root
}
const edit = (root, file, from, to) => {
  const p = path.join(root, file), s = fs.readFileSync(p, 'utf8')
  assert.equal(s.split(from).length, 2, `${file}: expected exactly one ${from}`)
  fs.writeFileSync(p, s.replace(from, () => to))
}
const run = (cmd, args, opts) => new Promise(done => {
  const p = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  for (const s of [p.stdout, p.stderr]) s.on('data', d => { out += d })
  p.on('close', code => done({ code, out }))
})
const good = plugin()
const preflight = async (scenario, { root = good, dest = fresh('dest'), runDir = fresh('run'), version = VERSION, extra = ['--skip-checks'] } = {}) => {
  const r = await run(process.execPath, [path.join(root, 'evals/preflight.mjs'), scenario, dest, '--version', version, '--run-dir', runDir, ...extra])
  return { ...r, dest, runDir, args: () => JSON.parse(fs.readFileSync(path.join(runDir, 'args.json'), 'utf8')) }
}
const passes = async (scenario, opts) => {
  const r = await preflight(scenario, opts)
  assert.equal(r.code, 0, r.out)
  assert.equal(r.out.trim().split('\n').at(-1), `preflight ok ${scenario} ${fs.realpathSync(r.dest)}`)
  assert.ok(fs.readFileSync(path.join(r.runDir, 'workflow.js')).equals(fs.readFileSync(path.join(good, 'skills/run/workflow.js'))), 'workflow.js is a byte copy')
  for (const repo of fs.existsSync(path.join(r.dest, 'alpha')) ? ['alpha', 'beta'] : []) assert.equal(git(path.join(r.dest, repo), 'status', '--porcelain', '--ignored'), '', `${repo}: nothing ran inside dest`)
  return r
}
const fails = async (scenario, re, opts) => {
  const r = await preflight(scenario, opts)
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, re)
  assert.ok(!r.out.includes('preflight ok'), r.out)
  assert.equal(r.out.split('\n').filter(l => l.startsWith('FAIL ')).length, 1, 'stops at the first failure')
  return r
}
const stub = d => { // every check passes at once, if it is called the way SKILL.md says
  fs.writeFileSync(path.join(d, 'skills/run/tests/fixture/build.test.sh'), 'exit 0\n')
  fs.writeFileSync(path.join(d, 'evals/report.test.mjs'), '')
  for (const f of fs.readdirSync(path.join(d, 'skills/run/tests'))) if (/^check\d*\.mjs$/.test(f)) fs.writeFileSync(path.join(d, 'skills/run/tests', f), 'if (process.argv[2] !== "../workflow.js") process.exit(1)')
}
const ws = (args, id) => args.workstreams.find(w => w.id === id)
const SCOPED = 'python3 -m unittest tests.test_discount'
const par = { concurrency: 4, timeout: 300000 }

test('preflight', par, async t => {
  const all = [
    ['S16 is folded into S20: says so, exits 2, builds nothing', async () => {
      const r = await preflight('S16')
      assert.equal(r.code, 2)
      assert.match(r.out, /S16.*S20.*call 1/)
      assert.ok(!fs.existsSync(r.dest)) }],
    ['an unknown scenario or a missing --version exits 2', async () => {
      assert.equal((await preflight('S99')).code, 2)
      assert.equal((await run(process.execPath, [path.join(good, 'evals/preflight.mjs'), 'S21', fresh('dest')])).code, 2) }],
    ['a telling dest path is refused in build.sh\'s words, nothing built', async () => {
      const r = await fails('S21', /dest path .* contains "bug"/, { dest: path.join(tmp, 'my-bug') })
      assert.ok(!fs.existsSync(r.dest)) }],
    ['a non-empty dest is refused and left alone', async () => {
      const dest = fresh('dest')
      fs.mkdirSync(dest); fs.writeFileSync(path.join(dest, 'notes.txt'), 'mine')
      await fails('S21', /is not empty/, { dest })
      assert.deepEqual(fs.readdirSync(dest), ['notes.txt']) }],
    ['the wrong version fails before anything is built', async () => {
      const r = await fails('S21', /9\.9\.9/, { version: '9.9.9' })
      assert.ok(!fs.existsSync(r.dest)) }],
    ['an uncommitted change to a file the run executes fails; docs and checks do not', async () => {
      const root = plugin()
      fs.appendFileSync(path.join(root, 'skills/run/SKILL.md'), '\n')
      fs.appendFileSync(path.join(root, 'skills/run/references/results.md'), '\n')
      fs.appendFileSync(path.join(root, 'skills/run/tests/check17.mjs'), '\n')
      await passes('S20', { root })
      fs.appendFileSync(path.join(root, 'skills/run/workflow.js'), '\n')
      await fails('S20', /skills\/run\/workflow\.js/, { root }) }],
    ['a failing check is named with its output tail', async () => {
      const root = plugin(d => fs.writeFileSync(path.join(d, 'skills/run/tests/fixture/build.test.sh'), 'echo the fixture self-check broke; exit 1\n'))
      await fails('S21', /FAIL .*build\.test\.sh[^]*the fixture self-check broke/, { root, extra: [] }) }],
    ['a check that fails once and then passes is retried, and the line says so', async () => {
      const root = plugin(d => { stub(d); fs.writeFileSync(path.join(d, 'skills/run/tests/check2.mjs'), "import fs from 'node:fs'\nif (!fs.existsSync('seen')) { fs.writeFileSync('seen', ''); console.error('timed out once'); process.exit(1) }") })
      const r = await passes('S20', { root, extra: [] })
      assert.match(r.out, /^ok   skills\/run\/tests\/check2\.mjs: passed on a retry, first[^]*timed out once/m) }],
    ['every check runs: build.test.sh, each check*.mjs and run-cmd.test.mjs; not report.test.mjs, red between scoring a run and the next snapshot', async () => {
      const root = plugin(stub)
      const r = await passes('S17-control', { root, extra: [] })
      const names = fs.readdirSync(path.join(root, 'skills/run/tests')).filter(f => /^check\d*\.mjs$/.test(f))
      assert.ok(names.length > 20)
      for (const f of [...names, 'build.test.sh', 'run-cmd.test.mjs']) assert.ok(r.out.split('\n').some(l => l.startsWith('ok ') && l.endsWith(f)), `no ok line for ${f}`)
      assert.ok(!/report\.test/.test(r.out)) }],
    ['S21: after, scoped gate, docsRepos []', async () => {
      const a = (await passes('S21')).args()
      assert.deepEqual([ws(a, 'alpha-discount').after, ws(a, 'alpha-discount').gate], [['alpha-cents'], SCOPED])
      assert.equal(ws(a, 'alpha-cents').gate, 'python3 -m unittest discover -s tests -t .')
      assert.ok(a.workstreams.every(w => !w.humanCheck))
      assert.deepEqual([a.docsRepos, a.cycles], [[], 1]) }],
    ['S18: as S21 but docs kept, plus the faulted copy with exactly one line changed', async () => {
      const r = await passes('S18'), a = r.args()
      assert.deepEqual([ws(a, 'alpha-discount').after, ws(a, 'alpha-discount').gate, a.docsRepos.length], [['alpha-cents'], SCOPED, 2])
      const [x, y] = ['workflow.js', 'workflow-fault.js'].map(f => fs.readFileSync(path.join(r.runDir, f), 'utf8').split('\n'))
      const changed = y.filter((l, i) => l !== x[i])
      assert.equal(x.length, y.length)
      assert.equal(changed.length, 1)
      assert.ok(changed[0].includes("opts.label.startsWith('alpha-discount review c1') ? null : await agent(")) }],
    ['S19: as S21 plus a humanCheck on both alpha workstreams, and the resume probes differ', async () => {
      const r = await passes('S19'), a = r.args()
      assert.deepEqual([ws(a, 'alpha-discount').after, ws(a, 'alpha-discount').gate, a.docsRepos], [['alpha-cents'], SCOPED, []])
      assert.deepEqual(a.workstreams.filter(w => typeof w.humanCheck === 'string' && w.humanCheck.trim()).map(w => w.id).sort(), ['alpha-cents', 'alpha-discount'])
      assert.match(r.out, /ok .*probe/)
      assert.ok(!fs.existsSync(path.join(r.runDir, 'workflow-fault.js'))) }],
    ['S20: skillDir filled, docsRepos [] and --skill-dir names the plugin under test', async () => {
      const skill = path.join(good, 'skills/run'), a = (await passes('S20', { extra: ['--skip-checks', '--skill-dir', skill] })).args()
      assert.deepEqual([a.skillDir, a.docsRepos], [skill, []]) }],
    ['S17-seeded: the oracle finds W1 W2 W3 W4', async () => { assert.match((await passes('S17-seeded')).out, /ok .*W1 W2 W3 W4/) }],
    ['S15-seeded and S15-control', async () => { await passes('S15-seeded'); await passes('S15-control') }],
    ['S27: one workstream, the log beside the clones, one cycle, no docs; the fault copy differs in one line, which holds both pre-pushed shas, and the output says to run it', async () => {
      const r = await passes('S27'), a = r.args(), [w] = a.workstreams, dest = fs.realpathSync(r.dest), alpha = path.join(dest, 'remotes/alpha.git')
      assert.deepEqual([a.workstreams.length, w.id, w.files], [1, 'alpha-receipt', ['ledger/receipt.py', 'tests/test_receipt.py']])
      assert.deepEqual([a.decisionLog, a.cycles, a.maxCycles, a.wbRounds, a.docsRepos, a.stage], [path.join(dest, 'decisions.md'), 1, 1, 0, [], undefined])
      const [x, y] = ['workflow.js', 'workflow-fault.js'].map(f => fs.readFileSync(path.join(r.runDir, f), 'utf8').split('\n')), changed = y.filter((l, i) => l !== x[i])
      assert.deepEqual([x.length, changed.length], [y.length, 1])
      for (const s of ['"alpha-receipt implement":', '"alpha-receipt review c1":', '"alpha-receipt fix c1":', git(alpha, 'rev-parse', 'feat/eval--alpha-receipt^'), git(alpha, 'rev-parse', 'feat/eval--alpha-receipt'), ')[opts.label] ?? await agent(']) assert.ok(changed[0].includes(s), s)
      assert.match(r.out, /^run .*workflow-fault\.js, never .*workflow\.js$/m) }],
    ['S28: the whole-branch stage on one workstream entry, docs on, no log; the fault copy hands over the planted docs commit', async () => {
      const r = await passes('S28'), a = r.args(), alpha = path.join(fs.realpathSync(r.dest), 'remotes/alpha.git')
      assert.deepEqual([a.workstreams.map(w => w.id), a.stage, a.wbRounds, a.docsRepos.length, a.decisionLog], [['alpha-discount'], 'wholeBranch', 0, 1, undefined])
      const [x, y] = ['workflow.js', 'workflow-fault.js'].map(f => fs.readFileSync(path.join(r.runDir, f), 'utf8').split('\n')), changed = y.filter((l, i) => l !== x[i])
      assert.deepEqual([x.length, changed.length], [y.length, 1])
      for (const s of ["opts.label === 'alpha docs' ? ", git(alpha, 'rev-parse', 'feat/eval'), git(alpha, 'rev-parse', 'feat/eval--docs'), ' : await agent(']) assert.ok(changed[0].includes(s), s)
      assert.match(r.out, /^run .*workflow-fault\.js, never .*workflow\.js$/m) }],
    ['a second agent call in step(), or none, means the S27 and S28 faults no longer apply once', async () => {
      for (const [from, to] of [['  unran[opts.label] = 0\n', '  unran[opts.label] = 0\n  if (opts.neverSet) await agent(prompt, opts)\n'], ['const r = await agent((n === 1', 'const r = await ask((n === 1']]) {
        const root = plugin(d => edit(d, 'skills/run/workflow.js', from, to))
        for (const s of ['S27', 'S28']) await fails(s, /FAIL call-1[^]*step\(\) holds [02] .*exactly one/, { root })
      } }],
    ['a renamed label of a forced step is caught (S27)', async () => {
      for (const [step, as] of [['implement', 'first implement'], ['review c${i}', 'own review c${i}'], ['fix c${i}', 'redo fix c${i}']]) // names the dry run's mock still answers
        await fails('S27', new RegExp(`FAIL .*forced steps[^]*alpha-receipt ${step.replace('${i}', '1')}: .*no such step`), { root: plugin(d => edit(d, 'skills/run/workflow.js', `{ label: \`\${tag} ${step}\`,`, `{ label: \`\${tag} ${as}\`,`)) }) }],
    ['a forced answer that no longer fits its step\'s schema is caught (S27): a required field, an unknown key, an enum, a pattern', async () => {
      for (const [from, to, re] of [["required: ['status', 'ok', 'sha', 'tests', 'gateTail', 'sharedEdits',", "required: ['status', 'ok', 'sha', 'branch', 'tests', 'gateTail', 'sharedEdits',", 'alpha-receipt implement: lacks branch'],
        ["    gateTail: { type: 'string'", "    gateEnd: { type: 'string'", 'alpha-receipt fix c1: unknown key gateTail'],
        ["action: { enum: ['fixed',", "action: { enum: ['repaired',", 'alpha-receipt fix c1: answers\\[0\\]: action: "fixed" is none of'],
        ["{40})?$', description: 'full 40-hex remote SHA verified via git ls-remote; empty", "{64})?$', description: 'full 40-hex remote SHA verified via git ls-remote; empty", 'alpha-receipt fix c1: sha: "[0-9a-f]{40}" is no string'],
      ]) await fails('S27', new RegExp(`FAIL .*schema[^]*${re}`), { root: plugin(d => edit(d, 'skills/run/workflow.js', from, to)) }) }],
    ['a fix commit that keeps the raise is caught (S27)', async () => {
      const root = plugin(d => edit(d, 'skills/run/tests/fixture/build.sh', "except ValueError:\\n        total_cents = total(entries)[\"total_cents\"]\\n'", "except ValueError:\\n        raise\\n'"))
      await fails('S27', /FAIL .*oracle/, { root }) }],
    ['a decision log inside the repo is caught (S27)', async () => {
      const build = 'skills/run/tests/fixture/build.sh'
      await fails('S27', /FAIL .*outside every repo[^]*feat\/eval/, { root: plugin(d => edit(d, build, 'elif [ "$mode" = decided ] && [ "$repo" = alpha ]; then', 'elif [[ "$mode" = decided || "$mode" = ruled ]] && [ "$repo" = alpha ]; then')) })
      await fails('S27', /FAIL .*outside every repo[^]*alpha\/decisions\.md/, { root: plugin(d => { edit(d, build, 'rulings > "$dest/decisions.md"', 'rulings > "$dest/alpha/decisions.md"'); edit(d, build, 'f"{dest}/decisions.md"', 'f"{alpha}/decisions.md"') }) }) }],
    ['a fix commit that names the log is caught (S27)', async () => {
      const root = plugin(d => edit(d, 'skills/run/tests/fixture/build.sh', '"""Receipt text."""', '"""Receipt text, see the decisions."""'))
      await fails('S27', /FAIL .*names the log/, { root }) }],
    ['a script that no longer puts the decision log in front of the agents is caught (S27)', async () => {
      const root = plugin(d => edit(d, 'skills/run/workflow.js', ': \'\'}${DECIDED}`', ": ''}`"))
      await fails('S27', /FAIL .*validate c1/, { root }) }],
    ['a drift audit that never runs is caught (S27)', async () => {
      const root = plugin(d => edit(d, 'skills/run/workflow.js', 'const driftWanted = !!A.decisionLog', 'const driftWanted = !!A.neverSet'))
      await fails('S27', /FAIL .*(drift|log path)/, { root }) }],
    ['a docs validator without the planted range is caught (S28)', async () => {
      const root = plugin(d => edit(d, 'skills/run/workflow.js', 'git fetch${FETCH}, then ${o.baseSha}..${o.sha} on the side branch', 'git fetch${FETCH}, then the head of the side branch'))
      await fails('S28', /FAIL .*docs validate/, { root }) }],
    ['a decision log without the ruling is caught (S27)', async () => {
      const root = plugin(d => edit(d, 'skills/run/tests/fixture/build.sh', 'An expired code is an error for every caller', 'An expired code is fine'))
      await fails('S27', /FAIL .*R3/, { root }) }],
    ['an oracle that names every receipt is caught (S27)', async () => {
      const root = plugin(d => edit(d, 'skills/run/tests/fixture/r3-oracle.sh', 'except Exception:\n    sys.exit()', 'except Exception:\n    pass'))
      await fails('S27', /FAIL .*oracle/, { root }) }],
    ['a README that states the condition, or code that lost it, is caught (S28)', async () => {
      const build = 'skills/run/tests/fixture/build.sh'
      await fails('S28', /FAIL .*README/, { root: plugin(d => edit(d, build, 'LEDGER_MAX_DISCOUNT off\'', 'LEDGER_MAX_DISCOUNT off under 100000\'')) })
      await fails('S28', /FAIL .*capped/, { root: plugin(d => edit(d, build, '    if amount < 100000:', '    if amount < 10 * 100000:')) }) }],
    ['a stale test that no longer fires is caught (S21)', async () => {
      const root = plugin(d => edit(d, 'skills/run/tests/fixture/build.sh', '"SAVE10")), ["total"])', '"SAVE10")), ["total_cents"])'))
      await fails('S21', /FAIL .*rename/, { root }) }],
    ['an S17 seed that no longer fires is caught', async () => {
      const root = plugin(d => edit(d, 'skills/run/tests/fixture/build.sh', 'owners.add(entry["owner"].casefold())', 'owners.add(entry["owner"])'))
      await fails('S17-seeded', /W1 W3 W4/, { root }) }],
    ['an S15 seed missing from feat/eval is caught', async () => {
      const root = plugin(d => edit(d, 'skills/run/tests/fixture/build.sh', "    if balance > limit:'", "    if limit <= balance:'"))
      await fails('S15-seeded', /D1/, { root }) }],
    ['a pinned half-even test that half up no longer breaks is caught (S20)', async () => {
      const root = plugin(d => edit(d, 'skills/run/tests/fixture/alpha/tests/test_rounding.py', '(1025, 1045, 1065)], [102, 104, 106]', '(1024, 1044, 1064)], [102, 104, 106]'))
      await fails('S20', /FAIL .*half/, { root }) }],
    ['a second agent call in step() means the S18 fault no longer applies once', async () => {
      const root = plugin(d => edit(d, 'skills/run/workflow.js', '  unran[opts.label] = 0\n', '  unran[opts.label] = 0\n  if (opts.neverSet) await agent(prompt, opts)\n'))
      await fails('S18', /exactly one/, { root }) }],
    ['a resume probe the cache could replay is caught (S19)', async () => {
      const root = plugin(d => edit(d, 'skills/run/workflow.js', '`Resume of run ${A.resume}, call ${CALL} (inputs ${inputs}): read', '`Resume of run ${A.resume}: read'))
      await fails('S19', /FAIL .*probe/, { root }) }],
    ['args the workflow rejects fail here', async () => {
      const root = plugin(d => edit(d, 'skills/run/workflow.js', "if (!W.length) throw new Error('args.workstreams is empty')", "if (!A.newlyRequired) throw new Error('args.newlyRequired is missing')"))
      await fails('S21', /args\.newlyRequired is missing/, { root }) }],
    ['a run dir that already holds a run is never overwritten', async () => {
      const runDir = fresh('run')
      fs.mkdirSync(runDir); fs.writeFileSync(path.join(runDir, 'workflow.js'), 'a live run')
      await fails('S20', /already holds workflow\.js/, { runDir })
      assert.equal(fs.readFileSync(path.join(runDir, 'workflow.js'), 'utf8'), 'a live run') }],
  ]
  await Promise.all(all.map(([name, fn]) => t.test(name, { timeout: 300000 }, fn)))
})

// ---- publish.sh, with a stand-in for Chrome ----
const chrome = path.join(tmp, 'chrome')
fs.writeFileSync(chrome, `#!/usr/bin/env bash
for a in "$@"; do case $a in --dump-dom) echo '<body data-size="10,10">' ;; --screenshot=*) echo png > "\${a#--screenshot=}" ;; esac; done
`, { mode: 0o755 })
const publish = root => run('bash', [path.join(root, 'evals/publish.sh')], { env: { ...process.env, CHROME: chrome } })

test('publish', par, async t => {
  // split, so this file itself never trips the rule it tests
  const telling = { 'a home path': `/${'Users'}/someone/code`, 'a linux home path': `/${'home'}/someone/x`, 'a session URL': `https://${'claude'}.ai/code/x`, 'a bare session link': `${'claude'}.ai/code/x`, 'an attribution line': `Co-${'Authored'}-By: x`, 'a credit line': `Generated ${'with'} x` }
  const all = [
    ['snapshots, tests, lists the changed files and the manual steps; commits and pushes nothing', async () => {
      const root = plugin(), head = git(root, 'rev-parse', 'HEAD')
      fs.writeFileSync(path.join(root, 'evals/retros/new one.md'), 'A retro.\n')
      fs.appendFileSync(path.join(root, 'skills/run/SKILL.md'), `/${'Users'}/someone/code\n`) // outside evals/ and README.md: not this script's business
      fs.writeFileSync(path.join(root, 'evals/rule.mjs'), `export const rule = /${'claude'}.ai\\//\n`) // a rule that names the host is no link
      const r = await publish(root)
      assert.equal(r.code, 0, r.out)
      for (const s of ['evals/png/summary.png', 'evals/retros/new one.md', 'git push', 'gh pr create', 'evals/report.html']) assert.ok(r.out.includes(s), `${s} missing from:\n${r.out}`)
      assert.ok(!/^\s*skills\//m.test(r.out), r.out)
      assert.equal(git(root, 'rev-parse', 'HEAD'), head)
      assert.equal(git(root, 'diff', '--cached', '--name-only'), '', 'nothing staged')
      assert.equal((await run(process.execPath, [path.join(root, 'evals/report.test.mjs')])).code, 0) }],
    ['an invalid run file stops it before the snapshot', async () => {
      const root = plugin()
      fs.writeFileSync(path.join(root, 'evals/runs/x.json'), '{}')
      const r = await publish(root)
      assert.notEqual(r.code, 0)
      assert.equal(git(root, 'status', '--porcelain'), '?? evals/runs/x.json') }],
    ...Object.entries(telling).map(([what, text]) => [`refuses ${what} in a changed file`, async () => {
      const root = plugin()
      fs.writeFileSync(path.join(root, 'evals/retros/new one.md'), `Seen at ${text}\n`)
      const r = await publish(root)
      assert.equal(r.code, 1, r.out)
      assert.ok(r.out.includes('evals/retros/new one.md') && !r.out.includes('git push'), r.out) }]),
    ['refuses without origin/main to compare with', async () => {
      const root = plugin()
      git(root, 'update-ref', '-d', 'refs/remotes/origin/main')
      const r = await publish(root)
      assert.notEqual(r.code, 0)
      assert.match(r.out, /origin\/main/) }],
  ]
  await Promise.all(all.map(([name, fn]) => t.test(name, { timeout: 300000 }, fn)))
})
