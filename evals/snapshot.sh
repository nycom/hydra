#!/usr/bin/env bash
# Regenerate evals/report.html, render each section to evals/png/<section>.png (light, 2x),
# then rewrite the README eval block and evals/report.sha256.
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
[ -x "$CHROME" ] || { echo "Chrome not found at $CHROME (set CHROME=...)" >&2; exit 1; }

node evals/report.mjs
mkdir -p evals/png
PROFILE="$(mktemp -d)"
trap 'rm -rf "$PROFILE"' EXIT
URL="file://$PWD/evals/report.html"
chrome() { "$CHROME" --headless --user-data-dir="$PROFILE" --no-first-run --no-default-browser-check --hide-scrollbars "$@" 2>/dev/null; }

for s in heatmap scorecard cost pipeline; do
  # first pass: the page measures the isolated section and stamps <body data-size="w,h">
  size="$(chrome --window-size=1400,1200 --dump-dom "$URL?section=$s&theme=light&measure=1" | sed -n 's/.*data-size="\([0-9]*,[0-9]*\)".*/\1/p' | head -1)"
  [ -n "$size" ] || { echo "could not measure section $s" >&2; exit 1; }
  chrome --force-device-scale-factor=2 --window-size="$size" --default-background-color=f9f9f7ff \
    --screenshot="$PWD/evals/png/$s.png" "$URL?section=$s&theme=light"
  echo "evals/png/$s.png ($size @2x)"
done

node evals/report.mjs --readme
