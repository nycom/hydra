"""Rounding for ledger amounts, which are kept in tenths of a cent."""


def round_total(amount):
    """Round an amount in tenths of a cent to whole cents, ties to even."""
    cents, rest = divmod(amount, 10)
    if rest > 5 or (rest == 5 and cents % 2):
        cents += 1
    return cents
