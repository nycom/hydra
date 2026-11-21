# hydra

A Claude Code plugin with one skill, `/hydra:run`: a multi-repo, multi-agent implementation workflow.

<!-- eval:start -->
**Combined score:** 93/100 (5 of 5 scenarios)

**Latest eval:** S15-seeded 0.3.9 pass (recall 9/10) · S15-control 0.3.9 pass (0 major false positives) · S16 0.3.9 pass (honest) · S17-seeded 0.3.9 pass (recall 3/4) · S17-control 0.3.9 pass (0 major false positives)

One run per scenario on a small fixture; limits in evals/retros/.

![Combined score and KPIs per version](evals/png/summary.png)
![Combined score and run scores per eval run](evals/png/progress.png)
![Version scorecard, scenarios by versions](evals/png/scorecard.png)
![Trends per scenario](evals/png/trends.png)
![Run vs run, newest version against the one before](evals/png/compare.png)
![Recall per planted defect](evals/png/heatmap.png)

<details><summary>More charts</summary>

![Cost per stage](evals/png/cost.png)
![Pipeline with per-stage tokens](evals/png/pipeline.png)

</details>

Interactive report: [evals/report.html](evals/report.html), open locally (GitHub shows source).
<!-- eval:end -->

- One feature branch per repo. The plan is split into as many parallel workstreams as file overlap allows; each runs in its own git worktree off the feature branch.
- Each workstream goes implement → review (one model tier above the author) → fix → delta-validate, cycling until no critical or major finding is open.
- A finding that only a brief change can settle (the brief contradicts itself or the repo, or a fix would undo an earlier verified fix) becomes a question for the user, never a fix.
- Validated SHAs merge back to the feature branch, serialized per repo, with shared-file edits applied in order.
- Then a whole-branch review plus an independent validator, a cross-repo contract check, and a validated docs sync. A repo whose only workstream merged onto its untouched base has no seam to review, so only the validator runs there.
- Whole-branch fix rounds stop on churn: two rounds in a row that each bring a new regression-kind blocker in a file the round's fixer was asked to fix stop that repo's rounds with a question. Rounds that run out on a green recheck with no open critical, regression or integration finding offer to promote the checked head with its open majors parked as known gaps; the offer is skipped when `acceptance` or `stopRule` is set.
- A fixer whose only fix lies outside its workstream's `files[]` hands the finding to the whole-branch pass, where it stops counting toward that workstream's cycles. Every gate runs through one pipefail wrapper that prints its exit code last, and a step whose agent died twice gets a health probe before a third try.
- The mechanical part lives in `skills/run/workflow.js` (a Claude Code Workflow script); `skills/run/SKILL.md` is the coordinator's procedure.

Opt-in, per run (details and every arg in `skills/run/SKILL.md`):

- `localOnly: true`: nothing reaches the network. Every push, fetch and `ls-remote` targets a bare repo on local disk set up as the remote `hydra-local`; the branches are fetched back into your repo as local branches at the end, and pushing stays yours.
- `workstreams[].after: [ids]`: a workstream starts only once those (same repo) merged, and branches from that head.
- `workstreams[].lite: true`: for small pure files, implement plus one validator and no review cycles unless it finds a critical or major.
- `workstreams[].humanCheck`: once that workstream merges, its repo's whole-branch pass waits and the run returns what to check by eye, every check of a repo in one pause; a re-run with `resumeFromRunId`, `resume` and `humanChecks` (each answer bound to the workstream's own head, so a re-merge with no new commit keeps it) continues, and a reported problem goes back to its author.
- `resume` (on every `resumeFromRunId` call): a live git probe rebuilds each workstream's state before any stage, so merged workstreams are carried, a dead agent's workstream re-runs live, and no whole-branch pass reports `pass` while a planned workstream is unmerged.
- `decisions`: the user's answer to a blocked workstream's question, on a resume; that same workstream resumes at implement with the answer in its brief.
- `repos[].copyExcluded`: git-ignored files the gate needs (a local preview test) are copied into every agent worktree and never committed.
- `repos[].reviewSharedEdits: true`: the shared-file edits each merge applies get their own gate and validator before the next merge.
- `stopRule` + `acceptance`: a string of wrong actions and an approved case table; reviewers block only on those and on regressions vs the base, validators run each row black-box.
- `decisionLog`: the user's answers become binding for every agent, and a read-only drift audit after the run turns each unlogged change into a revert-by-default question.
- `wbReviewModel`: pick the integrated whole-branch review model (cheaper on intermediate passes, top tier on the pass expected to close clean).

Stacked PRs are an opt-in mode, used only when asked for.

## Install

```
/plugin marketplace add nycom/hydra
/plugin install hydra@hydra
```

Expects `implementer`, `reviewer` and `validator` subagents in `~/.claude/agents/`.

## Tests

```
(cd skills/run/tests && for f in check*.mjs; do node $f ../workflow.js; done)
node skills/run/tests/run-cmd.test.mjs
python3 skills/run/stale_sweep.py --self-test
```

The eval report has its own check, which fails when `evals/report.html`, the README eval block, `evals/report.sha256` or a PNG under `evals/png/` is stale against `evals/runs/`. After changing a run file or `evals/report.mjs`, refresh them (and the PNGs) with the snapshot step, which needs Google Chrome:

```
evals/snapshot.sh
node evals/report.test.mjs
```

Run schema and details: [evals/README.md](evals/README.md).

Formerly a private skill called `delegate`.
