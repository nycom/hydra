"""Client for the ledger API's total endpoint."""

TOTAL_FIELD = "total_cents"  # the total response field in vendor/alpha-contract.yaml


def total_cents(payload):
    """Whole cents from a ledger total response."""
    return payload[TOTAL_FIELD]
