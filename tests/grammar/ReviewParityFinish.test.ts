import { expect, test } from "bun:test";
import { englishWordInfo } from "../../src/core/domain/grammar/implementations/helpers/EnglishLexicon";
import { ALL_RULES, scan } from "./reviewHarness";

// Small fixes that close the LanguageTool parity work. All sentences are our own.
const review = (text: string, lang = "en_US") =>
  scan(text, { lang, enabledRules: ALL_RULES }).filter((d) => d.category !== "style");

test("English and German direct questions share a neutral message key", () => {
  for (const [lang, text] of [
    ["en_US", "Where did you leave the car keys."],
    ["de_DE", "Wann fährt der letzte Bus."],
  ]) {
    const keys = review(text, lang).map((d) => d.messageKey);
    expect(keys).toContain("review_msg_question_mark");
  }
});

test("doubled comparatives and superlatives read as adjectives", () => {
  for (const word of ["hotter", "hottest", "bigger", "biggest", "wetter", "thinner", "sadder"])
    expect(englishWordInfo(word)?.adjective).toBe(true);
  // A doubled -er word whose base is no adjective stays as it was.
  for (const word of ["letter", "dinner", "summer"])
    expect(englishWordInfo(word)?.adjective).toBe(false);
});
