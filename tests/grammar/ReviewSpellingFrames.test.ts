import { expect, test } from "bun:test";
import { REVIEW_FRAMES, REVIEW_RULES } from "../../src/core/domain/grammar/engine/review.generated";
import { SPELLING_FRAME_REGEXES } from "../../src/core/domain/grammar/review/multilingualLexicon";

test("the spelling frames of common.yaml are the word tables of multilingualLexicon.ts", () => {
  const rule = REVIEW_RULES.find((entry) => entry.id === "spelling")!;
  const frames = rule.frames!.map((index) => REVIEW_FRAMES[index]);
  expect(frames.map((frame) => [frame.pattern, frame.flags])).toEqual(
    SPELLING_FRAME_REGEXES.map((regex) => [regex.source, regex.flags]),
  );
});
