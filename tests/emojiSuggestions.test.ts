import { describe, expect, test } from "bun:test";
import { matchEmoji } from "../src/core/domain/emojiSuggestions";

const emojiFor = (token: string, limit = 2, prefix = true) =>
  matchEmoji(token, limit, prefix).map(({ emoji }) => emoji);

describe("matchEmoji (#504)", () => {
  test("a word of the emoji name matches: joy -> face with tears of joy", () => {
    expect(emojiFor("joy")).toContain("😂");
  });

  test("an exact name ranks first and returns the name", () => {
    expect(matchEmoji("fire", 1)).toEqual([{ emoji: "🔥", name: "fire" }]);
  });

  test("an exact keyword matches", () => {
    expect(emojiFor("victory", 1)).toEqual(["✌️"]);
  });

  test("short words, country codes and filler keywords find nothing", () => {
    for (const word of ["a", "v", "is", "to", "be", "in", "for", "not", "you", "this"]) {
      expect(emojiFor(word, 2, false)).toEqual([]);
    }
    expect(emojiFor("ok", 1, false)).toEqual(["👌"]);
  });

  test("prefix matches start at three letters", () => {
    expect(emojiFor("pi", 10)).not.toContain("🍕");
    expect(emojiFor("piz", 1)).toEqual(["🍕"]);
  });

  test("prefix matches can be turned off for a finished word", () => {
    expect(emojiFor("the", 2, false)).toEqual([]);
    expect(emojiFor("cat", 1, false)).toEqual(["🐈"]);
  });

  test("middle words of a name do not match, so stop words find nothing", () => {
    for (const word of ["the", "of", "and", "with", "in"]) {
      expect(emojiFor(word, 2, false)).toEqual([]);
    }
  });

  test("names with spaces split into words too", () => {
    expect(emojiFor("tuxedo", 3, false)).toContain("🤵\u200d♀️");
  });

  test("returns nothing for no match or an empty token", () => {
    expect(emojiFor("xyzq")).toEqual([]);
    expect(emojiFor("")).toEqual([]);
  });

  test("never returns more than the limit", () => {
    expect(emojiFor("face", 2)).toHaveLength(2);
  });
});
