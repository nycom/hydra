// cost.mjs: output and context tokens, agents, wall time and failed/unfinished agents from a synthetic Workflow transcript dir.
import assert from 'node:assert'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { cost } from '../cost.mjs'
const dir = mkdtempSync(join(tmpdir(), 'hydra-cost-'))
try {
  const jl = rows => rows.map(r => JSON.stringify(r)).join('\n') + '\n'
  const agents = [
    ['a1', 'a implement', 'Implement', 100], ['a2', 'a review c1', 'Review cycles', 40], ['a3', 'a fix c1 attempt 3', 'Review cycles', 30],
    ['a4', 'a validate c1', 'Review cycles', 20], ['a5', 'a merge', 'Merge', 5], ['a6', 'one review', 'Whole-branch', 7],
    ['a7', 'one promote', 'Whole-branch', 1], ['a8', 'contracts', 'Contracts', 9], ['a9', 'one docs', 'Docs sync', 3],
    ['a10', 'one docs validate attempt 2', 'Docs sync', 2], ['a11', 'a review c2', 'Review cycles', 6], ['a12', 'a review c2 attempt 2', 'Review cycles', 4], ['a13', 'drift', 'Drift audit', 11],
  ]
  const end = { a11: 'failed', a12: null } // a failed row, and no terminal row at all
  writeFileSync(join(dir, 'journal.jsonl'), jl([{ type: 'launched' },
    ...agents.flatMap(([agentId, label, phase]) => [{ type: 'started', key: 'k', agentId, label, phase }, ...(end[agentId] === null ? [] : [{ type: end[agentId] || 'result', key: 'k', agentId, ...(end[agentId] ? {} : { result: {} }) }])])]))
  const at = m => `2026-11-20T10:${String(m).padStart(2, '0')}:00.000Z`
  // context = input + cache creation + cache read: 1110 at m's final usage (its first is overwritten) + 1 at n = 1111 per agent
  const ctx = { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000 }
  agents.forEach(([id, , , out], i) => // a streamed message repeats its id: counted once, at its final usage
    writeFileSync(join(dir, `agent-${id}.jsonl`), jl([{ type: 'user', timestamp: at(i + 1), message: { content: 'secret prompt' } },
      { type: 'assistant', timestamp: at(i + 2), message: { id: `m-${id}`, usage: { output_tokens: 1, input_tokens: 5000 } } }, { type: 'assistant', message: { id: `m-${id}`, usage: { output_tokens: out - 1, ...ctx } } },
      { type: 'assistant', timestamp: at(i === 5 ? 50 : i + 3), message: { id: `n-${id}`, usage: { output_tokens: 1, input_tokens: 1 } } }])))
  const c = cost(dir)
  assert.equal(c.agents, 13)
  assert.equal(c.outputTokens, 238)
  assert.equal(c.wallMinutes, 49, 'first to last transcript timestamp')
  assert.deepEqual(Object.keys(c.byStage), ['implement', 'review', 'fix', 'validate', 'merge', 'wholeBranch', 'contracts', 'docs'])
  assert.deepEqual(c.byStage.review, { tokens: 50, agents: 3, contextTokens: 3333 })
  assert.deepEqual(c.byStage.fix, { tokens: 30, agents: 1, contextTokens: 1111 }, '" attempt N" stripped from a Review cycles label')
  assert.deepEqual(c.byStage.wholeBranch, { tokens: 8, agents: 2, contextTokens: 2222 }, 'promote buckets into the stage it served')
  assert.deepEqual(c.byStage.contracts, { tokens: 20, agents: 2, contextTokens: 2222 }, 'the drift audit buckets into contracts')
  assert.deepEqual(c.byStage.docs, { tokens: 5, agents: 2, contextTokens: 2222 })
  assert.equal(Object.values(c.byStage).reduce((s, x) => s + x.tokens, 0), c.outputTokens, 'stages sum to the total')
  assert.equal(c.contextTokens, 13 * 1111, 'context tokens: last usage per message id, input + cache creation + cache read')
  assert.equal(Object.values(c.byStage).reduce((s, x) => s + x.contextTokens, 0), c.contextTokens, 'stage context sums to the total')
  assert.deepEqual(c.failed, ['a review c2'])
  assert.deepEqual(c.unfinished, ['a review c2 attempt 2'])
  const cli = JSON.parse(execFileSync('node', [fileURLToPath(new URL('../cost.mjs', import.meta.url)), dir], { encoding: 'utf8' }))
  assert.deepEqual(cli, c, 'CLI prints the same JSON')
  writeFileSync(join(dir, 'journal.jsonl'), jl([{ type: 'started', agentId: 'z', label: 'x', phase: 'Research' }]))
  assert.throws(() => cost(dir), /unmapped/, 'an unknown phase is an error, not a silent bucket')
} finally { rmSync(dir, { recursive: true, force: true }) }
console.log('cost checks ok')
