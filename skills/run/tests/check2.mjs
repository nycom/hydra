import { Run } from './run.mjs'
import assert from 'node:assert'
const SHA = n => (n + '').padStart(40, 'a')
const parallel = fs => Promise.all(fs.map(f => f().catch(() => null)))
const prompts = {}
const push = { status: 'done', ok: true, tests: 't', gateTail: 'exit 0', sharedEdits: [], decisions: [{ what: 'w', why: 'y' }], questions: [{ q: 'Q?', options: ['a'], default: 'a' }], notes: [] }
const agent = async (p, o) => {
  prompts[o.label] = p
  const L = o.label
  if (L.endsWith('implement')) return { ...push, sha: SHA(1), sharedEdits: [{ file: 'README.md', intent: 'document X' }] }
  if (L.endsWith('review c1')) return { headSha: SHA(1), findings: [{ id: 'c1-F1', severity: 'major', kind: 'bug', where: 'a', issue: 'x' }] }
  if (L.endsWith('fix c1')) return { ...push, sha: SHA(2), answers: [{ id: 'c1-F1', action: 'fixed', note: 'n' }], sharedEdits: [{ file: 'README.md', intent: 'document X' }] } // complete current list
  if (L.endsWith('validate c1')) return { headSha: SHA(2), gate: { command: 'npm test', green: true, summary: '' }, verified: ['c1-F1'], open: [] }
  if (L.endsWith('review c2')) return { headSha: SHA(2), findings: [] }
  if (L.endsWith('merge')) return { ...push, sha: SHA(3) }
  if (L.endsWith(' review')) return { headSha: SHA(3), findings: [{ id: 'W-F1', severity: 'critical', kind: 'bug', where: 'a', issue: 'x' }] }
  if (L.endsWith(' validate') && !L.includes('docs')) return { verdict: 'fail', sections: 's', sha: SHA(3), tests: 't', gate: { command: 'npm test', green: true, summary: '' }, findings: [] }
  if (L.endsWith('fix r1')) return { ...push, sha: SHA(4), answers: [] }
  if (L.endsWith('recheck r1')) return { verdict: 'pass', sections: 's', sha: SHA(4), tests: 't', gate: { command: 'npm test', green: true, summary: '' }, findings: [], verified: ['W-F1'] }
  if (L.endsWith(' docs')) return { baseSha: SHA(4), sha: SHA(5), files: ['README.md'], prBody: false, ok: true, tests: 't', notes: [] }
  if (L.endsWith('docs validate')) return { verdict: 'fail', sections: 's', sha: SHA(5), tests: 't', gate: { command: 'npm test', green: true, summary: '' }, findings: [{ id: 'D-F1', severity: 'major', kind: 'docs', where: 'README', issue: 'wrong' }] }
  if (L.endsWith('docs fix')) return { baseSha: SHA(5), sha: '', files: [], prBody: false, ok: true, tests: 't', notes: [] } // the round pushes nothing: the finding stays
  if (L.endsWith(' promote')) return { ok: true, sha: (p.match(/ to ([0-9a-f]{40})\./) || [])[1], notes: [] }
  throw new Error('unmocked ' + L)
}
const budget = { total: null, spent: () => 0, remaining: () => Infinity }
const r = await Run({ cycles: null, skillDir: '/skill', repos: [{ repo: '/r/one', regen: 'npm i', smoke: 'npm run boot:local', knownRed: ['t/flaky.spec'] }],
  workstreams: [{ id: 'a', repo: '/r/one', featureBranch: 'f', branch: 'f--a', model: 'sonnet', brief: 'b', gate: 'npm test', files: ['src/'] }] }, agent, parallel, () => {}, budget)
const m = prompts['a merge']
assert(m.includes(`refs/heads/f--a must equal ${SHA(2)}`) && m.includes(`git merge --no-ff ${SHA(2)}`), 'merge pins validatedSha')
assert(m.includes(`':(glob)**/README*'`) && m.includes(`':(glob,exclude)src/**'`) && m.includes('document X') && m.includes('npm i'), 'merge backstop + sharedEdits + regen')
assert(prompts['a review c2'].includes('Settled in earlier cycles') && !prompts['a review c2'].includes('Grilling') && prompts['a review c1'].includes('Grilling'), 'ledger + grilling c1 only')
assert(prompts['a review c2'].includes("don't grill one whose why is sound"), 'decisions reach reviewer')
assert(prompts['one recheck r1'].includes(`${SHA(3)}..${SHA(4)}`), 'recheck pinned range')
assert(prompts['one fix r1'].includes('Never merge a workstream branch'), 'wb fix never merges ws')
assert(prompts['one validate'].includes('npm run boot:local') && prompts['one validate'].includes('t/flaky.spec') && !/wire contracts, field/.test(prompts['one validate']))
assert(prompts['a implement'].includes('.claude/') && prompts['a implement'].includes('Hard rules'))
assert(!prompts['contracts'], 'single repo: no contract check')
assert(['a implement', 'one fix r1'].every(k => prompts[k].includes('Never write pgrep -f wait loops')), 'GATE bans pgrep wait loops')
const repo = r.repos[0]
assert.equal(repo.verdict, 'fail'); assert.equal(repo.finalSha, SHA(4)); assert(repo.open.some(s => s.includes('wrong')))
assert.equal(r.workstreams[0].questions.length, 1); assert.equal(r.workstreams[0].findingsFixed, 1)
console.log('prompt checks ok')
