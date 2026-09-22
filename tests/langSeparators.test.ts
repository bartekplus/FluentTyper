import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SEPARATOR_CHARS_REGEX,
  LANG_SEPARATOR_CHARS_REGEX,
  stripIgnoredWordChars,
} from "../src/core/domain/lang";

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
    expect(LANG_SEPARATOR_CHARS_REGEX.fr_FR.test("\u2019")).toBe(true);
    expect(findMentionToken("l\u2019amour", LANG_SEPARATOR_CHARS_REGEX.fr_FR)).toBe("amour");
  });

  test.each(["ar_SA", "en_US", "fr_FR"])(
    "%s separator profile includes the Arabic punctuation marks",
    (lang) => {
      for (const mark of ["\u060C", "\u061B", "\u061F"]) {
        expect(LANG_SEPARATOR_CHARS_REGEX[lang].test(mark)).toBe(true); // ، ؛ ؟
      }
    },
  );

  test("stripIgnoredWordChars removes tatweel regardless of language", () => {
    expect(stripIgnoredWordChars("كتـــاب")).toBe("كتاب");
    expect(stripIgnoredWordChars("hello")).toBe("hello");
  });

  test("tatweel is NOT an Arabic separator — it joins within a word", () => {
    // U+0640 ARABIC TATWEEL is an intra-word filler: "كتـــاب" is one word.
    // Treating it as a separator split the token into fragments and handed
    // Presage only the tail ("اب").
    expect(LANG_SEPARATOR_CHARS_REGEX.ar_SA.test("\u0640")).toBe(false);
    expect(findMentionToken("كتـــاب", LANG_SEPARATOR_CHARS_REGEX.ar_SA)).toBe("كتـــاب");
  });

  test("Arabic punctuation still ends the mention token", () => {
    expect(findMentionToken("كتاب،", LANG_SEPARATOR_CHARS_REGEX.ar_SA)).toBe("");
  });
});
