import { expect, test } from "bun:test";
import { REVIEW_FRAMES, REVIEW_RULES } from "../../src/core/domain/grammar/engine/review.generated";
import {
  CASING_WORDS,
  spellingFrameRegexes,
} from "../../src/core/domain/grammar/review/rules/common.generated";

test("the spelling frames of common.yaml are the word tables of its rule code", () => {
  const rule = REVIEW_RULES.find((entry) => entry.id === "spelling")!;
  const frames = rule.frames!.map((index) => REVIEW_FRAMES[index]);
  expect(frames.map((frame) => [frame.pattern, frame.flags])).toEqual(
    spellingFrameRegexes().map((regex) => [regex.source, regex.flags]),
  );
});

test("the casing frame of phraseTables is the word regex CASING_WORDS", () => {
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
