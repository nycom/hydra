// Retrospective: SKILL.md wires one retro per run into §5 Finish, retro.md has every section,
// and the result carries a structured findings ledger whose paths retro.md may quote.
import { Run } from './run.mjs'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
const flat = s => s.replace(/\s+/g, ' ')
const skill = read('SKILL.md')
const section = (from, to) => flat(skill.slice(skill.indexOf(from), skill.indexOf(to)))
const finish = section('## 5. Finish', '## Stacked mode')
assert(finish.length > 1, 'SKILL.md has §5 Finish before Stacked mode')
assert(finish.includes('Retrospective'), '§5 Finish has a Retrospective step')
const step = finish.slice(finish.indexOf('Retrospective'))
const has = (re, what) => assert(re.test(step), `Retrospective step: ${what}`)
has(/retro\.md/, 'names retro.md')
has(/mandatory/i, 'mandatory')
has(/one retro per run/i, 'one retro per run')
has(/success or failure/, 'after success or failure')
has(/wholeBranch/, 'wholeBranch re-runs included')
has(/result JSON/, 'briefed with the result JSON')
has(/threw/, 'crashed Workflow call still gets a retro')
has(/journal path/, 'journal path passed from the launch result')
has(/resumeFromRunId/, 'resume recovery gets one retro')
has(/read-only `general-purpose`[^.]*opus/, 'one read-only general-purpose agent on opus')
has(/you save/i, 'the coordinator saves the file')
has(/eval runs[^.]*evals\/retros\/<YYYY-MM-DD>-<scenario>-v<version>\.md/i, 'eval-run output location')
has(/plugin cache/, 'hydra repo is a clone, never the plugin cache')
has(/treat it as real/i, 'unsure means private')
has(/real runs[^.]*never in/i, 'real-run output location')
has(/never inside a(ny)? (git )?repo/, 'real-run retros stay out of every repo')
assert(!/Obsidian/.test(skill), 'no private notes path in the public skill')
has(/generalis/i, 'privacy: generalised')
has(/no project, repo, person or host names/i, 'privacy: names')
has(/no code copied/i, 'privacy: code')
for (const x of ['local filesystem paths', 'branch names', 'URLs', 'secrets', 'env values']) has(new RegExp(x), `privacy: ${x}`)
has(/grep the staged diff and the PR text/, 'mechanical privacy gate')
for (const x of ['repo paths', 'featureBranch', 'workstream ids', '\\$HOME', 'PR titles', 'bodies', 'commit messages']) has(new RegExp(x), `privacy gate covers ${x}`)
has(/AskUserQuestion/, 'ranked list via AskUserQuestion')
has(/Nothing is applied without/, 'nothing applied without OK')
has(/skills\/run\/tests\/fixture\/build\.sh/, 'names the fixture builder')
assert(/retro/i.test(section('## 4. Final call', '## 5. Finish')), '§4 end-of-run ask allows the retro list')

const retro = read('retro.md')
for (const h of ['Run', 'Process', 'Data', 'Changes, ranked', 'Eval gaps', 'Not checked'])
  assert(new RegExp(`^## ${h}$`, 'm').test(retro), `retro.md lacks "## ${h}"`)
assert(/^\s*\d+\. target: hydra \| evals$/m.test(retro), 'Changes: target')
for (const f of ['what', 'evidence', 'expected gain', 'cost']) assert(new RegExp(`^\\s+${f}:`, 'm').test(retro), `Changes lacks ${f}:`)
assert(/generalis/i.test(retro), 'retro.md states the privacy rule')
assert(/journal not read/.test(retro) && /never a required input/.test(flat(retro)), 'retro.md: the journal is optional, the result is primary')

// Mock run: 2 repos + a docs-only repo, a review finding fixed in cycle 1, whole-branch findings left open (wbRounds 0).
const SHA = n => (n + '').padStart(40, 'a')
const parallel = fs => Promise.all(fs.map(f => f().catch(() => null)))
const F = (id, severity = 'major') => ({ id, severity, kind: 'bug', where: 'a:1', issue: 'x', evidence: 'e' })
const push = { status: 'done', ok: true, tests: 't', gateTail: 'exit 0', sharedEdits: [], decisions: [], questions: [], notes: [] }
const verdict = (sha, findings = []) => ({ verdict: 'fail', sections: 's', sha, tests: 't', gate: { green: true, summary: '', flaky: [] }, findings })
const agent = async (p, o) => {
  const L = o.label
  if (L.endsWith('implement')) return { ...push, sha: SHA(1) }
  if (L.endsWith('review c1')) return { headSha: SHA(1), findings: [F('c1-F1')] }
  if (L.endsWith('fix c1')) return { ...push, sha: SHA(2), answers: [{ id: 'c1-F1', action: 'fixed', note: 'n' }] }
  if (L.endsWith('validate c1')) return { headSha: SHA(2), gate: { green: true, summary: '', flaky: [] }, verified: ['c1-F1'], open: [] }
  if (L.endsWith('review c2')) return { headSha: SHA(2), findings: [] }
  if (L.endsWith('merge')) return { ...push, sha: SHA(3) }
  if (L.endsWith(' review')) return { headSha: SHA(3), seams: 'none', findings: [F('W-F1', 'critical')] }
  if (L.endsWith('docs validate')) return verdict(SHA(5), [F('D-F1')])
  if (L.endsWith(' validate')) return verdict(SHA(3), [F('V-F1', 'minor')])
  if (L.endsWith(' docs')) return { baseSha: SHA(3), sha: SHA(5), files: ['README.md'], prBody: false, ok: true, tests: 't', notes: [] }
  if (L === 'contracts') return { verdict: 'fail', sections: 's', findings: [F('X-F1')] }
  throw new Error('unmocked ' + L)
}
const ws = (id, repo) => ({ id, repo, featureBranch: 'f', branch: `f--${id}`, model: 'sonnet', brief: 'b', gate: 'npm test' })
const r = await Run({ cycles: null, wbRounds: 0, workstreams: [ws('a', '/r/one'), ws('b', '/r/two')],
  docsRepos: [{ repo: '/r/one', featureBranch: 'f' }, { repo: '/r/docs', featureBranch: 'f' }] }, agent, parallel, () => {}, { total: null, spent: () => 0, remaining: () => Infinity })
const entry = (list, id) => (list || []).find(f => f.id === id) || {}
const is = (e, want, what) => { for (const [k, v] of Object.entries(want)) assert.equal(e[k], v, `${what}: ${k}`) }
is(entry(r.workstreams[0].findings, 'c1-F1'), { stage: 'review', status: 'fixed', severity: 'major', kind: 'bug', where: 'a:1', issue: 'x' }, 'cycle-1 review finding')
is(entry(r.repos[0].findings, 'W-F1'), { stage: 'wb-review', status: 'open', severity: 'critical' }, 'open whole-branch finding')
is(entry(r.repos[0].findings, 'V-F1'), { stage: 'wb-validate', status: 'open' }, 'whole-branch validator finding')
is(entry(r.crossRepo.ledger, 'X-F1'), { stage: 'contract', status: 'open' }, 'contract finding')
is(entry(r.otherDocs[0].findings, 'D-F1'), { stage: 'docs', status: 'open' }, 'docs finding')
assert(r.workstreams[0].open.every(s => typeof s === 'string') && r.repos[0].open.every(s => typeof s === 'string'), 'string open lists kept')
assert(r.crossRepo.findings.every(s => typeof s === 'string'), 'crossRepo.findings stays strings')

// Every backticked result path in retro.md (e.g. `workstreams[id=alpha].extended`, `budget.stoppedBy`) exists in the result.
const TOP = Object.keys(r)
const paths = [...retro.matchAll(/`([^`\s]+)/g)].map(m => m[1]).filter(s => TOP.includes(s.split(/[.[]/)[0]) && /[.[]/.test(s))
assert(paths.length >= 10, `retro.md quotes result paths (${paths.length})`)
for (const path of paths) {
  let o = r
  for (const seg of path.split('.')) {
    const [, key, idx] = seg.match(/^(\w+)(\[[^\]]*\])?$/) || []
    assert(key && o && key in o, `retro.md path ${path}: no ${seg}`)
    o = o[key]
    if (idx) { assert(Array.isArray(o) && o.length, `retro.md path ${path}: ${key} is not a non-empty array`); o = o[0] }
  }
}
console.log('retro checks ok')
