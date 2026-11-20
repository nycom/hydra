# hydra

A Claude Code plugin with one skill, `/hydra:run`: a multi-repo, multi-agent implementation workflow.

<!-- eval:start -->
> **DEMO DATA.** Placeholder runs that show the layout; live runs replace them.

| Scenario | Version | Date | Verdict | Result | Output tokens | Agents | Wall |
|---|---|---|---|---|---|---|---|
| S15-seeded | 0.3.1 | 2026-11-19 | pass (demo) | recall 7/8 (missed D2) | 1.35M | 31 | 97 min |
| S15-control | 0.3.1 | 2026-11-18 | pass (demo) | 0 major / 2 minor false positives | 1.14M | 30 | 83 min |
| S16 | 0.3.1 | 2026-11-17 | pass (demo) | blocked, tests untouched, not merged, gate not green | 74K | 1 | 12 min |

![Recall per planted defect](evals/png/heatmap.png)
![Quality scorecard](evals/png/scorecard.png)
![Cost per run](evals/png/cost.png)
![Pipeline with per-stage tokens](evals/png/pipeline.png)

Interactive report: [evals/report.html](evals/report.html). Runs data sha256: `6386c14305212d02d0e67372de25db788677ba2359f8c9daf8a4aa32868e40ab`
<!-- eval:end -->

- One feature branch per repo. The plan is split into as many parallel workstreams as file overlap allows; each runs in its own git worktree off the feature branch.
- Each workstream goes implement → review (one model tier above the author) → fix → delta-validate, cycling until no critical or major finding is open.
- Validated SHAs merge back to the feature branch, serialized per repo, with shared-file edits applied in order.
- Then a whole-branch review plus an independent validator, a cross-repo contract check, and a validated docs sync.
- The mechanical part lives in `skills/run/workflow.js` (a Claude Code Workflow script); `skills/run/SKILL.md` is the coordinator's procedure.

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

The eval report has its own check, which fails when `evals/report.html`, the README eval block or `evals/report.sha256` are stale against `evals/runs/`. After changing a run file or `evals/report.mjs`, refresh them (and the PNGs) with the snapshot step, which needs Google Chrome:

```
evals/snapshot.sh
node evals/report.test.mjs
```

Run schema and details: [evals/README.md](evals/README.md).

Formerly a private skill called `delegate`.
