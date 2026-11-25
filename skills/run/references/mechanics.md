# Mechanics: what the script does in each stage

Read when you must explain or judge a stage, and before any change to workflow.js.

## Cycles

Minors never drive a cycle:
fixers may decline them, and leftovers are carried to the whole-branch pass:
its first validator settles (`fixed`) each one the final head resolves, the rest
ride into the fix round. Workstream validators are told which files are shared
and that their edits land at the merge, so a brief criterion on a shared file is
met by the author's `sharedEdits`; only an edit missing from that list is a
finding. The cycle reviewer is told which files are shared too, and that a change
missing from them is not a finding (not the whole-branch reviewer: there the
edits are applied). A converged review of a head no validator has seen yet (typically a clean
cycle 1) gets one validator pass before it can merge; if that validator finds a
critical or major, the same cycle goes straight to the fix. A blocker that
survives two fix rounds (same id, or same `where`) gets its next fix on opus
with the earlier attempts in the prompt; if it survives that too, it becomes a
`questions` entry and the workstream stops, NOT merged — never another patch,
and never fable inside the workflow. A regression chain has a new id and line
every cycle, so that count never sees it: the cycles also stop on churn, as the
whole-branch rounds do. A hit is a new regression-kind blocker in a file that
cycle's fix was asked to touch; hits in two cycles in a row, or one hit while an
optional question of that workstream is still open, stop it NOT merged with one
question. A merge the merge agent rejects goes back
to its author once (if the cap and reserve allow): its notes become an
`integration` critical, one fix cycle (no re-review of the unchanged head) and a
delta validation, then it requeues behind the repo's merge lock.

## Validators, gates and promotion

**Validators, gates and green:** the first validator of each workstream writes
2–5 black-box acceptance tests from the brief before it reads the diff, runs
them at the head and never commits them (a brief that says no behaviour change
gets the same inputs run at base and head, outputs diffed). That first validator
also runs the test-integrity guard (`git diff --diff-filter=MDR` on tests) over
the whole workstream range `origin/<featureBranch>...<head>`, even when it is a
delta validator after a non-clean review; only the test guard widens, later
delta validators judge only their delta. Every validator runs
each new or changed test 3 times in a row. Tests a validator proves flaky
(intermittent on head and failing at the base too) join a run-wide per-repo
registry: later gate prompts give them one rerun and no base rerun, and the
result lists them. **Promote-on-green:** whole-branch fixes push to
`<featureBranch>--wbfix<round>` and docs to `<featureBranch>--docs`; a low-effort
sonnet step fast-forwards the feature branch only after the recheck or docs
validator passes, and only if it still sits at the expected head. Otherwise the
side branch stays, the feature branch stays at its last validated SHA, and the
repo fails with an escalation naming the side branch. Before a failed docs
validation counts, a critical or major in it gets one docs fix round: a sonnet
step corrects the named doc lines on `<featureBranch>--docs`, and the same
validator runs again over the whole docs range (`docs revalidate`); never a second
round, and none on the script's own `D-X` or under the reserve. Docs run only on a repo
whose whole-branch pass did not fail, and only from the SHA that pass validated.
`finalSha` is always a validated SHA.
Before the whole-branch fix round, a validator finding joins a reviewer finding
as one entry when the first `path:line` or `path:from-to` anywhere in each `where`
names the same file with overlapping lines (higher severity kept, the other
finding under `also`, which keeps the entry blocking while it is critical or
major); each reviewer finding pairs once. Verifying
the entry settles both ids unless the recheck returns the `also` one open under
its own id. Both hunts stay independent, and a `where` with no `path:line`
never collapses.
**A gate that never ran is a dead attempt:** every gate report carries
`command`, the exact gate command(s) the agent ran at that head in that step.
In a step whose prompt carries a gate (both workstream validators, the
whole-branch validator, each recheck, and the docs validator, its re-run after
a docs fix round included, when the repo has a gate), a report whose `command` is empty, or whose `command` or `summary`
starts with "skip", "skipped", "not run", "none" or "n/a" (so "skipped: clean
review" never ran, while "OK (skipped=1)" did), is retried like a dead agent
with "the previous attempt returned without running the gate … report the
command you ran in gate.command"; three such attempts stop the workstream
(NOT merged) or fail the repo, and the escalation says it never ran its gate.
The script does not check `command` against the configured gate: validators
legitimately split a chained gate, add flags or wrap it in the regen recipe,
and a wrong rejection costs a whole opus validator rerun. Workstream validators
also return `evidence`, one line per step with the commands run for it,
copied into `workstreams[].evidence`.
**Brief conflicts become questions, never fixes:** a real defect is always a
finding, even in a file or test the brief protects or where its fix would
reverse a fix verified earlier. A fixer that could only fix it by breaking a
brief clause or reversing such a fix, or whose finding says the brief
contradicts the repo, leaves the code, answers it `escalated` (status stays
`done`, not `blocked`) and returns a question with both options (default: keep
the current behaviour and tests). The next validator accepts that answer when
no fix keeps every clause. An accepted escalation never counts in
`findingsFixed`, and its ledger entry stays `open`. Fixers start each
escalation question with the finding id; for every accepted escalation that no
fixer question names, the script writes one from the finding and the fixer's
note, so each one reaches the user. Only a contradiction between the brief and the repo
itself (a premise the history disproves, or two clauses that cannot both hold)
goes straight into a validator's own `questions` (both workstream validators,
the whole-branch validator, each recheck). The fix validator sees the findings
verified in earlier cycles. The whole-branch validator and rechecks see the
fixes verified earlier in the run (`fixed` only, never a gate) and the
questions already with the user, which they never re-ask.
The fix validator and each recheck carry the brief and judge every fix against
its hard clauses: a fix that drops a mandated call, edits or deletes a
do-not-edit file, or deletes or weakens a test an earlier stage verified as
guarding a fix stays open as a regression unless the user answered a question
allowing it. The workstream reviewer is told the
author's notes and questions are not shown to it, so it never claims what they say.
**One workstream on an untouched base skips the seam review:** the merge
reports `preMergeSha` (the feature-branch tip its merge landed on) and
`baseAtMerge` (`origin/<base>` at that time). When a repo has exactly one
merged workstream and those two are the same SHA, there is no second
workstream to form a seam: the integrated review is skipped (`seams` says so)
and the whole-branch validator alone runs, with every section (hygiene, tests,
spec, the test guard, smoke) and any fix rounds. A `wholeBranch` re-run, a
merge result without both SHAs, or a feature branch that had moved past its
base always gets the integrated review.

**Gate wrapper:** every gate an agent runs goes through one fixed wrapper,
`bash -c '(set -eo pipefail\n<gate>\n); echo "gate exit=$?"'`, so a failure behind a
pipe or a `;` chain is red, and only `gate exit=0` is green. It is one command: a
pipe an agent appends (`| tail -8`) cannot replace the gate's exit code. A non-zero exit
whose every failure is allowed by the green rules (known-red, known-flaky, or
proven flaky by the rerun rule) is not red, but the wrapper stopped there, so the
agent runs each later command through the wrapper too and judges them all.
Nothing is pushed on a red gate.

**A gate that reads a shared file:** no workstream commits a shared file, so a
test that reads the README line a brief asks for would be red until the merge.
The author and the fixer make such a change in their worktree, never staged, so
their gate sees it, and return it in `sharedEdits`. A workstream validator whose
gate is red on a test that reads a shared file applies the listed edits
uncommitted in its throwaway worktree, reruns once and reports that run, with
"shared edits applied" in `gate.summary`; it undoes the edits before its trial
merge, which git would otherwise refuse when an earlier merge changed the same
file, and applies them again on the merged tree for that gate (the sentence is in its prompt only when
the repo has a hot list and the author returned edits). The merge applies the
edits for real and runs the full gate on the result before it pushes: that stays
the proof, and a red there is a rejected merge. A red gate is never `carried`: the
script neither hands a gate finding to the whole-branch pass nor settles it on
that answer, and it stays open until a validator's gate is green.

## Integration and merges

- **Integration fixes at the seams:** every workstream validator trial-merges
  `origin/<featureBranch>` (never committed) and runs the gate there too; a
  failure the merge introduces is a regression of kind `integration`. When a
  blocker can only be fixed in files owned by workstreams **already merged** into
  the feature branch, the fixer first merges `origin/<featureBranch>` into its
  branch and fixes those files too; it never touches files of workstreams not
  merged yet. The exception covers the merged siblings' code and the tests
  they added in this run, never a test that already exists on the run's
  base (`origin/<base>`) and that the brief does not name: that test stays
  read-only there too, and a blocker whose only fix is in one is `"carried"`
  (`blocked` with a question when the workstream has no `files[]`). The script keeps a run-wide record of who has merged (written
  inside the per-repo merge lock), names both groups in the fix prompt, and the
  merge backstop allows this workstream's `files[]` plus those of workstreams
  already merged at merge time.

**Merged is merged:** the merge step accepts a workstream branch that moved
past the validated head only through commits already on the feature branch
(the run's own integration-fix or shared-files commits), and a validated head
that is already an ancestor of the feature branch ("Already up to date") is
`merged: true`, never a failed merge.

## Changing workflow.js

`<skill dir>/tests/` is the regression suite: a mock `agent()` harness that runs the real
script. After any edit, run every check from `<skill dir>/tests/`:
`for f in check*.mjs; do node $f ../workflow.js; done` (each prints `... ok`), plus `node run-cmd.test.mjs` after any edit to `run-cmd.mjs`.
Add a scenario that fails before your change. `<skill dir>/tests/fixture-scenarios.md`
describes the live two-repo fixture eval (2026-10-29) for bigger changes.
