#!/usr/bin/env python3
"""Tests for build_aspell_dictionary extraction and copy containment.

Run:  python3 -B scripts/test_build_aspell_dictionary.py
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_aspell_dictionary import _bsdtar, copy_tree_contents, extract_archive  # noqa: E402


def has_bsdtar() -> bool:
    try:
        _bsdtar()
        return True
    except RuntimeError:
        return False


class AspellDictionaryTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory(prefix="aspell_test_")
        self.parent = Path(self._tmp.name)
        self.dest = self.parent / "extract"
        self.dest.mkdir()

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_copy_tree_skips_escaping_link(self) -> None:
        secret = self.parent / "secret.txt"
        secret.write_text("SECRET")
        src = self.dest / "usr/lib/aspell-0.60"
        src.mkdir(parents=True)
        (src / "leak.dat").symlink_to(secret)
        (src / "ok.dat").write_text("ok")
        (src / "alias.dat").symlink_to("ok.dat")
        out = self.parent / "out"
        out.mkdir()
        copy_tree_contents(src, out, self.dest)
        self.assertFalse((out / "leak.dat").exists())
        self.assertEqual((out / "ok.dat").read_text(), "ok")
        self.assertEqual((out / "alias.dat").read_text(), "ok")

    @unittest.skipUnless(has_bsdtar(), "bsdtar not installed")
    def test_extract_archive_confines_members(self) -> None:
        src = self.parent / "src"
        (src / "usr/lib/aspell-0.60").mkdir(parents=True)
        (src / "usr/lib/aspell-0.60/de.rws").write_text("data")
        (self.parent / "escaped.txt").write_text("escaped")
        archive = self.parent / "dict.tar.gz"
        # -P stores the `../escaped.txt` member verbatim so extraction must reject it.
        subprocess.run(
            [_bsdtar(), "-czPf", str(archive), "-C", str(src), "usr", "../escaped.txt"],
            check=True,
        )
        (self.parent / "escaped.txt").unlink()
        with self.assertRaises(subprocess.CalledProcessError):
            extract_archive(archive, self.dest)
        self.assertEqual((self.dest / "usr/lib/aspell-0.60/de.rws").read_text(), "data")
        self.assertFalse((self.parent / "escaped.txt").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
