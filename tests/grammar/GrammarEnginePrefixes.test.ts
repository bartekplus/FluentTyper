import { expect, test } from "bun:test";
import { startPrefixes } from "../../src/core/domain/grammar/engine/prefixes";
import { SPACE } from "../../src/core/domain/grammar/review/phraseTemplates";

test("start prefixes follow alternations, groups and optional parts", () => {
  expect(startPrefixes(`(?<target>(?<modal>could|would|must)(?:n['’]t)?${SPACE}of)`)).toEqual([
    "cou",
    "wou",
    "mus",
  ]);
  expect(startPrefixes("(?:a|b)(?:c|d)e")).toEqual(["ace", "ade", "bce", "bde"]);
  expect(startPrefixes("(?:the|a)?b")).toEqual(["a", "b", "the"]);
  expect(startPrefixes("(?<=x)(?=y)ab")).toEqual(["ab"]);
  expect(startPrefixes("(?:\\.|\\-)ab")).toEqual([".ab", "-ab"]);
  expect(startPrefixes("Beware")).toEqual(["bew"]);
});

test("a prefix that starts another one keeps only the shorter", () => {
  // "an?" closes after "an": "ano" (another) is found at "an".
  expect(startPrefixes("(?:an?|another)x")).toEqual(["an", "ax"]);
  expect(startPrefixes("(?:a|ab)c")).toEqual(["ac", "abc"]);
  expect(startPrefixes("(?:a|abc)")).toEqual(["a"]);
});

test("a repeat ends the prefix; an optional first part adds the rest", () => {
  expect(startPrefixes("a{2}b")).toEqual(["a"]);
  expect(startPrefixes("(?:ab)+c")).toEqual(["ab"]);
  expect(startPrefixes("x*yz")).toEqual(["x", "yz"]);
});

test("no prefix when a match may start with any character", () => {
  expect(startPrefixes("(?<target>[a-z]+)")).toBeNull();
  expect(startPrefixes("\\p{L}+")).toBeNull();
  expect(startPrefixes(`(?:the)?${SPACE}x`)).toBeNull();
  expect(startPrefixes(".a")).toBeNull();
  expect(startPrefixes("(?:a|\\d)b")).toBeNull();
});

test("every prefix is a real start of the regex's matches", () => {
  const cases: [string, string][] = [
    ["(?:could|would)(?:n't)? of", "Wouldn't of"],
    ["(?:x|yy)?zz", "yyzz"],
    ["(?:x|yy)?zz", "zz"],
    ["(?:de|del)(?:\\.|-)?a", "del-a"],
  ];
  for (const [source, text] of cases) {
    const prefixes = startPrefixes(source)!;
    expect(new RegExp(`^(?:${source})$`, "iu").test(text)).toBe(true);
    expect(prefixes.some((prefix) => text.toLowerCase().startsWith(prefix))).toBe(true);
  }
});
