"""Discount codes."""


def apply(code, amount):
    """Apply a discount code to an amount; unknown codes leave it unchanged."""
    if code == "SAVE10":
        return amount - amount // 10
    elif code == "EXPIRED":
        raise ValueError("discount code expired")
    return amount
