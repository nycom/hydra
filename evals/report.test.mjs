// Fails when report.html, the README eval block or report.sha256 are stale against evals/runs/,
// or when report.html / a PNG changed without a re-snapshot. Run evals/snapshot.sh to refresh them.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert'
import { ROOT, loadRuns, validate, buildHtml, readmeBlock, snapshotFiles, shaFile, withBlock, blockOf,
  passBar, latestPerScenario, previousOf, pickPipelineRun } from './report.mjs'

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8')
const entries = loadRuns()
const fix = 'stale: run evals/snapshot.sh'

// ---- schema ----
const seeded = entries.find(e => e.run.scenario === 'S15-seeded' && e.run.verdict === 'pass').run
const s16 = entries.find(e => e.run.scenario === 'S16').run
const caught = (stage = 'reviewer') => ({ caught: true, stage, findingId: 'F1' })
const missed = { caught: false, stage: null, findingId: null }
const discarded = { caught: null, discarded: true }
const allCaught = () => Object.fromEntries(['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8'].map(d => [d, caught(d === 'D8' ? 'test-guard' : 'reviewer')]))
const variant = (base, mut) => { const r = structuredClone(base); mut(r); return r }
const good = (mut, bar) => { const r = variant(seeded, mut); validate(r, 'x.json'); if (bar) assert.equal(passBar(r), bar) }
const bad = (mut, re, base = seeded) => assert.throws(() => validate(variant(base, mut), 'x.json'), re)

good(r => { r.defects = allCaught(); r.defects.D2 = discarded; r.recall = 1; r.verdict = 'pass' }, 'pass')
good(r => { r.defects = allCaught(); r.defects.D1 = discarded; r.defects.D2 = missed; r.recall = 6 / 7; r.verdict = 'pass' }, 'pass')
good(r => { r.defects = allCaught(); r.defects.D4 = discarded; r.recall = 1; r.verdict = 'void' }, 'void')
good(r => { r.defects = allCaught(); r.defects.D2 = missed; r.defects.D3 = missed; r.recall = 6 / 8; r.verdict = 'fail' }, 'fail')
good(r => { r.defects = allCaught(); r.defects.D6 = caught('contract'); r.defects.D8 = caught('reviewer'); r.recall = 1; r.verdict = 'pass' }, 'pass')

bad(r => { r.recall = 1 }, /recall must be/)
bad(r => { r.defects = allCaught(); r.defects.D1 = discarded; r.defects.D2 = missed; r.recall = 6 / 8; r.verdict = 'pass' }, /recall must be caught\/kept = 0\.857/)
bad(r => { r.defects = allCaught(); r.defects.D4 = discarded; r.recall = 1; r.verdict = 'pass' }, /verdict must be void/)
bad(r => { r.defects = allCaught(); r.defects.D4 = missed; r.recall = 7 / 8; r.verdict = 'pass' }, /verdict must be fail/)
bad(r => { r.defects.D1 = { caught: true, discarded: true, stage: 'reviewer', findingId: 'F1' } }, /D1/)
bad(r => { r.defects.D1 = { caught: true, stage: 'linter', findingId: 'F1' } }, /D1/)
bad(r => { r.defects.D2 = { caught: false, stage: 'reviewer', findingId: null } }, /D2/)
bad(r => { r.defects.D8 = caught('validator') }, /D8 can only be caught by test-guard or reviewer/)
bad(r => { r.defects.D6 = caught('test-guard') }, /D6 can only be caught by reviewer, validator or contract/)
bad(r => { delete r.defects.D8 }, /exactly D1..D8/)
bad(r => { r.scenario = 'S17' }, /scenario/)
bad(r => { r.cost.byStage.review.tokens += 1 }, /sum to outputTokens/)
bad(r => { r.verdict = 'void' }, /verdict must be (pass|fail) \(the scenario/, s16)

// ---- run picking ----
const run = (id, scenario, hydraVersion, date, stagesRun) => variant(seeded, r => {
  Object.assign(r, { id, scenario, hydraVersion, date })
  Object.keys(r.cost.byStage).forEach((s, i) => { r.cost.byStage[s].agents = i < stagesRun ? 1 : 0 })
})
const full = run('a-seeded', 'S15-seeded', '0.3.1', '2026-11-19', 8)
const blocked = run('b-s16', 'S16', '0.3.1', '2026-11-19', 1)
assert.equal(pickPipelineRun([full, blocked]).id, 'a-seeded', 'pipeline must prefer the run that ran the most stages')
assert.equal(pickPipelineRun([blocked]).id, 'b-s16', 'pipeline falls back to the newest run')
assert.equal(pickPipelineRun([run('old', 'S15-control', '0.3.0', '2026-11-01', 8), full]).id, 'a-seeded', 'ties go to the newest run')
assert.equal(pickPipelineRun([]), undefined)

const old = run('o-seeded', 'S15-seeded', '0.3.0', '2026-11-10', 8), oldCtrl = run('o-ctrl', 'S15-control', '0.3.0', '2026-11-11', 8)
const s16Only = run('n-s16', 'S16', '0.3.1', '2026-11-20', 1)
assert.deepEqual(latestPerScenario([old, oldCtrl, s16Only]).map(r => r.id), ['o-seeded', 'o-ctrl', 'n-s16'], 'a version that re-ran only S16 must not hide the S15 tiles')
assert.equal(previousOf([old, full], full).id, 'o-seeded')
assert.equal(previousOf([old, full], old), undefined)

// ---- README block ----
assert.equal(readmeBlock(entries.map(e => ({ ...e, run: { ...e.run, demo: true } }))),
  '<!-- eval:start -->\nEval results land with the first live S15/S16 run — see [evals/](evals/).\n<!-- eval:end -->')
const live = readmeBlock(entries.map(e => ({ ...e, run: { ...e.run, demo: false } })))
const at = s => { const i = live.indexOf(s); assert.ok(i >= 0, `live README block lacks ${s}`); return i }
assert.ok(at('**Latest eval:**') < at('evals/png/scorecard.png'))
assert.ok(at('evals/png/scorecard.png') < at('evals/png/heatmap.png'))
assert.ok(at('evals/png/heatmap.png') < at('<details><summary>More charts</summary>'))
assert.ok(at('<details><summary>More charts</summary>') < at('evals/png/cost.png'))
assert.ok(at('evals/png/pipeline.png') < at('</details>'))
at('open locally (GitHub shows source)')
assert.ok(!/[0-9a-f]{64}/.test(live), 'README block carries no hash')

// ---- block placement: inserted under the first line once, replaced in place after ----
const b = '<!-- eval:start -->\nX\n<!-- eval:end -->'
const once = withBlock('# t\n\nfirst line.\n\n## More\n', b)
assert.equal(once, `# t\n\nfirst line.\n\n${b}\n\n## More\n`)
assert.equal(withBlock(once, b.replace('X', 'Y')), once.replace('X', 'Y'))

// ---- staleness (last, so a logic failure above names itself) ----
assert.equal(read('evals/report.html'), buildHtml(entries), `evals/report.html ${fix}`)
const block = blockOf(read('README.md'))
assert.ok(block, 'README has no <!-- eval:start --> ... <!-- eval:end --> block; run evals/snapshot.sh')
assert.equal(block, readmeBlock(entries), `README eval block ${fix}`)
const recorded = Object.fromEntries(read('evals/report.sha256').trim().split('\n').map(l => l.split('  ').reverse()))
const expected = shaFile(snapshotFiles(entries))
for (const [file, hash] of Object.entries(expected.hashes)) {
  assert.equal(recorded[file], hash, `${file} does not match its hash in evals/report.sha256; ${fix}`)
}
assert.equal(read('evals/report.sha256'), expected.text, `evals/report.sha256 ${fix}`)
assert.ok(/^# .*\n\n[^\n]+\n\n<!-- eval:start -->/.test(read('README.md')), 'eval block must sit right under the README title and first line')

console.log(`ok: report.html, README block, report.sha256 and PNG hashes match ${entries.length} runs; schema, run picking and block checks pass`)
