#!/usr/bin/env python3

from __future__ import annotations

import argparse
import concurrent.futures
import os
import shlex
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from string import Template
from typing import Iterable


@dataclass(frozen=True)
class LanguageConfig:
    short: str
    variant: str
    aspell_urls: tuple[str, ...]
    aspell_lang: str | None = None


LANGUAGES: tuple[LanguageConfig, ...] = (
    LanguageConfig(
        short="de",
        variant="de_DE",
        aspell_urls=(
            "https://rpmfind.net/linux/opensuse/ports/i586/tumbleweed/repo/oss/i586/aspell-de-20161207.7.0-4.1.i586.rpm",
            "https://rpmfind.net/linux/opensuse/ports/i586/tumbleweed/repo/oss/i586/aspell-de-20161207.7.0-4.4.i586.rpm",
        ),
        aspell_lang="de",
    ),
    LanguageConfig(
        short="el",
        variant="el_GR",
        aspell_urls=(
            "https://rpmfind.net/linux/opensuse/ports/i586/tumbleweed/repo/oss/i586/aspell-el-0.50.3+0.08-4.1.i586.rpm",
            "https://rpmfind.net/linux/opensuse/ports/i586/tumbleweed/repo/oss/i586/aspell-el-0.50.3+0.08-4.4.i586.rpm",
        ),
        aspell_lang="el",
    ),
    LanguageConfig(
        short="en",
        variant="en_US",
        aspell_urls=(
            "https://rpmfind.net/linux/opensuse/ports/i586/tumbleweed/repo/oss/i586/aspell-en-2020.12.07-2.5.i586.rpm",
            "https://rpmfind.net/linux/opensuse/ports/i586/tumbleweed/repo/oss/i586/aspell-en-2020.12.07-2.8.i586.rpm",
        ),
    ),
    LanguageConfig(
        short="es",
        variant="es_ES",
        aspell_urls=(
            "https://rpmfind.net/linux/opensuse/ports/i586/tumbleweed/repo/oss/i586/aspell-es-1.11.2-4.1.i586.rpm",
            "https://rpmfind.net/linux/opensuse/ports/i586/tumbleweed/repo/oss/i586/aspell-es-1.11.2-4.4.i586.rpm",
        ),
        aspell_lang="es",
    ),
    LanguageConfig(
        short="fr",
        variant="fr_FR",
        aspell_urls=(
            "https://rpmfind.net/linux/opensuse/ports/i586/tumbleweed/repo/oss/i586/aspell-fr-0.50.3-4.1.i586.rpm",
            "https://rpmfind.net/linux/opensuse/ports/i586/tumbleweed/repo/oss/i586/aspell-fr-0.50.3-4.4.i586.rpm",
        ),
    ),
    LanguageConfig(
        short="hr",
        variant="hr_HR",
        aspell_urls=(
            "https://rpmfind.net/linux/opensuse/ports/i586/tumbleweed/repo/oss/i586/aspell-hr-0.51.0-4.1.i586.rpm",
            "https://rpmfind.net/linux/opensuse/ports/i586/tumbleweed/repo/oss/i586/aspell-hr-0.51.0-4.4.i586.rpm",
        ),
        aspell_lang="hr",
    ),
    LanguageConfig(
        short="pl",
        variant="pl_PL",
        aspell_urls=(
            "https://rpmfind.net/linux/opensuse/ports/i586/tumbleweed/repo/oss/i586/aspell-pl-0.60.2015.04.28-4.1.i586.rpm",
            "https://rpmfind.net/linux/opensuse/ports/i586/tumbleweed/repo/oss/i586/aspell-pl-0.60.2015.04.28-4.4.i586.rpm",
        ),
        aspell_lang="pl",
    ),
    LanguageConfig(
        short="pt",
        variant="pt_BR",
        aspell_urls=(
            "https://rpmfind.net/linux/opensuse/ports/i586/tumbleweed/repo/oss/i586/aspell-pt_BR-20131030.12.0-4.1.i586.rpm",
            "https://rpmfind.net/linux/opensuse/ports/i586/tumbleweed/repo/oss/i586/aspell-pt_BR-20131030.12.0-4.4.i586.rpm",
        ),
    ),
    LanguageConfig(
        short="sv",
        variant="sv_SE",
        aspell_urls=(
            "https://rpmfind.net/linux/opensuse/ports/i586/tumbleweed/repo/oss/i586/aspell-sv-0.51.0-4.1.i586.rpm",
            "https://rpmfind.net/linux/opensuse/ports/i586/tumbleweed/repo/oss/i586/aspell-sv-0.51.0-4.4.i586.rpm",
        ),
        aspell_lang="sv",
    ),
)


SCRIPT_DIR = Path(__file__).resolve().parent
RESOURCES_DIR = (SCRIPT_DIR / ".." / "resources_js").resolve()
RESOURCES_TEMPLATE_DIR = (SCRIPT_DIR / ".." / "resources_js_template").resolve()
RESOURCES_LANG_TEMPLATE_DIR = (SCRIPT_DIR / ".." / "resources_js_lang_template").resolve()
REBUILD_NGRAM_PATH = (SCRIPT_DIR / "rebuild_ngram_db.py").resolve()
REBUILD_LIBPRESAGE_PATH = (SCRIPT_DIR / "rebuild_libpresage.py").resolve()
BUILD_HUNSPELL_PATH = (SCRIPT_DIR / "build_hunspell_dictionary.py").resolve()
BUILD_ASPELL_PATH = (SCRIPT_DIR / "build_aspell_dictionary.py").resolve()


def run_cmd(cmd: list[str], cwd: Path | None = None) -> None:
    print(f"$ {shlex.join(cmd)}")
    subprocess.run(cmd, check=True, cwd=str(cwd) if cwd else None)


def run_python(script: Path, args: list[str]) -> None:
    run_cmd([sys.executable, str(script), *args])


def update_template(template_file: Path, lang: LanguageConfig, debug: bool) -> None:
    replacement = {
        "LANG_VARIANT": lang.variant,
        "LANG_ASPELL": lang.aspell_lang or lang.variant,
        "LOGGER": "DEBUG" if debug else "ERROR",
    }
    src = Template(template_file.read_text(encoding="utf-8"))
    template_file.write_text(src.substitute(replacement), encoding="utf-8")


def create_resource_js() -> None:
    RESOURCES_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copytree(RESOURCES_TEMPLATE_DIR, RESOURCES_DIR, dirs_exist_ok=True)


def create_lang_config_from_template(lang: LanguageConfig, debug: bool) -> None:
    dst = RESOURCES_DIR / lang.variant
    dst.mkdir(parents=True, exist_ok=True)
    (dst / "hunspell").mkdir(parents=True, exist_ok=True)
    shutil.copytree(RESOURCES_LANG_TEMPLATE_DIR, dst, dirs_exist_ok=True)
    update_template(dst / "presage.xml", lang, debug)


def has_hunspell_dictionary(lang: LanguageConfig) -> bool:
    base = RESOURCES_DIR / lang.variant / "hunspell"
    return (base / f"{lang.variant}.aff").is_file() and (base / f"{lang.variant}.dic").is_file()


def has_aspell_dictionary(lang: LanguageConfig) -> bool:
    base = RESOURCES_DIR / lang.variant / "aspell"
    return base.is_dir() and any(base.iterdir())


def install_aspell_dictionary(lang: LanguageConfig) -> None:
    resources_lang_aspell_dir = RESOURCES_DIR / lang.variant / "aspell"
    last_error: subprocess.CalledProcessError | None = None
    for aspell_url in lang.aspell_urls:
        try:
            print(f"Trying aspell URL for {lang.variant}: {aspell_url}")
            run_python(BUILD_ASPELL_PATH, ["-u", aspell_url, "-d", str(resources_lang_aspell_dir)])
            return
        except subprocess.CalledProcessError as exc:
            last_error = exc
            print(
                f"Aspell download/build failed for {lang.variant} with URL: {aspell_url}. "
                "Trying next fallback if available."
            )

    assert last_error is not None
    raise RuntimeError(
        f"All aspell URL candidates failed for {lang.variant}: {', '.join(lang.aspell_urls)}"
    ) from last_error


def install_hunspell_dictionary(lang: LanguageConfig) -> None:
    resources_lang_hunspell_dir = RESOURCES_DIR / lang.variant / "hunspell"
    run_python(BUILD_HUNSPELL_PATH, ["-l", lang.variant, "-d", str(resources_lang_hunspell_dir)])


def has_ngram_db(lang: LanguageConfig) -> bool:
    ngram_dir = RESOURCES_DIR / lang.variant / "ngrams_db"
    return (ngram_dir / "ngrams.trie").is_file() and (ngram_dir / "ngrams.counts").is_file()


def rebuild_ngram_db(
    lang: LanguageConfig,
    jobs: int,
) -> None:
    args = ["-l", lang.short, "-v", lang.variant]
    if jobs > 0:
        args.extend(["--jobs", str(jobs)])
    run_python(REBUILD_NGRAM_PATH, args)


def prepare_language(
    lang: LanguageConfig,
    debug: bool,
    skip_dictionaries: bool,
    refresh_dictionaries: bool,
) -> None:
    print(f"=== Preparing language {lang.short} ({lang.variant}) ===")
    create_lang_config_from_template(lang, debug)
    if skip_dictionaries:
        print(f"Skipping dictionaries for {lang.variant}")
        return
    if not refresh_dictionaries and has_aspell_dictionary(lang) and has_hunspell_dictionary(lang):
        print(f"Using existing dictionaries for {lang.variant}")
        return
    install_aspell_dictionary(lang)
    install_hunspell_dictionary(lang)


def parse_languages(selected: Iterable[str]) -> list[LanguageConfig]:
    by_variant = {lang.variant.lower(): lang for lang in LANGUAGES}
    by_short = {lang.short.lower(): lang for lang in LANGUAGES}
    output: list[LanguageConfig] = []
    seen: set[str] = set()

    for raw in selected:
        key = raw.strip().lower()
        lang = by_variant.get(key) or by_short.get(key)
        if not lang:
            allowed = ", ".join(lang.variant for lang in LANGUAGES)
            raise ValueError(f"Unknown language '{raw}'. Allowed: {allowed} (or short codes like 'en').")
        if lang.variant not in seen:
            output.append(lang)
            seen.add(lang.variant)

    return output


def build_libpresage(debug: bool, repack_only: bool, jobs: int) -> None:
    args: list[str] = []
    if repack_only:
        args.extend(["--package", "--link"])
    if debug:
        args.append("-d")
    if jobs > 1:
        args.extend(["--package-jobs", str(jobs)])
    run_python(REBUILD_LIBPRESAGE_PATH, args)


def auto_jobs() -> int:
    return max(1, os.cpu_count() or 1)


def main() -> int:
    parser = argparse.ArgumentParser(description="Rebuild FluentTyper language data and libpresage assets.")
    parser.add_argument(
        "-l",
        "--lang",
        nargs="+",
        default=[lang.variant for lang in LANGUAGES],
        help="Languages to process (e.g. en_US fr_FR or short forms en fr). Default: all supported.",
    )
    parser.add_argument("-d", "--debug", action="store_true", help="Enable debug mode for libpresage build.")
    parser.add_argument(
        "-r",
        "--repack",
        action="store_true",
        help="Skip language rebuild and only package/link libpresage data.",
    )
    parser.add_argument(
        "--skip-dictionaries",
        action="store_true",
        help="Skip aspell/hunspell dictionary download and installation.",
    )
    parser.add_argument(
        "--refresh-dictionaries",
        action="store_true",
        help="Force re-download/reinstall of aspell and hunspell dictionaries.",
    )
    parser.add_argument(
        "--skip-ngram",
        action="store_true",
        help="Skip n-gram DB rebuild for selected languages.",
    )
    parser.add_argument(
        "--skip-libpresage",
        action="store_true",
        help="Skip libpresage build/package/link step.",
    )
    parser.add_argument(
        "--skip-existing-ngrams",
        action="store_true",
        help="When rebuilding n-grams, skip languages that already have ngrams.trie/ngrams.counts.",
    )
    parser.add_argument(
        "--jobs",
        type=int,
        default=0,
        help="Global parallelism level used across rebuild phases. 0 = auto-detect.",
    )

    args = parser.parse_args()
    try:
        languages = parse_languages(args.lang)
    except ValueError as exc:
        parser.error(str(exc))

    if args.jobs < 0:
        print("--jobs must be >= 0", file=sys.stderr)
        return 2
    effective_jobs = auto_jobs() if args.jobs == 0 else args.jobs

    create_resource_js()

    if not args.repack:
        with concurrent.futures.ThreadPoolExecutor(max_workers=effective_jobs) as executor:
            futures = [
                executor.submit(
                    prepare_language,
                    lang,
                    args.debug,
                    args.skip_dictionaries,
                    args.refresh_dictionaries,
                )
                for lang in languages
            ]
            for future in concurrent.futures.as_completed(futures):
                future.result()

        if not args.skip_ngram:
            for lang in languages:
                if args.skip_existing_ngrams and has_ngram_db(lang):
                    print(f"Skipping n-gram rebuild for {lang.variant} (existing DB found)")
                    continue
                print(f"=== Rebuilding n-gram DB for {lang.short} ({lang.variant}) ===")
                rebuild_ngram_db(
                    lang,
                    jobs=effective_jobs,
                )
        else:
            print("Skipping n-gram rebuild step")
    else:
        print("Repack-only mode enabled; skipping language preparation and n-gram rebuild")

    if args.skip_libpresage:
        print("Skipping libpresage step")
    else:
        print("=== Building libpresage ===")
        build_libpresage(
            debug=args.debug,
            repack_only=args.repack,
            jobs=effective_jobs,
        )

    print("Rebuild completed.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as exc:
        print(f"Command failed with exit code {exc.returncode}: {shlex.join(exc.cmd)}", file=sys.stderr)
        raise SystemExit(exc.returncode)
    except RuntimeError as exc:
        print(f"{exc}", file=sys.stderr)
        raise SystemExit(1)
