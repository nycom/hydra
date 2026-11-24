// The skill's split: a core of bounded size, a table in it that names every reference file, and no pointer that lost its target in the move.
import assert from 'node:assert'
import { core, refs } from './skill-text.mjs'
const fails = []
const t = async (name, fn) => { try { await fn() } catch (e) { fails.push(`${name}: ${e.message.split('\n')[0]}`) } }
const names = Object.keys(refs)

await t('the core is at most 34K characters', () => assert(core.length <= 34000, `SKILL.md has ${core.length} characters`))
await t('the core\'s table names every reference file, and every file it names exists', () => {
  const rows = core.split('| situation | read | when |\n')[1]?.split('\n\n')[0]
  assert(rows, 'SKILL.md has the table')
  assert(core.indexOf('| situation |') < core.indexOf('## 1. Decompose'), 'the table stands before section 1')
  const named = [...new Set([...rows.matchAll(/`<skill dir>\/references\/([^`]+)`/g)].map(m => m[1]))].sort()
  assert(names.length, 'there are reference files')
  assert.deepEqual(named, names) })
await t('every reference file a text points at exists', () => {
  for (const [f, s] of Object.entries({ 'SKILL.md': core, ...refs })) for (const [, r] of s.matchAll(/references\/([\w-]+\.md)/g)) assert(refs[r], `${f}: references/${r}`) })

// [a phrase that points at a place, what must stand in the same file]; no second item: the word is no position
const PLACES = [[/tiers? above/], [/never below/i], [/depends on the slice below/], [/`<skill dir>` below/, /<skill dir>\//],
  [/no-network check below/, /no-network check yourself/]]
const POINTERS = [[/see Human checks(?! in `)/, /\*\*Human checks\*\*/], [/see Local-only mode/, /\*\*Local-only mode\*\*/], [/see the args table/, /^\| arg \| default \| meaning \|/m],
  [/see its args row(?! in `)/, /^\| `decisionLog` \|/m], [/see `drift`(?! in `)/, /^- `drift`:/m], [/(?<!SKILL\.md,? )(?:§|\bsection )\d(?! of SKILL\.md)/, /^## \d\. /m]]
for (const [f, s] of Object.entries({ 'SKILL.md': core, ...refs })) {
  const flat = s.replace(/[^\S\n]*\n[^\S\n]+|(?<=\S)\n(?=\S)/g, ' ')
  await t(`${f}: "above" and "below" point into the same file`, () => {
    for (const m of flat.matchAll(/\b(above|below)\b/gi)) {
      const at = flat.slice(Math.max(0, m.index - 60), m.index + m[0].length)
      const p = PLACES.find(([re]) => new RegExp(`(?:${re.source})$`, re.flags).test(at))
      assert(p && (!p[1] || p[1].test(flat)), `"…${at}"`)
    } })
  await t(`${f}: a named pointer's target stands in the same file`, () => {
    for (const [re, target] of POINTERS) assert(!re.test(flat) || target.test(s), `${flat.match(re)?.[0]}: no ${target}`) })
}

if (fails.length) { console.error(fails.join('\n')); process.exit(1) }
console.log('skill split checks ok')
