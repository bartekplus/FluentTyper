import { describe, expect, test } from "bun:test";
import { DEFAULT_SEPARATOR_CHARS_REGEX, LANG_SEPARATOR_CHARS_REGEX } from "../src/core/domain/lang";

function findMentionToken(beforeCursor: string, separatorRegex: RegExp): string {
  let start = beforeCursor.length;
  while (start > 0) {
    const current = beforeCursor.charAt(start - 1);
    if (separatorRegex.test(current)) {
      break;
    }
    start -= 1;
  }
  return beforeCursor.slice(start);
}

describe("lang separators", () => {
  test("default separators include advanced typography boundary characters", () => {
    const separators = [
      "\u201C",
      "\u201D",
      "\u2018",
      "\u2014",
      "\u2013",
      "\u2026",
      "\u201E",
      "\u00AB",
      "\u00BB",
      "\u2039",
      "\u203A",
    ];

    for (const separator of separators) {
      expect(DEFAULT_SEPARATOR_CHARS_REGEX.test(separator)).toBe(true);
    }
  });

  test("default separators still include straight quote", () => {
    expect(DEFAULT_SEPARATOR_CHARS_REGEX.test('"')).toBe(true);
  });

  test("default separators do not split contractions on closing apostrophe", () => {
    expect(DEFAULT_SEPARATOR_CHARS_REGEX.test("\u2019")).toBe(false);
    expect(findMentionToken("don\u2019t", DEFAULT_SEPARATOR_CHARS_REGEX)).toBe("don\u2019t");
  });

  test("french separator profile still treats apostrophe as separator", () => {
    expect(LANG_SEPARATOR_CHARS_REGEX.fr_FR.test("'")).toBe(true);
  });
});
