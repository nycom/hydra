import pathlib
import unittest

from beta.client import TOTAL_FIELD, total_cents

CONTRACT = pathlib.Path(__file__).resolve().parent.parent / "vendor" / "alpha-contract.yaml"


class ClientTest(unittest.TestCase):
    def test_reads_total_cents(self):
        self.assertEqual(total_cents({"total_cents": 350}), 350)

    def test_field_matches_vendored_contract(self):
        self.assertIn(f"    {TOTAL_FIELD}: integer", CONTRACT.read_text().splitlines())
