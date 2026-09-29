import type { PreparedReview } from "../reviewDiagnostics";
import { isGraphemeBoundary } from "../textRanges";
import type { ProtectedRange, TextRange } from "../types";
import { MAX_AI_SEGMENTS } from "./parse";
import type {
  AiChunk,
  AiChunkPlan,
  AiGenerationRequest,
  AiPlaceholder,
  AiSegment,
  ConcreteRewriteStyle,
  ReviewAiMode,
} from "./types";

export interface AiChunkOptions {
  mode: ReviewAiMode;
  style: ConcreteRewriteStyle | null;
  /** Editable characters per chunk (conservative pre-check before the runtime's token budget). */
  maxChunkChars?: number;
  /** Correct only: disable for models evaluated with one sentence per request. */
  pairSentences?: boolean;
  /** Previous plan in this review; unchanged pairs anchor grouping after edits. */
  previous?: { text: string; chunks: readonly AiChunk[] };
}

/**
 * Correct pairs short sentences to amortize the prompt, retaining separate
 * editable ranges and read-only context. Pairs stay within 200 characters;
 * longer sentences keep the 400-character allowance on their own. Larger
 * pairs missed a quantifier correction in the Gemma stress test.
 * Rewrite keeps larger chunks (docs/local-ai-evaluation.md).
 */
const CORRECT_CHUNK_CHARS = 400;
const REWRITE_CHUNK_CHARS = 1_200;
/** Read-only context characters on each side. */
const CONTEXT_CHARS = 300;
/** Cap on total editable characters sent for one pass. */
const CORRECT_TOTAL_CHARS = 12_000;
const REWRITE_TOTAL_CHARS = 2_000;
/** Inline code longer than this (or spanning lines) is a boundary, not a placeholder. */
const MAX_INLINE_CODE_CHARS = 100;

const LINE_BREAK = /\r\n|[\n\r\u2028\u2029]/g;
const WORD_CHAR = /[\p{L}\p{M}\p{N}_'’-]/u;
/** Placeholder brackets; prose containing them is never sent (a model token could not be told apart). */
const PLACEHOLDER_BRACKET = /[⟦⟧]/;
/** Short dotted abbreviations ("e.g", "i.e", "U.S") read as prose; they stay literal (still protected). */
const ABBREVIATION = /^\p{L}{1,2}(?:\.\p{L}{1,2})+$/u;
/** A period after these does not end a sentence. */
const NO_SPLIT_AFTER = new Set(
  "mr mrs ms dr prof st vs etc approx inc ltd jr sr np tj itp".split(" "),
);
const SENTENCE_END = /[.!?…]+["'”’»)\]]*(?=\s+\S)/gu;

/** Draft segment: a snapshot range and the placeholder ranges inside it. */
interface SegmentDraft {
  range: TextRange;
  placeholders: TextRange[];
}

/**
 * Splits the prepared review's scope into sentence/paragraph-aligned chunks of
 * editable prose. Protected ranges become segment boundaries or opaque
 * placeholders; nothing is cut inside a grapheme, a word or a protected span.
 * Read-only context comes only from the same snapshot (inside the editor).
 *
 * One segment is one sentence (or one line fragment): line breaks are always
 * segment boundaries, so no edit can add or remove one. Code, structure and
 * window edges split segments and are never sent; inline technical tokens and
 * short inline code become host-owned placeholders ("⟦1⟧", numbered per chunk).
 */
export function buildAiChunks(prepared: PreparedReview, options: AiChunkOptions): AiChunkPlan {
  const source = prepared.snapshot.text;
  const scope = prepared.snapshot.scope;
  const rewrite = options.mode === "rewrite";
  const segmentsPerChunk = rewrite ? MAX_AI_SEGMENTS : options.pairSentences === false ? 1 : 2;
  const chunkChars = options.maxChunkChars ?? (rewrite ? REWRITE_CHUNK_CHARS : CORRECT_CHUNK_CHARS);
  const totalChars = rewrite ? REWRITE_TOTAL_CHARS : CORRECT_TOTAL_CHARS;
  const skipped = { protected: 0, unsafe: 0, limit: 0 };

  const { blocking, placeholders } = classifyProtected(prepared);
  for (const range of blocking) {
    const overlap = Math.min(range.end, scope.end) - Math.max(range.start, scope.start);
    if (overlap <= 0) continue;
    if (range.reason === "outside-window") skipped.unsafe += overlap;
    else skipped.protected += overlap;
  }
  for (const range of placeholders) skipped.protected += range.end - range.start;

  // Cut words at the scope edges are not sent.
  let start = scope.start;
  let end = scope.end;
  if (cutsWord(source, start)) {
    while (start < end && (isWordAt(source, start) || !isGraphemeBoundary(source, start))) {
      start += 1;
    }
    skipped.unsafe += start - scope.start;
  }
  if (end > start && cutsWord(source, end)) {
    const before = end;
    while (end > start && (isWordAt(source, end - 1) || !isGraphemeBoundary(source, end))) {
      end -= 1;
    }
    skipped.unsafe += before - end;
  }

  const drafts: SegmentDraft[] = [];
  for (const run of proseRuns(source, start, end, blocking)) {
    const inside = placeholders.filter((range) => range.start >= run.start && range.end <= run.end);
    for (const sentence of sentences(source, run, inside)) {
      for (const piece of splitLong(source, sentence, inside, chunkChars)) {
        const pieceHolders = inside.filter(
          (range) => range.start >= piece.start && range.end <= piece.end,
        );
        const literal = literalText(source, piece, pieceHolders);
        if (PLACEHOLDER_BRACKET.test(literal)) {
          skipped.unsafe += piece.end - piece.start;
          continue;
        }
        // Nothing to proofread (numbers, symbols, placeholders only).
        if (!/\p{L}/u.test(literal)) continue;
        drafts.push({ range: piece, placeholders: pieceHolders });
      }
    }
  }

  const sendable = drafts.reduce((sum, draft) => sum + draftLength(draft), 0);
  // A rewrite is all or nothing: never a silently truncated proposal.
  if (
    rewrite &&
    (sendable > totalChars || drafts.some((draft) => draftLength(draft) > chunkChars))
  ) {
    skipped.limit += sendable;
    return { chunks: [], skipped };
  }

  const previousPairs = new Set(
    !rewrite && segmentsPerChunk === 2
      ? (options.previous?.chunks ?? [])
          .filter((chunk) => chunk.segments.length === 2)
          .map((chunk) =>
            JSON.stringify(
              chunk.segments.map((segment) =>
                options.previous!.text.slice(segment.range.start, segment.range.end),
              ),
            ),
          )
      : [],
  );
  const pairStarts = new Set<number>();
  if (previousPairs.size > 0) {
    for (let i = 0; i + 1 < drafts.length; i += 1) {
      const text = drafts
        .slice(i, i + 2)
        .map((draft) => source.slice(draft.range.start, draft.range.end));
      if (previousPairs.has(JSON.stringify(text))) pairStarts.add(i);
    }
  }

  const groups: SegmentDraft[][] = [];
  let group: SegmentDraft[] = [];
  let groupChars = 0;
  let sent = 0;
  for (const [index, draft] of drafts.entries()) {
    const length = draftLength(draft);
    if (length > chunkChars || sent + length > totalChars) {
      skipped.limit += length;
      continue;
    }
    if (
      group.length > 0 &&
      (groupChars + length > chunkChars ||
        group.length >= segmentsPerChunk ||
        (group.length === 1 && pairStarts.has(index) && !pairStarts.has(index - 1)))
    ) {
      groups.push(group);
      group = [];
      groupChars = 0;
    }
    group.push(draft);
    groupChars += length;
    sent += length;
  }
  if (group.length > 0) groups.push(group);

  // Preserve the evaluated 400-character greedy groups when applying the 200-character
  // pair cap. Repacking at the smaller cap shifted neighbours and missed article fixes.
  const boundedGroups = rewrite
    ? groups
    : groups.flatMap((members) =>
        members.length === 2 && members.reduce((sum, draft) => sum + draftLength(draft), 0) > 200
          ? members.map((draft) => [draft])
          : [members],
      );
  const chunks = boundedGroups.map((members) => {
    let counter = 0;
    const segments: AiSegment[] = members.map((draft, index) => {
      const holders: AiPlaceholder[] = draft.placeholders.map((range) => ({
        token: `⟦${(counter += 1)}⟧`,
        range: { start: range.start, end: range.end },
      }));
      return {
        id: `s${index}`,
        range: { ...draft.range },
        text: segmentText(source, draft.range, holders),
        placeholders: holders,
      };
    });
    const range = {
      start: segments[0].range.start,
      end: segments[segments.length - 1].range.end,
    };
    const contextBefore = readableContext(
      prepared,
      range.start - CONTEXT_CHARS,
      range.start,
      "before",
    );
    const contextAfter = readableContext(prepared, range.end, range.end + CONTEXT_CHARS, "after");
    return { segments, contextBefore, contextAfter, range };
  });
  return { chunks, skipped };
}

/**
 * Protected ranges split into boundaries (never sent) and inline placeholders.
 * Overlapping ranges merge; a placeholder candidate touching a boundary is part
 * of that boundary.
 */
function classifyProtected(prepared: PreparedReview): {
  blocking: ProtectedRange[];
  placeholders: TextRange[];
} {
  const source = prepared.snapshot.text;
  const { scope } = prepared.snapshot;
  const blocking: ProtectedRange[] = [];
  const candidates: TextRange[] = [];
  for (const range of prepared.protectedRanges) {
    if (range.end <= range.start) continue;
    const text = source.slice(range.start, range.end);
    if (range.reason === "technical") {
      if (!ABBREVIATION.test(text)) candidates.push(range);
    } else if (
      range.reason === "code" &&
      range.end - range.start <= MAX_INLINE_CODE_CHARS &&
      !/[\r\n\u2028\u2029]/.test(text)
    ) {
      candidates.push(range);
    } else {
      blocking.push(range);
    }
  }
  const placeholders: TextRange[] = [];
  for (const range of mergeRanges(candidates)) {
    const inScope = range.start >= scope.start && range.end <= scope.end;
    if (!inScope || blocking.some((block) => block.start < range.end && range.start < block.end)) {
      blocking.push({ ...range, reason: "technical" });
    } else {
      placeholders.push(range);
    }
  }
  blocking.sort((a, b) => a.start - b.start);
  return { blocking: mergeBlocking(blocking), placeholders };
}

function mergeRanges(ranges: TextRange[]): TextRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: TextRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ start: range.start, end: range.end });
  }
  return merged;
}

/** Overlapping boundaries merge (counted once); the first range's reason wins. */
function mergeBlocking(ranges: ProtectedRange[]): ProtectedRange[] {
  const merged: ProtectedRange[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start < last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

/** The UTF-16 unit at `index` belongs to a word character (either half of a pair counts). */
function isWordAt(source: string, index: number): boolean {
  const code = source.charCodeAt(index);
  const start = code >= 0xdc00 && code <= 0xdfff && index > 0 ? index - 1 : index;
  return WORD_CHAR.test(String.fromCodePoint(source.codePointAt(start) ?? 0));
}

/** True when `index` splits a word (or a grapheme) of `source`. */
function cutsWord(source: string, index: number): boolean {
  if (index <= 0 || index >= source.length) return false;
  if (!isGraphemeBoundary(source, index)) return true;
  return isWordAt(source, index - 1) && isWordAt(source, index);
}

/** Stretches of [start, end) between boundaries and line breaks, trimmed of whitespace. */
function proseRuns(
  source: string,
  start: number,
  end: number,
  blocking: readonly ProtectedRange[],
): TextRange[] {
  const cuts: TextRange[] = [...blocking];
  LINE_BREAK.lastIndex = start;
  for (
    let match = LINE_BREAK.exec(source);
    match && match.index < end;
    match = LINE_BREAK.exec(source)
  ) {
    cuts.push({ start: match.index, end: match.index + match[0].length });
  }
  cuts.sort((a, b) => a.start - b.start);
  const runs: TextRange[] = [];
  let cursor = start;
  const push = (from: number, to: number) => {
    while (from < to && /\s/.test(source[from])) from += 1;
    while (to > from && /\s/.test(source[to - 1])) to -= 1;
    if (to > from) runs.push({ start: from, end: to });
  };
  for (const cut of cuts) {
    if (cut.end <= cursor) continue;
    if (cut.start >= end) break;
    push(cursor, Math.min(cut.start, end));
    cursor = Math.max(cursor, cut.end);
  }
  push(cursor, end);
  return runs;
}

/** Sentences of one run. Placeholders never end a sentence. */
function sentences(source: string, run: TextRange, holders: readonly TextRange[]): TextRange[] {
  let view = source.slice(run.start, run.end);
  for (const holder of holders) {
    const from = holder.start - run.start;
    view = `${view.slice(0, from)}${"x".repeat(holder.end - holder.start)}${view.slice(holder.end - run.start)}`;
  }
  const result: TextRange[] = [];
  let from = 0;
  SENTENCE_END.lastIndex = 0;
  for (let match = SENTENCE_END.exec(view); match; match = SENTENCE_END.exec(view)) {
    const endAt = match.index + match[0].length;
    const next = view.slice(endAt).search(/\S/) + endAt;
    const word = view.slice(from, match.index).match(/(\p{L}+)$/u)?.[1] ?? "";
    const abbreviation =
      match[0][0] === "." && (NO_SPLIT_AFTER.has(word.toLowerCase()) || /^\p{Lu}$/u.test(word));
    if (abbreviation || /[\p{Ll}\p{N}]/u.test(view[next])) continue;
    result.push({ start: run.start + from, end: run.start + endAt });
    from = next;
  }
  result.push({ start: run.start + from, end: run.end });
  return result;
}

/** Splits a sentence longer than `max` at spaces outside placeholders (never inside a word). */
function splitLong(
  source: string,
  sentence: TextRange,
  holders: readonly TextRange[],
  max: number,
): TextRange[] {
  const pieces: TextRange[] = [];
  let from = sentence.start;
  while (sentence.end - from > max) {
    let cut = -1;
    for (let index = from + max; index > from; index -= 1) {
      if (/\s/.test(source[index]) && !holders.some((h) => h.start < index && index < h.end)) {
        cut = index;
        break;
      }
    }
    // One unbreakable run longer than a chunk: pass it on; the size check skips it.
    if (cut < 0) break;
    let next = cut;
    while (next < sentence.end && /\s/.test(source[next])) next += 1;
    while (cut > from && /\s/.test(source[cut - 1])) cut -= 1;
    pieces.push({ start: from, end: cut });
    from = next;
  }
  pieces.push({ start: from, end: sentence.end });
  return pieces;
}

/** Segment text with placeholder ranges removed (for checks before tokens exist). */
function literalText(source: string, range: TextRange, holders: readonly TextRange[]): string {
  const parts: string[] = [];
  let cursor = range.start;
  for (const holder of holders) {
    parts.push(source.slice(cursor, holder.start), " ");
    cursor = holder.end;
  }
  parts.push(source.slice(cursor, range.end));
  return parts.join("");
}

function segmentText(source: string, range: TextRange, holders: readonly AiPlaceholder[]): string {
  const parts: string[] = [];
  let cursor = range.start;
  for (const holder of holders) {
    parts.push(source.slice(cursor, holder.range.start), holder.token);
    cursor = holder.range.end;
  }
  parts.push(source.slice(cursor, range.end));
  return parts.join("");
}

/** Characters a draft costs in a request (placeholders count as a short token). */
function draftLength(draft: SegmentDraft): number {
  const hidden = draft.placeholders.reduce((sum, range) => sum + range.end - range.start, 0);
  return draft.range.end - draft.range.start - hidden + draft.placeholders.length * 4;
}

/**
 * Bounded read-only prose from the snapshot next to a chunk: trimmed to whole
 * sentences (or at least whole words), protected text shown as "…".
 */
function readableContext(
  prepared: PreparedReview,
  from: number,
  to: number,
  side: "before" | "after",
): string {
  const source = prepared.snapshot.text;
  from = Math.max(0, from);
  to = Math.min(source.length, to);
  if (to <= from) return "";
  const window = source.slice(from, to);
  if (side === "before" && from > 0) {
    const boundary = /[.!?…]["'”’»)\]]*\s|[\n\r]/u.exec(window) ?? /\s/.exec(window);
    if (!boundary) return "";
    from += boundary.index + boundary[0].length;
  } else if (side === "after" && to < source.length) {
    let cut = -1;
    for (const match of window.matchAll(/[.!?…]["'”’»)\]]*(?=\s)|(?=[\n\r])/gu)) {
      cut = match.index + match[0].length;
    }
    if (cut <= 0) cut = window.search(/\s\S*$/);
    if (cut <= 0) return "";
    to = from + cut;
  }
  const parts: string[] = [];
  let cursor = from;
  for (const range of prepared.protectedRanges) {
    if (range.end <= cursor || range.start >= to) continue;
    if (range.reason === "technical" && ABBREVIATION.test(source.slice(range.start, range.end))) {
      continue;
    }
    parts.push(source.slice(cursor, Math.max(cursor, range.start)), "…");
    cursor = Math.max(cursor, range.end);
  }
  if (cursor < to) parts.push(source.slice(cursor, to));
  return parts
    .join("")
    .replace(/\r\n?/g, "\n")
    .replace(/…(?:\s*…)+/g, "…")
    .trim();
}

/** Deterministic 53-bit string hash (cyrb53), base 36. Session-local keys and ids only. */
export function hashText(value: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** The wire request for one chunk: text only, no offsets. */
export function aiRequestForChunk(
  chunk: AiChunk,
  lang: string,
  mode: ReviewAiMode,
  style: ConcreteRewriteStyle | null,
): AiGenerationRequest {
  return {
    mode,
    lang,
    style: mode === "rewrite" ? style : null,
    contextBefore: chunk.contextBefore,
    contextAfter: chunk.contextAfter,
    segments: chunk.segments.map((segment) => ({ id: segment.id, text: segment.text })),
  };
}
