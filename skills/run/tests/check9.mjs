// fixture/cost.mjs: output tokens and agent counts per evals stage from a synthetic Workflow transcript dir.
import assert from 'node:assert'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { cost } from './fixture/cost.mjs'
const dir = mkdtempSync(join(tmpdir(), 'hydra-cost-'))
try {
  const jl = rows => rows.map(r => JSON.stringify(r)).join('\n') + '\n'
  const agents = [
    ['a1', 'a implement', 'Implement', 100], ['a2', 'a review c1', 'Review cycles', 40], ['a3', 'a fix c1', 'Review cycles', 30],
    ['a4', 'a validate c1', 'Review cycles', 20], ['a5', 'a merge', 'Merge', 5], ['a6', 'one review', 'Whole-branch', 7],
    ['a7', 'one promote', 'Whole-branch', 1], ['a8', 'contracts', 'Contracts', 9], ['a9', 'one docs', 'Docs sync', 3],
    ['a10', 'one docs validate attempt 2', 'Docs sync', 2], ['a11', 'a review c2', 'Review cycles', 6],
  ]
  const dead = 'a11'
  writeFileSync(join(dir, 'journal.jsonl'), jl([{ type: 'launched' },
    ...agents.flatMap(([agentId, label, phase]) => [{ type: 'started', key: 'k', agentId, label, phase }, ...(agentId === dead ? [] : [{ type: 'result', key: 'k', agentId, result: {} }])])]))
  for (const [id, , , out] of agents) // a streamed message repeats its id: counted once, at its final usage
    writeFileSync(join(dir, `agent-${id}.jsonl`), jl([{ type: 'user', message: { content: 'secret prompt' } },
      { type: 'assistant', message: { id: `m-${id}`, usage: { output_tokens: 1 } } }, { type: 'assistant', message: { id: `m-${id}`, usage: { output_tokens: out - 1 } } },
      { type: 'assistant', message: { id: `n-${id}`, usage: { output_tokens: 1 } } }]))
  const c = cost(dir)
  assert.equal(c.agents, 11)
  assert.equal(c.outputTokens, 223)
  assert.deepEqual(Object.keys(c.byStage), ['implement', 'review', 'fix', 'validate', 'merge', 'wholeBranch', 'contracts', 'docs'])
  assert.deepEqual(c.byStage.review, { tokens: 46, agents: 2 })
  assert.deepEqual(c.byStage.wholeBranch, { tokens: 8, agents: 2 }, 'promote buckets into the stage it served')
  assert.deepEqual(c.byStage.docs, { tokens: 5, agents: 2 })
  assert.equal(Object.values(c.byStage).reduce((s, x) => s + x.tokens, 0), c.outputTokens, 'stages sum to the total')
  assert.deepEqual(c.dead, ['a review c2'])
  const cli = JSON.parse(execFileSync('node', [fileURLToPath(new URL('./fixture/cost.mjs', import.meta.url)), dir], { encoding: 'utf8' }))
  assert.deepEqual(cli, c, 'CLI prints the same JSON')
  writeFileSync(join(dir, 'journal.jsonl'), jl([{ type: 'started', agentId: 'z', label: 'x', phase: 'Research' }]))
  assert.throws(() => cost(dir), /unmapped/, 'an unknown phase is an error, not a silent bucket')
} finally { rmSync(dir, { recursive: true, force: true }) }
console.log('cost checks ok')
