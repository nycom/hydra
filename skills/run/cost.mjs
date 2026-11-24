#!/usr/bin/env node
// Cost of one Workflow run from its Transcript dir: node cost.mjs <Transcript dir> [<coordinator session .jsonl>]
// Prints {outputTokens, contextTokens, context, agents, wallMinutes, byStage, failed, unfinished}: byStage uses the evals
// run-file stage names; contextTokens sums input + cache creation + cache read tokens over every API call (reported,
// not scored); context splits it into input, cacheWrite and cacheRead, which cost very different amounts;
// coordinator (only with a session file) is that whole session's calls, output and context, never in the run totals; wallMinutes spans the first to the last transcript timestamp; failed = agents with a "failed"
// journal row, unfinished = started with no result or failed row. Reads only journal.jsonl and the usage and
// timestamp fields of agent-<agentId>.jsonl, never message content.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const STAGES = ['implement', 'review', 'fix', 'validate', 'merge', 'wholeBranch', 'contracts', 'docs']
const PHASE = { Implement: 'implement', Merge: 'merge', 'Whole-branch': 'wholeBranch', Contracts: 'contracts', 'Drift audit': 'contracts', 'Docs sync': 'docs' } // the drift audit is a cross-repo read like the contract check
const stageOf = ({ label = '', phase }) => PHASE[phase] || (phase === 'Review cycles' && label.replace(/ attempt \d+$/, '').match(/ (review|fix|validate) c\d+$/)?.[1])
const lines = f => readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))

// a streamed message repeats its id; its last usage line is the final count
const usages = rows => { const m = new Map(); for (const r of rows) if (r.message?.usage) m.set(r.message.id, r.message.usage); return [...m.values()] }
const total = (us, k) => us.reduce((s, u) => s + (u[k] || 0), 0)
const split = us => ({ input: total(us, 'input_tokens'), cacheWrite: total(us, 'cache_creation_input_tokens'), cacheRead: total(us, 'cache_read_input_tokens') })

export function cost(dir, session) {
  const rows = lines(join(dir, 'journal.jsonl'))
  const started = rows.filter(r => r.type === 'started')
  const ended = type => new Set(rows.filter(r => r.type === type).map(r => r.agentId))
  const [done, failed] = [ended('result'), ended('failed')]
  const byStage = Object.fromEntries(STAGES.map(s => [s, { tokens: 0, agents: 0, contextTokens: 0 }]))
  const context = { input: 0, cacheWrite: 0, cacheRead: 0 }
  let outputTokens = 0, contextTokens = 0, first = Infinity, last = -Infinity
  for (const a of started) {
    const stage = stageOf(a)
    if (!stage) throw new Error(`unmapped agent: ${a.label} (phase ${a.phase})`)
    const f = join(dir, `agent-${a.agentId}.jsonl`)
    const rows = existsSync(f) ? lines(f) : []
    for (const r of rows) {
      const t = Date.parse(r.timestamp)
      if (t) { first = Math.min(first, t); last = Math.max(last, t) }
    }
    const us = usages(rows), kinds = split(us)
    const tokens = total(us, 'output_tokens')
    const ctx = kinds.input + kinds.cacheWrite + kinds.cacheRead
    for (const k in context) context[k] += kinds[k]
    byStage[stage].tokens += tokens
    byStage[stage].agents++
    byStage[stage].contextTokens += ctx
    outputTokens += tokens
    contextTokens += ctx
  }
  const labels = test => started.filter(a => test(a.agentId)).map(a => a.label)
  return {
    outputTokens, contextTokens, context, agents: started.length, wallMinutes: last > first ? Math.round((last - first) / 6000) / 10 : 0, byStage,
    ...(session && (us => ({ coordinator: { calls: us.length, outputTokens: total(us, 'output_tokens'), context: split(us) } }))(usages(lines(session)))),
    failed: labels(id => failed.has(id)), unfinished: labels(id => !done.has(id) && !failed.has(id)),
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) { console.error('usage: node cost.mjs <Transcript dir> [<coordinator session .jsonl>]'); process.exit(2) }
  console.log(JSON.stringify(cost(process.argv[2], process.argv[3]), null, 2))
}
