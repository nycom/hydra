# Hydra retro: <YYYY-MM-DD> <scenario or topic>

Fill every section from the result JSON, the run args, the feature-branch tips and
the run journal. Quote evidence as `<path in the result> = <value>` (e.g.
`workstreams[alpha].extended = true`) or a finding id (`c2-F3`, `W-F1`). A claim with
no evidence goes to Not checked. Write "none" in an empty section; never drop one.
Anything bound for the public repo (Changes, Eval gaps, the whole file on an eval
run) is generalised: no project, repo, person or host names, no code from private
repos; describe the shape instead.

## Run

- Date:
- Hydra version: (plugin.json `version`)
- Scenario: (fixture scenario ids, e.g. S1-S16, or "real run")
- Args summary: workstreams (count, models), repos, `cycles`, `maxCycles`,
  `stage`, `wbRounds`, `tokenBudget`, `tokenReserve`, smoke/checks/quickGate set or not
- Outcome: merged / not merged per workstream, `repos[].verdict`, `crossRepo.verdict`,
  `finalSha` per repo (and whether `ls-remote` matched)

## Process

What went wrong or slow, one bullet each, with evidence:

- Dead agents and their replacements (`escalations` "died", attempt labels in the journal)
- Extended cycles (`workstreams[].extended`, `cyclesRun` vs `cycles`) and whether an
  open critical/major justified each
- Escalations and questions (`workstreams[].escalations`, `.questions`,
  `repos[].escalations`), including opus-fix survivors and unpromoted side branches
- Budget and reserve stops (`budget.stoppedBy`, `budget.spent` vs `tokenBudget`)
- Prompt confusion visible in `notes` (an agent misreading a rule, skipping a step,
  inventing an allowed failure, wrong SHA or range)
- Late catches: any finding a later stage raised that an earlier stage should have
  (e.g. a whole-branch `W-*` finding inside one workstream's files, a validator `v*`
  finding the review missed, a `crossRepo` finding visible in a single repo's
  `seams`). Name both stages.
- Merge and promote trouble (`repos[].fixRounds`, rejected merges, `flaky` growth,
  `docs.ok: false`)

## Data

- Evals only: recall per seed (caught / total, which stage caught each, which
  missed) and false positives on the control (major-or-above findings that map to
  no seed or real flaw). Scenario pass/fail table.
- Findings by severity x kind, and by stage (review, validator, whole-branch,
  recheck, contracts, docs), from `findingsFixed`, `open` and the journal.
- Cost per stage (implement, review, fix, validate, merge, whole-branch, contracts,
  docs, promote) in output tokens and agent count, from the journal; total =
  `budget.spent`. Name the top 3 hotspots and why each cost what it did.

## Changes, ranked

Highest expected gain per cost first. One entry each:

1. target: hydra | evals
   what: the change, one or two sentences
   evidence: the result field or finding id that shows the problem
   expected gain: what gets faster, cheaper or caught earlier, and roughly how much
   cost: XS | S | M

## Eval gaps

Each real miss or failure mode from this run that no scenario in
`tests/fixture-scenarios.md` covers, proposed as a new seed or scenario with its exact
shape (file and line shape for a seed, `| S<n> | Scenario | Pass when |` row for a
scenario), generalised.

## Not checked

What this retro could not verify (missing journal, unreadable branches, cost data
not available, claims left without evidence).
