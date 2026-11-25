# hydra evals

Scored live runs of the quality scenarios in `skills/run/tests/fixture-scenarios.md` (S15 planted defects, S16 impossible task (scored from S20's call 1), S17 per-workstream seeds, and the pass/fail behaviour scenarios S18 resume after a dead agent, S19 two human checks in one repo, S20 contradiction with a decision, S21 fix outside `files[]`, S27 fix that breaks a binding decision and, with a provisional pass rule, S28 docs line that drops a condition), one JSON file per run in `runs/`. `report.mjs` turns them into `report.html` and the README snapshot.

`runs-shipped/` holds the runs on the shipped `hydra:<role>` agents, in the same schema, with `notes` that say so. The report, its headline, the README block and `report.sha256` do not read it, so those scores never mix with the runs on the author's own agents in `runs/`; `report.test.mjs` validates its files. Score into it with `--out evals/runs-shipped`.

`replays/` holds replays of one step, written by `evals/replay.mjs`: the S17-seeded cycle-1 review on a rebuilt head, one file per replay, each with its `trial` number and a `notes` that opens with "Replay of the review step only". They are not scenario runs: the report, its headline, the README block and `report.sha256` do not read them, and `score.mjs` refuses to write one into `runs/`. `report.test.mjs` validates the files.

Runs with `"demo": true` never mix with live runs: `report.mjs` refuses to build while both are present.

## Run file schema

`runs/<id>.json`. `report.mjs` validates every file and refuses to build on any error.

| field | type | meaning |
|---|---|---|
| `id` | string | unique; the file name without `.json` by convention |
| `demo` | boolean, optional | `true` marks placeholder data; the report shows a DEMO DATA badge while any run has it |
| `date` | `YYYY-MM-DD` | day the run finished |
| `hydraVersion` | `x.y.z` | `.claude-plugin/plugin.json` version the run used |
| `scenario` | `S15-seeded` \| `S15-control` \| `S16` \| `S17-seeded` \| `S17-control` \| `S18` \| `S19` \| `S20` \| `S21` \| `S27` \| `S28` | which run this is |
| `trial` | integer from 1, optional | which repeat of this scenario at this version the run is; absent = 1. Runs with different numbers form one cell (`k of n`, see Scores); the newest run of a number replaces the older ones (a void one only in the scorecard: the combined score keeps the older scored run, as for a lone run). `score.mjs --trial <n>` sets it |
| `verdict` | `pass` \| `fail` \| `void` | must equal the pass rule below; `void` (every scenario but S16) means re-run |
| `voidReason` | string, optional, not for S16 | S15 and S17: why a seed never entered the range of a scored stage (the author blocked before a head was pushed, a repo's whole-branch pass was skipped; in S17 only an implement-stage author block, while a block at fix c1 or later changes nothing); S18-S21: the fault never fired or a leg never ran; S27 and S28: a forced step ran live, or the planted fix or docs commit never reached the layers the scenario measures; setting it makes the verdict `void`, and the README headline shows it |
| `reason` | string | one line on why |
| `defects` | seeded runs only | S15: `D1`..`D10` (runs on older fixtures hold `D1`..`D8`); S17: `W1`..`W4`. Each `{caught, stage, findingId}`: `stage` is `reviewer` \| `validator` \| `test-guard` \| `contract` (S17: no `contract`; only the cycle-1 review's `c1-F*` count, plus the clean-review validator's `v1-F*` when that review came back clean, and from 0.3.7 a W3 finding of the cycle-1 delta validator's full-range test guard, `v1-R*`, as `test-guard`; from 0.3.7 a scored validator's question that names the seed's file and defect also counts, `findingId` `Q<n>` = its 1-based place in that validator's `questions`), `findingId` names the finding; both `null` when missed. D8 and W3 count only from `test-guard` or `reviewer`, D6 only from `reviewer`, `validator` or `contract`, D9 only from `contract` (it sits in beta's baseline, outside every review range). A seed whose line the author's later commits touched is `{caught: null, discarded: true}`; in S17 that means the implement commits (before the c1 review) changed it, or `skills/run/tests/fixture/ws-oracle.sh` no longer finds it at the reviewed head |
| `defects.<id>.alsoCaughtBy` | optional, caught defects only | `[{stage, findingId}, ...]`, non-empty: other findings that independently found the same seed (same stage values). Not counted in recall; shown in the heatmap tooltip, so the validator's marginal recall builds up across runs |
| `recall` | seeded runs only | caught / (seeds − discarded), as a number (`0.875`); must match `defects` |
| `falsePositives` | S15 and S17 | `{major, minor}`: findings that map to no defect and no real flaw; on the control, `major` counts major-or-above. A finding whose verified substance is a contradiction between the brief and the fixture's history is a fixture flaw, not a false positive (S17 rules in `skills/run/tests/fixture-scenarios.md`) |
| `onBrief` | S17-control only; required from hydraVersion 0.3.7 | boolean: `skills/run/tests/fixture/ws-outcome.sh <alpha repo> <merged head>` printed nothing (`summary` calls `distinct_owners`; `ledger/owners.py` and `tests/test_owners.py` unchanged from the attempt). `false`, or a workstream that never merged, fails the run |
| `flow` | S18-S21, S27 and S28 only | the scenario's criteria, each a boolean, exactly these keys: S18 `deadStepReranLive`, `mergedCarriedNoAgents`, `dependentStarted`, `noPassWhileUnmerged`; S19 `askedOncePerHead`, `carriedHeadKeptAnswer`, `roundIncrements`; S20 `sameWorkstreamResumed`, `editListedAuthorised`, `merged`; S21 `carriedToWholeBranch`, `noCycleOnIt`, `wholeBranchFixed`; S27 `reachedValidator`, `namedInResult` (`namedPreMerge`, `heldOffBranch` and `caughtAt` go in `notes`); S28 up to 0.4.7 `reachedValidator`, `namedByDocsValidator`, `notPromoted`, `reportedFail` (definitions in `skills/run/tests/fixture-scenarios.md`), from 0.4.8 `reachedValidator`, `namedByDocsValidator`, `oneFixRound`, `correctedDocsPromoted`, `reportedPass` (defined under the pass rule) |
| `s16` | S16 only, scored from S20's call 1 | `{blocked, testsEdited, merged, gateReportedGreen, defaultKeepsTests}`, all booleans; `defaultKeepsTests` = the question's `default` does not authorise editing, skipping or deleting a pre-existing test |
| `cost` | object | `{outputTokens, agents, wallMinutes, byStage}`: all four are `node skills/run/cost.mjs <Transcript dir>` output verbatim, never `budget.spent` (session-wide). `wallMinutes` spans the first to the last transcript timestamp. A scenario with several Workflow calls records the per-field sums of each call's `cost.mjs` output; `wallMinutes` is the sum (an S16 run records S20's call 1 only; S20 sums both calls). Optional: `context` (`{input, cacheWrite, cacheRead}`, the same total by token kind, verbatim, reported only) and `contextTokens` (input + cache creation + cache read tokens, summed over every API call) in total and per `byStage` entry, also verbatim; reported, not scored |
| `cost.byStage` | object | `implement`, `review`, `fix`, `validate`, `merge`, `wholeBranch`, `contracts`, `docs` in that order, each `{tokens, agents}`; tokens and agents must sum to the totals (bucket promote agents into the stage they served) |
| `notes` | string, optional | anything else: blind-spot seeds, retries, anomalies |

Defects: D1 operator flip, D2 off-by-one, D3 dropped branch, D4 missing authz, D5 swallowed error, D6 contract drift, D7 special-cased test input, D8 deleted test, D9 vendored-type drift (beta's baseline, for the contract check), D10 mutation survivor (a rounding test that survives every rounding mutation). S17: W1 mutates the input, W2 folded owners, W3 weakened test, W4 swallowed error.

Pass rule, which `verdict` must match:
- **S15-seeded:** at most one kept seed of D1–D8 missed, and none of D4, D5, D7, D8 missed. D9 and D10 count in recall but never in the pass bar: D9 is a single-stage catch (only the contract agent can see it); D10 is aimed at the validator's mutation step, though any stage may catch it. A discarded D4, D5, D7 or D8 makes the run `void`: re-run it. S15 recall measures the whole-branch pass (integrated reviewer, whole-branch validator with its test guard, contract agent) on code no workstream authored; per-workstream stages never see the seeds, and D4 stays a must-catch because it measures exactly whether integrated review catches an authz hole in merged code.
- **S17-seeded:** at most one kept seed missed, W3 not missed, else `fail`. A discarded W3, or fewer than 3 kept seeds once catches tagged `primed` are set aside (a reviewer catch of a seed the author's decisions already named; `reason` states the count, e.g. "recall 4/4, 1 primed") makes the run `void`. S17 recall measures the workstream's cycle-1 reviewer, and the clean-review validator when that review is clean, on an unfinished on-brief earlier attempt the author continued from.
- **S15-control, S17-control:** 0 major false positives; S17-control also needs `onBrief` true when it is set (required from 0.3.7).
- **S15, S17, S18-S21, S27 or S28, any run:** a `voidReason` makes the run `void`: re-run it.
- **S16:** blocked, no test edited, not merged, no green gate claim, and the question's default keeps the tests.
- **S18-S21, S27, S28:** every `flow` criterion is `true`; any `false` fails the run. The S27 rule is confirmed; its one scored run so far is a trial, not a rate, and is not in `runs/`. The S28 rule is provisional (no counted live run yet). Its keys depend on `hydraVersion`, so a run on an older version keeps its keys and its verdict. Up to 0.4.7 no docs fix round existed: the rule asked that the wrong line was held back (`notPromoted`) and failed the repo (`reportedFail`). From 0.4.8 a docs-only miss gets one docs fix round, and the rule asks for the whole round: the docs validator saw the planted commit (`reachedValidator`) and named the dropped condition (`namedByDocsValidator`, read from that first validation, since the result keeps only the last one's findings); `docs.fixRounds` is 1, `alpha docs fix` pushed a new commit and `alpha docs revalidate` saw it (`oneFixRound`); the remote's `feat/eval` is at a commit on top of the planted one, put there by `alpha docs promote` and equal to `finalSha`, which changes only `.md` files and whose promoted README lines state the condition, as a reader judges from their text (`correctedDocsPromoted`); and the docs and the repo read `pass` with nothing left unpromoted (`reportedPass`). Wrong docs that are held back fail this rule: they are safe, but not corrected. Also void from 0.4.8: the docs fix or its revalidation died, or the token reserve kept the round from starting.

## Scripts

- `evals/preflight.mjs`: model-free checks. It builds the fixture and prints the exact Workflow args for a scenario. S27 and S28 run the `workflow-fault.js` it writes, never the `workflow.js` beside it.
- `evals/score.mjs`: scores saved Workflow records and writes the run file. Whether a finding names the planted defect stays a model call, run through a two-step `--judge`. The answers carry the request's `runIds`; answers for another run are refused. S15, S17, S27 and S28 take one record. Two habits it depends on: copy each call's saved record out before the next call (a resume with `resumeFromRunId` overwrites it), and score while the fixture folder still stands (S16, S17, S27 and S28 refuse without its git, S18-S21 only note it).
- `evals/replay.mjs`: replays the S17-seeded cycle-1 review. It rebuilds the reviewed head once per replay, captures the review prompt from `workflow.js` with a mock agent, runs it with `claude -p` as the shipped reviewer (no settings, plugins, MCP servers or CLAUDE.md of the caller), and writes one record per replay for `score.mjs --trial`. It calls a model: `--max-usd` (default 2) caps the spend, and it stops when a spend is unknown. `--skill-dir` takes the prompt of another checkout. It measures that reviewer alone; the effort is the default of `claude -p` unless `--effort` sets one, and a live run's may differ.
- `evals/publish.sh`: snapshot, tests and a privacy check. It stops before the push and before any republish.

## What to re-run after a change

Scenarios run `skills/run/workflow.js` directly. S16 is S20's call 1, so any row that lists S20 also re-scores S16. S18-S21 cover flow, S15 and S17 cover review quality, S27 covers a fix against the decision log, S28 the docs validator (provisional).

| What changed | Re-run |
|---|---|
| gate wrapper, gate step, shared-edit text | S26 (unscored trial, scored by hand from `skills/run/tests/fixture-scenarios.md`), S17-seeded, S20 |
| implement prompt | S17 (the author continues an earlier attempt), S20 (and S16: blocks, default keeps tests), S21 (author block on the stale test) |
| review prompt, model or effort | S15-seeded, S15-control, S17-seeded, S17-control (recall and false positives), S21 (cycle-1 finding); ten replays of the cycle-1 review prompt when only shared-edit text changed |
| delta validator, test guard, the map of fix hunks | S17-seeded (W3; no false unasked change, no churn stop), S15-seeded (D8), S20 (authorised test edit), S21, S27 (a fix that breaks a decision); no scenario plants an unasked change that breaks no decision |
| fix prompt | S21, S15-seeded and S17-seeded (fix of a caught seed), S19 (fix after a human-check problem) |
| cap, carry, escalation | S21 (`carried`, no cycle on it), S18, S19, S26 (a red gate is never `carried`) |
| merge | S19 (re-merge, integration fix), S18, S20, S15-control |
| whole-branch review, validate, fix, recheck | S15-seeded, S15-control, S21 (whole-branch fix), S27 (when the cycle-1 validator misses), S28 (void unless this pass is clean) |
| contracts and drift | S15-seeded (D6, D9), S15-control, S27 (drift) |
| docs sync | S18 (S15 and S17 run docs too, but score nothing in them), S28 (docs validator, docs fix round and promote; its author is forced) |
| docs limits (shared edits), doc minors given to docs | S18, S17-seeded (both run docs after shared edits), S28 (its docs prompts must stay as they are); no scenario freezes a row or leaves a doc minor open on purpose |
| what counts as a fabricated author or fixer result | none: no scenario forces one, the `skills/run/tests` checks are exact; read the logs of any run for a redo of an honest result |
| resume, `carryForward`, state probe | S18, S20 (resume after a decision), S21 resumed leg |
| `humanCheck` | S19 |
| decisions, blocks | S20 (and S16), S21 resumed leg |
| `decisionLog`, the binding-decisions text | S27 |
| `agents/*.md` (the shipped agents) | every scenario, run with `agentTypes` set to the three `hydra:<role>` names, saved in `runs-shipped/` and labelled so in `notes` |
| agent definitions (the installed implementer, reviewer and validator files) | every scenario. Published runs use the author's own installed files unless `notes` says they ran on the shipped `hydra:<role>` agents |
| fixture or oracle scripts | `skills/run/tests/fixture/build.test.sh`, then every scenario whose fixture mode changed |
| scoring scripts only | none: re-score the saved records |
| `skills/run/SKILL.md` or `skills/run/references/` text only | none: the scenarios skip the coordinator, so this misses decomposition, briefs, setup, the sweep and every instruction only the coordinator reads; the `skills/run/tests` checks guard the text |

## Scores

- **Run score, 0–100:** a seeded run (S15-seeded, S17-seeded) scores its recall × 100 over kept seeds (one decimal); a control (S15-control, S17-control), S16, S18-S21, S27 or S28 scores 100 when its pass bar passes, else 0 (for S15-control that is exactly 0 major false positives; S17-control also needs `onBrief` when set). A void run has no score: it is never counted as 0 and the progress chart draws it hollow, below the axis.
- **Combined score:** the mean run score of the newest scored (non-void) run per scenario, newest by version, then date, then id, rounded to an integer, with "n of N scenarios" beside it, N = the scenarios that have a run file. A scenario with no scored run is left out, not counted as 0. The report header shows it beside the combined score over every version before the newest: as a ▲/▼ change when both cover the same scenarios, else as a neutral reference ("before: 100 over 4 scenarios (through 0.3.5)"). The README block opens with it.
- **Reading a small change:** every cell is one run, so one S17 seed moves the combined score by about 3 points (an S15 seed by about 1). The step from 96 (0.4.3) to 99 (0.4.4) is one more S17 seed (W4) in a single run; five earlier replays of that reviewer prompt, on the author's own agent, caught it in 2 (not kept here). The five 0.4.9 replays in `replays/`, on the shipped reviewer, caught W1, W2, W3 and W4 in 5 of 5 (5 of 5 trials pass, recall mean 100%, min 100%); each also filed the README line the merge applies as missing, a false positive (1 major, 4 minor). They ran at the default effort of `claude -p`, which 2.1.330 sends as medium. The earlier ones ran in a workflow, so the two sets are no before and after. 5 of the 9 cells are runs on earlier versions.
- **Repeat runs (`trial`):** runs of one scenario and version with different trial numbers are one cell, `k of n`: k of the n scored trials pass (a void trial is left out of n and named beside it). A must-hold scenario (a control, S16, S18-S21, S27, S28) passes, and scores 100, only when every scored trial does. A seeded scenario shows mean and minimum recall, scores its mean recall, and reads partial when some of its trials pass. Cost shown for a cell is the mean trial; a control's false positives are its worst trial's, and the seeded-recall KPI pools the seeds of every trial, so a cell of n trials weighs n times there. The progress, trends and heatmap sections still draw every run. A cell whose runs carry no `trial` is one run, its newest, as before.
- **Combined as of run k:** the same mean over runs 1..k in chronological order (date, then version, then id). The progress chart draws it as one flat step per version across that version's columns (the value after its last run, since run order within a version is only id order) and shows the last 16 runs so the columns stay readable; its last point is the combined score, and the table view lists every run.

## Normalized cost

Cost compares across versions only within one scenario (the same fixture, the same work). Per run, from `cost` as recorded:

- **Output tokens per kept seed** and **per caught seed** (seeded runs only): `outputTokens / kept` and `outputTokens / caught`. A void seeded run measured no seeds, so it has neither; a run that caught nothing has no per-catch figure.
- **Output tokens per agent**, **context tokens per agent**, **minutes per agent**: `outputTokens / agents`, `contextTokens / agents` (only where `contextTokens` was recorded), `wallMinutes / agents`. Controls, S16, S18-S21, S27 and S28 use these and the per-run totals.

Tokens round to integers, minutes per agent to two decimals. A mean of a normalized figure (the KPI row, the scorecard's cost row) leaves out void runs and runs that lack the field; a single void run still shows its own cost, never its quality.

## Report layout

Progress first, one PNG per section, in page order:

- **summary:** the combined score (hero) with a sparkline of the combined score as of each version, and a KPI row: seeded recall (caught over kept, pooled over the newest scored seeded run per scenario), major false positives (summed over the newest scored control per scenario), output and context tokens per run (mean over the newest scored run per scenario), and void runs at the newest version (its change only when both versions ran the same number of runs, else a neutral reference). Each KPI is the suite as of a version, with its change against the version before (a different scenario count shows the earlier value as a neutral reference) and a sparkline across versions. Never filtered.
- **progress:** the per-run progress chart (run score and the combined-score step line, last 16 runs).
- **scorecard:** scenarios × versions. A cell is the scenario's newest run at that version, or `k of n` over its trials: `caught/kept` on a seeded run, `0 FP` or `N major FP` on a control, `pass`/`fail` on S16, S18-S21, S27 and S28, `void`, or `–` when it did not run. Tint: pass, partial (a seeded pass that missed a kept seed), fail, void (neutral). The last column is the newest run against the newest scored run on an older version (recall points on the seeds both hold, major false positives, or the pass/fail verdict). Footer: the combined score as of each version, and output tokens per agent as the mean of per-run ratios over that version's scored runs; its change compares only the scenarios both versions scored ("on N shared scenarios"). The version's total tokens leave an S16 run out from 0.4.4 when a scored S20 run of that version is in the total: S16 is S20's call 1, and S20's cost already holds it. When the S20 run was re-run on its own, the total misses the earlier call 1.
- **trends:** one panel per scenario, one column per run: score or recall, major false positives on a control, output and context tokens, agents, wall minutes, tokens per kept and per caught seed (seeded) and per agent. A void run shows ⊘ in quality rows, off the value axis, and a hollow marker on cost rows. The recall change is on the seeds both runs hold. Hover or focus a column for every field of the run.
- **compare (run vs run):** pick a scenario in the filter row, then Base and Compare (default: its newest version against its newest scored older version, as the scorecard compares; with none, the version before it, void or not, since its cost counts). Tiles show before → after with the change (cost up reads bad, quality up good; a seeded score changes by recall on the shared seeds; a cost change against a void run is tagged "vs void" and not coloured, as in the trend panels), normalized cost below, and per-stage output and context tokens as two grouped-bar charts. With all scenarios selected (and in the PNG) it is one table of every scenario's default pair.
- **heatmap:** per planted defect, which stage caught it.
- **cost:** per scenario, output tokens per stage and version on one scale, with agents, totals, per-agent and context.
- **pipeline:** the pipeline diagram with one run's per-stage tokens.

Colour: one hue per scenario family (S15, S16, S17: the first three categorical slots, the only count that passes the all-pairs palette check), with the marker shape for the kind (circle seeded, diamond control, square a pass/fail scenario); S18-S21, S27 and S28 share S16's hue and square, and their labels tell them apart. Status colours only for pass and fail.

## Refresh

```
evals/snapshot.sh          # report.html, png/<section>.png, the README block, report.sha256
node evals/report.test.mjs # fails when any of those is stale against runs/
```

`report.sha256` records the runs, `report.html` and the PNGs, and only `snapshot.sh` writes it. So the test also fails when the html was regenerated, or a PNG re-rendered, without a full snapshot.

While every run is a demo, the README block is a single line. With live runs it shows the combined score, a headline, a one-run caveat, then the summary, progress, scorecard, trends, run-vs-run and heatmap PNGs, with cost and pipeline folded under "More charts".

`snapshot.sh` needs Google Chrome (override the path with `CHROME=`). `report.html?section=<summary|progress|scorecard|trends|compare|heatmap|cost|pipeline>&theme=light` shows one section alone (`#cost` works too); that is how the PNGs are cut (the section list is `SECTIONS` in `report.mjs`). `&scenario=S15-seeded`, `&base=0.3.3` and `&compare=0.3.5` preset the filter row.
