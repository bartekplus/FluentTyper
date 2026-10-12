#!/usr/bin/env python3
"""Tests for gen_ngram's token filtering and the ngramtxt2marisa arguments.

Run:  python3 -B scripts/test_gen_ngram.py
"""

from __future__ import annotations

import importlib.util
import shutil
import subprocess
import sys
import tempfile
import unittest
from collections import Counter
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
from eval_ngram import Model, default_deltas, evaluate  # noqa: E402
from gen_ngram import (  # noqa: E402
    count_ngrams,
    filter_tokens,
    merge_partition,
    prune,
    rejected_words,
    spill,
    split_runs,
)


class FilterTokensTest(unittest.TestCase):
    def test_arabic_tatweel_and_harakat_are_stripped(self) -> None:
        # كتـــاب (tatweel), كِتَابٌ (kasra/fatha/dammatan), هٰذا (superscript alef)
        tokens = ["كتـــاب", "كِتَابٌ", "هٰذا", "ـــ"]
        self.assertEqual(filter_tokens(tokens, "ar"), [["كتاب", "كتاب", "هذا"], []])

    def test_other_languages_are_untouched(self) -> None:
        self.assertEqual(filter_tokens(["Hello", "world"], "en"), [["hello", "world"]])


class CountingTest(unittest.TestCase):
    def test_splitting_at_unknown_words_and_rare_bigrams_equals_dropping_their_ngrams(self) -> None:
        runs = [["i", "like", "zzq", "green", "tea", "zzq"], ["zzq"], ["i", "like", "tea"]]
        vocabulary = {"i", "like", "green", "tea"}
        bigrams = {"i like", "green tea"}  # "like tea" is below min count
        self.assertEqual(
            list(split_runs(runs, vocabulary, bigrams)), [["i", "like"], ["green", "tea"], ["i", "like"], ["tea"]]
        )
        whole, split = Counter(), Counter()
        count_ngrams(runs, 4, whole)
        count_ngrams(split_runs(runs, vocabulary, bigrams), 4, split)

        def allowed(key: str) -> bool:
            words = key.split(" ")
            return all(w in vocabulary for w in words) and all(
                f"{a} {b}" in bigrams for a, b in zip(words, words[1:])
            )

        self.assertEqual({k: v for k, v in whole.items() if allowed(k)}, dict(split))

    def test_count_corpus_matches_a_plain_count(self) -> None:
        if not importlib.util.find_spec("nltk"):
            self.skipTest("nltk is not installed")
        from gen_ngram import count_corpus, make_tokenizer

        lines = ["We like green tea a lot.", "We like green tea.", "They like coffee.", "We like green tea a lot."]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "corpus.txt"
            path.write_text("\n".join(lines * 3) + "\n", encoding="utf-8")
            counts = count_corpus([str(path)], "en", 4, 0, 2, tmp, min_count=3)
        expected = Counter()
        tokenize_line = make_tokenizer("en")
        for line in lines * 3:
            count_ngrams(tokenize_line(line), 4, expected)
        self.assertEqual(counts, {k: v for k, v in expected.items() if v >= 3})

    def test_partitioned_spills_merge_to_the_global_count(self) -> None:
        first, second = Counter(), Counter()
        count_ngrams([["a", "b", "c"], ["a", "b"]], 3, first)
        count_ngrams([["b", "c", "a"]], 3, second)
        expected = first + second
        with tempfile.TemporaryDirectory() as spill_dir:
            spill(Counter(first), spill_dir, 3, "w0")
            spill(Counter(second), spill_dir, 3, "w1")
            merged = dict(kv for p in range(3) for kv in merge_partition((spill_dir, p, 1)))
            self.assertEqual(merged, dict(expected))
            self.assertEqual(list(Path(spill_dir).iterdir()), [])

    def test_prune_applies_min_count_and_per_order_caps(self) -> None:
        counts = {"a": 50, "b": 40, "c": 30, "d": 5, "a b": 20, "b c": 15, "c a": 12, "a b c": 11}
        pruned = prune(counts, 3, min_count=10)
        self.assertEqual([k for k, _ in pruned[0]], ["a", "b", "c"])
        # 3 unigrams // 1.33 -> 2 bigrams, 2 // 1.33 -> 1 trigram
        self.assertEqual([k for k, _ in pruned[1]], ["a b", "b c"])
        self.assertEqual([k for k, _ in pruned[2]], ["a b c"])


EN_DICT = SCRIPT_DIR.parent / "resources_js" / "en_US" / "hunspell" / "en_US"


@unittest.skipUnless(shutil.which("hunspell") and EN_DICT.with_suffix(".dic").is_file(), "hunspell or en_US is missing")
class DictionaryGateTest(unittest.TestCase):
    def test_keeps_dictionary_words_names_and_contractions(self) -> None:
        words = ["house", "paris", "don't", "well-known", "qwzxv", "covid19", "houze"]
        self.assertEqual(rejected_words(words, EN_DICT), {"qwzxv", "covid19", "houze"})


class EvaluatorTest(unittest.TestCase):
    def test_default_deltas_match_shipped_presage_config(self) -> None:
        self.assertEqual(default_deltas(4), [0.125, 0.25, 0.5, 0.75])

    def test_context_beats_raw_frequency(self) -> None:
        counts = {("the",): 100, ("tea",): 10, ("green",): 10, ("green", "tea"): 9, ("green", "the"): 1}
        model = Model(counts, default_deltas(2))
        self.assertEqual(model.predict(["green"], "", 2), ["tea", "the"])
        self.assertEqual(model.predict([], "", 1), ["the"])

    def test_keystroke_savings_counts_the_untyped_characters(self) -> None:
        counts = {("the",): 100, ("tea",): 10, ("green",): 10, ("green", "tea"): 9}
        model = Model(counts, default_deltas(2))
        # "green" is not the top-1 with no prefix, so it is taken after typing "g" (4 of 5 saved);
        # "tea" is the top-1 after "green" (3 of 3 saved).
        result = evaluate(model, [["green", "tea"]], 1)
        self.assertAlmostEqual(result["ksr"], 100 * 7 / 8)
        self.assertEqual(result["top1"], 50.0)


@unittest.skipUnless(importlib.util.find_spec("marisa_trie"), "marisa-trie is not installed")
class NgramTxt2MarisaArgsTest(unittest.TestCase):
    def test_input_and_output_are_required(self) -> None:
        script = Path(__file__).resolve().parent / "ngramtxt2marisa.py"
        result = subprocess.run(
            [sys.executable, "-B", str(script)], capture_output=True, text=True, check=False
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("--inputfile", result.stderr)
        self.assertIn("--output", result.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
