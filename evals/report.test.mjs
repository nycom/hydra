// Fails when report.html, the README eval block or report.sha256 are stale against evals/runs/.
// Run evals/snapshot.sh to refresh all three (and the PNGs).
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert'
import { ROOT, loadRuns, validate, buildHtml, readmeBlock, shaFile, withBlock, blockOf } from './report.mjs'

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8')
const entries = loadRuns()
const fix = 'stale: run evals/snapshot.sh'

// staleness
assert.equal(read('evals/report.html'), buildHtml(entries), `evals/report.html ${fix}`)
const block = blockOf(read('README.md'))
assert.ok(block, 'README has no <!-- eval:start --> ... <!-- eval:end --> block; run evals/snapshot.sh')
const { combined, text } = shaFile(entries)
assert.equal((block.match(/sha256: `([0-9a-f]{64})`/) || [])[1], combined, `README block hash does not match evals/runs; ${fix}`)
assert.equal(block, readmeBlock(entries), `README eval block ${fix}`)
assert.equal(read('evals/report.sha256'), text, `evals/report.sha256 ${fix}`)
assert.ok(/^# .*\n\n[^\n]+\n\n<!-- eval:start -->/.test(read('README.md')), 'eval block must sit right under the README title and first line')

// schema rejects what it should
const good = entries.find(e => e.run.scenario === 'S15-seeded').run
const bad = (mut, re) => { const r = structuredClone(good); mut(r); assert.throws(() => validate(r, 'x.json'), re) }
bad(r => { r.recall = 1 }, /recall must be caught\/8/)
bad(r => { r.defects.D1 = { caught: true, stage: 'linter', findingId: 'F1' } }, /D1/)
bad(r => { r.defects.D2 = { caught: false, stage: 'reviewer', findingId: null } }, /D2/)
bad(r => { delete r.defects.D8 }, /exactly D1..D8/)
bad(r => { r.scenario = 'S17' }, /scenario/)
bad(r => { r.cost.byStage.review.tokens += 1 }, /sum to outputTokens/)

// block placement: inserted under the first line once, replaced in place after
const b = '<!-- eval:start -->\nX\n<!-- eval:end -->'
const once = withBlock('# t\n\nfirst line.\n\n## More\n', b)
assert.equal(once, `# t\n\nfirst line.\n\n${b}\n\n## More\n`)
assert.equal(withBlock(once, b.replace('X', 'Y')), once.replace('X', 'Y'))

console.log(`ok: report.html, README block and report.sha256 match ${entries.length} runs`)
