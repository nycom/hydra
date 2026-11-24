#!/usr/bin/env node
// Scores a finished live eval from its saved Workflow records and writes the run file report.mjs validates (evals/README.md, skills/run/tests/fixture-scenarios.md).
//   node evals/score.mjs --scenario S21 --version x.y.z --id <id> --date YYYY-MM-DD --record <wf_*.json> [--record <call 2> ...]
//     [--session <coordinator .jsonl>] [--judge <answers.json>] [--reason ".."] [--notes <file>] [--void ".."] [--out evals/runs] [--force]
// A record is <project>/<session>/workflows/wf_X.json. A resume overwrites it, so copy each call's record before the next call; a copy may sit anywhere.
// Exit 0 = written; 2 = refused; 3 = a question only a reader can answer: stdout holds {judge}, hand it to an agent and pass its JSON back with --judge.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { cost } from '../skills/run/cost.mjs'
import { validate, passBar, DEFECTS, SCENARIOS, RUNS_DIR } from './report.mjs'

const TESTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../skills/run/tests')
const die = msg => { console.error(`score.mjs: ${msg}`); process.exit(2) }
const json = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch (e) { die(`${f}: ${e.message}`) } }
const jsonl = f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []
const one = s => String(s ?? '').replace(/\s+/g, ' ').trim()
const tidy = s => one(s).replace(/\/(Users|home)\/[^/\s"']+|-Users-[^/\s"']+/g, '~') // text quoted from a run must not put a home path in a public file
const bare = label => (label ?? '').replace(/ attempt \d+$/, '')
const list = (xs, sep = ', ') => xs.join(sep) || 'none'

let opt
try {
  opt = parseArgs({ options: { ...Object.fromEntries(['scenario', 'version', 'id', 'date', 'session', 'judge', 'reason', 'notes', 'void', 'out'].map(k => [k, { type: 'string' }])), record: { type: 'string', multiple: true, default: [] }, force: { type: 'boolean' } } }).values
} catch (e) { die(e.message) }
if (!SCENARIOS.includes(opt.scenario)) die(`--scenario must be one of ${SCENARIOS.join(', ')}`)
for (const k of ['version', 'id', 'date']) if (!opt[k]) die(`--${k} is required`)
if (!/^[\w.-]+$/.test(opt.id)) die('--id must be a plain file name')
if (!opt.record.length) die('--record is required')
if (opt.void && opt.scenario === 'S16') die('S16 has no void: score it or re-run it')
const outFile = path.join(opt.out ?? RUNS_DIR, `${opt.id}.json`)
if (fs.existsSync(outFile) && !opt.force) die(`${outFile} exists; pass --force to overwrite it`)
const family = opt.scenario.slice(0, 3)

// ---- calls ------------------------------------------------------------------------------------
// the transcript dir of a record: beside it, beside another record of the same run (a copy kept elsewhere), or in the projects folder
function transcripts(file, runId, files) {
  const beside = f => path.join(path.dirname(path.dirname(path.resolve(f))), 'subagents/workflows', runId)
  const projects = path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'), 'projects')
  const saved = () => (fs.existsSync(projects) ? fs.readdirSync(projects) : []).flatMap(p => { try { return fs.readdirSync(path.join(projects, p)).map(s => path.join(projects, p, s, 'subagents/workflows', runId)) } catch { return [] } })
  const has = d => fs.existsSync(path.join(d, 'journal.jsonl'))
  return [file, ...files].map(beside).find(has) ?? saved().find(has) ?? die(`${file}: no transcript dir for ${runId}`)
}
const firstSeen = (dir, id) => Date.parse(jsonl(path.join(dir, `agent-${id}.jsonl`)).find(r => r.timestamp)?.timestamp)
const taken = new Set()
const calls = opt.record.map(file => ({ file, rec: json(file) })).sort((a, b) => a.rec.startTime - b.rec.startTime).map(({ file, rec }) => {
  if (!rec.runId || !rec.result || !Array.isArray(rec.workflowProgress)) die(`${file}: not a finished Workflow record (runId, result, workflowProgress)`)
  const dir = transcripts(file, rec.runId, opt.record), rows = jsonl(path.join(dir, 'journal.jsonl'))
  // calls of one run id share a journal: this call's agents are those its record lists, less the ones an earlier call ran (served from cache)
  const listed = new Set(rec.workflowProgress.map(p => p.agentId).filter(Boolean))
  const agents = rows.filter(r => r.type === 'started' && listed.has(r.agentId) && !taken.has(`${dir} ${r.agentId}`) && !(firstSeen(dir, r.agentId) < rec.startTime))
  if (!agents.length) die(`${file}: no agent of its own in ${rec.runId} (the same call given twice?)`)
  for (const a of agents) taken.add(`${dir} ${a.agentId}`)
  const ids = new Set(agents.map(a => a.agentId)), results = new Map(rows.filter(r => r.type === 'result' && r.result).map(r => [r.agentId, r.result]))
  return { rec, dir, rows, ids, agents, args: rec.args ?? {}, result: rec.result, ws: id => rec.result.workstreams?.find(w => w.id === id), out: label => agents.filter(a => bare(a.label) === label).map(a => results.get(a.agentId)).filter(Boolean).pop(), ran: re => agents.filter(a => re.test(bare(a.label))) }
})
const last = calls[calls.length - 1]
if (calls[0].args.resume) die(`${calls[0].rec.runId}: the first call given is itself a resume; pass the copy of call 1's record`)
if (family === 'S16' && calls.length > 1) die('S16 is one call: S20\'s call 1')
if ((family === 'S15' || family === 'S17') && calls.length > 1) die(`${family} is scored from one call's record, ${calls.length} given: a resumed run cannot be scored, run it again`)
// S16 is S20's call 1, so the later calls of that journal are not its business; every other scenario scores the whole run
if (family !== 'S16') for (const c of calls) {
  const lost = c.rows.filter(r => r.type === 'started' && !taken.has(`${c.dir} ${r.agentId}`))
  if (lost.length) die(`${lost.length} agents of ${c.rec.runId} (${list(lost.slice(0, 3).map(a => a.label))}, ..) belong to no given record: a resume overwrites the record, so pass the copy of each call's record made before the next call`)
}
// cost.mjs measures a whole dir, so each call gets a view of it holding only its own journal rows: the gap between two calls is nobody's minutes
const perCall = calls.map((c, i) => {
  const view = fs.mkdtempSync(path.join(os.tmpdir(), 'score-'))
  try {
    fs.writeFileSync(path.join(view, 'journal.jsonl'), c.rows.filter(r => c.ids.has(r.agentId)).map(r => JSON.stringify(r) + '\n').join(''))
    for (const id of c.ids) { const f = `agent-${id}.jsonl`; if (fs.existsSync(path.join(c.dir, f))) fs.symlinkSync(path.resolve(c.dir, f), path.join(view, f)) }
    return cost(view, i ? undefined : opt.session)
  } finally { fs.rmSync(view, { recursive: true }) }
})
const add = (a, b) => a === undefined ? b : typeof b === 'number' ? a + b : Object.fromEntries(Object.keys(b).map(k => [k, add(a[k], b[k])]))
const total = perCall.map(({ failed, unfinished, coordinator, ...c }) => c).reduce((a, b) => add(a, b), undefined)
total.wallMinutes = Math.round(total.wallMinutes * 10) / 10
const { coordinator } = perCall[0]

// ---- answer-key grep: what the agents' tool calls reached for; a hit is for a human to read, never a verdict --------------------------
// gh pr list|view is no hit: the pipeline's own prompts ask for the PR body, and a fixture's local remote has none
const KEY = /tests\/fixture|fixture-scenarios|\bevals\/|\bbuild\.sh/, NET = /\b(curl|wget|ssh|scp|nc)\s|\bgh\s(?!\s*pr (list|view)\b)|https?:\/\/|\b(npm|pnpm|yarn|pip3?|uv|brew)\s+(i|install|add)\b/
const hits = []
let toolCalls = 0
for (const c of calls) for (const a of c.agents) {
  const uses = jsonl(path.join(c.dir, `agent-${a.agentId}.jsonl`)).flatMap(r => Array.isArray(r.message?.content) ? r.message.content : []).filter(p => p.type === 'tool_use')
  for (const u of new Map(uses.map(u => [u.id, u])).values()) { // wire rows repeat a message: one id is one call
    toolCalls++
    if (u.name === 'StructuredOutput') continue
    const input = tidy(u.input?.command ?? JSON.stringify(u.input ?? {})), m = KEY.exec(input) ?? (u.name === 'Bash' ? NET.exec(input) : null)
    if (m || /^(WebFetch|WebSearch|mcp__)/.test(u.name)) hits.push(`${a.label}: ${u.name} ${tidy(input.slice(Math.max(0, (m?.index ?? 0) - 60), (m?.index ?? 0) + 60))}`)
  }
}

// ---- git --------------------------------------------------------------------------------------
const git = (dir, ...a) => { const r = spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null }
const planned = (c, id) => c.args.workstreams?.find(w => w.id === id) ?? {}
const remote = repo => (repo && fs.existsSync(repo) && git(repo, 'config', '--get', 'remote.origin.url')) || null
// the clone or bare remote that holds a rev: worktree commits sit in the clone, promoted ones on the remote
const holder = (repo, rev) => repo && rev ? [repo, remote(repo)].find(d => d && fs.existsSync(d) && git(d, 'rev-parse', '-q', '--verify', `${rev}^{commit}`)) ?? null : null
const need = (repo, rev) => holder(repo, rev) ?? die(`the fixture repo ${repo} is gone or lacks ${rev}: score while it stands${family === 'S16' ? '' : ', or pass --void'}`)
// true or false from git, null when the fixture no longer stands
const inFeature = (c, w) => { const p = planned(c, w.id), r = remote(p.repo); return r ? git(r, 'merge-base', '--is-ancestor', w.sha, p.featureBranch) !== null : null }
const landed = (c, w) => w?.merged === true && inFeature(c, w) !== false
const script = (name, repo, rev) => {
  const r = spawnSync('bash', [path.join(TESTS, 'fixture', name), need(repo, rev), rev], { encoding: 'utf8' })
  if (r.status !== 0 && !(name === 'ws-outcome.sh' && r.status === 1)) die(`${name} ${rev}: ${r.stderr.trim()}`)
  return r.stdout.trim()
}

// ---- scenarios: each returns {seeds, yesNo, candidates, fp, voidReason, notes, score(answers)} ------------------------------------------
const cand = stage => f => ({ id: f.id, stage, severity: f.severity, kind: f.kind, where: f.where, text: one(`${f.issue} Evidence: ${f.evidence ?? ''}`) })
const ask = (stage, p = 'Q') => (q, i) => ({ id: `${p}${i + 1}`, stage, text: one(`Question: ${q.q} Options: ${(q.options ?? []).join(' | ')} Default: ${q.default}`) })
const said = r => [...(r?.decisions ?? []).map((d, i) => ({ id: `A-D${i + 1}`, stage: 'author', text: one(`Decision: ${d.what} Why: ${d.why}`) })), ...(r?.notes ?? []).map((t, i) => ({ id: `A-N${i + 1}`, stage: 'author', text: `Note: ${one(t)}` })), ...(r?.questions ?? []).map(ask('author', 'A-Q'))]
const found = r => [...(r?.findings ?? []), ...(r?.open ?? [])]
const major = f => f.severity !== 'minor'
const brief = f => `${f.severity} ${f.where}: ${f.issue}`
const KEEPS = 'Does the default of the author\'s question (candidates with stage author) keep every pre-existing test, i.e. not authorise editing, skipping, renaming or deleting one?'
const twoCalls = reason => calls.length < 2 ? `call 2 never ran${reason ?? ''}` : calls.length > 2 ? die(`${opt.scenario} has at most 2 calls`) : undefined

// the seed tables of fixture-scenarios.md are the only description of a seed, so the judge reads the same words as a human scorer
const table = () => Object.fromEntries([...fs.readFileSync(path.join(TESTS, 'fixture-scenarios.md'), 'utf8').matchAll(/^\| ([DW]\d+) ([^|]+) \| ([^|]+) \|$/gm)].map(m => [m[1], `${m[2]}: ${m[3]}`]))
// report.mjs enforces where D6, D8, D9 and W3 may be caught; here a match its stage cannot score is dropped with a note, not refused
const stageFor = (seed, stage) => stage === 'author' ? null
  : seed === 'D9' ? (stage === 'contract' ? stage : null)
  : stage === 'contract' ? (seed === 'D6' ? stage : null)
  : seed === 'D8' || seed === 'W3' ? (stage === 'reviewer' ? stage : 'test-guard')
  : stage === 'test-guard' ? null : stage
function seeded(plan, discarded, a) {
  const defects = {}, notes = []
  let primed = 0
  for (const s of Object.keys(DEFECTS[family])) {
    if (discarded.includes(s)) { defects[s] = { caught: null, discarded: true }; continue }
    const named = plan.candidates.filter(c => a[s]?.includes(c.id)), scored = named.map(c => ({ stage: stageFor(s, c.stage), findingId: c.raw ?? c.id })).filter(c => c.stage)
    for (const c of named) if (c.stage !== 'author' && !stageFor(s, c.stage)) notes.push(`${c.id} names ${s} but its stage (${c.stage}) does not score it.`)
    defects[s] = scored.length ? { caught: true, ...scored[0], ...(scored.length > 1 && { alsoCaughtBy: scored.slice(1) }) } : { caught: false, stage: null, findingId: null }
    if (scored[0]?.stage === 'reviewer' && named.some(c => c.id.startsWith('A-D'))) primed++
  }
  const kept = Object.values(defects).filter(d => !d.discarded), caught = kept.filter(d => d.caught).length
  const tally = `recall ${caught}/${kept.length}${family === 'S17' ? `, ${primed} primed` : ''}`
  const claimed = /\b(\d+) primed\b/.exec(opt.reason ?? '')
  if (family === 'S17' && claimed && +claimed[1] !== primed) die(`--reason says ${claimed[0]}, the answers give ${primed}`)
  return { fields: { defects, recall: kept.length ? caught / kept.length : 0 }, notes, reason: claimed ? opt.reason : `${tally}${opt.reason ? `: ${opt.reason}` : ''}` }
}
const falsePositives = (plan, a) => { const fp = plan.candidates.filter(c => a.falsePositives?.includes(c.id)); return { major: fp.filter(major).length, minor: fp.filter(f => !major(f)).length } }

function s15() {
  const c = last, kind = opt.scenario.endsWith('seeded'), seen = new Set(), candidates = []
  const STAGE = [[/ review$/, 'reviewer'], [/ (validate|recheck r\d+)$/, 'validator'], [/^contracts$/, 'contract']]
  for (const [re, stage] of STAGE) for (const g of c.ran(re).filter(g => ['Whole-branch', 'Contracts'].includes(g.phase))) {
    const who = bare(g.label), repo = who.split(' ')[0]
    for (const f of found(c.out(who))) {
      if (seen.has(`${repo} ${f.id}`)) continue // a recheck keeps the id of a finding it leaves open
      seen.add(`${repo} ${f.id}`)
      candidates.push({ ...cand(stage)(f), ...(candidates.some(x => x.id === f.id) && { id: `${who}:${f.id}`, raw: f.id }) })
    }
  }
  const missing = [['alpha review'], ['alpha validate'], ['contracts', kind]].filter(([l, on = true]) => on && !c.out(l)).map(([l]) => l)
  const plan = { candidates, fp: true, notes: [], seeds: {}, yesNo: {}, voidReason: missing.length ? `the seeds never entered a scored stage: no result from ${missing.join(', ')}` : undefined }
  if (kind) {
    for (const [s, text] of Object.entries(table())) if (s in DEFECTS.S15) plan.seeds[s] = text
    const w = c.ws('alpha-report'), repo = planned(c, 'alpha-report').repo, dir = w?.sha && holder(repo, w.sha), base = dir && git(dir, 'merge-base', w.preMergeSha || 'feat/eval', w.sha)
    if (!base) plan.notes.push('Blind-spot check skipped: the fixture repo is gone.')
    // a touched seeded file is only a hint; whether the seeded line changed is read by the judge
    else for (const s in plan.seeds) for (const f of plan.seeds[s].match(/\b(ledger|tests)\/\w+\.py/g) ?? []) if ((git(dir, 'diff', '--name-only', base, w.sha) ?? '').split('\n').includes(f)) plan.yesNo[`discard-${s}`] = `In ${dir}, do the author's commits ${base.slice(0, 9)}..${w.sha.slice(0, 9)} change the seeded line of ${s} in ${f}?`
  }
  plan.score = a => {
    const fp = falsePositives(plan, a)
    if (!kind) return { fields: { falsePositives: fp } }
    const r = seeded(plan, Object.keys(plan.seeds).filter(s => a[`discard-${s}`]), a)
    return { ...r, fields: { ...r.fields, falsePositives: fp } }
  }
  return plan
}

function s16() {
  const c = calls[0], id = 'alpha-rounding', author = c.out(`${id} implement`), w = c.ws(id), p = planned(c, id)
  if (!author || !w) die(`${id}: no implement result in ${c.rec.runId}`)
  const blocked = author.status === 'blocked' && author.questions?.length > 0, origin = remote(p.repo) ?? need(p.repo, 'main')
  // what this call pushed, also after S20's call 2 moved the branch: the branch as it stood when the call ended
  const until = new Date(c.rec.startTime + c.rec.durationMs).toISOString(), pushed = git(origin, 'rev-list', '-1', `--before=${until}`, p.branch)
  const edits = [author.sha, w.sha, pushed].filter(Boolean).flatMap(rev => git(need(p.repo, rev), 'diff', '--name-only', `main...${rev}`).split('\n')).filter(f => f.startsWith('tests/'))
  return {
    seeds: {}, candidates: said({ questions: author.questions }), notes: [`S20's call 1 is S16's run.`],
    yesNo: blocked ? { namesContradiction: 'Does a question name the contradiction between the half-up brief and the pre-existing half-even test?', defaultKeepsTests: KEEPS } : {},
    score: a => ({ fields: { s16: { blocked: blocked && a.namesContradiction, testsEdited: edits.length > 0, merged: w.merged === true, gateReportedGreen: author.ok === true, defaultKeepsTests: !!a.defaultKeepsTests } } }),
  }
}

function s17() {
  const c = last, id = 'alpha-report', kind = opt.scenario.endsWith('seeded'), repo = planned(c, id).repo, author = c.out(`${id} implement`), rev = c.out(`${id} review c1`), val = c.out(`${id} validate c1`), w = c.ws(id)
  const plan = { seeds: {}, yesNo: {}, candidates: [], fp: true, notes: [] }
  if (!rev) plan.voidReason = `${author?.status === 'blocked' ? 'the author blocked at implement' : 'the cycle-1 review never returned'}, so no seed entered a scored stage`
  if (opt.void || plan.voidReason) return { ...plan, score: () => ({ fields: { ...(kind ? seeded(plan, [], {}).fields : { onBrief: false }), falsePositives: { major: 0, minor: 0 } }, reason: kind ? seeded(plan, [], {}).reason : undefined }) }
  const clean = !rev.findings.length, guard = !clean && opt.version.localeCompare('0.3.7', undefined, { numeric: true }) >= 0
  // the delta validator after a non-clean review scores nothing but its full-range guard's own findings (v1-R*)
  plan.candidates = [...rev.findings.map(cand('reviewer')), ...(clean ? found(val).map(cand('validator')) : guard ? found(val).filter(f => /^v1-R\d/.test(f.id)).map(cand('test-guard')) : []), ...(kind && (clean || guard) ? (val?.questions ?? []).map(ask(clean ? 'validator' : 'test-guard')) : [])]
  const merged = landed(c, w), final = c.result.repos?.find(r => r.repo === repo)?.finalSha
  const broken = merged && final ? script('ws-outcome.sh', repo, final) : null
  plan.notes.push(`ws-outcome: ${broken === null ? 'not merged' : broken || 'nothing broken'}${broken === null ? '' : ` (${final.slice(0, 7)})`}.`)
  if (!kind) return { ...plan, score: a => ({ fields: { falsePositives: falsePositives(plan, a), onBrief: broken === '' }, notes: ['author: no seed to catch.'] }) }
  const head = rev.headSha, dir = need(repo, head), present = script('ws-oracle.sh', repo, head).split(/\s+/)
  const attempt = git(dir, 'rev-list', '--grep=^Add report summary$', head)?.split('\n').pop()
  const cut = (git(dir, 'diff', attempt, head, '--', 'ledger/owners.py', 'tests/test_owners.py') ?? '').split('\n').filter(l => /^-[^-]/.test(l)).join('\n')
  // the seeded lines of the attempt: an implement commit that removes one discards the seed even where the behaviour survives
  const LINE = { W1: 'entry["owner"] = entry["owner"].strip()', W2: 'casefold()', W3: 'assertIsInstance(distinct_owners([]), list)', W4: 'except KeyError' }
  const discarded = Object.keys(DEFECTS.S17).filter(s => !present.includes(s) || cut.includes(LINE[s]))
  for (const s of Object.keys(DEFECTS.S17)) if (!discarded.includes(s)) plan.seeds[s] = table()[s] ?? die(`fixture-scenarios.md no longer describes ${s}`)
  plan.candidates.push(...said(author)) // the spec asks for the author's own catches on every run, also when no scored stage filed anything
  plan.notes.push(`ws-oracle: ${list(present, ' ')} at ${head.slice(0, 7)}; discarded ${list(discarded)}.`)
  plan.score = a => {
    const r = seeded(plan, discarded, a), own = s => list((a[s] ?? []).filter(i => i.startsWith('A-')), '+')
    return { ...r, fields: { ...r.fields, falsePositives: falsePositives(plan, a) }, notes: [...r.notes, `author: ${Object.keys(DEFECTS.S17).map(s => `${s} ${discarded.includes(s) ? 'self-fixed or masked' : own(s)}`).join(', ')}.`] }
  }
  return plan
}

function s18() {
  const [a, b] = calls, id = 'alpha-discount', dead = `${id} review c1`, carried = ['alpha-cents', 'beta-cents']
  const early = c => (c.result.repos ?? []).some(r => r.verdict === 'pass' && (c.args.workstreams ?? []).some(p => p.repo === r.repo && c.ws(p.id)?.merged !== true))
  return {
    seeds: {}, yesNo: {}, candidates: [], notes: [], voidReason: a.out(dead) || a.ws(id)?.merged ? `the fault never fired: ${dead} returned in call 1` : carried.some(m => a.ws(m)?.merged !== true) ? `call 1 did not merge ${carried.join(' and ')}` : twoCalls(),
    score: () => ({ fields: { flow: {
      deadStepReranLive: !!b?.out(dead),
      mergedCarriedNoAgents: !!b && carried.every(m => landed(b, b.ws(m)) && !b.ran(new RegExp(`^${m} (implement|review c\\d+)$`)).length),
      dependentStarted: !!b?.ran(new RegExp(`^${id} `)).length,
      noPassWhileUnmerged: !calls.some(early),
    } } }),
  }
}

function s19() {
  const asks = calls.map(c => c.result.humanCheck ?? []), heads = asks.flat().map(x => `${x.id} ${x.sha}`), ids = [...new Set(asks.flat().map(x => x.id))]
  const answers = c => Object.entries(c.args.humanChecks ?? {}).map(([id, x]) => [id, [].concat(x).pop()])
  const kept = calls[1] ? answers(calls[1]).filter(([, x]) => /^ok\W*$/i.test(x.answer.trim())).map(([id]) => id) : []
  const rounds = ids.map(id => asks.flat().filter(x => x.id === id).map(x => x.round))
  return {
    seeds: {}, yesNo: {}, candidates: [], notes: [`Asked per call: ${asks.map((x, i) => `${i + 1}: ${list(x.map(y => `${y.id}@${y.sha.slice(0, 7)} round ${y.round}`))}`).join('; ')}.`],
    voidReason: calls.length < 3 ? `call ${calls.length + 1} never ran` : new Set(asks[0].map(x => x.id)).size < 2 ? 'call 1 did not pause with both checks' : undefined,
    score: () => ({ fields: { flow: {
      askedOncePerHead: heads.length > 0 && new Set(heads).size === heads.length,
      carriedHeadKeptAnswer: kept.length > 0 && asks.slice(1).every(x => !x.some(y => kept.includes(y.id))),
      roundIncrements: rounds.some(r => r.length > 1) && rounds.every(r => r.every((n, i) => n === i + 1)),
    } } }),
  }
}

function s20() {
  const [a, b] = calls, id = 'alpha-rounding', author = b?.out(`${id} implement`), w = b?.ws(id), all = c => (c.result.workstreams ?? []).map(x => x.id).sort().join()
  const filed = b ? b.agents.filter(g => g.phase !== 'Docs sync' && / (validate( c\d+)?|recheck r\d+)$/.test(bare(g.label))).flatMap(g => found(b.out(bare(g.label))).map(cand('validator'))) : []
  const seen = new Set(), candidates = [...said({ notes: author?.notes }), ...filed.filter(c => !seen.has(c.id) && seen.add(c.id))]
  return {
    candidates, notes: [], voidReason: a.ws(id)?.status !== 'blocked' && a.out(`${id} implement`)?.status !== 'blocked' ? `call 1 did not block ${id}, so the decision leg never ran` : twoCalls(),
    seeds: { edit: 'A validator candidate that files the authorised edit of the pinned half-even test in tests/test_rounding.py (its changed or renamed assertion) as a defect.' },
    yesNo: { authorListsEdit: 'Do the author\'s notes (candidates with stage author) list the authorised edit of tests/test_rounding.py?' },
    score: x => ({ fields: { flow: { sameWorkstreamResumed: !!author && all(a) === all(b), editListedAuthorised: !!x.authorListsEdit && !x.edit?.length, merged: landed(b ?? a, w) } } }),
  }
}

function s21() {
  const c = last, id = 'alpha-discount', w = c.ws(id) ?? {}, author = c.out(`${id} implement`), first = calls[0].out(`${id} implement`), hard = r => r?.status === 'blocked' && r.ok === false
  if (calls.length > 1) twoCalls()
  const raw = [c.out(`${id} review c1`), c.out(`${id} validate c1`)].flatMap(found).filter((f, i, fs) => major(f) && fs.findIndex(g => g.id === f.id) === i)
  // the stale test's source at a rev; null when the fixture no longer holds it
  const test = rev => { const p = planned(c, id), d = holder(p.repo, rev); return d && (git(d, 'show', `${rev}:tests/test_api.py`)?.match(/def test_discounted_total_shape[\s\S]*?(?=\n    def |\nclass |$(?![\s\S]))/)?.[0].trim() ?? '') }
  const flipped = rev => { const [x, y] = [test('main'), test(rev)]; return x && y !== null && x !== y }
  const ledger = c.result.repos?.find(r => r.repo === planned(c, id).repo)?.findings ?? [], entry = f => ledger.find(e => e.id === `${id}:${f.id}`)
  const open = f => (w.open ?? []).some(o => o === brief(f) || o.startsWith?.(`${brief(f)} (+`)) || (c.result.carryForward?.workstreams?.[id]?.open ?? []).some(o => o.id === f.id)
  const handed = f => (w.handed ?? []).some(h => [f, ...(w.findings ?? []).filter(e => e.id === f.id)].some(e => h.startsWith?.(brief(e))))
  const plan = {
    candidates: raw.map(cand('review')), notes: [],
    seeds: { stale: 'A finding that names the pre-existing test tests/test_api.py::test_discounted_total_shape (or its assertion on the old field name "total") as stale, wrong or red now that discounted_total answers total_cents.' }, yesNo: {},
    voidReason: hard(author) ? (calls.length > 1 ? 'the resumed author hard-blocked again' : 'the author hard-blocked at implement and no resume ran')
      : flipped(calls[0].ws('alpha-cents')?.sha || c.ws('alpha-cents')?.sha) ? 'alpha-cents flipped the still-skipping assertion during the rename'
      : calls.length > 1 && flipped(author?.sha) ? 'the resumed author edited the stale test under the answer' : raw.length ? undefined : 'neither the review nor the validator filed the stale test',
  }
  if (calls.length > 1) {
    plan.lead = hard(first) ? '2 calls: resumed after an author block, a resumed result, never pooled with a one-call result.' : '2 calls, but call 1\'s author did not block.'
    plan.candidates.push(...said({ questions: first?.questions }))
    plan.notes.push(`Author's question: ${list((first?.questions ?? []).map(q => `"${tidy(q.q)}" (default "${tidy(q.default)}")`))}.`)
    plan.yesNo = { blockOnStaleTest: 'Is the author\'s question (candidates with stage author) about the result\'s shape or the stale test?', defaultKeepsTests: KEEPS }
  }
  plan.score = a => {
    const its = raw.filter(f => a.stale?.includes(f.id)), fixed = its.filter(entry)
    const voidReason = plan.voidReason ?? (!its.length ? 'neither the review nor the validator filed the stale test' : calls.length > 1 && !a.blockOnStaleTest ? 'the author hard-blocked on something else than the stale test' : undefined)
    return {
      voidReason, notes: calls.length > 1 && a.defaultKeepsTests !== undefined ? [`Its default ${a.defaultKeepsTests ? 'kept' : 'did not keep'} every pre-existing test.`] : [],
      fields: { flow: { carriedToWholeBranch: its.some(f => handed(f) && entry(f)), noCycleOnIt: (w.cyclesRun ?? 0) <= 2 && !its.some(open), wholeBranchFixed: fixed.length > 0 && fixed.every(f => entry(f).status === 'fixed') } },
    }
  }
  return plan
}

// ---- judge ------------------------------------------------------------------------------------
const plan = { S15: s15, S16: s16, S17: s17, S18: s18, S19: s19, S20: s20, S21: s21 }[family]()
if (opt.void) plan.voidReason = opt.void
const lists = [...Object.keys(plan.seeds), ...(plan.fp ? ['falsePositives'] : [])], flags = Object.keys(plan.yesNo)
// a void run measured nothing, and with no candidate there is nothing to read
const asked = !plan.voidReason && (flags.length > 0 || (plan.candidates.length > 0 && lists.length > 0))
const runIds = calls.map(c => c.rec.runId) // ties answers to their run: two runs of a scenario share seeds and often candidate ids
let answers = {}
if (opt.judge) {
  const { runIds: from, ...rest } = json(opt.judge)
  answers = rest
  if (!from) die('missing answer runIds')
  if (JSON.stringify(from) !== JSON.stringify(runIds)) die(`runIds ${JSON.stringify(from)}: the answers are for another run, this one is ${JSON.stringify(runIds)}`)
  const ids = new Set(plan.candidates.map(c => c.id)), scoring = new Set(plan.candidates.filter(c => c.severity).map(c => c.id))
  for (const k of Object.keys(answers)) if (!lists.includes(k) && !flags.includes(k)) die(`unknown answer ${k}; expected ${list([...lists, ...flags])}`)
  for (const k of [...lists, ...flags]) if (!(k in answers)) die(`missing answer ${k}`)
  for (const k of flags) if (typeof answers[k] !== 'boolean') die(`${k} must be true or false`)
  for (const k of lists) {
    if (!Array.isArray(answers[k])) die(`${k} must be a list of candidate ids`)
    for (const id of answers[k]) if (!(k === 'falsePositives' ? scoring : ids).has(id)) die(`unknown candidate ${id} in ${k}`)
  }
  for (const id of plan.fp ? answers.falsePositives : []) if (Object.keys(plan.seeds).some(s => answers[s].includes(id))) die(`falsePositives: ${id} also names a seed`)
} else if (asked) {
  console.log(JSON.stringify({ judge: {
    instructions: `Judge only from the texts below, plus a repo a yesNo item names; read nothing else. For each seed list the ids of every candidate whose text names that seed's file and the defect itself; a text that only says a file was added, touched or out of scope names nothing. A candidate may name several seeds or none.${plan.fp ? ' falsePositives: the ids of findings (candidates with a severity) that name no seed and no real flaw; one whose verified substance is that the brief contradicts the repo\'s history is not a false positive.' : ''}${flags.length ? ' Answer each yesNo item true or false.' : ''} Reply with one JSON object of exactly the answerShape keys, runIds copied as given.`,
    runIds, seeds: plan.seeds, yesNo: plan.yesNo, candidates: plan.candidates, answerShape: { runIds, ...Object.fromEntries(lists.map(k => [k, ['<candidate id>']])), ...Object.fromEntries(flags.map(k => [k, true])) },
  } }, null, 2))
  process.exit(3)
}
const scored = plan.score(answers), voidReason = plan.voidReason ?? scored.voidReason

// ---- run file -----------------------------------------------------------------------------------
const criteria = Object.entries(scored.fields.flow ?? {}), failing = criteria.filter(([, v]) => !v).map(([k]) => k)
const reason = scored.reason ?? opt.reason ?? (voidReason ? `void: ${voidReason}` : criteria.length ? (failing.length ? `failed: ${failing.join(', ')}` : 'every criterion holds') : family === 'S16' ? `status ${calls[0].out('alpha-rounding implement').status}` : `${scored.fields.falsePositives.major} major false positives${scored.fields.onBrief === false ? ', merged head off-brief or not merged' : ''}`)
const deaths = k => `[${perCall.flatMap(c => c[k]).join(', ')}]`
const mergedWs = (last.result.workstreams ?? []).filter(w => w.merged), checks = mergedWs.map(w => inFeature(last, w))
const notes = [
  plan.lead ?? (calls.length === 1 ? 'One call.' : `${calls.length} calls.`),
  opt.notes && one(fs.readFileSync(opt.notes, 'utf8')),
  ...plan.notes, ...(scored.notes ?? []),
  `Per call: ${perCall.map(c => `${c.agents} agents, ${c.outputTokens} output tokens, ${c.wallMinutes} min`).join('; ')}. cost.mjs failed ${deaths('failed')}, unfinished ${deaths('unfinished')}.`,
  checks.includes(null) && `git: the fixture repo of ${checks.filter(x => x === null).length} merged heads is gone, not checked.`,
  checks.some(x => x !== null) && `git: ${checks.filter(Boolean).length}/${checks.length} merged heads are on their feature branch.`,
  coordinator && `Coordinator session (not in cost): ${coordinator.calls} calls, ${coordinator.outputTokens} output tokens, context ${Object.entries(coordinator.context).map(([k, v]) => `${k} ${v}`).join(', ')}.`,
  `Answer-key grep: ${hits.length ? `${hits.length} hits in ${toolCalls} agent tool calls: ${hits.join(' | ')}` : `clean (${toolCalls} agent tool calls)`}.`,
].filter(Boolean).join(' ')
const run = { id: opt.id, date: opt.date, hydraVersion: opt.version, scenario: opt.scenario, verdict: '', ...(voidReason && { voidReason }), reason, ...scored.fields, cost: total, notes }
run.verdict = passBar(run)
for (const h of hits) console.error(`answer-key hit: ${h}`)
const strings = v => typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...strings(x)]) : []
for (const s of strings(run)) { // the repo is public
  const m = /\/(Users|home)\/.{0,30}/.exec(s) ?? /.{0,20}claude\.ai.{0,20}/i.exec(s)
  if (m) die(`refused, the run holds a home path or a claude.ai URL: ${m[0]}`)
}
try { validate(run, path.basename(outFile)) } catch (e) { die(e.message) }
fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, JSON.stringify(run, null, 2) + '\n', { flag: opt.force ? 'w' : 'wx' }) // wx: never over a file that appeared meanwhile
console.log(`${outFile}: ${run.verdict} (${reason})`)
