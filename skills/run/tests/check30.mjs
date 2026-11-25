// The brief review before launch: what it returns, where the skill puts it, and a resume's `decisions` next to the brief they contradict.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { core, refs } from './skill-text.mjs'
const fails = []
const t = async (name, fn) => { try { await fn() } catch (e) { fails.push(`${name}: ${e.message.split('\n')[0]}`) } }
const flat = s => s.replace(/\s+/g, ' ')
const has = (s, ...parts) => { for (const p of parts) assert(s.includes(p), `lacks "${p}"`) }
const readme = readFileSync(new URL('../../../README.md', import.meta.url), 'utf8')
const section = n => flat(core.split(/^## (?=\d\. )/m).find(s => s.startsWith(`${n}. `)))
const [before, para = ''] = section(2).split('**Brief review before launch**')

await t('1 section 2 has the brief review, after the briefs are written', () => {
  assert(para, 'the paragraph')
  has(before, '- Write each brief:') })
await t('2 it runs for two or more workstreams or an added default, as one read-only opus reviewer on the settled type', () => {
  has(para, '2+ workstreams', 'default or pre-answer you added', 'one `reviewer` on `opus`', 'read-only') })
await t('3 it returns the pair table, scope additions and contradictions', () => {
  has(para, 'one row per workstream', 'one row per pair of workstreams', 'adds behaviour the plan does not state', '`decisionLog`', '`acceptance`', '`decisions.<id>`') })
await t('4 a result without the table does not count', () => { has(para, 'without the table does not count') })
await t('5 a scope addition never launches as a default', () => { has(para, 'out of scope', 'never launch it as a non-blocking default') })
await t('6 the `decisions` row: the brief is edited and reviewed again before the resume', () => {
  const row = refs['questions-and-resume.md'].split('\n').find(l => l.startsWith('| `decisions` |'))
  has(row, 'never rewrites the brief', 'done-when checks included', 'brief review') })
await t('7 the no-edit rule binds a humanCheck pause only', () => {
  has(section(4), 'a `humanCheck` pause')
  assert(!section(4).includes('Between the pause and the resume'), 'unscoped') })
await t('8 the coordinator is the session, whatever its model', () => { has(core, 'Coordinator = this session:') })
await t('9 the README names the review and its model', () => {
  assert.match(readme, /^\| Brief review[^|]*\| `opus` \|/m)
  assert.match(readme, /^- [^\n]*brief review/mi) })

if (fails.length) { console.error(fails.join('\n')); process.exit(1) }
console.log('brief review checks ok')
