import { expect, test } from "bun:test";
import { forEachWord } from "../../src/core/domain/grammar/engine/tokenizer";

const words = (text: string, start = 0) => {
  const out: string[] = [];
  forEachWord(text, start, (at, word) => {
    expect(text.slice(at, at + word.length)).toBe(word);
    out.push(word);
    return true;
  });
  return out;
};

test("words keep diacritics, apostrophes and combining marks", () => {
  expect(words("Zażółć gęślą jaźń")).toEqual(["Zażółć", "gęślą", "jaźń"]);
  expect(words("Ça déjà-vu, don't l’homme")).toEqual(["Ça", "déjà", "vu", "don't", "l’homme"]);
  expect(words("Η οδός είναι ωραία;")).toEqual(["Η", "οδός", "είναι", "ωραία"]);
  // Harakat (\p{M}) stay inside the Arabic word.
  expect(words("كَتَبَ الطالبُ، ثم ذهب؟")).toEqual(["كَتَبَ", "الطالبُ", "ثم", "ذهب"]);
});

test("words follow the phrase-table word rule, with UTF-16 offsets", () => {
  // Letters and digits make one word; numbers are words too. Masked text is no word.
  expect(words("Ein 😀 2nd 1,7 l'eau years' ￼ kg.")).toEqual([
    "Ein",
    "2nd",
    "1",
    "7",
    "l'eau",
    "years",
    "kg",
  ]);
});

test("the walk starts at a token boundary and stops when the visitor says so", () => {
  const text = "one two three four";
  expect(words(text, text.indexOf("three"))).toEqual(["three", "four"]);
  const seen: string[] = [];
  forEachWord(text, 0, (_, word) => {
    seen.push(word);
    return word !== "two";
  });
  expect(seen).toEqual(["one", "two"]);
});
