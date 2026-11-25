---
name: run
description: Hydra (formerly "delegate"), a multi-repo delegation workflow — parallel workstreams in worktrees, review/fix/validate cycles until clean, validated merges. Use when the user asks to implement with hydra or delegation, "in parallel", "spawn agents", "delegation run", "run this plan", or to execute a multi-repo/multi-workstream implementation plan.
---

# Hydra

**When NOT to use the workflow:** a single small fix or one bounded task → plain
subagents (one `implementer` + one `validator`), no feature branch ceremony. The
workflow pays off at 2+ workstreams or anything that needs review cycles.

Coordinator = this session: decompose, set up, brief, call the workflow,
make the final call. Subagents write code; the coordinator never does.
`workflow.js` (next to this file; `<skill dir>` below is this skill's base directory, printed when the skill loads) encodes everything mechanical: worktrees, gates,
push + `ls-remote` verification, SHA pinning between stages, review/fix/validate
cycles, merges, shared-file edits, whole-branch review, contract check, docs sync.
Every step runs as a typed agent: authors, fixers, merge, promote and docs as
`implementer` (merge, promote and docs are told they are no feature task: no
tests, no test-first, no self-review fix pass, nothing changed beyond their steps), reviewers as `reviewer`, validators, the contract
check and the state and health probes as `validator`. An untyped step would start a far larger default context.

**Agent types.** Hydra ships the three roles as `hydra:<role>` (for example
`hydra:validator`). They are the default; an agent of the user's or the project's
with the bare name replaces them. Before section 1, settle each role from the
Agent tool's list, in this order: a type the user names for this run, the bare
name if the list has it, else `hydra:<role>`. Pass each role that is not its bare
name in `agentTypes`, and use the settled types for your own spawns too, wherever
this skill names a role. Pass the same `agentTypes` on every resume; a run that
started without it resumes without it. Before your first spawn, the plan review
included, print one line for the user, whatever the types are:
`Agent types: implementer = <type>, reviewer = <type>, validator = <type>`. If the list shows that a bare-name agent lacks Bash (or, for the
implementer, Edit or Write), ask instead of assuming; a type that is not in the list
at all: stop and say so, the script would die on its first agent. The shipped agents
inherit your model, so name a model on every spawn of your own (a fix-up: the
workstream's).

The ladder governs the run (the ponytail plugin, if installed, states the same rules): the plan is authored ladder-first (reuse > stdlib >
native > one line > minimum code; no speculative tasks); every review cycle hunts
over-engineering as hard as bugs.

**Reference files.** This file is the core. When a row applies, read its file
before you act; otherwise skip it.

| situation | read | when |
|---|---|---|
| you set an arg the tables and call here leave out: wrong actions (`stopRule`) or an approved case table (`acceptance`); the user's answers as binding rules plus a drift audit (`decisionLog`); a cheaper intermediate whole-branch review (`wbReviewModel`) or a review-only pass (`wbRounds`); a progress panel that offers a step tool (`stepTool`); a small pure file (`lite`); a by-eye check by the user (`humanCheck`); extra commands (`checks`, `knownRedChecks`); a gate over 2 min (`quickGate`); a local boot recipe (`smoke`, `smokeTimeout`); git-ignored files the gate needs (`copyExcluded`); a commit subject prefix (`commitPrefix`); code-like shared edits (`reviewSharedEdits`) | `<skill dir>/references/args-and-sizing.md` | before launching |
| the user asks for a size, a cost or a wall-time estimate, or you plan a `tokenBudget` | `<skill dir>/references/args-and-sizing.md`, "Size" and "Time estimate" | before launching |
| you set `humanCheck` on a workstream | `<skill dir>/references/questions-and-resume.md`, "Human checks" | before launching |
| local-only run (`localOnly: true`): nothing reaches the network | `<skill dir>/references/local-only.md` | before section 2, and again when the workflow returns (before section 4) |
| stacked slices (only on the user's ask; merging them stays theirs) | `<skill dir>/references/stacked.md` | before section 1 |
| after a result: `humanCheck` set, a verdict `paused` or `incomplete`, a workstream unmerged or `blocked` (`decision`), a workstream the user drops (`dropped`), a non-empty `handed` or a repo note `… is settled`; any `resumeFromRunId` call, a crash or an infra stop included | `<skill dir>/references/questions-and-resume.md` | before asking the user or re-running |
| after a result: a question about drift, churn, known gaps or a stuck finding; a verdict that is not `pass`; a critical or major `open`; `escalations`, `stoppedBy`, or a field you do not know | `<skill dir>/references/results.md` | before acting on it |
| you need to know what the script does in a stage (cycles, validators, gates, green, promote, brief conflicts, integration fixes, merges) | `<skill dir>/references/mechanics.md` | before explaining it or acting on it |
| you change workflow.js or run-cmd.mjs | `<skill dir>/references/mechanics.md`, "Changing workflow.js" | before the edit |
| Finish: the retro, its privacy and its follow-up | `<skill dir>/references/retrospective.md` | before you spawn its agent, and before anything goes to the public hydra repo |

**Cycle count is a per-run parameter.** If the user names a number ("2 cycles of
validation"), pass it as `cycles` — never ask for one. **Converged = no critical
or major finding left**: nothing blocking in the latest review *and* nothing
blocking left by the last validation. A converged review ends the loop early,
named count or not — re-reviewing unchanged code is waste. A named count is a
floor, not permission to merge dirty work: past it the workflow keeps cycling
while a critical **or major** is open and flags `extended`. Hard cap: N+2, or 4
when `cycles` is `null`; `maxCycles` overrides it.

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

- **Plan review first:** one `reviewer` agent on `fable` (not the generic
  `architect-reviewer`; never the default agent type, which starts about 70K
  tokens heavier). Brief it with the plan, the touched repos and
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
  has one: the integration rule (`<skill dir>/references/mechanics.md`) can only name files that were declared.
  Overlap is allowed when one workstream is ordered `after` the other (directly
  or through a chain): they never run at once, and the later one's backstop
  allows the earlier one's files. Use it for several workstreams on one large file.
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

Local-only runs read `<skill dir>/references/local-only.md` before this section.

- **Preflight, per touched repo:** add `.claude/worktrees/` to
  `.git/info/exclude` (local; never a committed ignore line), run
  `git worktree prune`, and record the **known-red baseline**: run the full gate
  once at the feature-branch base in a throwaway worktree (one `validator` agent on `sonnet` per
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
  missing `decisionLog` is critical, or `blocked` (or `ok=false` with notes) for
  any agent that pushes.
- One **feature branch per touched repo** (e.g. `feat/<topic>`), cut from
  `origin/main` (or the stacked `base`) with `git branch` + `git push origin <branch>` (`hydra-local` in local-only mode) — never
  checkout-switch. Every workstream branches off it and merges back into it.
- Workstream branches may not be named
  `<featureBranch>--docs` or `<featureBranch>--wbfix<n>` (the script throws).
- A base test outside a workstream's `files[]` that its brief does not name is
  read-only to its fixer. Read-only is judged against
  `base`: a test already on the feature branch but not on `base` counts as added
  in this run, so set `base` to the branch earlier work is on.
- Docs-only repos that need updates (e.g. `design-docs`) get a feature branch
  too and go in `docsRepos`.
- Write each brief: goal, exact file set (and what's off-limits), acceptance
  criteria, contracts with other workstreams/repos, which shared files it
  will need to change (as intents), and any pre-existing tests, snapshots or
  test-runner config the workstream is expected to change, delete or rename.
  When two workstreams add entries to the same shared file and the order matters,
  put the place in both briefs, each relative to the other ("after the A row if it
  is there", "before the B row if it is there"): either may merge first.
  The workflow adds the git, gate, hygiene, hard-rule, shared-file and ladder
  rules — don't repeat them.
- **Brief review before launch** (2+ workstreams, or any brief carrying a default
  or pre-answer you added): one `reviewer` on `opus`, read-only, given the approved
  plan, every brief and the args you will pass. It returns (1) a table: one row per
  workstream (files, shared edits with their place, done-when checks) and one row
  per pair of workstreams that share a file, a shared file or a contract (what each
  expects of the other, where each edit goes, which merges first); (2) every brief
  clause, default or pre-answer that adds behaviour the plan does not state; (3)
  every brief line that contradicts the `decisionLog`, the `acceptance` table or, on
  a resume, `decisions.<id>`. A result without the table does not count: ask again.
  Fix the briefs from (1) and (3). For each item of (2): remove it, mark it out of
  scope in the brief, or ask the user before launch; never launch it as a
  non-blocking default.

## 3. Run the workflow

**Long runs on a laptop:** request keep-awake (or run `caffeinate`) and tell the user the lid must stay open. A sleeping machine expires every agent's prompt cache and stalls the run (the one measured mass cache expiry came from a sleeping Mac).

**Stale-task sweep:** right before the Workflow call, `CronCreate` with
`*/30 * * * *` and prompt `python3 <skill dir>/stale_sweep.py`.
When the workflow returns — success or failure — `CronDelete` it. The sweep
SIGTERMs (never SIGKILLs) self-matching `pgrep -f` wait loops and orphaned
runners; it only reports owned runners older than 3 h. Fine print: session
crons fire only while the session is idle and expire after 30 days by default, and the
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
    agentTypes: { implementer: "hydra:implementer", reviewer: "hydra:reviewer", validator: "hydra:validator" }, // only the roles not on their bare name; none: leave it out
    workstreams: [
      { id: "api-auth", repo: "~/code/api", featureBranch: "feat/auth",
        branch: "feat/auth--api-auth", model: "opus",
        base: "feat/x",              // base: 'feat/x' for a stacked feature branch; default main
        files: ["src/auth/", "test/auth/"],   // optional; dir/ or dir/** or exact paths
        reviewModel: "fable",        // optional; default one tier above model
        brief: "…", gate: "npm run lint && npm run typecheck && npm test && npx playwright test" },
      { id: "api-docs-cli", repo: "~/code/api", featureBranch: "feat/auth",
        branch: "feat/auth--api-docs-cli", model: "sonnet",
        after: ["api-auth"],         // optional; starts once api-auth merged, from that head (same repo only)
        brief: "…", gate: "…" },
      { id: "ui-login", repo: "~/code/ui", featureBranch: "feat/auth",
        branch: "feat/auth--ui-login", model: "sonnet", brief: "…", gate: "…" }
    ],
    repos: [                         // optional per-repo settings
      { repo: "~/code/api",
        knownRed: ["tests/test_openapi_sync.py::test_sync"],
        hot: ["**/README*", "docs/**", "openapi/**", "src/generated/**", "**/package-lock.json"],
        regen: "npm install && npm run gen:types",
      }
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
| `stage` | omitted | `"wholeBranch"`: skip implement/cycles/merge; re-run whole-branch review + validator, contract check, docs sync on the current feature-branch tips, and the drift audit when `decisionLog` is set |
| `tokenBudget` | `null` | output-token cap for this run; the user's "+Nk" turn target also applies. Spend is counted from the script's start, so a `resumeFromRunId` crash recovery starts a fresh `tokenBudget` |
| `tokenReserve` | `600000` | before each new cycle, each whole-branch fix round, the contract check and docs: if less than this is left, nothing new starts; the item is reported not merged / failed with the reason |
| `workstreams[].files` | none | allowed paths; overlap within a repo throws unless one workstream is ordered `after` the other; merge rejects edits outside |
| `workstreams[].after` | none | workstream ids (same repo only; unknown ids, itself and cycles throw) that must merge into the feature branch before this one starts implementing; it branches from the head that carries them. A predecessor that does not merge leaves it NOT started. Workstreams without `after` run in parallel as before |
| `workstreams[].reviewModel` | sonnet→`opus`, opus→`fable` | review model; whole-branch review uses the repo's highest unless `wbReviewModel` is set |
| `repos[].knownRed` | `[]` | exact test ids red at the base; any other failure is red |
| `repos[].hot` | README*, CHANGELOG*, `docs/**`, `graphify-out/**`, lockfiles, `openapi*.{yaml,yml,json}`, `*.sha256` | replaces the default hot list for that repo — add generated-type and contract paths here; `[]` turns the hot-file rule off for repos whose workstreams legitimately edit docs (the `files[]` check still applies) |
| `repos[].regen` | none | regenerates generated files: run by every agent that runs the gate on a workstream SHA (author, fixer, reviewer, validators; its diffs are never findings or commits), after each merge, and after whole-branch fixes. Set it whenever workstreams can touch dependencies or vendored contracts, or their gates go red on stale generated files |
| `docsRepos[].gate` | the repo's workstream gates | gate for a docs-only repo |

`gate` is the repo's **full** gate — every suite it defines including
Playwright/e2e, not just `test`. Pass `args` as a JSON object, not a string.
Repo paths are normalized (trailing slashes stripped).
A gate must not pipe into `head`, `grep -q` or any
reader that exits early: the writer gets SIGPIPE (exit 141) and the gate reads red;
use `tail`, or redirect to a file. The script rejects the first two.

**Progress panel** (when `mcp__savvy-progress__*` exists; skip silently
otherwise). Before the first Workflow call: `progress` with `title`, `total` =
workstreams, `phase: "delegate"`, one task per workstream, its `title` the
workstream id verbatim (`tier`: `careful` for opus, `medium` for sonnet). Never
name a workstream exactly like its repo directory or `health`; an id that is
another id plus a word is matched by the longest title. A rejected merge is
ticked at once and `done` never goes down, so the bar can read one high until
that workstream merges: never lower `done` to correct it. Call `progress` after every Workflow return
(the first call, each resume, each `stage: "wholeBranch"` re-run): `done` =
workstreams with `merged: true` so far. Phase: `"delegate"` while a workstream
is unmerged or a `humanCheck` or block decision is pending, `phase: "review"` while
fix-ups and `wholeBranch` re-runs remain, `phase: "close"` on the final return; only
the enum plan | design | delegate | review | close. Send `finished: true` once,
after the last return, when nothing is left to re-run, even if the panel
finished itself (it never does with a dropped or unmerged workstream). A
dropped workstream: lower `total` by the dropped count and leave it out of
`tasks`; never lower `done`. The workflow's own progress tree shows per-agent
detail.

## 4. Final call (coordinator)

The workflow returns:

- top level: `{stage, budget, cycles, maxCycles, questions, dropped, workstreams, repos, drift, crossRepo, otherDocs}`, plus `humanCheck` only when the run paused for one (see Human checks in `<skill dir>/references/questions-and-resume.md`), and `carryForward` on every full-stage result: pass it back verbatim on any resume of it;
  `questions` collects every question of the run: first one entry when `crossRepo` has an open critical or major,
  whatever its verdict says (contracts have no fix loop, so it carries the contract
  check's recipe, its `sections`, else the findings' issues, and the user decides),
  then each workstream's and each repo's `questions`, with `q` prefixed `<workstream id>: ` or `<repo name>: `,
  then one per drift item and the drift-audit question (see `drift` in `<skill dir>/references/results.md`)
- the other fields, per workstream and per repo: `<skill dir>/references/results.md`

**Default path** (every workstream `merged: true`, every repo verdict `pass`, no
`escalations`, nothing `handed`, nothing `dropped`, empty `stoppedBy` and `questions`, `drift` `pass` or `skipped`, no critical or major `open` or in `crossRepo`): the
bullets here in order, then section 5. Anything else: first read the file its row in
the reference table names.

`open` in the ledger means no validator accepted
it; it may be absent from `open` (a minor nobody re-raised, or an escalation
awaiting the user). Count a carried minor once. The ledger is `findings` (`<skill dir>/references/results.md`). A repo's
`notes` also lists what a successful promote left undone (e.g. a side-branch
delete that was denied; for a docs-only repo, in `otherDocs[].docs.notes`):
delete those refs yourself.

`questions` (`{q, options, default}`) are only what the user must decide (an
optional question a later validated fix `settles`, or one about a handed finding
the whole-branch pass fixed, is already dropped); `notes`
are deviations and things not run; `escalations` are what the script itself
saw go wrong (dead agents after 2 replacements, a validator that never ran its gate in 3 attempts, a push step that "returned no usable result 3 times (died or malformed sha); check origin/<branch> for an unvalidated push", SHA mismatches between agents,
cap or budget stops, failed merges, a finding that survived its opus fix — each
says NOT merged; unpromoted side branches). Then:

- `git ls-remote` every returned `finalSha` against its feature branch (`hydra-local` in local-only mode; re-read `<skill dir>/references/local-only.md` first) before
  believing it. Then run each merged workstream's `checks` once yourself at `finalSha`
  in a throwaway worktree (`node <skill dir>/run-cmd.mjs 540 '<cmd>'`); a red one
  not in its `knownRedChecks` is a critical: fix-up, then `stage: "wholeBranch"`.
- Read it; spot-check anything `open`, `extended`, unmerged, a non-`pass`
  verdict, `docs.ok: false`, or a `crossRepo` finding against the code (and the
  docs diffs — docs must describe what shipped, including every review-round
  fix). Fix-ups go to a fresh `implementer`, never to you (in local-only mode it pushes to `hydra-local` only and never touches `origin`). Before any re-run,
  write the user's answer to each question into the affected brief: decisions
  reach agents through the brief, or through the `decisionLog` when set, and that
  is how a validator learns that "the user answered" allows a change. **Every fix-up is then
  validated and docs-synced:** re-run the workflow with `stage: "wholeBranch"`
  (same args, narrowed to the affected repos' workstreams). After an
  unpromoted failure, the fix-up implementer continues from the side branch the
  `escalations` name (`<featureBranch>--wbfix<n>` or `<featureBranch>--docs`) and
  pushes to the feature branch before that re-run; afterwards delete the stale
  `--wbfix*`/`--docs` refs. An unmerged workstream is yours to settle; no agent
  merges it off-book.
- Never resume after a hand fix to a workstream branch; re-run `stage: "wholeBranch"`
  instead. Between a `humanCheck` pause and its resume change nothing but
  `humanChecks`: no hand fixes, no brief edits (except a blocked workstream's, for
  its `decisions` answer).
- **Batch fix-ups:** collect the decisions, run one fix-up per repo, then one
  `stage: "wholeBranch"` run, never one pass per fix-up. Append every answered
  question to the `decisionLog`, and check each new brief against it before
  sending it. To accept a failing `acceptance` row, change the table; never log
  it as a decision (validators never waive a row from the log).
- Files a whole-branch fixer changed for a handed finding (`changed: <path>` in its
  notes): carry the new behaviour into every brief you write afterwards that reads
  one of them, in this run's fix-ups, a later run or a later slice.
- A promote you run by hand (known gaps) is a fast-forward to the checked head, by
  explicit refspec, no force; `<skill dir>/references/results.md` has the recipe.
- **Idle helpers:** a helper idle for over 5 minutes is cheaper started fresh than resumed, since its cache has expired, unless it needs its history (inferred from pricing, not measured).
- **Reviewer tiering:** intermediate `wholeBranch` passes run with
  `wbReviewModel: "opus"`; the top reviewer runs only on the final pass, the one expected to close with no majors left.
- Escalate to the user **only** the top-level `questions`, asked through AskUserQuestion (it already holds every workstream and repo question; plus anything else code, spec or
  plan can't resolve) — collected and asked **once**, at the end; the retro's
  ranked list (§5) joins that same ask, after the questions.

## 5. Finish

- Feature branches green and verified on the remote; update the plan doc status
  (phases done, debt carried); docs sync done per repo.
- A run with `dropped` workstreams: the PR body carries a **Not done** list with
  each dropped workstream and its one-line goal.
- Run `python3 <skill dir>/stale_sweep.py --dry-run`; if it lists
  stuck wait loops or orphaned runners in agent worktrees, run it again without
  `--dry-run`.
- Open the PR only where the repo's process says PRs, and never in local-only mode (the branches are local; pushing and the PR are the user's); otherwise report PR-ready
  state per repo: branches, SHAs, test results, unresolved questions. PRs stay
  open — a human merges to `main`, especially where merge deploys.
- **Retrospective (mandatory), one retro per run:** at Finish, success or
  failure, spawn one `reviewer` agent on `opus`, told to return retro.md filled in and
  not its own review format. Read `<skill dir>/references/retrospective.md` first:
  its brief (keep every Workflow return's result JSON for it), where the retro is
  saved, the follow-up.
- **Retro privacy:** real runs, and any run you are unsure about (treat it as
  real) → the user's private notes location, never inside any git repo.
  Everything bound for the public hydra repo (retros, changes, eval seeds, PR titles,
  bodies, branch names, commit messages) is generalised: no project, repo, person or
  host names, no local filesystem paths, branch names, URLs, secrets or env values, no
  code copied from private repos. Before committing there, run the grep in `<skill dir>/references/retrospective.md` as a
  grep over the staged diff and the PR text; any hit means don't push.
