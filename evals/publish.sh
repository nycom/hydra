#!/usr/bin/env bash
# From scored run files to a tree ready to push: validate the runs, snapshot (report, PNGs, README block, sha), test,
# refuse private text, print what changed and the steps left to a human. Never commits, pushes or republishes anything.
set -euo pipefail
cd "$(dirname "$0")/.."
git rev-parse -q --verify origin/main >/dev/null || { echo "publish.sh: no origin/main to compare with (git fetch origin main)" >&2; exit 1; }

node -e "import('./evals/report.mjs').then(m => console.log('ok   ' + m.loadRuns().length + ' valid runs'))"
evals/snapshot.sh || { echo "publish.sh: snapshot.sh failed (it stops without a word when Chrome exits non-zero, as it can on a loaded machine): re-run" >&2; exit 1; }
node evals/report.test.mjs

# bracketed, so this file does not match its own rule
PRIVATE='/[U]sers/[A-Za-z]|/[h]ome/[a-z]|-[U]sers-[A-Za-z]|co-authored[-]by|generated[ ]with'
changed=() bad=''
while IFS= read -r -d '' f; do
  [ -f "$f" ] || continue # deleted
  changed+=("$f")
  url='claude[.]ai/'
  case $f in *.mjs|*.sh) url="://([a-z0-9-]+[.])*$url" ;; esac # a script may name the host in its own rules and tests, never a whole link
  if hit=$(LC_ALL=C grep -aniE -m 3 -o ".{0,40}($PRIVATE|$url).{0,40}" "$f"); then bad="$bad$(printf '%s: %s\n' "$f" "$hit")"$'\n'; fi
done < <(git diff -z --name-only origin/main -- evals README.md; git ls-files -z --others --exclude-standard -- evals README.md)
[ -z "$bad" ] || { printf 'publish.sh: refused, private text in files that differ from origin/main:\n%s' "$bad" >&2; exit 1; }
[ ${#changed[@]} -gt 0 ] || { echo "nothing differs from origin/main"; exit 0; }

version=$(node -e "import('./evals/report.mjs').then(m => console.log(m.loadRuns().map(e => e.run.hydraVersion).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).pop()))")
score=$(sed -n 's/^\*\*Combined score:\*\* //p' README.md)
echo
echo "Differs from origin/main ($(git rev-parse --short origin/main)), no private text found:"
printf '  %s\n' "${changed[@]}"
cat <<STEPS

Left to you (combined $score):
  1. git switch -c evals/$version        # skip when already on a branch for this
  2. git add evals README.md && git diff --cached --stat && git commit -m "Live eval on $version: combined $score"
  3. git push -u origin HEAD
  4. gh pr create --base main --title "Live eval on $version" --body "Combined $score"
  5. after the merge, republish evals/report.html to its existing artifact link
STEPS
