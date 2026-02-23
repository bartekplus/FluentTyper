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
    raise RuntimeError(f"Unable to extract archive: {archive_path}")


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
