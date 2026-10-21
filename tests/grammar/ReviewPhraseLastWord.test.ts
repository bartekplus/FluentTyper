import { expect, test } from "bun:test";
import {
  AGREEMENT_REGEX,
  ARTICLE_REGEX,
  MODAL_OF_REGEX,
  THEIR_THERE_BE_REGEX,
  YOUR_WELCOME_REGEX,
  articleAnLastWord,
  modalOfLastWord,
  pronounVerbLastWord,
  theirThereLastWord,
  yourWelcomeLastWord,
} from "../../src/core/domain/grammar/review/rules/common.generated";

// Fuzz: for each phrase frame of common.yaml, when its pattern matches a window that ends at a
// word end, the quick last-word test of the frame is true. Then the test never skips a window
// that gives a match.
type LastWord = (text: string, start: number, end: number) => boolean;
const CASES: [string, RegExp, LastWord][] = [
  ["modalOf", MODAL_OF_REGEX, modalOfLastWord],
  ["yourWelcome", YOUR_WELCOME_REGEX, yourWelcomeLastWord],
  ["theirThere", THEIR_THERE_BE_REGEX, theirThereLastWord],
  ["pronounVerb", AGREEMENT_REGEX, pronounVerbLastWord],
  ["articleAn", ARTICLE_REGEX, articleAnLastWord],
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
      for (const [name, pattern, lastWord] of CASES) {
        const regex = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""));
        let matched = false;
        for (let from = 0; from <= start && !matched; from += 1) {
          matched = regex.test(text.slice(from, end));
        }
        if (!matched) continue;
        matches.set(name, (matches.get(name) ?? 0) + 1);
        if (!lastWord(text, start, end)) {
          throw new Error(`${name} skips ${JSON.stringify(text)} at ${end}`);
        }
      }
    }
  }
  // The fuzz must reach each pattern.
  for (const [name] of CASES) expect(matches.get(name) ?? 0).toBeGreaterThan(40);
});
