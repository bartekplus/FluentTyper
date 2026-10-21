import { expect, test } from "bun:test";
import { PHRASE_LAST_WORD } from "../../src/core/domain/grammar/review/reviewDetectors";
import { MODAL_OF_REGEX } from "../../src/core/domain/grammar/implementations/EnglishModalOfCorrectionRule";
import { YOUR_WELCOME_REGEX } from "../../src/core/domain/grammar/implementations/EnglishYourWelcomeCorrectionRule";
import { THEIR_THERE_BE_REGEX } from "../../src/core/domain/grammar/implementations/EnglishTheirThereBeVerbRule";
import { AGREEMENT_REGEX } from "../../src/core/domain/grammar/implementations/EnglishPronounVerbWhitelistAgreementRule";
import { ARTICLE_REGEX } from "../../src/core/domain/grammar/implementations/EnglishArticleAnCorrectionRule";

// Fuzz: when a pattern matches a window that ends at a word end, the last-word test of its
// predicate is true. Then the test never skips a window that gives a match.
const CASES: [keyof typeof PHRASE_LAST_WORD, RegExp][] = [
  ["modalOf", MODAL_OF_REGEX],
  ["yourWelcome", YOUR_WELCOME_REGEX],
  ["theirThere", THEIR_THERE_BE_REGEX],
  ["pronounVerb", AGREEMENT_REGEX],
  ["articleAn", ARTICLE_REGEX],
];
const TOKENS = [
  ...["i", "I", "is", "IS", "has", "was", "Was", "you", "he", "She", "it", "are", "ARE", "were"],
  ...["a", "A", "an", "An", "AN", "of", "Of", "OF", "could", "Would", "shouldn't", "might"],
  ...["mustn’t", "their", "THEIR", "your", "welcome", "WelCome", "x", "foo", "as", "re", "n"],
  ...["'", '"', "(", "[", "“", "‘", "-", ".", ",", "ſ", "K", "é", "2", "_"],
];
const GAPS = [" ", " ", " ", "  ", "\n", "\t", " ", " ", "﻿", ""];

test("each last-word test is true where its pattern matches", () => {
  let seed = 7;
  const random = (n: number) => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return (seed >>> 16) % n;
  };
  const matches = new Map<string, number>();
  for (let round = 0; round < 30000; round += 1) {
    let text = "";
    const count = 1 + random(7);
    for (let i = 0; i < count; i += 1) {
      text += GAPS[random(GAPS.length)] + TOKENS[random(TOKENS.length)];
    }
    for (const word of text.matchAll(/[A-Za-z]+/g)) {
      const start = word.index;
      const end = start + word[0].length;
      for (const [name, pattern] of CASES) {
        const regex = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""));
        let matched = false;
        for (let from = 0; from <= start && !matched; from += 1) {
          matched = regex.test(text.slice(from, end));
        }
        if (!matched) continue;
        matches.set(name, (matches.get(name) ?? 0) + 1);
        if (!PHRASE_LAST_WORD[name](text, start, end)) {
          throw new Error(`${name} skips ${JSON.stringify(text)} at ${end}`);
        }
      }
    }
  }
  // The fuzz must reach each pattern.
  for (const [name] of CASES) expect(matches.get(name) ?? 0).toBeGreaterThan(40);
});
