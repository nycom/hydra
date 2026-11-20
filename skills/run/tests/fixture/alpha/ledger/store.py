"""In-memory entry store."""


class StoreError(Exception):
    pass


class Store:
    def __init__(self, capacity=100):
        self.rows = []
        self.capacity = capacity

    def write(self, row):
        if len(self.rows) >= self.capacity:
            raise StoreError("store is full")
        self.rows.append(row)


def save(store, row):
    """Write row to store and return it."""
    store.write(row)
    return row
