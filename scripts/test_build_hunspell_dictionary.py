#!/usr/bin/env python3
"""Tests for the AyaSpell dictionary cleaner in build_hunspell_dictionary.

Covers the review finding: the cleaner used to treat ``word/np`` and
``word/mp`` as "unsupported plural markers" and strip the flags, but the
dictionary declares ``FLAG long`` and the shipped ``.aff`` defines real
``PFX np`` / ``PFX mp`` classes — so those flags drive working morphology and
must survive cleaning.

Run:  python scripts/test_build_hunspell_dictionary.py
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_hunspell_dictionary import _clean_ayaspell_dictionary  # noqa: E402

# A reduced slice of the real AyaSpell build dict: roll-up header, section
# separators, a section-name line, standalone comment lines, and entries that
# carry affix flags — some with a trailing inline comment.
RAW_DICT = """\
4 sample.tmp.dic
::::::::::::::
stopwords.dic
::::::::::::::
# a standalone comment line
مرحبا
كتاب
أريزونا/np
الأدرياتيكي/mp\t#مكان:بحر/خليج/مضيق
زروقي/np\t# المطوّر
"""

# Minimal affix file mirroring the shipped semantics: FLAG long, plus real
# prefix classes named np and mp.
AFF_FIXTURE = """\
SET UTF-8
FLAG long
PFX np Y 2
PFX np 0 و .
PFX np 0 ب .
PFX mp Y 2
PFX mp 0 و .
PFX mp ال لل ال
"""


class DictionaryCleanerTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory(prefix="hsp_dict_test_")
        self.tmp = Path(self._tmp.name)
        self.dic = self.tmp / "ar_SA.dic"
        self.dic.write_text(RAW_DICT, encoding="utf-8")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def cleaned_lines(self) -> list[str]:
        _clean_ayaspell_dictionary(self.dic)
        text = self.dic.read_text(encoding="utf-8")
        return text.splitlines()[1:]  # drop the rewritten count header

    def test_affix_flags_survive_cleaning(self) -> None:
        lines = self.cleaned_lines()
        self.assertIn("أريزونا/np", lines)
        self.assertIn("الأدرياتيكي/mp", lines)
        self.assertIn("زروقي/np", lines)

    def test_structural_junk_is_removed(self) -> None:
        lines = self.cleaned_lines()
        for junk in ("", "sample.tmp.dic", "4 sample.tmp.dic", "stopwords.dic"):
            self.assertNotIn(junk, lines)
        self.assertFalse([ln for ln in lines if ln.startswith(":")], "separators survived")
        self.assertFalse([ln for ln in lines if ln.startswith("#")], "comments survived")
        self.assertFalse([ln for ln in lines if "#" in ln], "inline comments survived")

    def test_plain_words_are_kept(self) -> None:
        lines = self.cleaned_lines()
        self.assertIn("مرحبا", lines)
        self.assertIn("كتاب", lines)

    def test_header_count_is_rewritten(self) -> None:
        lines = self.cleaned_lines()
        self.assertEqual(self.dic.read_text(encoding="utf-8").splitlines()[0], str(len(lines)))


def _find_hunspell() -> str | None:
    for candidate in (
        "/tmp/mamba/autotools/bin/hunspell",
        shutil.which("hunspell"),
    ):
        if candidate and Path(candidate).exists():
            return str(candidate)
    return None


class HunspellRoundTripTest(unittest.TestCase):
    """Round-trips the cleaned dictionary through native libhunspell.

    Skipped when no hunspell binary is available, so the suite still runs in
    minimal CI images; the cleaner unit tests above always run.
    """

    HUNSPELL = _find_hunspell()

    def setUp(self) -> None:
        if not self.HUNSPELL:
            self.skipTest("hunspell binary not available")
        self._tmp = tempfile.TemporaryDirectory(prefix="hsp_roundtrip_")
        self.tmp = Path(self._tmp.name)
        (self.tmp / "ar_SA.aff").write_text(AFF_FIXTURE, encoding="utf-8")
        dic = self.tmp / "ar_SA.dic"
        dic.write_text(RAW_DICT, encoding="utf-8")
        _clean_ayaspell_dictionary(dic)

    def tearDown(self) -> None:
        if hasattr(self, "_tmp"):
            self._tmp.cleanup()

    def _misspelled(self, words: list[str]) -> set[str]:
        proc = subprocess.run(
            [str(self.HUNSPELL), "-d", str(self.tmp / "ar_SA"), "-l", "-i", "utf-8"],
            input="\n".join(words) + "\n",
            capture_output=True,
            text=True,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return set(proc.stdout.split())

    def test_flagged_base_and_prefixed_forms_are_accepted(self) -> None:
        # np: و + ب prefixes; mp: و prefix and ال -> لل substitution.
        accepted = ["أريزونا", "وأريزونا", "بأريزونا", "الأدرياتيكي", "والأدرياتيكي", "للأدرياتيكي", "مرحبا"]
        self.assertEqual(self._misspelled(accepted), set())

    def test_unflagged_word_does_not_gain_prefixed_forms(self) -> None:
        # `مرحبا` has no flags, so it must not acquire np/mp derivations.
        self.assertEqual(self._misspelled(["ومرحبا"]), {"ومرحبا"})

    def test_nonsense_still_rejected(self) -> None:
        self.assertEqual(self._misspelled(["zzzzqqqq"]), {"zzzzqqqq"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
