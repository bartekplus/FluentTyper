import type { GrammarContext } from "../../types";

const SPACE_CHARS = [" ", "\xA0"];
const URL_OR_SCHEME_REGEX = /(https?:\/\/|www\.|mailto:)/i;
const EMAIL_LIKE_REGEX = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const CODE_TOKEN_REGEX = /[\\/_=<>`$]|::|->|=>|[\p{L}\p{N}_]\.[\p{L}\p{N}_]/u;

export function isDeleteInputAction(context: GrammarContext): boolean {
  return resolveInputAction(context) === "delete";
}

export function resolveInputAction(context: GrammarContext): "insert" | "delete" | "other" | null {
  const action = context.hints?.inputAction;
  if (action === "insert" || action === "delete" || action === "other") {
    return action;
  }
  return null;
}

export function splitTrailingSpaces(
  input: string,
  spaceChars: readonly string[] = SPACE_CHARS,
): { core: string; trailingSpaces: string } {
  let idx = input.length;
  while (idx > 0 && spaceChars.includes(input.charAt(idx - 1))) {
    idx -= 1;
  }
  return {
    core: input.slice(0, idx),
    trailingSpaces: input.slice(idx),
  };
}

export function getLastToken(input: string): string {
  const trimmed = input.trimEnd();
  if (!trimmed) {
    return "";
  }
  const parts = trimmed.split(/\s+/);
  return parts[parts.length - 1] ?? "";
}

function isLikelyUrlOrEmailContext(input: string): boolean {
  const trimmed = input.trimEnd();
  if (!trimmed) {
    return false;
  }
  return URL_OR_SCHEME_REGEX.test(trimmed) || EMAIL_LIKE_REGEX.test(trimmed);
}

/**
 * True when `token` may carry syntax: a dotted identifier ("user.save",
 * "node.js"), a path, a mention or tag, a URL or an address. Rules that would
 * insert a space, change case or drop punctuation inside it must leave it alone.
 */
export function isTechnicalToken(token: string): boolean {
  return (
    /^[@#]/.test(token) ||
    URL_OR_SCHEME_REGEX.test(token) ||
    EMAIL_LIKE_REGEX.test(token) ||
    CODE_TOKEN_REGEX.test(token)
  );
}

export function shouldSkipGenericReplacement(input: string): boolean {
  return isLikelyUrlOrEmailContext(input) || isTechnicalToken(getLastToken(input));
}

export function detectWordCase(word: string): "upper" | "title" | "lower" {
  if (!word) {
    return "lower";
  }
  if (word.toUpperCase() === word) {
    return "upper";
  }
  if (word[0].toUpperCase() === word[0] && word.slice(1).toLowerCase() === word.slice(1)) {
    return "title";
  }
  return "lower";
}

export function applyWordCase(word: string, style: "upper" | "title" | "lower"): string {
  if (style === "upper") {
    return word.toUpperCase();
  }
  if (style === "title") {
    return `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`;
  }
  return word.toLowerCase();
}

export function isLowercaseLetter(ch: string): boolean {
  return ch.toLowerCase() !== ch.toUpperCase() && ch === ch.toLowerCase();
}

export function normalizeWordSet(entries: readonly string[]): Set<string> {
  return new Set(entries.map((entry) => entry.trim().toLowerCase()).filter(Boolean));
}

export function isLikelyApostropheContext(inputBeforeQuote: string): boolean {
  if (inputBeforeQuote.length === 0) {
    return false;
  }
  const prev = inputBeforeQuote.charAt(inputBeforeQuote.length - 1);
  return /[\p{L}\p{N}]/u.test(prev);
}

export function shouldOpenQuote(inputBeforeQuote: string): boolean {
  if (inputBeforeQuote.length === 0) {
    return true;
  }
  const prev = inputBeforeQuote.charAt(inputBeforeQuote.length - 1);
  return /[\s([{<]/.test(prev);
}
