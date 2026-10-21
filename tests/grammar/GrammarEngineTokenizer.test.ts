import { expect, test } from "bun:test";
import {
  casingOf,
  endsSentence,
  tokenize,
  tokenKey,
} from "../../src/core/domain/grammar/engine/tokenizer";

const texts = (text: string) => tokenize(text).map((token) => token.text);
const types = (text: string) => tokenize(text).map((token) => `${token.type}:${token.text}`);

test("words keep diacritics, apostrophes and combining marks", () => {
  expect(texts("Zażółć gęślą jaźń")).toEqual(["Zażółć", "gęślą", "jaźń"]);
  expect(texts("Ça déjà-vu, don't l’homme")).toEqual([
    "Ça",
    "déjà",
    "-",
    "vu",
    ",",
    "don't",
    "l’homme",
  ]);
  expect(texts("Η οδός είναι ωραία;")).toEqual(["Η", "οδός", "είναι", "ωραία", ";"]);
  // Harakat (\p{M}) stay inside the Arabic word; Arabic punctuation is its own token.
  expect(texts("كَتَبَ الطالبُ، ثم ذهب؟")).toEqual(["كَتَبَ", "الطالبُ", "،", "ثم", "ذهب", "؟"]);
});

test("the key is lowercase and drops Arabic harakat and tatweel", () => {
  expect(tokenKey("Straße")).toBe("straße");
  expect(tokenKey("كَتَبَ")).toBe("كتب");
  expect(tokenKey("كتـــاب")).toBe("كتاب");
});

test("offsets are UTF-16 offsets into the text, also inside a window", () => {
  const text = "Ein 😀 Test, und 12,5 kg.";
  for (const token of tokenize(text)) expect(text.slice(token.start, token.end)).toBe(token.text);
  expect(types(text)).toEqual([
    "word:Ein",
    "symbol:😀",
    "word:Test",
    "punct:,",
    "word:und",
    "number:12",
    "punct:,",
    "number:5",
    "word:kg",
    "punct:.",
  ]);
  const comma = text.indexOf(",");
  const window = tokenize(text, comma, comma + 10);
  expect(window[0]).toMatchObject({ text: ",", start: comma });
  for (const token of window) expect(text.slice(token.start, token.end)).toBe(token.text);
});

test("whitespace is kept before each token", () => {
  const tokens = tokenize("a  b\n\tc");
  expect(tokens.map((token) => token.space)).toEqual(["", "  ", "\n\t"]);
});

const shielded = (text: string) =>
  tokenize(text)
    .filter((token) => token.protected || token.type === "protected")
    .map((token) => token.text)
    .join("");

test("protected spans flag their tokens; masked text is one token", () => {
  // The words inside stay tokens (the phrase checks see them); patterns skip them.
  expect(shielded("See https://example.com/a?b=1. Mail me@x.org")).toBe(
    "https://example.com/a?b=1me@x.org",
  );
  expect(texts("Mail me@x.org")).toEqual(["Mail", "me", "@", "x", ".", "org"]);
  expect(shielded("Run `npm i` in /usr/local/bin :smile:")).toBe("`npmi`/usr/local/bin:smile:");
  // Masked text (U+FFFC) from Review is one protected token.
  expect(types("a \uFFFC\uFFFC b")).toEqual(["word:a", "protected:\uFFFC\uFFFC", "word:b"]);
  // "and/or" and a time are not paths or shortcodes.
  expect(shielded("and/or at 10:30:")).toBe("");
});

test("words follow the phrase-table word rule", () => {
  // Letters and digits make one word; digits alone make a number.
  expect(types("2nd 1,7 l'eau years' ")).toEqual([
    "word:2nd",
    "number:1",
    "punct:,",
    "number:7",
    "word:l'eau",
    "word:years",
    "punct:'",
  ]);
});

test("sentence starts follow closing punctuation, closers and blank lines", () => {
  const starts = (text: string) =>
    tokenize(text)
      .filter((token) => token.sentenceStart)
      .map((token) => token.text);
  expect(starts("one. two! (three) four? «Five.» six")).toEqual([
    "one",
    "two",
    "(",
    "three",
    "Five",
    "six",
  ]);
  expect(starts("¿Qué? ¡Nada!")).toEqual(["¿", "Qué", "¡", "Nada"]);
  expect(starts("para one\n\npara two\nwrapped")).toEqual(["para", "para"]);
  expect(starts("هل ذهبت؟ نعم")).toEqual(["هل", "نعم"]);
  expect(starts("Τι ώρα είναι\u037E Τώρα")).toEqual(["Τι", "Τώρα"]);
});

test("a sentence end follows the token", () => {
  const tokens = tokenize('He left." Then');
  expect(endsSentence(tokens, 1)).toBe(true);
  expect(endsSentence(tokens, 0)).toBe(false);
  expect(endsSentence(tokenize("end"), 0)).toBe(true);
});

test("casing profiles", () => {
  expect(
    ["word", "Word", "WORD", "iPhone", "I", "ŁÓDŹ", "οδός", "123", "كتاب"].map(casingOf),
  ).toEqual(["lower", "title", "upper", "mixed", "title", "upper", "lower", "none", "none"]);
});
