// 0.3.9 docs: SKILL.md documents the new args and flows; the argument is ignored.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
const fails = []
const t = async (name, fn) => { try { await fn() } catch (e) { fails.push(`${name}: ${e.message.split('\n')[0]}`) } }

await t('8a SKILL.md documents the new args, the run-local script copy, the quickGate nudge and the x3 estimate; plugin.json is 0.3.9', async () => {
  const s = readFileSync(new URL('../SKILL.md', import.meta.url), 'utf8')
  for (const k of ['stopRule', 'acceptance', 'decisionLog', 'wbReviewModel']) assert(new RegExp('\\| `' + k + '` \\|').test(s), k)
  assert(/scriptPath: "<run dir>\/workflow\.js"/.test(s) && !/scriptPath: "<skill dir>\/workflow\.js"/.test(s))
  assert(/over 2 min/.test(s) && /quickGate/.test(s) && /×3/.test(s) && /heuristic churn/.test(s) && /\bdrift\b/.test(s))
  assert.equal(JSON.parse(readFileSync(new URL('../../../.claude-plugin/plugin.json', import.meta.url), 'utf8')).version, '0.3.9') })

if (fails.length) { console.error(fails.join('\n')); process.exit(1) }
console.log('0.3.9 docs checks ok')
