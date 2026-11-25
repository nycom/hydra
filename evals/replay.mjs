#!/usr/bin/env node
// Replays the cycle-1 review of S17-seeded: rebuilds the reviewed head N times, captures the review prompt from workflow.js with a mock agent, runs it
// with `claude -p` as the shipped reviewer, and writes one record per replay for score.mjs. It calls a model and costs money.
//   node evals/replay.mjs <dest> --version X.Y.Z --out <record dir> [--n 5] [--max-usd 2] [--effort <level>] [--skill-dir DIR]
//   node evals/score.mjs --scenario S17-seeded --trial <i> --record <record dir>/workflows/<record>.json --out evals/replays ..
// It measures that reviewer alone: no author, fix, validator, test guard or merge runs. <dest> takes one fixture per replay, on a neutral path (build.sh).
// --skill-dir names another checkout's skills/run, to compare its prompt; $CLAUDE another claude command. Exit 1 = a replay is missing; 2 = refused.
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const die = msg => { console.error(`replay.mjs: ${msg}`); process.exit(2) }
let opt, dest
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { version: { type: 'string' }, out: { type: 'string' }, n: { type: 'string', default: '5' }, 'max-usd': { type: 'string', default: '2' }, effort: { type: 'string' }, 'skill-dir': { type: 'string' } } })
  opt = values; [dest] = positionals
} catch (e) { die(e.message) }
if (!dest || !opt.out || !opt.version) die('usage: node evals/replay.mjs <dest> --version X.Y.Z --out <record dir> [--n 5] [--max-usd 2] [--effort <level>] [--skill-dir DIR]')
if (!/^[1-9]\d*$/.test(opt.n)) die('--n must be an integer from 1')
if (!(+opt['max-usd'] > 0)) die('--max-usd must be a number above 0')
const n = +opt.n, cap = +opt['max-usd']
const skill = path.resolve(opt['skill-dir'] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '../skills/run')), root = path.resolve(skill, '../..')
const { version } = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin/plugin.json'), 'utf8'))
if (version !== opt.version) die(`${root} is ${version}, not ${opt.version}`)
const dirs = { records: path.join(opt.out, 'workflows'), transcripts: path.join(opt.out, 'subagents/workflows') }
if (fs.existsSync(dirs.records)) die(`${dirs.records} exists: one record dir per set of replays`)

const BRANCH = 'feat/eval--alpha-report', WS = 'alpha-report', LABEL = `${WS} review c1`
// what the author leaves unwritten in the fixture; the fixed identity and dates give every replay the same head
const DUP_TEST = `
    def test_duplicate_owners(self):
        result = summary([{"id": 1, "owner": "bob"}, {"id": 2, "owner": "ann"}, {"id": 3, "owner": "bob"}])
        self.assertEqual(result, {"count": 3, "owners": ["ann", "bob"]})
`
const DECISIONS = [{ what: `Continued from the existing origin/${BRANCH}`, why: 'the brief says to finish it' }, { what: 'Added the duplicate-owners test, no change to report.py', why: 'summary already meets the brief and takes the owners from distinct_owners' }]
const GIT_ENV = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Dev', GIT_AUTHOR_EMAIL: 'dev@example.invalid', GIT_COMMITTER_NAME: 'Dev', GIT_COMMITTER_EMAIL: 'dev@example.invalid', GIT_AUTHOR_DATE: '2026-01-02T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-02T00:00:00Z' }
function must(cmd, args, env) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', env: { ...process.env, ...env } })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${r.stderr.trim()}`)
  return r.stdout.trim()
}
function build(i) { // a fresh fixture whose workstream branch carries the author's commit
  const at = path.join(dest, `work-${i}`), args = JSON.parse(must('bash', [path.join(skill, 'tests/fixture/build.sh'), at, '--ws-seed']))
  const { repo } = args.workstreams.find(w => w.id === WS), wt = path.join(fs.realpathSync(at), 'author'), git = (dir, ...a) => must('git', ['-C', dir, ...a], GIT_ENV)
  git(repo, 'fetch', '-q', 'origin')
  git(repo, 'worktree', 'add', '-q', '--detach', wt, `origin/${BRANCH}`)
  fs.appendFileSync(path.join(wt, 'tests/test_report.py'), DUP_TEST)
  git(wt, 'commit', '-qam', 'Test report summary with duplicate owners')
  git(wt, 'push', '-q', 'origin', `HEAD:refs/heads/${BRANCH}`)
  const sha = git(wt, 'rev-parse', 'HEAD')
  git(repo, 'worktree', 'remove', '--force', wt)
  git(repo, 'fetch', '-q', 'origin')
  return { args, repo, sha }
}
process.argv[2] = path.join(skill, 'workflow.js') // run.mjs loads the script named there, as for the checks
const { Run } = await import(pathToFileURL(path.join(skill, 'tests/run.mjs')))
async function capture({ args, sha }) { // the review step's own prompt and options
  let got
  const agent = async (prompt, o) => {
    const label = o.label.replace(/ attempt \d+$/, '')
    if (label === LABEL) { got ??= { prompt, o }; return null }
    if (label.startsWith('health ')) return { ok: true, notes: 'git version 2' }
    if (label === `${WS} implement`) return { status: 'done', ok: true, sha, tests: 't', gateTail: 'gate exit=0', sharedEdits: [], decisions: DECISIONS, questions: [], notes: [] }
    return null
  }
  await Run(structuredClone(args), agent, fs => Promise.all(fs.map(f => f().catch(() => null))), () => {}, { total: null, spent: () => 0, remaining: () => Infinity })
  if (!got?.prompt.includes(sha)) throw new Error(`no ${LABEL} prompt on ${sha}`)
  return got
}

// ---- one replay -------------------------------------------------------------------------------
const body = fs.readFileSync(path.join(root, 'agents/reviewer.md'), 'utf8').replace(/^---\n[^]*?\n---\n/, '').trim(), TOOLS = 'Bash,Read,Glob,Grep'
// the caller may itself be a session: its markers and settings stay out, its login and provider stay in
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE$|CLAUDE_(?!CONFIG_DIR$|CODE_OAUTH_TOKEN$|CODE_USE_)|AI_AGENT$|BAGGAGE$)/.test(k)))
async function replay({ repo }, { prompt, o }, left) {
  const effort = opt.effort ?? o.effort
  const args = ['-p', '--agent', 'reviewer', '--agents', JSON.stringify({ reviewer: { description: 'Read-only reviewer', prompt: body, tools: [...TOOLS.split(','), 'StructuredOutput'] } }), '--model', o.model, ...(effort ? ['--effort', effort] : []),
    '--restricted', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence', '--tools', TOOLS, '--allowedTools', TOOLS, '--json-schema', JSON.stringify(o.schema), '--output-format', 'stream-json', '--verbose', '--max-budget-usd', `${left}`]
  const child = spawn(process.env.CLAUDE ?? 'claude', args, { cwd: repo, env, stdio: ['pipe', 'pipe', 'inherit'] }), rows = []
  const closed = new Promise((ok, no) => { child.on('error', no); child.on('close', ok) })
  closed.catch(() => {}) // a command that cannot start rejects here while stdout is still read; the await below reports it
  child.stdin.on('error', () => {}) // a child that dies before it reads says so by its missing result
  child.stdin.end(prompt)
  let result
  for await (const line of readline.createInterface({ input: child.stdout })) {
    let e
    try { e = JSON.parse(line) } catch { continue }
    if (e.type === 'result') result = e
    // a stream repeats a message with a partial usage; the result holds the whole count, one row of which goes in below
    else if (e.message) rows.push({ type: e.type, timestamp: new Date().toISOString(), message: { ...e.message, usage: undefined } })
  }
  await closed
  if (result) rows.push({ type: 'assistant', timestamp: new Date().toISOString(), message: { id: 'total', usage: result.usage, content: [] } })
  return { result, rows }
}
let spent = 0, recorded = 0
const stamp = Date.now()
for (let i = 1; i <= n; i++) {
  if (spent >= cap) { console.error(`replay.mjs: stopped before replay ${i}: $${spent.toFixed(2)} spent, the cap of $${cap} is reached`); break }
  const start = Date.now()
  try {
    const job = build(i), asked = await capture(job), { result, rows } = await replay(job, asked, Math.max(0.01, Math.round(100 * (cap - spent)) / 100))
    spent += result?.total_cost_usd ?? 0
    const answer = result?.structured_output
    if (!result) { console.error(`replay.mjs: replay ${i} gave no result, so its spend is unknown: stopped`); break }
    if (result.is_error || !answer) throw new Error(`${result.subtype}: ${String(result.result ?? 'no structured output').slice(0, 300)}`)
    if (answer.headSha !== job.sha) throw new Error(`reviewed ${answer.headSha}, the head is ${job.sha}`)
    const runId = `wf_replay-${stamp}-${i}`, agentId = `r${i}`, dir = path.join(dirs.transcripts, runId)
    for (const d of [dir, dirs.records]) fs.mkdirSync(d, { recursive: true })
    const jsonl = (f, xs) => fs.writeFileSync(path.join(dir, f), xs.map(x => `${JSON.stringify(x)}\n`).join(''))
    jsonl('journal.jsonl', [{ type: 'started', agentId, label: LABEL, phase: asked.o.phase }, { type: 'result', agentId, result: answer }])
    jsonl(`agent-${agentId}.jsonl`, rows)
    const rec = { runId, replay: { version, model: asked.o.model, effort: opt.effort ?? asked.o.effort ?? 'default', usd: result.total_cost_usd }, args: job.args, startTime: start, durationMs: Date.now() - start, workflowProgress: [{ type: 'workflow_agent', label: LABEL, agentId }], result: { workstreams: [{ id: WS, sha: job.sha, merged: false }], repos: [] } }
    const file = path.join(dirs.records, `${runId}.json`)
    fs.writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`)
    recorded++
    console.log(`replay ${i}: ${answer.findings.length} findings at ${job.sha.slice(0, 7)}, $${result.total_cost_usd.toFixed(2)}: ${file}`)
  } catch (e) { console.error(`replay.mjs: replay ${i} not recorded: ${e.message}`) }
}
console.log(`${recorded} of ${n} replays recorded, $${spent.toFixed(2)} as claude reports it`)
process.exit(recorded === n ? 0 : 1)
