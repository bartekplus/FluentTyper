import { describe, expect, test } from "bun:test";
import {
  isBoundary,
  isGoogleDocsURL,
  readModel,
  snapshotFor,
  snapshotContext,
  planCompletion,
  planGrammar,
  minimizeEdit,
  validEdit,
  snapshotFrom,
  REVIEW_WINDOW,
} from "../src/adapters/chrome/content-script/google-docs/GoogleDocsModel";
const token = (text: string) => ({
  token: text.match(/[^\s.,!?]*$/u)?.[0] ?? "",
  start: text.length - (text.match(/[^\s.,!?]*$/u)?.[0].length ?? 0),
});
const separator = (char: string) => /[\s.,!?]/u.test(char);
function snapshot(text: string, anchor = text.length, focus = anchor) {
  return snapshotFor(
    readModel(`\u0003${text}\n`, [{ anchor: anchor + 1, focus: focus + 1 }])!,
    "doc?tab=t.1",
    "token",
  )!;
}
function complete(text: string, suggestion: string, anchor = text.length, focus = anchor) {
  const edit = planCompletion(snapshot(text, anchor, focus), suggestion, token, separator)!;
  return { edit, result: text.slice(0, edit.start) + edit.replacement + text.slice(edit.end) };
}
describe("Google Docs logical edits", () => {
  test("applies only to an actual Docs edit URL", () => {
    for (const url of [
      "https://docs.google.com/document/d/123/edit",
      "https://docs.google.com/document/u/0/d/123/edit?tab=t.0",
    ])
      expect(isGoogleDocsURL(url)).toBe(true);
    for (const url of [
      "https://evil.example/document/d/123/edit",
      "https://docs.google.com/document/d/123/view",
      "https://docs.google.com/spreadsheets/d/123/edit",
    ])
      expect(isGoogleDocsURL(url)).toBe(false);
  });
  test("removes only outer sentinels and preserves logical bidi offsets", () => {
    const model = readModel("\u0003אבג\n", [{ anchor: 4, focus: 4 }])!;
    expect(model.text).toBe("אבג");
    expect(model.anchor).toBe(3);
  });
  test("rejects ambiguous selection metadata and multiple selections", () => {
    expect(readModel("abc", [{ anchor: 1, focus: 1, start: 2, end: 2 }])).toBeNull();
    expect(
      readModel("abc", [
        { anchor: 1, focus: 1 },
        { anchor: 2, focus: 2 },
      ]),
    ).toBeNull();
    expect(readModel("abc", [{ anchor: NaN, focus: 1 }])).toBeNull();
  });
  test("preserves graphemes including accents emoji ZWJ flags and Indic clusters", () => {
    for (const value of ["e\u0301", "😀", "👨‍👩‍👧‍👦", "🇵🇱", "क्ष"]) {
      expect(isBoundary(value, 0)).toBe(true);
      expect(isBoundary(value, value.length)).toBe(true);
      for (let index = 1; index < value.length; index += 1)
        expect(isBoundary(value, index)).toBe(false);
    }
  });
  test("performs spelling replacements rather than suffix-only completion", () => {
    expect(complete("helo", "hello ").result).toBe("hello ");
  });
  test("replaces the suffix under a mid-word caret", () => {
    expect(complete("hellp world", "hello", 3).result).toBe("hello world");
  });
  test("expands multiline snippets without dropping whitespace", () => {
    expect(complete("brb", "Hello,\n\nBartosz\n").result).toBe("Hello,\n\nBartosz\n");
  });
  test("next-word prediction never deletes the next word", () => {
    expect(complete("Hello world", "beautiful ", 6).result).toBe("Hello beautiful world");
  });
  test("consumes a duplicate following space exactly once", () => {
    expect(complete("hel world", "hello ", 3).result).toBe("hello world");
  });
  test("allows explicit reversed selection replacements", () => {
    expect(complete("The bad phrase.", "good sentence", 14, 4).result).toBe("The good sentence.");
  });
  test("does not edit across table/object control markers", () => {
    const s = snapshot("a\ufffcb", 0, 3);
    expect(planCompletion(s, "x", token, separator)).toBeNull();
  });
  test("allows grammar cursor placement inside paired brackets", () => {
    expect(
      planGrammar(snapshot("("), {
        deleteBackwards: 1,
        deleteForwards: 0,
        replacement: "()",
        cursorOffset: 1,
      }),
    ).toEqual({ start: 0, end: 1, replacement: "()", cursorAfter: 1 });
  });
  test("rejects grammar outside available context and invalid cursor offsets", () => {
    expect(
      planGrammar(snapshot("a"), { deleteBackwards: 2, deleteForwards: 0, replacement: "b" }),
    ).toBeNull();
    expect(
      planGrammar(snapshot("a"), {
        deleteBackwards: 1,
        deleteForwards: 0,
        replacement: "b",
        cursorOffset: 2,
      }),
    ).toBeNull();
  });
  test("minimizes replacement to retain unchanged formatting runs", () => {
    expect(
      minimizeEdit("helo", { start: 0, end: 4, replacement: "hello", cursorAfter: 5 }),
    ).toEqual({ start: 3, end: 3, replacement: "l", cursorAfter: 5 });
  });
  test("minimal edits never split a grapheme", () => {
    expect(
      minimizeEdit("e\u0301x", { start: 0, end: 3, replacement: "e\u0300x", cursorAfter: 3 }),
    ).toEqual({ start: 0, end: 2, replacement: "e\u0300", cursorAfter: 3 });
  });
  test("maps large bounded context back to full document offsets", () => {
    const text = "hello ".repeat(5000) + "helo";
    const s = snapshot(text);
    expect(s.text.length).toBeLessThanOrEqual(8192);
    expect(snapshotContext(s).beforeCursor.endsWith("helo")).toBe(true);
    const edit = planCompletion(s, "hello", token, separator)!;
    expect(edit.start).toBe(text.length - 4);
  });
  test("refuses a token truncated by either end of the context window", () => {
    const longWord = "a".repeat(30000);
    expect(planCompletion(snapshot(longWord, 29000), "word", token, separator)).toBeNull();
    expect(planCompletion(snapshot("before " + longWord, 8), "word", token, separator)).toBeNull();
  });
  test("rejects malformed page messages and excessive replacement size", () => {
    expect(
      snapshotFrom({ token: "x", scope: "d", text: "a", anchor: -1, focus: 0, windowStart: 0 }),
    ).toBeNull();
    expect(
      validEdit("a", { start: 0, end: 1, replacement: "x".repeat(16385), cursorAfter: 1 }),
    ).toBe(false);
    expect(validEdit("a", { start: 0.5, end: 1, replacement: "x", cursorAfter: 1 })).toBe(false);
  });
  test("lands the caret after an existing following space when no space is appended", () => {
    const text = "the wond next";
    const snapshot = {
      token: "t",
      scope: "s",
      text,
      windowStart: 0,
      documentLength: text.length,
      anchor: 8,
      focus: 8,
    };
    const findToken = (value: string) => {
      const match = /\S+$/.exec(value);
      return { token: match?.[0] ?? "", start: match ? match.index : value.length };
    };
    const isSeparator = (char: string) => /\s/.test(char);
    expect(planCompletion(snapshot, "wonderful", findToken, isSeparator, true)).toEqual({
      start: 4,
      end: 9,
      replacement: "wonderful ",
      cursorAfter: 14,
    });
    expect(planCompletion(snapshot, "wonderful", findToken, isSeparator)).toEqual({
      start: 4,
      end: 8,
      replacement: "wonderful",
      cursorAfter: 13,
    });
  });
});

describe("Google Docs review reads", () => {
  const review = (text: string, anchor = text.length, focus = anchor) =>
    snapshotFor(
      readModel(`\u0003${text}\n`, [{ anchor: anchor + 1, focus: focus + 1 }])!,
      "doc?tab=t.1",
      "token",
      true,
    )!;

  test("a document up to the review window is read whole, wherever the caret is", () => {
    const text = "Some prose here. ".repeat(2500); // 42,500 characters
    for (const caret of [0, 20_000, text.length]) {
      const s = review(text, caret);
      expect(s).toMatchObject({ text, windowStart: 0, documentLength: text.length });
      expect(s.anchor).toBe(caret);
    }
    // A typing read of the same document carries only the context around the caret.
    expect(snapshot(text, 0).text.length).toBe(8192);
  });

  test("a longer document is read around the caret, the window moved to fit", () => {
    const text = "x".repeat(REVIEW_WINDOW * 3);
    const middle = review(text, REVIEW_WINDOW * 1.5);
    expect(middle.text.length).toBe(REVIEW_WINDOW);
    expect(middle.windowStart).toBe(REVIEW_WINDOW);
    const end = review(text);
    expect(end.windowStart).toBe(REVIEW_WINDOW * 2);
    expect(end.text.length).toBe(REVIEW_WINDOW);
    expect(review(text, 0).windowStart).toBe(0);
  });

  test("a selection of any length is accepted, as far as the window reaches", () => {
    const text = "Some prose here. ".repeat(6000); // 102,000 characters
    // Select all: a typing read refuses it (it could never be one edit).
    expect(
      snapshotFor(readModel(`\u0003${text}\n`, [{ anchor: 1, focus: text.length + 1 }])!, "d", "t"),
    ).toBeNull();
    const all = review(text, 0, text.length);
    expect(all.windowStart).toBe(0);
    expect(all.text.length).toBe(REVIEW_WINDOW);
    expect([all.anchor, all.focus]).toEqual([0, REVIEW_WINDOW]);
    // The page-message check accepts what it sends.
    expect(snapshotFrom(JSON.parse(JSON.stringify(all)))).toEqual(all);
    expect(snapshotContext(all)).toMatchObject({ start: 0, end: REVIEW_WINDOW });
  });
});
