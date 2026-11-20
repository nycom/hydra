import unittest

from ledger import rounding


class KnownRed(unittest.TestCase):
    def test_upstream_rounding(self):
        # red until the upstream rate table ships its rounding metadata
        self.assertTrue(hasattr(rounding, "UPSTREAM_TABLE"))
