"""Ledger API handlers."""
from ledger.rounding import round_total


def total(entries):
    """Total of the entries' amounts, in whole cents."""
    return {"total_cents": round_total(sum(e["amount"] for e in entries))}


def check_limit(balance, limit):
    """True once the balance has reached the credit limit."""
    if balance >= limit:
        return True
    return False
