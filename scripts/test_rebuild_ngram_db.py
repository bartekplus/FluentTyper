#!/usr/bin/env python3
"""Tests for the HPLT document filter and shard selection.

Run:  python3 -B scripts/test_rebuild_ngram_db.py
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rebuild_ngram_db import filter_document, part_is_usable, split_heldout  # noqa: E402

FORUM = {"ID": 0.9, "OP": 0.2, "NA": 0.1, "HI": 0.1, "SP": 0.1, "MT": 0.05, "IP": 0.1, "ds": 0.05}
ADS = {"ID": 0.1, "OP": 0.2, "NA": 0.6, "HI": 0.1, "SP": 0.1, "MT": 0.05, "IP": 0.88, "ds": 0.82}


def doc(text: str, register=FORUM, seg_langs=None, url="https://forum.example.pl/t/1", lang="pol_Latn") -> dict:
    lines = text.split("\n")
    return {
        "u": url,
        "filter": "keep",
        "lang": [lang, "slk_Latn"],
        "prob": [0.99, 0.01],
        "text": text,
        "seg_langs": seg_langs if seg_langs is not None else [lang] * len(lines),
        "web-register": register,
    }


SENTENCE = "Wczoraj byłem w sklepie i kupiłem chleb."


class FilterDocumentTest(unittest.TestCase):
    def test_forum_prose_is_kept(self) -> None:
        self.assertEqual(filter_document(doc(SENTENCE), "pol_Latn"), [SENTENCE])

    def test_ads_register_is_dropped(self) -> None:
        self.assertEqual(filter_document(doc(SENTENCE, register=ADS), "pol_Latn"), [])

    def test_missing_register_does_not_drop_the_language(self) -> None:
        self.assertEqual(filter_document(doc(SENTENCE, register=None), "pol_Latn"), [SENTENCE])

    def test_other_document_language_is_dropped(self) -> None:
        self.assertEqual(filter_document(doc(SENTENCE, lang="slk_Latn"), "pol_Latn"), [])

    def test_foreign_segment_is_dropped(self) -> None:
        text = SENTENCE + "\nThis line is written in English, not Polish."
        kept = filter_document(doc(text, seg_langs=["pol_Latn", "eng_Latn"]), "pol_Latn")
        self.assertEqual(kept, [SENTENCE])

    def test_croatian_accepts_serbo_croatian_segments(self) -> None:
        text = "Jučer sam bio u trgovini i kupio kruh."
        hr = doc(text, lang="hrv_Latn", seg_langs=["hbs_Latn"])
        self.assertEqual(filter_document(hr, "hrv_Latn"), [text])

    def test_seg_langs_mismatch_falls_back_to_document_language(self) -> None:
        self.assertEqual(filter_document(doc(SENTENCE, seg_langs=[]), "pol_Latn"), [SENTENCE])

    def test_navigation_and_boilerplate_lines_are_dropped(self) -> None:
        text = "\n".join(
            [
                "Strona główna Kontakt Sklep Koszyk",  # no sentence end
                "Ta strona używa plików cookie do działania.",
                "Kup teraz na www.example.pl taniej!",
                "Tak.",  # too short
                SENTENCE,
            ]
        )
        self.assertEqual(filter_document(doc(text), "pol_Latn"), [SENTENCE])

    def test_greek_question_mark_is_a_sentence_end_only_for_greek(self) -> None:
        greek = "Τι κάνεις σήμερα το απόγευμα;"
        self.assertEqual(filter_document(doc(greek, lang="ell_Grek"), "ell_Grek"), [greek])
        self.assertEqual(filter_document(doc("Mam pytanie do ciebie dzisiaj;"), "pol_Latn"), [])

    def test_pt_br_keeps_only_brazilian_hosts(self) -> None:
        text = "Ontem eu fui ao mercado comprar pão."
        br = doc(text, url="https://blog.example.com.br/post", lang="por_Latn")
        pt = doc(text, url="https://blog.example.pt/post", lang="por_Latn")
        self.assertEqual(filter_document(br, "por_Latn", ".br"), [text])
        self.assertEqual(filter_document(pt, "por_Latn", ".br"), [])


class SplitHeldoutTest(unittest.TestCase):
    def test_heldout_is_last_good_shard_and_not_in_training(self) -> None:
        base = "https://data.hplt-project.org/three/sorted/pol_Latn/"
        shards = [base + name for name in ("10_1.jsonl.zst", "9_1.jsonl.zst", "8_1.jsonl.zst", "8_2.jsonl.zst", "7_1.jsonl.zst")]
        training, heldout = split_heldout(shards)
        self.assertEqual(heldout, base + "8_2.jsonl.zst")
        self.assertNotIn(heldout, training)
        self.assertEqual(len(training), 4)


class PartIsUsableTest(unittest.TestCase):
    def test_part_from_a_smaller_quota_is_streamed_again(self) -> None:
        self.assertFalse(part_is_usable({"bytes": 4_500_000, "exhausted": False}, 270_000_000))

    def test_full_or_exhausted_parts_are_reused(self) -> None:
        self.assertTrue(part_is_usable({"bytes": 270_000_000, "exhausted": False}, 270_000_000))
        self.assertTrue(part_is_usable({"bytes": 600_000, "exhausted": True}, 270_000_000))
        self.assertFalse(part_is_usable(None, 1))


if __name__ == "__main__":
    unittest.main(verbosity=2)
