# Hydra retro: <run id, or date and topic>

Sources: every Workflow result JSON of the run (in order), the run args and the
verified feature-branch SHAs. The journal is optional and never a required input:
`<Transcript dir>/journal.jsonl` holds each agent's label, phase and result (a
`failed` row is a dead agent, a `started` with no `result` or `failed` row is unfinished), and
`node <skill dir>/cost.mjs <Transcript dir>` gives output and context tokens and agents per
stage, total wall minutes, and the failed and unfinished agents. Never read the
transcripts. Without a journal, write "journal not read" under Not checked. Quote evidence as `<result path> = <value>`
(e.g. `workstreams[id=alpha].extended = true`) or a finding id. A claim with no
evidence goes to Not checked. Omit a prompt with nothing to report; a section with
nothing at all is the single word none; a null crossRepo or docs is not a finding.
Keep it to about 120 lines.

Privacy: anything bound for the public repo (Changes, Eval gaps, the whole file on
an eval run) is generalised. No project, repo, person or host names, no local paths,
branch names, URLs, secrets or env values (`workstreams[].gateTail` and
`workstreams[].notes` may hold them), no code from private repos; describe the
shape. Fixture names from tests/fixture-scenarios.md and tests/fixture/ are public.

Finding ids: `c<i>-F<n>` review; `v<i>-F<n>`, `v<i>-R<n>`, `v<i>-G` workstream
validator; `M-F1` rejected merge; `W-F<n>` whole-branch review; `V-F<n>`, `V-G`
whole-branch validator; `R<n>-F<m>`, `R<n>-G` recheck; `D-F<n>`, `D-G`, `D-X`, `D-P`
docs; `X-F<n>` contracts; `<ws id>:<id>` a workstream minor carried to the
whole-branch pass. Each one's stage and status are in `workstreams[].findings`,
`repos[].findings`, `otherDocs[].findings` and `crossRepo.ledger`. `open` in the
ledger means no validator accepted it; it may be absent from `open` (a minor nobody
re-raised, or an escalation awaiting the user). Count a carried minor once.

## Run

- Date:
- Hydra version: (`version` in plugin.json)
- Scenario: (fixture scenario ids and `evals/runs/<run id>.json`, or "real run")
- Calls: first run plus N `stage: "wholeBranch"` re-runs; any call that threw (error text)
- Args summary: workstream count and models, repo count, cycles, maxCycles,
  wbRounds, tokenBudget, tokenReserve, smoke / checks / quickGate set or not
- Outcome: `workstreams[].status` and `workstreams[].merged` per workstream,
  `repos[].verdict`, `repos[].finalSha` (verified), `repos[].docs.verdict`,
  `otherDocs[].docs.verdict`, `crossRepo.verdict`

## Process

What went wrong or slow, one bullet each, with evidence:

- Dead agents: `workstreams[].escalations` / `repos[].escalations` entries saying
  "died 3 times" (two replacements both died too). An agent that died and was
  replaced successfully is not in the result: cost.mjs `failed` and `unfinished`
  name them when the journal was passed.
- Extended cycles: `workstreams[].extended`, `workstreams[].cyclesRun` against
  `cycles`; was a critical/major open each time?
- Escalations and questions: top-level `questions` (an open cross-repo contract
  blocker), `workstreams[].escalations`, `workstreams[].questions`,
  `repos[].escalations`, `repos[].questions` (opus-fix survivors, unpromoted side
  branches, SHA mismatches)
- Budget and reserve stops: `budget.stoppedBy`, `budget.reserve`, `budget.spent`
  against `budget.tokenBudget` (`budget.turnTotal` is the user's turn target)
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

- Evals: recall, false positives and the pass verdict live in
  `evals/runs/<run id>.json`; point at it, don't restate its tables. Add only what
  it lacks: which finding id caught each seed and why a miss slipped through.
  Ledger stage -> evals catcher: review, wb-review -> reviewer; validate, wb-validate, recheck, docs -> validator; a finding on a deleted, skipped or weakened pre-existing test from validate, wb-validate or recheck -> test-guard (the same finding from review or wb-review stays reviewer); contract -> contract; merge (`M-F1`, script-raised) -> no catcher.
- Findings: counts by severity, kind, stage and status from the findings lists;
  `workstreams[].findingsFixed` is only a count of verified ids.
- Cost: `budget.spent` is session-wide (the coordinator plus parallel agents):
  use it only against `budget.tokenBudget` and `budget.stoppedBy`. Run cost comes
  from cost.mjs (needs the journal): `outputTokens`, `agents`, `wallMinutes` and
  the top 3 of `byStage`, plus `contextTokens` where a stage's context outweighs its
  output (reported, never scored); otherwise "journal not read".

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
