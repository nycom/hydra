import unittest

from ledger.pager import page


class PagerTest(unittest.TestCase):
    def test_empty(self):
        self.assertEqual(page([], 0, 3), [])

    def test_start_past_end(self):
        self.assertEqual(page([1, 2], 5, 3), [])

    def test_last_page_partial(self):
        self.assertEqual(page([1, 2, 3, 4, 5], 3, 3), [4, 5])
