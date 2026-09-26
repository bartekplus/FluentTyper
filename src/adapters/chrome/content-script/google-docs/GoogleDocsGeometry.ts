/**
 * Where Docs shows a stretch of its text. Docs paints text on a canvas; for an
 * extension it allows (see GoogleDocsMainWorld), it also lays an invisible SVG
 * rect over every rendered run of text, labelled with that text
 * (`aria-label`) and its canvas font (`data-font-css`). Only rendered pages
 * have runs. Reading them never moves the selection or touches the document.
 *
 * A label is not always the text as written: its spacing may differ, and list
 * numbers and bullets are runs of their own that the text lacks. So runs are
 * placed by their visible characters only, and positions inside a run are
 * measured on the document's own text.
 */

/** One rendered run: its on-screen box, its label and the font it is drawn in. */
export interface DocsTextRun {
  box: DOMRect;
  label: string;
  font: string;
}

/** A run placed in the review text: it shows text [start, end). */
export interface LocatedRun extends DocsTextRun {
  start: number;
  end: number;
}

const RUN_SELECTOR = "rect[aria-label]";
// "1.", "iv)", "a.", "•": a list marker Docs draws before the item's text.
const LIST_MARKER = /^(?:(?:\d+|[a-z]|[ivxlcdm]+)[.)]|[•◦▪▫‣⁃●○■□☐☑☒✓✔\-–*+])$/iu;
// A run whose text occurs this often is placed by the runs that follow it.
const MAX_CANDIDATES = 64;
const FOLLOWING_RUNS = 3;
// Boxes this close vertically sit on one line.
const LINE_TOLERANCE_PX = 3;

/** The rendered runs under `root`, in reading order (top to bottom, then left to right). */
export function readDocsTextRuns(root: ParentNode): DocsTextRun[] {
  const runs: DocsTextRun[] = [];
  for (const element of root.querySelectorAll<Element>(RUN_SELECTOR)) {
    const label = element.getAttribute("aria-label") ?? "";
    const box = element.getBoundingClientRect();
    if (!label.trim() || LIST_MARKER.test(label.trim())) continue;
    if (!(box.width > 0 && box.height > 0)) continue;
    runs.push({ box, label, font: element.getAttribute("data-font-css") ?? "" });
  }
  return runs.sort(
    (a, b) =>
      (Math.abs(a.box.top - b.box.top) > LINE_TOLERANCE_PX ? a.box.top - b.box.top : 0) ||
      a.box.left - b.box.left,
  );
}

// Spaces, line breaks and Docs' structure markers: never part of a run's match.
// eslint-disable-next-line no-control-regex -- Docs' private control markers are not text.
const INVISIBLE = /[\s\u0000-\u001f   ﻿￼]/u;

/** The visible characters of a text, with the offset each one has in it. */
export interface VisibleText {
  chars: string;
  offsets: number[];
}

/** The visible characters of `text`, with the offset each one has in `text`. */
export function visibleCharacters(text: string): VisibleText {
  let chars = "";
  const offsets: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    if (INVISIBLE.test(text[index])) continue;
    chars += text[index];
    offsets.push(index);
  }
  return { chars, offsets };
}

/**
 * Places each run in `text` (the review's text), in reading order. A run
 * continues where the previous one ended, whitespace aside; the first, or one
 * after a run that could not be placed, is placed where its characters occur
 * once, or where the runs after it also follow on. Runs whose characters are
 * not in `text` (headers, footnotes, the window's edges) are left out.
 */
export function locateRuns(text: string | VisibleText, runs: readonly DocsTextRun[]): LocatedRun[] {
  // An index of a long text is worth keeping across paints: see visibleCharacters.
  const { chars, offsets } = typeof text === "string" ? visibleCharacters(text) : text;
  const cores = runs.map((run) => visibleCharacters(run.label).chars);
  const located: LocatedRun[] = [];
  let cursor = -1;
  for (let index = 0; index < runs.length; index += 1) {
    const core = cores[index];
    let at = cursor >= 0 && chars.startsWith(core, cursor) ? cursor : -1;
    if (at < 0) {
      const candidates: number[] = [];
      for (let found = chars.indexOf(core); found >= 0; found = chars.indexOf(core, found + 1)) {
        candidates.push(found);
        if (candidates.length > MAX_CANDIDATES) break;
      }
      const fitting = candidates.filter((candidate) => {
        let end = candidate + core.length;
        for (
          let next = index + 1;
          next <= index + FOLLOWING_RUNS && next < runs.length;
          next += 1
        ) {
          if (!chars.startsWith(cores[next], end)) return false;
          end += cores[next].length;
        }
        return true;
      });
      if (candidates.length <= MAX_CANDIDATES && fitting.length === 1) at = fitting[0];
    }
    if (at < 0) {
      cursor = -1;
      continue;
    }
    cursor = at + core.length;
    located.push({ ...runs[index], start: offsets[at], end: offsets[cursor - 1] + 1 });
  }
  return located;
}

let measureContext: CanvasRenderingContext2D | null | undefined;

/** Width of `text` in `font`, or null when the canvas cannot measure it. */
function measure(text: string, font: string): number | null {
  if (measureContext === undefined) {
    try {
      measureContext = document.createElement("canvas").getContext("2d");
    } catch {
      measureContext = null;
    }
  }
  if (!measureContext || !font) return null;
  measureContext.font = font;
  return measureContext.measureText(text).width;
}

/**
 * The on-screen rectangles of text [start, end), one per run it touches. A
 * position inside a run is its measured share of the run's box, so Docs' zoom
 * and scroll are already in the box.
 */
export function docsRangeRects(
  text: string,
  runs: readonly LocatedRun[],
  start: number,
  end: number,
): DOMRect[] {
  const rects: DOMRect[] = [];
  for (const run of runs) {
    const from = Math.max(start, run.start);
    const to = Math.min(end, run.end);
    if (from >= to) continue;
    // The box spans the whole label, spaces around its text included.
    const lead = run.label.slice(0, run.label.length - run.label.trimStart().length);
    const whole = measure(run.label, run.font);
    const share = (offset: number) => {
      const width = whole ? measure(lead + text.slice(run.start, offset), run.font) : null;
      return whole && width !== null
        ? width / whole
        : (lead.length + offset - run.start) / run.label.length;
    };
    const left = run.box.left + run.box.width * share(from);
    const right = run.box.left + run.box.width * share(to);
    rects.push(new DOMRect(left, run.box.top, Math.max(1, right - left), run.box.height));
  }
  return rects;
}
