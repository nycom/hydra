# Results: the fields, drift, churn, stuck findings, known gaps

Read when a result is not a clean pass, or when you need a field of it. Pauses,
blocks, handed findings and resume are in `<skill dir>/references/questions-and-resume.md`.

## The result's fields

The top level is in SKILL.md, section 4.

- `budget`: `{spent, tokenBudget, turnTotal, reserve, stoppedBy}`. `spent` is the
  output tokens this run spent since its own start; `turnTotal` is the user's
  "+Nk" target or `null`; `stoppedBy` lists what the reserve kept from starting
  (e.g. `alpha-cents cycle 3`, `api whole-branch fix round 2`, `contracts`)
- per workstream: `{id, branch, status, sha, validatedSha, cyclesRun, extended,
  findingsFixed, open, sharedEdits, questions, notes, escalations, tests,
  gateTail, merged, preMergeSha, baseAtMerge, evidence, findings, handed, churn}`, plus `decision` after a block with questions (empty list in `wholeBranch` stage);
  `handed` = the one-line findings handed to the whole-branch pass (fix outside `files[]`);
  `evidence` maps each workstream validator step (`validate c1`, `validate c1 delta`, …) to the
  commands it says it ran per step; `churn` = `[{cycle, files}]`, one entry per cycle whose
  delta validation returned a new regression-kind blocker in a file that cycle's fixer was
  asked to fix; two such cycles in a row, or one while an optional question of that
  workstream is still open, stop it NOT merged with a heuristic churn question (change the
  brief, the default; more cycles; drop it). A resume counts again
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
  `{sha, files, prBody, ok, tests, notes, verdict, findings, fixRounds}` (`sha` = the
  docs commit on `<featureBranch>--docs`, the fix round's when it pushed one; it
  becomes `finalSha` only when validated and promoted). A promoted docs pass also settles the
  open doc minors its validator verified: `fixed` in `findings`, gone from `open`. A docs
  finding only the user can settle is in the repo's `questions`, also when the docs
  failed; its default keeps the docs as that commit has them. `fixRounds` = 1 when a
  critical or major from the docs validator got its one docs fix round, else 0
  (none on the script's own `D-X`, none under the reserve: `stoppedBy` then lists
  `<repo> docs fix`). A docs validation that still fails after that round, or a
  failed promotion, fails the repo and names the unpromoted docs commit on `<featureBranch>--docs` in
  `escalations` and `docs.notes`; so does a docs agent that died 3 times (plus
  an escalation). Docs are skipped (`docs.notes`: `skipped: …`) when the repo's
  whole-branch pass failed
- `drift`: `{verdict: pass|drift|failed|died|skipped, items: [{repo, where, change}], unconfirmed, sections, notes}`,
  always present (`{verdict: 'skipped', items: [], unconfirmed: [], sections: '', notes: []}` without `decisionLog`; see its args row in `<skill dir>/references/args-and-sizing.md`); each item is also a question, revert by default;
  with `decisionLog` set, a `died`, `failed` or reserve-`skipped` audit adds the question
  `drift audit <verdict>: <why>` (default: re-run stage wholeBranch to audit drift); a `failed`
  audit's list is kept as `unconfirmed` (no questions) and the question ends with its count
- `dropped`: the ids of the workstreams the user dropped (`dropped` arg); list each as
  not done in your report
- `crossRepo`: `{verdict, sections, findings, ledger}` when 2+ repos, else `null`
- `otherDocs`: `[{repo, featureBranch, docs, findings, flaky}]` for docs-only repos
- `findings` (and `crossRepo.ledger`): the structured ledger next to the
  one-line `open` strings, `[{id, stage, severity, kind, where, issue, status}]`.
  `stage` is the first to raise the id (`review`, `validate`, `merge`, `human` per
  workstream; `wb-review`, `wb-validate`, `shared-edits`, `recheck`, `docs` per repo, where a
  carried workstream minor is `<ws id>:<id>` with its original stage, and a
  finding a workstream handed over is `<ws id>:<id>` with stage `handed`;
  `contract`); `status` is `fixed`, `answered` or `declined` once a validator
  accepted it, `carried` once a workstream handed it to the whole-branch pass
  (workstream ledger; a red gate is never handed over, so its finding never reads
  `carried`: it is `open` until a validator's gate is green), else `open`. `open` in the ledger means no validator accepted
  it; it may be absent from `open` (a minor nobody re-raised, or an escalation
  awaiting the user). Count a carried minor once.

## Acting on them

- **Cross-run churn:** if two consecutive `wholeBranch` runs return a non-empty
  `churn` for the same repo, ask the heuristic churn question (the rules are
  likely the wrong shape, not the code) before another run.
- **Drift items:** revert by default; keep one only on the user's word, then
  log it.
- **A finding stuck after its opus round:** the drop option names its re-run,
  `dropped: ["<id>"]`; "accept it as known debt" has no scripted path in this
  release.
- **Known-gaps promote:** when the rounds run out with the last recheck green
  and only non-regression, non-integration, non-critical majors open, a question offers to
  fast-forward the feature branch to the checked head; the default is leave
  unpromoted. The offer is skipped when `acceptance` or `stopRule` is set (a
  failing row is filed as a plain major, and under a stop rule every open major
  is a regression, a wrong action or an explicitly rated check, so neither can
  be a known gap). If the user picks it: first
  `git -C <repo> fetch <remote> <featureBranch>--wbfix<n>` (the side branch the
  question names), then `git push origin <sha>:refs/heads/<featureBranch>` (`hydra-local` in
  local-only mode; explicit refspec, no force), verify with `ls-remote`, append
  the parked majors to the `decisionLog` as accepted known gaps, or to the briefs
  when there is no log (otherwise the re-run re-files them and docs never sync),
  re-run `stage: "wholeBranch"` for that repo
  (it re-validates, docs-syncs and drift-audits the promoted head), and delete the
  stale `<featureBranch>--wbfix*` refs.
