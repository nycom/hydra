import unittest

from ledger.routes import delete_entry, get_entry, update_entry


def entry():
    return {"id": 1, "owner": "ann", "amount": 500}


class RoutesTest(unittest.TestCase):
    def test_owner_reads(self):
        self.assertEqual(get_entry("ann", entry())["id"], 1)

    def test_owner_updates(self):
        self.assertEqual(update_entry("ann", entry(), 700)["amount"], 700)

    def test_owner_deletes(self):
        e = entry()
        entries = [e]
        delete_entry("ann", e, entries)
        self.assertEqual(entries, [])

    def test_stranger_cannot_read(self):
        with self.assertRaises(PermissionError):
            get_entry("bob", entry())

    def test_stranger_cannot_update(self):
        with self.assertRaises(PermissionError):
            update_entry("bob", entry(), 700)
