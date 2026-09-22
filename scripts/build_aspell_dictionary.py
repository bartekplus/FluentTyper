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
from pathlib import Path


def download_file(url: str, output_path: Path, timeout: int = 20) -> None:
    with urllib.request.urlopen(url, timeout=timeout) as response, output_path.open("wb") as output_file:
        shutil.copyfileobj(response, output_file)


def _bsdtar() -> str:
    """bsdtar (libarchive) reads RPMs as well as tarballs and, without -P,
    refuses absolute and `..` member paths and extraction through symlinks."""
    if path := shutil.which("bsdtar"):
        return path
    tar = shutil.which("tar")
    if tar and "bsdtar" in subprocess.run([tar, "--version"], capture_output=True, text=True).stdout:
        return tar
    raise RuntimeError("bsdtar not found; install libarchive-tools (e.g. `apt-get install libarchive-tools`)")


def extract_archive(archive_path: Path, cwd: Path) -> None:
    # Never pass -P: it disables bsdtar's path-traversal protections.
    subprocess.run([_bsdtar(), "-xf", str(archive_path)], cwd=str(cwd), check=True)


def _real_within(root_resolved: Path, path: Path) -> bool:
    """True if `path` resolves (following symlinks) to `root_resolved` or below."""
    real = Path(os.path.realpath(path))
    return real == root_resolved or root_resolved in real.parents


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
