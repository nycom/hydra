#!/usr/bin/env node
// Cost of one Workflow run from its Transcript dir: node cost.mjs <Transcript dir>
// Prints {outputTokens, agents, wallMinutes, byStage, failed, unfinished}: byStage uses the evals run-file
// stage names; wallMinutes spans the first to the last transcript timestamp; failed = agents with a "failed"
// journal row, unfinished = started with no result or failed row. Reads only journal.jsonl and the usage and
// timestamp fields of agent-<agentId>.jsonl, never message content.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const STAGES = ['implement', 'review', 'fix', 'validate', 'merge', 'wholeBranch', 'contracts', 'docs']
const PHASE = { Implement: 'implement', Merge: 'merge', 'Whole-branch': 'wholeBranch', Contracts: 'contracts', 'Docs sync': 'docs' }
const stageOf = ({ label = '', phase }) => PHASE[phase] || (phase === 'Review cycles' && label.replace(/ attempt \d+$/, '').match(/ (review|fix|validate) c\d+$/)?.[1])
const lines = f => readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))

export function cost(dir) {
  const rows = lines(join(dir, 'journal.jsonl'))
  const started = rows.filter(r => r.type === 'started')
  const ended = type => new Set(rows.filter(r => r.type === type).map(r => r.agentId))
  const [done, failed] = [ended('result'), ended('failed')]
  const byStage = Object.fromEntries(STAGES.map(s => [s, { tokens: 0, agents: 0 }]))
  let outputTokens = 0, first = Infinity, last = -Infinity
  for (const a of started) {
    const stage = stageOf(a)
    if (!stage) throw new Error(`unmapped agent: ${a.label} (phase ${a.phase})`)
    const f = join(dir, `agent-${a.agentId}.jsonl`)
    const usage = new Map() // a streamed message repeats its id; its last usage line is the final count
    for (const r of existsSync(f) ? lines(f) : []) {
      if (r.message?.usage) usage.set(r.message.id, r.message.usage.output_tokens || 0)
      const t = Date.parse(r.timestamp)
      if (t) { first = Math.min(first, t); last = Math.max(last, t) }
    }
    const tokens = [...usage.values()].reduce((s, x) => s + x, 0)
    byStage[stage].tokens += tokens
    byStage[stage].agents++
    outputTokens += tokens
  }
  const labels = test => started.filter(a => test(a.agentId)).map(a => a.label)
  return {
    outputTokens, agents: started.length, wallMinutes: last > first ? Math.round((last - first) / 6000) / 10 : 0, byStage,
    failed: labels(id => failed.has(id)), unfinished: labels(id => !done.has(id) && !failed.has(id)),
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) { console.error('usage: node cost.mjs <Transcript dir>'); process.exit(2) }
  console.log(JSON.stringify(cost(process.argv[2]), null, 2))
}
