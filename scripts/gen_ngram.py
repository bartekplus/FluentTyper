#!/usr/bin/env python3

import argparse
import concurrent.futures
import multiprocessing
import pickle
import re
import subprocess
import tempfile
import zlib
from collections import Counter
from pathlib import Path


NGRAM_ORDER_DEFAULT = 4
# Longer n-grams (order 2+) kept per unigram, most frequent first: about 2x the DB of the old per-order cap (1.33).
NGRAM_LONGER_PER_WORD = 4.5
NGRAM_MIN_COUNT = 10
LINE_BLOCK = 2000  # consecutive lines given to one worker
SPILL_KEYS = 4_000_000  # per-worker Counter size that triggers a spill to disk
HUNSPELL_BATCH = 50_000
LANGS = {
    "ar": "arabic",
    "de": "german",
    "el": "greek",
    "en": "english",
    "es": "spanish",
    "fr": "french",
    "hr": "slovene",  # NLTK punkt has no Croatian model; Slovene is the closest one.
    "pl": "polish",
    "pt": "portuguese",
    "sv": "swedish",
}

parser = argparse.ArgumentParser()
parser.add_argument("-i", "--inputfiles", nargs="+", required=True, help="sentence text files (.txt or .txt.zst)")
parser.add_argument("-l", "--language", type=str, help="language of the sentences", required=True)
parser.add_argument("--order", type=int, default=NGRAM_ORDER_DEFAULT, help="highest n-gram order")
parser.add_argument("--max-mb", type=float, default=0, help="read at most this many MB of text, spread over the inputs")
parser.add_argument("--dict", help="hunspell dictionary path (without extension); n-grams with rejected words are dropped")
parser.add_argument("--output-prefix", help="output path prefix (default: first input without extension)")
parser.add_argument(
    "--processes",
    type=int,
    default=0,
    help="Number of worker processes. Default 0 = CPU count.",
)

SKIPPED_CHARS = set('!"#$%&()*+,./:;<=>?@[\\]^_`{|}~')


# Arabic tatweel (U+0640) and harakat (U+064B-U+0652, U+0670): the runtime
# strips tatweel from typed input, so keys containing these never match.
ARABIC_STRIP = dict.fromkeys([0x0640, *range(0x064B, 0x0653), 0x0670])


def filter_tokens(tokens_raw, language=None):
    tokens_array = []
    tokens = []
    for token in tokens_raw:
        split = False
        if language == "ar":
            token = token.translate(ARABIC_STRIP)
        token_orig = token.strip()
        token = token.strip().lower()

        if not token:
            split = True
        elif not token.isprintable():
            split = True
        elif len(token) <= 1 and not token.isalpha():
            split = True
        elif token.isdigit():
            split = True
        elif not SKIPPED_CHARS.isdisjoint(token):
            split = True
        elif not token[0].isalpha():
            split = True
        elif (
            len(token) > 1
            and token_orig == token_orig.upper()
            and any(c.isupper() for c in token_orig)
        ):
            split = True

        if split:
            tokens_array.append(tokens)
            tokens = []
        else:
            tokens.append(token)

    tokens_array.append(tokens)
    return tokens_array


def ensure_nltk_tokenizers():
    import nltk

    required = (
        ("punkt", "tokenizers/punkt"),
        ("punkt_tab", "tokenizers/punkt_tab"),
    )
    for package_name, resource_path in required:
        try:
            nltk.data.find(resource_path)
            continue
        except LookupError:
            pass

        print(f"Missing NLTK resource '{package_name}', attempting download...")
        nltk.download(package_name, quiet=True)
        try:
            nltk.data.find(resource_path)
        except LookupError as exc:
            raise RuntimeError(
                f"Required NLTK resource '{package_name}' is not available. "
                "Install it with: python3 -m nltk.downloader punkt punkt_tab"
            ) from exc


def make_tokenizer(language):
    """Return a function that maps one text line to runs of n-gram tokens."""
    from nltk import sent_tokenize
    from nltk.tokenize import TweetTokenizer

    tk = TweetTokenizer(match_phone_numbers=False)

    def tokenize_line(line):
        if language == "ar":
            sentences = [s for s in re.split(r"[؟.!]+", line) if s.strip()]
        else:
            sentences = sent_tokenize(line, language=LANGS[language])
        runs = []
        for sentence in sentences:
            for tokens in filter_tokens(tk.tokenize(sentence.replace("’", "'")), language):
                if tokens:
                    runs.append(tokens)
        return runs

    return tokenize_line


def open_text(path):
    """Yield text lines from a .txt or .txt.zst file."""
    path = str(path)
    if not path.endswith(".zst"):
        with open(path, encoding="utf-8", errors="ignore") as f:
            yield from f
        return
    # stderr is muted: a reader that stops early makes zstd report a broken pipe.
    proc = subprocess.Popen(["zstd", "-dcq", path], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    finished = False
    try:
        for raw in proc.stdout:
            yield raw.decode("utf-8", errors="ignore")
        finished = True
    finally:
        proc.stdout.close()
        if not finished:
            proc.kill()
        returncode = proc.wait()
    if returncode != 0:
        raise RuntimeError(f"zstd could not decompress {path}")


def read_lines(paths, max_bytes, worker=0, workers=1):
    """Yield this worker's share of lines; each file gives at most max_bytes / len(paths) bytes."""
    per_file = max_bytes / len(paths) if max_bytes else 0
    for path in paths:
        used = 0
        for index, line in enumerate(open_text(path)):
            used += len(line)
            if per_file and used > per_file:
                break
            if (index // LINE_BLOCK) % workers == worker:
                yield line


def split_runs(runs, vocabulary, bigrams):
    """Split token runs at words outside the vocabulary and between two words whose bigram
    is not in `bigrams`, so no n-gram holds such a word or such a bigram."""
    for tokens in runs:
        run = []
        for token in tokens:
            if token not in vocabulary:
                if run:
                    yield run
                run = []
                continue
            if run and f"{run[-1]} {token}" not in bigrams:
                yield run
                run = []
            run.append(token)
        if run:
            yield run


def count_ngrams(runs, order, counter):
    for tokens in runs:
        for n in range(1, order + 1):
            counter.update(" ".join(tokens[i : i + n]) for i in range(len(tokens) - n + 1))


def partition_of(key, partitions):
    # crc32, not hash(): str hashes differ between worker processes.
    return zlib.crc32(key.encode()) % partitions


def spill(counter, spill_dir, partitions, tag):
    buckets = [{} for _ in range(partitions)]
    for key, value in counter.items():
        buckets[partition_of(key, partitions)][key] = value
    for p, bucket in enumerate(buckets):
        # zlib level 1 cuts spill disk use about 3x for little CPU.
        with open(Path(spill_dir) / f"p{p}_{tag}.pkl.z", "wb") as f:
            f.write(zlib.compress(pickle.dumps(bucket, protocol=pickle.HIGHEST_PROTOCOL), 1))
    counter.clear()


def count_worker(args):
    paths, language, order, max_bytes, worker, workers, spill_dir, partitions, vocabulary, bigrams = args
    tokenize_line = make_tokenizer(language)
    counter = Counter()
    lines = spills = 0
    for line in read_lines(paths, max_bytes, worker, workers):
        runs = tokenize_line(line)
        count_ngrams(split_runs(runs, vocabulary, bigrams) if vocabulary is not None else runs, order, counter)
        lines += 1
        if len(counter) > SPILL_KEYS:
            spill(counter, spill_dir, partitions, f"w{worker}_{spills}")
            spills += 1
    spill(counter, spill_dir, partitions, f"w{worker}_{spills}")
    return lines


def merge_partition(args):
    """Sum one partition over all spills; a partition holds the global count of its keys."""
    spill_dir, p, min_count = args
    total = Counter()
    for path in sorted(Path(spill_dir).glob(f"p{p}_*.pkl.z")):
        # Safe: these are this run's own spill files in a private temp dir.
        with open(path, "rb") as f:
            total.update(pickle.loads(zlib.decompress(f.read())))
        path.unlink()
    return [(key, value) for key, value in total.items() if value >= min_count]


def count_pass(pool, paths, language, order, max_bytes, processes, spill_root, min_count, vocabulary=None, bigrams=None):
    """One parallel pass: workers count their share of lines and spill; partitions merge in parallel."""
    partitions = processes * 4
    with tempfile.TemporaryDirectory(prefix="ngram_spill_", dir=spill_root) as spill_dir:
        jobs = [
            (paths, language, order, max_bytes, w, processes, spill_dir, partitions, vocabulary, bigrams)
            for w in range(processes)
        ]
        lines = sum(pool.map(count_worker, jobs))
        spill_bytes = sum(f.stat().st_size for f in Path(spill_dir).iterdir())
        print(f"Counted {lines} lines (order {order}); spill {spill_bytes / 1e9:.2f} GB")
        survivors = {}
        for part in pool.imap_unordered(merge_partition, [(spill_dir, p, min_count) for p in range(partitions)]):
            survivors.update(part)
    return survivors


def count_corpus(paths, language, order, max_bytes, processes, spill_root, dict_path=None, min_count=NGRAM_MIN_COUNT):
    """Count 1..order-grams in parallel. Returns {key: count} with count >= min_count.

    A first pass counts unigrams and bigrams. The vocabulary is the words with count >= min_count
    (that hunspell accepts, with dict_path). The second pass splits the token stream at every
    other word and between the two words of every bigram below min_count. An n-gram never
    occurs more often than a word or bigram in it, so the result is exact, but far fewer
    one-off n-grams reach the spill files.
    """
    with multiprocessing.Pool(processes=processes) as pool:
        first = count_pass(pool, paths, language, min(order, 2), max_bytes, processes, spill_root, min_count)
        words = [key for key in first if " " not in key]
        rejected = rejected_words(words, dict_path) if dict_path else set()
        if dict_path:
            print(f"Dictionary gate: rejected {len(rejected)} of {len(words)} words")
        vocabulary = frozenset(w for w in words if w not in rejected)
        bigrams = frozenset(
            key for key in first if " " in key and all(w in vocabulary for w in key.split(" "))
        )
        del first
        return count_pass(pool, paths, language, order, max_bytes, processes, spill_root, min_count, vocabulary, bigrams)


def hunspell_accepts(forms, dict_path):
    """Return the forms that hunspell accepts. One form per line; -L -G prints lines without errors."""
    batches = [forms[i : i + HUNSPELL_BATCH] for i in range(0, len(forms), HUNSPELL_BATCH)]

    def check(batch):
        out = subprocess.run(
            ["hunspell", "-i", "utf-8", "-d", str(dict_path), "-L", "-G"],
            input="\n".join(batch) + "\n",
            capture_output=True,
            text=True,
            check=True,
        ).stdout
        return set(out.splitlines())

    with concurrent.futures.ThreadPoolExecutor() as executor:
        return set().union(*executor.map(check, batches))


def rejected_words(words, dict_path):
    """Words that hunspell rejects in both lowercase and Title-case form, or that contain a digit."""
    candidates = [w for w in words if not any(c.isdigit() for c in w)]
    forms = sorted({f for w in candidates for f in (w, w[:1].upper() + w[1:])})
    accepted = hunspell_accepts(forms, dict_path)
    return {w for w in words if w not in accepted and (w[:1].upper() + w[1:]) not in accepted}


def prune(counts, order, min_count=NGRAM_MIN_COUNT, per_word=NGRAM_LONGER_PER_WORD):
    """Keep every word seen min_count times, and the most frequent longer n-grams of all orders together,
    up to per_word for each word. Ranking all orders by count keeps what is frequent in any order."""
    by_order = [[] for _ in range(order)]
    for key, value in counts.items():
        if value >= min_count:
            by_order[key.count(" ")].append((key, value))
    by_count = lambda kv: (-kv[1], kv[0])
    longer = sorted((kv for items in by_order[1:] for kv in items), key=by_count)
    kept = set(key for key, _ in longer[: round(len(by_order[0]) * per_word)])
    return [sorted(items, key=by_count) if n == 0 else sorted((kv for kv in items if kv[0] in kept), key=by_count)
            for n, items in enumerate(by_order)]


def write_outputs(pruned, prefix):
    with open(f"{prefix}_ngram_merged.txt", "w", encoding="utf-8") as merged:
        for n, items in enumerate(pruned, start=1):
            with open(f"{prefix}_ngram_{n}.txt", "w", encoding="utf-8") as f:
                for key, value in items:
                    line = f"{n} {key}\t{value}\n"
                    f.write(line)
                    merged.write(line)
            print(f"Wrote {len(items)} {n}-grams")


if __name__ == "__main__":
    args = parser.parse_args()

    try:
        ensure_nltk_tokenizers()
    except RuntimeError as exc:
        print(exc)
        raise SystemExit(1)
    num_processes = args.processes if args.processes > 0 else multiprocessing.cpu_count()
    print(f"Using {num_processes} processes for parallel processing.")
    prefix = args.output_prefix or re.sub(r"(\.txt)?(\.zst)?$", "", args.inputfiles[0])

    counts = count_corpus(
        args.inputfiles,
        args.language,
        args.order,
        int(args.max_mb * 1e6),
        num_processes,
        spill_root=Path(prefix).parent,
        dict_path=args.dict,
    )
    write_outputs(prune(counts, args.order), prefix)
