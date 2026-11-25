// The skill's text: the core (SKILL.md), every reference file by name, and all of it concatenated, core first, references in name order.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
const dir = new URL('../references/', import.meta.url)
export const core = read('SKILL.md')
export const refs = Object.fromEntries((existsSync(dir) ? readdirSync(dir) : []).filter(f => f.endsWith('.md')).sort().map(f => [f, read(`references/${f}`)]))
export const skillText = [core, ...Object.values(refs)].join('\n')
