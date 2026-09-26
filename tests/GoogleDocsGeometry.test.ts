import { afterAll, describe, expect, test } from "bun:test";
import {
  docsRangeRects,
  locateRuns,
  readDocsTextRuns,
  type DocsTextRun,
} from "../src/adapters/chrome/content-script/google-docs/GoogleDocsGeometry";

// jsdom has no DOMRect; the browser's is what the geometry returns.
const hadDomRect = typeof globalThis.DOMRect === "function";
afterAll(() => {
  if (!hadDomRect) delete (globalThis as { DOMRect?: unknown }).DOMRect;
});
if (!hadDomRect) {
  globalThis.DOMRect = class {
    constructor(
      public x = 0,
      public y = 0,
      public width = 0,
      public height = 0,
    ) {}
    get left() {
      return this.x;
    }
    get top() {
      return this.y;
    }
    get right() {
      return this.x + this.width;
    }
    get bottom() {
      return this.y + this.height;
    }
  } as unknown as typeof DOMRect;
}

const run = (label: string, left = 0, top = 0): DocsTextRun => ({
  label,
  font: "",
  box: new DOMRect(left, top, label.length * 10, 20),
});

const placed = (text: string, runs: DocsTextRun[]) =>
  locateRuns(text, runs).map((r) => [r.label, text.slice(r.start, r.end)]);

describe("Google Docs text runs placed in the review text", () => {
  test("runs follow each other across spaces, line wraps and paragraph breaks", () => {
    const text = "We saw teh cat and\nthe dog ran away.";
    // A soft wrap drops the space; a label may carry its own spacing.
    expect(
      placed(text, [run("We saw teh "), run("cat and"), run("the  dog"), run("ran away.")]),
    ).toEqual([
      ["We saw teh ", "We saw teh"],
      ["cat and", "cat and"],
      ["the  dog", "the dog"],
      ["ran away.", "ran away."],
    ]);
  });

  test("repeated text is placed by the runs around it, or left out", () => {
    const text = "Yes. No. Yes. Maybe.";
    // "Yes." occurs twice: the run after it decides which one.
    expect(locateRuns(text, [run("Yes."), run("Maybe.")]).map((r) => r.start)).toEqual([9, 14]);
    // Nothing decides: left out rather than guessed, and the next run is placed on its own.
    expect(placed(text, [run("Yes."), run("Never."), run("Maybe.")])).toEqual([
      ["Maybe.", "Maybe."],
    ]);
  });

  test("text the review does not have (a header) is left out", () => {
    const text = "First item\nSecond item";
    const runs = [run("Header text"), run("First item"), run("Second item")];
    expect(placed(text, runs).map(([label]) => label)).toEqual(["First item", "Second item"]);
  });

  test("the page's runs are read in reading order, list markers skipped", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const add = (label: string, left: number, top: number) => {
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("aria-label", label);
      rect.setAttribute("data-font-css", "16px Arial");
      rect.getBoundingClientRect = () => new DOMRect(left, top, 50, 20);
      svg.append(rect);
    };
    // DOM order is not reading order.
    add("second line", 20, 40);
    add("end of first", 120, 11);
    add("1.", 2, 10);
    add("start of first", 20, 10);
    add("   ", 20, 70);
    document.body.append(svg);
    expect(readDocsTextRuns(document).map((r) => r.label)).toEqual([
      "start of first",
      "end of first",
      "second line",
    ]);
    svg.remove();
  });

  test("a range's rectangles are its share of each run it touches", () => {
    const text = "abcd efgh";
    // Two runs, 10px per character (no canvas font: shares by characters).
    const runs = locateRuns(text, [run("abcd ", 100, 5), run("efgh", 200, 30)]);
    const rects = docsRangeRects(text, runs, 2, 7).map((r) => [r.left, r.top, r.width]);
    expect(rects).toEqual([
      [120, 5, 20],
      [200, 30, 20],
    ]);
    // Outside every rendered run: nothing to draw.
    expect(docsRangeRects(text, runs, 4, 5)).toEqual([]);
  });
});
