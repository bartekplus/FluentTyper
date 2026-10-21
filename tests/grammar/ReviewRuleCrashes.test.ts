import { expect, test } from "bun:test";
import { languageRules, scanResult } from "./reviewHarness";

/** The previews of `text`; the rules that threw fail the test. */
function previews(lang: string, text: string): string[] {
  const { coverage, diagnostics } = scanResult(text, { lang, enabledRules: languageRules(lang) });
  expect({ text, failed: coverage.failedRules }).toEqual({ text, failed: [] });
  return diagnostics.flatMap((d) => d.alternatives.map((a) => `${d.ruleId}: ${a.preview}`));
}

test("Spanish: a decade in capitals does not crash the typography check", () => {
  expect(previews("es_ES", "CRECIÓ EN LOS AÑOS 1970S.")).toEqual(["spanishTypography: 1970"]);
});

test("German: a no-break space before the match does not crash the checks", () => {
  expect(previews("de_DE", "Nach dem ewigen hin und her waren alle müde.")).toEqual([
    "germanNounCasing: Hin und Her",
  ]);
  expect(previews("de_DE", "Das Kind, dass dort spielt, lacht.")).toEqual([
    "germanConfusedWords: das",
  ]);
});
