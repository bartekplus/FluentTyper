import { describe, expect, test } from "bun:test";
import { matchEmoji } from "../src/core/domain/emojiSuggestions";

const emojiFor = (token: string, limit = 2) => matchEmoji(token, limit).map(({ emoji }) => emoji);

describe("matchEmoji (#504)", () => {
  test("a word of the emoji name matches: joy -> face with tears of joy", () => {
    expect(emojiFor("joy")).toContain("😂");
  });

  test("an exact name ranks first and returns the name", () => {
    expect(matchEmoji("fire", 1)).toEqual([{ emoji: "🔥", name: "fire" }]);
  });

  test("an exact keyword matches, also for one letter", () => {
    expect(emojiFor("v")).toEqual(["✌️"]);
  });

  test("prefix matches start at three letters", () => {
    expect(emojiFor("pi", 10)).not.toContain("🍕");
    expect(emojiFor("piz", 1)).toEqual(["🍕"]);
  });

  test("returns nothing for no match, an empty token or a zero limit", () => {
    expect(emojiFor("xyzq")).toEqual([]);
    expect(emojiFor("")).toEqual([]);
    expect(emojiFor("fire", 0)).toEqual([]);
  });

  test("never returns more than the limit", () => {
    expect(emojiFor("face", 2)).toHaveLength(2);
  });
});
