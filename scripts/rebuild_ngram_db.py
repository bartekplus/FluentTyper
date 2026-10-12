#!/usr/bin/env python3

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import inspect
import json
import os
import re
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

from rebuild_libpresage import cpu_jobs, run_cmd, run_main


HPLT_BASE_URL = "https://data.hplt-project.org/three/sorted"
HPLT_LANGS = {
    "ar": "arb_Arab",
    "de": "deu_Latn",
    "el": "ell_Grek",
    "en": "eng_Latn",
    "es": "spa_Latn",
    "fr": "fra_Latn",
    "hr": "hrv_Latn",
    "pl": "pol_Latn",
    "pt": "por_Latn",
    "sv": "swe_Latn",
}
# HPLT segment language ID tags Croatian lines as the Serbo-Croatian macro-language.
SEGMENT_LANGS = {"hrv_Latn": ("hrv_Latn", "hbs_Latn")}
# European Portuguese spelling differs from pt_BR, so keep only Brazilian hosts.
VARIANT_URL_SUFFIX = {"pt_BR": ".br"}

TARGET_MB_DEFAULT = 1000
ORDER_DEFAULT = 4
MAX_STREAMS = 16  # HPLT asks for 16-32 threads at most.
HELDOUT_BYTES = 600_000

MIN_LANG_PROB = 0.9
REGISTER_MIN = 0.5
# Turku web registers: forums/Q&A, opinion/reviews/blogs, narrative/news, how-to, spoken.
KEEP_REGISTERS = ("ID", "OP", "NA", "HI", "SP")
HELDOUT_REGISTERS = ("ID", "OP")
# Machine-translated, lyrics, ads/sales, legal, product descriptions, encyclopedic, research.
DROP_REGISTERS = ("MT", "LY", "IP", "ds", "lt", "dtp", "en", "ra")
MIN_WORDS = 4
GREP_FILTER = re.compile(r"http[s]?://|www\.|<[^>]+>|[0-9]{4,}|[_=@#%^*+~\|/]{2,}|{}")
BOILERPLATE = re.compile(r"cookie|javascript|lorem ipsum|©|copyright", re.IGNORECASE)
SENTENCE_END = re.compile(r"[.!?…؟;][\"'”’»)\]]*$")

SCRIPT_DIR = Path(__file__).resolve().parent
CACHE_ROOT = (SCRIPT_DIR / ".cache" / "hplt").resolve()


def keep_line(line: str, hplt_lang: str) -> bool:
    if len(line.split()) < MIN_WORDS:
        return False
    if not SENTENCE_END.search(line):
        return False
    # ASCII ';' is the Greek question mark; elsewhere it is not a sentence end.
    if line.endswith(";") and hplt_lang != "ell_Grek":
        return False
    return not GREP_FILTER.search(line) and not BOILERPLATE.search(line)


def filter_document(
    doc: dict,
    hplt_lang: str,
    url_suffix: str | None = None,
    registers: tuple[str, ...] = KEEP_REGISTERS,
) -> list[str]:
    """Return the lines of an HPLT document that look like everyday prose."""
    if doc.get("filter") != "keep":
        return []
    langs, probs = doc.get("lang") or [None], doc.get("prob") or [0]
    if langs[0] != hplt_lang or probs[0] < MIN_LANG_PROB:
        return []
    register = doc.get("web-register")
    # A language without register labels skips this gate instead of losing all text.
    if register:
        if max(register.get(k, 0) for k in registers) < REGISTER_MIN:
            return []
        if max(register.get(k, 0) for k in DROP_REGISTERS) >= REGISTER_MIN:
            return []
    if url_suffix and not (urlsplit(doc.get("u") or "").hostname or "").endswith(url_suffix):
        return []

    lines = doc.get("text", "").split("\n")
    seg_langs = doc.get("seg_langs") or []
    if len(seg_langs) != len(lines):
        seg_langs = [hplt_lang] * len(lines)
    allowed = SEGMENT_LANGS.get(hplt_lang, (hplt_lang,))
    kept = []
    for line, seg_lang in zip(lines, seg_langs):
        line = line.strip()
        if seg_lang in allowed and keep_line(line, hplt_lang):
            kept.append(line)
    return kept


def filter_version() -> str:
    """Hash of the filter code and constants, so a filter change invalidates the cache."""
    source = inspect.getsource(keep_line) + inspect.getsource(filter_document)
    constants = repr(
        (MIN_LANG_PROB, REGISTER_MIN, KEEP_REGISTERS, DROP_REGISTERS, SEGMENT_LANGS, MIN_WORDS,
         GREP_FILTER.pattern, BOILERPLATE.pattern, SENTENCE_END.pattern)
    )
    return hashlib.sha1((source + constants).encode()).hexdigest()[:10]


def shard_key(url: str) -> tuple[int, int]:
    # ".../pol_Latn/9_12.jsonl.zst" -> (9, 12)
    quality_bin, index = Path(url).name.split(".")[0].split("_")
    return int(quality_bin), int(index)


def list_shards(hplt_lang: str) -> list[str]:
    with urllib.request.urlopen(f"{HPLT_BASE_URL}/{hplt_lang}.map", timeout=60) as response:
        urls = [line.strip() for line in response.read().decode().splitlines() if line.strip()]
    # Best WDS quality bin first.
    return sorted(urls, key=lambda url: (-shard_key(url)[0], shard_key(url)[1]))


def split_heldout(shards: list[str]) -> tuple[list[str], str]:
    """Reserve the last shard of the good bins (>= 8) for evaluation, never for training."""
    good = [url for url in shards if shard_key(url)[0] >= 8] or shards
    heldout = good[-1]
    return [url for url in shards if url != heldout], heldout


def stream_shard(
    url: str,
    out_path: Path,
    quota_bytes: int,
    hplt_lang: str,
    url_suffix: str | None,
    registers: tuple[str, ...] = KEEP_REGISTERS,
) -> dict:
    """Stream one shard, keep filtered lines up to the quota, and write them zstd-compressed.

    The shard itself never touches the disk: the download stops when the quota is reached.
    """
    tmp_path = out_path.with_name(out_path.name + ".tmp")
    src = subprocess.Popen(
        # zstd stderr is muted: stopping the stream at the quota makes it report a truncated input.
        f"set -o pipefail; curl -sfL --retry 3 {shlex.quote(url)} | zstd -dcq 2>/dev/null",
        executable="/bin/bash",
        shell=True,
        stdout=subprocess.PIPE,
        start_new_session=True,
    )
    dst = subprocess.Popen(["zstd", "-q", "-f", "-o", str(tmp_path)], stdin=subprocess.PIPE)
    kept_bytes = 0
    seen: set[bytes] = set()
    quota_reached = False
    try:
        for raw in src.stdout:
            try:
                doc = json.loads(raw)
            except json.JSONDecodeError:
                continue
            for line in filter_document(doc, hplt_lang, url_suffix, registers):
                data = (line + "\n").encode()
                digest = hashlib.blake2b(data, digest_size=8).digest()
                if digest in seen:
                    continue
                seen.add(digest)
                dst.stdin.write(data)
                kept_bytes += len(data)
            if kept_bytes >= quota_bytes:
                quota_reached = True
                break
    except BaseException:
        tmp_path.unlink(missing_ok=True)
        raise
    finally:
        if src.poll() is None:
            os.killpg(src.pid, signal.SIGTERM)
        src.wait()
        dst.stdin.close()
        dst.wait()
    if dst.returncode != 0:
        tmp_path.unlink(missing_ok=True)
        raise RuntimeError(f"zstd failed to write {out_path}")
    if not quota_reached and src.returncode != 0:
        print(f"Warning: stream ended early ({src.returncode}) for {url}; keeping {kept_bytes} bytes")
    tmp_path.rename(out_path)
    print(f"{Path(url).parent.name}/{Path(url).name}: kept {kept_bytes / 1e6:.1f} MB")
    # A shard that ended cleanly below the quota has no more text; anything else can be streamed again.
    return {"bytes": kept_bytes, "exhausted": not quota_reached and src.returncode == 0}


def dir_size(path: Path) -> int:
    return sum(p.stat().st_size for p in path.rglob("*") if p.is_file()) if path.exists() else 0


def report_disk(stage: str, min_free_gb: float) -> None:
    free_gb = shutil.disk_usage(SCRIPT_DIR).free / 1e9
    print(f"[disk] {stage}: cache {dir_size(CACHE_ROOT) / 1e9:.2f} GB, free {free_gb:.1f} GB")
    if free_gb < min_free_gb:
        raise RuntimeError(f"Free disk {free_gb:.1f} GB is below --min-free-gb {min_free_gb}")


def load_manifest(cache_dir: Path) -> dict[str, dict]:
    path = cache_dir / "manifest.json"
    return json.loads(path.read_text()) if path.is_file() else {}


def save_manifest(cache_dir: Path, manifest: dict[str, dict]) -> None:
    (cache_dir / "manifest.json").write_text(json.dumps(manifest, indent=1, sort_keys=True))


def part_is_usable(entry: dict | None, quota: int) -> bool:
    """A cached part is reused when its shard ran out or it already holds a full quota."""
    return bool(entry) and (entry["exhausted"] or entry["bytes"] >= quota)


def part_path(cache_dir: Path, url_or_name: str) -> Path:
    return cache_dir / (Path(url_or_name).name.split(".")[0] + ".txt.zst")


def fill_cache(
    cache_dir: Path,
    shards: list[str],
    target_bytes: int,
    jobs: int,
    hplt_lang: str,
    url_suffix: str | None,
) -> list[Path]:
    """Stream shards until the cache holds at least target_bytes of filtered text.

    Each shard gives an equal quota, so the text spreads over many shards. A cached part made
    with a smaller quota is streamed again.
    """
    manifest = load_manifest(cache_dir)
    streams = max(1, min(jobs, MAX_STREAMS, len(shards)))
    quota = max(1, -(-target_bytes // streams))

    def usable(name: str) -> bool:
        return part_is_usable(manifest.get(name), quota)

    total = sum(manifest[name]["bytes"] for name in manifest if usable(name))
    pending = [url for url in shards if not usable(Path(url).name)]
    with concurrent.futures.ProcessPoolExecutor(max_workers=streams) as executor:
        running: dict[concurrent.futures.Future, str] = {}
        while True:
            while pending and len(running) < streams and total + quota * len(running) < target_bytes:
                url = pending.pop(0)
                running[executor.submit(stream_shard, url, part_path(cache_dir, url), quota, hplt_lang, url_suffix)] = url
            if not running:
                break
            done, _ = concurrent.futures.wait(running, return_when=concurrent.futures.FIRST_COMPLETED)
            for future in done:
                name = Path(running.pop(future)).name
                manifest[name] = future.result()
                total += manifest[name]["bytes"]
                save_manifest(cache_dir, manifest)
    if total < target_bytes:
        print(f"Warning: only {total / 1e6:.0f} MB of filtered text available (target {target_bytes / 1e6:.0f} MB)")
    return [part_path(cache_dir, name) for name in sorted(manifest) if usable(name) and manifest[name]["bytes"] > 0]


def ensure_heldout(cache_dir: Path, heldout_url: str, hplt_lang: str, url_suffix: str | None) -> Path:
    path = cache_dir / "heldout.txt.zst"
    if not path.is_file():
        stream_shard(heldout_url, path, HELDOUT_BYTES, hplt_lang, url_suffix, HELDOUT_REGISTERS)
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description="Rebuild n-gram DB from the HPLT 3.0 corpus.")
    parser.add_argument("-l", "--lang", required=True, help="Language short code, for example: en")
    parser.add_argument("-v", "--variant", required=True, help="Language variant, for example: en_US")
    parser.add_argument(
        "--target-mb", type=int, default=TARGET_MB_DEFAULT, help="Filtered text (uncompressed MB) used for counting"
    )
    parser.add_argument("--order", type=int, default=ORDER_DEFAULT, help="Highest n-gram order")
    parser.add_argument(
        "--jobs",
        type=int,
        default=0,
        help="Global worker count for this script (streaming + n-gram generation). 0 = auto-detect.",
    )
    parser.add_argument("--min-free-gb", type=float, default=20, help="Abort when free disk drops below this")
    parser.add_argument("--clean-cache", action="store_true", help="Delete the filtered-text cache when done")
    parser.add_argument(
        "--corpus-only", action="store_true", help="Fill the filtered-text cache and the held-out set, then stop"
    )
    args = parser.parse_args()

    lang = args.lang
    lang_variant = args.variant
    if args.jobs < 0:
        raise RuntimeError("--jobs must be >= 0")
    jobs = max(1, cpu_jobs() - 1) if args.jobs == 0 else max(1, args.jobs)

    if lang not in HPLT_LANGS:
        raise RuntimeError(f"No HPLT language mapping for {lang}")

    hplt_lang = HPLT_LANGS[lang]
    url_suffix = VARIANT_URL_SUFFIX.get(lang_variant)
    cache_dir = CACHE_ROOT / f"{lang}_{lang_variant}_{filter_version()}"
    cache_dir.mkdir(parents=True, exist_ok=True)
    report_disk("start", args.min_free_gb)

    shards, heldout_url = split_heldout(list_shards(hplt_lang))
    ensure_heldout(cache_dir, heldout_url, hplt_lang, url_suffix)
    target_bytes = args.target_mb * 1_000_000
    parts = fill_cache(cache_dir, shards, target_bytes, jobs, hplt_lang, url_suffix)
    if not parts:
        raise RuntimeError(f"No filtered text for {lang_variant}")
    report_disk("corpus ready", args.min_free_gb)
    if args.corpus_only:
        print(f"Corpus cache: {cache_dir}")
        return 0

    db_dir = (SCRIPT_DIR / ".." / "resources_js" / lang_variant / "ngrams_db").resolve()
    dict_path = (SCRIPT_DIR / ".." / "resources_js" / lang_variant / "hunspell" / lang_variant).resolve()
    with tempfile.TemporaryDirectory(prefix="tmp_ngram_", dir=str(SCRIPT_DIR)) as temp_dir:
        prefix = Path(temp_dir) / lang
        run_cmd(
            [
                sys.executable,
                str(SCRIPT_DIR / "gen_ngram.py"),
                "-l", lang,
                "--order", str(args.order),
                "--max-mb", str(args.target_mb),
                "--dict", str(dict_path),
                "--processes", str(jobs),
                "--output-prefix", str(prefix),
                "-i", *map(str, parts),
            ]
        )
        report_disk("n-grams counted", args.min_free_gb)
        run_cmd(
            [
                sys.executable,
                str(SCRIPT_DIR / "ngramtxt2marisa.py"),
                "--overwrite",
                "--output", str(db_dir),
                "--inputfile", f"{prefix}_ngram_merged.txt",
            ]
        )

    if args.clean_cache:
        shutil.rmtree(cache_dir)
    report_disk("done", 0)
    print("✅ N-gram DB successfully generated.")
    return 0


if __name__ == "__main__":
    run_main(main)
