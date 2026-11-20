import unittest

from ledger.store import Store, StoreError, save


class StoreTest(unittest.TestCase):
    def test_save_writes(self):
        store = Store()
        self.assertEqual(save(store, {"id": 1}), {"id": 1})
        self.assertEqual(store.rows, [{"id": 1}])

    def test_full_store_refuses(self):
        with self.assertRaises(StoreError):
            Store(capacity=0).write({"id": 1})
