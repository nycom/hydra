## Stacked mode (only when the user asks)

Default stays one feature branch per repo; stack slices only on the user's ask.

- **A slice is one ordinary run:** `featureBranch` = the slice, `base` = its
  parent slice (`main` for slice 1). Slices run strictly in sequence: cut slice
  N+1 from slice N's verified tip only after slice N's run returns. The review
  range is already three-dot `origin/<parent>...origin/<slice>`. Before any
  `wholeBranch` re-run when the parent moved, a fresh `implementer` merges the
  parent up into the slice (merge, never rebase). Slices go bottom-first: after
  any re-run whose `finalSha` moved, up-merge into every child.
- **Briefs:** paste earlier slices' findings (fixed and declined) into every
  later slice's brief. Each slice PR body carries the stack table:
  `| # | branch | base | status | merge after #N |`.
- **Whole-stack pass:** `stage: "wholeBranch"`, `wbRounds: 0`,
  `docsRepos: []` (review only: no fix, no docs commit, `finalSha` stays the
  reviewed SHA), and every workstream entry rewritten to `featureBranch` = top
  slice and `base: "main"` (otherwise the script throws "workstreams
  disagree"). Route each returned finding to the slice that
  owns its lines, via a fresh `implementer` on that slice; then merge upward
  bottom-first, each child running
  `git -c rerere.enabled=true -c rerere.autoupdate=true merge origin/<parent>`;
  re-run `stage: "wholeBranch"` per touched slice (`base` = its parent).
- **Merge-settings preflight:** `gh api repos/{owner}/{repo} --jq
  '{allow_merge_commit, allow_squash_merge, allow_rebase_merge}'`. Merge commits
  allowed → recommend them; squash-only → warn the user, don't refuse.
- **Hand-off recipe for the user** (merging stays theirs): merge slice N
  WITHOUT `--delete-branch` (deleting a base closes the child PR); run
  `gh pr edit <N+1> --base <N's base>`; delete N's branch only once
  `gh pr list --base <N's branch>` is empty.
- **After a squashed parent:** with `H` = the parent PR's merged head
  (`gh pr view <N> --json headRefOid -q .headRefOid`; once its branch is
  deleted, `git fetch origin refs/pull/<N>/head` brings the commit back), first
  check `git merge-base --is-ancestor <H> origin/<child>`. If it fails, merge
  `H` into the child first; otherwise "take ours" could drop parent changes.
  Then the child merges `origin/main`. Per conflicted file: if
  `git rev-parse origin/main:<file>` equals `git rev-parse <H>:<file>`, take
  ours (`git checkout --ours <file>`); anything else, a file missing on either
  side included, is a real conflict → fixer. **Supervised until the user
  waives it:** the agent stops before pushing and leaves its worktree in place
  for the push; you show the user each auto-resolved file with its diff, and it
  pushes only on the user's yes.
- **Refuse** only for GitHub-native stacks or a parent PR with no `headRefOid`.
- **CI:** slice PRs 2..n target non-`main` bases, so workflow branch filters
  may run no remote CI on them; say so in each PR body. The per-slice local
  gate stays mandatory.
