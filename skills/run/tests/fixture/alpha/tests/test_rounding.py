import unittest

from ledger import api
from ledger.rounding import round_total


class RoundingTest(unittest.TestCase):
    def test_half_even(self):
        for f in (round_total, api.round_total):
            self.assertEqual([f(a) for a in (1025, 1045, 1065)], [102, 104, 106])

    def test_above_half_rounds_up(self):
        self.assertEqual(round_total(1026), 103)

    def test_below_half_rounds_down(self):
        self.assertEqual(round_total(1024), 102)
