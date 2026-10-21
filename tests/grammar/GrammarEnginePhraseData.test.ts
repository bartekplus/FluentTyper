import { expect, test } from "bun:test";
import { setReviewData } from "../../src/core/domain/grammar/review/reviewLanguageData";
import { mergedReviewData } from "../../src/core/domain/grammar/review/reviewLanguageSources";
import { review } from "./grammarTestUtils";

// The phrase tables of a language with Review data ship in review-data/<lang>.json.
const scan = (text: string) =>
  review(text, {}, { lang: "pt_BR", enabledRules: ["englishPhraseCorrections"] });

test("a check before the data loads fails; the first check after it finds the row", () => {
  // run-unit-tests gives each file its own process: no Portuguese check ran before this one.
  const data = mergedReviewData("pt");
  setReviewData("pt", undefined);
  try {
    const offline = scan("Espero que seje bom.");
    expect(offline.diagnostics).toEqual([]);
    expect(offline.coverage.failedRules).toEqual(["englishPhraseCorrections"]);
  } finally {
    setReviewData("pt", data);
  }
  // The failed check did not keep an empty table.
  expect(
    scan("Espero que seje bom.").diagnostics.map(
      (d) => `${d.original} -> ${d.alternatives[0]?.preview}`,
    ),
  ).toEqual(["seje -> seja"]);
});
