#!/usr/bin/env node
// Cost of one Workflow run from its Transcript dir: node cost.mjs <Transcript dir>
// Prints {outputTokens, agents, byStage, dead}; byStage uses the evals run-file stage names.
// Reads only journal.jsonl and the usage lines of agent-<agentId>.jsonl, never message content.
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
  const done = new Set(rows.filter(r => r.type === 'result').map(r => r.agentId))
  const byStage = Object.fromEntries(STAGES.map(s => [s, { tokens: 0, agents: 0 }]))
  let outputTokens = 0
  for (const a of started) {
    const stage = stageOf(a)
    if (!stage) throw new Error(`unmapped agent: ${a.label} (phase ${a.phase})`)
    const f = join(dir, `agent-${a.agentId}.jsonl`)
    const usage = new Map() // a streamed message repeats its id; its last usage line is the final count
    if (existsSync(f)) for (const r of lines(f)) if (r.message?.usage) usage.set(r.message.id, r.message.usage.output_tokens || 0)
    const tokens = [...usage.values()].reduce((s, x) => s + x, 0)
    byStage[stage].tokens += tokens
    byStage[stage].agents++
    outputTokens += tokens
  }
  return { outputTokens, agents: started.length, byStage, dead: started.filter(a => !done.has(a.agentId)).map(a => a.label) }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) { console.error('usage: node cost.mjs <Transcript dir>'); process.exit(2) }
  console.log(JSON.stringify(cost(process.argv[2]), null, 2))
}
