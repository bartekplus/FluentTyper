/**
 * Where Docs shows a stretch of its text. Docs paints text on a canvas; for an
 * extension it allows (see GoogleDocsMainWorld), it also lays an invisible SVG
 * rect over every rendered run of text, labelled with that text
 * (`aria-label`) and its canvas font (`data-font-css`). Only rendered pages
 * have runs. Reading them never moves the selection or touches the document.
 *
 * Runs are matched to the review text by their visible characters (a label's
 * spacing may differ from the text), and only where the page and the text
 * agree: a run is placed after the one drawn just before it, or where it and
 * its drawn neighbours all fit the text. List markers, headers, footers and
 * table cells whose text repeats elsewhere are left out rather than guessed:
 * a finding may go unhighlighted, but never highlights other text.
 */

/** One rendered run: its on-screen box, its label and the font it is drawn in. */
export interface DocsTextRun {
  box: DOMRect;
  label: string;
  font: string;
  /** The rect it was read from, to re-measure its box after a scroll. */
  element?: Element;
}

/** A run placed in the review text: it shows text [start, end). */
export interface LocatedRun extends DocsTextRun {
  start: number;
  end: number;
  /** Text offset of each visible character of the run, in order. */
  textOffsets: number[];
  /** Label offset of the same characters. */
  labelOffsets: number[];
}

const RUN_SELECTOR = "rect[aria-label]";
// A run whose text occurs this often is not placed by its text.
const MAX_CANDIDATES = 64;
// Drawn neighbours (before and after) that must fit the text with a run placed on its own.
const NEIGHBOURS = 2;

/**
 * The rendered runs under `root`, in reading order: lines top to bottom (runs
 * whose boxes overlap vertically share a line, whatever their size), each
 * line left to right.
 */
export function readDocsTextRuns(root: ParentNode): DocsTextRun[] {
  const runs: DocsTextRun[] = [];
  for (const element of root.querySelectorAll<Element>(RUN_SELECTOR)) {
    const label = element.getAttribute("aria-label") ?? "";
    const box = element.getBoundingClientRect();
    if (!label.trim() || !(box.width > 0 && box.height > 0)) continue;
    runs.push({ box, label, font: element.getAttribute("data-font-css") ?? "", element });
  }
  runs.sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left);
  const lines: DocsTextRun[][] = [];
  let bottom = Number.NEGATIVE_INFINITY;
  for (const run of runs) {
    const middle = run.box.top + run.box.height / 2;
    if (lines.length > 0 && middle < bottom) {
      lines[lines.length - 1].push(run);
      bottom = Math.max(bottom, run.box.bottom);
    } else {
      lines.push([run]);
      bottom = run.box.bottom;
    }
  }
  return lines.flatMap((line) => line.sort((a, b) => a.box.left - b.box.left));
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

/** True when `a` and `b` cover more than half of the smaller one's area. */
function overlapping(a: DOMRect, b: DOMRect): boolean {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  if (width <= 0 || height <= 0) return false;
  return width * height > Math.min(a.width * a.height, b.width * b.height) / 2;
}

/**
 * True when `b` is drawn right after `a`: further along the same line, or at
 * the start of a following line (a wrap or a new paragraph, not a new page or
 * another column's cell beside it).
 */
function drawnNext(a: DOMRect, b: DOMRect): boolean {
  const height = Math.max(a.height, b.height);
  const shared = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  if (shared > Math.min(a.height, b.height) / 2) {
    const gap = b.left - a.right;
    return gap >= -height / 2 && gap <= height * 1.5;
  }
  return b.top >= a.top + a.height / 2 && b.top - a.bottom <= height * 3 && b.left <= a.right;
}

/**
 * Places each run in `text` (the review's text). Runs come in reading order.
 * A run continues the previous one when it is drawn right after it and its
 * characters come next in the text. Otherwise it is placed only where its
 * characters occur and at least two drawn neighbours (fewer in a document of
 * fewer runs) fit the text around it, and nowhere else. Runs whose characters
 * are not in `text` (list markers, headers, footers, text outside the window)
 * are left out.
 */
export function locateRuns(text: string | VisibleText, runs: readonly DocsTextRun[]): LocatedRun[] {
  // An index of a long text is worth keeping across paints: see visibleCharacters.
  const { chars, offsets } = typeof text === "string" ? visibleCharacters(text) : text;
  const all = runs.map((run) => ({ run, label: visibleCharacters(run.label) }));
  // Only runs whose text is in the review text take part, so a bullet or a
  // footer between two lines never breaks the chain between them. Two runs
  // drawn over each other cannot both be the text: neither takes part.
  const stacked = new Set<DocsTextRun>();
  const byLeft = [...runs].sort((a, b) => a.box.left - b.box.left);
  for (let i = 0; i < byLeft.length; i += 1) {
    for (let j = i + 1; j < byLeft.length && byLeft[j].box.left < byLeft[i].box.right; j += 1) {
      if (overlapping(byLeft[i].box, byLeft[j].box)) stacked.add(byLeft[i]).add(byLeft[j]);
    }
  }
  const parts = all.filter(
    ({ run, label }) => label.chars && !stacked.has(run) && chars.includes(label.chars),
  );
  const taken = new Uint8Array(chars.length);
  const free = (at: number, length: number) => {
    for (let index = at; index < at + length; index += 1) if (taken[index]) return false;
    return true;
  };
  // How many of the runs drawn before (step -1) or after (step 1) run `index`,
  // one after another, fit the text right before or after [at, end).
  const neighbours = (index: number, at: number, end: number, step: 1 | -1): number => {
    let count = 0;
    let edge = step === 1 ? end : at;
    for (let current = index; count < NEIGHBOURS; current += step) {
      const next = current + step;
      if (next < 0 || next >= parts.length) break;
      const [a, b] = step === 1 ? [parts[current], parts[next]] : [parts[next], parts[current]];
      if (!drawnNext(a.run.box, b.run.box)) break;
      const core = parts[next].label.chars;
      const from = step === 1 ? edge : edge - core.length;
      if (from < 0 || !chars.startsWith(core, from)) break;
      edge = step === 1 ? edge + core.length : from;
      count += 1;
    }
    return count;
  };
  const required = Math.min(NEIGHBOURS, parts.length - 1);
  const located: LocatedRun[] = [];
  let cursor = -1;
  for (let index = 0; index < parts.length; index += 1) {
    const { run, label } = parts[index];
    const core = label.chars;
    const follows =
      cursor >= 0 &&
      drawnNext(parts[index - 1].run.box, run.box) &&
      chars.startsWith(core, cursor) &&
      free(cursor, core.length);
    let at = follows ? cursor : -1;
    if (at < 0) {
      const fitting: number[] = [];
      let candidates = 0;
      for (let found = chars.indexOf(core); found >= 0; found = chars.indexOf(core, found + 1)) {
        if (++candidates > MAX_CANDIDATES) break;
        const end = found + core.length;
        if (!free(found, core.length)) continue;
        const support = neighbours(index, found, end, -1) + neighbours(index, found, end, 1);
        if (support >= required) fitting.push(found);
      }
      if (candidates <= MAX_CANDIDATES && fitting.length === 1) at = fitting[0];
    }
    if (at < 0) {
      cursor = -1;
      continue;
    }
    cursor = at + core.length;
    taken.fill(1, at, cursor);
    located.push({
      ...run,
      start: offsets[at],
      end: offsets[cursor - 1] + 1,
      textOffsets: offsets.slice(at, cursor),
      labelOffsets: label.offsets,
    });
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

const RIGHT_TO_LEFT = /[֐-ࣿיִ-﷿ﹰ-﻿]/u;
const RIGHT_TO_LEFT_ALL = /[֐-ࣿיִ-﷿ﹰ-﻿]/gu;

const textOrder = new WeakMap<readonly LocatedRun[], LocatedRun[]>();

/** `runs` sorted by text position, computed once per list. */
function inTextOrder(runs: readonly LocatedRun[]): LocatedRun[] {
  let ordered = textOrder.get(runs);
  if (!ordered) {
    ordered = [...runs].sort((a, b) => a.start - b.start);
    textOrder.set(runs, ordered);
  }
  return ordered;
}

/**
 * Label offset of the text position `offset` inside `run`: a range's start
 * sits at the next visible character, its end right after the last one, so a
 * label's own spacing never widens a highlight.
 */
function labelPosition(run: LocatedRun, offset: number, edge: "start" | "end"): number {
  // Visible characters of the run before `offset`.
  let low = 0;
  let high = run.textOffsets.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (run.textOffsets[middle] < offset) low = middle + 1;
    else high = middle;
  }
  const last = run.labelOffsets.length - 1;
  if (edge === "start") return low <= last ? run.labelOffsets[low] : run.labelOffsets[last] + 1;
  return low === 0 ? run.labelOffsets[0] : run.labelOffsets[low - 1] + 1;
}

/**
 * The on-screen rectangles of text [start, end), one per run it touches. A
 * position inside a run is its measured share of the run's label, so Docs'
 * zoom and scroll are already in the box. A right-to-left run is measured
 * from its right edge; a run mixing directions gets no rectangle rather than
 * a wrong one.
 */
export function docsRangeRects(runs: readonly LocatedRun[], start: number, end: number): DOMRect[] {
  const rects: DOMRect[] = [];
  // Runs never share text, so in text order their ends rise too: find the first
  // run ending after `start`, then walk while runs start before `end`.
  const ordered = inTextOrder(runs);
  let low = 0;
  let high = ordered.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (ordered[middle].end <= start) low = middle + 1;
    else high = middle;
  }
  for (let index = low; index < ordered.length && ordered[index].start < end; index += 1) {
    const run = ordered[index];
    const from = Math.max(start, run.start);
    const to = Math.min(end, run.end);
    if (from >= to) continue;
    const label = run.label;
    const rightToLeft = RIGHT_TO_LEFT.test(label);
    if (rightToLeft && /\p{L}/u.test(label.replace(RIGHT_TO_LEFT_ALL, ""))) continue;
    const whole = measure(label, run.font);
    const share = (offset: number, edge: "start" | "end") => {
      const position = labelPosition(run, offset, edge);
      const width = whole ? measure(label.slice(0, position), run.font) : null;
      return whole && width !== null ? width / whole : position / label.length;
    };
    const [first, last] = [share(from, "start"), share(to, "end")];
    const [left, right] = rightToLeft
      ? [run.box.right - run.box.width * last, run.box.right - run.box.width * first]
      : [run.box.left + run.box.width * first, run.box.left + run.box.width * last];
    rects.push(new DOMRect(left, run.box.top, Math.max(1, right - left), run.box.height));
  }
  return rects;
}
