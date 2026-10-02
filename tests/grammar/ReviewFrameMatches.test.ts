import { expect, test } from "bun:test";
import { frameMatches } from "../../src/core/domain/grammar/review/phraseTemplates";
import type { DetectContext } from "../../src/core/domain/grammar/review/reviewDetectors";

const text = "We saw it. They saw it. You saw it.";
const ctx = {
  source: text,
  text,
  scanText: text,
  from: 0,
  to: text.length,
  lang: "en_US",
  dictionary: new Set<string>(),
  insertSpaceAfterAutocomplete: true,
} as DetectContext;
const PATTERN = "(?<target>saw)";
const starts = () => [...frameMatches(ctx, PATTERN)].map((m) => m.index);

test("a cached string pattern scans the same on every call", () => {
  expect(starts()).toEqual([3, 16, 28]);
  expect(starts()).toEqual([3, 16, 28]);
});

test("a nested scan of the same pattern does not disturb the outer scan", () => {
  const outer: number[] = [];
  for (const m of frameMatches(ctx, PATTERN)) {
    outer.push(m.index);
    expect(starts()).toEqual([3, 16, 28]);
  }
  expect(outer).toEqual([3, 16, 28]);
});

test("an abandoned scan leaves the pattern usable", () => {
  for (const m of frameMatches(ctx, PATTERN)) if (m) break;
  const open = frameMatches(ctx, PATTERN);
  open.next();
  expect(starts()).toEqual([3, 16, 28]);
});

test("trailing context after the owner can open the next frame", () => {
  // Each frame owns a word and reads the next one: "saw it", then "it. They".
  const owners = [...frameMatches(ctx, "(?<target>\\p{L}+)[ .]+(?<next>\\p{L}+)")].map(
    (m) => m.groups!.target,
  );
  expect(owners).toEqual(["We", "saw", "it", "They", "saw", "it", "You", "saw"]);
});
