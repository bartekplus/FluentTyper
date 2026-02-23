#!/usr/bin/env python3

from __future__ import annotations

import argparse
import concurrent.futures
import os
import shlex
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path


OSCAR_REPO_NAME = "community-oscar"
OSCAR_CORPUS_VERSION = "2024-38"
LANGUAGE_DETECTION_PROB = "0.975"
HARMFUL_SCORE = "300.0"
MAX_FILES_DEFAULT = 10
JQ_FILTER = "select(.metadata.quality_warnings == null and .metadata.identification.prob >= $prob and .metadata.harmful_pp >= $harmful) | .content"
GREP_FILTER = r"http[s]?://|www\.|<[^>]+>|[0-9]{4,}|[_=@#%^*+~\|/]{2,}|{}"

SCRIPT_DIR = Path(__file__).resolve().parent
CACHE_DIR = (SCRIPT_DIR / ".cache" / "oscar_processed").resolve()


@dataclass(frozen=True)
class PipelineTask:
    index: int
    zst_path: Path
    cache_file: Path
    output_file: Path


def run_cmd(cmd: list[str], cwd: Path | None = None, env: dict[str, str] | None = None) -> None:
    print(f"$ {shlex.join(cmd)}")
    subprocess.run(cmd, check=True, cwd=str(cwd) if cwd else None, env=env)


def cpu_workers() -> int:
    count = os.cpu_count() or 1
    return max(1, count - 1)


def ensure_repo_exists(repo_dir: Path) -> None:
    if repo_dir.is_dir():
        return
    env = os.environ.copy()
    env["GIT_LFS_SKIP_SMUDGE"] = "1"
    run_cmd(
        ["git", "clone", "ssh://git@hf.co/datasets/oscar-corpus/community-oscar"],
        cwd=SCRIPT_DIR,
        env=env,
    )


def list_available_parts(repo_dir: Path, lang: str) -> list[int]:
    pattern = f"{lang}_meta_part_*.zst"
    parts_dir = repo_dir / "data" / OSCAR_CORPUS_VERSION / f"{lang}_meta"
    indices: list[int] = []
    for path in sorted(parts_dir.glob(pattern)):
        stem = path.stem  # *.zst removed; still includes ".jsonl"
        # Example: en_meta_part_1.jsonl
        try:
            index = int(stem.split("_")[-1].split(".")[0])
            indices.append(index)
        except (ValueError, IndexError):
            continue
    return indices


def compute_selected_indices(available_indices: list[int], max_files: int) -> list[int]:
    if not available_indices:
        return []

    file_count = len(available_indices)
    max_files_to_process = min(max_files, file_count)
    file_step = max(1, file_count // max_files_to_process)
    file_max = file_step * max_files_to_process
    return list(range(1, file_max + 1, file_step))


def prepare_tasks(
    repo_dir: Path,
    work_dir: Path,
    lang: str,
    lang_variant: str,
    selected_indices: list[int],
) -> list[PipelineTask]:
    tasks: list[PipelineTask] = []
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    for index in selected_indices:
        output_file = work_dir / f"{lang}_sentences_checked_{index}.txt"
        cache_file = CACHE_DIR / f"{OSCAR_CORPUS_VERSION}_{lang}_{lang_variant}_{index}.txt"
        if cache_file.is_file() and cache_file.stat().st_size > 0:
            print(f"Using cached data for index {index}")
            shutil.copy2(cache_file, output_file)
            continue

        file_name = f"{lang}_meta_part_{index}.jsonl"
        relative_file = Path("data") / OSCAR_CORPUS_VERSION / f"{lang}_meta" / file_name
        include_arg = f"{relative_file}.zst"
        print(f"Fetching {include_arg}")
        run_cmd(["git", "lfs", "pull", "--include", include_arg], cwd=repo_dir)

        zst_path = repo_dir / f"{relative_file}.zst"
        if not zst_path.is_file():
            print(f"Warning: {zst_path} not found after git lfs pull")
            continue

        tasks.append(PipelineTask(index=index, zst_path=zst_path, cache_file=cache_file, output_file=output_file))

    return tasks


def process_task(task: PipelineTask, lang_variant: str) -> None:
    print(f"Extracting and filtering data from {task.zst_path}")
    env = os.environ.copy()
    env["DICPATH"] = str((SCRIPT_DIR / ".." / "resources_js" / lang_variant / "hunspell").resolve())

    cmd = (
        f"unzstd -c {shlex.quote(str(task.zst_path))} | "
        f"jq --argjson prob {LANGUAGE_DETECTION_PROB} --argjson harmful {HARMFUL_SCORE} -r {shlex.quote(JQ_FILTER)} | "
        "awk 'NF>=3' | "
        f"grep -vE '{GREP_FILTER}' | "
        f"hunspell -i utf-8 -d {shlex.quote(lang_variant)} -G -L"
    )

    with task.cache_file.open("wb") as out:
        subprocess.run(cmd, check=True, shell=True, env=env, executable="/bin/bash", stdout=out)

    shutil.copy2(task.cache_file, task.output_file)
    try:
        task.zst_path.unlink()
    except FileNotFoundError:
        pass


def merge_outputs(work_dir: Path, lang: str) -> Path:
    merged_output = work_dir / f"{lang}_sentences_checked.txt"
    chunk_files = sorted(work_dir.glob(f"{lang}_sentences_checked_*.txt"))
    if not chunk_files:
        raise RuntimeError("No processed sentence files were generated.")

    with merged_output.open("wb") as dst:
        for chunk in chunk_files:
            with chunk.open("rb") as src:
                shutil.copyfileobj(src, dst)
            chunk.unlink(missing_ok=True)

    return merged_output


def main() -> int:
    parser = argparse.ArgumentParser(description="Rebuild n-gram DB from OSCAR corpus.")
    parser.add_argument("-l", "--lang", required=True, help="Language short code, for example: en")
    parser.add_argument("-v", "--variant", required=True, help="Language variant, for example: en_US")
    parser.add_argument("--max-files", type=int, default=MAX_FILES_DEFAULT, help="Number of corpus files to sample")
    parser.add_argument(
        "--jobs",
        type=int,
        default=0,
        help="Global worker count for this script (extract/filter + n-gram generation). 0 = auto-detect.",
    )
    args = parser.parse_args()

    lang = args.lang
    lang_variant = args.variant
    max_files = max(1, args.max_files)
    if args.jobs < 0:
        raise RuntimeError("--jobs must be >= 0")
    jobs = cpu_workers() if args.jobs == 0 else max(1, args.jobs)

    if lang == "hr":
        print("Low quality HR dataset, skipping")
        return 0

    repo_dir = (SCRIPT_DIR / OSCAR_REPO_NAME).resolve()
    ensure_repo_exists(repo_dir)
    run_cmd(["git", "lfs", "install"], cwd=repo_dir)

    available_indices = list_available_parts(repo_dir, lang)
    selected_indices = compute_selected_indices(available_indices, max_files=max_files)
    if not selected_indices:
        raise RuntimeError(f"No OSCAR files found for language {lang} in {repo_dir}")

    with tempfile.TemporaryDirectory(prefix="tmp_ngram_", dir=str(SCRIPT_DIR)) as temp_dir:
        work_dir = Path(temp_dir)
        tasks = prepare_tasks(repo_dir, work_dir, lang, lang_variant, selected_indices)
        if tasks:
            max_workers = min(jobs, len(tasks))
            with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
                futures = [executor.submit(process_task, task, lang_variant) for task in tasks]
                for future in concurrent.futures.as_completed(futures):
                    future.result()

        merged_output = merge_outputs(work_dir, lang)
        gen_ngram_script = (SCRIPT_DIR / "gen_ngram.py").resolve()
        marisa_script = (SCRIPT_DIR / "ngramtxt2marisa.py").resolve()
        gen_ngram_cmd = [
            "python3",
            str(gen_ngram_script),
            "-i",
            str(merged_output),
            "-l",
            lang,
            "--processes",
            str(jobs),
        ]
        run_cmd(gen_ngram_cmd)
        run_cmd(
            [
                "python3",
                str(marisa_script),
                "--overwrite",
                "--output",
                str((SCRIPT_DIR / ".." / "resources_js" / lang_variant / "ngrams_db").resolve()),
                "--inputfile",
                str(work_dir / f"{lang}_sentences_checked_ngram_merged.txt"),
            ]
        )

    print("✅ N-gram DB successfully generated.")
    run_cmd(["git", "lfs", "prune"], cwd=repo_dir)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as exc:
        print(f"Command failed with exit code {exc.returncode}: {shlex.join(exc.cmd)}")
        raise SystemExit(exc.returncode)
    except RuntimeError as exc:
        print(exc)
        raise SystemExit(1)
