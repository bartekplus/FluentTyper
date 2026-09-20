#!/usr/bin/env python3
"""Tests for the RPM/newc-cpio extraction path in build_aspell_dictionary.

Covers the R1 review finding: archive member names come from an untrusted
downloaded package, so extraction must be confined to the destination
directory.  Each malicious fixture asserts that no file was created or
modified OUTSIDE the extraction directory.

Run:  python scripts/test_build_aspell_dictionary.py
"""

from __future__ import annotations

import gzip
import os
import stat
import struct
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_aspell_dictionary import _extract_newc_cpio, _extract_rpm  # noqa: E402

# newc cpio mode values (S_IFMT | permissions)
MODE_FILE = stat.S_IFREG | 0o644
MODE_DIR = stat.S_IFDIR | 0o755
MODE_SYMLINK = stat.S_IFLNK | 0o777


def cpio_member(name: str, mode: int, content: bytes = b"") -> bytes:
    """Build one newc cpio member (header + name + content, 4-byte aligned).

    newc header field order (all 8-byte uppercase hex, 110 bytes total):
    magic(6) ino mode uid gid nlink mtime filesize devmajor devminor
    rdevmajor rdevminor namesize check
    """
    name_bytes = name.encode("utf-8") + b"\x00"
    header = (
        b"070701"
        + b"0" * 8  # ino
        + format(mode, "08X").encode()  # mode
        + b"00000000"  # uid
        + b"00000000"  # gid
        + b"00000000"  # nlink
        + b"00000000"  # mtime
        + format(len(content), "08X").encode()  # filesize
        + b"00000000"  # devmajor
        + b"00000000"  # devminor
        + b"00000000"  # rdevmajor
        + b"00000000"  # rdevminor
        + format(len(name_bytes), "08X").encode()  # namesize
        + b"00000000"  # check
    )
    assert len(header) == 110
    body = header + name_bytes
    body += b"\x00" * ((4 - len(body) % 4) % 4)
    return body + content + (b"\x00" * ((4 - len(content) % 4) % 4) if content else b"")


def cpio_archive(members: list[tuple[str, int, bytes]]) -> bytes:
    trailer_name = b"TRAILER!!!\x00"
    trailer = (
        b"070701"
        + b"0" * 8  # ino
        + b"00000000"  # mode
        + b"00000000"  # uid
        + b"00000000"  # gid
        + b"00000000"  # nlink
        + b"00000000"  # mtime
        + b"00000000"  # filesize
        + b"00000000"  # devmajor
        + b"00000000"  # devminor
        + b"00000000"  # rdevmajor
        + b"00000000"  # rdevminor
        + format(len(trailer_name), "08X").encode()  # namesize
        + b"00000000"  # check
    )
    trailer += trailer_name
    trailer += b"\x00" * ((4 - len(trailer) % 4) % 4)
    return b"".join(cpio_member(n, m, c) for n, m, c in members) + trailer


def rpm_with_gzip_payload(cpio: bytes) -> bytes:
    """Wrap a cpio stream in a minimal RPM: 96-byte lead + gzip payload."""
    return b"\x8e" + b"ADMin" + b"\x00" * 91 + gzip.compress(cpio)


def files_under(root: Path) -> set[Path]:
    return {p.resolve() for p in root.rglob("*")}


class RpmExtractionTest(unittest.TestCase):
    def setUp(self) -> None:
        # parent/ holds the extraction dir plus a marker file whose mtime
        # must not change — proves nothing outside dest is created OR modified.
        self._tmp = tempfile.TemporaryDirectory(prefix="rpm_test_")
        self.parent = Path(self._tmp.name)
        self.dest = self.parent / "extract"
        self.dest.mkdir()
        self.marker = self.parent / "outside-marker.txt"
        self.marker.write_text("sentinel")
        self.marker_mtime = self.marker.stat().st_mtime_ns

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _assert_no_outside_writes(self) -> None:
        outside = (files_under(self.parent) - files_under(self.dest) - {self.marker.resolve(), self.dest.resolve()})
        self.assertEqual(outside, set(), f"files created outside dest: {outside}")
        self.assertEqual(self.marker.stat().st_mtime_ns, self.marker_mtime, "marker was modified")

    def test_benign_extraction(self) -> None:
        cpio = cpio_archive(
            [
                ("usr", MODE_DIR, b""),
                ("usr/lib", MODE_DIR, b""),
                ("usr/lib/aspell-0.60", MODE_DIR, b""),
                ("usr/lib/aspell-0.60/safe.txt", MODE_FILE, b"aspell data\n"),
            ]
        )
        _extract_newc_cpio(cpio, self.dest)
        self.assertEqual((self.dest / "usr/lib/aspell-0.60/safe.txt").read_text(), "aspell data\n")
        self._assert_no_outside_writes()

    def test_relative_traversal_is_confined(self) -> None:
        cpio = cpio_archive(
            [
                ("usr/lib/aspell-0.60", MODE_DIR, b""),
                ("usr/lib/aspell-0.60/ok.txt", MODE_FILE, b"ok\n"),
                ("../relative-traversal-outside.txt", MODE_FILE, b"escaped\n"),
            ]
        )
        _extract_newc_cpio(cpio, self.dest)
        self.assertFalse((self.parent / "relative-traversal-outside.txt").exists())
        self.assertTrue((self.dest / "usr/lib/aspell-0.60/ok.txt").exists())
        self._assert_no_outside_writes()

    def test_absolute_path_is_confined(self) -> None:
        cpio = cpio_archive([("/etc/escaped-absolute.txt", MODE_FILE, b"escaped\n")])
        _extract_newc_cpio(cpio, self.dest)
        self.assertFalse((self.dest / "etc/escaped-absolute.txt").exists())
        self.assertFalse((Path("/etc/escaped-absolute.txt")).exists())
        self._assert_no_outside_writes()

    def test_symlink_escape_is_confined(self) -> None:
        cpio = cpio_archive(
            [
                ("usr/lib", MODE_DIR, b""),
                ("usr/lib/evil-link", MODE_SYMLINK, b"../../../../outside-link-target"),
                ("usr/lib/evil-link/payload.txt", MODE_FILE, b"escaped\n"),
            ]
        )
        _extract_newc_cpio(cpio, self.dest)
        self.assertFalse((self.parent / "outside-link-target").exists())
        self.assertFalse((self.parent / "outside-link-target" / "payload.txt").exists())
        self._assert_no_outside_writes()

    def test_symlink_into_dest_is_kept(self) -> None:
        cpio = cpio_archive(
            [
                ("usr/lib", MODE_DIR, b""),
                ("usr/lib/real.txt", MODE_FILE, b"real\n"),
                ("usr/lib/alias.txt", MODE_SYMLINK, b"real.txt"),
            ]
        )
        _extract_newc_cpio(cpio, self.dest)
        link = self.dest / "usr/lib/alias.txt"
        self.assertTrue(link.is_symlink())
        self.assertEqual(link.read_text(), "real\n")
        self._assert_no_outside_writes()

    def test_full_rpm_pipeline_with_gzip_payload(self) -> None:
        cpio = cpio_archive([("usr/lib/aspell-0.60/safe.txt", MODE_FILE, b"aspell\n")])
        rpm_path = self.parent / "dict.rpm"
        rpm_path.write_bytes(rpm_with_gzip_payload(cpio))
        _extract_rpm(rpm_path, self.dest)
        self.assertEqual((self.dest / "usr/lib/aspell-0.60/safe.txt").read_text(), "aspell\n")
        # dict.rpm is the input we placed in the parent — exclude it from the
        # "nothing outside dest" check.
        outside = files_under(self.parent) - files_under(self.dest) - {
            self.marker.resolve(),
            self.dest.resolve(),
            rpm_path.resolve(),
        }
        self.assertEqual(outside, set(), f"files created outside dest: {outside}")
        self.assertEqual(self.marker.stat().st_mtime_ns, self.marker_mtime, "marker was modified")


if __name__ == "__main__":
    unittest.main(verbosity=2)
