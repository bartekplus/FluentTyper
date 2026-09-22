#!/usr/bin/env python3
"""Tests for rebuild_all's presage.xml aspell-predictor removal.

Run:  python3 -B scripts/test_rebuild_all.py
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rebuild_all import RESOURCES_LANG_TEMPLATE_DIR, _drop_aspell_predictor  # noqa: E402


class DropAspellPredictorTest(unittest.TestCase):
    def _drop(self, xml: str) -> str:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "presage.xml"
            path.write_text(xml, encoding="utf-8")
            _drop_aspell_predictor(path)
            return path.read_text(encoding="utf-8")

    def _predictors(self, xml: str) -> list[str]:
        return xml.split("<PREDICTORS>", 1)[1].split("</PREDICTORS>", 1)[0].split()

    def test_template(self) -> None:
        original = (RESOURCES_LANG_TEMPLATE_DIR / "presage.xml").read_text(encoding="utf-8")
        result = self._drop(original)
        self.assertNotIn("DefaultAspellPredictor", result)
        expected = [p for p in self._predictors(original) if p != "DefaultAspellPredictor"]
        self.assertEqual(self._predictors(result), expected)

    def test_aspell_last_in_list_and_extra_whitespace(self) -> None:
        # No trailing space after the name: a plain "Name " replace misses it.
        xml = (
            "<Presage><PredictorRegistry><PREDICTORS> A\tDefaultAspellPredictor</PREDICTORS>"
            "</PredictorRegistry><Predictors>\n<DefaultAspellPredictor>\n<X>1</X>\n"
            "</DefaultAspellPredictor>\n<A><Y/></A></Predictors></Presage>"
        )
        result = self._drop(xml)
        self.assertNotIn("DefaultAspellPredictor", result)
        self.assertEqual(self._predictors(result), ["A"])
        self.assertIn("<A><Y/></A>", result)


if __name__ == "__main__":
    unittest.main(verbosity=2)
