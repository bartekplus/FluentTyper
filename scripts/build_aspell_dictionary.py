#!/usr/bin/env python3

from __future__ import annotations

import argparse
import shlex
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.request
from pathlib import Path


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

    data = archive_path.read_bytes()
    if len(data) < 96:
        raise RuntimeError("RPM file too small")
    # The RPM lead is 96 bytes; the compressed payload starts at the first
    # known compression magic after it.  Locating the magic directly is more
    # robust than walking the (variable-length) signature/data headers.
    magics = (b"\x1f\x8b", b"\xfd7zXZ\x00", b"\x28\xb5\x2f\xfd")
    start = None
    for magic in magics:
        offset = data.find(magic, 96)
        if offset != -1 and (start is None or offset < start):
            start = offset
    if start is None:
        raise RuntimeError("No recognizable compressed payload in RPM")
    payload = data[start:]
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


def _extract_newc_cpio(data: bytes, dest: Path) -> None:
    """Extract a newc-format cpio archive into `dest` with path containment.

    Rejects absolute member paths, `..` traversal, and symlink/hardlink
    targets that resolve outside `dest`.  Only regular files, directories,
    symlinks, and hardlinks are materialized; other member types are skipped.
    """
    import os
    import stat as stat_module

    dest_resolved = dest.resolve()
    pos = 0
    while pos + 110 <= len(data):
        if data[pos : pos + 6] != b"070701":
            raise RuntimeError("Not a newc cpio archive")
        namesize = int(data[pos + 94 : pos + 102], 16)
        filesize = int(data[pos + 54 : pos + 62], 16)
        mode = int(data[pos + 14 : pos + 22], 16)
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
            break
        if name in (".", "") or name.startswith("/"):
            continue  # archive root / absolute path — never write outside dest
        relative = Path(name)
        if any(part == ".." for part in relative.parts):
            continue  # parent traversal — skip rather than write outside dest
        target = dest / relative
        if stat_module.S_ISDIR(mode):
            target.mkdir(parents=True, exist_ok=True)
        elif stat_module.S_ISLNK(mode):
            link_target = data[content_start:content_end].decode("utf-8", "surrogateescape")
            if _link_target_contained(dest_resolved, link_target):
                target.parent.mkdir(parents=True, exist_ok=True)
                if target.is_symlink() or target.exists():
                    target.unlink()
                os.symlink(link_target, target)
        elif stat_module.S_ISREG(mode) or stat_module.S_ISLNK(mode):
            # Regular files and hardlinks (materialized as plain copies so a
            # hardlink to a member that appears later in the archive cannot
            # dangle).  Never write through a pre-existing symlink that
            # escapes the destination.
            if target.is_symlink() and not _link_target_contained(dest_resolved, os.readlink(target)):
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data[content_start:content_end])
        # FIFOs, sockets, block/char devices, and unknown types: skip.


def _link_target_contained(dest_resolved: Path, link_target: str) -> bool:
    """True if a link target stays inside the destination directory.

    Relative targets are resolved against the destination root (conservative:
    the link's own directory is always inside dest, so resolving from dest is
    at least as strict as resolving from the link's parent).  Absolute targets
    must point inside dest outright.
    """
    target = Path(link_target)
    resolved = target.resolve() if target.is_absolute() else (dest_resolved / target).resolve()
    return resolved == dest_resolved or dest_resolved in resolved.parents


def copy_tree_contents(source_dir: Path, destination_dir: Path) -> None:
    if not source_dir.is_dir():
        return

    for path in source_dir.iterdir():
        target = destination_dir / path.name
        if path.is_symlink():
            resolved = path.resolve()
            if resolved.is_file():
                shutil.copy2(resolved, target)
            continue

        if path.is_file():
            shutil.copy2(path, target)


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
        copy_tree_contents(tmp_path / "usr/lib/aspell-0.60", dest_dir)
        copy_tree_contents(tmp_path / "var/lib/aspell-0.60", dest_dir)

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
