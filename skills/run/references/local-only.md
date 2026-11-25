# Local-only mode

Read before section 2 of SKILL.md: the remote must exist before the preflight.

```
  args: {
    localOnly: false,                // optional; true = nothing reaches the network (see Local-only mode)
  }
```

| arg | default | meaning |
|---|---|---|
| `localOnly` | `false` | every fetch, push and `ls-remote` targets the remote `hydra-local`, a bare repo on local disk you set up (see Local-only mode); agents are told never to touch `origin` or any other remote and to run no `gh`; every hygiene section also checks that no run branch has a remote-tracking ref on any other remote; the docs step skips its PR-body update |

**Local-only mode** (`localOnly: true`, e.g. a public fork whose pushes the
user approves by hand): nothing reaches the network. Per touched repo
(docs-only repos included), before the known-red preflight, first run the
no-network check below and stop if it prints anything (a run branch already
pushed by hand would trip every hygiene section); then
`B="$(git -C <repo> rev-parse --path-format=absolute --git-common-dir)/hydra-local.git"`,
`git init --bare -q "$B"`, `git -C <repo> remote add hydra-local "$B"`, then
push the base and the feature branch into it
(`git -C <repo> push hydra-local <base ref>:refs/heads/<base> <featureBranch>:refs/heads/<featureBranch>`)
and `git -C <repo> fetch hydra-local`. Every push, fetch and `ls-remote` in
the run then works unchanged against that local remote. At the end, verify
with `git -C <repo> ls-remote hydra-local` as usual, then fetch the branches
back as local branches without force:
`git -C <repo> fetch hydra-local <featureBranch>:<featureBranch>` plus each
workstream branch and any side branch the result names (a branch checked out
in the user's checkout is refused: tell the user to fast-forward it), and
check `git -C <repo> rev-parse <featureBranch>` equals `finalSha`. Also run the
no-network check yourself: `git -C <repo> for-each-ref --format='%(refname)' 'refs/remotes/*/<featureBranch>' 'refs/remotes/*/<featureBranch>--*'`
plus each workstream branch, filtered with `grep -v '^refs/remotes/hydra-local/'`,
prints nothing. It reads remote-tracking refs, so a push by URL (no
configured remote) leaves none and is invisible to it. Pushing to `origin` stays the
user's step; remove `hydra-local` (`git remote remove`, then the bare repo)
only when they are done with it.
