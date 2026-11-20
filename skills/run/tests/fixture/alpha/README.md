# alpha ledger

A tiny ledger package. Entry amounts are kept in tenths of a cent; the API reports whole cents.

## Modules

- `ledger/api.py`: `total(entries)` and `check_limit(balance, limit)`
- `ledger/pager.py`: `page(items, start, size)`
- `ledger/discount.py`: `apply(code, amount)`
- `ledger/routes.py`: entry handlers, each checking ownership
- `ledger/store.py`: in-memory store and `save(store, row)`
- `ledger/rounding.py`: `round_total(amount)`, ties to even

The wire contract is `contract.yaml`; beta vendors a copy.

## Gate

    python3 -m unittest discover -s tests -t .

`tests/test_known_red.py` stays red until the upstream rounding table ships.
