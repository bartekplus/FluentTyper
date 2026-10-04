#!/usr/bin/env python3
"""Tests for gen_ngram's token filtering and the ngramtxt2marisa arguments.

Run:  python3 -B scripts/test_gen_ngram.py
"""

from __future__ import annotations

import importlib.util
import subprocess
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


@unittest.skipUnless(importlib.util.find_spec("marisa_trie"), "marisa-trie is not installed")
class NgramTxt2MarisaArgsTest(unittest.TestCase):
    def test_input_and_output_are_required(self) -> None:
        script = Path(__file__).resolve().parent / "ngramtxt2marisa.py"
        result = subprocess.run(
            [sys.executable, "-B", str(script)], capture_output=True, text=True, check=False
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("--inputfile", result.stderr)
        self.assertIn("--output", result.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
