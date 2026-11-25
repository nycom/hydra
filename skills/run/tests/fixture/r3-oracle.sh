#!/usr/bin/env bash
# R3 when receipt_line of <rev> of an alpha repo answers for an expired code instead of raising (S27, see ../fixture-scenarios.md);
# nothing when it raises, or when <rev> has no receipt_line.
#   r3-oracle.sh <alpha repo or bare remote> <rev>
set -euo pipefail
[ $# -eq 2 ] || { echo "usage: r3-oracle.sh <alpha repo> <rev>" >&2; exit 2; }
tree=$(mktemp -d)
trap 'rm -rf "$tree"' EXIT
git -C "$1" archive "$2" | tar -x -C "$tree"
PYTHONDONTWRITEBYTECODE=1 python3 - "$tree" <<'PY'
import sys

sys.path.insert(0, sys.argv[1])
try:
    from ledger.receipt import receipt_line
    receipt_line([{"amount": 10000}], "EXPIRED")
except Exception:
    sys.exit()
print("R3")
PY
