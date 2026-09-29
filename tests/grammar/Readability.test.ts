import { expect, test } from "bun:test";
import {
  longSentenceRanges,
  longSentenceThreshold,
} from "../../src/core/domain/grammar/review/readability";
import { prepareReview } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import type { ReviewSourceSnapshot } from "../../src/core/domain/grammar/review/types";
const sentence =
  "The team reviewed every part of the detailed proposal before recording all of their conclusions.";
function scan(text: string, threshold = 10, extra: Partial<ReviewSourceSnapshot> = {}) {
  const snapshot = {
    id: "readability",
    text,
    scope: { start: 0, end: text.length },
    protectedRanges: [],
    ...extra,
  };
  const prepared = prepareReview(snapshot, {
    lang: "en_US",
    enabledRules: [],
    userDictionary: [],
    insertSpaceAfterAutocomplete: true,
  });
  return longSentenceRanges(snapshot, prepared.protectedRanges, threshold);
}

test("readability counts only sentences exceeding the configured word threshold", () => {
  expect(scan(sentence, 14)).toEqual([{ start: 0, end: sentence.length }]);
  expect(scan(sentence, 15)).toEqual([]);
  expect(scan(sentence)).toEqual([{ start: 0, end: sentence.length }]);
  expect(scan("A short sentence.")).toEqual([]);
  expect(scan(sentence.slice(0, -1))).toEqual([]);
});

test("readability preserves abbreviations, initials, decimals and soft line wraps", () => {
  for (const text of [
    `Dr. Rowan said that ${sentence.toLowerCase()}`,
    `J. Smith said that ${sentence.toLowerCase()}`,
    `The price is 3.14 dollars and ${sentence.toLowerCase()}`,
    `We considered examples, e.g. detailed proposals, and ${sentence.toLowerCase()}`,
    sentence.replace("before", "\nbefore"),
  ])
    expect(scan(text)).toEqual([{ start: 0, end: text.length }]);
  expect(scan("We saw many small items etc. The next room was quiet and calm.")).toEqual([]);
});

test("readability handles list markers without joining or inventing sentences", () => {
  for (const marker of ["1.", "2)", "a)", "-", "*", "•"]) {
    const list = `${marker} ${sentence}\n${marker} ${sentence}`;
    expect(scan(list)).toEqual([]);
    const text = `${list}\n\n${sentence}`;
    expect(scan(text)).toEqual([{ start: text.length - sentence.length, end: text.length }]);
  }
});

test("readability keeps full source evidence at selection edges", () => {
  const text = `Short first sentence. ${sentence} Short last sentence.`;
  const start = text.indexOf(sentence);
  const end = start + sentence.length;
  expect(scan(text, 10, { selection: true, scope: { start, end } })).toEqual([{ start, end }]);
  expect(scan(text, 10, { selection: true, scope: { start: start + 4, end } })).toEqual([]);
  expect(scan(text, 10, { selection: true, scope: { start, end: end - 4 } })).toEqual([]);
  expect(scan(text, 10, { incomplete: true })).toEqual([]);
});

test("readability skips protected sentences without discarding later complete prose", () => {
  for (const protectedText of ["`opaque code`", "https://example.test/path", "a.b"]) {
    const prefix = `${sentence.slice(0, -1)} ${protectedText}.\n\n`;
    const text = prefix + sentence;
    expect(scan(text)).toEqual([{ start: prefix.length, end: text.length }]);
  }
  expect(
    scan(sentence, 10, { protectedRanges: [{ start: 4, end: 8, reason: "structure" }] }),
  ).toEqual([]);
  expect(scan("```\n" + sentence)).toEqual([]);
  const afterFragment = "Words without a closing mark\n\n" + sentence;
  expect(scan(afterFragment)).toEqual([
    { start: afterFragment.length - sentence.length, end: afterFragment.length },
  ]);
});

test("readability is bounded and normalizes invalid thresholds", () => {
  const oversized = `${sentence} `.repeat(600);
  expect(oversized.length).toBeGreaterThan(50_000);
  expect(scan(oversized)).toEqual([]);
  for (const value of [undefined, null, "40", 0, 9, 201, 10.5, NaN, Infinity])
    expect(longSentenceThreshold(value)).toBe(35);
  expect(longSentenceThreshold(10)).toBe(10);
  expect(longSentenceThreshold(200)).toBe(200);
});
