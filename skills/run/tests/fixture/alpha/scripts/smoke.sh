#!/usr/bin/env bash
# Calls the real ledger.api.total (no stubs) and checks the wire field contract.yaml names.
set -eu
cd "$(dirname "$0")/.."
python3 - <<'PY'
import sys

from ledger.api import total

body = total([{"amount": 1200}, {"amount": 2300}])
if body.get("total_cents") != 350:
    sys.exit(f"smoke: expected total_cents=350, got {body!r}")
print("smoke ok: total_cents=350")
PY
