import { expect, test } from "bun:test";
import { REVIEW_FRAMES, REVIEW_RULES } from "../../src/core/domain/grammar/engine/review.generated";
import { ROWS } from "../../src/core/domain/grammar/review/english/collocationSlots";

// The head frame of en.collocations runs only before a typed preposition of the head table.
// When a row adds a preposition, the frame must list it too.
test("the collocation head frame lists every typed preposition of the head table", () => {
  const rule = REVIEW_RULES.find((entry) => entry.id === "en.collocations")!;
  const head = rule
    .frames!.map((index) => REVIEW_FRAMES[index])
    .find((frame) => frame.fixer === "en:collocationHead")!;
  const listed = /\(\?=\[ \\t\\u00a0\]\+\(\?:([a-z|]+)\)/.exec(head.pattern)![1].split("|");
  const typed = ROWS.flatMap(([, wrong]) => wrong.split(" "));
  expect([...new Set(listed)].sort()).toEqual([...new Set(typed)].sort());
});
