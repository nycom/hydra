#!/usr/bin/env bash
# The S17 seeds (W1-W4, see ../fixture-scenarios.md) present at <rev> of an alpha repo, by behaviour, space-separated.
# Score with the reviewed head (the implement commit): a seed it no longer finds there is discarded.
#   ws-oracle.sh <alpha repo or bare remote> <rev>
set -euo pipefail
[ $# -eq 2 ] || { echo "usage: ws-oracle.sh <alpha repo> <rev>" >&2; exit 2; }
tree=$(mktemp -d)
trap 'rm -rf "$tree"' EXIT
git -C "$1" archive "$2" | tar -x -C "$tree"
PYTHONDONTWRITEBYTECODE=1 python3 - "$tree" <<'PY'
import io, sys, unittest

sys.path.insert(0, sys.argv[1])
from ledger.report import summary
import tests.test_owners as t

def raises(exc, f, *a):
    try:
        f(*a)
    except exc:
        return True
    return False

# W3: the owners tests must notice a distinct_owners that is right everywhere but on the empty list
t.distinct_owners = lambda entries: sorted({e["owner"] for e in entries}) if entries else ["x"]
guard = unittest.TextTestRunner(stream=io.StringIO()).run(unittest.defaultTestLoader.loadTestsFromModule(t))
mine = {"id": 1, "owner": " ann "}
summary([mine])
ok = {  # W1, W2 and W4 through summary, so a report.py that masks the helper's flaw counts as the seed gone
    "W1": mine == {"id": 1, "owner": " ann "},
    "W2": summary([{"id": 1, "owner": "Ann"}, {"id": 2, "owner": "ann"}])["owners"] == ["Ann", "ann"],
    "W3": not guard.wasSuccessful(),
    "W4": raises(KeyError, summary, [{"id": 1}]),
}
print(" ".join(k for k, v in ok.items() if not v))
PY
