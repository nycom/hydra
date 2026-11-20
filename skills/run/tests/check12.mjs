// An author who continues from an earlier attempt that already meets the brief returns that head without a no-op commit.
// Fails against the 0.3.4 script.
import { Run } from './run.mjs'
import assert from 'node:assert'
const SHA = n => (n + '').padStart(40, 'a')
const parallel = fs => Promise.all(fs.map(f => f().catch(() => null)))
const free = { total: null, spent: () => 0, remaining: () => Infinity }
const push = { status: 'done', ok: true, tests: 't', gateTail: 'exit 0', sharedEdits: [], decisions: [], questions: [], notes: [] }
const green = { command: 'npm test', green: true, summary: '', flaky: [] }
const prompts = {}, schemas = {}
const agent = async (p, o) => {
  const L = o.label.replace(/ attempt \d$/, '')
  prompts[L] = p; schemas[L] = o.schema
  if (L.endsWith('implement')) return { ...push, sha: SHA(1) } // the earlier attempt's head, unchanged
  if (/review c\d/.test(L)) return { headSha: SHA(1), findings: [] }
  if (/validate c\d/.test(L)) return { headSha: SHA(1), gate: green, verified: [], open: [] }
  if (L.endsWith('merge')) return { ...push, sha: SHA(50) }
  if (L.endsWith(' review')) return { headSha: SHA(50), findings: [] }
  if (L.endsWith(' validate')) return { verdict: 'pass', sections: 's', sha: SHA(50), tests: 't', gate: green, findings: [] }
  if (L.endsWith(' docs')) return { baseSha: SHA(50), sha: '', files: [], prBody: false, ok: true, tests: 't', notes: [] }
  throw new Error('unmocked ' + L)
}
const args = { workstreams: [{ id: 'one', repo: '/r/one', featureBranch: 'f', branch: 'f--one', model: 'sonnet', brief: 'b', gate: 'npm test' }] }
const r = await Run(args, agent, parallel, () => {}, free)
const p = prompts['one implement']
assert.match(p, /If origin\/f--one already exists from an earlier attempt and is not yet merged into origin\/f, continue from it instead/)
assert.match(p, /Nothing to change \(the branch already meets the brief and the gate is green\): no commit, no push, status "done", sha = the current origin\/f--one head, ok = true\./,
  'the implement prompt lets an author return a finished earlier attempt without a no-op commit')
// the prompt, its return line and the schema must agree that the no-push case is ok
assert.match(p, /Return status \("done" only when the gate is green and the push verified, or nothing to change\)/, 'the return line allows nothing to change')
assert.match(schemas['one implement'].properties.ok.description, /nothing to change: gate green, no push/, 'the implement schema allows ok without a push')
assert.doesNotMatch(schemas['one merge'].properties.ok.description, /nothing to change/, 'a merge always pushes')
assert.equal(r.workstreams[0].merged, true, 'an unchanged earlier-attempt head still reviews, validates and merges')
console.log('continue-from-finished-attempt checks ok')
