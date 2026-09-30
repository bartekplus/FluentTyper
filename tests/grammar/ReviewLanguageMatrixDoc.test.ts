import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { GRAMMAR_RULE_CATALOG } from "../../src/core/domain/grammar/ruleCatalog";
import {
  REVIEW_RULE_METADATA,
  runsInReviewLanguage,
} from "../../src/core/domain/grammar/review/reviewCatalog";

const COLUMNS = [
  "en_US",
  "fr_FR",
  "de_DE",
  "pl_PL",
  "es_ES",
  "pt_BR",
  "sv_SE",
  "hr_HR",
  "el_GR",
  "ar_SA",
  "auto_detect",
];
const doc = readFileSync("docs/review-language-matrix.md", "utf8");
const rows = new Map(
  [...doc.matchAll(/^\| `(\w+)`\s*\|((?:\s*[SUX]\s*\|){11})\s*(.*?)\s*\|$/gm)].map((m) => [
    m[1],
    {
      cells: m[2]
        .split("|")
        .map((cell) => cell.trim())
        .filter(Boolean),
      reason: m[3],
    },
  ]),
);

test("the language matrix has one examined row per catalog rule, matching the code", () => {
  for (const { id } of GRAMMAR_RULE_CATALOG) {
    const row = rows.get(id);
    expect({ id, found: !!row }).toEqual({ id, found: true });
    const expected = COLUMNS.map((lang) =>
      REVIEW_RULE_METADATA[id].review === "excluded"
        ? "X"
        : runsInReviewLanguage(id, lang)
          ? "S"
          : "U",
    );
    expect({ id, cells: row!.cells }).toEqual({ id, cells: expected });
    // Every unsupported or excluded cell is explained.
    if (expected.some((cell) => cell !== "S")) expect(row!.reason.length).toBeGreaterThan(10);
  }
  expect(rows.size).toBe(GRAMMAR_RULE_CATALOG.length);
});
