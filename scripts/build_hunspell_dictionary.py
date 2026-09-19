#!/usr/bin/env python3

from __future__ import annotations

import argparse
import re
import shutil
import tempfile
import urllib.error
import urllib.request
import zipfile
from pathlib import Path


BASE_URL = "https://raw.githubusercontent.com/wooorm/dictionaries/main/dictionaries"
PT_BR_ZIP_URL = "https://pt-br.libreoffice.org/assets/Uploads/PT-BR-Documents/VERO/ptBR-2013-10-30AOC-2.zip"
# Arabic is not in wooorm/dictionaries; use the AyaSpell hunspell dictionary.
AYASPELL_BASE_URL = "https://raw.githubusercontent.com/linuxscout/ayaspell/master/dict/builddict"


def download_file(url: str, output_path: Path, timeout: int = 15) -> None:
    with urllib.request.urlopen(url, timeout=timeout) as response, output_path.open("wb") as output_file:
        shutil.copyfileobj(response, output_file)


def try_download_language(lang_code: str, dest_lang_name: str, dest_dir: Path) -> bool:
    aff_url = f"{BASE_URL}/{lang_code}/index.aff"
    dic_url = f"{BASE_URL}/{lang_code}/index.dic"

    aff_target = dest_dir / f"{dest_lang_name}.aff"
    dic_target = dest_dir / f"{dest_lang_name}.dic"

    try:
        download_file(aff_url, aff_target)
        download_file(dic_url, dic_target)
        return True
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError):
        return False


def install_pt_br_dictionary(lang: str, dest_dir: Path) -> None:
    with tempfile.TemporaryDirectory(prefix="hunspell_pt_br_") as temp_dir:
        tmp_path = Path(temp_dir)
        zip_path = tmp_path / "dict.zip"
        download_file(PT_BR_ZIP_URL, zip_path)
        with zipfile.ZipFile(zip_path) as zip_file:
            zip_file.extractall(tmp_path)

        aff_source = tmp_path / f"{lang}.aff"
        dic_source = tmp_path / f"{lang}.dic"
        if not aff_source.is_file() or not dic_source.is_file():
            raise RuntimeError(f"Expected {lang}.aff and {lang}.dic in {PT_BR_ZIP_URL}")

        shutil.copy2(aff_source, dest_dir / f"{lang}.aff")
        shutil.copy2(dic_source, dest_dir / f"{lang}.dic")


def _clean_ayaspell_dictionary(dic_path: Path) -> int:
    """Normalize AyaSpell's raw build dict into clean hunspell format.

    AyaSpell's arb.dic is a build artifact, not a clean hunspell dictionary:
    it contains `::::::::` section separators, `#` comment lines, section-name
    lines (e.g. `stopwords.dic`), and AyaSpell-specific plural-suffix entries
    (`word/np`, `word/mp`) that standard hunspell cannot load. The wooorm
    dictionaries used for the other languages are already clean, so this
    normalization is only needed for Arabic.
    """
    words: list[str] = []
    seen: set[str] = set()
    with dic_path.open("r", encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line:
                continue
            if line.startswith("#"):
                continue
            if line.startswith("::::::::"):
                continue
            if re.fullmatch(r"[A-Za-z0-9_.\-]+\.dic", line):
                continue
            # Strip AyaSpell plural-suffix markers, keeping the base word.
            if line.endswith("/np") or line.endswith("/mp"):
                line = line.rsplit("/", 1)[0]
            line = line.strip()
            if not line or line in seen:
                continue
            seen.add(line)
            words.append(line)
    with dic_path.open("w", encoding="utf-8") as handle:
        handle.write(f"{len(words)}\n")
        handle.write("\n".join(words) + "\n")
    return len(words)


def install_arabic_dictionary(dest_dir: Path) -> None:
    # AyaSpell ships the dictionary under non-standard names (arb.aff/arb.dic);
    # fetch them and rename to the <variant>.aff/.dic layout the rest of the
    # pipeline (has_hunspell_dictionary, the `hunspell -d ar_SA` filter) expects.
    dic_target = dest_dir / "ar_SA.dic"
    download_file(f"{AYASPELL_BASE_URL}/arb.aff", dest_dir / "ar_SA.aff")
    download_file(f"{AYASPELL_BASE_URL}/arb.dic", dic_target)
    word_count = _clean_ayaspell_dictionary(dic_target)
    print(f"Cleaned AyaSpell Arabic dictionary to {word_count} words")


def main() -> int:
    parser = argparse.ArgumentParser(description="Download and install hunspell dictionary files.")
    parser.add_argument("-l", "--lang", required=True, help="Language code (for example: en_US)")
    parser.add_argument("-d", "--dest-dir", required=True, help="Destination directory")
    args = parser.parse_args()

    lang = args.lang.strip()
    dest_dir = Path(args.dest_dir).resolve()
    dest_dir.mkdir(parents=True, exist_ok=True)

    if lang == "pt_BR":
        install_pt_br_dictionary(lang, dest_dir)
        return 0

    if lang == "ar_SA":
        install_arabic_dictionary(dest_dir)
        return 0

    if try_download_language(lang, lang, dest_dir):
        return 0

    # Fallback to short language code if full locale code is unavailable.
    short_lang = lang[:2]
    if try_download_language(short_lang, lang, dest_dir):
        return 0

    raise RuntimeError(f"Unable to download hunspell dictionary for {lang}")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (urllib.error.URLError, TimeoutError) as exc:
        print(f"Failed to download hunspell dictionary: {exc}")
        raise SystemExit(1)
    except RuntimeError as exc:
        print(exc)
        raise SystemExit(1)
