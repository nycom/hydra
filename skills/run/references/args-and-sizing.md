# Optional args and sizing

Read before launching, when you set one of these args or need a size, cost or time
estimate. The call itself and the args nearly every run sets are in SKILL.md; each
arg here goes at the level its name or the example shows.

```
  args: {
    stopRule: "wrong output for a listed case, lost user data, a crash", // optional; the wrong actions, as one string
    acceptance: "<run dir>/cases.md",       // optional; absolute path to the approved case table
    decisionLog: "<run dir>/decisions.md",  // optional; absolute path; binding for every agent, turns on the drift audit
    wbReviewModel: "opus",           // optional; sonnet | opus | fable; integrated whole-branch review only
    workstreams: [
      { id: "api-auth", …
        checks: ["npm run e2e:login"], // optional; extra commands run under a 540 s cap, red = critical
        quickGate: "npm run test:unit", // optional; author/fixer pre-push gate and reviewer probes; validators, merge, whole-branch and docs keep the full gate
        humanCheck: "open the login page preview; the error banner is red", // optional; after this merges, its repo's whole-branch pass waits for the user's answer
      },
      { id: "api-docs-cli", …
        lite: true,                  // optional; implement + one validator, no review cycles
      }
    ],
    repos: [
      { repo: "~/code/api", …
        smoke: "env -i PATH=$PATH ./scripts/boot-local.sh --h2",
        smokeTimeout: 300,           // optional; seconds, default 540
        copyExcluded: ["tests/preview.spec.ts"], // optional; git-excluded files copied into every agent worktree
        reviewSharedEdits: true }    // optional; gate + validator on each merge's shared-file commits
    ]
  }
```

| arg | default | meaning |
|---|---|---|
| `wbRounds` | `2` | whole-branch fix rounds, each pushed to a side branch `<featureBranch>--wbfix<round>` and promoted onto the feature branch only after a passing recheck; `0` = no fix rounds (findings returned unfixed; the repo verdict is `fail` while any is critical or major); pair with `docsRepos: []` for a review-only pass (a failing repo skips docs regardless) |
| `stopRule` | none | non-empty string naming the wrong actions. A blocker is a regression vs the base or one of these; a miss the base also has is a known gap and minor. It reshapes the severity text for every reviewer and validator, and fixers decline known gaps. It applies run-wide (every workstream, the shared-edits check, docs validate): in a mixed run, name "an unmet brief criterion" in the rule, or split the run |
| `acceptance` | none | absolute path to the approved case table. Validators run each row this change touches black-box at their sha; reviewers block only on a broken row or a regression vs the base, and a failing row blocks even when the base fails it. Security, data loss and a red gate stay critical. A missing file is a critical finding from validators and `blocked` for authors and fixers; reviewers get no missing-file instruction |
| `decisionLog` | none | absolute path to the log of the user's answers; binding for every agent through the hard rules (a missing file is critical, or `blocked` (or `ok=false` with notes) for any agent that pushes). Setting it also turns on the drift audit: one read-only `fable` agent after the repos are final, skipped when nothing shipped, during a `humanCheck` pause or an `incomplete` repo, or when the token reserve is short. Result `drift: {verdict: pass\|drift\|failed\|died\|skipped, items: [{repo, where, change}], sections, notes}` (`failed` = the agent could not read the log or a repo; its items are kept under `drift.unconfirmed`, never questions); each item becomes a revert-by-default question, and a `died`, `failed` or reserve-`skipped` audit adds one question whose default re-runs `stage: "wholeBranch"` to audit drift |
| `wbReviewModel` | repo's highest `reviewModel` | `sonnet`, `opus` or `fable`; overrides only the integrated whole-branch review model, not the workstream reviews |
| `stepTool` | none | a tool name (`/^[\w-]+$/`). When set, every worker prompt ends with a paragraph telling the worker to report its steps with that tool and to send `failed` only when its own attempt failed (findings and a red gate it was asked to run are results). Unset: prompts are unchanged. Adds about 55 tokens per agent |
| `workstreams[].lite` | `false` | for small pure files: implement, then the clean-review validator alone (acceptance tests, full-range test guard, gate, trial merge); no reviewer ever runs. A critical or major it files gets a fix and a delta validation per cycle, capped by `maxCycles` as usual. Still merged, and covered by the whole-branch pass. A lite workstream alone on its untouched base gets no reviewer at all: the integrated review is skipped too, so only validators see it |
| `workstreams[].humanCheck` | none | instructions for the user's by-eye check. Once this workstream merges, its repo's whole-branch pass waits for the answer; other merges do not (see Human checks in `<skill dir>/references/questions-and-resume.md`) |
| `workstreams[].checks` | none | extra commands (an e2e login, a contract probe) the author, fixer and both workstream validators run via `run-cmd.mjs` with a 540 s cap, reporting the exit code per command in the typed `checkExits` field; the whole-branch validator and each recheck run the checks of every merged, not-dropped workstream (each command once). The script rates the validators' exits: a red or timed-out check that is not known-red turns the gate red, a critical; a red check is never rerun (no flaky rule). A validator red where the author or fixer of that head reported 0 is labelled a false green. A missing or short `checkExits` from a validator is an attempt that never ran its gate. The merge and docs steps run no checks. The `gate` itself never gets a deadline |
| `workstreams[].knownRedChecks` | none | entries of that workstream's `checks` that are red at the base (any other entry throws): their exit is reported, never a finding. On the merged tip it is the union over the merged workstreams |
| `workstreams[].quickGate` | none | a faster gate the author and fixer run before each push, and reviewers use for probes. The full `gate` stays mandatory for both workstream validators, the merge, whole-branch fix rounds and rechecks, and docs |
| `repos[].smoke` | none | the safe local boot recipe the whole-branch validator and each whole-branch recheck run via `run-cmd.mjs` (own process group, hard timeout, leftover processes killed); a failed or timed-out smoke is critical; none = smoke skipped |
| `repos[].smokeTimeout` | `540` | smoke hard cap in seconds, an integer from 1 to 590 (stays under the agent shell's 600 s foreground limit) |
| `repos[].copyExcluded` | `[]` | paths inside the repo, git-ignored (e.g. in `.git/info/exclude`), that the gate needs, such as a local preview test. Every agent copies them from the user's checkout into each worktree it creates, before any gate, only after `git check-ignore` confirms they are ignored; absolute paths, `~` and `..` throw. Hygiene checks no commit carries them |
| `repos[].commitPrefix` | none | a non-empty string without a newline or a quote, e.g. `"chore: "`, put before the merge step's fixed commit subjects (shared-file edits, regenerated files) and the docs step's graph refresh; the merge commit subject is unchanged |
| `repos[].reviewSharedEdits` | `false` | after a merge that applied shared-file edits, one opus `validator` checks exactly those commits (each edit against its intent, the gate, hygiene) inside the merge lock, so before the next merge lands; its findings (and a red gate) join the repo's whole-branch fix rounds. Opt-in, not automatic: defaults stay as before, and it costs one opus agent per such merge while the whole-branch validator already reruns every suite. Turn it on when shared edits are code-like (generated clients, lockfiles, contract digests) |

**Step reports** (`stepTool`, optional): when a progress panel offers a step
tool, read the `tools:` line of the implementer, reviewer and validator agent
files; only if all three list it, pass its name as `stepTool`. Workers then
report their steps with it.

## Sizing

**Size:** agents ≈ per workstream (implement + 1 review per cycle + fix and
validate per cycle with critical/major findings + 1 validator when a clean
review lands on an unvalidated head + merge; a rejected merge that returns to its
author adds fix + validate + merge, +3 once the named cycle count is reached, +4
otherwise and in converge mode, where a review of the fixed head follows) + per repo (2, +2 per whole-branch fix round, max `wbRounds`
rounds, +1 promote when a round pushed) + 1 contract check when 2+ repos + per
docs repo (1, +1 validator when it pushed, +1 promote when that passed) +1 fable drift audit when decisionLog is set; a repo whose one workstream merged onto its untouched base starts at 1, not 2. Every
dead agent can add up to 2 replacements, and after its first replacement dies a cheap sonnet health probe (`health <label>`, it runs `git --version`) decides the third: a failed probe ends the step as an infra fault ("died twice and the health probe failed (auth or tool access) … re-run with resumeFromRunId and resume") instead of a blind retry; a push step that reports done without a full 40-hex SHA gets a cheap repair call instead (it keeps the result and only re-reads the SHA). One workstream with a clean cycle 1 is
~9 (~8 when it merged onto its untouched base and the integrated review is skipped); two workstreams × 2 cycles is ~21.
A `lite` workstream drops the reviewer from every cycle: clean, it is implement + 1 validator + merge (3 agents instead of 4, and
the dropped one is the review a tier above the author, opus or fable); each blocker its validator files adds fix + delta validate (2, not 3+:
no review of the fixed head). A `resume` run adds 1 cheap state probe per repo and runs no agent for a workstream already merged. `reviewSharedEdits` adds 1 opus validator per merge that applied shared edits. The
runtime runs at most min(16, CPUs−2) agents at once and caps a run at 1000
`agent()` calls (cached replays count).

**Time estimate:** wall time ≈ the longest workstream chain + the whole-branch
pass. Each agent on the chain ≈ its gate minutes (validators run new tests 3×)
+ ~5 min of agent time. One whole-branch pass measured 50-68 min with 13-15
agents on 3-5 min gates. Estimate ×3 when the exit is "no reviewer finds a
major" on language or heuristic rules.
