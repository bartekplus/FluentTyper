import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import path from "path";
import {
  explanationTable,
  reviewExplanation,
  reviewExplanations,
} from "../../src/core/domain/grammar/review/reviewExplanations";
import { ENGLISH_EXPLANATIONS } from "../../src/core/domain/grammar/review/englishExplanations";
import {
  isPageMessageKey,
  reviewText,
  type PageMessageKey,
} from "../../src/core/domain/grammar/review/reviewMessages";
import type { ReviewMessageKey } from "../../src/core/domain/grammar/review/types";
import { GRAMMAR_RULE_CATALOG } from "../../src/core/domain/grammar/ruleCatalog";

const REVIEW_DIR = path.join(import.meta.dir, "../../src/core/domain/grammar/review");
const LANGS = ["en", "fr", "hr", "es", "el", "sv", "de", "pl", "pr"];
const PAGE_KEYS: PageMessageKey[] = [
  "review_msg_unknown_word",
  "review_msg_two_initial_capitals",
  "review_msg_local_ai",
];

const source = (file: string) => readFileSync(path.join(REVIEW_DIR, file), "utf8");
const tableKeys = (text: string) => [...text.matchAll(/^ {2}(review_\w+): \[$/gm)].map((m) => m[1]);

/** Every message key a finding or the rule catalog names. */
const USED_KEYS = new Set<string>([
  ...readdirSync(REVIEW_DIR, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts"))
    .flatMap((file) =>
      [...source(file).matchAll(/messageKey: "(review_msg_\w+)"/g)].map((m) => m[1]),
    ),
  ...GRAMMAR_RULE_CATALOG.map((rule) => rule.titleI18nKey).filter((key) =>
    key.startsWith("review_msg_"),
  ),
]);

describe("Review explanations (background table)", () => {
  test("the page's table holds UI text and only the page's own findings' explanations", () => {
    const pageTable = tableKeys(source("reviewMessages.ts"));
    expect(pageTable.filter((key) => key.startsWith("review_msg_")).sort()).toEqual(
      [...PAGE_KEYS].sort(),
    );
    const backgroundTable = tableKeys(source("reviewExplanations.ts"));
    expect(backgroundTable.length).toBeGreaterThan(50);
    expect(backgroundTable.every((key) => key.startsWith("review_msg_"))).toBe(true);
    expect(backgroundTable.filter((key) => pageTable.includes(key))).toEqual([]);
    expect(backgroundTable.filter((key) => isPageMessageKey(key))).toEqual([]);
  });

  test("every key a finding uses resolves in every UI language", () => {
    expect(USED_KEYS.size).toBeGreaterThan(50);
    const known = new Set([...tableKeys(source("reviewExplanations.ts")), ...PAGE_KEYS]);
    for (const key of USED_KEYS) {
      expect(known.has(key)).toBe(true);
      for (const lang of LANGS) {
        const text = isPageMessageKey(key)
          ? reviewText(key, lang)
          : reviewExplanation(key as ReviewMessageKey, lang);
        expect(text.trim().length).toBeGreaterThan(0);
        // The background sends the same text the explanation resolves to.
        if (!isPageMessageKey(key)) {
          expect(reviewExplanations([key], lang)).toEqual({ [key]: text });
        }
      }
    }
  });

  test("each shipped language file has the same keys as English, and no empty text", () => {
    const english = Object.keys(ENGLISH_EXPLANATIONS);
    expect(english.sort()).toEqual(tableKeys(source("reviewExplanations.ts")).sort());
    for (const lang of LANGS) {
      const table = explanationTable(lang);
      expect(Object.keys(table).sort()).toEqual(english);
      expect(Object.values(table).filter((text) => !text.trim())).toEqual([]);
      expect(reviewExplanations(english, lang)).toEqual(table);
    }
  });

  test("the page's own explanations are the page's only", () => {
    for (const key of PAGE_KEYS) {
      expect(reviewExplanation(key, "en")).toBe("");
      expect(reviewExplanations([key], "en")).toEqual({});
    }
  });

  test("language resolution and fallback are unchanged", () => {
    const key = "review_msg_phrase_correction";
    expect(reviewExplanation(key, "en")).toBe(
      "Use the conventional form of this fixed English phrase.",
    );
    expect(reviewExplanation(key, "pl")).toBe(
      "Użyj utartej formy tego stałego wyrażenia angielskiego.",
    );
    expect(reviewExplanation(key, "pt-BR")).toBe(reviewExplanation(key, "pr"));
    expect(reviewExplanation(key, "pt")).not.toBe(reviewExplanation(key, "en"));
    expect(reviewExplanation(key, "de_DE")).toBe(reviewExplanation(key, "de"));
    expect(reviewExplanation(key, "FR-ca")).toBe(reviewExplanation(key, "fr"));
    for (const unknown of ["", "xx", "zh-CN"]) {
      expect(reviewExplanation(key, unknown)).toBe(reviewExplanation(key, "en"));
    }
  });

  test("a batch is once per key; page keys and unknown keys are left out", () => {
    expect(
      reviewExplanations(
        [
          "review_msg_typo",
          "review_msg_typo",
          "review_msg_unknown_word",
          "__proto__",
          "constructor",
          "review_title",
        ],
        "sv",
      ),
    ).toEqual({ review_msg_typo: reviewExplanation("review_msg_typo", "sv") });
    expect(reviewExplanations([], "en")).toEqual({});
  });
});
