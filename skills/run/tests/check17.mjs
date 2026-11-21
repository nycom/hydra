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

await t('8b SKILL.md: wholeBranch re-run drift audit, drift in the size count, decisionLog as a decision channel, known-gaps promote logs the parked majors and skips with acceptance', async () => {
  const s = readFileSync(new URL('../SKILL.md', import.meta.url), 'utf8')
  const row = s.split('\n').find(l => l.startsWith('| `stage` |'))
  assert(/drift audit when `decisionLog` is set/.test(row), 'stage row')
  assert(s.includes('+1 fable drift audit when decisionLog is set'), 'size')
  assert(!/the only channel by which/.test(s) && /through the brief, or through the `decisionLog` when set/.test(s), 'channel')
  const kg = s.slice(s.indexOf('**Known-gaps promote:**'), s.indexOf('**Reviewer tiering:**')).replace(/\s+/g, ' ')
  assert(/append the parked majors to the `decisionLog` as accepted known gaps, or to the briefs when there is no log/.test(kg) && kg.indexOf('decisionLog') < kg.indexOf('re-run `stage: "wholeBranch"`'), 'promote log')
  assert(/skipped when `acceptance` or `stopRule` is set/.test(kg), 'acceptance/stopRule skip')
  assert(/git -C <repo> fetch <remote> <featureBranch>--wbfix<n>/.test(kg), 'promote fetches first') })

if (fails.length) { console.error(fails.join('\n')); process.exit(1) }
console.log('0.3.9 docs checks ok')
