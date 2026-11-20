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
has(/`<Transcript dir>\/journal\.jsonl`/, 'journal path spelled from the launch result')
has(/a `failed` row died/, 'journal: failed agents')
has(/`started` with no `result` or `failed` row never finished/, 'journal: unfinished agents')
has(/`node <skill dir>\/cost\.mjs <Transcript dir>`/, 'cost from the cost script next to run-cmd.mjs')
has(/never read the transcripts/, 'transcripts are not read')
has(/resumeFromRunId/, 'resume recovery gets one retro')
has(/read-only `general-purpose`[^.]*opus/, 'one read-only general-purpose agent on opus')
has(/you save/i, 'the coordinator saves the file')
has(/eval runs[^.]*evals\/retros\/<run id>\.md/i, 'eval-run output location')
has(/evals\/runs\/<run id>\.json/, 'eval retro shares the run file id')
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
has(/expanded `\$HOME` value/, 'gate greps the expanded $HOME')
has(/tests\/fixture-scenarios\.md and skills\/run\/tests\/fixture\/ \(fixture repos, branches, workstream ids\) are public and exempt/, 'fixture names are exempt')
for (const x of ['repo paths', 'featureBranch', 'workstream ids', '\\$HOME', 'PR titles', 'bodies', 'commit messages']) has(new RegExp(x), `privacy gate covers ${x}`)
has(/AskUserQuestion/, 'ranked list via AskUserQuestion')
has(/Nothing is applied without/, 'nothing applied without OK')
has(/PRs reviewed until clean/, 'approved changes become PRs reviewed until clean')
has(/skills\/run\/tests\/fixture\/build\.sh/, 'names the fixture builder')
const final = section('## 4. Final call', '## 5. Finish')
assert(/retro/i.test(final), '§4 end-of-run ask allows the retro list')
const OPEN = /`open` in the ledger means no validator accepted it; it may be absent from `open` \(a minor nobody re-raised, or an escalation awaiting the user\)\. Count a carried minor once\./
assert(OPEN.test(final), '§4 explains ledger open vs open strings')
assert(/the result key, not the prompt-side ledger/.test(read('workflow.js')), 'crossRepo.ledger is told apart from the prompt-side ledger')

const retro = read('retro.md')
for (const h of ['Run', 'Process', 'Data', 'Changes, ranked', 'Eval gaps', 'Not checked'])
  assert(new RegExp(`^## ${h}$`, 'm').test(retro), `retro.md lacks "## ${h}"`)
assert(/^\s*\d+\. target: hydra \| evals$/m.test(retro), 'Changes: target')
for (const f of ['what', 'evidence', 'expected gain', 'cost']) assert(new RegExp(`^\\s+${f}:`, 'm').test(retro), `Changes lacks ${f}:`)
assert(/generalis/i.test(retro), 'retro.md states the privacy rule')
assert(/no local paths, branch names, URLs, secrets or env values/.test(flat(retro)), 'retro.md privacy paragraph')
assert(OPEN.test(flat(retro)), 'retro.md explains ledger open vs open strings')
assert(/`workstreams\[\]\.status`/.test(retro), 'Outcome includes workstream status')
assert(/Omit a prompt with nothing to report; a section with nothing at all is the single word none; a null crossRepo or docs is not a finding\./.test(flat(retro)), 'empty-section rule')
assert(/evals\/runs\/<run id>\.json/.test(retro), 'eval retro points at the run file')
assert(/review, wb-review -> reviewer[^\n]*from validate, wb-validate or recheck -> test-guard[^\n]*from review or wb-review stays reviewer[^\n]*contract -> contract[^\n]*merge \(`M-F1`, script-raised\) -> no catcher/.test(retro), 'ledger stage -> evals catcher mapping')
assert(/`budget\.spent` is session-wide \(the coordinator plus parallel agents\): use it only against `budget\.tokenBudget` and `budget\.stoppedBy`\. Run cost comes from cost\.mjs/.test(flat(retro)), 'budget.spent is not run cost')
assert(/cost\.mjs[^\n]*output verbatim, never `budget\.spent`/.test(readFileSync(new URL('../../../evals/README.md', import.meta.url), 'utf8')), 'evals/README: cost is cost.mjs output')
assert(/journal not read/.test(retro) && /never a required input/.test(flat(retro)), 'retro.md: the journal is optional, the result is primary')

// Mock run: 2 repos + a docs-only repo, a review finding fixed in cycle 1, whole-branch findings left open (wbRounds 0).
const SHA = n => (n + '').padStart(40, 'a')
const parallel = fs => Promise.all(fs.map(f => f().catch(() => null)))
const F = (id, severity = 'major') => ({ id, severity, kind: 'bug', where: 'a:1', issue: 'x', evidence: 'e' })
const push = { status: 'done', ok: true, tests: 't', gateTail: 'exit 0', sharedEdits: [], decisions: [], questions: [], notes: [] }
const verdict = (sha, findings = []) => ({ verdict: 'fail', sections: 's', sha, tests: 't', gate: { command: 'npm test', green: true, summary: '', flaky: [] }, findings })
const agent = async (p, o) => {
  const L = o.label
  if (L.endsWith('implement')) return { ...push, sha: SHA(1) }
  if (L.endsWith('review c1')) return { headSha: SHA(1), findings: [F('c1-F1')] }
  if (L.endsWith('fix c1')) return { ...push, sha: SHA(2), answers: [{ id: 'c1-F1', action: 'fixed', note: 'n' }] }
  if (L.endsWith('validate c1')) return { headSha: SHA(2), gate: { command: 'npm test', green: true, summary: '', flaky: [] }, verified: ['c1-F1'], open: [] }
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

// Status logic: earlier red gates settle on the next green gate (workstream and repo) and never on a red one,
// a declined minor, an escalated answer stays open, a recheck-verified id, a validator re-raising a review
// finding keeps its review stage, and a carried workstream minor reaches the repo ledger with its stage.
{
  const gate = green => ({ command: 'npm test', green, summary: green ? '' : 'red', flaky: [] })
  const head = p => (p.match(/\.\.\.?([0-9a-f]{40})/) || [])[1]
  const answers = ids => ids.map(([id, action]) => ({ id, action, note: 'n' }))
  const go = async (sc, args = {}) => {
    let n = 10
    const agent = async (p, o) => {
      const L = o.label, x = sc[L]?.() || {}
      if (L.endsWith('implement')) return { ...push, sha: SHA(1) }
      if (/review c\d$/.test(L)) return { headSha: head(p), findings: [], ...x }
      if (/fix c\d$/.test(L) || /fix r\d$/.test(L)) return { ...push, sha: SHA(++n), answers: [], ...x }
      if (/validate c\d$/.test(L)) return { headSha: head(p), gate: gate(true), verified: [], open: [], ...x }
      if (L.endsWith('merge')) return { ...push, sha: SHA(3) }
      if (L === 'one review') return { headSha: SHA(3), seams: 'none', findings: [], ...x }
      if (L === 'one validate') return { verdict: 'pass', sections: 's', sha: SHA(3), tests: 't', gate: gate(true), findings: [], ...x }
      if (/recheck r\d$/.test(L)) return { verdict: 'pass', sections: 's', sha: head(p), tests: 't', gate: gate(true), findings: [], verified: [], ...x }
      if (L.endsWith('promote')) return { ok: true, sha: (p.match(/ to ([0-9a-f]{40})\./) || [])[1], notes: [] }
      if (L.endsWith(' docs')) return { baseSha: SHA(3), sha: '', files: [], prBody: false, ok: true, tests: 't', notes: [] }
      throw new Error('unmocked ' + L)
    }
    return Run({ cycles: null, workstreams: [ws('a', '/r/one')], ...args }, agent, parallel, () => {}, { total: null, spent: () => 0, remaining: () => Infinity })
  }
  const minor = { ...F('v3-F1', 'minor'), where: 'c:3' }
  const r = await go({
    'a review c1': () => ({ findings: [F('c1-F1'), { ...F('c1-F2', 'minor'), where: 'b:2' }] }),
    'a fix c1': () => ({ answers: answers([['c1-F1', 'fixed'], ['c1-F2', 'declined']]) }),
    'a validate c1': () => ({ gate: gate(false), verified: ['c1-F2'], open: [F('c1-F1')] }),
    'a validate c2': () => ({ gate: gate(false), verified: ['c1-F1'], open: [] }),
    'a validate c3': () => ({ open: [minor] }),
    'a review c4': () => ({ findings: [minor] }),
    'one review': () => ({ findings: [F('W-F1')] }),
    'one validate': () => ({ verdict: 'fail', gate: gate(false), findings: [] }),
    'one fix r1': () => ({ answers: answers([['W-F1', 'fixed']]) }),
    'one recheck r1': () => ({ verdict: 'fail', gate: gate(false), verified: ['W-F1'], findings: [] }),
  })
  const w = r.workstreams[0], repo = r.repos[0]
  assert(w.merged, 'status scenario merges: ' + JSON.stringify(w.escalations))
  is(entry(w.findings, 'c1-F1'), { stage: 'review', status: 'fixed' }, 're-raised review finding keeps its stage')
  is(entry(w.findings, 'c1-F2'), { stage: 'review', status: 'declined' }, 'declined minor')
  is(entry(w.findings, 'v1-G'), { stage: 'validate', status: 'fixed' }, 'first red gate settles on a later green')
  is(entry(w.findings, 'v2-G'), { stage: 'validate', status: 'fixed' }, 'second red gate')
  is(entry(w.findings, 'v3-F1'), { stage: 'validate', status: 'open' }, 'carried minor, workstream side')
  assert.equal(repo.verdict, 'pass', 'repo passes after round 2: ' + JSON.stringify(repo.escalations))
  is(entry(repo.findings, 'a:v3-F1'), { stage: 'validate', status: 'open', severity: 'minor' }, 'carried minor keeps its workstream stage in the repo ledger')
  is(entry(repo.findings, 'W-F1'), { stage: 'wb-review', status: 'fixed' }, 'recheck-verified id')
  is(entry(repo.findings, 'V-G'), { stage: 'wb-validate', status: 'fixed' }, 'whole-branch red gate settles on a later green')
  is(entry(repo.findings, 'R1-G'), { stage: 'recheck', status: 'fixed' }, 'recheck red gate')

  const red = await go({
    'a review c1': () => ({ findings: [F('c1-F1'), { ...F('c1-F3'), kind: 'question', where: 'd:4' }] }),
    'a fix c1': () => ({ answers: answers([['c1-F1', 'fixed'], ['c1-F3', 'escalated']]) }),
    'a validate c1': () => ({ gate: gate(false), verified: ['c1-F1', 'c1-F3'] }),
    'a validate c2': () => ({ gate: gate(false) }),
  }, { maxCycles: 2 })
  const rw = red.workstreams[0]
  assert(!rw.merged, 'red-gate scenario stops at the cap')
  is(entry(rw.findings, 'c1-F1'), { status: 'fixed' }, 'verified fix')
  is(entry(rw.findings, 'c1-F3'), { stage: 'review', status: 'open' }, 'an escalated answer stays open')
  is(entry(rw.findings, 'v1-G'), { status: 'open' }, 'a red gate never settles an earlier red gate')
  is(entry(rw.findings, 'v2-G'), { status: 'open' }, 'last red gate')
}
console.log('retro status checks ok')
