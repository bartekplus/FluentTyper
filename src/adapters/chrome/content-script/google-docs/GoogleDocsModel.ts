import type { GrammarEdit } from "@core/domain/grammar/types";

export const DOCS_SESSION_ID = -1;
export const MAX_CONTEXT = 8192;
export const MAX_EDIT = 16384;
export const MAX_DOCUMENT = 2_000_000;
export const SNAPSHOT_LIFETIME_MS = 10000;
export const REQUEST_EVENT = "fluenttyper:gdocs:v2:request";
export const RESPONSE_EVENT = "fluenttyper:gdocs:v2:response";
export const KEY_EVENT = "fluenttyper:gdocs:v2:key";
export const KEY_STATE_ATTR = "data-ft-docs-key-state";
export const KEY_ACK_ATTR = "data-ft-docs-key-ack";
export const INPUT_FRAME_SELECTOR = "iframe.docs-texteventtarget-iframe";

export interface DocsModel {
  raw: string;
  text: string;
  offset: number;
  anchor: number;
  focus: number;
}
export interface DocsSnapshot {
  token: string;
  scope: string;
  text: string;
  windowStart: number;
  documentLength: number;
  anchor: number;
  focus: number;
}
export interface DocsEdit {
  start: number;
  end: number;
  replacement: string;
  cursorAfter: number;
}
export type DocsStatus =
  | "ready"
  | "applied"
  | "stale"
  | "inactive"
  | "unavailable"
  | "invalid"
  | "busy"
  | "composing"
  | "cancelled"
  | "unverified"
  | "unsupported-selection";
export interface DocsReply {
  status: DocsStatus;
  snapshot?: DocsSnapshot;
  operationId?: string;
  history?: "applied" | "undone";
}

/** Only top-level document edit URLs; per-site enable/disable still applies. */
export function isGoogleDocsURL(href: string): boolean {
  try {
    const url = new URL(href);
    return (
      url.origin === "https://docs.google.com" &&
      /^\/document\/(?:u\/\d+\/)?d\/[\w-]+\/edit\/?$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export function parseObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || value.length > 200000) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// Lazy: this module loads on every page, and Intl.Segmenter is missing in older Firefox.
let graphemeSegmenter: Intl.Segmenter | undefined;

export function isBoundary(text: string, index: number): boolean {
  if (!Number.isSafeInteger(index) || index < 0 || index > text.length) return false;
  if (index === 0 || index === text.length) return true;
  // Segment the local string, not a multi-megabyte document per boundary query.
  // Callers use the bounded context/range for editing, and full text only for selections.
  graphemeSegmenter ??= new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return graphemeSegmenter.segment(text).containing(index)?.index === index;
}

export function readModel(raw: unknown, selection: unknown): DocsModel | null {
  if (
    typeof raw !== "string" ||
    raw.length > MAX_DOCUMENT ||
    !Array.isArray(selection) ||
    selection.length !== 1 ||
    !selection[0] ||
    typeof selection[0] !== "object"
  )
    return null;
  const value = selection[0] as Record<string, unknown>;
  let endpoints: { anchor: number; focus: number } | null = null;
  for (const [a, b] of [
    ["anchor", "focus"],
    ["base", "extent"],
    ["start", "end"],
  ]) {
    if (!(a in value) && !(b in value)) continue;
    const anchor = value[a],
      focus = value[b];
    if (
      typeof anchor !== "number" ||
      typeof focus !== "number" ||
      !Number.isSafeInteger(anchor) ||
      !Number.isSafeInteger(focus)
    )
      return null;
    if (endpoints && (endpoints.anchor !== anchor || endpoints.focus !== focus)) return null;
    endpoints = { anchor, focus };
  }
  if (!endpoints) return null;
  const offset = raw.startsWith("\u0003") ? 1 : 0;
  const end = raw.length - (raw.endsWith("\n") ? 1 : 0);
  if (
    end < offset ||
    endpoints.anchor < offset ||
    endpoints.focus < offset ||
    endpoints.anchor > end ||
    endpoints.focus > end
  )
    return null;
  const text = raw.slice(offset, end);
  const anchor = endpoints.anchor - offset,
    focus = endpoints.focus - offset;
  if (!isBoundary(text, anchor) || !isBoundary(text, focus)) return null;
  return { raw, text, offset, anchor, focus };
}

export function sameModel(a: DocsModel, b: DocsModel): boolean {
  return a.raw === b.raw && a.anchor === b.anchor && a.focus === b.focus;
}

export function snapshotFor(model: DocsModel, scope: string, token: string): DocsSnapshot | null {
  const start = Math.min(model.anchor, model.focus),
    end = Math.max(model.anchor, model.focus);
  if (end - start > MAX_EDIT) return null;
  let windowStart = Math.max(0, start - MAX_CONTEXT);
  let windowEnd = Math.min(model.text.length, end + MAX_CONTEXT);
  while (!isBoundary(model.text, windowStart)) windowStart += 1;
  while (!isBoundary(model.text, windowEnd)) windowEnd -= 1;
  return {
    token,
    scope,
    text: model.text.slice(windowStart, windowEnd),
    windowStart,
    documentLength: model.text.length,
    anchor: model.anchor,
    focus: model.focus,
  };
}

export function snapshotContext(snapshot: DocsSnapshot) {
  const start = Math.min(snapshot.anchor, snapshot.focus) - snapshot.windowStart;
  const end = Math.max(snapshot.anchor, snapshot.focus) - snapshot.windowStart;
  return {
    beforeCursor: snapshot.text.slice(0, start),
    afterCursor: snapshot.text.slice(end),
    selectedText: snapshot.text.slice(start, end),
    start,
    end,
  };
}

export function sameSnapshot(a: DocsSnapshot, b: DocsSnapshot): boolean {
  return (
    a.scope === b.scope &&
    a.text === b.text &&
    a.windowStart === b.windowStart &&
    a.documentLength === b.documentLength &&
    a.anchor === b.anchor &&
    a.focus === b.focus
  );
}

export function validEdit(text: string, edit: DocsEdit): boolean {
  const { start, end, replacement, cursorAfter } = edit;
  if (
    typeof replacement !== "string" ||
    replacement.length > MAX_EDIT ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    end < start ||
    end - start > MAX_EDIT ||
    !isBoundary(text, start) ||
    !isBoundary(text, end)
  )
    return false;
  // Docs' structural markers are not ordinary text. Never replace across them.
  // eslint-disable-next-line no-control-regex -- Reject private editor structural controls.
  const protectedControls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffc]/u;
  if (protectedControls.test(replacement) || protectedControls.test(text.slice(start, end)))
    return false;
  const result = text.slice(0, start) + replacement + text.slice(end);
  // The caret may legitimately sit outside the replaced run: a correction replayed for
  // a character typed earlier in a burst must leave the caret where the user has since
  // got to, not drag it back into the edit. Range limits above are what bound the write;
  // this only has to be a position that exists in the result.
  return isBoundary(result, cursorAfter) && cursorAfter >= 0 && cursorAfter <= result.length;
}

/** Preserve unchanged prefix/suffix runs instead of rewriting a whole styled token. */
export function minimizeEdit(text: string, edit: DocsEdit): DocsEdit {
  const original = text.slice(edit.start, edit.end);
  let prefix = 0;
  while (
    prefix < original.length &&
    prefix < edit.replacement.length &&
    original[prefix] === edit.replacement[prefix]
  )
    prefix += 1;
  while (prefix > 0 && (!isBoundary(original, prefix) || !isBoundary(edit.replacement, prefix)))
    prefix -= 1;
  let suffix = 0;
  while (
    suffix < original.length - prefix &&
    suffix < edit.replacement.length - prefix &&
    original[original.length - suffix - 1] ===
      edit.replacement[edit.replacement.length - suffix - 1]
  )
    suffix += 1;
  while (
    suffix > 0 &&
    (!isBoundary(original, original.length - suffix) ||
      !isBoundary(edit.replacement, edit.replacement.length - suffix))
  )
    suffix -= 1;
  // The final caret can be outside the minimal changed range (e.g. spelling in mid-word).
  return {
    start: edit.start + prefix,
    end: edit.end - suffix,
    replacement: edit.replacement.slice(prefix, edit.replacement.length - suffix),
    cursorAfter: edit.cursorAfter,
  };
}

export function planCompletion(
  snapshot: DocsSnapshot,
  suggestion: string,
  findToken: (text: string) => { token: string; start: number },
  isSeparator: (char: string) => boolean,
  skipFollowingSpace = false,
): DocsEdit | null {
  const context = snapshotContext(snapshot);
  const token = findToken(context.beforeCursor);
  if (!context.selectedText && token.token && token.start === 0 && snapshot.windowStart > 0)
    return null;
  let start = context.selectedText ? context.start : token.start;
  let end = context.end;
  if (!context.selectedText) {
    // A next-word proposal inserts at the caret, never deletes the following word.
    if (token.token) {
      while (end < snapshot.text.length && !isSeparator(snapshot.text[end])) end += 1;
    }
    if (/[ \xa0]$/.test(suggestion) && /[ \xa0]/.test(snapshot.text[end] ?? "")) end += 1;
    // No space was appended because one already follows: land the caret after it.
    else if (skipFollowingSpace && /[ \xa0]/.test(snapshot.text[end] ?? "")) {
      suggestion += snapshot.text[end];
      end += 1;
    }
  }
  if (
    !context.selectedText &&
    token.token &&
    end === snapshot.text.length &&
    snapshot.windowStart + end < snapshot.documentLength
  )
    return null;
  start = Math.max(0, start);
  const local = { start, end, replacement: suggestion, cursorAfter: start + suggestion.length };
  if (!suggestion || !validEdit(snapshot.text, local)) return null;
  return {
    ...local,
    start: start + snapshot.windowStart,
    end: end + snapshot.windowStart,
    cursorAfter: local.cursorAfter + snapshot.windowStart,
  };
}

/**
 * `cursor` is where the rule was judged, which is the caret unless the edit is being
 * replayed for a character typed earlier in a burst. A replayed edit never reaches past
 * that point, and carries the caret along by the length it changed instead of claiming
 * the position the rule asked for: the user has already typed beyond it.
 */
export function planGrammar(
  snapshot: DocsSnapshot,
  edit: GrammarEdit,
  cursor: number = snapshot.anchor - snapshot.windowStart,
): DocsEdit | null {
  if (snapshot.anchor !== snapshot.focus) return null;
  const caret = snapshot.anchor - snapshot.windowStart;
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > caret) return null;
  const start = cursor - edit.deleteBackwards,
    end = cursor + edit.deleteForwards;
  const replayed = cursor !== caret;
  if (replayed && end > caret) return null;
  const local = {
    start,
    end,
    replacement: edit.replacement,
    cursorAfter: replayed
      ? caret + edit.replacement.length - (end - start)
      : start + (edit.cursorOffset ?? edit.replacement.length),
  };
  if (!validEdit(snapshot.text, local)) return null;
  return {
    ...local,
    start: start + snapshot.windowStart,
    end: end + snapshot.windowStart,
    cursorAfter: local.cursorAfter + snapshot.windowStart,
  };
}

export function snapshotFrom(value: unknown): DocsSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const s = value as Record<string, unknown>;
  if (
    typeof s.token !== "string" ||
    s.token.length > 100 ||
    typeof s.scope !== "string" ||
    s.scope.length > 4096 ||
    typeof s.text !== "string" ||
    s.text.length > MAX_CONTEXT * 2 + MAX_EDIT ||
    typeof s.documentLength !== "number" ||
    !Number.isSafeInteger(s.documentLength) ||
    s.documentLength < 0 ||
    s.documentLength > MAX_DOCUMENT ||
    typeof s.windowStart !== "number" ||
    !Number.isSafeInteger(s.windowStart) ||
    s.windowStart < 0 ||
    s.windowStart + s.text.length > s.documentLength ||
    typeof s.anchor !== "number" ||
    typeof s.focus !== "number" ||
    !isBoundary(s.text, s.anchor - s.windowStart) ||
    !isBoundary(s.text, s.focus - s.windowStart)
  )
    return null;
  return {
    token: s.token,
    scope: s.scope,
    text: s.text,
    windowStart: s.windowStart,
    documentLength: s.documentLength,
    anchor: s.anchor,
    focus: s.focus,
  };
}
