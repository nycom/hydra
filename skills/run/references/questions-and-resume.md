# Questions and resume: human checks, blocks, handed findings, the resumed call

Read before asking the user about a paused or blocked run, and before any
`resumeFromRunId` call.

## Args of a resumed call

```
  args: {
    humanChecks: { "api-auth": { sha: "<workstream head>", answer: "ok" } }, // only on the re-run after a humanCheck pause
    resume: "<id of the run being resumed>", // on every resumeFromRunId call: rebuilds workstream state from git
    decisions: { "api-auth": "edit the pinned test to half up" }, // only on the re-run after a block with a decision
    carryForward: <the resumed result's carryForward>, // on every resume, verbatim
  }
```

| arg | default | meaning |
|---|---|---|
| `humanChecks` | none | the user's answers on the re-run after a `humanCheck` pause: `{"<workstream id>": {sha, answer}}` or an array of those, one per check so far; `sha` = the workstream head the check was asked about (`humanCheck[].sha`, 7-40 hex; the feature-branch commit to look at is `humanCheck[].checkAt`), `answer` = `ok` (case and trailing punctuation ignored: `OK.`, `Ok!`) or the problem in words. An answer applies only to that workstream head, once, earliest first, so a re-merge with no new workstream commit keeps it however the feature tip moved. Keys must name a workstream with a `humanCheck`. The paused result's `humanCheck[].answer` gives the exact value to pass |
| `resume` | none | on every `resumeFromRunId` call: the id of the run being resumed. One read-only probe per repo (`<repo> state`, sonnet) reads git before any stage. Its prompt names that id, the call ordinal (`carryForward.call` + 1; every full-stage result's `carryForward` carries its own `call`) and a short digest of this call's `humanChecks`, `decisions` and `carryForward`, so each resume's probe is new and runs live, and every later call runs live too, a second resume of the same run included. Two calls with byte-identical args (a call that returned no result, re-run with the same `carryForward`) share a probe and replay; a resume without `carryForward` has no ordinal, so pass it on every resume. A workstream whose branch head is already an ancestor of the feature branch is carried `merged: true` with no agent of its own (dependents start, its human check binds to that head); any other workstream runs from implement, which continues its unmerged branch. A dead probe falls back to implement, which also reports an already-merged branch as success (`alreadyMerged`), never `blocked` |
| `decisions` | none | the user's answers to blocked workstreams' questions, on a re-run with `resumeFromRunId` and `resume`: `{"<workstream id>": "answer in words"}`. The answer is appended to that workstream's brief, so the same workstream resumes at implement and its validators' test guard accepts a pre-existing test edit the answer authorises (the author lists each as "authorised test edit: <path>"). The blocked result's `workstreams[].decision.answer` gives the exact value to pass |
| `carryForward` | none | on a resume (requires `resume`): the `carryForward` object of the result being resumed, passed back verbatim. It holds what git cannot say: per workstream the findings ledger (settled entries stay settled for the reviewers), the carried minors and the findings handed to the whole-branch pass; per repo the shared-edits findings and, for a repo whose whole-branch pass already passed, that result. Every full-stage result carries it, whatever its verdict (a whole-branch `fail` from an infra fault or the budget is resumable too). Restored ids get a `p:` prefix (`p:c1-F1`, `p:S-a-m1-F1`, whole-branch `a:p:c1-F1`), so a restarted review's or re-merge's new ids never collide with them. A `passed` entry must be a passed repo result (verdict `pass`, a 7-40 hex sha, its arrays), else the args check throws; a kept pass's ledger keeps the ids of the call that ran it, one `p:` fewer than the workstream ledgers of the call that keeps it. A handed finding that a whole-branch pass ending `pass` settled leaves `carryForward`, and a blocker still open when the resumed call stopped goes back to the restarted workstream's first review as a carried finding, which only a validator clears. Without `carryForward` a resume logs that nothing is restored and carries merged workstreams with empty ledgers, so a handed major or a shared-edits blocker would vanish into a `pass`. A kept pass is reused when the probe finds the feature branch still at its `sha` and no merge landed in this call; otherwise the pass runs again |
| `dropped` | none | workstream ids the user dropped (unknown ids throw; a workstream `after` a dropped one throws unless dropped too). A dropped workstream runs no agent and reads `status: "dropped"`, `dropped: true`; the rest merges and its repo's whole-branch pass runs without it (a repo whose every workstream is dropped stays `skipped`). Whole-branch and drift prompts leave its brief out and say it is not on the branch. Result: top-level `dropped: [ids]` and the repo note `not done (dropped): <ids>`. A dropped workstream the resume probe finds already merged is carried as merged, with an escalation that it stays on the branch. Its unmerged branch stays on the remote: delete it if unwanted |

- `resumeFromRunId` is for **crash recovery, human-check answers and block
  decisions**, always with `resume` = the id of the run being resumed. The
  cache replays only the longest unchanged prefix of agent calls; the `resume`
  probe is a new first call on every resume (it names the call ordinal from
  `carryForward` and a digest of the resume inputs), so the whole resumed run is live and its state
  comes from git, not from the cache: merged workstreams are carried and never
  re-implemented, a workstream whose agent died re-runs from implement on its
  branch instead of replaying the failure, and no whole-branch pass reports
  `pass` while a planned workstream is unmerged. Pass the resumed result's
  `carryForward` too (see the args table). The cost of a live resume: every
  stage not settled in git or in `carryForward` runs again. An unmerged
  workstream restarts at review c1 (its settled ledger comes back, so settled
  findings are not re-raised), and a repo's whole-branch pass runs again unless
  `carryForward` holds its passed result and its feature branch has not moved. Never resume after a hand fix
  to a workstream branch; re-run `stage: "wholeBranch"` instead. A `failed`
  infra escalation (the health probe failed) is resumable once auth or tool
  access is fixed.

## Pauses and blocks

**Human checks** (`workstreams[].humanCheck`): a check never holds a merge. Ask each through AskUserQuestion. If the `progress` tool's schema has `blocked`, set it to the pending question while you wait on the user outside AskUserQuestion (a by-eye check), and send the next call without it.
Every workstream of the repo merges; then the repo's whole-branch pass does not
run (`verdict: "paused"`) while any of its checks is unanswered, and contracts
and docs wait for every repo, so all of a repo's checks are asked in the one
pause after its last merge. The result carries `humanCheck: [{id, repo,
featureBranch, sha, checkAt, check, round, answer}]`: `sha` is the workstream's
own validated head (what the answer binds to), `checkAt` the feature-branch
commit to look at (a worktree on it; in local-only mode fetch `hydra-local`
first). Ask the user per `check`, then re-run with the same args plus
`humanChecks.<id>` set to the value `answer` spells out (`[{sha, answer: "ok"
or the problem}]`, earlier answers first), `resumeFromRunId` = the paused run,
`resume` = its id and `carryForward` = its `carryForward`. Between the pause and the resume change nothing but
`humanChecks`: no hand fixes, no brief edits. Hold the paused result's
`questions` and ask them with the final return's. A later call's repo note `… a
question from an earlier call under the "<ws id>: " tag that starts with <id>,
or any that starts with <ws id>:<id>, is settled` means the whole-branch pass
fixed that finding: drop a held question that starts with an id such a note
names, the bare `<id>` only under that workstream's tag. The resume's git probe
carries every merged workstream, so nothing is re-implemented and an answer
reaches its workstream without any replay. An answer binds to the workstream
head, never the feature tip: a re-merge with no new workstream commit, or a
tip moved by a sibling's merge, keeps it; a new commit is a new head and is
asked again. `round` counts the answers applied, across calls: at a call's
first check of a workstream, every answer before the last one bound to its head
counts as spent (all of them when none is bound to it, as on a new head), so a
carried head applies its latest answer, never a problem an earlier call fixed. A problem
becomes a critical (`H<round>-F1`, stage `human`) for that workstream's fix
path: fix, delta validation, a second merge (with its own shared-edits check,
ids `S-<id>-m2-…`), and a new check on the new head. Answers are used once
each, in order: a fix that leaves no new commit (answered or declined) keeps
the same head, and the user is asked again about it. If its fix never merges
(cap, budget, crash), the repo stays paused and its `sections` say why.

**Whole-branch pass only on a whole branch:** a repo with any planned
workstream unmerged gets no whole-branch pass (`verdict: "incomplete"`,
`sections` names them), and contracts, docs and the drift audit wait, as for
`paused`. Settle the unmerged workstreams, then re-run with `resumeFromRunId`,
`resume` and `carryForward`. `stage: "wholeBranch"` is unaffected.

**A block the user can answer resumes in place:** an author or fixer that
returns `blocked` with questions leaves `workstreams[].decision: {questions,
answer}`; ask the user through AskUserQuestion and re-run with `decisions.<id>` (see the args table),
`resumeFromRunId`, `resume` and `carryForward`: that same workstream resumes at implement on its
branch, never a new fix-up workstream. An author blocked only on an optional
sub-part, with every other part done, the gate green, the head pushed and each
question's default implemented, returns `blocked` with `ok: true`: the run
continues to review and merge with the defaults and carries the questions;
its `status` reads `done`, and a note says it continued on the default. Later
fixes see these optional questions while they are open, by id (`Q1`, … for the
workstream's fixers, `<id>:Q<n>` for the whole-branch fixer); one a fix acts on
(takes an option other than the default, or makes moot) it returns in
`settles`. The question leaves `questions`, with a note `fix c<n> settled the
open question: …` (or the whole-branch round's, in the repo's `notes`), only
once that fix is validated: its delta validator leaves nothing blocking, or the
whole-branch pass ends with its fixes promoted. Otherwise it stays open and the
next fixer sees it again. Escalations and validator questions are never
offered: they stay the user's. One exception needs no fixer: a question that
starts with the id of a handed finding (`<id>` or `<ws id>:<id>`) leaves
`questions` once the whole-branch pass fixed that finding (repo note
`whole-branch fix r<n> fixed <ws id>:<id>; dropped the question about it: …`).
That drop sees this call's questions only. For a finding handed in an earlier
call (a `p:` id) the repo note is `whole-branch fix r<n> fixed <ws
id>:p:<id>: a question from an earlier call under the "<ws id>: " tag that
starts with <id>, or any that starts with <ws id>:<id>, is settled`, and the
coordinator drops the question it held.
A question about it that does not start with the id stays, and so does one
about a file a brief names by path, directory or glob as not to be edited: the
handed rule spares that file, so its finding is escalated, not fixed (a clause
that names no path, directory or glob spares none). So does a
question a clean-review validator asks before any finding is carried: it names
no handed finding yet. A run that reuses a finding id across calls (an earlier
call's `c1-F1` and a new `c1-F1` in a later one) can make the earlier-call note
settle the wrong held question.

## Handed findings

**Fixes outside `files[]` go to the whole-branch pass:** when a workstream has
`files[]`, its fixer answers a critical or major whose only fix lies outside the
files it may edit (a pre-existing test, a file the integration-fix exception
does not give it, which includes any file before a sibling has merged)
`"carried"`, not blocked and not escalated: the fix prompt says so where it
offers `"carried"`, so it wins over the read-only rule's block and the
brief-conflict escalation for such a workstream.
Code in an already-merged sibling's files stays the fixer's through the
integration-fix exception, and so do the tests it added in this run, never a
test that already exists on the run's base. Read-only is judged against
`base`: a test already on the feature branch but not on `base` counts as added
in this run, so set `base` to the branch earlier work is on. Every workstream validator
also files an edit to such a base test that the brief does not name as a
major regression (a deletion or skip stays critical under the test-integrity
check), claimed or not:
for a workstream with `files[]`, any base test outside them; without
`files[]`, the base tests in merged siblings' files. The delta validator checks each claim against those
files; a claim it does not verify (silence included) goes back to the fixer
for another cycle, counted by the usual stop rules. A verified one leaves the workstream's cycles (ledger
status `carried`, listed in `workstreams[].handed`) and joins its repo's
whole-branch findings as `<ws id>:<id>`, where the whole-branch fixer fixes it
(its prompt says handed findings are its to fix in any file, pre-existing tests
included);
that fixer's notes list the files it changed (`changed: <path>`); carry the new
behaviour into every brief you write afterwards that reads one of them, in this
run's fix-ups, a later run or a later slice.
