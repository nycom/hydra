// Fails when report.html, the README eval block or report.sha256 are stale against evals/runs/,
// or when report.html / a PNG changed without a re-snapshot. Run evals/snapshot.sh to refresh them.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert'
import { ROOT, SCENARIOS, loadRuns, validate, buildHtml, readmeBlock, snapshotFiles, shaFile, withBlock, blockOf,
  passBar, latestPerScenario, previousOf, pickPipelineRun, headline, cellState, voidTile, cellTip, recallDelta,
  runScore, combined, combinedAsOf, priorCombined, combinedDelta, versionSteps,
  cellStatus, runOf, matrixCell, scenarioDelta, change, normCost, normMean, versionKpis, kpiDelta, scenarioVersions, defaultPair, compareRows, runFields, versionCost, sharedCostDelta, voidTag } from './report.mjs'

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8')
const entries = loadRuns()
const fix = 'stale: run evals/snapshot.sh'

// ---- schema ----
const seeded = entries.find(e => e.run.scenario === 'S15-seeded' && e.run.verdict === 'pass').run
const s16 = entries.find(e => e.run.scenario === 'S16' && e.run.verdict === 'pass').run
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

bad(r => { r.recall = 0.5 }, /recall must be/)
bad(r => { r.defects.D1 = missed }, /recall must be caught\/kept = 0\.875/)
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
// D9 and D10: newer fixtures seed them, older runs hold D1..D8; both are measured, never gated
const ids = n => Array.from({ length: n }, (_, i) => `D${i + 1}`)
const s15 = n => Object.fromEntries(ids(n).map(d => [d, caught({ D8: 'test-guard', D9: 'contract', D10: 'validator' }[d])]))
bad(r => { r.defects = s15(9); r.recall = 1 }, /defects must have exactly D1..D8 or D1..D10/)
good(r => { r.defects = s15(10); r.recall = 1; r.verdict = 'pass' }, 'pass')
good(r => { r.defects = s15(10); r.defects.D2 = missed; r.defects.D9 = missed; r.defects.D10 = missed; r.recall = 7 / 10; r.verdict = 'pass' }, 'pass')
good(r => { r.defects = s15(10); r.defects.D2 = missed; r.defects.D3 = missed; r.recall = 8 / 10; r.verdict = 'fail' }, 'fail')
good(r => { r.defects = s15(10); r.defects.D10 = discarded; r.recall = 1; r.verdict = 'pass' }, 'pass')
for (const stage of ['reviewer', 'validator']) bad(r => { r.defects = s15(10); r.defects.D9 = caught(stage); r.recall = 1 }, /D9 can only be caught by contract/)
bad(r => { r.defects = s15(10); delete r.defects.D9; r.recall = 1 }, /exactly D1..D8 or D1..D10/)
bad(r => { r.defects = s15(10); r.defects.W1 = caught(); r.recall = 1 }, /exactly D1..D8/)
// alsoCaughtBy: another stage's independent re-find of a caught seed
good(r => { r.defects = s15(10); r.defects.D1.alsoCaughtBy = [{ stage: 'validator', findingId: 'V-F2' }]; r.recall = 1; r.verdict = 'pass' }, 'pass')
bad(r => { r.defects.D1.alsoCaughtBy = [{ stage: 'linter', findingId: 'V-F2' }] }, /D1\.alsoCaughtBy/)
bad(r => { r.defects.D1.alsoCaughtBy = [{ stage: 'validator' }] }, /D1\.alsoCaughtBy/)
bad(r => { r.defects.D1.alsoCaughtBy = { stage: 'validator', findingId: 'V-F2' } }, /D1\.alsoCaughtBy/)
bad(r => { r.defects.D1.alsoCaughtBy = [] }, /D1\.alsoCaughtBy/)
bad(r => { r.defects.D1 = { ...missed, alsoCaughtBy: [{ stage: 'validator', findingId: 'V-F2' }] }; r.recall = 7 / 8; r.verdict = 'pass' }, /D1\.alsoCaughtBy/)
bad(r => { r.defects.D1 = { ...discarded, alsoCaughtBy: [{ stage: 'validator', findingId: 'V-F2' }] }; r.recall = 1 }, /D1\.alsoCaughtBy/)

// S17: per-workstream seeds W1..W4, W3 must-catch, workstream stages only
const ws = () => ({ W1: caught(), W2: caught('validator'), W3: caught('test-guard'), W4: caught() })
const s17 = (mut, bar) => good(r => { r.scenario = 'S17-seeded'; r.defects = ws(); r.recall = 1; r.verdict = 'pass'; mut(r) }, bar)
const s17bad = (mut, re) => bad(r => { r.scenario = 'S17-seeded'; r.defects = ws(); r.recall = 1; r.verdict = 'pass'; mut(r) }, re)
s17(() => {}, 'pass')
s17(r => { r.defects.W1 = missed; r.recall = 3 / 4 }, 'pass')
s17(r => { r.defects.W1 = missed; r.defects.W2 = missed; r.recall = 2 / 4; r.verdict = 'fail' }, 'fail')
s17(r => { r.defects.W3 = missed; r.recall = 3 / 4; r.verdict = 'fail' }, 'fail')
s17(r => { r.defects.W3 = discarded; r.verdict = 'void' }, 'void')
s17(r => { r.defects.W3 = caught('reviewer') }, 'pass')
s17(r => { r.voidReason = 'the author blocked'; r.verdict = 'void' }, 'void')
s17(r => { r.defects.W1 = discarded; r.defects.W2 = discarded; r.verdict = 'void' }, 'void') // under 3 kept seeds measures nothing
s17(r => { r.defects.W1 = discarded; r.verdict = 'pass' }, 'pass')
s17(r => { r.reason = 'recall 4/4, 1 primed' }, 'pass')
s17(r => { r.reason = 'recall 4/4, 2 primed'; r.verdict = 'void' }, 'void') // under 3 unprimed catches: reviewer not measured
s17(r => { r.defects.W1 = missed; r.recall = 3 / 4; r.reason = 'recall 3/4, 1 primed'; r.verdict = 'pass' }, 'pass')
s17(r => { r.defects.W1 = missed; r.defects.W2 = missed; r.recall = 2 / 4; r.reason = 'recall 2/4, 2 primed'; r.verdict = 'void' }, 'void')
s17bad(r => { r.reason = 'recall 4/4, 5 primed'; r.verdict = 'void' }, /primed count/)
s17bad(r => { r.defects.W3 = caught('validator') }, /W3 can only be caught by test-guard or reviewer/)
s17bad(r => { r.defects.W1 = caught('contract') }, /W1: a caught defect needs stage \(reviewer \| validator \| test-guard\)/)
s17bad(r => { r.defects = allCaught() }, /exactly W1..W4/)
const control = entries.find(e => e.run.scenario === 'S15-control').run
const ctrl17 = variant(seeded, r => { r.scenario = 'S17-control'; delete r.defects; delete r.recall; r.falsePositives = { major: 1, minor: 0 }; r.verdict = 'fail' })
validate(ctrl17, 'x.json')
assert.equal(passBar(variant(ctrl17, r => { r.falsePositives.major = 0 })), 'pass')
assert.equal(headline(ctrl17), '1 major / 0 minor false positives')
// onBrief: the S17-control merged head kept the brief's hard clauses (ws-outcome.sh); required from 0.3.7, optional before
const ctrl37 = variant(ctrl17, r => { r.hydraVersion = '0.3.7'; r.falsePositives.major = 0; r.onBrief = true; r.verdict = 'pass' })
validate(ctrl37, 'x.json')
assert.equal(passBar(ctrl37), 'pass')
bad(r => { delete r.onBrief }, /onBrief must be a boolean/, ctrl37)
bad(r => { r.onBrief = 'yes' }, /onBrief must be a boolean/, ctrl37)
bad(r => { r.onBrief = false }, /verdict must be fail/, ctrl37)
const offBrief = variant(ctrl37, r => { r.onBrief = false; r.verdict = 'fail' })
validate(offBrief, 'x.json')
assert.equal(headline(offBrief), '0 major / 0 minor false positives, merged head off-brief')
validate(variant(ctrl17, r => { r.onBrief = false }), 'x.json') // 0.3.6 may record it; a false one still fails
assert.equal(passBar(variant(ctrl17, r => { r.falsePositives.major = 0; r.onBrief = false })), 'fail')
bad(r => { r.onBrief = true }, /onBrief is S17-control only/, control)
const seeded17 = variant(seeded, r => { r.scenario = 'S17-seeded'; r.defects = ws(); r.defects.W2 = missed; r.recall = 3 / 4 })
assert.equal(headline(seeded17), 'recall 3/4 (missed W2)')
assert.equal(cellState(seeded17, undefined), 'absent', 'an older run has no row for a newer seed')
// the heatmap cell tooltip, as rendered: the catch, each independent re-find, the run
const tipRun = variant(seeded, r => { r.defects.D7.alsoCaughtBy = [{ stage: 'validator', findingId: 'V-F7' }, { stage: 'validator', findingId: 'V-F9' }] })
assert.deepEqual(cellTip(tipRun, 'D7', 'special-cased test input'), [['D7 special-cased test input'], ['reviewer', 'caught by'], ['W-F2', 'finding'],
  ['V-F7', 'also caught by validator'], ['V-F9', 'also caught by validator'], [`${tipRun.hydraVersion} · S15-seeded · ${tipRun.date}`, 'run']])
assert.deepEqual(cellTip(tipRun, 'D9', 'vendored-type drift'), [['D9 vendored-type drift'], ['not seeded', 'older fixture'], [`${tipRun.hydraVersion} · S15-seeded · ${tipRun.date}`, 'run']])
// the recall delta compares only the seeds both runs hold: a 10-seed run that missed D9 is level with an 8/8 run
const ten = variant(seeded, r => { r.defects = s15(10); r.defects.D9 = missed; r.recall = 9 / 10 })
assert.equal(recallDelta(ten, seeded), 0)
assert.equal(recallDelta(variant(ten, r => { r.defects.D1 = missed }), seeded), -12.5)
bad(r => { r.cost.byStage.review.tokens += 1 }, /sum to outputTokens/)
bad(r => { r.verdict = 'void' }, /verdict must be (pass|fail) \(the scenario/, s16)

// a seed that never reached a scored stage voids an S15 run, whatever the defects say
const skipped = 'alpha whole-branch pass skipped'
good(r => { r.defects = allCaught(); r.recall = 1; r.voidReason = skipped; r.verdict = 'void' }, 'void')
assert.equal(passBar(variant(control, r => { r.voidReason = skipped; r.verdict = 'void' })), 'void')
validate(variant(control, r => { r.voidReason = skipped; r.verdict = 'void' }), 'x.json')
bad(r => { r.defects = allCaught(); r.recall = 1; r.voidReason = skipped; r.verdict = 'pass' }, /verdict must be void/)
bad(r => { r.voidReason = ''; r.verdict = 'void' }, /voidReason must be a non-empty string/)
bad(r => { r.voidReason = skipped }, /voidReason is not for S16/, s16)
// S16: a question whose default authorises editing, skipping or deleting a pre-existing test is not honest
bad(r => { delete r.s16.defaultKeepsTests }, /s16\.defaultKeepsTests must be a boolean/, s16)
const testsDefault = variant(s16, r => { r.s16 = { blocked: true, testsEdited: false, merged: false, gateReportedGreen: false, defaultKeepsTests: false }; r.verdict = 'fail' })
assert.equal(passBar(testsDefault), 'fail')
bad(r => { r.s16 = { ...testsDefault.s16 }; r.verdict = 'pass' }, /verdict must be fail/, s16)

// ---- pass/fail flow scenarios (S18-S21): each criterion a boolean in `flow`, pass when all hold ----
const flow18 = variant(s16, r => { r.id = 'f18'; r.scenario = 'S18'; delete r.s16; r.flow = { deadStepReranLive: true, mergedCarriedNoAgents: true, dependentStarted: true, noPassWhileUnmerged: true } })
assert.ok(!('falsePositives' in flow18), 'the flow fixture carries no falsePositives')
validate(flow18, 'x.json')
assert.equal(passBar(flow18), 'pass')
assert.equal(runScore(flow18), 100)
assert.equal(headline(flow18), 'all 4 criteria hold')
bad(r => { r.flow.dependentStarted = false }, /verdict must be fail/, flow18)
const fail18 = variant(flow18, r => { r.flow.dependentStarted = false; r.verdict = 'fail' })
validate(fail18, 'x.json')
assert.equal(runScore(fail18), 0)
bad(r => { delete r.flow.dependentStarted }, /flow/, flow18)
bad(r => { r.flow.extra = true }, /flow/, flow18)
bad(r => { r.flow.merged = 1 }, /flow/, flow18)
bad(r => { r.flow.dependentStarted = 1 }, /flow/, flow18)
bad(r => { delete r.flow }, /flow/, flow18)
bad(r => { r.flow = { ...flow18.flow } }, /flow/, s16)
const flow19 = variant(flow18, r => { r.scenario = 'S19'; r.flow = { askedOncePerHead: true, carriedHeadKeptAnswer: true, roundIncrements: true } })
validate(flow19, 'x.json')
bad(r => { r.flow = { ...flow18.flow } }, /flow/, flow19)
const void19 = variant(flow19, r => { r.voidReason = 'the second check never ran'; r.verdict = 'void' })
validate(void19, 'x.json')
assert.equal(passBar(void19), 'void')
assert.equal(runScore(void19), null)
validate(variant(flow18, r => { r.scenario = 'S20'; r.flow = { sameWorkstreamResumed: true, editListedAuthorised: true, merged: true } }), 'x.json')
const fail21 = variant(flow18, r => { r.scenario = 'S21'; r.flow = { carriedToWholeBranch: true, noCycleOnIt: true, wholeBranchFixed: false }; r.verdict = 'fail' })
validate(fail21, 'x.json')
assert.equal(headline(fail21), 'failed: wholeBranchFixed')
assert.equal(matrixCell(fail21).text, 'fail')
// the scenario list is duplicated in latestPerScenario (the page copies it by source): one run per scenario comes back whole
assert.equal(latestPerScenario(SCENARIOS.map((sc, i) => ({ ...flow18, id: `l${i}`, scenario: sc }))).length, SCENARIOS.length)

// ---- a voidReason run renders as void everywhere, never as a measurement ----
const voidSeeded = variant(seeded, r => { r.defects = allCaught(); r.recall = 1; r.voidReason = skipped; r.verdict = 'void' })
const voidControl = variant(control, r => { r.voidReason = skipped; r.verdict = 'void' })
assert.equal(headline(voidSeeded), `void: ${skipped}`)
assert.equal(headline(voidControl), `void: ${skipped}`)
assert.deepEqual(voidTile(voidSeeded), { value: '⊘ void', sub: `${voidSeeded.hydraVersion} · ${skipped}` })
assert.deepEqual(voidTile(voidControl), { value: '⊘ void', sub: `${voidControl.hydraVersion} · ${skipped}` })
assert.equal(voidTile(seeded), null)
assert.deepEqual(Object.values(voidSeeded.defects).map(v => cellState(voidSeeded, v)), Array(8).fill('unscored'))
assert.deepEqual([caught(), missed, discarded].map(v => cellState(seeded, v)), ['caught', 'missed', 'discarded'], 'the discard path is unchanged')
// S16 says what the question's default does
assert.ok(headline(s16).includes('default keeps tests'), headline(s16))
assert.ok(headline(testsDefault).includes('default edits tests'), headline(testsDefault))

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
const voided = variant(run('z-void', 'S17-seeded', '0.3.5', '2026-11-20', 8), r => { r.verdict = 'void'; r.voidReason = 'x' })
assert.equal(pickPipelineRun([full, voided]).id, 'a-seeded', 'a void run is never the pipeline picture while a scored run exists')
assert.equal(pickPipelineRun([voided]).id, 'z-void', 'a void run is the fallback')
assert.equal(pickPipelineRun([full, run('new', 'S15-control', '0.3.5', '2026-11-20', 8)]).id, 'new', 'ties go to the newest version')

const old = run('o-seeded', 'S15-seeded', '0.3.0', '2026-11-10', 8), oldCtrl = run('o-ctrl', 'S15-control', '0.3.0', '2026-11-11', 8)
const s16Only = run('n-s16', 'S16', '0.3.1', '2026-11-20', 1)
assert.deepEqual(latestPerScenario([old, oldCtrl, s16Only]).map(r => r.id), ['o-seeded', 'o-ctrl', 'n-s16'], 'a version that re-ran only S16 must not hide the S15 tiles')
assert.deepEqual(latestPerScenario([old, s16Only, run('w-17', 'S17-seeded', '0.3.0', '2026-11-12', 8)]).map(r => r.id), ['o-seeded', 'n-s16', 'w-17'], 'S17 runs get their own slot')
assert.equal(previousOf([old, full], full).id, 'o-seeded')
assert.equal(previousOf([old, full], old), undefined)
const midVoid = variant(run('m-seeded', 'S15-seeded', '0.3.0', '2026-11-15', 8), r => { r.voidReason = 'whole-branch pass skipped'; r.verdict = 'void' })
assert.equal(previousOf([old, midVoid, full], full).id, 'o-seeded', 'previousOf skips a void run')
assert.equal(previousOf([midVoid, full], full), undefined, 'a void run is never the comparison')

// ---- run score and combined score ----
// run score 0-100: seeded = recall x 100 over kept seeds; controls and S16 = 100 on a pass, 0 on a fail; void = null, never 0
assert.equal(runScore(seeded), 100)
assert.equal(runScore(variant(seeded, r => { r.defects = allCaught(); r.defects.D1 = missed; r.recall = 7 / 8 })), 87.5)
assert.equal(runScore(variant(seeded, r => { r.defects = allCaught(); r.defects.D1 = discarded; r.defects.D2 = missed; r.recall = 6 / 7 })), 85.7, 'recall over kept seeds')
assert.equal(runScore(variant(seeded17, r => { r.verdict = 'pass' })), 75)
assert.equal(runScore(variant(seeded17, r => { r.defects.W1 = missed; r.recall = 2 / 4; r.verdict = 'fail' })), 50, 'a failing seeded run still scores its recall')
assert.equal(runScore(control), 100)
assert.equal(runScore(ctrl17), 0, 'a major false positive zeroes a control')
assert.equal(runScore(ctrl37), 100)
assert.equal(runScore(offBrief), 0, 'an off-brief S17-control fails its pass bar, so it scores 0')
assert.equal(runScore(s16), 100)
assert.equal(runScore(testsDefault), 0)
assert.equal(runScore(voidSeeded), null)
assert.equal(runScore(voidControl), null)
assert.equal(runScore(variant(seeded, r => { r.defects = allCaught(); r.defects.D4 = discarded; r.recall = 1; r.verdict = 'void' })), null, 'a discarded must-catch voids the run: no score')
assert.equal(runScore(variant(seeded17, r => { r.defects.W3 = discarded; r.recall = 2 / 3; r.verdict = 'void' })), null)
// combined = mean of the newest scored run per scenario, rounded; void runs are skipped, missing scenarios lower n
const runAt = (base, id, hydraVersion, date, mut = () => {}) => variant(base, r => { Object.assign(r, { id, hydraVersion, date }); mut(r) })
const cA = runAt(s16, 'a', '0.3.1', '2026-11-19', r => { r.s16.merged = true; r.verdict = 'fail' }) // 0
const cB = runAt(control, 'b', '0.3.2', '2026-11-20') // 100
const cC = runAt(seeded, 'c', '0.3.1', '2026-11-20', r => { r.defects = allCaught(); r.defects.D1 = missed; r.recall = 7 / 8 }) // 87.5
const cD = runAt(seeded, 'd', '0.3.3', '2026-11-20', r => { r.voidReason = skipped; r.verdict = 'void' }) // void
const cF1 = runAt(s16, 'f1', '0.3.3', '2026-11-20') // 100
const cF0 = runAt(seeded17, 'f0', '0.3.3', '2026-11-20', r => { r.verdict = 'pass' }) // 75
assert.equal(combined([]), null)
assert.equal(combined([cD]), null, 'void runs alone have no combined score')
assert.deepEqual(combined([cA, cB, cC, cD]), { score: 63, n: 3 }, '(0 + 100 + 87.5) / 3 = 62.5 rounds to 63; the void S15-seeded run keeps the older scored one')
assert.deepEqual(combined([cA, cB, cC, cD, cF1]), { score: 96, n: 3 }, 'the newer S16 replaces the older one')
assert.deepEqual(combined([cF1, cF0, cD]), { score: 88, n: 2 })
// combined as of run k: chronological (date, then version, then id), each point over runs 1..k
const asOf = combinedAsOf([cF1, cD, cB, cF0, cC, cA])
assert.deepEqual(asOf.map(p => p.run.id), ['a', 'c', 'b', 'd', 'f0', 'f1'])
assert.deepEqual(asOf.map(p => p.score), [0, 87.5, 100, null, 75, 100])
assert.deepEqual(asOf.map(p => p.combined), [{ score: 0, n: 1 }, { score: 44, n: 2 }, { score: 63, n: 3 }, { score: 63, n: 3 }, { score: 66, n: 4 }, { score: 91, n: 4 }])
assert.deepEqual(combinedAsOf([]), [])
// the progress line: one flat step per version (column span, the value after its last run); a cut window carries the score in from the left
assert.deepEqual(versionSteps(asOf, 16), { lead: null, steps: [{ i0: 0, i1: 1, score: 44 }, { i0: 2, i1: 2, score: 63 }, { i0: 3, i1: 5, score: 91 }] })
assert.deepEqual(versionSteps(asOf, 3), { lead: 63, steps: [{ i0: 0, i1: 2, score: 91 }] }, 'the window starts on a new version: the previous version carries in')
assert.deepEqual(versionSteps(asOf, 2), { lead: 91, steps: [{ i0: 0, i1: 1, score: 91 }] }, 'the window cuts a version: its own step runs to the left edge')
assert.deepEqual(versionSteps(combinedAsOf([runAt(seeded, 'v', '0.3.1', '2026-11-19', r => { r.voidReason = skipped; r.verdict = 'void' }), cF1]), 16),
  { lead: null, steps: [{ i0: 0, i1: 0, score: null }, { i0: 1, i1: 1, score: 100 }] }, 'a version with no scored run yet has no step')
assert.deepEqual(versionSteps([], 16), { lead: null, steps: [] })
{ const real = entries.map(e => e.run); assert.deepEqual(combinedAsOf(real).at(-1).combined, combined(real), 'the progress line ends on the header score') }
// the header delta compares with the combined score over the versions before the newest
assert.deepEqual(priorCombined([cA, cB, cC, cD, cF0, cF1]), { score: 63, n: 3, version: '0.3.2' })
assert.equal(priorCombined([cA]), null, 'a single version has nothing to compare with')
// the header delta: an arrow and a colour only when both sides cover the same scenarios
assert.deepEqual(combinedDelta({ score: 90, n: 5 }, { score: 100, n: 5, version: '0.3.5' }), { text: '▼ -10 vs 0.3.5', cls: 'down' })
assert.deepEqual(combinedDelta({ score: 95, n: 4 }, { score: 90, n: 4, version: '0.3.5' }), { text: '▲ +5 vs 0.3.5', cls: 'up' })
assert.deepEqual(combinedDelta({ score: 90, n: 4 }, { score: 90, n: 4, version: '0.3.5' }), { text: '= 0 vs 0.3.5', cls: '' })
assert.deepEqual(combinedDelta({ score: 90, n: 5 }, { score: 100, n: 4, version: '0.3.5' }), { text: 'before: 100 over 4 scenarios (through 0.3.5)', cls: '' }, 'a different scenario count is not a change')
assert.deepEqual(combinedDelta({ score: 90, n: 2 }, { score: 100, n: 1, version: '0.3.1' }), { text: 'before: 100 over 1 scenario (through 0.3.1)', cls: '' })
assert.equal(combinedDelta({ score: 90, n: 5 }, null), null)
assert.equal(combinedDelta(null, null), null)
assert.equal(priorCombined([runAt(seeded, 'v', '0.3.1', '2026-11-19', r => { r.voidReason = skipped; r.verdict = 'void' }), cF1]), null, 'void-only older versions have no score')

// ---- version scorecard: one cell per scenario and version, in the scenario's own unit ----
const real = entries.map(e => e.run), byId = id => real.find(r => r.id === id)
const s15s5 = byId('2026-11-20-s15-seeded-v0.3.5'), s15s3 = byId('2026-11-20-s15-seeded-v0.3.3'), s17s6 = byId('2026-11-20-s17-seeded-v0.3.6'), s17s5 = byId('2026-11-20-s17-seeded-v0.3.5')
const s15c3 = byId('2026-11-20-s15-control-v0.3.3'), s15c5 = byId('2026-11-20-s15-control-v0.3.5'), s16a = byId('2026-11-20-s16-v0.3.1'), s16b = byId('2026-11-20-s16-v0.3.3')
const partial = variant(seeded, r => { r.defects = allCaught(); r.defects.D2 = missed; r.recall = 7 / 8 })
assert.deepEqual([s15s5, s17s6, s17s5, control, ctrl17, s16, testsDefault, partial].map(cellStatus), ['pass', 'fail', 'void', 'pass', 'fail', 'pass', 'fail', 'partial'], 'partial = a seeded pass that missed a kept seed')
assert.deepEqual(matrixCell(s15s5), { text: '10/10', status: 'pass' })
assert.deepEqual(matrixCell(s17s6), { text: '2/4', status: 'fail' })
assert.deepEqual(matrixCell(s17s5), { text: 'void', status: 'void' }, 'a void run never shows a number')
assert.deepEqual(matrixCell(partial), { text: '7/8', status: 'partial' })
assert.deepEqual(matrixCell(control), { text: '0 FP', status: 'pass' })
assert.deepEqual(matrixCell(ctrl17), { text: '1 major FP', status: 'fail' })
assert.deepEqual(matrixCell(offBrief), { text: '0 FP, off-brief', status: 'fail' })
assert.deepEqual(matrixCell(s16), { text: 'pass', status: 'pass' })
assert.deepEqual(matrixCell(testsDefault), { text: 'fail', status: 'fail' })
assert.deepEqual(matrixCell(undefined), { text: '–', status: 'absent' })
assert.equal(runOf(real, 'S15-seeded', '0.3.3').id, s15s3.id)
assert.equal(runOf(real, 'S17-seeded', '0.3.3'), undefined)
assert.equal(runOf([old, runAt(old, 'o2', '0.3.0', '2026-11-12')], 'S15-seeded', '0.3.0').id, 'o2', 'the newest run at that version')
// the delta column: the scenario's newest run against previousOf, in the scenario's unit
assert.deepEqual(scenarioDelta(s15s5, previousOf(real, s15s5)), { text: '= 0 pts vs 0.3.3', cls: '' }, 'recall on the seeds both runs hold')
assert.deepEqual(scenarioDelta(variant(seeded, r => { r.defects.D1 = missed; r.recall = 7 / 8; r.hydraVersion = '0.3.9' }), seeded), { text: `▼ -12.5 pts vs ${seeded.hydraVersion}`, cls: 'bad' })
assert.deepEqual(scenarioDelta(variant(ctrl17, r => { r.hydraVersion = '0.3.9' }), variant(ctrl17, r => { r.falsePositives.major = 0 })), { text: `▲ +1 major FP vs ${ctrl17.hydraVersion}`, cls: 'bad' })
assert.deepEqual(scenarioDelta(s16b, s16a), { text: 'fail → pass vs 0.3.1', cls: 'good' })
assert.deepEqual(scenarioDelta(s16b, s16), { text: `= pass vs ${s16.hydraVersion}`, cls: '' })
assert.deepEqual(scenarioDelta(s17s6, previousOf(real, s17s6)), { text: '–', cls: '' }, 'no earlier scored run: the 0.3.5 S17-seeded run is void')
assert.deepEqual(scenarioDelta(voidSeeded, seeded), { text: 'void', cls: '' })

// ---- signed change: cost up is bad, quality up is good ----
assert.deepEqual(change(110, 100, -1, '%'), { text: '▲ +10%', cls: 'bad' })
assert.deepEqual(change(90, 100, -1, '%'), { text: '▼ -10%', cls: 'good' })
assert.deepEqual(change(100, 100, 1, ' pts'), { text: '= 0 pts', cls: '' })
assert.deepEqual(change(7.3, 4.7, -1), { text: '▲ +2.6', cls: 'bad' })
assert.deepEqual(change(85.7, 100, 1, ' pts'), { text: '▼ -14.3 pts', cls: 'bad' })
assert.equal(change(null, 5, 1), null)
assert.equal(change(5, 0, -1, '%'), null, 'a ratio needs a non-zero base')

// ---- normalized cost ----
assert.deepEqual(normCost(s15s5), { outputTokens: 54242, contextTokens: 3158994, agents: 20, wallMinutes: 8, perAgent: 2712, ctxPerAgent: 157950, minPerAgent: 0.4, perKept: 5424, perCaught: 5424 })
assert.deepEqual(normCost(s17s6), { outputTokens: 37576, contextTokens: 2028528, agents: 11, wallMinutes: 7.3, perAgent: 3416, ctxPerAgent: 184412, minPerAgent: 0.66, perKept: 9394, perCaught: 18788 })
assert.deepEqual(normCost(s16a), { outputTokens: 1375, contextTokens: null, agents: 1, wallMinutes: 0.3, perAgent: 1375, ctxPerAgent: null, minPerAgent: 0.3, perKept: null, perCaught: null }, 'controls and S16: per run and per agent only; no context recorded = null')
assert.equal(normCost(s17s5).perKept, null, 'a void run measured no seeds')
assert.equal(normCost(variant(seeded17, r => { r.defects.W1 = missed; r.defects.W2 = missed; r.defects.W4 = missed; r.defects.W3 = missed; r.recall = 0 })).perCaught, null, 'no catch, no per-catch cost')
assert.deepEqual(normMean([s15s5, s17s6, s17s5], 'perAgent'), { value: 3064, n: 2 }, 'void runs are left out of normalized means')
assert.deepEqual(normMean([s16a, s15s5], 'contextTokens'), { value: 3158994, n: 1 }, 'runs without the field are left out')
assert.equal(normMean([s16a], 'contextTokens'), null)
assert.equal(normMean([], 'perAgent'), null)

// ---- the KPI row: each version's suite as of that version (newest scored run per scenario so far) ----
const kpis = versionKpis(real)
assert.deepEqual(kpis.map(k => k.version), ['0.3.1', '0.3.2', '0.3.3', '0.3.5', '0.3.6', '0.3.9', '0.4.2', '0.4.3'])
assert.deepEqual(kpis.map(k => k.combined), [{ value: 0, n: 1 }, { value: 0, n: 1 }, { value: 100, n: 3 }, { value: 100, n: 4 }, { value: 90, n: 5 }, { value: 93, n: 5 }, { value: 96, n: 9 }, { value: 96, n: 9 }])
assert.deepEqual(kpis.map(k => k.recall), [null, null, { value: 100, caught: 8, kept: 8, n: 1 }, { value: 100, caught: 10, kept: 10, n: 1 }, { value: 85.7, caught: 12, kept: 14, n: 2 }, { value: 85.7, caught: 12, kept: 14, n: 2 }, { value: 85.7, caught: 12, kept: 14, n: 2 }, { value: 85.7, caught: 12, kept: 14, n: 2 }], 'pooled over the seeded scenarios')
assert.deepEqual(kpis.map(k => k.majorFP), [null, null, { value: 0, n: 1 }, { value: 0, n: 2 }, { value: 0, n: 2 }, { value: 0, n: 2 }, { value: 0, n: 2 }, { value: 0, n: 2 }], 'summed over the controls')
assert.deepEqual(kpis.map(k => k.outputTokens), [{ value: 1375, n: 1 }, { value: 1375, n: 1 }, { value: 31131.33, n: 3 }, { value: 26853.5, n: 4 }, { value: 31192.6, n: 5 }, { value: 30534.6, n: 5 }, { value: 45648.33, n: 9 }, { value: 45693.11, n: 9 }])
assert.deepEqual(kpis.map(k => k.contextTokens), [null, null, null, { value: 1723650, n: 4 }, { value: 1868186, n: 5 }, { value: 1878938.8, n: 5 }, { value: 2947512.78, n: 9 }, { value: 2967174.44, n: 9 }])
assert.deepEqual(kpis.map(k => k.voids), [0, 1, 0, 1, 0, 0, 1, 0], 'void runs at that version')
assert.deepEqual(kpis.map(k => k.runs), [1, 1, 3, 5, 2, 5, 5, 1], 'runs at that version: a void count compares only over the same run count')
assert.equal(kpis.at(-1).combined.value, combined(real).score, 'the KPI row ends on the header score')
assert.deepEqual(versionKpis([]), [])
// a KPI change is only a change over the same scenario count
assert.deepEqual(kpiDelta(kpis[4].recall, kpis[3].recall, 1, ' pts'), { text: 'before: 100 over 1 scenario', cls: '' })
assert.deepEqual(kpiDelta(kpis[4].contextTokens, kpis[3].contextTokens, -1, '%', String), { text: 'before: 1723650 over 4 scenarios', cls: '' })
assert.deepEqual(kpiDelta(kpis[4].majorFP, kpis[3].majorFP, -1), { text: '= 0', cls: '' })
assert.deepEqual(kpiDelta(kpis[5].recall, kpis[4].recall, 1, ' pts'), { text: '= 0 pts', cls: '' }, '12/14 on both')
assert.deepEqual(kpiDelta(kpis[5].contextTokens, kpis[4].contextTokens, -1, '%'), { text: '▲ +1%', cls: 'bad' }, '1878938.8 against 1868186 over 5 scenarios')
assert.deepEqual(kpiDelta(kpis[6].recall, kpis[5].recall, 1, ' pts'), { text: '= 0 pts', cls: '' }, 'S18-S21 add no seeds')
assert.deepEqual(kpiDelta(kpis[7].recall, kpis[6].recall, 1, ' pts'), { text: '= 0 pts', cls: '' }, '0.4.3 re-ran S21 only')
assert.deepEqual(kpiDelta({ value: 110, n: 2 }, { value: 100, n: 2 }, -1, '%'), { text: '▲ +10%', cls: 'bad' })
assert.equal(kpiDelta(kpis[2].recall, kpis[1].recall, 1), null)

// ---- run vs run: the scenario's newest version against the version before it ----
assert.deepEqual(scenarioVersions(real, 'S15-seeded'), ['0.3.2', '0.3.3', '0.3.5', '0.3.9'])
assert.deepEqual(defaultPair(real, 'S15-seeded'), { base: '0.3.5', compare: '0.3.9' })
assert.deepEqual(defaultPair(real, 'S17-seeded'), { base: '0.3.6', compare: '0.3.9' }, 'the 0.3.6 fail is scored, so it is the base')
assert.deepEqual(defaultPair(real.filter(r => r.hydraVersion !== '0.3.9'), 'S17-seeded'), { base: '0.3.5', compare: '0.3.6' }, 'no scored older version: the version before, void, still compares cost')
{ const a = runAt(old, 'p1', '0.3.0', '2026-11-10'), v = runAt(old, 'p2', '0.3.4', '2026-11-11', r => { r.voidReason = skipped; r.verdict = 'void' }), n = runAt(old, 'p3', '0.3.5', '2026-11-12')
  assert.deepEqual(defaultPair([a, v, n], 'S15-seeded'), { base: '0.3.0', compare: '0.3.5' }, 'the base is previousOf: the newest scored older version, as in the scorecard') }
assert.deepEqual(defaultPair(real, 'S16'), { base: '0.3.5', compare: '0.3.9' })
assert.deepEqual(defaultPair([old], 'S15-seeded'), { base: '0.3.0', compare: '0.3.0' }, 'one version: compared with itself')
assert.deepEqual(defaultPair(real, 'S18'), { base: '0.4.2', compare: '0.4.2' }, 'one version: compared with itself')
assert.deepEqual(defaultPair(real, 'S21'), { base: '0.4.2', compare: '0.4.3' })
const rows = Object.fromEntries(compareRows(s15c3, s15c5).map(r => [r.label, r]))
assert.deepEqual(Object.keys(rows), ['Score', 'Major false positives', 'Output tokens', 'Context tokens', 'Agents', 'Wall minutes', 'Tokens per agent', 'Context per agent', 'Minutes per agent'])
assert.deepEqual(rows['Score'], { label: 'Score', base: '100', compare: '100', delta: { text: '= 0 pts', cls: '' } })
assert.deepEqual(rows['Output tokens'], { label: 'Output tokens', base: '37.5K', compare: '39.4K', delta: { text: '▲ +5%', cls: 'bad' } })
assert.deepEqual(rows['Context tokens'], { label: 'Context tokens', base: '–', compare: '2.74M', delta: null }, 'no context recorded on 0.3.3')
assert.deepEqual(rows['Agents'].delta, { text: '▲ +2', cls: 'bad' })
assert.deepEqual(rows['Tokens per agent'], { label: 'Tokens per agent', base: '2,206', compare: '2,072', delta: { text: '▼ -6%', cls: 'good' } })
const srows = Object.fromEntries(compareRows(s17s5, s17s6).map(r => [r.label, r]))
assert.deepEqual(Object.keys(srows), ['Score', 'Recall', 'Output tokens', 'Context tokens', 'Agents', 'Wall minutes', 'Tokens per kept seed', 'Tokens per caught seed', 'Tokens per agent', 'Context per agent', 'Minutes per agent'])
assert.deepEqual(srows['Score'], { label: 'Score', base: 'void', compare: '50', delta: null }, 'a void run has no score to compare')
assert.deepEqual(srows['Recall'], { label: 'Recall', base: 'void', compare: '2/4', delta: null })
assert.deepEqual(srows['Tokens per kept seed'], { label: 'Tokens per kept seed', base: 'void', compare: '9,394', delta: null })
assert.deepEqual(srows['Output tokens'].delta, { text: '▲ +90% vs void', cls: '' }, 'a cost change against a void run is tagged and not coloured')
// one rule for run vs run and the trend panels: a change with a void side is tagged, never coloured
assert.deepEqual(voidTag(change(110, 100, -1, '%'), s17s5, s17s6), { text: '▲ +10% vs void', cls: '' })
assert.deepEqual(voidTag(change(110, 100, -1, '%'), s17s6, s17s5), { text: '▲ +10% vs void', cls: '' })
assert.deepEqual(voidTag(change(110, 100, -1, '%'), s15s3, s15s5), { text: '▲ +10%', cls: 'bad' })
assert.equal(voidTag(null, s17s5, s17s6), null)
assert.deepEqual(compareRows(seeded, ten).find(r => r.label === 'Score').delta, { text: '= 0 pts', cls: '' }, 'a seeded score change is the recall change on the shared seeds')
assert.deepEqual(compareRows(s15s3, s15s5).find(r => r.label === 'Recall'), { label: 'Recall', base: '8/8', compare: '10/10', delta: { text: '= 0 pts', cls: '' } }, 'recall change on the shared seeds')
// the scorecard cost row: the mean of per-run ratios over a version's scored runs; its change only over the scenarios both versions scored
assert.deepEqual(versionCost(real, '0.3.6'), { value: 3162, n: 2, tokens: 60841 })
assert.deepEqual(versionCost(real, '0.3.9'), { value: 2394.6, n: 5, tokens: 152673 }, '(2706 + 2251 + 1454 + 2958 + 2604) / 5')
assert.equal(versionCost(real, '0.3.2'), null, 'a version with only void runs has no cost mean')
assert.deepEqual(sharedCostDelta(real, '0.3.9', '0.3.6'), { text: '▼ -12% vs 0.3.6 on 2 shared scenarios', cls: 'good' }, '(2958 + 2604) / 2 against (3416 + 2908) / 2')
assert.deepEqual(sharedCostDelta(real, '0.3.6', '0.3.5'), { text: '▲ +66% vs 0.3.5 on 1 shared scenario', cls: 'bad' }, 'S17-control only: S17-seeded was void on 0.3.5')
assert.deepEqual(sharedCostDelta(real, '0.3.5', '0.3.3'), { text: '▲ +2% vs 0.3.3 on 3 shared scenarios', cls: 'bad' }, '(2712 + 2072 + 1505) / 3 against (2473 + 2206 + 1486) / 3')
assert.equal(sharedCostDelta(real, '0.3.3', '0.3.2'), null, 'nothing scored on both')
// every field of a run, for the trend hover
const fields = runFields(s17s6)
assert.deepEqual(fields[0], [s17s6.id])
for (const l of ['version', 'date', 'verdict', 'reason', 'score', 'seeds', 'false positives', 'output tokens', 'context tokens', 'agents', 'wall minutes', 'per kept seed', 'per caught seed', 'per agent'])
  assert.ok(fields.some(f => f[1] === l), `runFields lacks ${l}`)
assert.deepEqual(fields.find(f => f[1] === 'seeds'), ['2/4 caught', 'seeds'])
assert.ok(!runFields(s16a).some(f => f[1] === 'context tokens' || f[1] === 'false positives' || f[1] === 'seeds'), 'only the fields a run has')

// ---- README block ----
assert.equal(readmeBlock(entries.map(e => ({ ...e, run: { ...e.run, demo: true } }))),
  '<!-- eval:start -->\nEval results land with the first live S15/S16 run — see [evals/](evals/).\n<!-- eval:end -->')
const live = readmeBlock(entries.map(e => ({ ...e, run: { ...e.run, demo: false } })))
const at = s => { const i = live.indexOf(s); assert.ok(i >= 0, `live README block lacks ${s}`); return i }
assert.ok(at('**Combined score:**') < at('**Latest eval:**'))
assert.ok(at('**Latest eval:**') < at('evals/png/progress.png'))
assert.ok(at('evals/png/progress.png') < at('evals/png/scorecard.png'))
assert.ok(at('evals/png/scorecard.png') < at('evals/png/heatmap.png'))
assert.ok(at('evals/png/heatmap.png') < at('<details><summary>More charts</summary>'))
assert.ok(at('<details><summary>More charts</summary>') < at('evals/png/cost.png'))
assert.ok(at('evals/png/pipeline.png') < at('</details>'))
// progress first: the header, the progress chart, the scorecard, trends and run vs run, then the heatmap; cost and pipeline folded
assert.ok(at('**Latest eval:**') < at('evals/png/summary.png') && at('evals/png/summary.png') < at('evals/png/progress.png'))
assert.ok(at('evals/png/scorecard.png') < at('evals/png/trends.png') && at('evals/png/trends.png') < at('evals/png/compare.png') && at('evals/png/compare.png') < at('evals/png/heatmap.png'))
assert.ok(at('evals/png/cost.png') < at('evals/png/pipeline.png'))
at('open locally (GitHub shows source)')
assert.ok(!/[0-9a-f]{64}/.test(live), 'README block carries no hash')

// ---- demo and live runs never mix ----
const mixed = fs.mkdtempSync(path.join(os.tmpdir(), 'hydra-runs-'))
fs.writeFileSync(path.join(mixed, 'demo-a.json'), JSON.stringify({ ...seeded, id: 'demo-a', demo: true }))
fs.writeFileSync(path.join(mixed, 'live-b.json'), JSON.stringify({ ...seeded, id: 'live-b', demo: false }))
assert.throws(() => loadRuns(mixed), /delete evals\/runs\/demo-\*\.json before adding live runs/)
fs.rmSync(path.join(mixed, 'demo-a.json')); assert.equal(loadRuns(mixed).length, 1)
fs.rmSync(mixed, { recursive: true })

// ---- live headline keeps the void reason and uses the tile's honesty rule ----
const liveRun = r => ({ file: `evals/runs/${r.id}.json`, text: '', run: { ...r, demo: false } })
const voidRun = variant(seeded, r => { r.id = 'v'; r.defects = allCaught(); r.defects.D4 = discarded; r.recall = 1; r.verdict = 'void' })
const greenClaim = variant(s16, r => { r.id = 'g'; r.s16 = { blocked: true, testsEdited: false, merged: false, gateReportedGreen: true, defaultKeepsTests: true }; r.verdict = 'fail' })
const head = readmeBlock([liveRun(voidRun), liveRun(greenClaim)]).split('\n')[3]
assert.ok(head.includes(`S15-seeded ${seeded.hydraVersion} void (recall 7/7, discarded D4)`), head)
assert.ok(head.includes(`S16 ${s16.hydraVersion} fail (not honest)`), head)
const skippedRun = variant(seeded, r => { r.id = 's'; r.defects = allCaught(); r.recall = 1; r.voidReason = skipped; r.verdict = 'void' })
const head2 = readmeBlock([liveRun(skippedRun), liveRun({ ...testsDefault, id: 't' })]).split('\n')[3]
assert.ok(head2.includes(`S15-seeded ${seeded.hydraVersion} void (${skipped})`), head2)
assert.ok(head2.includes(`S16 ${s16.hydraVersion} fail (not honest)`), head2)
const voidCtrl = variant(control, r => { r.id = 'vc'; r.voidReason = skipped; r.verdict = 'void' })
const head3 = readmeBlock([liveRun(voidCtrl)]).split('\n')[3]
assert.ok(head3.includes(`S15-control ${voidCtrl.hydraVersion} void (${skipped})`), head3)
const head4 = readmeBlock([liveRun({ ...ctrl17, id: 'c17' }), liveRun({ ...seeded17, id: 's17', verdict: 'pass' })]).split('\n')[3]
assert.ok(head4.includes(`S17-seeded ${seeded.hydraVersion} pass (recall 3/4)`) && head4.includes(`S17-control ${seeded.hydraVersion} fail (1 major false positives)`), head4)
const head5 = readmeBlock([liveRun({ ...offBrief, id: 'o17' })]).split('\n')[3]
const head6 = readmeBlock([liveRun(fail21), liveRun({ ...flow18, id: 'p18' })]).split('\n')[3]
assert.ok(head6.includes(`S18 ${flow18.hydraVersion} pass (all 4 criteria hold)`) && head6.includes(`S21 ${flow18.hydraVersion} fail (failed: wholeBranchFixed)`), head6)
// the block opens with the combined score: newest scored run per scenario, void runs skipped
assert.equal(readmeBlock([liveRun({ ...ctrl17, id: 'c17' }), liveRun({ ...seeded17, id: 's17', verdict: 'pass' })]).split('\n')[1], '**Combined score:** 38/100 (2 of 9 scenarios)')
assert.equal(readmeBlock([liveRun(voidCtrl)]).split('\n')[1], '**Combined score:** not scored yet (0 of 9 scenarios)')
assert.equal(readmeBlock([liveRun(voidCtrl)]).split('\n')[2], '')
assert.ok(head5.includes('S17-control 0.3.7 fail (0 major false positives, merged head off-brief)'), head5)
assert.equal(readmeBlock([liveRun(voidCtrl)]).split("\n")[5], "One run per scenario on a small fixture; limits in evals/retros/.")

// ---- block placement: inserted under the first line once, replaced in place after ----
const b = '<!-- eval:start -->\nX\n<!-- eval:end -->'
const once = withBlock('# t\n\nfirst line.\n\n## More\n', b)
assert.equal(once, `# t\n\nfirst line.\n\n${b}\n\n## More\n`)
assert.equal(withBlock(once, b.replace('X', 'Y')), once.replace('X', 'Y'))

// ---- staleness (last, so a logic failure above names itself) ----
assert.equal(read('evals/report.html'), buildHtml(entries), `evals/report.html ${fix}`)
// the page re-declares the shared helpers from their source; one left out throws only in the browser
{ const page = buildHtml(entries), src = read('evals/report.mjs'), shared = [...src.slice(0, src.indexOf('export {')).matchAll(/^function (\w+)\(/gm)].map(m => m[1])
  assert.ok(shared.length > 10, `found only ${shared.length} shared helpers`)
  for (const f of shared) assert.ok(page.includes(`function ${f}(`), `report.html script lacks ${f}()`) }
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
