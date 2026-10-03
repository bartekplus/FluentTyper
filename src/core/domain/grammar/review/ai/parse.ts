import { isObjectRecord } from "../../../guards";
import {
  REWRITE_STYLES,
  type AiGenerationOutcome,
  type AiGenerationRequest,
  type ConcreteRewriteStyle,
} from "./types";

/** Hard cap on raw model output accepted for parsing (UTF-16 units). */
export const MAX_AI_RAW_OUTPUT_CHARS = 32_000;
/** Segments per request. */
export const MAX_AI_SEGMENTS = 32;
/** Characters of one segment's text. */
const MAX_AI_SEGMENT_CHARS = 2_000;
/** Characters of all segment texts of one request. */
export const MAX_AI_REQUEST_TEXT_CHARS = 4_000;
/** Characters of each read-only context. */
export const MAX_AI_CONTEXT_CHARS = 1_000;

const SEGMENT_ID = /^s\d{1,3}$/;
const LANG = /^[a-z]{2,3}(?:[_-][A-Za-z0-9]{2,8})?$/;
const REQUEST_KEYS = ["contextAfter", "contextBefore", "lang", "mode", "segments", "style"];
const CONCRETE_STYLES: readonly string[] = REWRITE_STYLES.filter(
  (style) => style !== "context-aware",
);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return isObjectRecord(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value).sort();
  return own.length === keys.length && own.every((key, index) => key === keys[index]);
}

/**
 * Strict, bounded parse of raw model output against the request: JSON object
 * with exactly `segments`, each requested id exactly once in order, string
 * text only, no extra keys, no thinking markup. Anything else is `malformed`.
 *
 * Tolerated around the JSON: surrounding whitespace, one ```json fence and an
 * EMPTY leading <think></think> block (Qwen3 with thinking disabled).
 */
export function parseAiResponse(raw: string, request: AiGenerationRequest): AiGenerationOutcome {
  const malformed: AiGenerationOutcome = { ok: false, error: "malformed" };
  if (typeof raw !== "string" || raw.length > MAX_AI_RAW_OUTPUT_CHARS) return malformed;
  let body = raw.trim().replace(/^<think>\s*<\/think>\s*/, "");
  const fence = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n?```$/.exec(body);
  if (fence) body = fence[1].trim();
  if (!body.startsWith("{") || !body.endsWith("}")) return malformed;

  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return malformed;
  }
  if (!isPlainObject(value) || !hasExactKeys(value, ["segments"])) return malformed;
  const items = value.segments;
  if (!Array.isArray(items) || items.length !== request.segments.length) return malformed;

  const segments: Array<{ id: string; text: string }> = [];
  for (let index = 0; index < items.length; index += 1) {
    const item: unknown = items[index];
    const expected = request.segments[index];
    if (!isPlainObject(item) || !hasExactKeys(item, ["id", "text"])) return malformed;
    if (item.id !== expected.id || typeof item.text !== "string") return malformed;
    if (item.text.length > expected.text.length * 2 + 200) return malformed;
    segments.push({ id: expected.id, text: item.text });
  }
  return { ok: true, segments };
}

/**
 * Runtime validation of an untrusted request arriving over the transport
 * (types, sizes, ids, style/mode). Returns null when invalid.
 */
export function validateAiRequest(value: unknown): AiGenerationRequest | null {
  if (!isPlainObject(value) || !hasExactKeys(value, REQUEST_KEYS)) return null;
  const { mode, lang, style, contextBefore, contextAfter, segments } = value;
  if (mode !== "correct" && mode !== "rewrite") return null;
  if (mode === "correct" && style !== null) return null;
  if (mode === "rewrite" && (typeof style !== "string" || !CONCRETE_STYLES.includes(style))) {
    return null;
  }
  if (typeof lang !== "string" || !LANG.test(lang)) return null;
  for (const context of [contextBefore, contextAfter]) {
    if (typeof context !== "string" || context.length > MAX_AI_CONTEXT_CHARS) return null;
  }
  if (!Array.isArray(segments) || segments.length < 1 || segments.length > MAX_AI_SEGMENTS) {
    return null;
  }
  const ids = new Set<string>();
  let total = 0;
  const copy: Array<{ id: string; text: string }> = [];
  for (const segment of segments as unknown[]) {
    if (!isPlainObject(segment) || !hasExactKeys(segment, ["id", "text"])) return null;
    const { id, text } = segment;
    if (typeof id !== "string" || !SEGMENT_ID.test(id) || ids.has(id)) return null;
    if (typeof text !== "string" || text.length === 0 || text.length > MAX_AI_SEGMENT_CHARS) {
      return null;
    }
    ids.add(id);
    total += text.length;
    copy.push({ id, text });
  }
  if (total > MAX_AI_REQUEST_TEXT_CHARS) return null;
  return {
    mode,
    lang,
    style: mode === "rewrite" ? (style as ConcreteRewriteStyle) : null,
    contextBefore: contextBefore as string,
    contextAfter: contextAfter as string,
    segments: copy,
  };
}
