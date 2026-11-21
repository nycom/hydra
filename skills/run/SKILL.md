---
name: run
description: Hydra (formerly "delegate"), a multi-repo delegation workflow — one feature branch per repo, decompose into max-parallel workstreams branched off it, then a saved Workflow script (workflow.js) implements each in an isolated worktree, runs review/fix/delta-validate cycles until no critical or major finding is open (named cycle count = floor), merges the validated SHA back to the feature branch with shared-file edits applied in order, runs a double whole-branch review, a cross-repo contract check and a validated docs sync. Coordinator (Fable) decomposes, sets up, briefs and makes the final call. Use when the user asks to implement with hydra or delegation, "in parallel", "spawn agents", "delegation run", "run this plan", or to execute a multi-repo/multi-workstream implementation plan.
---

# Hydra

**When NOT to use the workflow:** a single small fix or one bounded task → plain
subagents (one `implementer` + one `validator`), no feature branch ceremony. The
workflow pays off at 2+ workstreams or anything that needs review cycles.

Coordinator = Fable (this session): decompose, set up, brief, call the workflow,
make the final call. Subagents write code; the coordinator never does.
`workflow.js` (next to this file; `<skill dir>` below is this skill's base directory, printed when the skill loads) encodes everything mechanical: worktrees, gates,
push + `ls-remote` verification, SHA pinning between stages, review/fix/validate
cycles, merges, shared-file edits, whole-branch review, contract check, docs sync.
Every step runs as a typed agent: authors, fixers, merge, promote and docs as
`implementer` (merge, promote and docs are told they are no feature task: no
tests, no test-first, no self-review fix pass, nothing changed beyond their steps), reviewers as `reviewer`, validators and the contract
check as `validator`. An untyped step would start a far larger default context.

The ladder governs the run (the ponytail plugin, if installed, states the same rules): the plan is authored ladder-first (reuse > stdlib >
native > one line > minimum code; no speculative tasks); every review cycle hunts
over-engineering as hard as bugs.

**Cycle count is a per-run parameter.** If the user names a number ("2 cycles of
validation"), pass it as `cycles` — never ask for one. **Converged = no critical
or major finding left**: nothing blocking in the latest review *and* nothing
blocking left by the last validation. A converged review ends the loop early,
named count or not — re-reviewing unchanged code is waste. A named count is a
floor, not permission to merge dirty work: past it the workflow keeps cycling
while a critical **or major** is open and flags `extended`. Hard cap: N+2, or 4
when `cycles` is `null`; `maxCycles` overrides it. Minors never drive a cycle:
fixers may decline them, and leftovers are carried to the whole-branch pass:
its first validator settles (`fixed`) each one the final head resolves, the rest
ride into the fix round. Workstream validators are told which files are shared
and that their edits land at the merge, so a brief criterion on a shared file is
met by the author's `sharedEdits`; only an edit missing from that list is a
finding. A converged review of a head no validator has seen yet (typically a clean
cycle 1) gets one validator pass before it can merge; if that validator finds a
critical or major, the same cycle goes straight to the fix. A blocker that
survives two fix rounds (same id, or same `where`) gets its next fix on opus
with the earlier attempts in the prompt; if it survives that too, it becomes a
`questions` entry and the workstream stops, NOT merged — never another patch,
and never fable inside the workflow. A merge the merge agent rejects goes back
to its author once (if the cap and reserve allow): its notes become an
`integration` critical, one fix cycle (no re-review of the unchanged head) and a
delta validation, then it requeues behind the repo's merge lock.

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
repo fails with an escalation naming the side branch. Docs run only on a repo
whose whole-branch pass did not fail, and only from the SHA that pass validated.
`finalSha` is always a validated SHA. Workstream branches may not be named
`<featureBranch>--docs` or `<featureBranch>--wbfix<n>` (the script throws).
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
whole-branch validator, each recheck, and the docs validator when the repo has
a gate), a report whose `command` is empty, or whose `command` or `summary`
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

**Global rules the workflow enforces and you must too:** no AI attribution
anywhere (no Co-Authored-By, no generated-with footers, no Claude mention, no
`.claude/` paths in committed text or PR bodies) — everything is authored as
the user; hygiene checks cover only commits this run authored, never teammates'. A
hit in a run-authored commit is critical, and a pushing agent that finds one
doesn't push.
Never checkout-switch the user's checkouts. PRs stay open: never merge to `main`;
merge is the user's call. No deploys, no ssh or rsync to hosts, no cloud or
prod actions, no `gh run rerun`. Plans stay local until the user approves them.
Implementation is never below Sonnet.

## 1. Decompose

- **Plan review first:** one read-only `general-purpose` agent on `fable` (not
  the generic `architect-reviewer`). Brief it with the plan, the touched repos and
  only these risks: (1) file-set overlap between workstreams and hot files any of
  them would touch; (2) boundary and coupling; (3) cross-repo contracts and the
  merge order they force (contract owner lands first, re-vendor + digest steps);
  (4) YAGNI — tasks or options nobody asked for; (5) facts read from a
  sibling checkout instead of `git show origin/main:<path>`; (6) stacked runs
  only: every slice has a `Ships:` line, a smoke or the reason it has none,
  depends on the slice below (else make it a workstream), and keeps the full
  gate green at its own SHA; no numeric size target. Read-only: no edits,
  no commits, never push the plan. Output: findings with severity and
  plan-section. Fold accepted findings into the plan; unresolvable ones go to
  the user's end-of-run list.
- **UI without a design spec:** spawn `designer` (opus) first; its tokens +
  handoff notes go verbatim into the affected briefs.
- Split into **as many workstreams as parallel work allows** — the only bound is
  overlap: never two workstreams editing the same files. A repo may host several
  workstreams if their file sets are disjoint. Pass each set as `files[]`: the
  script rejects overlapping sets in one repo up front, and the merge rejects a
  branch that edited outside its set. Give every workstream a `files[]` when any
  has one: the integration rule below can only name files that were declared.
- **Integration fixes at the seams:** every workstream validator trial-merges
  `origin/<featureBranch>` (never committed) and runs the gate there too; a
  failure the merge introduces is a regression of kind `integration`. When a
  blocker can only be fixed in files owned by workstreams **already merged** into
  the feature branch, the fixer first merges `origin/<featureBranch>` into its
  branch and fixes those files too; it never touches files of workstreams not
  merged yet. The script keeps a run-wide record of who has merged (written
  inside the per-repo merge lock), names both groups in the fix prompt, and the
  merge backstop allows this workstream's `files[]` plus those of workstreams
  already merged at merge time.
- **Ordering inside a repo:** when a workstream needs another's merged code
  (not just its contract), give it `after: [ids]` instead of folding them into
  one; it starts once those merged and branches from that head. Across repos,
  order by separate runs: `after` is same-repo only.
- **Hot files belong to no workstream:** README/docs, changelogs, generated files
  (lockfiles, OpenAPI types, graphify-out), contracts and digests. Workstreams
  return the change they need as `sharedEdits: [{file, intent}]` (each fixer
  returns the complete current list, which replaces the earlier one); the merge
  agent, inside the per-repo merge lock, applies each workstream's edits on the
  current feature-branch tip right after merging its code, then reruns the repo's
  `regen` recipe. The `git diff --name-only` hot-file check stays as the backstop
  and abort-on-conflict stays.
- **Model per workstream, always explicit:** `sonnet` for routine/bounded work,
  `opus` for complex work (multi-file features, concurrency, tricky contracts).
  Never below Sonnet. Fable implements only in VERY complex cases — and then
  outside the workflow. Reviews run one tier above the author (sonnet → opus,
  opus → fable; `reviewModel` overrides per workstream). Validators stay on opus.
- **Heuristic-heavy builds** (language matching, guards, classifiers): before
  Run 1, write a case table, the field inputs plus about 40 negatives, each
  mapped to its expected action; the user approves it during grilling and it
  goes in as `acceptance`. Put the `stopRule` in the first brief. Freeze scope
  after grilling: a new ask mid-run becomes a parked follow-up unless it is a
  regression. Slice the ship, so the smallest user-facing fix ships the same
  day. Prefer structural signals (did the tool call succeed?) over parsing
  model text; where text must be read, use one predicate with one owner.

## 2. Set up

- **Preflight, per touched repo:** add `.claude/worktrees/` to
  `.git/info/exclude` (local; never a committed ignore line), run
  `git worktree prune`, and record the **known-red baseline**: run the full gate
  once at the feature-branch base in a throwaway worktree (one sonnet agent per
  repo) and pass the exact failing test ids as `knownRed`. Optional: a local
  `.git/hooks/pre-push` running the hygiene grep
  (`grep -iE 'co-authored-by|generated with|\bclaude\b|anthropic|\.claude/'`)
  over the user's own outgoing commits. For each `copyExcluded` path:
  `git -C <repo> check-ignore -v <path>` must name an ignore source and the
  file must exist in the user's checkout; otherwise drop it (agents refuse it
  too).
- **Run-local script:** copy `<skill dir>/workflow.js` into the run's working
  folder (`<run dir>`) once at the start and pass that copy as `scriptPath`.
  The Workflow tool refuses plugin and skills paths, and the copy pins the
  version for every re-run. No plugin upgrades mid-run.
- The known-red baseline agent also reports the full gate's wall time;
  over 2 min with no `quickGate`, propose one to the user before the run.
- When `acceptance` or `decisionLog` is used, check the files exist (absolute
  paths). A missing `acceptance` file is a critical finding from validators and
  `blocked` for authors and fixers (reviewers get no instruction for it); a
  missing `decisionLog` is critical, or `blocked` for authors and fixers.
- One **feature branch per touched repo** (e.g. `feat/<topic>`), cut from
  `origin/main` (or the stacked `base`) with `git branch` + `git push origin <branch>` (`hydra-local` in local-only mode) — never
  checkout-switch. Every workstream branches off it and merges back into it.
- Docs-only repos that need updates (e.g. `design-docs`) get a feature branch
  too and go in `docsRepos`.
- Write each brief: goal, exact file set (and what's off-limits), acceptance
  criteria, contracts with other workstreams/repos, which shared files it
  will need to change (as intents), and any pre-existing tests, snapshots or
  test-runner config the workstream is expected to change, delete or rename.
  The workflow adds the git, gate, hygiene, hard-rule, shared-file and ladder
  rules — don't repeat them.

## 3. Run the workflow

**Stale-task sweep:** right before the Workflow call, `CronCreate` with
`*/15 * * * *` and prompt `python3 <skill dir>/stale_sweep.py`.
When the workflow returns — success or failure — `CronDelete` it. The sweep
SIGTERMs (never SIGKILLs) self-matching `pgrep -f` wait loops and orphaned
runners; it only reports owned runners older than 3 h. Fine print: session
crons fire only while the session is idle and expire after 7 days, and the
sweep has only ever killed the fakes in its `--self-test`, never a real stuck loop.

```
Workflow({
  scriptPath: "<run dir>/workflow.js",
  args: {
    skillDir: "<skill dir>",         // absolute; required when any repo has smoke or any workstream has checks
    cycles: 2,                       // or null = converge; a named count is a floor
    maxCycles: 4,                    // optional hard cap; default cycles+2, or 4 when cycles is null
    tokenBudget: 3000000,            // optional; output tokens this run may spend (budget.spent())
    tokenReserve: 600000,            // optional; default 600000
    stopRule: "wrong output for a listed case, lost user data, a crash", // optional; the wrong actions, as one string
    acceptance: "<run dir>/cases.md",       // optional; absolute path to the approved case table
    decisionLog: "<run dir>/decisions.md",  // optional; absolute path; binding for every agent, turns on the drift audit
    wbReviewModel: "opus",           // optional; sonnet | opus | fable; integrated whole-branch review only
    localOnly: false,                // optional; true = nothing reaches the network (see Local-only mode)
    humanChecks: { "api-auth": { sha: "<checked sha>", answer: "ok" } }, // only on the re-run after a humanCheck pause
    workstreams: [
      { id: "api-auth", repo: "~/code/api", featureBranch: "feat/auth",
        branch: "feat/auth--api-auth", model: "opus",
        base: "feat/x",              // base: 'feat/x' for a stacked feature branch; default main
        files: ["src/auth/", "test/auth/"],   // optional; dir/ or dir/** or exact paths
        reviewModel: "fable",        // optional; default one tier above model
        checks: ["npm run e2e:login"], // optional; extra commands run under a 540 s cap, red = critical
        quickGate: "npm run test:unit", // optional; author/fixer pre-push gate and reviewer probes; validators, merge, whole-branch and docs keep the full gate
        humanCheck: "open the login page preview; the error banner is red", // optional; the run pauses after this merges until the user answers
        brief: "…", gate: "npm run lint && npm run typecheck && npm test && npx playwright test" },
      { id: "api-docs-cli", repo: "~/code/api", featureBranch: "feat/auth",
        branch: "feat/auth--api-docs-cli", model: "sonnet",
        after: ["api-auth"],         // optional; starts once api-auth merged, from that head (same repo only)
        lite: true,                  // optional; implement + one validator, no review cycles
        brief: "…", gate: "…" },
      { id: "ui-login", repo: "~/code/ui", featureBranch: "feat/auth",
        branch: "feat/auth--ui-login", model: "sonnet", brief: "…", gate: "…" }
    ],
    repos: [                         // optional per-repo settings
      { repo: "~/code/api",
        knownRed: ["tests/test_openapi_sync.py::test_sync"],
        hot: ["**/README*", "docs/**", "openapi/**", "src/generated/**", "**/package-lock.json"],
        regen: "npm install && npm run gen:types",
        smoke: "env -i PATH=$PATH ./scripts/boot-local.sh --h2",
        smokeTimeout: 300,           // optional; seconds, default 540
        copyExcluded: ["tests/preview.spec.ts"], // optional; git-excluded files copied into every agent worktree
        reviewSharedEdits: true }    // optional; gate + validator on each merge's shared-file commits
    ],
    docsRepos: [                     // optional; default = every touched repo; base defaults to the repo's workstream base, else main
      { repo: "~/code/api", featureBranch: "feat/auth" },
      { repo: "~/code/ui", featureBranch: "feat/auth" },
      { repo: "~/code/design-docs", featureBranch: "feat/auth", gate: "npm run test:design-docs" }
    ]
  }
})
```

| arg | default | meaning |
|---|---|---|
| `cycles` | `null` | floor on review cycles; `null` = run to convergence |
| `maxCycles` | `cycles + 2`, or 4 | hard cap on cycles per workstream (must be ≥ `cycles`) |
| `skillDir` | none | this skill's absolute base directory (the `<skill dir>` printed when the skill loads); the script can't learn its own path, and agents run `node <skillDir>/run-cmd.mjs <seconds> '<command>'` for smoke and checks. Required when any repo has `smoke` or any workstream has `checks` |
| `stage` | omitted | `"wholeBranch"`: skip implement/cycles/merge; re-run whole-branch review + validator, contract check, docs sync on the current feature-branch tips |
| `wbRounds` | `2` | whole-branch fix rounds, each pushed to a side branch `<featureBranch>--wbfix<round>` and promoted onto the feature branch only after a passing recheck; `0` = no fix rounds (findings returned unfixed; the repo verdict is `fail` while any is critical or major); pair with `docsRepos: []` for a review-only pass (a failing repo skips docs regardless) |
| `stopRule` | none | non-empty string naming the wrong actions. A blocker is a regression vs the base or one of these; a miss the base also has is a known gap and minor. It reshapes the severity text for every reviewer and validator, and fixers decline known gaps |
| `acceptance` | none | absolute path to the approved case table. Validators run each row this change touches black-box at their sha; reviewers block only on a broken row or a regression vs the base, and a failing row blocks even when the base fails it. Security, data loss and a red gate stay critical. A missing file is a critical finding from validators and `blocked` for authors and fixers; reviewers get no missing-file instruction |
| `decisionLog` | none | absolute path to the log of the user's answers; binding for every agent through the hard rules (a missing file is critical, or `blocked` for authors and fixers). Setting it also turns on the drift audit: one read-only `fable` agent after the repos are final, skipped when nothing shipped, during a `humanCheck` pause, or when the token reserve is short. Result `drift: {verdict: pass\|drift\|died\|skipped, items: [{repo, where, change}]}`; each item becomes a revert-by-default question |
| `wbReviewModel` | repo's highest `reviewModel` | `sonnet`, `opus` or `fable`; overrides only the integrated whole-branch review model, not the workstream reviews |
| `tokenBudget` | `null` | output-token cap for this run; the user's "+Nk" turn target also applies. Spend is counted from the script's start, so a `resumeFromRunId` crash recovery starts a fresh `tokenBudget` |
| `tokenReserve` | `600000` | before each new cycle, each whole-branch fix round, the contract check and docs: if less than this is left, nothing new starts; the item is reported not merged / failed with the reason |
| `localOnly` | `false` | every fetch, push and `ls-remote` targets the remote `hydra-local`, a bare repo on local disk you set up (see Local-only mode); agents are told never to touch `origin` or any other remote and to run no `gh`; every hygiene section also checks that no run branch has a remote-tracking ref on any other remote; the docs step skips its PR-body update |
| `humanChecks` | none | the user's answers on the re-run after a `humanCheck` pause: `{"<workstream id>": {sha, answer}}` or an array of those, one per check so far; `sha` = the commit the user checked (7-40 hex), `answer` = `ok` (case and trailing punctuation ignored: `OK.`, `Ok!`) or the problem in words. An answer applies only to a merge with that sha. Keys must name a workstream with a `humanCheck`. The paused result's `humanCheck[].answer` gives the exact value to pass |
| `workstreams[].after` | none | workstream ids (same repo only; unknown ids, itself and cycles throw) that must merge into the feature branch before this one starts implementing; it branches from the head that carries them. A predecessor that does not merge leaves it NOT started. Workstreams without `after` run in parallel as before |
| `workstreams[].lite` | `false` | for small pure files: implement, then the clean-review validator alone (acceptance tests, full-range test guard, gate, trial merge); no reviewer ever runs. A critical or major it files gets a fix and a delta validation per cycle, capped by `maxCycles` as usual. Still merged, and covered by the whole-branch pass. A lite workstream alone on its untouched base gets no reviewer at all: the integrated review is skipped too, so only validators see it |
| `workstreams[].humanCheck` | none | instructions for the user's by-eye check. After this workstream merges, every later merge of its repo and the repo's whole-branch pass wait for the answer (see Human checks) |
| `workstreams[].files` | none | allowed paths; overlap within a repo throws; merge rejects edits outside |
| `workstreams[].checks` | none | extra commands (an e2e login, a contract probe) the author, fixer and both workstream validators run via `run-cmd.mjs` with a 540 s cap, reporting the exit code per command; a red or timed-out check is critical. The `gate` itself never gets a deadline |
| `workstreams[].quickGate` | none | a faster gate the author and fixer run before each push, and reviewers use for probes. The full `gate` stays mandatory for both workstream validators, the merge, whole-branch fix rounds and rechecks, and docs |
| `workstreams[].reviewModel` | sonnet→`opus`, opus→`fable` | review model; whole-branch review uses the repo's highest unless `wbReviewModel` is set |
| `repos[].knownRed` | `[]` | exact test ids red at the base; any other failure is red |
| `repos[].hot` | README*, CHANGELOG*, `docs/**`, `graphify-out/**`, lockfiles, `openapi*.{yaml,yml,json}`, `*.sha256` | replaces the default hot list for that repo — add generated-type and contract paths here; `[]` turns the hot-file rule off for repos whose workstreams legitimately edit docs (the `files[]` check still applies) |
| `repos[].regen` | none | regenerates generated files: run by every agent that runs the gate on a workstream SHA (author, fixer, reviewer, validators; its diffs are never findings or commits), after each merge, and after whole-branch fixes. Set it whenever workstreams can touch dependencies or vendored contracts, or their gates go red on stale generated files |
| `repos[].smoke` | none | the safe local boot recipe the whole-branch validator and each whole-branch recheck run via `run-cmd.mjs` (own process group, hard timeout, leftover processes killed); a failed or timed-out smoke is critical; none = smoke skipped |
| `repos[].smokeTimeout` | `540` | smoke hard cap in seconds, an integer from 1 to 590 (stays under the agent shell's 600 s foreground limit) |
| `repos[].copyExcluded` | `[]` | paths inside the repo, git-ignored (e.g. in `.git/info/exclude`), that the gate needs, such as a local preview test. Every agent copies them from the user's checkout into each worktree it creates, before any gate, only after `git check-ignore` confirms they are ignored; absolute paths, `~` and `..` throw. Hygiene checks no commit carries them |
| `repos[].reviewSharedEdits` | `false` | after a merge that applied shared-file edits, one opus `validator` checks exactly those commits (each edit against its intent, the gate, hygiene) inside the merge lock, so before the next merge lands; its findings (and a red gate) join the repo's whole-branch fix rounds. Opt-in, not automatic: defaults stay as before, and it costs one opus agent per such merge while the whole-branch validator already reruns every suite. Turn it on when shared edits are code-like (generated clients, lockfiles, contract digests) |
| `docsRepos[].gate` | the repo's workstream gates | gate for a docs-only repo |

`gate` is the repo's **full** gate — every suite it defines including
Playwright/e2e, not just `test`. Pass `args` as a JSON object, not a string.
Repo paths are normalized (trailing slashes stripped).

**Size:** agents ≈ per workstream (implement + 1 review per cycle + fix and
validate per cycle with critical/major findings + 1 validator when a clean
review lands on an unvalidated head + merge; a rejected merge that returns to its
author adds fix + validate + merge, +3 once the named cycle count is reached, +4
otherwise and in converge mode, where a review of the fixed head follows) + per repo (2, +2 per whole-branch fix round, max `wbRounds`
rounds, +1 promote when a round pushed) + 1 contract check when 2+ repos + per
docs repo (1, +1 validator when it pushed, +1 promote when that passed); a repo whose one workstream merged onto its untouched base starts at 1, not 2. Every
dead agent can add up to 2 replacements; a push step that reports done without a full 40-hex SHA gets a cheap repair call instead (it keeps the result and only re-reads the SHA). One workstream with a clean cycle 1 is
~9 (~8 when it merged onto its untouched base and the integrated review is skipped); two workstreams × 2 cycles is ~21.
A `lite` workstream drops the reviewer from every cycle: clean, it is implement + 1 validator + merge (3 agents instead of 4, and
the dropped one is the review a tier above the author, opus or fable); each blocker its validator files adds fix + delta validate (2, not 3+:
no review of the fixed head). `reviewSharedEdits` adds 1 opus validator per merge that applied shared edits. The
runtime runs at most min(16, CPUs−2) agents at once and caps a run at 1000
`agent()` calls (cached replays count).

**Time estimate:** wall time ≈ the longest workstream chain + the whole-branch
pass. Each agent on the chain ≈ its gate minutes (validators run new tests 3×)
+ ~5 min of agent time. One whole-branch pass measured 50-68 min with 13-15
agents on 3-5 min gates. Estimate ×3 when the exit is "no reviewer finds a
major" on language or heuristic rules.

**Progress panel** (when `mcp__savvy-progress__*` exists; skip silently
otherwise): before the call, `progress` with `title`, `total` = workstreams,
`phase: "delegate"` (its enum is plan | design | delegate | review | close), one task per workstream id (`tier`: `careful` for opus,
`medium` for sonnet). The workflow's own progress tree shows per-agent detail.
After it returns: `done` = merged workstreams, `phase: "close"`, then
`finished: true` (after a `humanCheck` pause, keep `phase: "delegate"` and
leave it unfinished until the resumed run returns).

**Local-only mode** (`localOnly: true`, e.g. a public fork whose pushes the
user approves by hand): nothing reaches the network. Per touched repo
(docs-only repos included), before the known-red preflight, first run the
no-network check below and stop if it prints anything (a run branch already
pushed by hand would trip every hygiene section); then
`B="$(git -C <repo> rev-parse --path-format=absolute --git-common-dir)/hydra-local.git"`,
`git init --bare -q "$B"`, `git -C <repo> remote add hydra-local "$B"`, then
push the base and the feature branch into it
(`git -C <repo> push hydra-local <base ref>:refs/heads/<base> <featureBranch>:refs/heads/<featureBranch>`)
and `git -C <repo> fetch hydra-local`. Every push, fetch and `ls-remote` in
the run then works unchanged against that local remote. At the end, verify
with `git -C <repo> ls-remote hydra-local` as usual, then fetch the branches
back as local branches without force:
`git -C <repo> fetch hydra-local <featureBranch>:<featureBranch>` plus each
workstream branch and any side branch the result names (a branch checked out
in the user's checkout is refused: tell the user to fast-forward it), and
check `git -C <repo> rev-parse <featureBranch>` equals `finalSha`. Also run the
no-network check yourself: `git -C <repo> for-each-ref --format='%(refname)' 'refs/remotes/*/<featureBranch>' 'refs/remotes/*/<featureBranch>--*'`
plus each workstream branch, filtered with `grep -v '^refs/remotes/hydra-local/'`,
prints nothing. It reads remote-tracking refs, so a push by URL (no
configured remote) leaves none and is invisible to it. Pushing to `origin` stays the
user's step; remove `hydra-local` (`git remote remove`, then the bare repo)
only when they are done with it.

**Human checks** (`workstreams[].humanCheck`): after that workstream
merges, every later merge of its repo waits (the others keep cycling and stop
at their merge, NOT merged, "awaiting the user's human check"), its repo's
whole-branch pass does not run (`verdict: "paused"`), and contracts and docs
wait for every repo. The result carries `humanCheck: [{id, repo,
featureBranch, sha, check, round, answer}]`: ask the user to check `sha` (a
worktree on it; in local-only mode fetch `hydra-local` first) per `check`, then
re-run with the same args plus `humanChecks.<id>` set to the value `answer`
spells out (`[{sha, answer: "ok" or the problem}]`, earlier answers first) and
`resumeFromRunId` = the paused run. Between the pause and the resume change
nothing but `humanChecks`: no hand fixes, no brief edits. Hold the paused
result's `questions` and ask them with the final return's; never write their
answers into a brief mid-pause, since that changes the prompts. No prompt before the check
depends on `humanChecks`, so cached agents usually replay up to it, but
timing-dependent prompts (the fix prompt's list of merged workstreams, the
flaky registry) can miss the cache and run live. Each answer is bound to its
sha, so a live re-run that pushes a new commit never inherits the old answer:
it just pauses again on the new sha. A problem becomes a critical
(`H<round>-F1`, stage `human`) for that workstream's fix path: fix, delta
validation, a second merge (with its own shared-edits check, ids
`S-<id>-m2-…`), and a new check on the new sha, with later merges still held.
Answers are used in order, one per check: a fix that leaves no new commit
(answered or declined, the re-merge "Already up to date") lands on the same
sha, and the user is asked again about it; the spent answer is never reused.
If its fix never merges (cap, budget, crash), the held merges and the
whole-branch pass stay stopped and the escalation says so.

## 4. Final call (coordinator)

The workflow returns:

- top level: `{stage, budget, cycles, maxCycles, questions, workstreams, repos, crossRepo, otherDocs}`, plus `humanCheck` only when the run paused for one (see Human checks);
  `questions` collects every question of the run: first one entry when `crossRepo` has an open critical or major,
  whatever its verdict says (contracts have no fix loop, so it carries the contract
  check's recipe, its `sections`, else the findings' issues, and the user decides),
  then each workstream's and each repo's `questions`, with `q` prefixed `<workstream id>: ` or `<repo name>: `
- `budget`: `{spent, tokenBudget, turnTotal, reserve, stoppedBy}`. `spent` is the
  output tokens this run spent since its own start; `turnTotal` is the user's
  "+Nk" target or `null`; `stoppedBy` lists what the reserve kept from starting
  (e.g. `alpha-cents cycle 3`, `api whole-branch fix round 2`, `contracts`)
- per workstream: `{id, branch, status, sha, validatedSha, cyclesRun, extended,
  findingsFixed, open, sharedEdits, questions, notes, escalations, tests,
  gateTail, merged, preMergeSha, baseAtMerge, evidence, findings}` (empty list in `wholeBranch` stage);
  `evidence` maps each workstream validator step (`validate c1`, `validate c1 delta`, …) to the
  commands it says it ran per step
- per repo: `{repo, featureBranch, sha, verdict, sections, seams, tests, fixRounds,
  open, questions, notes, escalations, findings, docs, finalSha, flaky, churn}`; `churn` =
  `[{round, files}]`, one entry per whole-branch round that brought a new regression-kind
  blocker in a file that round's fixer was asked to fix; two consecutive such rounds stop
  that repo's fix rounds and fail its whole-branch pass with a heuristic churn question
  (other repos, the contract check and the drift audit still run). `sha` and
  `finalSha` are always validated SHAs on the feature branch (unpromoted
  whole-branch fixes or docs stay on their side branch, named in `escalations`);
  `notes` also lists what a successful promote left undone (e.g. a side-branch
  delete that was denied; for a docs-only repo, in `otherDocs[].docs.notes`):
  delete those refs yourself;
  `flaky` = the run-wide flaky registry for that repo; `seams` = the
  whole-branch reviewer's seam inventory, one line per place a workstream's
  changed signature, field, config key, default, enum value or error shape is
  used by another workstream; `docs` =
  `{sha, files, prBody, ok, tests, notes, verdict, findings}` (`sha` = the
  docs commit on `<featureBranch>--docs`; it becomes `finalSha` only when
  validated and promoted); a failed docs validation or promotion fails the
  repo and names the unpromoted docs commit on `<featureBranch>--docs` in
  `escalations` and `docs.notes`; so does a docs agent that died 3 times (plus
  an escalation). Docs are skipped (`docs.notes`: `skipped: …`) when the repo's
  whole-branch pass failed
- `drift`: `{verdict: pass|drift|died|skipped, items: [{repo, where, change}]}`,
  always present (`{verdict: 'skipped', items: []}` without `decisionLog`; see its args row); each item is also a question, revert by default
- `crossRepo`: `{verdict, sections, findings, ledger}` when 2+ repos, else `null`
- `otherDocs`: `[{repo, featureBranch, docs, findings, flaky}]` for docs-only repos
- `findings` (and `crossRepo.ledger`): the structured ledger next to the
  one-line `open` strings, `[{id, stage, severity, kind, where, issue, status}]`.
  `stage` is the first to raise the id (`review`, `validate`, `merge`, `human` per
  workstream; `wb-review`, `wb-validate`, `shared-edits`, `recheck`, `docs` per repo, where a
  carried workstream minor is `<ws id>:<id>` with its original stage;
  `contract`); `status` is `fixed`, `answered` or `declined` once a validator
  accepted it, else `open`. `open` in the ledger means no validator accepted
  it; it may be absent from `open` (a minor nobody re-raised, or an escalation
  awaiting the user). Count a carried minor once.

`questions` (`{q, options, default}`) are only what the user must decide; `notes`
are deviations and things not run; `escalations` are what the script itself
saw go wrong (dead agents after 2 replacements, a validator that never ran its gate in 3 attempts, a push step that "returned no usable result 3 times (died or malformed sha); check origin/<branch> for an unvalidated push", SHA mismatches between agents,
cap or budget stops, failed merges, a finding that survived its opus fix — each
says NOT merged; unpromoted side branches). Then:

- `git ls-remote` every returned `finalSha` against its feature branch before
  believing it.
- Read it; spot-check anything `open`, `extended`, unmerged, a non-`pass`
  verdict, `docs.ok: false`, or a `crossRepo` finding against the code (and the
  docs diffs — docs must describe what shipped, including every review-round
  fix). Fix-ups go to a fresh `implementer`, never to you (in local-only mode it pushes to `hydra-local` only and never touches `origin`). Before any re-run,
  write the user's answer to each question into the affected brief: the brief is
  the only channel by which a validator learns that "the user answered" allows a
  change. **Every fix-up is then
  validated and docs-synced:** re-run the workflow with `stage: "wholeBranch"`
  (same args, narrowed to the affected repos' workstreams). After an
  unpromoted failure, the fix-up implementer continues from the side branch the
  `escalations` name (`<featureBranch>--wbfix<n>` or `<featureBranch>--docs`) and
  pushes to the feature branch before that re-run; afterwards delete the stale
  `--wbfix*`/`--docs` refs. An unmerged workstream is yours to settle; no agent
  merges it off-book.
- `resumeFromRunId` is **crash recovery and human-check resumes only**: it
  replays cached results for identical prompts, so after any hand fix it
  returns the old verdicts on old SHAs and validates nothing. A human-check
  re-run is the one planned use: nothing was changed by hand, and the answer
  only enters prompts after the check (a cache miss there re-runs live and, if
  it pushes a new commit, pauses again on the new sha). Never resume after a hand fix; re-run
  `stage: "wholeBranch"` instead. Gate prompts list the run-wide flaky registry, so
  a replay can see a different registry, run those agents live and end in a
  false "not promoted" fail: safe (nothing unvalidated lands), but re-check it.
- **Batch fix-ups:** collect the decisions, run one fix-up per repo, then one
  `stage: "wholeBranch"` run, never one pass per fix-up. Append every answered
  question to the `decisionLog`, and check each new brief against it before
  sending it.
- **Cross-run churn:** if two consecutive `wholeBranch` runs return a non-empty
  `churn` for the same repo, ask the heuristic churn question (the rules are
  likely the wrong shape, not the code) before another run.
- **Drift items:** revert by default; keep one only on the user's word, then
  log it.
- **Known-gaps promote:** when the rounds run out with the last recheck green
  and only non-regression, non-critical majors open, a question offers to
  fast-forward the feature branch to the checked head; the default is leave
  unpromoted. If the user picks it: `git push origin <sha>:refs/heads/<featureBranch>`
  (`hydra-local` in local-only mode; explicit refspec, no force), verify with
  `ls-remote`, park the open majors, re-run `stage: "wholeBranch"` for that repo
  (it re-validates, docs-syncs and drift-audits the promoted head), and delete the
  stale `<featureBranch>--wbfix*` refs.
- **Reviewer tiering:** intermediate `wholeBranch` passes run with
  `wbReviewModel: "opus"`; the top reviewer runs only on the final pass, the one expected to close with no majors left.
- Escalate to the user **only** the top-level `questions` (it already holds every workstream and repo question; plus anything else code, spec or
  plan can't resolve) — collected and asked **once**, at the end; the retro's
  ranked list (§5) joins that same ask, after the questions.

## 5. Finish

- Feature branches green and verified on the remote; update the plan doc status
  (phases done, debt carried); docs sync done per repo.
- Run `python3 <skill dir>/stale_sweep.py --dry-run`; if it lists
  stuck wait loops or orphaned runners in agent worktrees, run it again without
  `--dry-run`.
- Open the PR only where the repo's process says PRs, and never in local-only mode (the branches are local; pushing and the PR are the user's); otherwise report PR-ready
  state per repo: branches, SHAs, test results, unresolved questions. PRs stay
  open — a human merges to `main`, especially where merge deploys.
- **Retrospective (mandatory), one retro per run:** at Finish, success or
  failure, spawn one read-only `general-purpose` agent on `opus`. Brief it with
  every Workflow return's result JSON from this run in order (the first call
  plus each `stage: "wholeBranch"` re-run), the run args, the feature-branch
  SHAs you already verified, `<skill dir>/retro.md` and, optionally, each launch
  result's `<Transcript dir>/journal.jsonl` (per-agent label, phase and result;
  an agent with a `failed` row died, one `started` with no `result` or `failed`
  row never finished). Tokens are not in the journal: run cost comes from
  `node <skill dir>/cost.mjs <Transcript dir>`; never read the transcripts. A Workflow call that threw gets its error text,
  the results that exist and that journal; a `resumeFromRunId` recovery gets
  its one retro after it returns. It returns retro.md filled in; you save it.
  Eval runs (fixture repos) → `evals/retros/<run id>.md`, the id of its
  `evals/runs/<run id>.json`, in a git clone of nycom/hydra (never the plugin
  cache; ask the user where the clone is if unknown), committed through the
  normal PR flow. Real runs, and any run you are unsure about (treat it as
  real) → the user's private notes location (named in their global
  instructions or memory; ask once if none is set), never inside any git repo.
  Version: `<skill dir>/../../.claude-plugin/plugin.json`.
- **Retro privacy:** everything bound for the public hydra repo (retros,
  changes, eval seeds, PR titles, bodies, branch names, commit messages) is
  generalised: no project, repo, person or host names, no local filesystem
  paths, branch names, URLs, secrets or env values (`gateTail` and `notes` may
  hold them), no code copied from private repos. Names defined in
  skills/run/tests/fixture-scenarios.md and skills/run/tests/fixture/ (fixture
  repos, branches, workstream ids) are public and exempt. Before committing
  there, grep the staged diff and the PR text for the run's other repo paths,
  `featureBranch` names and workstream ids, and the expanded `$HOME` value
  (`echo "$HOME"`); any hit means don't push.
- **Retro follow-up:** merge its Changes and Eval gaps into one ranked list, put
  to the user in AskUserQuestion batches after the run's `questions`. Nothing is
  applied without the user's OK. Approved hydra changes become PRs reviewed
  until clean; approved eval gaps become seeds or scenarios in
  `tests/fixture-scenarios.md` plus updates to the builder,
  `skills/run/tests/fixture/build.sh`.

## Stacked mode (only when the user asks)

Default stays one feature branch per repo; stack slices only on the user's ask.

- **A slice is one ordinary run:** `featureBranch` = the slice, `base` = its
  parent slice (`main` for slice 1). Slices run strictly in sequence: cut slice
  N+1 from slice N's verified tip only after slice N's run returns. The review
  range is already three-dot `origin/<parent>...origin/<slice>`. Before any
  `wholeBranch` re-run when the parent moved, a fresh `implementer` merges the
  parent up into the slice (merge, never rebase). Slices go bottom-first: after
  any re-run whose `finalSha` moved, up-merge into every child.
- **Briefs:** paste earlier slices' findings (fixed and declined) into every
  later slice's brief. Each slice PR body carries the stack table:
  `| # | branch | base | status | merge after #N |`.
- **Whole-stack pass:** `stage: "wholeBranch"`, `wbRounds: 0`,
  `docsRepos: []` (review only: no fix, no docs commit, `finalSha` stays the
  reviewed SHA), and every workstream entry rewritten to `featureBranch` = top
  slice and `base: "main"` (otherwise the script throws "workstreams
  disagree"). Route each returned finding to the slice that
  owns its lines, via a fresh `implementer` on that slice; then merge upward
  bottom-first, each child running
  `git -c rerere.enabled=true -c rerere.autoupdate=true merge origin/<parent>`;
  re-run `stage: "wholeBranch"` per touched slice (`base` = its parent).
- **Merge-settings preflight:** `gh api repos/{owner}/{repo} --jq
  '{allow_merge_commit, allow_squash_merge, allow_rebase_merge}'`. Merge commits
  allowed → recommend them; squash-only → warn the user, don't refuse.
- **Hand-off recipe for the user** (merging stays theirs): merge slice N
  WITHOUT `--delete-branch` (deleting a base closes the child PR); run
  `gh pr edit <N+1> --base <N's base>`; delete N's branch only once
  `gh pr list --base <N's branch>` is empty.
- **After a squashed parent:** with `H` = the parent PR's merged head
  (`gh pr view <N> --json headRefOid -q .headRefOid`; once its branch is
  deleted, `git fetch origin refs/pull/<N>/head` brings the commit back), first
  check `git merge-base --is-ancestor <H> origin/<child>`. If it fails, merge
  `H` into the child first; otherwise "take ours" could drop parent changes.
  Then the child merges `origin/main`. Per conflicted file: if
  `git rev-parse origin/main:<file>` equals `git rev-parse <H>:<file>`, take
  ours (`git checkout --ours <file>`); anything else, a file missing on either
  side included, is a real conflict → fixer. **Supervised until the user
  waives it:** the agent stops before pushing and leaves its worktree in place
  for the push; you show the user each auto-resolved file with its diff, and it
  pushes only on the user's yes.
- **Refuse** only for GitHub-native stacks or a parent PR with no `headRefOid`.
- **CI:** slice PRs 2..n target non-`main` bases, so workflow branch filters
  may run no remote CI on them; say so in each PR body. The per-slice local
  gate stays mandatory.

## Changing workflow.js

`tests/` is the regression suite: a mock `agent()` harness that runs the real
script. After any edit, run every check from `tests/`:
`for f in check*.mjs; do node $f ../workflow.js; done` (each prints `... ok`), plus `node run-cmd.test.mjs` after any edit to `run-cmd.mjs`.
Add a scenario that fails before your change. `tests/fixture-scenarios.md`
describes the live two-repo fixture eval (2026-10-29) for bigger changes.
