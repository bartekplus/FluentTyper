#!/usr/bin/env python3

from __future__ import annotations

import argparse
import os
import shlex
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.request
from pathlib import Path, PurePosixPath


def download_file(url: str, output_path: Path, timeout: int = 20) -> None:
    with urllib.request.urlopen(url, timeout=timeout) as response, output_path.open("wb") as output_file:
        shutil.copyfileobj(response, output_file)


def extract_archive(archive_path: Path, cwd: Path) -> None:
    # Keep the extraction flow compatible with the previous shell script, which used tar.
    for cmd in (["tar", "-zxf", str(archive_path.name)], ["tar", "-xf", str(archive_path.name)]):
        try:
            subprocess.run(cmd, cwd=str(cwd), check=True)
            return
        except subprocess.CalledProcessError:
            continue
    # Some dictionaries (e.g. aspell-ar) ship as RPMs whose payload is zstd/xz
    # compressed rather than a plain tarball.  Fall back to a minimal RPM
    # extractor that locates the compressed payload, decompresses it, and runs
    # `cpio` to unpack the file list.
    try:
        _extract_rpm(archive_path, cwd)
        return
    except (RuntimeError, subprocess.CalledProcessError):
        pass
    raise RuntimeError(f"Unable to extract archive: {archive_path}")


def _extract_rpm(archive_path: Path, cwd: Path) -> None:
    import gzip
    import lzma
    import struct
    import zlib

    # Any parse/decompress failure on this untrusted input is reported as
    # RuntimeError so the caller prints a clean message instead of a traceback.
    try:
        data = archive_path.read_bytes()
        payload = data[_rpm_payload_offset(data) :]
        if payload[:2] == b"\x1f\x8b":
            cpio = gzip.decompress(payload)
        elif payload[:6] == b"\xfd7zXZ\x00":
            cpio = lzma.decompress(payload)
        elif payload[:4] == b"\x28\xb5\x2f\xfd":
            result = subprocess.run(["zstd", "-d", "-q", "-c", "-"], input=payload, capture_output=True)
            if result.returncode != 0:
                raise RuntimeError("zstd decompression failed")
            cpio = result.stdout
        else:
            raise RuntimeError("Unknown RPM payload compression")
        # Extract the newc cpio stream in-process (no `cpio` subprocess): the
        # member names come from an untrusted downloaded package, so every path
        # and link target is validated to stay inside `cwd` before anything is
        # written.
        _extract_newc_cpio(cpio, cwd)
    except (ValueError, OSError, EOFError, lzma.LZMAError, zlib.error, struct.error) as exc:
        raise RuntimeError(f"Malformed RPM {archive_path.name}: {exc}") from exc


def _rpm_payload_offset(data: bytes) -> int:
    """Offset of the payload: 96-byte lead, signature header padded to 8
    bytes, then the main header.  Each header is magic(3) version(1)
    reserved(4) nindex(4) hsize(4), 16-byte index entries, then hsize bytes."""
    import struct

    offset = 96
    for pad in (True, False):
        if data[offset : offset + 3] != b"\x8e\xad\xe8":
            raise RuntimeError("Missing RPM header magic")
        nindex, hsize = struct.unpack(">II", data[offset + 8 : offset + 16])
        offset += 16 + 16 * nindex + hsize
        if pad:
            offset = (offset + 7) & ~7
    return offset


def _extract_newc_cpio(data: bytes, dest: Path) -> None:
    """Extract a newc-format cpio archive into `dest` with path containment.

    Rejects absolute member paths, `..` traversal, and symlink targets that
    are absolute, contain `..`, or resolve outside `dest`.  Only regular
    files, directories, symlinks, and hardlinks are materialized; other member
    types are skipped.  Raises RuntimeError/ValueError/OSError on malformed input.
    """
    import os
    import stat as stat_module

    dest_resolved = dest.resolve()
    # newc stores a hardlink group's data on one member (normally the last).
    # Members before it are written empty and backfilled when the data
    # arrives; members after it reuse the stored data, as GNU cpio does.
    hardlinks: dict[tuple[int, int, int], list[Path]] = {}
    hardlink_data: dict[tuple[int, int, int], bytes] = {}
    pos = 0
    seen_trailer = False
    while pos + 110 <= len(data):
        if data[pos : pos + 6] != b"070701":
            raise RuntimeError("Not a newc cpio archive")
        namesize = int(data[pos + 94 : pos + 102], 16)
        filesize = int(data[pos + 54 : pos + 62], 16)
        mode = int(data[pos + 14 : pos + 22], 16)
        ino = int(data[pos + 6 : pos + 14], 16)
        nlink = int(data[pos + 38 : pos + 46], 16)
        dev = (int(data[pos + 62 : pos + 70], 16), int(data[pos + 70 : pos + 78], 16))
        name_end = pos + 110 + namesize
        if name_end > len(data):
            raise RuntimeError("Truncated cpio header")
        name = data[pos + 110 : name_end].rstrip(b"\x00").decode("utf-8", "surrogateescape")
        content_start = (name_end + 3) & ~3
        content_end = content_start + filesize
        if content_end > len(data):
            raise RuntimeError("Truncated cpio member data")
        pos = (content_end + 3) & ~3
        if name == "TRAILER!!!":
            seen_trailer = True
            break
        if name in (".", "") or name.startswith("/") or name.startswith("../") or name == "..":
            continue  # archive root / absolute path — never write outside dest
        parts = [part for part in PurePosixPath(name).parts if part not in ("", ".")]
        if not parts or any(part == ".." for part in parts):
            continue  # parent traversal — skip rather than write outside dest
        target = dest.joinpath(*parts)
        if stat_module.S_ISDIR(mode):
            _ensure_dir(dest, dest_resolved, target)
        elif stat_module.S_ISLNK(mode):
            link_target = data[content_start:content_end].decode("utf-8", "surrogateescape")
            # Create the link's parent first: a symlink member must never be
            # placed inside a directory chain that an earlier member redirected.
            if not _ensure_dir(dest, dest_resolved, target.parent):
                continue
            if not _link_target_contained(dest_resolved, target, link_target):
                continue
            if target.is_symlink() or target.exists():
                target.unlink()
            os.symlink(link_target, target)
        elif stat_module.S_ISREG(mode):
            content = data[content_start:content_end]
            if nlink > 1:
                key = (*dev, ino)
                group = hardlinks.setdefault(key, [])
                group.append(target)
                if filesize:
                    hardlink_data[key] = content
                    for member in group:
                        _write_file(dest, dest_resolved, member, content)
                    continue
                content = hardlink_data.get(key, content)
            _write_file(dest, dest_resolved, target, content)
        # FIFOs, sockets, block/char devices, and unknown types: skip.
    if not seen_trailer:
        raise RuntimeError("cpio archive has no TRAILER!!! member (truncated?)")


def _write_file(dest: Path, dest_resolved: Path, target: Path, content: bytes) -> None:
    """Write a regular file.  The parent chain is re-validated here, at write
    time: an earlier member can leave behind a symlink whose target only
    becomes escaping once a *later* member is created, so a check made when
    the link was created is not enough."""
    if not _ensure_dir(dest, dest_resolved, target.parent):
        return
    if target.is_symlink() or target.exists():
        # Never write through an archive-created link.
        target.unlink()
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o644)
    try:
        os.write(fd, content)
    finally:
        os.close(fd)


def _real_within(dest_resolved: Path, path: Path) -> bool:
    """True if `path` resolves (following existing symlinks) to `dest_resolved` or below."""
    real = Path(os.path.realpath(path))
    return real == dest_resolved or dest_resolved in real.parents


def _ensure_dir(dest: Path, dest_resolved: Path, path: Path) -> bool:
    """Create `path` as a directory, one component at a time, under `dest`.

    Refuses to descend through an existing symlink and re-checks containment
    after every step, so an archive member can never redirect a later write
    outside the destination.  Returns False when the path is unsafe.
    """
    try:
        relative = path.relative_to(dest)
    except ValueError:
        return False
    current = dest
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            return False  # never traverse an archive-created link
        if current.exists():
            if not current.is_dir():
                return False
        else:
            current.mkdir()
        if not _real_within(dest_resolved, current):
            return False
    return True


def _link_target_contained(dest_resolved: Path, link_path: Path, link_target: str) -> bool:
    """True if a symlink's target stays inside the destination directory.

    Absolute targets and any `..` component are rejected outright: realpath
    collapses `missing/..` textually, so a target through a not-yet-created
    component can be re-pointed outside by a later link.  The remaining
    relative target is then checked from the link's own directory.
    """
    target = PurePosixPath(link_target)
    if target.is_absolute() or ".." in target.parts:
        return False
    return _real_within(dest_resolved, link_path.parent / target)


def copy_tree_contents(source_dir: Path, destination_dir: Path, root: Path) -> None:
    """Copy the regular files directly under `source_dir`, following links
    only when they resolve inside the extraction `root`."""
    if not source_dir.is_dir():
        return

    root_resolved = root.resolve()
    for path in source_dir.iterdir():
        if not _real_within(root_resolved, path):
            continue
        resolved = path.resolve()
        if resolved.is_file():
            shutil.copy2(resolved, destination_dir / path.name)


def main() -> int:
    parser = argparse.ArgumentParser(description="Download and install aspell dictionary files.")
    parser.add_argument("-u", "--url", required=True, help="Aspell dictionary URL")
    parser.add_argument("-d", "--dest-dir", required=True, help="Destination directory")
    args = parser.parse_args()

    dest_dir = Path(args.dest_dir).resolve()
    dest_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="aspell_dict_") as temp_dir:
        tmp_path = Path(temp_dir)
        archive_path = tmp_path / "dict.rpm"
        download_file(args.url, archive_path)
        extract_archive(archive_path, tmp_path)
        copy_tree_contents(tmp_path / "usr/lib/aspell-0.60", dest_dir, tmp_path)
        copy_tree_contents(tmp_path / "var/lib/aspell-0.60", dest_dir, tmp_path)

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (urllib.error.URLError, TimeoutError) as exc:
        print(f"Failed to download aspell dictionary: {exc}")
        raise SystemExit(1)
    except subprocess.CalledProcessError as exc:
        print(f"Command failed with exit code {exc.returncode}: {shlex.join(exc.cmd)}")
        raise SystemExit(exc.returncode)
    except RuntimeError as exc:
        print(exc)
        raise SystemExit(1)
