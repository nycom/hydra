"""Paging over entry lists."""


def page(items, start, size):
    """The page of items beginning at index start, at most size long."""
    return items[start:start+size]
