import { expect, test } from "bun:test";
import { lastBefore, matchesFrom } from "../../src/core/domain/grammar/library/common/text";

test("matchesFrom: the matches from an index, with lookbehinds that read the text before it", () => {
  const starts = (from: number) => matchesFrom(/(?<=a)b/g, "ab ab ab", from).map((m) => m.index);
  expect(starts(0)).toEqual([1, 4, 7]);
  expect(starts(4)).toEqual([4, 7]);
  expect(starts(5)).toEqual([7]);
  expect(matchesFrom(/x*/g, "ab", 0).map((m) => m.index)).toEqual([0, 1, 2]);
});

test("lastBefore: the last item below a stop", () => {
  const items = [1, 4, 7].map((index) => ({ index }));
  expect([0, 1, 2, 4, 5, 8].map((stop) => lastBefore(items, stop)?.index)).toEqual([
    undefined,
    undefined,
    1,
    1,
    4,
    7,
  ]);
  expect(lastBefore([], 3)).toBeUndefined();
});
