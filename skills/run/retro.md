# Hydra retro: <YYYY-MM-DD> <scenario or topic>

Sources: every Workflow result JSON of the run (in order), the run args and the
verified feature-branch SHAs. The journal path is optional and never a required
input: read it only to attribute per-agent cost or a dead agent; without it write
"journal not read" under Not checked. Quote evidence as `<result path> = <value>`
(e.g. `workstreams[id=alpha].extended = true`) or a finding id. A claim with no
evidence goes to Not checked. Write "none" in an empty section; never drop one.
Keep it to about 120 lines.

Privacy: anything bound for the public repo (Changes, Eval gaps, the whole file on
an eval run) is generalised. No project, repo, person or host names, no local paths,
branch names, URLs, secrets or env values (`workstreams[].gateTail` and
`workstreams[].notes` may hold them), no code from private repos; describe the shape.

Finding ids: `c<i>-F<n>` review; `v<i>-F<n>`, `v<i>-R<n>`, `v<i>-G` workstream
validator; `M-F1` rejected merge; `W-F<n>` whole-branch review; `V-F<n>`, `V-G`
whole-branch validator; `R<n>-F<m>`, `R<n>-G` recheck; `D-F<n>`, `D-G`, `D-X`, `D-P`
docs; `X-F<n>` contracts; `<ws id>:<id>` a workstream minor carried to the
whole-branch pass. Each one's stage and status are in `workstreams[].findings`,
`repos[].findings`, `otherDocs[].findings` and `crossRepo.ledger`.

## Run

- Date:
- Hydra version: (`version` in plugin.json)
- Scenario: (fixture scenario ids, or "real run")
- Calls: first run plus N `stage: "wholeBranch"` re-runs; any call that threw (error text)
- Args summary: workstream count and models, repo count, cycles, maxCycles,
  wbRounds, tokenBudget, tokenReserve, smoke / checks / quickGate set or not
- Outcome: `workstreams[].merged` per workstream, `repos[].verdict`,
  `repos[].finalSha` (verified), `repos[].docs.verdict`, `otherDocs[].docs.verdict`,
  `crossRepo.verdict`

## Process

What went wrong or slow, one bullet each, with evidence:

- Dead agents: `workstreams[].escalations` / `repos[].escalations` entries saying
  "died 3 times" (two replacements both died too). An agent that died and was
  replaced successfully is not in the result: journal only.
- Extended cycles: `workstreams[].extended`, `workstreams[].cyclesRun` against
  `cycles`; was a critical/major open each time?
- Escalations and questions: `workstreams[].escalations`, `workstreams[].questions`,
  `repos[].escalations`, `repos[].questions` (opus-fix survivors, unpromoted side
  branches, SHA mismatches)
- Budget and reserve stops: `budget.stoppedBy`, `budget.spent` against
  `budget.tokenBudget` and `budget.turnTotal`, `budget.reserve`
- Prompt confusion visible in `workstreams[].notes` or `repos[].notes` (a misread
  rule, a skipped step, an invented allowed failure, a wrong SHA or range)
- Late catches: a finding whose stage is later than the stage that should have
  caught it (a `wb-review` finding inside one workstream's files, a `validate`
  finding the `review` missed, a `contract` finding visible in `repos[].seams`).
  Name both stages and the id.
- Merge and promote trouble: rejected merges (merge notes in `workstreams[].notes`,
  `M-F1` in `workstreams[].findings`), `repos[].fixRounds`, `repos[].flaky`,
  `repos[].docs.ok` false, `repos[].docs.findings`

## Data

- Evals only: recall per seed (caught / total, the stage that caught each, the
  misses) and false positives on the control (major-or-above findings that map to
  no seed and no real flaw). Scenario pass/fail table.
- Findings: counts by severity, kind, stage and status from the findings lists;
  `workstreams[].findingsFixed` is only a count of verified ids.
- Cost: `budget.spent` of each call and their sum, against `budget.tokenBudget`
  or `budget.turnTotal`; what `budget.stoppedBy` cut. Per-agent hotspots only if
  the journal was read.

## Changes, ranked

At most 5, highest expected gain per cost first:

1. target: hydra | evals
   what: the change, one or two sentences
   evidence: the result path and value, or the finding id, that shows the problem
   expected gain: what gets faster, cheaper or caught earlier, and roughly how much
   cost: XS | S | M

## Eval gaps

Each real miss or failure mode from this run that no scenario in
`tests/fixture-scenarios.md` covers, as a new seed (file and line shape, like the
S15 table) or scenario (`| S<n> | Scenario | Pass when |`), generalised.

## Not checked

What this retro could not verify ("journal not read", unreadable results, claims
left without evidence).
