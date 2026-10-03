import { expect, test } from "bun:test";
import { createEditor } from "./codeContextTestUtils";
import { buildContentEditableTextMap } from "../src/adapters/chrome/content-script/review/ContentEditableTextMap";
import { prepareNativeReviewTransaction } from "../src/adapters/chrome/content-script/review/NativeReviewTransaction";

test("native batch preparation preserves marks and changes no live node", () => {
  const root = createEditor('<p>teh <b>teh</b> and <a href="/keep">teh</a>.</p>');
  const html = root.innerHTML;
  const map = buildContentEditableTextMap(root);
  const plan = prepareNativeReviewTransaction(
    root,
    map,
    [0, 4, 12].map((start) => ({
      start,
      end: start + 3,
      original: "teh",
      replacement: "the",
    })),
  );
  expect(plan).toBeNull();
  expect(root.innerHTML).toBe(html);
});

test("native batches reject stateful islands before writing", () => {
  const root = createEditor('<p>teh <span contenteditable="false">@Ann</span> teh</p>');
  const map = buildContentEditableTextMap(root);
  expect(
    prepareNativeReviewTransaction(
      root,
      map,
      [0, map.text.lastIndexOf("teh")].map((start) => ({
        start,
        end: start + 3,
        original: "teh",
        replacement: "the",
      })),
    ),
  ).toBeNull();
  expect(root.querySelector('[contenteditable="false"]')?.textContent).toBe("@Ann");
});

test("native text batches use DOM offsets and preserve raw whitespace", () => {
  const root = createEditor('<p style="white-space: normal">teh   teh\t🙂 é</p>');
  const map = buildContentEditableTextMap(root);
  const starts = [map.text.indexOf("teh"), map.text.lastIndexOf("teh")];
  const plan = prepareNativeReviewTransaction(
    root,
    map,
    starts.map((start) => ({ start, end: start + 3, original: "teh", replacement: "the" })),
  );
  expect(plan?.value).toBe("the   the");
  expect(root.textContent).toBe("teh   teh\t🙂 é");
});

test("native batches reject duplicates, overlaps and stale original spans", () => {
  const root = createEditor("<p>teh and teh</p>");
  const map = buildContentEditableTextMap(root);
  const edit = { start: 0, end: 3, original: "teh", replacement: "the" };
  for (const edits of [
    [edit, edit],
    [edit, { ...edit, start: 1, original: "eh" }],
    [{ ...edit, original: "bad" }],
  ]) {
    expect(prepareNativeReviewTransaction(root, map, edits)).toBeNull();
    expect(root.textContent).toBe("teh and teh");
  }
});

test("native batch preparation retains blocks outside the transaction", () => {
  const root = createEditor(
    '<p id="keep">Untouched</p><p>teh and teh.</p><p id="also-keep">Untouched</p>',
  );
  const map = buildContentEditableTextMap(root);
  const plan = prepareNativeReviewTransaction(
    root,
    map,
    [map.text.indexOf("teh"), map.text.lastIndexOf("teh")].map((start) => ({
      start,
      end: start + 3,
      original: "teh",
      replacement: "the",
    })),
  );
  expect(plan?.value).toBe("the and the");
  expect(plan?.range.intersectsNode(root.firstChild!)).toBe(false);
  expect(plan?.range.intersectsNode(root.lastChild!)).toBe(false);
});

test("native batches reject different structural containers before writing", () => {
  const root = createEditor("<p>teh</p><ul><li><b>teh</b></li></ul>");
  const map = buildContentEditableTextMap(root);
  const edits = [0, map.text.lastIndexOf("teh")].map((start) => ({
    start,
    end: start + 3,
    original: "teh",
    replacement: "the",
  }));
  expect(prepareNativeReviewTransaction(root, map, edits)).toBeNull();
  expect(root.innerHTML).toBe("<p>teh</p><ul><li><b>teh</b></li></ul>");
});

test("native batches refuse an unchanged span with nonserializable state", () => {
  const root = createEditor("<p>teh <span>cat</span> and teh dog.</p>");
  const span = root.querySelector("span")!;
  let clicks = 0;
  span.addEventListener("click", () => {
    clicks += 1;
  });
  const state = { count: 7 };
  Object.assign(span, { hostState: state });
  const map = buildContentEditableTextMap(root);
  expect(
    prepareNativeReviewTransaction(
      root,
      map,
      [0, map.text.lastIndexOf("teh")].map((start) => ({
        start,
        end: start + 3,
        original: "teh",
        replacement: "the",
      })),
    ),
  ).toBeNull();
  expect(root.querySelector("span")).toBe(span);
  span.click();
  expect(clicks).toBe(1);
  expect((span as typeof span & { hostState: unknown }).hostState).toBe(state);
});
