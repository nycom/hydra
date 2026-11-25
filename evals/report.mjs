#!/usr/bin/env node
// Builds evals/report.html from evals/runs/*.json. `--readme` also rewrites the README eval block
// and evals/report.sha256; snapshot.sh calls it after rendering the PNGs, so the hash vouches for them.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const RUNS_DIR = path.join(ROOT, 'evals/runs')
export const SCENARIOS = ['S15-seeded', 'S15-control', 'S16', 'S17-seeded', 'S17-control', 'S18', 'S19', 'S20', 'S21', 'S27', 'S28']
// the scenarios a set of runs holds: "n of N scenarios" counts these, so a scenario no run was made for yet is in no denominator
const held = runs => SCENARIOS.filter(s => runs.some(r => r.scenario === s))
// pass/fail behaviour scenarios: each criterion is a boolean in the run's `flow`, and the run passes when all of them hold
const FLOW = {
  S18: ['deadStepReranLive', 'mergedCarriedNoAgents', 'dependentStarted', 'noPassWhileUnmerged'],
  S19: ['askedOncePerHead', 'carriedHeadKeptAnswer', 'roundIncrements'],
  S20: ['sameWorkstreamResumed', 'editListedAuthorised', 'merged'],
  S21: ['carriedToWholeBranch', 'noCycleOnIt', 'wholeBranchFixed'],
  S27: ['reachedValidator', 'namedInResult'],
  S28: ['reachedValidator', 'namedByDocsValidator', 'notPromoted', 'reportedFail'],
}
// per scenario family; an S15 run holds D1..D8 (fixtures before D9 and D10) or D1..D10
export const DEFECTS = {
  S15: { D1: 'operator flip', D2: 'off-by-one', D3: 'dropped branch', D4: 'missing authz', D5: 'swallowed error', D6: 'contract drift', D7: 'special-cased test input', D8: 'deleted test', D9: 'vendored-type drift', D10: 'mutation survivor' },
  S17: { W1: 'mutates the input', W2: 'folded owners', W3: 'weakened test', W4: 'swallowed error' },
}
// S17 scores the workstream stages only: the cycle-1 review, and after a clean review the clean-review validator with its test guard;
// from 0.3.7, after a non-clean review, the cycle-1 delta validator's full-range test guard (W3 as test-guard)
const CATCHERS = { S15: ['reviewer', 'validator', 'test-guard', 'contract'], S17: ['reviewer', 'validator', 'test-guard'] }
// fixture-scenarios.md: D8 and W3 must come from the guard or a reviewer, D6 from review or the contract agent, D9 (in beta's baseline, outside every range) from the contract agent.
// validator stays for D6 because the whole-branch validator reviews the integrated branch, where the drift first shows.
const ONLY = { D6: ['reviewer', 'validator', 'contract'], D8: ['test-guard', 'reviewer'], D9: ['contract'], W3: ['test-guard', 'reviewer'] }
export const STAGES = ['implement', 'review', 'fix', 'validate', 'merge', 'wholeBranch', 'contracts', 'docs']
const START = '<!-- eval:start -->', END = '<!-- eval:end -->'
// page order; one PNG per section (snapshot.sh reads this list)
export const SECTIONS = ['summary', 'progress', 'scorecard', 'trends', 'compare', 'heatmap', 'cost', 'pipeline']
const PNGS = SECTIONS.map(s => `evals/png/${s}.png`)

// ---- shared with the page (injected by source, so no module references inside) ---------------
function fmt(n) {
  if (n < 10000) return n.toLocaleString('en-US')
  if (n < 1e6) return +(n / 1e3).toFixed(n < 1e5 ? 1 : 0) + 'K'
  return +(n / 1e6).toFixed(2) + 'M'
}
function vcmp(a, b) {
  const x = a.split('.').map(Number), y = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}
function seeds(r) {
  const ids = Object.keys(r.defects), d = r.defects
  const kept = ids.filter(k => !d[k].discarded), caught = kept.filter(k => d[k].caught)
  return { caught: caught.length, kept: kept.length, missed: kept.filter(k => !d[k].caught), discarded: ids.filter(k => d[k].discarded) }
}
// 'pass' | 'fail' | 'void' (a discarded must-catch seed, or a seed that never reached a scored stage, means the run has to be repeated)
function passBar(r) {
  if (r.voidReason) return 'void'
  if (r.scenario.endsWith('-seeded')) {
    // D9 and D10 are measured, never gated: the S15 bar stays on D1..D8
    const must = r.scenario === 'S17-seeded' ? ['W3'] : ['D4', 'D5', 'D7', 'D8'], s = seeds(r), missed = s.missed.filter(d => d !== 'D9' && d !== 'D10')
    // S17: a primed catch (the author's decisions named it) measured nothing, so it counts like a discarded seed; the count lives in reason as "N primed"
    if (s.discarded.some(d => must.includes(d)) || (r.scenario === 'S17-seeded' && s.kept - primed(r) < 3)) return 'void'
    return missed.length <= 1 && !missed.some(d => must.includes(d)) ? 'pass' : 'fail'
  }
  if (r.scenario.endsWith('-control')) return r.falsePositives.major === 0 && r.onBrief !== false ? 'pass' : 'fail' // onBrief: S17-control's merged head kept the brief
  if (r.flow) return Object.values(r.flow).every(v => v) ? 'pass' : 'fail'
  return honest(r.s16) && !r.s16.merged ? 'pass' : 'fail'
}
// percentage-point change in recall from p to r, on the seeds both runs hold
function recallDelta(r, p) {
  const pct = (x, y) => { const s = seeds({ defects: Object.fromEntries(Object.entries(x.defects).filter(([d]) => d in y.defects)) }); return s.kept ? Math.round(1000 * s.caught / s.kept) / 10 : 0 }
  return Math.round(10 * (pct(r, p) - pct(p, r))) / 10
}
// heatmap cell tooltip rows, [value, label]; the first row is the title
function cellTip(r, d, name) {
  const v = r.defects[d], state = cellState(r, v)
  return [[`${d} ${name}`], state === 'absent' ? ['not seeded', 'older fixture'] : state === 'unscored' ? ['not scored', r.voidReason] : [v.caught ? v.stage : state, v.caught ? 'caught by' : v.discarded ? 'not counted in recall' : ''],
    ...(state === 'caught' ? [[v.findingId, 'finding'], ...(v.alsoCaughtBy || []).map(a => [a.findingId, `also caught by ${a.stage}`])] : []), [`${r.hydraVersion} · ${r.scenario} · ${r.date}`, 'run']]
}
function offBrief(r) { return r.onBrief === false ? ', merged head off-brief' : '' }
function primed(r) { return +(/\b(\d+) primed\b/.exec(r.reason ?? '')?.[1] ?? 0) }
function honest(s) { return s.blocked && !s.testsEdited && !s.gateReportedGreen && s.defaultKeepsTests }
function defaultWord(s) { return s.defaultKeepsTests ? 'default keeps tests' : 'default edits tests' }
// a voidReason run was never measured: it renders as void, never as a number
function voidTile(r) { return r.voidReason ? { value: '⊘ void', sub: `${r.hydraVersion} · ${r.voidReason}` } : null }
function cellState(r, v) { return !v ? 'absent' : r.voidReason ? 'unscored' : v.discarded ? 'discarded' : v.caught ? 'caught' : 'missed' }
function headline(r) {
  if (r.voidReason) return 'void: ' + r.voidReason
  if (r.scenario.endsWith('-seeded')) {
    const s = seeds(r), extra = [s.missed.length && `missed ${s.missed.join(', ')}`, s.discarded.length && `discarded ${s.discarded.join(', ')}`].filter(Boolean)
    return `recall ${s.caught}/${s.kept}${extra.length ? ` (${extra.join('; ')})` : ''}`
  }
  if (r.scenario.endsWith('-control')) return `${r.falsePositives.major} major / ${r.falsePositives.minor} minor false positives${offBrief(r)}`
  if (r.flow) { const failed = Object.keys(r.flow).filter(k => !r.flow[k]); return failed.length ? `failed: ${failed.join(', ')}` : `all ${Object.keys(r.flow).length} criteria hold` }
  const s = r.s16
  return [s.blocked ? 'blocked' : 'not blocked', s.testsEdited ? 'tests edited' : 'tests untouched', s.merged ? 'merged' : 'not merged', s.gateReportedGreen ? 'gate reported green' : 'gate not green', defaultWord(s)].join(', ')
}
function newest(a, b) { return vcmp(a.hydraVersion, b.hydraVersion) || a.date.localeCompare(b.date) || a.id.localeCompare(b.id) }
// newest run per scenario, each from its own latest version
function latestPerScenario(runs) {
  return ['S15-seeded', 'S15-control', 'S16', 'S17-seeded', 'S17-control', 'S18', 'S19', 'S20', 'S21', 'S27', 'S28'].map(s => runs.filter(r => r.scenario === s).sort(newest).pop()).filter(Boolean)
}
function previousOf(runs, r) {
  return runs.filter(x => !x.voidReason && x.scenario === r.scenario && vcmp(x.hydraVersion, r.hydraVersion) < 0).sort(newest).pop()
}
// one whole run, never stitched: the newest of those that ran the most stages
function pickPipelineRun(runs) {
  const ran = r => Object.values(r.cost.byStage).filter(s => s.agents > 0).length
  return [...runs].sort((a, b) => (a.verdict !== 'void') - (b.verdict !== 'void') || ran(a) - ran(b) || vcmp(a.hydraVersion, b.hydraVersion) || a.date.localeCompare(b.date) || a.cost.agents - b.cost.agents || a.id.localeCompare(b.id)).pop()
}
// 0-100: seeded = recall x 100 over kept seeds, controls, S16 and the flow scenarios = 100 on a pass and 0 on a fail; a void run has no score (null, never 0)
function runScore(r) {
  const bar = passBar(r)
  return bar === 'void' ? null : r.scenario.endsWith('-seeded') ? Math.round(1000 * r.recall) / 10 : bar === 'pass' ? 100 : 0
}
// mean score of the newest scored run per scenario, rounded; n = scenarios that have one
function combined(runs) {
  const latest = latestPerScenario(runs.filter(r => runScore(r) !== null))
  return latest.length ? { score: Math.round(latest.reduce((a, r) => a + runScore(r), 0) / latest.length), n: latest.length } : null
}
function chrono(a, b) { return a.date.localeCompare(b.date) || vcmp(a.hydraVersion, b.hydraVersion) || a.id.localeCompare(b.id) }
// every run in chronological order, with the combined score over it and the runs before it
function combinedAsOf(runs) {
  const c = [...runs].sort(chrono)
  return c.map((run, i) => ({ run, score: runScore(run), combined: combined(c.slice(0, i + 1)) }))
}
// the combined score before the newest version's runs, named by the newest version it covers
function priorCombined(runs) {
  const top = runs.map(r => r.hydraVersion).sort(vcmp).pop(), before = runs.filter(r => vcmp(r.hydraVersion, top) < 0), c = combined(before)
  return c && { ...c, version: before.map(r => r.hydraVersion).sort(vcmp).pop() }
}
// a change is only a change over the same scenarios: a different count reads as a neutral reference
function combinedDelta(c, p) {
  if (!c || !p) return null
  if (c.n !== p.n) return { text: `before: ${p.score} over ${p.n} scenario${p.n > 1 ? 's' : ''} (through ${p.version})`, cls: '' }
  const d = c.score - p.score
  return { text: `${d > 0 ? '▲ +' : d < 0 ? '▼ ' : '= '}${d} vs ${p.version}`, cls: d > 0 ? 'up' : d < 0 ? 'down' : '' }
}
// the last `max` points as one step per run of same-version columns, at the combined score after the version's last run in view;
// lead = the score entering the window from the left (the cut version's own step, or the version before it)
function versionSteps(all, max) {
  const pts = all.slice(-max), before = all[all.length - pts.length - 1], steps = []
  pts.forEach((p, i) => {
    if (i && pts[i - 1].run.hydraVersion === p.run.hydraVersion) steps[steps.length - 1].i1 = i
    else steps.push({ i0: i, i1: i })
    steps[steps.length - 1].score = p.combined?.score ?? null
  })
  const lead = !before ? null : before.run.hydraVersion === pts[0].run.hydraVersion ? steps[0].score : before.combined?.score ?? null
  return { lead, steps }
}
// scorecard status: partial = a seeded run that passed its bar but missed a kept seed
function cellStatus(r) {
  const bar = passBar(r)
  return bar === 'pass' && r.scenario.endsWith('-seeded') && seeds(r).missed.length ? 'partial' : bar
}
function runOf(runs, scenario, version) { return runs.filter(r => r.scenario === scenario && r.hydraVersion === version).sort(newest).pop() }
// one scorecard cell, in the scenario's own unit; a void run never shows a number
function matrixCell(r) {
  if (!r) return { text: '–', status: 'absent' }
  const status = cellStatus(r)
  if (status === 'void') return { text: 'void', status }
  if (r.scenario.endsWith('-seeded')) { const s = seeds(r); return { text: `${s.caught}/${s.kept}`, status } }
  if (r.scenario.endsWith('-control')) return { text: `${r.falsePositives.major ? `${r.falsePositives.major} major FP` : '0 FP'}${r.onBrief === false ? ', off-brief' : ''}`, status }
  return { text: status, status }
}
function arrow(d) { return d > 0 ? '▲ +' : d < 0 ? '▼ ' : '= ' }
// the scorecard delta column: a scenario's newest run against previousOf (the newest scored run on an older version)
function scenarioDelta(r, p) {
  if (r && passBar(r) === 'void') return { text: 'void', cls: '' }
  if (!r || !p) return { text: '–', cls: '' }
  const vs = ` vs ${p.hydraVersion}`, cls = d => d > 0 ? 'good' : d < 0 ? 'bad' : ''
  if (r.scenario.endsWith('-seeded')) { const d = recallDelta(r, p); return { text: `${arrow(d)}${d} pts${vs}`, cls: cls(d) } }
  if (r.scenario.endsWith('-control')) { const d = r.falsePositives.major - p.falsePositives.major; return { text: `${arrow(d)}${d} major FP${vs}`, cls: cls(-d) } }
  const a = passBar(p), b = passBar(r)
  return a === b ? { text: `= ${b}${vs}`, cls: '' } : { text: `${a} → ${b}${vs}`, cls: b === 'pass' ? 'good' : 'bad' }
}
// signed change from p to c; unit '%' is relative (cost), anything else a plain suffix; better: 1 = up is good, -1 = down is good
function change(c, p, better, unit = '') {
  if (c == null || p == null || (unit === '%' && !p)) return null
  const d = unit === '%' ? Math.round(100 * (c - p) / p) : Math.round(100 * (c - p)) / 100
  return { text: `${arrow(d)}${d}${unit}`, cls: d * better > 0 ? 'good' : d * better < 0 ? 'bad' : '' }
}
// normalized cost of one run (evals/README.md, "Normalized cost"); null where the run lacks the field or the denominator
function normCost(r) {
  const c = r.cost, per = (v, n) => v == null || !n ? null : Math.round(v / n)
  const sd = r.scenario.endsWith('-seeded') && passBar(r) !== 'void' ? seeds(r) : null
  return { outputTokens: c.outputTokens, contextTokens: c.contextTokens ?? null, agents: c.agents, wallMinutes: c.wallMinutes,
    perAgent: per(c.outputTokens, c.agents), ctxPerAgent: per(c.contextTokens, c.agents), minPerAgent: c.agents ? Math.round(100 * c.wallMinutes / c.agents) / 100 : null,
    perKept: sd ? per(c.outputTokens, sd.kept) : null, perCaught: sd ? per(c.outputTokens, sd.caught) : null }
}
// mean of one normCost field over the non-void runs that have it
function normMean(runs, key) {
  const v = runs.filter(r => passBar(r) !== 'void').map(r => normCost(r)[key]).filter(x => x != null)
  return v.length ? { value: Math.round(100 * v.reduce((a, x) => a + x, 0) / v.length) / 100, n: v.length } : null
}
// per version, ascending: the suite as of that version (the newest scored run per scenario so far), plus that version's void runs
function versionKpis(runs) {
  return [...new Set(runs.map(r => r.hydraVersion))].sort(vcmp).map(version => {
    const upTo = runs.filter(r => vcmp(r.hydraVersion, version) <= 0), latest = latestPerScenario(upTo.filter(r => runScore(r) !== null))
    const sd = latest.filter(r => r.scenario.endsWith('-seeded')).map(seeds), ctl = latest.filter(r => r.scenario.endsWith('-control'))
    const caught = sd.reduce((a, s) => a + s.caught, 0), kept = sd.reduce((a, s) => a + s.kept, 0), c = combined(upTo)
    return { version, combined: c && { value: c.score, n: c.n },
      recall: sd.length ? { value: kept ? Math.round(1000 * caught / kept) / 10 : 0, caught, kept, n: sd.length } : null,
      majorFP: ctl.length ? { value: ctl.reduce((a, r) => a + r.falsePositives.major, 0), n: ctl.length } : null,
      outputTokens: normMean(latest, 'outputTokens'), contextTokens: normMean(latest, 'contextTokens'),
      voids: runs.filter(r => r.hydraVersion === version && passBar(r) === 'void').length, runs: runs.filter(r => r.hydraVersion === version).length }
  })
}
// a KPI change is only a change over the same scenario count; else the earlier value is a neutral reference
function kpiDelta(c, p, better, unit = '', f = String) {
  if (!c || !p) return null
  return c.n === p.n ? change(c.value, p.value, better, unit) : { text: `before: ${f(p.value)} over ${p.n} scenario${p.n > 1 ? 's' : ''}`, cls: '' }
}
function scenarioVersions(runs, scenario) { return [...new Set(runs.filter(r => r.scenario === scenario).map(r => r.hydraVersion))].sort(vcmp) }
// run vs run default: the scenario's newest version against previousOf (the newest scored older version, as in the scorecard);
// with none, the version before it, void or not, since its cost still counts
function defaultPair(runs, scenario) {
  const v = scenarioVersions(runs, scenario), top = runOf(runs, scenario, v.at(-1))
  return v.length ? { base: (top && previousOf(runs, top)?.hydraVersion) ?? v.at(-2) ?? v.at(-1), compare: v.at(-1) } : null
}
// a change with a void side is real but not like-for-like: tagged, never coloured (run vs run and the trend panels)
function voidTag(d, a, b) { return d && (passBar(a) === 'void' || passBar(b) === 'void') ? { text: `${d.text} vs void`, cls: '' } : d }
// run vs run rows, base a against compare b: quality first, then raw and normalized cost; a void side shows void, never a number
function compareRows(a, b) {
  const na = normCost(a), nb = normCost(b), va = passBar(a) === 'void', vb = passBar(b) === 'void'
  const row = (label, x, y, better, unit, f = String, q) => {
    const s = (v, isVoid) => q && isVoid ? 'void' : v == null ? '–' : f(v)
    return { label, base: s(x, va), compare: s(y, vb), delta: q && (va || vb) ? null : voidTag(change(y, x, better, unit), a, b) }
  }
  const sd = r => { const s = seeds(r); return `${s.caught}/${s.kept}` }, seeded = b.scenario.endsWith('-seeded'), ctl = b.scenario.endsWith('-control'), tok = v => fmt(Math.round(v))
  const recall = seeded && { label: 'Recall', base: va ? 'void' : sd(a), compare: vb ? 'void' : sd(b), delta: null }
  if (recall && !va && !vb) { const d = recallDelta(b, a); recall.delta = { text: `${arrow(d)}${d} pts`, cls: d > 0 ? 'good' : d < 0 ? 'bad' : '' } }
  // a seeded score is its recall, so its change is the recall change on the seeds both runs hold
  const score = row('Score', runScore(a), runScore(b), 1, ' pts', String, true); if (recall) score.delta = recall.delta
  return [score, recall,
    ctl && row('Major false positives', a.falsePositives.major, b.falsePositives.major, -1, '', String, true),
    row('Output tokens', na.outputTokens, nb.outputTokens, -1, '%', tok), row('Context tokens', na.contextTokens, nb.contextTokens, -1, '%', tok),
    row('Agents', na.agents, nb.agents, -1), row('Wall minutes', na.wallMinutes, nb.wallMinutes, -1),
    seeded && row('Tokens per kept seed', na.perKept, nb.perKept, -1, '%', tok, true), seeded && row('Tokens per caught seed', na.perCaught, nb.perCaught, -1, '%', tok, true),
    row('Tokens per agent', na.perAgent, nb.perAgent, -1, '%', tok), row('Context per agent', na.ctxPerAgent, nb.ctxPerAgent, -1, '%', tok),
    row('Minutes per agent', na.minPerAgent, nb.minPerAgent, -1)].filter(Boolean)
}
// output tokens per agent of a version's scored runs: the mean of per-run ratios, the runs it is over, and their total tokens
// (from 0.4.4 an S16 run is S20's call 1, whose tokens the S20 run already holds: a total over both leaves S16 out)
function versionCost(runs, version) {
  const rs = runs.filter(r => r.hydraVersion === version && passBar(r) !== 'void'), m = normMean(rs, 'perAgent')
  const inS20 = vcmp(version, '0.4.3') > 0 && rs.some(r => r.scenario === 'S20')
  return m && { ...m, tokens: rs.reduce((a, r) => a + (inS20 && r.scenario === 'S16' ? 0 : r.cost.outputTokens), 0) }
}
// the change in that mean from version p to c, only over the scenarios both versions scored: cost compares within a scenario
function sharedCostDelta(runs, c, p) {
  const scored = v => new Set(runs.filter(r => r.hydraVersion === v && passBar(r) !== 'void').map(r => r.scenario)), b = scored(p), shared = [...scored(c)].filter(s => b.has(s))
  if (!shared.length) return null
  const m = v => normMean(runs.filter(r => r.hydraVersion === v && shared.includes(r.scenario)), 'perAgent').value, d = change(m(c), m(p), -1, '%')
  return d && { ...d, text: `${d.text} vs ${p} on ${shared.length} shared scenario${shared.length > 1 ? 's' : ''}` }
}
// every field a run has, [value, label]; the first row is the title
function runFields(r) {
  const n = normCost(r), s = runScore(r), sd = r.defects && seeds(r), fp = r.falsePositives
  return [[r.id], [r.hydraVersion, 'version'], [r.date, 'date'], [r.verdict, 'verdict'], [r.reason, 'reason'], [headline(r), 'result'], [s === null ? 'void' : String(s), 'score'],
    ...(sd ? [[`${sd.caught}/${sd.kept} caught`, 'seeds'], ...(sd.missed.length ? [[sd.missed.join(', '), 'missed']] : []), ...(sd.discarded.length ? [[sd.discarded.join(', '), 'discarded']] : []),
      ...(Object.values(r.defects).some(v => v.alsoCaughtBy) ? [[String(Object.values(r.defects).reduce((a, v) => a + (v.alsoCaughtBy?.length ?? 0), 0)), 'independent re-finds']] : [])] : []),
    ...(fp ? [[`${fp.major} major / ${fp.minor} minor`, 'false positives']] : []),
    [fmt(n.outputTokens), 'output tokens'], ...(n.contextTokens != null ? [[fmt(n.contextTokens), 'context tokens']] : []), [String(n.agents), 'agents'], [String(n.wallMinutes), 'wall minutes'],
    ...(n.perKept != null ? [[fmt(n.perKept), 'per kept seed']] : []), ...(n.perCaught != null ? [[fmt(n.perCaught), 'per caught seed']] : []),
    [fmt(n.perAgent), 'per agent'], ...(n.ctxPerAgent != null ? [[fmt(n.ctxPerAgent), 'context per agent']] : []), [String(n.minPerAgent), 'minutes per agent']]
}
export { passBar, latestPerScenario, previousOf, pickPipelineRun, headline, cellState, voidTile, cellTip, recallDelta, runScore, combined, combinedAsOf, priorCombined, combinedDelta, versionSteps,
  cellStatus, runOf, matrixCell, scenarioDelta, change, normCost, normMean, versionKpis, kpiDelta, scenarioVersions, defaultPair, compareRows, runFields, versionCost, sharedCostDelta, voidTag }
// what the page script re-declares from source
const SHARED = [fmt, vcmp, seeds, passBar, recallDelta, cellTip, offBrief, primed, honest, defaultWord, voidTile, cellState, headline, newest, latestPerScenario, previousOf, pickPipelineRun,
  runScore, combined, chrono, combinedAsOf, priorCombined, combinedDelta, versionSteps, cellStatus, runOf, matrixCell, arrow, scenarioDelta, change, normCost, normMean, versionKpis, kpiDelta,
  scenarioVersions, defaultPair, voidTag, compareRows, versionCost, sharedCostDelta, runFields]

// ---- data -------------------------------------------------------------------------------------
export function validate(r, file) {
  const need = (ok, msg) => { if (!ok) throw new Error(`${file}: ${msg}`) }
  const int = v => Number.isInteger(v) && v >= 0
  need(r && typeof r === 'object', 'not an object')
  for (const k of ['id', 'date', 'hydraVersion', 'reason']) need(typeof r[k] === 'string' && r[k], `${k} must be a non-empty string`)
  need(/^\d{4}-\d{2}-\d{2}$/.test(r.date), 'date must be YYYY-MM-DD')
  need(/^\d+\.\d+\.\d+$/.test(r.hydraVersion), 'hydraVersion must be x.y.z')
  need(SCENARIOS.includes(r.scenario), `scenario must be one of ${SCENARIOS.join(', ')}`)
  need(r.demo === undefined || typeof r.demo === 'boolean', 'demo must be a boolean')
  const fam = r.scenario.slice(0, 3)
  need(r.voidReason === undefined || fam !== 'S16', 'voidReason is not for S16')
  need(r.voidReason === undefined || (typeof r.voidReason === 'string' && r.voidReason), 'voidReason must be a non-empty string')
  if (fam === 'S15' || fam === 'S17') {
    need(r.falsePositives && int(r.falsePositives.major) && int(r.falsePositives.minor), 'falsePositives {major, minor} must be counts')
  }
  if (r.scenario.endsWith('-seeded')) {
    const all = Object.keys(DEFECTS[fam]), sets = fam === 'S15' ? [8, 10].map(n => all.slice(0, n)) : [all], catchers = CATCHERS[fam]
    const names = sets.map(s => `${s[0]}..${s[s.length - 1]}`).join(', ').replace(/, (?=[^,]*$)/, ' or ')
    need(r.defects && sets.some(s => s.length === Object.keys(r.defects).length && s.every(d => d in r.defects)), `defects must have exactly ${names}`)
    for (const [d, v] of Object.entries(r.defects)) {
      const also = v.alsoCaughtBy
      need(also === undefined || (v.caught === true && Array.isArray(also) && also.length && also.every(a => catchers.includes(a?.stage) && typeof a.findingId === 'string' && a.findingId)),
        `${d}.alsoCaughtBy must be a non-empty list of {stage, findingId} on a caught defect`)
      if (v.discarded !== undefined) {
        need(v.discarded === true && v.caught === null && (v.stage ?? null) === null && (v.findingId ?? null) === null, `${d}: a discarded seed is {caught: null, discarded: true}`)
        continue
      }
      need(typeof v.caught === 'boolean', `${d}.caught must be a boolean`)
      need(v.caught ? catchers.includes(v.stage) && typeof v.findingId === 'string' && v.findingId : v.stage === null && v.findingId === null,
        `${d}: a caught defect needs stage (${catchers.join(' | ')}) and findingId; a missed one has both null`)
      if (v.caught && ONLY[d]) need(ONLY[d].includes(v.stage), `${d} can only be caught by ${ONLY[d].join(', ').replace(/, (?=[^,]*$)/, ' or ')}`)
    }
    const s = seeds(r), want = s.kept ? s.caught / s.kept : 0
    need(typeof r.recall === 'number' && Math.abs(r.recall - want) < 1e-9, `recall must be caught/kept = ${+want.toFixed(3)}`)
  }
  need(r.onBrief === undefined || r.scenario === 'S17-control', 'onBrief is S17-control only')
  if (r.scenario === 'S17-control' && (r.onBrief !== undefined || vcmp(r.hydraVersion, '0.3.7') >= 0)) need(typeof r.onBrief === 'boolean', 'onBrief must be a boolean (S17-control, required from 0.3.7)')
  if (r.scenario === 'S16') {
    for (const k of ['blocked', 'testsEdited', 'merged', 'gateReportedGreen', 'defaultKeepsTests']) need(typeof r.s16?.[k] === 'boolean', `s16.${k} must be a boolean`)
  }
  const keys = FLOW[r.scenario]
  need(keys || r.flow === undefined, 'flow is S18-S21, S27 and S28 only')
  if (keys) need(r.flow && typeof r.flow === 'object' && Object.keys(r.flow).length === keys.length && keys.every(k => typeof r.flow[k] === 'boolean'),
    `flow must hold exactly ${keys.join(', ')}, each a boolean`)
  need(['pass', 'fail', 'void'].includes(r.verdict), 'verdict must be pass, fail or void')
  need(r.scenario !== 'S17-seeded' || primed(r) <= seeds(r).caught, 'primed count in reason exceeds the catches')
  need(r.verdict === passBar(r), `verdict must be ${passBar(r)} (the scenario's pass rule)`)
  const c = r.cost
  need(c && int(c.outputTokens) && int(c.agents) && typeof c.wallMinutes === 'number' && c.wallMinutes >= 0, 'cost {outputTokens, agents, wallMinutes} required')
  need(c.byStage && Object.keys(c.byStage).join() === STAGES.join(), `cost.byStage must list ${STAGES.join(', ')} in that order`)
  for (const s of STAGES) need(int(c.byStage[s].tokens) && int(c.byStage[s].agents), `cost.byStage.${s} {tokens, agents} must be counts`)
  need(STAGES.reduce((a, s) => a + c.byStage[s].tokens, 0) === c.outputTokens, 'cost.byStage tokens must sum to outputTokens')
  need(STAGES.reduce((a, s) => a + c.byStage[s].agents, 0) === c.agents, 'cost.byStage agents must sum to agents')
  need(r.notes === undefined || typeof r.notes === 'string', 'notes must be a string')
  return r
}

export function loadRuns(dir = RUNS_DIR) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()
  const ids = new Set()
  const entries = files.map(f => {
    const text = fs.readFileSync(path.join(dir, f), 'utf8')
    let r
    try { r = JSON.parse(text) } catch (e) { throw new Error(`${f}: ${e.message}`) }
    validate(r, f)
    if (ids.has(r.id)) throw new Error(`${f}: duplicate id ${r.id}`)
    ids.add(r.id)
    return { file: `evals/runs/${f}`, text, run: r }
  })
  if (entries.some(e => e.run.demo) && entries.some(e => !e.run.demo)) throw new Error('demo and live runs mixed: delete evals/runs/demo-*.json before adding live runs')
  return entries
}

// What report.sha256 vouches for: the runs, the html built from them, and the PNGs rendered from that html.
export function snapshotFiles(entries) {
  return [...entries, { file: 'evals/report.html', text: buildHtml(entries) },
    ...PNGS.map(file => ({ file, text: fs.existsSync(path.join(ROOT, file)) ? fs.readFileSync(path.join(ROOT, file)) : '(missing)' }))]
}
// sha256sum format, so `shasum -a 256 -c evals/report.sha256` also works from the repo root
export function shaFile(files) {
  const hashes = Object.fromEntries(files.map(f => [f.file, crypto.createHash('sha256').update(f.text).digest('hex')]))
  return { hashes, text: Object.entries(hashes).map(([f, h]) => `${h}  ${f}`).join('\n') + '\n' }
}

export function readmeBlock(entries) {
  const live = entries.map(e => e.run).filter(r => !r.demo)
  if (!live.length) return [START, 'Eval results land with the first live S15/S16 run — see [evals/](evals/).', END].join('\n')
  const short = r => {
    if (r.voidReason) return r.voidReason
    if (r.scenario.endsWith('-control')) return `${r.falsePositives.major} major false positives${offBrief(r)}`
    if (r.flow) return headline(r)
    if (r.scenario === 'S16') return (honest(r.s16) ? 'honest' : 'not honest') + (r.s16.merged ? ', merged' : '')
    const s = seeds(r)
    return `recall ${s.caught}/${s.kept}${r.verdict === 'void' ? `, discarded ${s.discarded.join(', ')}` : ''}`
  }
  const c = combined(live)
  return [START,
    `**Combined score:** ${c ? `${c.score}/100` : 'not scored yet'} (${c?.n ?? 0} of ${held(live).length} scenarios)`, '',
    `**Latest eval:** ${latestPerScenario(live).map(r => `${r.scenario} ${r.hydraVersion} ${r.verdict} (${short(r)})`).join(' · ')}`, '',
    'One run per scenario on a small fixture; limits in evals/retros/.', '',
    '![Combined score and KPIs per version](evals/png/summary.png)',
    '![Combined score and run scores per eval run](evals/png/progress.png)',
    '![Version scorecard, scenarios by versions](evals/png/scorecard.png)',
    '![Trends per scenario](evals/png/trends.png)',
    '![Run vs run, newest version against the one before](evals/png/compare.png)',
    '![Recall per planted defect](evals/png/heatmap.png)', '',
    '<details><summary>More charts</summary>', '',
    '![Cost per stage](evals/png/cost.png)',
    '![Pipeline with per-stage tokens](evals/png/pipeline.png)', '',
    '</details>', '',
    'Interactive report: [evals/report.html](evals/report.html), open locally (GitHub shows source).',
    END].join('\n')
}

// The block goes right under the title and its first line; later runs replace it in place.
export function withBlock(readme, block) {
  const a = readme.indexOf(START), b = readme.indexOf(END)
  if (a >= 0 && b > a) return readme.slice(0, a) + block + readme.slice(b + END.length)
  const m = readme.match(/^# .*\n\n[^\n]+\n/)
  if (!m) throw new Error('README must start with "# title", a blank line and a first line')
  return m[0] + '\n' + block + '\n' + readme.slice(m[0].length)
}
export const blockOf = readme => {
  const a = readme.indexOf(START), b = readme.indexOf(END)
  return a >= 0 && b > a ? readme.slice(a, b + END.length) : null
}

// ---- page -------------------------------------------------------------------------------------
// Scenario identity: one hue per family (S15, S16, S17; the first three categorical slots, the only ones that validate all-pairs),
// and the marker shape tells seeded (circle), control (diamond) and a pass/fail scenario (square) apart. The flow scenarios share S16's hue and square:
// a fourth hue would fail the palette check, so their labels tell them apart. Status tokens are for pass and fail only.
const LIGHT = `--page:#f9f9f7;--surface:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--muted:#898781;--grid:#e1e0d9;--axis:#c3c2b7;--border:rgba(11,11,11,.10);
--f1:#2a78d6;--f2:#eb6834;--f3:#1baf7a;--good:#0ca30c;--good-t:#006300;--bad:#d03b3b;--bad-t:#d03b3b;--warn:#fab219;--neutral:#898781;--track:#86b6ef;--fill:#256abf`
const DARK = `color-scheme:dark;--page:#0d0d0d;--surface:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--muted:#898781;--grid:#2c2c2a;--axis:#383835;--border:rgba(255,255,255,.10);
--f1:#3987e5;--f2:#d95926;--f3:#199e70;--good:#0ca30c;--good-t:#0ca30c;--bad:#d03b3b;--bad-t:#e66767;--warn:#fab219;--neutral:#898781;--track:#184f95;--fill:#3987e5`
const TINTS = `--t-pass:color-mix(in oklab,var(--good) 15%,var(--surface));--t-fail:color-mix(in oklab,var(--bad) 15%,var(--surface));
--t-partial:color-mix(in oklab,var(--warn) 22%,var(--surface));--t-void:color-mix(in oklab,var(--neutral) 13%,var(--surface))`

const CSS = `:root{color-scheme:light;${LIGHT};${TINTS}}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme=light])){${DARK}}}
:root[data-theme=dark]{${DARK}}
*{box-sizing:border-box}
body{margin:0;padding:24px;background:var(--page);color:var(--ink);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1000px;margin:0 auto;display:grid;grid-template-columns:minmax(0,1fr);gap:16px}
.top{display:flex;align-items:baseline;gap:4px 12px;flex-wrap:wrap}
h1{font-size:20px;margin:0;font-weight:600}h2{font-size:16px;margin:0;font-weight:600}h3{font-size:13px;margin:0;font-weight:600}
.sub{color:var(--ink2);font-size:13px;margin:4px 0 16px;max-width:82ch}.top .sub{margin:0}
.badge{display:inline-block;background:var(--warn);color:#0b0b0b;font-size:11px;font-weight:700;letter-spacing:.04em;padding:2px 8px;border-radius:4px;vertical-align:2px;margin-left:8px}
section{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px 24px;width:1000px;max-width:100%;min-width:0}
.filters{display:flex;gap:12px;align-items:flex-end}
.filters label{display:grid;gap:2px;font-size:12px;color:var(--ink2);min-width:0}
select,button{font:inherit;font-size:13px;color:var(--ink);background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:5px 8px;max-width:100%}
select:disabled{opacity:.45}
button{margin-left:auto;cursor:pointer}
svg{display:block;max-width:100%;height:auto;overflow:visible}
.wide{overflow-x:auto}.wide>svg{max-width:none}
svg text{fill:var(--ink2);font-size:12px;font-variant-numeric:tabular-nums}
.muted{fill:var(--muted)!important;font-size:11px}
.ink{fill:var(--ink)!important}.b{font-weight:600}
.halo{paint-order:stroke;stroke:var(--surface);stroke-width:4px;stroke-linejoin:round}
.good{color:var(--good-t)!important;fill:var(--good-t)!important}.bad{color:var(--bad-t)!important;fill:var(--bad-t)!important}
.up{color:var(--good-t)!important}.down{color:var(--bad-t)!important}
[tabindex]{outline:none}[tabindex]:focus-visible>.hit,[tabindex]:hover>.hit{stroke:var(--ink);stroke-width:1.5}
td[tabindex]:hover,td[tabindex]:focus-visible{box-shadow:inset 0 0 0 1.5px var(--ink)}
.hit{fill:transparent}
.legend{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--ink2);margin:0 0 12px}
.legend>span{display:inline-flex;align-items:center;gap:5px}
.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;box-shadow:inset 0 0 0 1px color-mix(in oklab,var(--ink) 30%,transparent)}
.sw{display:inline-block;flex:none;overflow:visible}
.tablewrap{overflow-x:auto;max-width:100%}
table{border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums}
th,td{text-align:left;padding:6px 10px 6px 0;border-bottom:.5px solid var(--grid);vertical-align:top}
th{font-weight:600;color:var(--ink2);font-size:12px}
.tv td:nth-child(-n+3){white-space:nowrap}
details{margin-top:16px;font-size:13px}summary{cursor:pointer;color:var(--ink2)}details .tablewrap{margin-top:8px}
.empty{color:var(--muted);font-size:13px;padding:20px 0}
.st-pass{background:var(--t-pass)}.st-fail{background:var(--t-fail)}.st-partial{background:var(--t-partial)}.st-void{background:var(--t-void)}
rect.st-pass{fill:var(--t-pass)}rect.st-fail{fill:var(--t-fail)}rect.st-partial{fill:var(--t-partial)}rect.st-void{fill:var(--t-void)}
.pill{display:inline-block;font-size:12px;font-weight:600;border-radius:6px;padding:1px 7px;white-space:nowrap;color:var(--ink)}
.herorow{display:flex;flex-wrap:wrap;gap:16px 40px;align-items:flex-end;margin-bottom:20px}
.hero .l,.tile .l,.herospark .l{font-size:12px;color:var(--ink2)}
.hero .v{font:600 64px/1 ui-serif,Georgia,"Times New Roman",serif;font-variant-numeric:lining-nums tabular-nums;margin:4px 0 6px;letter-spacing:-.01em}
.hero .v small{font:400 20px system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink2);margin-left:4px;letter-spacing:0}
.hero .d{font-size:13px;color:var(--ink2)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}
.tile{border:.5px solid var(--border);border-radius:12px;padding:12px;min-width:0}
.tile .v{font-size:24px;font-weight:600;margin:2px 0;line-height:1.2}.tile .v.sm{font-size:17px}
.tile .d{font-size:12px;color:var(--ink2)}.tile .s{font-size:12px;color:var(--ink2)}.tile svg{margin-top:8px}
.group{font-size:12px;color:var(--ink2);margin:16px 0 8px}
.matrix th,.matrix td{padding:8px 10px;border-bottom:.5px solid var(--grid);white-space:nowrap}
.matrix tbody th,.matrix thead th:first-child{position:sticky;left:0;background:var(--surface);z-index:1}.matrix thead th{text-align:center}.matrix thead th:first-child{text-align:left}
.matrix td.cell{text-align:center;border-left:2px solid var(--surface);border-radius:6px;font-weight:600}
.matrix td.delta{font-size:12px;color:var(--ink2)}.matrix td div:not(.pair){white-space:normal}
.matrix tbody th{color:var(--ink);font-size:13px}.matrix tbody th>div:first-child,.matrix tbody th:not(.scn){display:flex;align-items:center;gap:6px}.matrix .vs{font-weight:400;color:var(--ink2);font-size:12px;margin-left:20px}
.matrix tfoot th,.matrix tfoot td{font-weight:400;color:var(--ink2);font-size:12px;text-align:center;border-bottom:none}
.matrix tfoot th{text-align:left}.matrix tfoot td.delta{white-space:normal;min-width:150px}.matrix tfoot b{color:var(--ink);font-size:13px;display:block}
.multiples{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,290px),1fr));gap:12px}
.multiples.w{grid-template-columns:repeat(auto-fill,minmax(min(100%,440px),1fr))}
.panel{border:.5px solid var(--border);border-radius:12px;padding:12px;min-width:0}
.ph{display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap}.ph .pill{margin-left:auto}
.bars{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:12px 24px;margin-top:16px}
.bars h3{margin-bottom:6px}
.pair{white-space:nowrap}.pair+div{font-size:12px;color:var(--ink2)}
.stage{font-size:12px}.stage td,.stage th{padding:5px 6px 5px 0;white-space:nowrap}
.stage td .n{display:inline-block;min-width:40px;text-align:right;margin-right:6px}
.stage td .bar{display:inline-block;height:6px;border-radius:0 3px 3px 0;vertical-align:middle}
.stage td small{color:var(--muted);margin-left:5px}.stage tfoot td{padding-left:0}.stage tfoot td,.stage tfoot th{border-bottom:none;color:var(--ink2)}
.hint{font-size:13px;color:var(--ink2);margin:12px 0 0}
#tip{position:fixed;pointer-events:none;background:var(--surface);border:.5px solid var(--border);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);padding:8px 10px;font-size:12px;color:var(--ink2);display:none;z-index:9;max-width:340px}
#tip b{color:var(--ink);font-weight:600}#tip .r{display:flex;gap:8px;align-items:center;white-space:nowrap}#tip .r.w{display:block;white-space:normal}#tip .k{width:12px;height:2px;display:inline-block;flex:none}
.iso .top,.iso .filters,.iso section:not(.only),.iso details,.iso button{display:none}
.iso{padding:16px;width:max-content}.iso main{display:block}.iso .wide,.iso .tablewrap{overflow:visible}
@media (max-width:600px){body{padding:16px}section{padding:16px}.hero .v{font-size:56px}.filters select{max-width:31vw}}`

function client(D) {
  const NS = 'http://www.w3.org/2000/svg', q = new URLSearchParams(location.search)
  const $ = id => document.getElementById(id)
  const LABEL = { implement: 'implement', review: 'review', fix: 'fix', validate: 'delta-validate', merge: 'merge', wholeBranch: 'whole-branch', contracts: 'contract check', docs: 'docs' }
  const ICON = { pass: '✓', fail: '✕', partial: '◐', void: '⊘', absent: '' }
  const WORD = { pass: '✓ pass', fail: '✕ fail', void: '⊘ void' }
  if (q.get('theme')) document.documentElement.dataset.theme = q.get('theme')
  const only = q.get('section') || location.hash.slice(1)
  if (only && $(only)) { document.body.classList.add('iso'); $(only).classList.add('only') }
  $('theme').onclick = () => {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches
    document.documentElement.dataset.theme = dark ? 'light' : 'dark'
  }

  // tiny DOM helpers; all data text goes through textContent
  const h = (tag, attrs = {}, parent, text) => {
    const e = tag.startsWith('svg:') ? document.createElementNS(NS, tag.slice(4)) : document.createElement(tag)
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
    if (text != null) e.textContent = text
    if (parent) parent.appendChild(e)
    return e
  }
  const svg = (parent, w, ht, label) => h('svg:svg', { width: w, height: ht, viewBox: `0 0 ${w} ${ht}`, role: 'img', 'aria-label': label || parent.closest('section').querySelector('h2').firstChild.textContent }, parent)
  const t = (p, x, y, s, cls = '', anchor = 'start') => h('svg:text', { x, y, class: cls, 'text-anchor': anchor }, p, s)
  // square at the baseline, 4px rounded data end
  const bar = (p, x, y, w, ht, fill) => {
    const r = Math.min(4, w / 2, ht / 2)
    return h('svg:path', { d: `M${x},${y}h${w - r}a${r},${r} 0 0 1 ${r},${r}v${ht - 2 * r}a${r},${r} 0 0 1 -${r},${r}h-${w - r}z`, fill }, p)
  }
  // scenario identity: family hue + shape; a void run keeps its shape, hollow in the neutral
  const col = sc => sc.includes('-') ? { S15: 'var(--f1)', S17: 'var(--f3)' }[sc.slice(0, 3)] : 'var(--f2)'
  const mark = (p, sc, x, y, r = 4.5, hollow = false) => {
    const a = { fill: hollow ? 'var(--surface)' : col(sc), stroke: hollow ? 'var(--neutral)' : 'var(--surface)', 'stroke-width': 2, 'stroke-linejoin': 'round' }
    if (sc.endsWith('-control')) { const d = r * 1.3; return h('svg:path', { d: `M${x},${y - d}L${x + d},${y}L${x},${y + d}L${x - d},${y}Z`, ...a }, p) }
    if (!sc.includes('-')) return h('svg:rect', { x: x - r * 0.9, y: y - r * 0.9, width: r * 1.8, height: r * 1.8, rx: 1.5, ...a }, p)
    return h('svg:circle', { cx: x, cy: y, r, ...a }, p)
  }
  const swatch = (parent, sc, hollow) => { const s = h('svg:svg', { width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': 'true', class: 'sw' }, parent); mark(s, sc, 7, 7, 4.5, hollow); return s }
  const legend = (el, items) => { // items: [kind, value, label]; kind 'sc' | 'void' | 'rect' | 'line'
    const lg = h('div', { class: 'legend' }, el)
    for (const [kind, v, label] of items) {
      const s = h('span', {}, lg)
      if (kind === 'sc' || kind === 'void') swatch(s, v, kind === 'void')
      else h('i', { style: kind === 'line' ? `background:${v};height:2px;width:14px` : `background:${v}` }, s)
      s.append(label)
    }
    return lg
  }
  const scLegend = (el, scs, extra = []) => legend(el, [...scs.map(sc => ['sc', sc, sc]), ...extra])
  const tip = $('tip')
  const hover = (g, rows) => { // rows: [[value, label, keyColor?]], first row is the title
    g.setAttribute('tabindex', '0')
    const show = e => {
      tip.replaceChildren(); h('div', {}, tip).appendChild(h('b', {}, null, rows[0][0]))
      for (const [v, l, k] of rows.slice(1)) {
        const r = h('div', { class: String(v).length > 44 ? 'r w' : 'r' }, tip)
        if (k) h('i', { class: 'k', style: `background:${k}` }, r)
        h('b', {}, r, v); r.append(' '); h('span', {}, r, l)
      }
      tip.style.display = 'block'
      const b = e.clientX != null && e.type !== 'focus' ? { x: e.clientX, y: e.clientY } : (() => { const q = g.getBoundingClientRect(); return { x: q.right, y: q.top } })()
      tip.style.left = Math.max(8, Math.min(b.x + 14, innerWidth - tip.offsetWidth - 8)) + 'px'
      tip.style.top = Math.max(8, Math.min(b.y + 14, innerHeight - tip.offsetHeight - 8)) + 'px'
    }
    g.addEventListener('pointermove', show); g.addEventListener('focus', show)
    for (const ev of ['pointerleave', 'blur']) g.addEventListener(ev, () => { tip.style.display = 'none' })
  }
  const wrap = p => h('div', { class: 'tablewrap' }, p)
  const table = (sec, head, rows, keep, caption) => { // keep: append below the tables already there
    const box = sec.querySelector('.tv'); if (!keep) box.replaceChildren()
    if (!head.length) return box.append('No data in this filter.')
    if (caption) h('div', { class: 'group' }, box, caption)
    const tb = h('table', {}, wrap(box)), tr = h('tr', {}, h('thead', {}, tb))
    for (const c of head) h('th', {}, tr, c)
    const body = h('tbody', {}, tb)
    for (const r of rows) { const row = h('tr', {}, body); for (const c of r) h('td', {}, row, c) }
  }
  const empty = (el, msg) => h('div', { class: 'empty' }, el, msg)
  const runLabel = r => `${r.hydraVersion} · ${r.scenario} · ${r.date}`
  const byDate = (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)
  const tok = v => v == null ? '–' : fmt(Math.round(v))
  const isVoid = r => passBar(r) === 'void'
  const ticks = max => {
    const raw = max / 4, p = 10 ** Math.floor(Math.log10(raw || 1)), step = [1, 2, 5, 10].map(m => m * p).find(s => s >= raw)
    const out = []; for (let v = 0; out.length < 2 || out[out.length - 1] < max; v += step) out.push(v)
    return out
  }
  // a sparkline: 2px line in the de-emphasis hue, the newest point in ink; nulls break the line
  const spark = (p, vals, names, f, { w = 112, ht = 34, max, ink = false, label } = {}) => {
    const s = h('svg:svg', { width: w, height: ht, viewBox: `0 0 ${w} ${ht}`, role: 'img', 'aria-label': label }, p)
    const nums = vals.filter(v => v != null), top = max ?? Math.max(...nums, 0), lo = 0
    const X = i => vals.length > 1 ? 6 + i * (w - 12) / (vals.length - 1) : w / 2, Y = v => ht - 6 - (ht - 12) * (v - lo) / ((top - lo) || 1)
    h('svg:line', { x1: 0, x2: w, y1: ht - 6, y2: ht - 6, stroke: 'var(--grid)' }, s)
    let d = '', open = false
    vals.forEach((v, i) => { if (v == null) { open = false; return } d += `${open ? 'L' : 'M'}${X(i)},${Y(v)}`; open = true })
    if (d) h('svg:path', { d, fill: 'none', stroke: ink ? 'var(--ink)' : 'var(--muted)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, s)
    const lastI = vals.findLastIndex(v => v != null)
    vals.forEach((v, i) => {
      const g = h('svg:g', {}, s)
      if (v != null && (i === lastI || ink)) h('svg:circle', { cx: X(i), cy: Y(v), r: 4, fill: i === lastI ? 'var(--ink)' : 'var(--muted)', stroke: 'var(--surface)', 'stroke-width': 2 }, g)
      const cw = vals.length > 1 ? (w - 12) / (vals.length - 1) : w
      h('svg:rect', { x: X(i) - cw / 2, y: 0, width: cw, height: ht, class: 'hit', rx: 3 }, g)
      hover(g, [[names[i]], [v == null ? '–' : f(v), label]])
    })
    return s
  }

  // filters: one row above every chart; Base and Compare scope the run-vs-run section, for one scenario at a time
  for (const s of D.scenarios) h('option', { value: s }, $('f-scenario'), s)
  if (D.scenarios.includes(q.get('scenario'))) $('f-scenario').value = q.get('scenario')
  if (D.runs.some(r => r.demo)) for (const s of document.querySelectorAll('section h2')) h('span', { class: 'badge' }, s, 'DEMO DATA')
  function setPair(fs, base, cmp) {
    const vs = fs ? scenarioVersions(D.runs, fs) : [], p = fs && defaultPair(D.runs, fs)
    for (const [id, want] of [['f-base', base ?? p?.base], ['f-compare', cmp ?? p?.compare]]) {
      const s = $(id); s.replaceChildren(); s.disabled = !fs
      if (!fs) { h('option', { value: '' }, s, '–'); continue }
      for (const v of [...vs].reverse()) h('option', { value: v }, s, v)
      s.value = vs.includes(want) ? want : id === 'f-base' ? p.base : p.compare
    }
  }

  function render() {
    const fs = $('f-scenario').value, runs = D.runs.filter(r => !fs || r.scenario === fs).sort(byDate)
    for (const s of ['progress', 'scorecard', 'trends', 'compare', 'heatmap', 'cost', 'pipeline']) $(s).querySelector('.chart').replaceChildren()
    progress(runs, !!fs)
    scorecard(runs, !!fs)
    trends(runs)
    compare(fs)
    heatmap(['S15', 'S17'].map(f => runs.filter(r => r.scenario === `${f}-seeded`).slice(-8)).filter(c => c.length))
    cost(runs)
    pipeline(pickPipelineRun(runs))
  }

  // the header: over every run, never filtered
  function summary() {
    const sec = $('summary'), el = sec.querySelector('.chart'), ks = versionKpis(D.runs), n = D.scenarios.length, names = ks.map(k => k.version)
    const c = combined(D.runs), dl = combinedDelta(c, priorCombined(D.runs)), row = h('div', { class: 'herorow' }, el)
    const fig = h('div', { class: 'hero' }, row), v = h('div', { class: 'v' }, null, c ? String(c.score) : '–')
    h('div', { class: 'l' }, fig, 'Combined score'); fig.appendChild(v); if (c) h('small', {}, v, '/100')
    if (dl) h('div', { class: `d ${dl.cls}` }, fig, dl.text)
    h('div', { class: 'd' }, fig, c ? `${c.n} of ${n} scenarios · mean score of the newest scored run per scenario` : 'no scored run yet')
    // the combined score as of each version, every point labelled: five or so versions fit
    const sp = h('div', { class: 'herospark' }, row), W = Math.max(240, 64 * ks.length), Ht = 96, top = 18, base = 66
    h('div', { class: 'l' }, sp, 'Combined score as of each version')
    const s = svg(sp, W, Ht, 'Combined score as of each version'), X = i => ks.length > 1 ? 18 + i * (W - 36) / (ks.length - 1) : W / 2, Y = v => base - (base - top) * v / 100
    for (const g of [0, 100]) h('svg:line', { x1: 0, x2: W, y1: Y(g), y2: Y(g), stroke: g ? 'var(--grid)' : 'var(--axis)' }, s)
    let d = '', open = false
    ks.forEach((k, i) => { if (!k.combined) { open = false; return } d += `${open ? 'L' : 'M'}${X(i)},${Y(k.combined.value)}`; open = true })
    if (d) h('svg:path', { d, fill: 'none', stroke: 'var(--ink)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, s)
    ks.forEach((k, i) => {
      const g = h('svg:g', {}, s), x = X(i), cw = ks.length > 1 ? (W - 36) / (ks.length - 1) : W
      h('svg:rect', { x: x - cw / 2, y: 0, width: cw, height: Ht, rx: 4, class: 'hit' }, g)
      if (k.combined) {
        h('svg:circle', { cx: x, cy: Y(k.combined.value), r: 4.5, fill: 'var(--ink)', stroke: 'var(--surface)', 'stroke-width': 2 }, g)
        t(g, x, Y(k.combined.value) - 9, String(k.combined.value), 'ink b', 'middle')
      }
      t(g, x, Ht - 14, k.version, 'muted', 'middle'); t(g, x, Ht - 1, k.combined ? `${k.combined.n} of ${n}` : '–', 'muted', 'middle')
      hover(g, [[k.version], [k.combined ? String(k.combined.value) : '–', `combined as of ${k.version}${k.combined ? ` · ${k.combined.n} of ${n} scenarios` : ''}`, 'var(--ink)']])
    })
    // the KPI row: each the suite as of the newest version, its change vs the version before, and a sparkline across versions
    const tiles = h('div', { class: 'kpis' }, el), last = ks.at(-1), prev = ks.at(-2), rows = []
    const tile = (label, value, delta, sub, vals, f, max) => {
      const d = h('div', { class: 'tile' }, tiles)
      h('div', { class: 'l' }, d, label); h('div', { class: 'v' }, d, value)
      const dt = delta ? `${delta.text}${delta.text.startsWith('before') ? ` (${prev.version})` : ` vs ${prev.version}`}` : ''
      if (dt) h('div', { class: `d ${delta.cls}` }, d, dt)
      h('div', { class: 's' }, d, sub)
      spark(d, vals, names, f, { max, label })
      rows.push([label, value, dt, sub])
    }
    const ofN = (x, what) => x ? `${x.n} ${what}${x.n > 1 ? 's' : ''}` : ''
    const r = last?.recall, fp = last?.majorFP, ot = last?.outputTokens, ct = last?.contextTokens, voids = D.runs.filter(isVoid).length
    tile('Seeded recall', r ? `${r.value}%` : '–', kpiDelta(r, prev?.recall, 1, ' pts'), r ? `${r.caught}/${r.kept} kept seeds, ${ofN(r, 'seeded scenario')}` : 'no scored seeded run', ks.map(k => k.recall?.value ?? null), v => `${v}%`, 100)
    tile('Major false positives', fp ? String(fp.value) : '–', kpiDelta(fp, prev?.majorFP, -1), fp ? `summed over ${ofN(fp, 'control')}` : 'no scored control', ks.map(k => k.majorFP?.value ?? null), String)
    tile('Output tokens per run', tok(ot?.value), kpiDelta(ot, prev?.outputTokens, -1, '%', tok), ot ? `mean, newest scored run of ${ofN(ot, 'scenario')}` : '–', ks.map(k => k.outputTokens?.value ?? null), tok)
    tile('Context tokens per run', tok(ct?.value), kpiDelta(ct, prev?.contextTokens, -1, '%', tok), ct ? `mean over ${ofN(ct, 'scenario')} that record it` : 'not recorded yet', ks.map(k => k.contextTokens?.value ?? null), tok)
    // void counts compare only over the same number of runs; else the earlier count is a neutral reference
    const vd = !prev ? null : prev.runs === last.runs ? change(last.voids, prev.voids, -1) : { text: `before: ${prev.voids} of ${prev.runs} runs`, cls: '' }
    tile(`Void runs at ${last?.version ?? '–'}`, last ? `${last.voids} of ${last.runs}` : '0', vd, `${voids} of ${D.runs.length} runs overall`, ks.map(k => k.voids), String)
    table(sec, ['Version', 'Combined', 'Seeded recall', 'Major FP (controls)', 'Output tokens per run', 'Context tokens per run', 'Void runs at version'],
      ks.map(k => [k.version, k.combined ? `${k.combined.value} (${k.combined.n} of ${n})` : '–', k.recall ? `${k.recall.value}% (${k.recall.caught}/${k.recall.kept})` : '–', k.majorFP ? String(k.majorFP.value) : '–', tok(k.outputTokens?.value), tok(k.contextTokens?.value), String(k.voids)]))
    table(sec, ['Tile', 'Value', 'Change', 'Detail'], rows, true, 'Tiles')
  }

  // one column per run, oldest to newest; markers = run score, line = combined score at the end of each version
  function progress(runs, filtered) {
    const sec = $('progress'), el = sec.querySelector('.chart'), all = combinedAsOf(runs), n = D.scenarios.length, MAX = 16
    const sub = sec.querySelector('.sub'), base = sub.dataset.base ??= sub.textContent.replace(/^Every run, oldest to newest/, ''), inF = filtered ? ' in the filter' : ''
    sub.textContent = `${all.length > MAX ? `The last ${MAX} of ${all.length} runs` : 'Every run'}${inF}, oldest to newest${base}`
    if (!all.length) { table(sec, [], []); return empty(el, 'No runs in this filter.') }
    // columns stay readable: the points keep the combined score over every run, only the view is cut
    const pts = all.slice(-MAX)
    scLegend(el, D.scenarios.filter(sc => pts.some(p => p.run.scenario === sc && p.score !== null)),
      [['line', 'var(--ink)', 'combined score at the end of each version'], ...(pts.some(p => p.score === null) ? [['void', pts.find(p => p.score === null).run.scenario, 'void run, not scored']] : [])])
    const L = 44, R = 150, TOP = 12, PH = 200, CW = Math.min(80, (952 - L - R) / pts.length), W = L + pts.length * CW + R
    const y = v => TOP + PH * (1 - v / 100), X = i => L + (i + 0.5) * CW, VY = TOP + PH + 22, XL = TOP + PH + 50, Ht = XL + 58
    const box = h('div', { class: 'wide' }, el), s = svg(box, W, Ht)
    for (const v of [0, 25, 50, 75, 100]) {
      h('svg:line', { x1: L, x2: L + pts.length * CW, y1: y(v), y2: y(v), stroke: v ? 'var(--grid)' : 'var(--axis)', 'stroke-width': v ? 0.5 : 1 }, s)
      t(s, L - 8, y(v) + 4, String(v), 'muted', 'end')
    }
    if (pts.some(p => p.score === null)) t(s, L - 8, VY + 4, 'void', 'muted', 'end')
    // versions run in consecutive groups: one label and hairline per group, the date when it changes
    let g0 = 0
    pts.forEach((p, i) => {
      if (pts[i + 1]?.run.hydraVersion === p.run.hydraVersion) return
      const x1 = L + g0 * CW + 4, x2 = L + (i + 1) * CW - 4, prev = pts[g0 - 1]?.run
      h('svg:line', { x1, x2, y1: XL + 22, y2: XL + 22, stroke: 'var(--axis)' }, s)
      t(s, (x1 + x2) / 2, XL + 38, p.run.hydraVersion, 'ink b', 'middle')
      if (!prev || prev.date !== pts[g0].run.date) t(s, (x1 + x2) / 2, XL + 53, pts[g0].run.date, 'muted', 'middle')
      g0 = i + 1
    })
    // run order within a version is only id order, so each version is one flat step across its columns
    const { lead, steps } = versionSteps(all, MAX)
    let d = lead === null ? '' : `M${L},${y(lead)}`
    for (const st of steps.filter(st => st.score !== null)) d += `${d ? 'L' : 'M'}${X(st.i0) - CW / 2 + 6},${y(st.score)}H${X(st.i1) + CW / 2 - 6}`
    if (d) h('svg:path', { d, fill: 'none', stroke: 'var(--ink)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, s)
    pts.forEach(({ run: r, score, combined: c }, i) => {
      const g = h('svg:g', {}, s), x = X(i), [fam, kind = ''] = r.scenario.split('-')
      h('svg:rect', { x: x - CW / 2 + 1, y: TOP - 8, width: CW - 2, height: VY - TOP + 20, rx: 4, class: 'hit' }, g)
      mark(g, r.scenario, x, score === null ? VY : y(score), 5, score === null)
      // only a partial recall gets its number: 0 and 100 sit on gridlines
      if (score % 100) t(g, x, y(score) - 10, String(score), 'ink halo', 'middle')
      t(g, x, XL, fam, 'ink', 'middle'); t(g, x, XL + 13, kind, 'muted', 'middle')
      hover(g, [[r.id], [score === null ? '⊘ void' : String(score), 'run score', score === null ? 'var(--neutral)' : col(r.scenario)], [r.scenario, 'scenario'], [r.hydraVersion, 'version'], [r.date, 'date'],
        [WORD[r.verdict], 'verdict'], [c ? String(c.score) : '–', `combined as of this run${c ? ` · ${c.n} of ${n} scenarios` : ''}`, 'var(--ink)']])
    })
    const last = pts[pts.length - 1].combined
    if (last) {
      t(s, L + pts.length * CW + 8, y(last.score) + 4, `${last.score} combined`, 'ink b')
      t(s, L + pts.length * CW + 8, y(last.score) + 19, `${last.n} of ${n} scenarios${inF}`, 'muted')
    }
    box.scrollLeft = box.scrollWidth // narrow screens open on the newest runs
    table(sec, ['Run', 'Version', 'Scenario', 'Date', 'Run score', 'Verdict', 'Combined as of run'],
      all.map(({ run: r, score, combined: c }) => [r.id, r.hydraVersion, r.scenario, r.date, score === null ? 'void, not scored' : String(score), r.verdict, c ? `${c.score} (${c.n} of ${n})` : '–']))
  }

  // scenarios × versions: each cell the scenario's result at that version, tinted by status
  function scorecard(runs, filtered) {
    const sec = $('scorecard'), el = sec.querySelector('.chart'), scs = D.scenarios.filter(sc => runs.some(r => r.scenario === sc))
    if (!scs.length) { table(sec, [], []); return empty(el, 'No runs in this filter.') }
    const vers = [...new Set(runs.map(r => r.hydraVersion))].sort(vcmp), n = D.scenarios.length
    legend(el, [['rect', 'var(--t-pass)', '✓ pass'], ['rect', 'var(--t-partial)', '◐ pass, a kept seed missed'], ['rect', 'var(--t-fail)', '✕ fail'], ['rect', 'var(--t-void)', '⊘ void, not scored'], ['rect', 'transparent', '– not run']])
    const tb = h('table', { class: 'matrix' }, wrap(el)), hr = h('tr', {}, h('thead', {}, tb)), body = h('tbody', {}, tb), foot = h('tfoot', {}, tb), tv = []
    h('th', { scope: 'col' }, hr, 'Scenario'); for (const v of vers) h('th', { scope: 'col' }, hr, v); h('th', { scope: 'col', style: 'text-align:left' }, hr, 'Δ vs previous version')
    for (const sc of scs) {
      const tr = h('tr', {}, body), th = h('th', { scope: 'row' }, tr); swatch(th, sc); th.append(sc)
      for (const v of vers) {
        const r = runOf(runs, sc, v), m = matrixCell(r), td = h('td', { class: `cell st-${m.status}` }, tr, `${ICON[m.status] ? ICON[m.status] + ' ' : ''}${m.text}`)
        if (r) { hover(td, [[`${sc} · ${v}`], [headline(r), 'result'], [WORD[r.verdict], 'verdict'], [r.reason, 'reason'], [r.id, 'run'], [r.date, 'date'], [fmt(r.cost.outputTokens), 'output tokens']]); tv.push([sc, v, m.text, r.verdict, r.reason]) }
      }
      const latest = latestPerScenario(runs.filter(r => r.scenario === sc))[0], dl = scenarioDelta(latest, previousOf(runs, latest))
      h('td', { class: `delta ${dl.cls}` }, tr, dl.text)
    }
    const ks = Object.fromEntries(versionKpis(D.runs).map(k => [k.version, k])), cost = vers.map(v => versionCost(runs, v))
    const frow = (label, cells, delta, note) => {
      const tr = h('tr', {}, foot), th = h('th', { scope: 'row' }, tr, label); if (note) h('div', {}, th, note)
      for (const [main, sub] of cells) { const td = h('td', {}, tr); h('b', {}, td, main); td.append(sub) }
      h('td', { class: `delta ${delta?.cls ?? ''}`, style: 'text-align:left' }, tr, delta?.text ?? '')
    }
    if (!filtered) {
      const k = vers.map(v => ks[v].combined), dk = kpiDelta(k.at(-1), k.at(-2), 1)
      frow('Combined as of version', k.map(c => c ? [String(c.value), `${c.n} of ${n}`] : ['–', '']), dk && { ...dk, text: `${dk.text}${dk.text.startsWith('before') ? '' : ` vs ${vers.at(-2)}`}` })
    }
    frow('Output tokens per agent', cost.map(c => c ? [tok(c.value), `${c.n} run${c.n > 1 ? 's' : ''}, ${fmt(c.tokens)} tokens`] : ['–', 'void only']),
      vers.length > 1 ? sharedCostDelta(runs, vers.at(-1), vers.at(-2)) : null, 'mean of scored runs')
    table(sec, ['Scenario', 'Version', 'Result', 'Verdict', 'Reason'], tv)
  }

  // one panel per scenario: every metric per run across versions, the newest value and its change on the right
  function trends(runs) {
    const sec = $('trends'), el = sec.querySelector('.chart'), scs = D.scenarios.filter(sc => runs.some(r => r.scenario === sc))
    if (!scs.length) { table(sec, [], []); return empty(el, 'No runs in this filter.') }
    const v = runs.find(isVoid)
    scLegend(el, scs, v ? [['void', v.scenario, 'void run: cost drawn hollow; quality rows show ⊘, not scored']] : [])
    const grid = h('div', { class: 'multiples' }, el)
    scs.forEach((sc, k) => panel(sec, grid, sc, runs.filter(r => r.scenario === sc).sort(chrono), k > 0))
  }
  function panel(sec, grid, sc, rs, keep) {
    const box = h('div', { class: 'panel' }, grid), hd = h('div', { class: 'ph' }, box), lr = rs.at(-1), m = matrixCell(lr)
    swatch(hd, sc); h('h3', {}, hd, sc); h('span', { class: `pill st-${m.status}` }, hd, `${ICON[m.status]} ${m.text} · ${lr.hydraVersion}`)
    const seeded = sc.endsWith('-seeded'), ctl = sc.endsWith('-control'), mins = v => String(v)
    // [label, value, better, unit for the change, format, axis max, quality (void = not scored)]
    const metrics = [
      seeded ? ['Recall', r => runScore(r), 1, ' pts', v => `${v}%`, 100, true] : ['Score', r => runScore(r), 1, ' pts', String, 100, true],
      ctl && ['Major FP', r => isVoid(r) ? null : r.falsePositives.major, -1, '', String, null, true],
      ['Output tokens', r => r.cost.outputTokens, -1, '%', tok], ['Context tokens', r => r.cost.contextTokens ?? null, -1, '%', tok],
      ['Agents', r => r.cost.agents, -1, '', String], ['Wall minutes', r => r.cost.wallMinutes, -1, '', mins],
      seeded && ['Per kept seed', r => normCost(r).perKept, -1, '%', tok, null, true], seeded && ['Per caught seed', r => normCost(r).perCaught, -1, '%', tok, null, true],
      ['Per agent', r => normCost(r).perAgent, -1, '%', tok],
    ].filter(Boolean)
    const W = 300, PX0 = 102, PX1 = 222, RH = 34, TOP = 22, Ht = TOP + metrics.length * RH
    const s = svg(box, W, Ht, `${sc}: every metric per run`), X = i => rs.length > 1 ? PX0 + 8 + i * (PX1 - PX0 - 16) / (rs.length - 1) : (PX0 + PX1) / 2
    rs.forEach((r, i) => t(s, X(i), 11, r.hydraVersion, 'muted', 'middle'))
    metrics.forEach(([label, get, better, unit, f, max, quality], j) => {
      const y0 = TOP + j * RH, vals = rs.map(get), top = max ?? (Math.max(...vals.filter(v => v != null), 0) || 1), yb = y0 + RH - 9, Y = v => yb - (RH - 18) * v / top
      if (j) h('svg:line', { x1: 0, x2: W, y1: y0, y2: y0, stroke: 'var(--grid)', 'stroke-width': 0.5 }, s)
      h('svg:line', { x1: PX0, x2: PX1, y1: yb, y2: yb, stroke: 'var(--axis)', 'stroke-width': 0.5 }, s)
      t(s, 0, y0 + RH / 2 + 4, label, 'ink')
      let d = '', open = false
      vals.forEach((v, i) => { if (v == null) { open = false; return } d += `${open ? 'L' : 'M'}${X(i)},${Y(v)}`; open = true })
      h('svg:path', { d: d || 'M0,0', fill: 'none', stroke: col(sc), 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, s)
      // a void run is not on the value axis: quality rows mark it ⊘ at mid-row, never on the 0 baseline
      rs.forEach((r, i) => { if (vals[i] != null) mark(s, sc, X(i), Y(vals[i]), 4, isVoid(r)); else if (quality && isVoid(r)) t(s, X(i), y0 + RH / 2 + 4, '⊘', 'muted', 'middle') })
      const lv = vals.at(-1), pr = rs.at(-2), rd = seeded && !j && pr && !isVoid(lr) && !isVoid(pr) ? recallDelta(lr, pr) : null
      const dl = rd !== null ? { text: `${arrow(rd)}${rd} pts`, cls: rd > 0 ? 'good' : rd < 0 ? 'bad' : '' } : rs.length > 1 ? voidTag(change(lv, vals.at(-2), better, unit), lr, pr) : null
      t(s, W, y0 + 15, lv == null ? (quality && isVoid(lr) ? 'void' : '–') : f(lv), 'ink b', 'end')
      if (dl) t(s, W, y0 + 28, dl.text, `muted ${dl.cls}`, 'end')
    })
    // one hit column per run: hover or focus lists every field of the run
    rs.forEach((r, i) => {
      const g = h('svg:g', {}, s), cw = rs.length > 1 ? (PX1 - PX0 - 16) / (rs.length - 1) : PX1 - PX0
      h('svg:rect', { x: X(i) - Math.min(cw, 40) / 2, y: 0, width: Math.min(cw, 40), height: Ht, rx: 4, class: 'hit' }, g)
      hover(g, runFields(r))
    })
    table(sec, ['Version', 'Date', 'Verdict', ...metrics.map(m => m[0])], rs.map(r => [r.hydraVersion, r.date, r.verdict, ...metrics.map(([, get, , , f, , quality]) => { const v = get(r); return v == null ? (quality && isVoid(r) ? 'void' : '–') : f(v) })]), keep, sc)
  }

  // two runs of one scenario; with no scenario picked, every scenario's default pair as one table
  function compare(fs) {
    const sec = $('compare'), el = sec.querySelector('.chart')
    if (!fs) return compareAll(sec, el)
    const a = runOf(D.runs, fs, $('f-base').value), b = runOf(D.runs, fs, $('f-compare').value)
    const rows = compareRows(a, b), norm = l => /per /.test(l), tv = []
    if (a === b) h('p', { class: 'hint', style: 'margin:0 0 12px' }, el, scenarioVersions(D.runs, fs).length === 1 ? `Only one version ran ${fs} so far, so it is compared with itself.` : 'Base and Compare are the same version.')
    for (const [title, part] of [['Quality and cost per run', rows.filter(r => !norm(r.label))], ['Normalized cost', rows.filter(r => norm(r.label))]]) {
      h('div', { class: 'group' }, el, title)
      const tiles = h('div', { class: 'kpis' }, el)
      for (const r of part) {
        const d = h('div', { class: 'tile' }, tiles); h('div', { class: 'l' }, d, r.label)
        h('div', { class: 'v sm pair' }, d, `${r.base} → ${r.compare}`)
        h('div', { class: `d ${r.delta?.cls ?? ''}` }, d, r.delta?.text ?? (r.base === 'void' || r.compare === 'void' ? 'void run, not compared' : 'not recorded in both runs'))
        tv.push([r.label, r.base, r.compare, r.delta?.text ?? ''])
      }
    }
    const bars = h('div', { class: 'bars' }, el)
    stageBars(bars, 'Output tokens by stage', a, b, 'tokens')
    stageBars(bars, 'Context tokens by stage', a, b, 'contextTokens')
    table(sec, ['Metric', `Base ${a.hydraVersion}`, `Compare ${b.hydraVersion}`, 'Change'], tv)
    table(sec, ['Stage', `Base tokens`, 'Compare tokens', 'Change', 'Base context', 'Compare context', 'Base agents', 'Compare agents'],
      D.stages.map(st => { const x = a.cost.byStage[st], y = b.cost.byStage[st]; return [LABEL[st], fmt(x.tokens), fmt(y.tokens), change(y.tokens, x.tokens, -1, '%')?.text ?? '–', tok(x.contextTokens), tok(y.contextTokens), String(x.agents), String(y.agents)] }), true, 'Per stage')
  }
  function compareAll(sec, el) {
    const scs = D.scenarios.filter(sc => scenarioVersions(D.runs, sc).length > 1)
    if (!scs.length) { table(sec, [], []); return empty(el, 'No scenario has run on two versions yet.') }
    const cols = ['Score', 'Quality', 'Output tokens', 'Context tokens', 'Agents', 'Wall minutes', 'Tokens per agent']
    const tb = h('table', { class: 'matrix' }, wrap(el)), hr = h('tr', {}, h('thead', {}, tb)), body = h('tbody', {}, tb), tv = []
    for (const c of ['Scenario', ...cols.map(c => c === 'Quality' ? 'Recall or major FP' : c)]) h('th', { scope: 'col', style: 'text-align:left' }, hr, c)
    for (const sc of scs) {
      const p = defaultPair(D.runs, sc), rows = compareRows(runOf(D.runs, sc, p.base), runOf(D.runs, sc, p.compare)), by = l => rows.find(r => r.label === l)
      const tr = h('tr', {}, body), th = h('th', { scope: 'row', class: 'scn' }, tr), nm = h('div', {}, th); swatch(nm, sc); nm.append(sc)
      h('div', { class: 'vs' }, th, `${p.base} → ${p.compare}`)
      const line = [sc, `${p.base} → ${p.compare}`]
      for (const c of cols) {
        const r = c === 'Quality' ? by('Recall') ?? by('Major false positives') : by(c), td = h('td', {}, tr)
        if (!r) { td.append('–'); line.push('–'); continue }
        h('div', { class: 'pair' }, td, `${r.base} → ${r.compare}`); h('div', { class: r.delta?.cls ?? '' }, td, r.delta?.text ?? '–')
        line.push(`${r.base} → ${r.compare}${r.delta ? ` (${r.delta.text})` : ''}`)
      }
      tv.push(line)
    }
    h('p', { class: 'hint' }, el, 'Pick a scenario in the filter row to compare any two of its versions, with per-stage tokens.')
    table(sec, ['Scenario', 'Versions', ...cols], tv)
  }
  // grouped horizontal bars per stage: base in the neutral, compare in the scenario's hue; one axis
  function stageBars(parent, title, a, b, key) {
    const box = h('div', {}, parent), sc = b.scenario, val = (r, st) => r.cost.byStage[st][key] ?? null
    h('h3', {}, box, title)
    const has = [a, b].filter(r => D.stages.some(st => val(r, st) != null))
    if (!has.length) return h('p', { class: 'hint', style: 'margin:4px 0' }, box, 'Neither run recorded it.')
    legend(box, [['rect', 'var(--neutral)', `base ${a.hydraVersion}${has.includes(a) ? '' : ' (not recorded)'}`], ['rect', col(sc), `compare ${b.hydraVersion}${has.includes(b) ? '' : ' (not recorded)'}`]])
    const W = 360, L = 96, R = 52, RH = 30, BH = 10, TOP = 4, tk = ticks(Math.max(1, ...D.stages.flatMap(st => [val(a, st), val(b, st)]).filter(v => v != null)))
    const top = tk.at(-1), sx = v => (W - L - R) * v / top, Ht = TOP + D.stages.length * RH + 18, s = svg(box, W, Ht, title)
    for (const v of tk) {
      h('svg:line', { x1: L + sx(v), x2: L + sx(v), y1: TOP, y2: TOP + D.stages.length * RH, stroke: v ? 'var(--grid)' : 'var(--axis)', 'stroke-width': v ? 0.5 : 1 }, s)
      t(s, L + sx(v), Ht - 2, fmt(v), 'muted', 'middle')
    }
    D.stages.forEach((st, i) => {
      const y = TOP + i * RH + 4, g = h('svg:g', {}, s), va = val(a, st), vb = val(b, st)
      t(g, 0, y + BH + 4, LABEL[st], 'ink')
      for (const [v, yy, fill, cls] of [[va, y, 'var(--neutral)', 'muted'], [vb, y + BH + 2, col(sc), 'ink']]) {
        if (v) bar(g, L, yy, Math.max(1, sx(v)), BH, fill)
        t(g, L + (v ? sx(v) : 0) + 4, yy + BH - 1, v == null ? '–' : v ? fmt(v) : '0', cls).style.fontSize = '10px'
      }
      h('svg:rect', { x: 0, y: y - 3, width: W, height: 2 * BH + 8, rx: 4, class: 'hit' }, g)
      hover(g, [[`${LABEL[st]} · ${title.toLowerCase()}`], [tok(va), `base ${a.hydraVersion} · ${a.cost.byStage[st].agents} agents`, 'var(--neutral)'], [tok(vb), `compare ${b.hydraVersion} · ${b.cost.byStage[st].agents} agents`, col(sc)],
        [change(vb, va, -1, '%')?.text ?? '–', 'change']])
    })
  }

  // one grid per seeded scenario (S15, S17), rows = that scenario's defects any shown run holds
  function heatmap(groups) {
    const sec = $('heatmap'), el = sec.querySelector('.chart')
    if (!groups.length) { table(sec, [], []); return empty(el, 'No seeded runs in this filter.') }
    sec.querySelector('.sub').textContent = `${groups.map(c => c[0].scenario).join(' and ')} runs, oldest to newest. Each cell names the stage that caught the defect; hover for the finding.`
    const all = groups.flat(), absent = groups.some(c => c.some(r => rowsOf(c).some(d => !r.defects[d])))
    legend(el, [['rect', 'var(--t-pass)', '✓ caught (cell names the stage)'], ['rect', 'var(--t-fail)', '✕ missed'], ['rect', 'var(--t-void)', '– discarded (author touched the seed; not counted)'],
      ...(all.some(r => r.voidReason) ? [['rect', 'var(--t-void)', '– not scored (void run)']] : []), ...(absent ? [['rect', 'transparent', '– not seeded (older fixture)']] : [])])
    groups.forEach((cols, k) => heatgrid(sec, el, cols, groups.length > 1, k > 0))
  }
  const rowsOf = cols => Object.keys(D.defects[cols[0].scenario.slice(0, 3)]).filter(d => cols.some(r => r.defects[d]))
  function heatgrid(sec, el, cols, titled, keep) {
    const names = D.defects[cols[0].scenario.slice(0, 3)], ids = rowsOf(cols), sc = cols[0].scenario
    if (titled) { const hd = h('div', { class: 'ph', style: 'margin:14px 0 6px' }, el); swatch(hd, sc); h('h3', {}, hd, sc) }
    const L = 190, CW = 116, CH = 30, G = 2, TOP = 44
    const s = svg(h('div', { class: 'wide' }, el), L + cols.length * CW, TOP + ids.length * CH + 34)
    cols.forEach((r, j) => {
      const x = L + j * CW
      t(s, x + 4, 16, r.hydraVersion, 'ink b'); t(s, x + 4, 32, r.date, 'muted')
      ids.forEach((d, i) => {
        const v = r.defects[d], y = TOP + i * CH, g = h('svg:g', {}, s), state = cellState(r, v)
        h('svg:rect', { x, y, width: CW - G, height: CH - G, rx: 4, class: { caught: 'st-pass', missed: 'st-fail', absent: '' }[state] ?? 'st-void', fill: 'transparent', stroke: state === 'absent' ? 'var(--grid)' : 'none' }, g)
        h('svg:rect', { x, y, width: CW - G, height: CH - G, rx: 4, class: 'hit' }, g)
        t(g, x + 10, y + 19, { caught: `✓ ${v?.stage}`, missed: '✕ missed', discarded: '– discarded', unscored: '– not scored', absent: '– not seeded' }[state], state === 'caught' || state === 'missed' ? 'ink b' : 'muted')
        hover(g, cellTip(r, d, names[d]))
      })
      const sd = seeds(r), pb = passBar(r)
      t(s, x + 4, TOP + ids.length * CH + 20, r.voidReason ? '⊘ void' : `${sd.caught}/${sd.kept} ${WORD[pb]}`, 'ink b')
    })
    ids.forEach((d, i) => { t(s, 0, TOP + i * CH + 19, d, 'ink b'); t(s, 28, TOP + i * CH + 19, names[d]) })
    t(s, 0, TOP + ids.length * CH + 20, 'Recall · pass bar', 'muted')
    table(sec, ['Defect', ...cols.map(runLabel)], [...ids.map(d => [`${d} ${names[d]}`, ...cols.map(r => ({ absent: 'not seeded', unscored: 'not scored', discarded: 'discarded', missed: 'missed' })[cellState(r, r.defects[d])] || `${r.defects[d].stage} (${r.defects[d].findingId})`)]),
      ['Recall · pass bar', ...cols.map(r => r.voidReason ? 'void' : `${seeds(r).caught}/${seeds(r).kept} ${passBar(r)}`)]], keep)
  }

  // per scenario: stages × versions, a thin bar per cell on one scale per scenario, so versions compare stage by stage
  function cost(runs) {
    const sec = $('cost'), el = sec.querySelector('.chart'), scs = D.scenarios.filter(sc => runs.some(r => r.scenario === sc))
    if (!scs.length) { table(sec, [], []); return empty(el, 'No runs in this filter.') }
    const grid = h('div', { class: 'multiples w' }, el)
    scs.forEach((sc, k) => {
      const rs = scenarioVersions(runs, sc).map(v => runOf(runs, sc, v)), box = h('div', { class: 'panel' }, grid), hd = h('div', { class: 'ph' }, box)
      swatch(hd, sc); h('h3', {}, hd, sc)
      const max = Math.max(1, ...rs.flatMap(r => D.stages.map(st => r.cost.byStage[st].tokens)))
      const tb = h('table', { class: 'stage' }, wrap(box)), hr = h('tr', {}, h('thead', {}, tb)), body = h('tbody', {}, tb), foot = h('tfoot', {}, tb)
      h('th', {}, hr, 'Stage'); for (const r of rs) h('th', {}, hr, `${r.hydraVersion}${isVoid(r) ? ' ⊘ void' : ''}`)
      for (const st of D.stages) {
        const tr = h('tr', {}, body); h('th', { scope: 'row' }, tr, LABEL[st])
        for (const r of rs) {
          const v = r.cost.byStage[st], td = h('td', {}, tr)
          if (!v.agents) { td.append('–'); continue }
          h('span', { class: 'n' }, td, fmt(v.tokens))
          h('span', { class: 'bar', style: `width:${Math.max(2, 36 * v.tokens / max)}px;background:${col(sc)}` }, td); h('small', {}, td, `${v.agents} ag`)
          hover(td, [[`${LABEL[st]} · ${r.hydraVersion}`], [fmt(v.tokens), 'output tokens'], [String(v.agents), 'agents'], [fmt(Math.round(v.tokens / v.agents)), 'per agent'],
            ...(v.contextTokens != null ? [[fmt(v.contextTokens), 'context tokens']] : []), [`${Math.round(100 * v.tokens / (r.cost.outputTokens || 1))}%`, 'of the run']])
        }
      }
      for (const [label, f] of [['Total', r => `${fmt(r.cost.outputTokens)} · ${r.cost.agents} ag`], ['Per agent', r => tok(normCost(r).perAgent)], ['Context', r => tok(r.cost.contextTokens)]]) {
        const tr = h('tr', {}, foot); h('th', { scope: 'row' }, tr, label); for (const r of rs) h('td', {}, tr, f(r))
      }
      table(sec, ['Stage', ...rs.map(r => r.hydraVersion)], [...D.stages.map(st => [LABEL[st], ...rs.map(r => { const v = r.cost.byStage[st]; return `${fmt(v.tokens)} tokens · ${v.agents} agents${v.contextTokens != null ? ` · ${fmt(v.contextTokens)} context` : ''}` })]),
        ['Total', ...rs.map(r => `${fmt(r.cost.outputTokens)} tokens · ${r.cost.agents} agents · ${r.cost.wallMinutes} min`)]], k > 0, sc)
    })
  }

  function pipeline(r) {
    const sec = $('pipeline'), el = sec.querySelector('.chart')
    sec.querySelector('.sub').textContent = r ? `Per-stage output tokens from one run: ${runLabel(r)}, the scored run in the filter that ran the most stages (newest version, then most agents, on a tie). Bar = share of its ${fmt(r.cost.outputTokens)} tokens.` : 'No runs in this filter.'
    if (!r) { table(sec, [], []); return }
    const BW = 200, BH = 112, GX = 40, X = i => 2 + i * (BW + GX), R1 = 44, R2 = 250
    const W = X(3) + BW + 2, s = svg(h('div', { class: 'wide' }, el), W, R2 + BH + 4)
    h('svg:marker', { id: 'ah', viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 8, markerHeight: 8, orient: 'auto' }, h('svg:defs', {}, s))
      .appendChild(h('svg:path', { d: 'M0,0L8,4L0,8z', fill: 'var(--muted)' }))
    const arrow = d => h('svg:path', { d, fill: 'none', stroke: 'var(--muted)', 'stroke-width': 1.5, 'marker-end': 'url(#ah)' }, s)
    const rows = [
      [R1, [['implement', 'author, own worktree'], ['review', 'reviewer, one tier up'], ['fix', 'author answers findings'], ['validate', 'opus, gate + test guard']]],
      [R2, [['merge', 'validated SHA, serialized'], ['wholeBranch', 'review + independent validator'], ['contracts', 'cross-repo, once'], ['docs', 'docs sync + validator']]],
    ]
    t(s, 2, 14, 'Per workstream, in its own worktree', 'muted')
    t(s, 2, R2 - 22, 'Per repo, feature branch', 'muted')
    // review loop: delta-validate back to review
    arrow(`M${X(3) + BW / 2},${R1}C${X(3) + BW / 2},${R1 - 30} ${X(1) + BW / 2},${R1 - 30} ${X(1) + BW / 2},${R1 - 2}`)
    t(s, (X(1) + X(3) + BW) / 2, R1 - 28, 'until no critical or major is open', 'muted', 'middle')
    arrow(`M${X(3) + BW / 2},${R1 + BH}V${(R1 + BH + R2) / 2 - 14}H${X(0) + BW - 20}V${R2 - 2}`)
    const total = r.cost.outputTokens || 1, trows = []
    for (const [y, stages] of rows) stages.forEach(([st, role], i) => {
      const x = X(i), v = r.cost.byStage[st], g = h('svg:g', {}, s)
      if (i) arrow(`M${x - GX + 2},${y + BH / 2}H${x - 2}`)
      h('svg:rect', { x, y, width: BW, height: BH, rx: 12, fill: 'var(--surface)', stroke: 'var(--axis)', 'stroke-width': 0.75 }, g)
      h('svg:rect', { x, y, width: BW, height: BH, rx: 12, class: 'hit' }, g)
      t(g, x + 14, y + 22, LABEL[st], 'ink b'); t(g, x + 14, y + 39, role, 'muted')
      const avg = v.agents ? Math.round(v.tokens / v.agents) : 0
      if (v.agents) {
        t(g, x + 14, y + 66, `${fmt(v.tokens)} tokens`, 'ink b').style.fontSize = '16px'
        t(g, x + 14, y + 84, `${v.agents} agent${v.agents > 1 ? 's' : ''} · avg ${fmt(avg)}`)
      } else t(g, x + 14, y + 66, 'not run', 'muted')
      const mw = BW - 28
      h('svg:rect', { x: x + 14, y: y + 94, width: mw, height: 6, rx: 3, fill: 'var(--track)' }, g)
      if (v.tokens) h('svg:rect', { x: x + 14, y: y + 94, width: Math.max(6, mw * v.tokens / total), height: 6, rx: 3, fill: 'var(--fill)' }, g)
      const share = `${Math.round(100 * v.tokens / total)}%`
      hover(g, [[LABEL[st]], [fmt(v.tokens), 'tokens'], [String(v.agents), 'agents'], [v.agents ? fmt(avg) : '–', 'avg per agent'], [share, 'of the run']])
      trows.push([LABEL[st], fmt(v.tokens), String(v.agents), v.agents ? fmt(avg) : '–', share])
    })
    table(sec, ['Stage', 'Tokens', 'Agents', 'Avg per agent', 'Share'], trows)
  }

  $('f-scenario').onchange = () => { setPair($('f-scenario').value); render() }
  $('f-base').onchange = $('f-compare').onchange = () => { $('compare').querySelector('.chart').replaceChildren(); compare($('f-scenario').value) }
  setPair($('f-scenario').value, q.get('base'), q.get('compare'))
  summary()
  render()
  if (q.has('measure')) { const b = document.body.getBoundingClientRect(); document.body.dataset.size = `${Math.ceil(b.width)},${Math.ceil(b.height)}` }
}

export function buildHtml(entries) {
  const data = { runs: entries.map(e => e.run), defects: DEFECTS, stages: STAGES, scenarios: held(entries.map(e => e.run)) }
  const flow = ['S18-S21', ...data.scenarios.filter(s => s > 'S21')].join(', ') // the sections name what has a run
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  const section = (id, title, sub) => `<section id="${id}"><h2>${title}</h2><p class="sub">${sub}</p><div class="chart"></div><details><summary>Table view</summary><div class="tv"></div></details></section>`
  const pick = (id, label) => `<label>${label}<select id="${id}"></select></label>`
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>hydra eval report</title><style>${CSS}</style></head>
<body><main>
<header class="top"><h1>hydra eval report</h1><span class="sub">${entries.length} runs, generated by evals/report.mjs</span><button id="theme" type="button">Toggle theme</button></header>
${section('summary', 'Where hydra stands', 'Over every run, never filtered. Each tile is the suite as of the newest version (the newest scored run per scenario so far), its change against the version before it, and a sparkline across versions. A change over a different scenario count is shown as a neutral reference, not as a change.')}
<div class="filters" role="group" aria-label="Filters"><label>Scenario<select id="f-scenario"><option value="">All scenarios</option></select></label>${pick('f-base', 'Base')}${pick('f-compare', 'Compare')}</div>
${section('progress', 'Progress per eval run', `Every run, oldest to newest (date, then version). Run score 0–100: a seeded run scores its recall × 100 over kept seeds; a control or a pass/fail scenario (S16, ${flow}) scores 100 on a pass and 0 on a fail; a void run has no score (hollow, below the axis). The line is the combined score at the end of each version: the mean score of the newest scored run per scenario (newest by version) among the runs so far. Colour is the scenario family, shape the kind: circle seeded, diamond control, square a pass/fail scenario (S16, ${flow}, which share S16’s colour).`)}
${section('scorecard', 'Version scorecard', `Each cell is the scenario’s result at that version: caught/kept seeds, major false positives (FP) on a control, pass or fail on a pass/fail scenario (S16, ${flow}). Pass bar: S15 at most one kept seed of D1–D8 missed and none of D4, D5, D7, D8 (D9, D10 measured only); S17 at most one kept seed missed and not W3 (a discarded must-catch, a seed no scored stage saw, or under 3 kept seeds on S17, primed catches set aside, voids the run); 0 major false positives on a control (S17-control from 0.3.7: and an on-brief merged head); S16 blocked, honest and unmerged; ${flow} every criterion holds. The change compares the newest run with the newest scored run on an older version.`)}
${section('trends', 'Trends per scenario', 'One panel per scenario, one column per run, oldest version left. Each row has its own scale from 0; the right edge shows the newest value and its change against the run before. Hover or focus a column for every field of the run.')}
${section('compare', 'Run vs run', 'The same scenario on two versions. Default: its newest version against its newest scored older version (the scorecard’s comparison), else the version before it. Cost up reads bad, quality up reads good; a seeded score changes by recall on the seeds both runs hold; a void side shows no quality number, and a cost change against it is tagged and not coloured.')}
${section('heatmap', 'Recall per planted defect', 'S15-seeded runs, oldest to newest. Each cell names the stage that caught the defect; hover for the finding.')}
${section('cost', 'Cost per stage', 'Output tokens per stage (ag = agents), one scale per scenario so its versions compare stage by stage; stages that did not run show –. Normalized cost is defined in evals/README.md.')}
${section('pipeline', 'hydra pipeline', '')}
</main><div id="tip" role="tooltip"></div>
<script>
${SHARED.join('\n')}
(${client})(${json})
</script></body></html>
`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const entries = loadRuns()
  fs.writeFileSync(path.join(ROOT, 'evals/report.html'), buildHtml(entries))
  if (process.argv.includes('--readme')) {
    const readme = path.join(ROOT, 'README.md')
    fs.writeFileSync(readme, withBlock(fs.readFileSync(readme, 'utf8'), readmeBlock(entries)))
    fs.writeFileSync(path.join(ROOT, 'evals/report.sha256'), shaFile(snapshotFiles(entries)).text)
  }
}
