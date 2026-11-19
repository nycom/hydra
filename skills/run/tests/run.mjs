import { readFileSync } from 'node:fs'
const src = readFileSync(process.argv[2], 'utf8')
const metaEnd = src.indexOf('\n}\n') + 3
const metaSrc = src.slice(0, metaEnd).replace('export const meta =', 'return')
const meta = new Function(metaSrc)()
const body = src.slice(metaEnd)
const Run = new Function('args', 'agent', 'parallel', 'log', 'budget', `return (async () => {${body}\n})()`)
export { meta, Run }
