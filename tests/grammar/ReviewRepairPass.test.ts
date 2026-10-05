import { expect, test } from "bun:test";
import {
  finalizeReview,
  finalizeReviewAsync,
  reviewChunks,
  scanReviewChunk,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";
import {
  REPAIR_WINDOW,
  repairShadow,
  repairWindows,
  selectRepairs,
} from "../../src/core/domain/grammar/review/repairPass";
import { findLiveGrammarProposals } from "../../src/core/domain/grammar/review/liveProposals";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import { REVIEW_CHUNK_CHARS } from "../../src/core/domain/grammar/review/types";
import { prepared, reviewOptions } from "./grammarTestUtils";
import { DEFAULT_RULES, scan } from "./reviewHarness";

function scansOf(text: string) {
  const ready = prepared(text);
  return { ready, scans: reviewChunks(ready).map((chunk) => scanReviewChunk(ready, chunk)) };
}

test("the async finalize gives the sync result", async () => {
  const { ready, scans } = scansOf("We is ready. Teh cat sat on the the mat.");
  let pauses = 0;
  const result = await finalizeReviewAsync(ready, scans, {}, async () => {
    pauses += 1;
  });
  expect(result).toEqual(finalizeReview(ready, scans));
  expect(pauses).toBe(0);
});

test("a contraction that only lacks its apostrophe is a repair", () => {
  const repairs = selectRepairs(scan("Bob cant go."));
  expect(repairs.map((d) => [d.original, d.alternatives[0].preview])).toEqual([["cant", "can't"]]);
});

test("a contraction its detector doubts is no repair", () => {
  // "wont" is read from context (context-dependent); "Somethings" has two fixes.
  expect(selectRepairs(scan("I wont go there."))).toEqual([]);
  expect(selectRepairs(scan("Somethings going well."))).toEqual([]);
});

test("the shadow maps positions both ways", () => {
  const text = "We didnt see it and dont care.";
  const shadow = repairShadow(selectRepairs(scan(text)));
  expect(shadow.repairs.map((d) => d.original)).toEqual(["didnt", "dont"]);
  // Outside the repaired words, a position goes there and back unchanged.
  for (const position of [0, 3, 9, 16, 20, text.length])
    expect(shadow.fromShadow(shadow.toShadow(position))).toBe(position);
  const shadowText = "We didn't see it and don't care.";
  expect(shadow.spans.map((span) => shadowText.slice(span.start, span.end))).toEqual([
    "didn't",
    "don't",
  ]);
});

test("repair windows are clipped, joined and split", () => {
  const scope = { start: 0, end: 20_000 };
  expect(repairWindows([{ start: 10, end: 15 }], scope)).toEqual([
    { start: 0, end: 15 + REPAIR_WINDOW },
  ]);
  expect(
    repairWindows(
      [
        { start: 1_000, end: 1_005 },
        { start: 1_100, end: 1_105 },
      ],
      scope,
    ),
  ).toEqual([{ start: 1_000 - REPAIR_WINDOW, end: 1_105 + REPAIR_WINDOW }]);
  const dense = Array.from({ length: 100 }, (_, i) => ({ start: i * 100, end: i * 100 + 4 }));
  const windows = repairWindows(dense, scope);
  expect(windows.every((w) => w.end - w.start <= REVIEW_CHUNK_CHARS)).toBe(true);
  expect(windows[0].start).toBe(0);
  expect(windows.at(-1)?.end).toBe(9_904 + REPAIR_WINDOW);
  for (let i = 1; i < windows.length; i += 1) expect(windows[i].start).toBe(windows[i - 1].end);
});

const fixes = (text: string) =>
  scan(text).map((d) => [d.messageKey, d.original, d.alternatives[0]?.preview]);

test.each([
  ["I cant hardly understand it.", "I can hardly understand it."],
  ["We couldnt hardly hear the speaker.", "We could hardly hear the speaker."],
])("one fix repairs both errors: %s", (input, expected) => {
  const found = scan(input).filter((d) => !d.warningOnly);
  expect(found).toHaveLength(1);
  expect(found[0].messageKey).not.toBe("review_msg_contraction");
  expect(applyEdits(input, found[0].alternatives[0].edits)).toBe(expected);
  expect(scan(expected).filter((d) => !d.warningOnly)).toEqual([]);
});

test("cant, can't and cannot before hardly give the same hint", () => {
  const hint = [["review_msg_negated_hardly", expect.any(String), "can"]];
  for (const word of ["cant", "can't", "cannot"])
    expect(fixes(`I ${word} hardly understand it.`)).toEqual(hint);
});

test("a repair with no dependent finding stays as it is", () => {
  expect(fixes("Bob cant go.")).toEqual([["review_msg_contraction", "cant", "can't"]]);
});

test.each(["The political cant hardly matters.", "I wont hardly notice it.", "I CANT hardly see."])(
  "no repair, no composite: %s",
  (text) => {
    const composite = scan(text).filter(
      (d) => /cant|wont/i.test(d.original) && d.messageKey !== "review_msg_contraction",
    );
    expect(composite).toEqual([]);
  },
);

test("a composite follows the text's apostrophe style", () => {
  const previews = scan("It’s odd: I cant hardly see.").map((d) => d.alternatives[0]?.preview);
  expect(previews).toContain("can");
  expect(fixes("It’s odd: we didnt see nothing.")).toContainEqual([
    "review_msg_contraction",
    "didnt",
    "didn’t",
  ]);
});

test("an error the repair reveals in another word gets its own fix in the same round", () => {
  const input = "We didnt see nothing.";
  expect(fixes(input)).toEqual([
    ["review_msg_contraction", "didnt", "didn't"],
    ["review_msg_double_negative", "nothing", "anything"],
  ]);
  const edits = scan(input).flatMap((d) => d.alternatives[0].edits);
  expect(applyEdits(input, edits)).toBe("We didn't see anything.");
});

test("a fix the text already has is not offered again with the repair", () => {
  // "had" -> "have" is found with or without the apostrophe.
  const found = scan("We didnt had enough time.").filter((d) => !d.warningOnly);
  const edits = found.flatMap((d) => d.alternatives[0].edits);
  expect(applyEdits("We didnt had enough time.", edits)).toBe("We didn't have enough time.");
});

test("no two fixes collide around repairs", () => {
  const text =
    "We dont need no tests because nobody didnt report any issues. I cant hardly see. " +
    "It doesnt seem reliable. The company changed it's policy. I didnt see nothing nowhere.";
  const edits = scan(text)
    .filter((d) => !d.warningOnly && d.alternatives.length > 0)
    .flatMap((d) => d.alternatives[0].edits);
  expect(applyEdits(text, edits)).not.toBeNull();
});

test("style advice never absorbs a repair", () => {
  const found = scan("Bob cant go.", { enabledRules: [...DEFAULT_RULES, "styleContractions"] });
  expect(found.some((d) => d.original === "cant" && d.alternatives[0]?.preview === "can't")).toBe(
    true,
  );
});

test("a composite is never in Fix all safe", () => {
  const composite = scan("I cant hardly understand it.").find((d) => d.original === "cant");
  expect(composite?.alternatives[0].preview).toBe("can");
  expect(composite?.bulk.eligible).toBe(false);
});

test("a repair in code starts no chain", () => {
  expect(scan("Run `cant hardly` now.").filter((d) => /cant/.test(d.original))).toEqual([]);
});

test("typing-time proposals offer the composite", () => {
  const proposals = findLiveGrammarProposals("I cant hardly understand it. ", {
    ...reviewOptions(),
    liveRules: [],
  });
  expect(proposals.map((p) => [p.original, p.replacement])).toContainEqual(["cant", "can"]);
  expect(proposals.some((p) => p.replacement === "can't")).toBe(false);
});

test("the async finalize pauses inside the repair pass", async () => {
  const { ready, scans } = scansOf("We dont need no tests. I cant hardly wait.");
  let pauses = 0;
  const result = await finalizeReviewAsync(ready, scans, {}, async () => {
    pauses += 1;
  });
  expect(result).toEqual(finalizeReview(ready, scans));
  expect(pauses).toBeGreaterThan(0);
});

test("a quote-style fix never takes over a repair", () => {
  const found = scan("I dont know.", { enabledRules: [...DEFAULT_RULES, "typographicQuotes"] });
  expect(found.map((d) => [d.ruleId, d.original])).toEqual([
    ["englishContractionNormalization", "dont"],
  ]);
});
