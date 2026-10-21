import { expect, test } from "bun:test";
import { REVIEW_FRAMES, REVIEW_RULES } from "../../src/core/domain/grammar/engine/review.generated";
import { CASING_WORDS } from "../../src/core/domain/grammar/review/canonicalCasing";
import { SPELLING_FRAME_REGEXES } from "../../src/core/domain/grammar/review/multilingualLexicon";

test("the spelling frames of common.yaml are the word tables of multilingualLexicon.ts", () => {
  const rule = REVIEW_RULES.find((entry) => entry.id === "spelling")!;
  const frames = rule.frames!.map((index) => REVIEW_FRAMES[index]);
  expect(frames.map((frame) => [frame.pattern, frame.flags])).toEqual(
    SPELLING_FRAME_REGEXES.map((regex) => [regex.source, regex.flags]),
  );
});

test("the casing frame of phraseTables is the word regex of canonicalCasing.ts", () => {
  const rule = REVIEW_RULES.find((entry) => entry.id === "phraseTables")!;
  const frame = REVIEW_FRAMES[rule.frames![0]];
  // The source may write a character as a \\u escape: compare the characters.
  const chars = (source: string) =>
    source.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
  expect([chars(frame.pattern), frame.flags]).toEqual([
    chars(CASING_WORDS.source),
    CASING_WORDS.flags,
  ]);
});
