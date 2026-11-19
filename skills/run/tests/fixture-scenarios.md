# hydra eval: fixture scenarios

Fixture: `alpha` (ledger API + contract.yaml) and `beta` (a client of the contract), with local bare remotes in `eval/remotes/`. Feature branch: `feat/eval`.
Run: the real workflow.js with `cycles: 1`. Score each scenario from git state, the run result and the run journal.

Seeded conditions:
- alpha has a known-red test at base: `tests.test_known_red.KnownRed.test_upstream_rounding`.
- `contract.yaml` and README are hot in alpha. Two alpha workstreams both need README changes, and one needs a contract change.
- alpha-discount must return "the same shape as ledger.api.total". alpha-cents renames that field, so the drift only shows up once the two workstreams are integrated.
- beta-cents depends on alpha-cents's contract change.

| # | Scenario | Pass when |
|---|----------|-----------|
| S1 | All three workstreams merge | result: merged:true for alpha-discount, alpha-cents and beta-cents; each feat/eval contains its work |
| S2 | Shared README edits apply in order, no conflict | alpha README on feat/eval has both the LEDGER_MAX_DISCOUNT row and total_cents; no merge aborted |
| S3 | Hot files are untouched by workstream branches | `git diff feat/eval-base..<ws branch> --name-only` lists no README/contract.yaml; those files changed only in merge-agent commits |
| S4 | The known-red test doesn't block, and nothing else is "allowed" | gates report green with only the knownRed id failing; no improvised exceptions |
| S5 | Review model is one tier above the author | journal: alpha-cents (opus) reviewed on fable, the sonnet workstreams reviewed on opus; validators on opus |
| S6 | Cross-repo contract check runs once, after both repos are final | exactly 1 contract agent, started after both repos' whole-branch stages; verdict pass (beta reads total_cents) |
| S7 | Integration drift is caught | the whole-branch review or validator flags discount's `total` vs `total_cents`, and it ends fixed or escalated, not silently merged |
| S8 | Merges land the validated SHA | each workstream's merge commit has the validated SHA as its second parent |
| S9 | Docs sync is gated and validated | a docs agent per repo; a docs validator whenever a docs commit exists; the gate ran |
| S10 | Hygiene | no co-authored-by / generated-with / claude / anthropic / `.claude/` in any commit message or file on feat/eval |
| S11 | Convergence | no workstream ran past cycle 1 unless a critical/major was open; any extension is justified in the result |
| S12 | Budget and result shape | the result reports budget use; it has the questions/notes split and per-workstream status |
