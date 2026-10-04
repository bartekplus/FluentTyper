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
from build_hunspell_dictionary import _clean_ayaspell_dictionary, convert_dictionary_to_utf8  # noqa: E402

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
بسم/
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
        self.tmp = Path(self.enterContext(tempfile.TemporaryDirectory(prefix="hsp_dict_test_")))
        self.dic = self.tmp / "ar_SA.dic"
        self.dic.write_text(RAW_DICT, encoding="utf-8")

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

    def test_trailing_bare_slash_is_stripped(self) -> None:
        lines = self.cleaned_lines()
        self.assertIn("بسم", lines)
        self.assertNotIn("بسم/", lines)

    def test_header_count_is_rewritten(self) -> None:
        lines = self.cleaned_lines()
        self.assertEqual(self.dic.read_text(encoding="utf-8").splitlines()[0], str(len(lines)))


class Utf8ConversionTest(unittest.TestCase):
    """VERO pt_BR ships Latin-1 with Latin-1 affix flags; Presage speaks UTF-8."""

    AFF = "SET ISO8859-1\r\nTRY ãé\r\nSFX à Y 1\r\nSFX à 0 ção .\r\n"
    DIC = "1\r\ncora/à\r\n"

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory(prefix="hsp_utf8_test_")
        self.tmp = Path(self._tmp.name)
        self.aff = self.tmp / "pt_BR.aff"
        self.dic = self.tmp / "pt_BR.dic"
        self.aff.write_bytes(self.AFF.encode("iso-8859-1"))
        self.dic.write_bytes(self.DIC.encode("iso-8859-1"))

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_converts_to_utf8_with_utf8_flags(self) -> None:
        convert_dictionary_to_utf8(self.aff, self.dic)
        aff = self.aff.read_bytes().decode("utf-8")
        self.assertTrue(aff.startswith("SET UTF-8\r\nFLAG UTF-8\r\nTRY ãé\r\n"))
        self.assertIn("SFX à 0 ção .", aff)
        self.assertEqual(self.dic.read_bytes().decode("utf-8"), self.DIC)

    def test_is_idempotent(self) -> None:
        convert_dictionary_to_utf8(self.aff, self.dic)
        before = (self.aff.read_bytes(), self.dic.read_bytes())
        convert_dictionary_to_utf8(self.aff, self.dic)
        self.assertEqual((self.aff.read_bytes(), self.dic.read_bytes()), before)

    def test_accented_forms_spell_through_hunspell(self) -> None:
        hunspell = shutil.which("hunspell")
        if not hunspell:
            self.skipTest("hunspell binary not available")
        convert_dictionary_to_utf8(self.aff, self.dic)
        proc = subprocess.run(
            [hunspell, "-d", str(self.tmp / "pt_BR"), "-l", "-i", "utf-8"],
            input="coração\ncora\ncoracao\n",
            capture_output=True,
            text=True,
        )
        self.assertEqual(set(proc.stdout.split()), {"coracao"})


class HunspellRoundTripTest(unittest.TestCase):
    """Round-trips the cleaned dictionary through native libhunspell.

    Skipped when no hunspell binary is available, so the suite still runs in
    minimal CI images; the cleaner unit tests above always run.
    """

    HUNSPELL = shutil.which("hunspell")

    def setUp(self) -> None:
        if not self.HUNSPELL:
            self.skipTest("hunspell binary not available")
        self.tmp = Path(self.enterContext(tempfile.TemporaryDirectory(prefix="hsp_roundtrip_")))
        (self.tmp / "ar_SA.aff").write_text(AFF_FIXTURE, encoding="utf-8")
        dic = self.tmp / "ar_SA.dic"
        dic.write_text(RAW_DICT, encoding="utf-8")
        _clean_ayaspell_dictionary(dic)

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
        accepted = ["أريزونا", "وأريزونا", "بأريزونا", "الأدرياتيكي", "والأدرياتيكي", "للأدرياتيكي", "مرحبا", "بسم"]
        self.assertEqual(self._misspelled(accepted), set())

    def test_unflagged_word_does_not_gain_prefixed_forms(self) -> None:
        # `مرحبا` has no flags, so it must not acquire np/mp derivations.
        self.assertEqual(self._misspelled(["ومرحبا"]), {"ومرحبا"})

    def test_nonsense_still_rejected(self) -> None:
        self.assertEqual(self._misspelled(["zzzzqqqq"]), {"zzzzqqqq"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
