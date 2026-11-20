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
fixers may decline them, and leftovers are carried to the whole-branch fix
round. A converged review of a head no validator has seen yet (typically a clean
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
gets the same inputs run at base and head, outputs diffed). Every validator runs
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

## 2. Set up

- **Preflight, per touched repo:** add `.claude/worktrees/` to
  `.git/info/exclude` (local; never a committed ignore line), run
  `git worktree prune`, and record the **known-red baseline**: run the full gate
  once at the feature-branch base in a throwaway worktree (one sonnet agent per
  repo) and pass the exact failing test ids as `knownRed`. Optional: a local
  `.git/hooks/pre-push` running the hygiene grep
  (`grep -iE 'co-authored-by|generated with|\bclaude\b|anthropic|\.claude/'`)
  over the user's own outgoing commits.
- One **feature branch per touched repo** (e.g. `feat/<topic>`), cut from
  `origin/main` (or the stacked `base`) with `git branch` + `git push origin <branch>` — never
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
  scriptPath: "<skill dir>/workflow.js",
  args: {
    skillDir: "<skill dir>",         // absolute; required when any repo has smoke or any workstream has checks
    cycles: 2,                       // or null = converge; a named count is a floor
    maxCycles: 4,                    // optional hard cap; default cycles+2, or 4 when cycles is null
    tokenBudget: 3000000,            // optional; output tokens this run may spend (budget.spent())
    tokenReserve: 600000,            // optional; default 600000
    workstreams: [
      { id: "api-auth", repo: "~/code/api", featureBranch: "feat/auth",
        branch: "feat/auth--api-auth", model: "opus",
        base: "feat/x",              // base: 'feat/x' for a stacked feature branch; default main
        files: ["src/auth/", "test/auth/"],   // optional; dir/ or dir/** or exact paths
        reviewModel: "fable",        // optional; default one tier above model
        checks: ["npm run e2e:login"], // optional; extra commands run under a 540 s cap, red = critical
        quickGate: "npm run test:unit", // optional; author/fixer pre-push gate and reviewer probes; validators, merge, whole-branch and docs keep the full gate
        brief: "…", gate: "npm run lint && npm run typecheck && npm test && npx playwright test" },
      { id: "ui-login", repo: "~/code/ui", featureBranch: "feat/auth",
        branch: "feat/auth--ui-login", model: "sonnet", brief: "…", gate: "…" }
    ],
    repos: [                         // optional per-repo settings
      { repo: "~/code/api",
        knownRed: ["tests/test_openapi_sync.py::test_sync"],
        hot: ["**/README*", "docs/**", "openapi/**", "src/generated/**", "**/package-lock.json"],
        regen: "npm install && npm run gen:types",
        smoke: "env -i PATH=$PATH ./scripts/boot-local.sh --h2",
        smokeTimeout: 300 }          // optional; seconds, default 540
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
| `tokenBudget` | `null` | output-token cap for this run; the user's "+Nk" turn target also applies. Spend is counted from the script's start, so a `resumeFromRunId` crash recovery starts a fresh `tokenBudget` |
| `tokenReserve` | `600000` | before each new cycle, each whole-branch fix round, the contract check and docs: if less than this is left, nothing new starts; the item is reported not merged / failed with the reason |
| `workstreams[].files` | none | allowed paths; overlap within a repo throws; merge rejects edits outside |
| `workstreams[].checks` | none | extra commands (an e2e login, a contract probe) the author, fixer and both workstream validators run via `run-cmd.mjs` with a 540 s cap, reporting the exit code per command; a red or timed-out check is critical. The `gate` itself never gets a deadline |
| `workstreams[].quickGate` | none | a faster gate the author and fixer run before each push, and reviewers use for probes. The full `gate` stays mandatory for both workstream validators, the merge, whole-branch fix rounds and rechecks, and docs |
| `workstreams[].reviewModel` | sonnet→`opus`, opus→`fable` | review model; whole-branch review uses the repo's highest |
| `repos[].knownRed` | `[]` | exact test ids red at the base; any other failure is red |
| `repos[].hot` | README*, CHANGELOG*, `docs/**`, `graphify-out/**`, lockfiles, `openapi*.{yaml,yml,json}`, `*.sha256` | replaces the default hot list for that repo — add generated-type and contract paths here; `[]` turns the hot-file rule off for repos whose workstreams legitimately edit docs (the `files[]` check still applies) |
| `repos[].regen` | none | regenerates generated files: run by every agent that runs the gate on a workstream SHA (author, fixer, reviewer, validators; its diffs are never findings or commits), after each merge, and after whole-branch fixes. Set it whenever workstreams can touch dependencies or vendored contracts, or their gates go red on stale generated files |
| `repos[].smoke` | none | the safe local boot recipe the whole-branch validator and each whole-branch recheck run via `run-cmd.mjs` (own process group, hard timeout, leftover processes killed); a failed or timed-out smoke is critical; none = smoke skipped |
| `repos[].smokeTimeout` | `540` | smoke hard cap in seconds, an integer from 1 to 590 (stays under the agent shell's 600 s foreground limit) |
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
docs repo (1, +1 validator when it pushed, +1 promote when that passed). Every
dead agent can add up to 2 replacements. One workstream with a clean cycle 1 is
~9; two workstreams × 2 cycles is ~21. The
runtime runs at most min(16, CPUs−2) agents at once and caps a run at 1000
`agent()` calls (cached replays count).

**Progress panel** (when `mcp__savvy-progress__*` exists; skip silently
otherwise): before the call, `progress` with `title`, `total` = workstreams,
`phase: "hydra"`, one task per workstream id (`tier`: `careful` for opus,
`medium` for sonnet). The workflow's own progress tree shows per-agent detail.
After it returns: `done` = merged workstreams, `phase: "close"`, then
`finished: true`.

## 4. Final call (coordinator)

The workflow returns:

- top level: `{stage, budget, cycles, maxCycles, workstreams, repos, crossRepo, otherDocs}`
- `budget`: `{spent, tokenBudget, turnTotal, reserve, stoppedBy}`. `spent` is the
  output tokens this run spent since its own start; `turnTotal` is the user's
  "+Nk" target or `null`; `stoppedBy` lists what the reserve kept from starting
  (e.g. `alpha-cents cycle 3`, `api whole-branch fix round 2`, `contracts`)
- per workstream: `{id, branch, status, sha, validatedSha, cyclesRun, extended,
  findingsFixed, open, sharedEdits, questions, notes, escalations, tests,
  gateTail, merged}` (empty list in `wholeBranch` stage)
- per repo: `{repo, featureBranch, sha, verdict, sections, seams, tests, fixRounds,
  open, questions, notes, escalations, docs, finalSha, flaky}`; `sha` and
  `finalSha` are always validated SHAs on the feature branch (unpromoted
  whole-branch fixes or docs stay on their side branch, named in `escalations`);
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
- `crossRepo`: `{verdict, sections, findings}` when 2+ repos, else `null`
- `otherDocs`: `[{repo, featureBranch, docs, flaky}]` for docs-only repos

`questions` (`{q, options, default}`) are only what the user must decide; `notes`
are deviations and things not run; `escalations` are what the script itself
saw go wrong (dead agents after 2 replacements, SHA mismatches between agents,
cap or budget stops, failed merges, a finding that survived its opus fix — each
says NOT merged; unpromoted side branches). Then:

- `git ls-remote` every returned `finalSha` against its feature branch before
  believing it.
- Read it; spot-check anything `open`, `extended`, unmerged, a non-`pass`
  verdict, `docs.ok: false`, or a `crossRepo` finding against the code (and the
  docs diffs — docs must describe what shipped, including every review-round
  fix). Fix-ups go to a fresh `implementer`, never to you. **Every fix-up is then
  validated and docs-synced:** re-run the workflow with `stage: "wholeBranch"`
  (same args, narrowed to the affected repos' workstreams). After an
  unpromoted failure, the fix-up implementer continues from the side branch the
  `escalations` name (`<featureBranch>--wbfix<n>` or `<featureBranch>--docs`) and
  pushes to the feature branch before that re-run; afterwards delete the stale
  `--wbfix*`/`--docs` refs. An unmerged workstream is yours to settle; no agent
  merges it off-book.
- `resumeFromRunId` is **crash recovery only**: it replays cached results for
  identical prompts, so after any hand fix it returns the old verdicts on old
  SHAs and validates nothing. Gate prompts list the run-wide flaky registry, so
  a replay can see a different registry, run those agents live and end in a
  false "not promoted" fail: safe (nothing unvalidated lands), but re-check it.
- Escalate to the user **only** the `questions` (plus anything else code, spec or
  plan can't resolve) — collected and asked **once**, at the end.

## 5. Finish

- Feature branches green and verified on the remote; update the plan doc status
  (phases done, debt carried); docs sync done per repo.
- Run `python3 <skill dir>/stale_sweep.py --dry-run`; if it lists
  stuck wait loops or orphaned runners in agent worktrees, run it again without
  `--dry-run`.
- Open the PR only where the repo's process says PRs; otherwise report PR-ready
  state per repo: branches, SHAs, test results, unresolved questions. PRs stay
  open — a human merges to `main`, especially where merge deploys.
- **Retrospective (mandatory):** after every Workflow return, success or failure,
  `stage: "wholeBranch"` re-runs included, spawn one read-only `general-purpose`
  agent on `opus`. Brief it with the full result JSON, the run args, the
  feature-branch tips and `<skill dir>/retro.md`; it returns retro.md filled in.
  Save it: eval runs (fixture repos) → `evals/retros/<YYYY-MM-DD>-<scenario>-v<version>.md`
  in the hydra repo, committed through the normal PR flow; real runs → the vault
  at `~/Obsidian/Vault/Homelab/Hydra Retros/<YYYY-MM-DD> <topic>.md` (never
  `: * ? " < > |` in the name), never in the repo.
  Privacy: anything that reaches the public repo (changes, eval seeds) is
  generalised: no project, repo, person or host names, no code copied from
  private repos. Merge its Changes and Eval gaps into one ranked list and put it
  to the user in AskUserQuestion batches. Nothing is applied without the user's
  OK. Approved hydra changes become PRs reviewed until clean; approved eval gaps
  become fixture seeds or scenarios plus the builder updates.

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
