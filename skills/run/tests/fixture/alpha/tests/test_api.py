import unittest

from ledger.api import check_limit, total


class ApiTest(unittest.TestCase):
    def test_total_sums_entries(self):
        self.assertEqual(list(total([{"amount": 1200}, {"amount": 2300}]).values()), [350])

    def test_total_empty(self):
        self.assertEqual(list(total([]).values()), [0])

    def test_under_limit(self):
        self.assertFalse(check_limit(50, 100))

    def test_over_limit(self):
        self.assertTrue(check_limit(150, 100))
