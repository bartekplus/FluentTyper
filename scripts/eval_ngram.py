#!/usr/bin/env python3
"""Measure word-prediction quality of an n-gram model on held-out text.

The scoring copies presage's SmoothedNgramTriePredictor
(scripts/.deps/presage/src/lib/predictors/smoothedNgramTriePredictor.cpp):
candidates come from the highest-order context down, filtered by the typed
prefix, and score sum_k delta_k * C(ngram_k) / C(context_k).
It is good to compare models, not for absolute runtime numbers.
"""

from __future__ import annotations

import argparse
import array
import bisect
import functools
import json
import os
from pathlib import Path

from gen_ngram import make_tokenizer, open_text

MAX_PARTIAL_PREDICTION_SIZE = 60  # resources_js_lang_template/presage.xml
DEFAULT_K = 5  # DEFAULT_NUM_SUGGESTIONS in src/core/domain/constants.ts


def default_deltas(order: int) -> list[float]:
    # 4 -> 0.01 0.08 0.3 0.6 (the shipped presage.xml); an extra lower order gets 1/8 of the one above.
    deltas = [0.01, 0.08, 0.3, 0.6]
    while len(deltas) < order:
        deltas.insert(0, deltas[0] / 8)
    return deltas[-order:]


def load_counts(path: Path) -> dict[tuple[str, ...], int]:
    """Read n-gram counts from a merged text file or a marisa ngrams_db directory."""
    counts: dict[tuple[str, ...], int] = {}
    if path.is_dir():
        import marisa_trie

        trie = marisa_trie.Trie()
        trie.load(str(path / "ngrams.trie"))
        values = array.array("i")
        with open(path / "ngrams.counts", "rb") as f:
            values.frombytes(f.read())
        for key, key_id in trie.items():
            counts[tuple(key.split(" ")[1:])] = values[key_id + 1]
    else:
        with open(path, encoding="utf-8") as f:
            for line in f:
                key, count = line.rstrip("\n").split("\t")
                counts[tuple(key.split(" ")[1:])] = int(count)
    return counts


class Model:
    def __init__(self, counts: dict[tuple[str, ...], int], deltas: list[float]):
        self.counts = counts
        self.deltas = deltas
        self.unigram_sum = max(1, sum(v for k, v in counts.items() if len(k) == 1))
        # context -> [(word, count)] sorted by count desc, like the trie's top-`limit` search.
        self.followers: dict[tuple[str, ...], list[tuple[str, int]]] = {}
        for key, value in counts.items():
            self.followers.setdefault(key[:-1], []).append((key[-1], value))
        for items in self.followers.values():
            items.sort(key=lambda kv: (-kv[1], kv[0]))
        unigrams = sorted(self.followers.get((), []))
        self.unigram_words = [w for w, _ in unigrams]
        self.unigram_counts = [c for _, c in unigrams]

    @functools.lru_cache(maxsize=200_000)
    def _completions(self, context: tuple[str, ...], prefix: str, limit: int) -> tuple[str, ...]:
        if not context:
            # Unigrams: bisect the prefix range instead of a full scan.
            lo = bisect.bisect_left(self.unigram_words, prefix)
            hi = bisect.bisect_left(self.unigram_words, prefix + "\U0010ffff")
            ranked = sorted(range(lo, hi), key=lambda i: (-self.unigram_counts[i], self.unigram_words[i]))
            return tuple(self.unigram_words[i] for i in ranked[:limit])
        found = []
        for word, _ in self.followers.get(context, ()):
            if word.startswith(prefix):
                found.append(word)
                if len(found) == limit:
                    break
        return tuple(found)

    def predict(self, context: list[str], prefix: str, k: int) -> list[str]:
        order = len(self.deltas)
        history = ([""] * order + context)[-(order - 1) :] if order > 1 else []
        candidates: list[str] = []
        for n in range(order, 0, -1):
            ctx = tuple(history[len(history) - (n - 1) :]) if n > 1 else ()
            if "" in ctx:
                continue
            for word in self._completions(ctx, prefix, MAX_PARTIAL_PREDICTION_SIZE - len(candidates)):
                if word not in candidates:
                    candidates.append(word)
            if len(candidates) >= MAX_PARTIAL_PREDICTION_SIZE:
                break

        scored = []
        for word in candidates:
            tokens = history + [word]
            probability = 0.0
            for n in range(order):
                # Empty history slots never match a stored n-gram, as in presage.
                ngram = tuple(tokens[-(n + 1) :])
                numerator = 0 if "" in ngram else self.counts.get(ngram, 0)
                if n == 0:
                    denominator = self.unigram_sum
                else:
                    denominator = 0 if "" in ngram[:-1] else self.counts.get(ngram[:-1], 0)
                if denominator > 0 and denominator >= numerator:
                    probability += self.deltas[n] * numerator / denominator
            if probability > 0:
                scored.append((probability, word))
        scored.sort(key=lambda pw: -pw[0])
        return [w for _, w in scored[:k]]


def evaluate(model: Model, runs: list[list[str]], k: int) -> dict[str, float]:
    """KSR: share of word characters the user does not type when the word is taken from the top-k."""
    chars = saved = words = top1 = topk = 0
    for tokens in runs:
        for i, word in enumerate(tokens):
            context = tokens[:i]
            words += 1
            chars += len(word)
            first = model.predict(context, "", k)
            top1 += bool(first) and first[0] == word
            for typed in range(len(word)):
                predictions = first if typed == 0 else model.predict(context, word[:typed], k)
                if word in predictions:
                    topk += typed == 0
                    saved += len(word) - typed
                    break
    return {
        "words": words,
        "ksr": 100 * saved / max(1, chars),
        "top1": 100 * top1 / max(1, words),
        f"top{k}": 100 * topk / max(1, words),
    }


def heldout_runs(path: Path, language: str, max_words: int) -> list[list[str]]:
    tokenize_line = make_tokenizer(language)
    runs, total = [], 0
    for line in open_text(path):
        for tokens in tokenize_line(line.strip()):
            runs.append(tokens)
            total += len(tokens)
        if total >= max_words:
            break
    return runs


def db_size(path: Path) -> int:
    if path.is_dir():
        return sum(os.path.getsize(path / name) for name in ("ngrams.trie", "ngrams.counts"))
    return os.path.getsize(path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", required=True, type=Path, help="merged n-gram .txt file or ngrams_db directory")
    parser.add_argument("--heldout", required=True, type=Path, help="held-out text (.txt or .txt.zst)")
    parser.add_argument("-l", "--language", required=True)
    parser.add_argument("--deltas", help="space-separated deltas, lowest order first (default: shipped scheme)")
    parser.add_argument("--order", type=int, default=4, help="model order when --deltas is not given")
    parser.add_argument("-k", type=int, default=DEFAULT_K)
    parser.add_argument("--max-words", type=int, default=20_000)
    args = parser.parse_args()

    deltas = [float(d) for d in args.deltas.split()] if args.deltas else default_deltas(args.order)
    model = Model(load_counts(args.model), deltas)
    result = evaluate(model, heldout_runs(args.heldout, args.language, args.max_words), args.k)
    result.update(model=str(args.model), deltas=deltas, size_bytes=db_size(args.model), keys=len(model.counts))
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
