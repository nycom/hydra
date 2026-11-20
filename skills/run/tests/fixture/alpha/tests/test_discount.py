import unittest

from ledger.discount import apply


class DiscountTest(unittest.TestCase):
    def test_save10(self):
        self.assertEqual(apply("SAVE10", 1000), 900)

    def test_unknown_code(self):
        self.assertEqual(apply("NOPE", 1000), 1000)
