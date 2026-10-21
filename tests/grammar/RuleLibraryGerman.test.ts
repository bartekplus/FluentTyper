import { beforeAll, expect, test } from "bun:test";
import { germanInfinitiveOf } from "../../src/core/domain/grammar/library/german/verbs";
import { loadAllReviewData } from "../../src/core/domain/grammar/review/reviewLanguageSources";
import { languageRules, scanResult } from "./reviewHarness";

beforeAll(async () => {
  await loadAllReviewData();
});

test("germanInfinitiveOf: the infinitive of a listed form", () => {
  expect(
    ["gibt", "kann", "wird", "bin", "ist", "war", "wären", "selbst"].map(germanInfinitiveOf),
  ).toEqual(["geben", "können", "werden", "sein", "sein", "sein", "sein", null]);
});

test('German: a form of "sein" after a modal becomes "sein", not "sind"', () => {
  const previews = (text: string) =>
    scanResult(text, { lang: "de_DE", enabledRules: languageRules("de_DE") }).diagnostics.flatMap(
      (d) => d.alternatives.map((a) => a.preview),
    );
  expect(previews("Ich will morgen dort bin.")).toEqual(["sein"]);
  expect(previews("Wir wollen morgen dort sind.")).toEqual(["sein"]);
});
