# Changelog

What each version changed, newest first. A line describes the version it stands under; the behaviour now is in `skills/run/references/`.

## 0.4.12 (2026-11-26)

- An author or fixer result with an all-zero sha, or a fixer's new commit whose `gateTail` is nothing but a placeholder word, is a dead attempt: the step is redone within the same three attempts and nothing of the discarded result is kept.
- The docs step and its validator get the open minors that name a doc file; a promoted docs pass settles the ones its validator verified.
- The docs step, its fix round and their validator get the shared-file edits the merges applied as limits: a line they put in a file may be corrected where it is false, never extended or reworded. Such a change is a major docs finding.
- With either of those in play, a docs finding only the user can settle becomes a question.
- `carryForward` hands the applied shared edits to a resume.
- The default prompts are unchanged.

## 0.4.11 (2026-11-25)

- Both fix prompts say that every committed hunk must serve one listed finding; anything else worth changing is returned as a question. This replaces "keep fixes minimal".
- The validator of a workstream fix and the whole-branch recheck map each hunk of the fix to its finding and file an unasked change as a regression: major when user-visible or against a brief clause or a decision, else minor. After a fixer merged the feature branch, only the fixer's own hunks are mapped.
- The default prompts grew once (prompt-size pin 75253 to 76337).
- The skill's progress-panel text: newer savvy-progress takes a rejected merge's tick back when the fix starts.

## 0.4.10 (2026-11-25)

- The gate wrapper is one command, so a pipe an agent appends cannot replace the gate's exit code.
- A red gate is never handed to the whole-branch pass, and only a green gate settles one.
- Authors, fixers and workstream validators run the gate with the workstream's own shared edits, uncommitted. A validator undoes them before its trial merge and applies them again on the merged tree.
- The cycle reviewer is told that the merge applies shared edits, so a change missing from a shared file is not a finding.
- The default prompts grew once (prompt-size pin 73616 to 75253).
- New fixture mode `--shared` (S26, unscored).

## 0.4.9 (2026-11-25)

- Before a run of two or more workstreams, or with a brief that carries an added default, a brief review returns a table of every workstream and every pair that shares a file, a shared file or a contract, and lists what the briefs add to the plan; each addition is removed, marked out of scope or asked before launch.

## 0.4.8 (2026-11-25)

- Docs that fail their validation get one fix round and a second validation before they fail the repo.
- Fix loops stop on churn in a workstream too: two cycles in a row that each bring a new regression-kind blocker in a file the cycle's fixer was asked to fix, or one such cycle while an optional question of that workstream is still open, stop it with a question.

## 0.4.7 (2026-11-25)

- The skill prints the agent types, shows `agentTypes` in its call, and orders shared-file entries in both briefs.

## 0.4.6 (2026-11-25)

- Hydra ships its three agents, `hydra:implementer`, `hydra:reviewer` and `hydra:validator`. An agent of yours or the project's with the bare name wins; `agentTypes` replaces any role for one run.

## 0.4.5 (2026-11-25)

- `SKILL.md` is split into a core and reference files the coordinator reads only when a run needs them.

## 0.4.4 (2026-11-25)

- Both fixers see the briefs, helper and probe steps run on typed agents, result fields nobody reads are gone, and each repo's base is named in the pins.

## 0.4.3 (2026-11-23)

- A question about a handed finding that the whole-branch pass fixed is dropped, and a handed finding leaves `carryForward` only after a passed pass.

## 0.4.2 (2026-11-23)

- Pre-existing tests of a merged sibling stay read-only under the integration fix, and every workstream validator guards the base tests, test by test.

## 0.4.1 (2026-11-23)

- An author question that a later fix settled is dropped, and the resume probe is new on every call.

## 0.4.0 (2026-11-23)

- A `carried` claim (the only fix lies outside `files[]`) is checked by the validator; a rejected claim goes back to the fixer for one more cycle, counted by the usual stop rules. A soft block that continued on its defaults reads `status: done`, with a note. An infra stop says how many times the agent actually died and that the step can be resumed. Unconfirmed drift-audit items are kept under `drift.unconfirmed`, with no question.
- `workstreams[].checks` come back with a typed exit code per command (`checkExits`), `knownRedChecks` names those red at the base, and the merged tip re-runs the checks of every merged workstream. The coordinator also runs each merged workstream's `checks` once itself at `finalSha`.
- With a progress panel, the coordinator sends a progress call at every return, the review phase and dropped workstreams included. `stepTool` lets workers report their own steps.
- `dropped` workstreams, `repos[].commitPrefix`, and `files[]` that may overlap a workstream ordered `after`.
- Smaller prompt fixes: the churn question no longer repeats the repo name, the decision-log sentence is emitted only with `decisionLog`, a regression under a stop rule has one meaning (it worked at the base or before a fix in this run), the drift prompt opens with its task and says what to do with an unreadable log, and the whole-branch fixer lists each file it changed as `changed: <path>` in notes.

## 0.3.10 (2026-11-21)

- A fixer whose only fix lies outside its workstream's `files[]` hands the finding to the whole-branch pass, where it stops counting toward that workstream's cycles. Every gate runs through one pipefail wrapper that prints its exit code last, and a step whose agent died twice gets a health probe before a third try.
- A resume rebuilds each workstream's state from a live git probe (`resume`, `carryForward`), human-check answers are bound to the workstream's own head, and `decisions` resumes a blocked workstream with the user's answer.

## 0.3.9 (2026-11-21)

- Whole-branch fix rounds stop on churn: two rounds in a row that each bring a new regression-kind blocker in a file the round's fixer was asked to fix stop that repo's rounds with a question. Rounds that run out on a green recheck with no open critical, regression or integration finding offer to promote the checked head with its open majors parked as known gaps; the offer is skipped when `acceptance` or `stopRule` is set.
- `stopRule`, `acceptance`, `decisionLog` with a drift audit, and `wbReviewModel`.

## 0.3.8 (2026-11-20)

- `localOnly` runs, `after` ordering, `lite` workstreams, `copyExcluded` paths, `reviewSharedEdits` and `humanCheck`.

## 0.3.7 (2026-11-20)

- A finding that only a brief change can settle becomes a question for the user, never a fix. The first validator guards the tests over the whole workstream range.

## 0.3.6 (2026-11-20)

- A green gate whose command or summary says it never ran is rejected, an open cross-repo blocker is asked about before shipping, and a repo whose only workstream merged onto its untouched base gets only the validator.

## 0.3.5 (2026-11-20)

- Eval scenario S17 and two more S15 seeds; no change to a run.

## 0.3.4 (2026-11-20)

- Merge, promote and docs steps run as typed agents, and workstream validators know shared edits land at the merge.

## 0.3.3 (2026-11-20)

- A malformed sha gets one repair call instead of a redo, and a blocked question's default must keep every pre-existing test.

## 0.3.2 (2026-11-20)

- A retrospective after each run, and a findings ledger.

## 0.3.1 (2026-11-20)

- Eval scenarios S15 and S16, with their fixture builder.

## 0.3.0 (2026-11-20)

- Promote only on green, fixer escalation, merge retry, a flaky registry, acceptance tests and `quickGate`.

## 0.2.0 (2026-11-20)

- The smoke wrapper, executable checks, the seam inventory and opt-in stacked mode.

## 0.1.0 (2026-11-20)

- First version, formerly a private skill called `delegate`.
