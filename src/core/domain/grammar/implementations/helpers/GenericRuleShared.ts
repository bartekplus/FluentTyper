import { SPACE_CHARS } from "../../../spacingRules";

const URL_OR_SCHEME_REGEX = /(https?:\/\/|www\.|mailto:)/i;
const EMAIL_LIKE_REGEX = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const TECHNICAL_TOKEN_REGEX = /[\\/_]|[\p{L}\p{N}_]\.[\p{L}\p{N}_]/u;

/** Index of the last character before `end` that is not one of `spaceChars` (-1: none). */
export function lastNonSpaceBefore(
  input: string,
  end: number,
  spaceChars: readonly string[] = SPACE_CHARS,
): number {
  let i = end - 1;
  while (i >= 0 && spaceChars.includes(input[i])) i -= 1;
  return i;
}

export function splitTrailingSpaces(
  input: string,
  spaceChars: readonly string[] = SPACE_CHARS,
): { core: string; trailingSpaces: string } {
  const idx = lastNonSpaceBefore(input, input.length, spaceChars) + 1;
  return {
    core: input.slice(0, idx),
    trailingSpaces: input.slice(idx),
  };
}

export function getLastToken(input: string): string {
  return input.trimEnd().split(/\s+/).at(-1) ?? "";
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
    TECHNICAL_TOKEN_REGEX.test(token)
  );
}

export function shouldSkipGenericReplacement(input: string): boolean {
  return (
    URL_OR_SCHEME_REGEX.test(input) ||
    EMAIL_LIKE_REGEX.test(input) ||
    isTechnicalToken(getLastToken(input))
  );
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

/**
 * `replacement` in the case of `typed`. All capitals when `typed` is all capitals
 * (2 or more characters). Else a capital first character when `typed` starts with one.
 * `letters`: read only the letters of `typed`, and capitalize the first letter of
 * `replacement`.
 */
export function carryCase(typed: string, replacement: string, letters = false): string {
  const shape = letters ? typed.replace(/\P{L}/gu, "") : typed;
  if (shape.length > 1 && detectWordCase(shape) === "upper") return replacement.toUpperCase();
  if (letters)
    return /^\P{L}*\p{Lu}/u.test(typed)
      ? replacement.replace(/\p{L}/u, (letter) => letter.toUpperCase())
      : replacement;
  return /^\p{Lu}/u.test(typed)
    ? replacement.charAt(0).toUpperCase() + replacement.slice(1)
    : replacement;
}

export function isLowercaseLetter(ch: string): boolean {
  return ch.toLowerCase() !== ch.toUpperCase() && ch === ch.toLowerCase();
}

/** `read` with a cache of its answers. The cache empties when it holds `max` keys. */
export function memoize<T>(read: (key: string) => T, max: number): (key: string) => T {
  const answers = new Map<string, T>();
  return (key) => {
    if (answers.has(key)) return answers.get(key) as T;
    if (answers.size >= max) answers.clear();
    const answer = read(key);
    answers.set(key, answer);
    return answer;
  };
}

export function normalizeWordSet(entries: readonly string[]): Set<string> {
  return new Set(entries.map((entry) => entry.trim().toLowerCase()).filter(Boolean));
}

/** The words of a list separated by spaces or line breaks. */
export const wordSet = (list: string) => new Set(list.trim().split(/\s+/));

/** Lowercase, with ’ changed to '. */
export const wordKey = (word: string) => word.toLowerCase().replace(/’/g, "'");

/** True when `ch` is a letter or a digit. */
export const isWordChar = (ch: string) => /[\p{L}\p{N}]/u.test(ch);
