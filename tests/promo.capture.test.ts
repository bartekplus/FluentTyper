import { expect, test } from "bun:test";
import { isReviewWriteComplete } from "../marketing/promo/scripts/review-write-state.mjs";

test("waits for both the review write and diagnostics before filming", () => {
  const text = "I received the report. We should have reviewed it on Monday.";
  const ready = { open: true, spelling: "done", items: [], fixAll: { disabled: true } };
  expect(isReviewWriteComplete("Old draft", ready, text, 0)).toBe(false);
  expect(isReviewWriteComplete(text, { ...ready, items: [{ id: "old-finding" }] }, text, 0)).toBe(
    false,
  );
  expect(isReviewWriteComplete(text, { ...ready, spelling: "loading" }, text, 0)).toBe(false);
  expect(isReviewWriteComplete(text, { ...ready, fixAll: { disabled: false } }, text, 0)).toBe(
    false,
  );
  expect(isReviewWriteComplete(text, ready, text, 0)).toBe(true);
  const partial = { ...ready, items: [{ id: "remaining-finding" }], fixAll: { disabled: false } };
  expect(isReviewWriteComplete(text, partial, text, partial.items.length)).toBe(true);
  expect(
    isReviewWriteComplete(
      text,
      { ...partial, fixAll: { disabled: true } },
      text,
      partial.items.length,
    ),
  ).toBe(false);
});
