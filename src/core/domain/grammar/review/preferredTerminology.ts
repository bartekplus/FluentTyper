import { isObjectRecord } from "../../guards";
import { SUPPORTED_LANGUAGES, TEXT_EXPANDER_LANG } from "../../lang";

export const MAX_TERMINOLOGY_ENTRIES = 64;
export const MAX_TERMINOLOGY_IMPORT_BYTES = 65_536;

export interface PreferredTerm {
  id: string;
  source: string;
  replacement: string;
  casePolicy: "exact" | "insensitive";
  explanation: string;
  language: string;
  scope: "all-prose" | "selection";
  enabled: boolean;
}

export interface PreferredTerminology {
  version: 1;
  enabled: boolean;
  entries: PreferredTerm[];
}

export type TerminologyValidation =
  | { ok: true; value: PreferredTerminology }
  | { ok: false; error: "schema" | "limit" | "entry" | "duplicate" | "cycle"; index?: number };

export function emptyTerminology(): PreferredTerminology {
  return { version: 1, enabled: false, entries: [] };
}

const ENTRY_KEYS = [
  "id",
  "source",
  "replacement",
  "casePolicy",
  "explanation",
  "language",
  "scope",
  "enabled",
];
const WORD = /[\p{L}\p{M}\p{N}_]/u;

function boundedText(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    value === value.trim() &&
    value === value.normalize("NFC") &&
    !/[\p{C}\r\n\t]/u.test(value)
  );
}

// Conservative Unicode fold also unifies final sigma/long s for the insensitive matcher.
function foldCase(text: string): string {
  return text.toUpperCase().toLowerCase();
}

function includesPhrase(text: string, phrase: string): boolean {
  for (let at = text.indexOf(phrase); at >= 0; at = text.indexOf(phrase, at + 1)) {
    if (!WORD.test(text[at - 1] ?? "") && !WORD.test(text[at + phrase.length] ?? "")) return true;
  }
  return false;
}

/** Also catches transitions completed by untouched neighboring words: A -> B, B C -> A C. */
function canFeed(from: PreferredTerm, to: PreferredTerm): boolean {
  if (from.language !== to.language) return false;
  const fold = (text: string) => (to.casePolicy === "insensitive" ? foldCase(text) : text);
  const replacement = fold(from.replacement);
  const source = fold(to.source);
  // A self-contained case repair stabilizes at its literal preferred form.
  if (from.id === to.id && foldCase(from.source) === foldCase(from.replacement)) return false;
  if (includesPhrase(replacement, source) || includesPhrase(source, replacement)) return true;
  for (let length = 1; length < Math.min(source.length, replacement.length); length++) {
    if (
      replacement.endsWith(source.slice(0, length)) &&
      !WORD.test(source[length] ?? "") &&
      !WORD.test(replacement[replacement.length - length - 1] ?? "")
    )
      return true;
    if (
      replacement.startsWith(source.slice(-length)) &&
      !WORD.test(source[source.length - length - 1] ?? "") &&
      !WORD.test(replacement[length] ?? "")
    )
      return true;
  }
  return false;
}

/** Strict, bounded settings/import boundary. Never silently repair or partially import entries. */
export function validateTerminology(value: unknown): TerminologyValidation {
  if (
    !isObjectRecord(value) ||
    Object.keys(value).some((key) => !["version", "enabled", "entries"].includes(key)) ||
    value.version !== 1 ||
    typeof value.enabled !== "boolean" ||
    !Array.isArray(value.entries)
  )
    return { ok: false, error: "schema" };
  if (value.entries.length > MAX_TERMINOLOGY_ENTRIES) return { ok: false, error: "limit" };
  const entries: PreferredTerm[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < value.entries.length; index++) {
    const e: unknown = value.entries[index];
    if (
      !isObjectRecord(e) ||
      Object.keys(e).length !== ENTRY_KEYS.length ||
      Object.keys(e).some((key) => !ENTRY_KEYS.includes(key)) ||
      typeof e.id !== "string" ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(e.id) ||
      !boundedText(e.source, 80) ||
      !/[\p{L}\p{N}]/u.test(e.source) ||
      !boundedText(e.replacement, 120) ||
      e.source === e.replacement ||
      !boundedText(e.explanation, 240) ||
      (e.casePolicy !== "exact" && e.casePolicy !== "insensitive") ||
      typeof e.language !== "string" ||
      !Object.hasOwn(SUPPORTED_LANGUAGES, e.language) ||
      e.language === "auto_detect" ||
      e.language === TEXT_EXPANDER_LANG ||
      (e.scope !== "all-prose" && e.scope !== "selection") ||
      typeof e.enabled !== "boolean"
    )
      return { ok: false, error: "entry", index };
    const entry = e as unknown as PreferredTerm;
    if (
      ids.has(entry.id) ||
      entries.some(
        (other) =>
          other.language === entry.language &&
          (other.casePolicy === "insensitive" || entry.casePolicy === "insensitive"
            ? foldCase(other.source) === foldCase(entry.source)
            : other.source === entry.source),
      )
    )
      return { ok: false, error: "duplicate", index };
    ids.add(entry.id);
    entries.push({ ...entry });
  }
  const visiting = new Set<number>();
  const done = new Set<number>();
  const visit = (index: number): boolean => {
    if (visiting.has(index)) return true;
    if (done.has(index)) return false;
    visiting.add(index);
    for (let next = 0; next < entries.length; next++) {
      if (canFeed(entries[index], entries[next]) && visit(next)) return true;
    }
    visiting.delete(index);
    done.add(index);
    return false;
  };
  if (entries.some((_, index) => visit(index))) return { ok: false, error: "cycle" };
  return { ok: true, value: { version: 1, enabled: value.enabled, entries } };
}

export function importTerminology(text: string): TerminologyValidation {
  if (
    text.length > MAX_TERMINOLOGY_IMPORT_BYTES ||
    new TextEncoder().encode(text).length > MAX_TERMINOLOGY_IMPORT_BYTES
  )
    return { ok: false, error: "limit" };
  try {
    return validateTerminology(JSON.parse(text));
  } catch {
    return { ok: false, error: "schema" };
  }
}
