import type { GrammarContext } from "../../types";
import { normalizeWordSet, resolveInputAction } from "./GenericRuleShared";

const TRAILING_DELIMITER_REGEX = /[\s.,!?;:)\]"}]/;
const LETTER_REGEX = /[A-Za-z]/;
const OPENING_BRACKETS = new Set(["(", "[", "{"]);
const CODE_CONTEXT_CHARS = new Set(["=", "(", "[", "{", ":", "+", "-", "*", "/", "%", "&", "|"]);
const MARKDOWN_BULLET_MARKERS = new Set(["-", "*", "+"]);

export interface EnglishBoundaryContext {
  input: string;
  core: string;
  trailing: string;
}

export interface TrailingTokenInfo {
  core: string;
  trailing: string;
  token: string;
  tokenStart: number;
  tokenEnd: number;
}

export function isEnglishLanguageContext(context: GrammarContext): boolean {
  return context.hints?.lang === "en_US";
}

export function splitTrailingDelimiters(input: string): { core: string; trailing: string } {
  let coreEnd = input.length;
  while (coreEnd > 0 && TRAILING_DELIMITER_REGEX.test(input[coreEnd - 1])) {
    coreEnd -= 1;
  }
  return {
    core: input.slice(0, coreEnd),
    trailing: input.slice(coreEnd),
  };
}

export function resolveEnglishBoundaryContext(
  context: GrammarContext,
  options: { ignoreDeleteInputAction?: boolean } = {},
): EnglishBoundaryContext | null {
  if (!isEnglishLanguageContext(context)) {
    return null;
  }
  if (!options.ignoreDeleteInputAction && resolveInputAction(context) === "delete") {
    return null;
  }

  const input = context.beforeCursor;
  const { core, trailing } = splitTrailingDelimiters(input);
  if (trailing.length === 0) {
    return null;
  }

  return { input, core, trailing };
}

export function findTrailingLetterToken(input: string): TrailingTokenInfo | null {
  const { core, trailing } = splitTrailingDelimiters(input);
  if (core.length === 0) {
    return null;
  }

  const tokenEnd = core.length;
  let tokenStart = tokenEnd;
  while (tokenStart > 0 && LETTER_REGEX.test(core[tokenStart - 1])) {
    tokenStart -= 1;
  }

  if (tokenStart === tokenEnd) {
    return null;
  }

  return {
    core,
    trailing,
    token: core.slice(tokenStart, tokenEnd),
    tokenStart,
    tokenEnd,
  };
}

export function isLikelyCodeLikeContext(
  core: string,
  tokenStart: number,
  tokenEnd: number,
): boolean {
  const before = tokenStart > 0 ? core[tokenStart - 1] : "";
  const after = tokenEnd < core.length ? core[tokenEnd] : "";

  if (before === "@" || after === "@") {
    return true;
  }
  if (before === "/" || after === "/" || before === "\\" || after === "\\") {
    return true;
  }
  if (before === "_" || after === "_" || before === "." || after === ".") {
    return true;
  }

  for (let i = tokenStart - 1; i >= 0; i -= 1) {
    const ch = core[i];
    if (ch.trim().length === 0) {
      continue;
    }
    if (OPENING_BRACKETS.has(ch)) {
      // "I said (dont do it)" is prose in brackets; "call foo(dont)" is a call.
      // The space before the bracket is the whole difference, so do not trim it.
      return /[\p{L}\p{N}_]/u.test(core[i - 1] ?? "");
    }
    // A leading "- ", "* ", or "+ " with nothing but indentation before it on
    // the line is a Markdown bullet, not an operator: "- 3th item" is prose,
    // "x - 3th" and "a*3th" (something before the marker) are still code-like.
    if (MARKDOWN_BULLET_MARKERS.has(ch)) {
      const lineStart = core.lastIndexOf("\n", i - 1) + 1;
      if (/^[ \t]*$/.test(core.slice(lineStart, i))) {
        return false;
      }
    }
    return CODE_CONTEXT_CHARS.has(ch);
  }
  return false;
}

export function resolveUserDictionarySet(
  context: GrammarContext,
  fallbackSet: Set<string>,
): Set<string> {
  const dictionary = context.hints?.userDictionary;
  if (!Array.isArray(dictionary)) {
    return fallbackSet;
  }
  return normalizeWordSet(dictionary);
}
