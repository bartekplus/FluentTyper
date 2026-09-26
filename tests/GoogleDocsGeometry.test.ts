import { afterAll, describe, expect, test } from "bun:test";
import {
  docsRangeRects,
  locateRuns,
  readDocsTextRuns,
  type DocsTextRun,
} from "../src/adapters/chrome/content-script/google-docs/GoogleDocsGeometry";
import { installDomRect } from "./domRect";

// jsdom has no DOMRect; the browser's is what the geometry returns.
afterAll(installDomRect());

const run = (label: string, left = 0, top = 0): DocsTextRun => ({
  label,
  font: "",
  box: new DOMRect(left, top, label.length * 10, 20),
});

/** Runs drawn like a page: one inner array per line, 10px per character, lines 24px apart. */
function page(lines: string[][], top = 0, left = 0): DocsTextRun[] {
  return lines.flatMap((labels, row) => {
    let x = left;
    return labels.map((label) => {
      const drawn = run(label, x, top + row * 24);
      x += label.length * 10;
      return drawn;
    });
  });
}

const placed = (text: string, runs: DocsTextRun[]) =>
  locateRuns(text, runs).map((r) => [r.label, text.slice(r.start, r.end)]);

describe("Google Docs text runs placed in the review text", () => {
  test("runs follow each other across spaces, line wraps and paragraph breaks", () => {
    const text = "We saw teh cat and\nthe dog ran away.";
    // A soft wrap drops the space; a label may carry its own spacing.
    expect(
      placed(
        text,
        page([
          ["We saw teh ", "cat and"],
          ["the  dog ", "ran away."],
        ]),
      ),
    ).toEqual([
      ["We saw teh ", "We saw teh"],
      ["cat and", "cat and"],
      ["the  dog ", "the dog"],
      ["ran away.", "ran away."],
    ]);
  });

  test("repeated text is placed by the runs drawn next to it, or left out", () => {
    const text = "Yes. No. Yes. Maybe.";
    // "Yes." occurs twice: the run drawn after it decides which one.
    expect(locateRuns(text, page([["Yes. ", "Maybe."]])).map((r) => r.start)).toEqual([9, 14]);
    // Nothing decides: left out rather than guessed.
    expect(placed(text, page([["Yes. "], [], [], [], ["Other"]]))).toEqual([]);
  });

  test("a footer or header whose text is also in the body is never placed there", () => {
    const text = "Our revenue grew in 2023 by a lot.\nThe team was happy with the\nresult overall.";
    const body = page(
      [
        ["Our revenue grew in 2023 by a lot."],
        ["The team was happy with the"],
        ["result overall."],
      ],
      100,
    );
    // The page number "3" (also inside "2023"), far below the body, and a header above it.
    const runs = [run("Our revenue", 0, 10), ...body, run("3", 400, 1000)];
    expect(placed(text, runs)).toEqual([
      ["Our revenue grew in 2023 by a lot.", "Our revenue grew in 2023 by a lot."],
      ["The team was happy with the", "The team was happy with the"],
      ["result overall.", "result overall."],
    ]);
    // The first sentence is drawn on its own line only.
    const rects = docsRangeRects(locateRuns(text, runs), 0, 34).map((r) => [r.left, r.top]);
    expect(rects).toEqual([[0, 100]]);
  });

  test("a table cell repeating its neighbour's text is never swapped with it", () => {
    // Cell A1 "The quick brown fox" wraps; cell B1 "fox" sits beside its first line.
    const text = "The quick brown fox\u001cfox\u001c";
    const a1 = run("The quick brown", 0, 100);
    const b1 = run("fox", 300, 100);
    const a1Wrap = run("fox", 0, 124);
    const located = locateRuns(text, [a1, b1, a1Wrap]);
    // Whatever is placed is placed right: B1's box never shows A1's "fox" or the reverse.
    for (const r of located) {
      if (r.box === b1.box) expect(r.start).toBe(20);
      if (r.box === a1Wrap.box) expect(r.start).toBe(16);
    }
  });

  test("list markers and other text the review lacks never break the chain", () => {
    const text = "Milk\nEggs\nSome cheese\nThat is all.";
    // Any bullet style, drawn left of each item.
    const runs = ["➢", "❖", "★", "1.1."].flatMap((marker) => [run(marker, 0, 0)]);
    const items = page([["Milk"], ["Eggs"], ["Some cheese"], ["That is all."]], 0, 20);
    runs.forEach((marker, i) => (marker.box = new DOMRect(0, i * 24, 10, 20)));
    const interleaved = items.flatMap((item, i) => [runs[i], item]);
    expect(placed(text, interleaved).map(([, shown]) => shown)).toEqual([
      "Milk",
      "Eggs",
      "Some cheese",
      "That is all.",
    ]);
  });

  test("the page's runs are read in reading order, whatever their size", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const add = (label: string, left: number, top: number, height = 20) => {
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("aria-label", label);
      rect.setAttribute("data-font-css", "16px Arial");
      rect.getBoundingClientRect = () => new DOMRect(left, top, 50, height);
      svg.append(rect);
    };
    // DOM order is not reading order; a larger word shares its line.
    add("second line", 20, 40);
    add("end of first", 120, 11);
    add("Important", 70, 2, 32);
    add("start of first", 20, 10);
    add("   ", 20, 70);
    document.body.append(svg);
    expect(readDocsTextRuns(document).map((r) => r.label)).toEqual([
      "start of first",
      "Important",
      "end of first",
      "second line",
    ]);
    svg.remove();
  });

  test("a range's rectangles are its share of each run it touches", () => {
    const text = "abcd efgh";
    // Two runs, 10px per character (no canvas font: shares by characters).
    const runs = locateRuns(text, page([["abcd "], ["efgh"]], 5, 100));
    const rects = docsRangeRects(runs, 2, 7).map((r) => [r.left, r.top, r.width]);
    expect(rects).toEqual([
      [120, 5, 20],
      [100, 29, 20],
    ]);
    // Between runs: nothing to draw.
    expect(docsRangeRects(runs, 4, 5)).toEqual([]);
  });

  test("a label's own spacing does not move or widen a highlight", () => {
    const text = "hello world";
    const runs = locateRuns(text, [run("hello   world", 0, 0)]);
    // "world" is drawn after the label's three spaces.
    expect(docsRangeRects(runs, 6, 11).map((r) => [r.left, r.width])).toEqual([[80, 50]]);
  });

  test("right-to-left text is measured from the right; mixed directions get no rectangle", () => {
    const text = "שלום עולם";
    const runs = locateRuns(text, [run(text, 100, 0)]);
    // The first word is drawn on the right.
    expect(docsRangeRects(runs, 0, 4).map((r) => [r.left, r.width])).toEqual([[150, 40]]);
    const mixed = "hello שלום";
    expect(docsRangeRects(locateRuns(mixed, [run(mixed, 0, 0)]), 0, 5)).toEqual([]);
  });

  test("labels of structure markers only are never placed", () => {
    const text = "Text\uFFFC more";
    expect(placed(text, [run("\uFFFC", 0, 0), run("Text more", 0, 24)])).toEqual([
      ["Text more", "Text\uFFFC more"],
    ]);
  });
});
