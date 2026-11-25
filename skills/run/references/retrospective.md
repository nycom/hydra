# Retrospective, its privacy and its follow-up

Read at Finish, before you spawn the retro agent.

- **Retrospective (mandatory), one retro per run:** at Finish, success or
  failure, spawn one `reviewer` agent on `opus`, told to return retro.md filled in and
  not its own review format. Brief it with
  every Workflow return's result JSON from this run in order (the first call
  plus each `stage: "wholeBranch"` re-run), the run args, the feature-branch
  SHAs you already verified, `<skill dir>/retro.md` and, optionally, each launch
  result's `<Transcript dir>/journal.jsonl` (per-agent label, phase and result;
  an agent with a `failed` row died, one `started` with no `result` or `failed`
  row never finished). Tokens are not in the journal: run cost comes from
  `node <skill dir>/cost.mjs <Transcript dir>`; never read the transcripts. A Workflow call that threw gets its error text,
  the results that exist and that journal; a `resumeFromRunId` recovery gets
  its one retro after it returns. It returns retro.md filled in; you save it.
  Eval runs (fixture repos) → `evals/retros/<run id>.md`, the id of its
  `evals/runs/<run id>.json`, in a git clone of nycom/hydra (never the plugin
  cache; ask the user where the clone is if unknown), committed through the
  normal PR flow. Real runs, and any run you are unsure about (treat it as
  real) → the user's private notes location (named in their global
  instructions or memory; ask once if none is set), never inside any git repo.
  Version: `<skill dir>/../../.claude-plugin/plugin.json`.
- **Retro privacy:** everything bound for the public hydra repo (retros,
  changes, eval seeds, PR titles, bodies, branch names, commit messages) is
  generalised: no project, repo, person or host names, no local filesystem
  paths, branch names, URLs, secrets or env values (`gateTail` and `notes` may
  hold them), no code copied from private repos. Names defined in
  skills/run/tests/fixture-scenarios.md and skills/run/tests/fixture/ (fixture
  repos, branches, workstream ids) are public and exempt. Before committing
  there, grep the staged diff and the PR text for the run's other repo paths,
  `featureBranch` names and workstream ids, and the expanded `$HOME` value
  (`echo "$HOME"`); any hit means don't push.
- **Retro follow-up:** merge its Changes and Eval gaps into one ranked list, put
  to the user in AskUserQuestion batches after the run's `questions`. Nothing is
  applied without the user's OK. Approved hydra changes become PRs reviewed
  until clean; approved eval gaps become seeds or scenarios in
  `<skill dir>/tests/fixture-scenarios.md` plus updates to the builder,
  `skills/run/tests/fixture/build.sh`.
