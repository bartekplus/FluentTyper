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
from build_aspell_dictionary import (  # noqa: E402
    _extract_newc_cpio,
    _extract_rpm,
    copy_tree_contents,
    extract_archive,
)

# newc cpio mode values (S_IFMT | permissions)
MODE_FILE = stat.S_IFREG | 0o644
MODE_DIR = stat.S_IFDIR | 0o755
MODE_SYMLINK = stat.S_IFLNK | 0o777


def cpio_member(name: str, mode: int, content: bytes = b"", ino: int = 0, nlink: int = 0) -> bytes:
    """Build one newc cpio member (header + name + content, 4-byte aligned).

    newc header field order (all 8-byte uppercase hex, 110 bytes total):
    magic(6) ino mode uid gid nlink mtime filesize devmajor devminor
    rdevmajor rdevminor namesize check
    """
    name_bytes = name.encode("utf-8") + b"\x00"
    header = (
        b"070701"
        + format(ino, "08X").encode()  # ino
        + format(mode, "08X").encode()  # mode
        + b"00000000"  # uid
        + b"00000000"  # gid
        + format(nlink, "08X").encode()  # nlink
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


def cpio_archive(members: list[tuple], trailer_present: bool = True) -> bytes:
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
    return b"".join(cpio_member(*m) for m in members) + (trailer if trailer_present else b"")


def rpm_header(store: bytes = b"") -> bytes:
    """An RPM header structure with no index entries and `store` as its data."""
    return b"\x8e\xad\xe8\x01" + b"\x00" * 4 + struct.pack(">II", 0, len(store)) + store


def rpm_with_gzip_payload(cpio: bytes, sig_store: bytes = b"", main_store: bytes = b"") -> bytes:
    """Wrap a cpio stream in a minimal RPM: lead, signature header (padded to
    8 bytes), main header, then the gzip payload."""
    sig = rpm_header(sig_store)
    sig += b"\x00" * ((8 - len(sig) % 8) % 8)
    return b"\xed\xab\xee\xdb" + b"\x00" * 92 + sig + rpm_header(main_store) + gzip.compress(cpio)


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

    # ---- ordered forward-symlink escape (review finding) -----------------
    #
    # No member name contains ".." and the leaf check passes for every write,
    # because `pivot` is a valid link when it is created and only becomes an
    # escape once the later `next -> .` member lands.  The parent chain must
    # therefore be re-validated at write time, not once when the link is made.
    FORWARD_SYMLINK_MEMBERS: list[tuple[str, int, bytes]] = [
        ("pivot", MODE_SYMLINK, b"next/.."),
        ("next", MODE_SYMLINK, b"."),
        ("pivot/outside-marker.txt", MODE_FILE, b"REVIEW_MARKER"),
    ]

    def _assert_marker_unchanged(self) -> None:
        self.assertEqual(self.marker.read_text(), "sentinel", "outside marker was overwritten")
        self.assertEqual(self.marker.stat().st_mtime_ns, self.marker_mtime, "marker was modified")

    def test_ordered_forward_symlink_confined_newc(self) -> None:
        _extract_newc_cpio(cpio_archive(self.FORWARD_SYMLINK_MEMBERS), self.dest)
        self._assert_marker_unchanged()
        self._assert_no_outside_writes()

    def test_ordered_forward_symlink_confined_rpm(self) -> None:
        rpm_path = self.parent / "dict.rpm"
        rpm_path.write_bytes(rpm_with_gzip_payload(cpio_archive(self.FORWARD_SYMLINK_MEMBERS)))
        _extract_rpm(rpm_path, self.dest)
        self._assert_marker_unchanged()

    def test_ordered_forward_symlink_confined_extract_archive(self) -> None:
        archive_path = self.parent / "dict.rpm"
        archive_path.write_bytes(rpm_with_gzip_payload(cpio_archive(self.FORWARD_SYMLINK_MEMBERS)))
        # tar rejects the RPM, so this exercises the RPM fallback path.
        extract_archive(archive_path, self.dest)
        self._assert_marker_unchanged()

    def test_absolute_link_target_escape_is_confined(self) -> None:
        cpio = cpio_archive(
            [
                ("evil", MODE_SYMLINK, str(self.parent).encode("utf-8")),
                ("evil/payload.txt", MODE_FILE, b"escaped\n"),
            ]
        )
        _extract_newc_cpio(cpio, self.dest)
        self.assertFalse((self.parent / "payload.txt").exists())
        self._assert_no_outside_writes()

    # ---- review follow-ups -------------------------------------------------

    def test_link_chain_through_collapsed_dotdot_is_not_copied(self) -> None:
        # `leak.dat -> p/../secret.txt` looks contained while `p` does not
        # exist (realpath collapses `p/..` textually); `p -> ../../..` then
        # points at dest itself, so at copy time leak.dat resolves to
        # dest/../secret.txt — outside the extraction root.
        secret = self.parent / "secret.txt"
        secret.write_text("SECRET")
        cpio = cpio_archive(
            [
                ("usr/lib/aspell-0.60", MODE_DIR, b""),
                ("usr/lib/aspell-0.60/leak.dat", MODE_SYMLINK, b"p/../secret.txt"),
                ("usr/lib/aspell-0.60/p", MODE_SYMLINK, b"../../.."),
            ]
        )
        _extract_newc_cpio(cpio, self.dest)
        out = self.parent / "out"
        out.mkdir()
        copy_tree_contents(self.dest / "usr/lib/aspell-0.60", out, self.dest)
        self.assertFalse((out / "leak.dat").exists(), "outside file was copied")

    def test_link_targets_with_dotdot_are_rejected(self) -> None:
        cpio = cpio_archive([("a", MODE_DIR, b""), ("a/up", MODE_SYMLINK, b"../a")])
        _extract_newc_cpio(cpio, self.dest)
        self.assertFalse((self.dest / "a/up").is_symlink())

    def test_copy_tree_skips_preexisting_escaping_link(self) -> None:
        # Defense in depth: even a link the extractor did not vet is skipped.
        secret = self.parent / "secret.txt"
        secret.write_text("SECRET")
        src = self.dest / "usr/lib/aspell-0.60"
        src.mkdir(parents=True)
        (src / "leak.dat").symlink_to(secret)
        (src / "ok.dat").write_text("ok")
        out = self.parent / "out"
        out.mkdir()
        copy_tree_contents(src, out, self.dest)
        self.assertFalse((out / "leak.dat").exists())
        self.assertEqual((out / "ok.dat").read_text(), "ok")

    def test_false_gzip_magic_in_header_is_ignored(self) -> None:
        cpio = cpio_archive([("usr/lib/aspell-0.60/safe.txt", MODE_FILE, b"aspell\n")])
        rpm_path = self.parent / "dict.rpm"
        rpm_path.write_bytes(rpm_with_gzip_payload(cpio, sig_store=b"\x1f\x8bxx", main_store=b"\x1f\x8b\x08junk"))
        _extract_rpm(rpm_path, self.dest)
        self.assertEqual((self.dest / "usr/lib/aspell-0.60/safe.txt").read_text(), "aspell\n")

    def _assert_runtime_error(self, cpio: bytes) -> None:
        rpm_path = self.parent / "dict.rpm"
        rpm_path.write_bytes(rpm_with_gzip_payload(cpio))
        with self.assertRaises(RuntimeError):
            _extract_rpm(rpm_path, self.dest)

    def test_malformed_inputs_raise_runtime_error(self) -> None:
        good = cpio_archive([("f.txt", MODE_FILE, b"x")])
        self._assert_runtime_error(good[:14] + b"ZZZZZZZZ" + good[22:])  # non-hex mode
        self._assert_runtime_error(cpio_archive([("f.txt", MODE_FILE, b"x")], trailer_present=False))
        # A file member landing on an existing directory.
        self._assert_runtime_error(cpio_archive([("d", MODE_DIR, b""), ("d", MODE_FILE, b"x")]))

    def test_corrupt_payload_raises_runtime_error(self) -> None:
        rpm_path = self.parent / "dict.rpm"
        for payload in (b"\x1f\x8b\x08\x00garbage", b"\xfd7zXZ\x00garbage", b"no-magic"):
            rpm = rpm_with_gzip_payload(b"")
            rpm = rpm[: len(rpm) - len(gzip.compress(b""))] + payload
            rpm_path.write_bytes(rpm)
            with self.assertRaises(RuntimeError, msg=payload):
                _extract_rpm(rpm_path, self.dest)
        rpm_path.write_bytes(b"\x00" * 200)  # no header magic
        with self.assertRaises(RuntimeError):
            _extract_rpm(rpm_path, self.dest)

    def test_hardlink_group_members_all_get_data(self) -> None:
        # newc usually stores hardlink data on the LAST member of a group, but
        # GNU cpio gives every alias the data wherever it appears.
        for data_index, where in enumerate(("first", "middle", "last")):
            with self.subTest(data=where):
                names = [f"{where}_{n}.dat" for n in ("a", "b", "c")]
                cpio = cpio_archive(
                    [
                        (name, MODE_FILE, b"shared\n" if i == data_index else b"", 7, 3)
                        for i, name in enumerate(names)
                    ]
                    + [
                        ("other.dat", MODE_FILE, b"", 8, 2),
                        ("solo.dat", MODE_FILE, b"solo\n", 9, 1),
                    ]
                )
                _extract_newc_cpio(cpio, self.dest)
                for name in names:
                    self.assertEqual((self.dest / name).read_text(), "shared\n", name)
                self.assertEqual((self.dest / "solo.dat").read_text(), "solo\n")
                self._assert_no_outside_writes()

    def test_all_empty_hardlink_group_creates_empty_files(self) -> None:
        cpio = cpio_archive([(name, MODE_FILE, b"", 7, 3) for name in ("a.dat", "b.dat", "c.dat")])
        _extract_newc_cpio(cpio, self.dest)
        for name in ("a.dat", "b.dat", "c.dat"):
            self.assertEqual((self.dest / name).read_bytes(), b"", name)
        self._assert_no_outside_writes()

    def test_hardlink_aliases_under_escaping_symlink_are_not_written(self) -> None:
        # Pre-planted link (archive-created escaping links are already
        # rejected), so this isolates the write-time containment check.
        (self.dest / "evil").symlink_to(self.parent)
        cpio = cpio_archive(
            [
                ("evil/before.dat", MODE_FILE, b"", 7, 3),  # backfilled alias
                ("a.dat", MODE_FILE, b"shared\n", 7, 3),
                ("evil/after.dat", MODE_FILE, b"", 7, 3),  # stored-data alias
            ]
        )
        _extract_newc_cpio(cpio, self.dest)
        self.assertEqual((self.dest / "a.dat").read_text(), "shared\n")
        self.assertFalse((self.parent / "before.dat").exists())
        self.assertFalse((self.parent / "after.dat").exists())
        self._assert_no_outside_writes()

if __name__ == "__main__":
    unittest.main(verbosity=2)
