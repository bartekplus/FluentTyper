#!/usr/bin/env python3
"""Tests for gen_ngram's token filtering.

Run:  python3 -B scripts/test_gen_ngram.py
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gen_ngram import filter_tokens  # noqa: E402


class FilterTokensTest(unittest.TestCase):
    def test_arabic_tatweel_and_harakat_are_stripped(self) -> None:
        # كتـــاب (tatweel), كِتَابٌ (kasra/fatha/dammatan), هٰذا (superscript alef)
        tokens = ["كتـــاب", "كِتَابٌ", "هٰذا", "ـــ"]
        self.assertEqual(filter_tokens(tokens, "ar"), [["كتاب", "كتاب", "هذا"], []])

    def test_other_languages_are_untouched(self) -> None:
        self.assertEqual(filter_tokens(["Hello", "world"], "en"), [["hello", "world"]])


if __name__ == "__main__":
    unittest.main(verbosity=2)
