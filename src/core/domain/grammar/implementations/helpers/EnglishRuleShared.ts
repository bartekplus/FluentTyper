import type { GrammarContext } from "../../types";
import {
  normalizeWordSet as normalizeWordSetEntries,
  resolveInputAction as resolveGrammarInputAction,
} from "./GenericRuleShared";

const TRAILING_DELIMITER_REGEX = /[\s.,!?;:)\]"}]/;
const LETTER_REGEX = /[A-Za-z]/;
const CODE_CONTEXT_CHARS = new Set(["=", "(", "[", "{", ":", "+", "-", "*", "/", "%", "&", "|"]);

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

export { normalizeWordSetEntries as normalizeWordSet };

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
  // Returns only edit-worthy English word-boundary contexts and keeps the
  // original input plus the split core/trailing slices for rule-specific logic.
  if (!isEnglishLanguageContext(context)) {
    return null;
  }
  if (!options.ignoreDeleteInputAction && resolveGrammarInputAction(context) === "delete") {
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
    return CODE_CONTEXT_CHARS.has(ch);
  }
  return false;
}

export function applyCasePattern(inputWord: string, replacementWord: string): string {
  if (inputWord.toUpperCase() === inputWord) {
    return replacementWord.toUpperCase();
  }
  const isTitleCase =
    inputWord.length > 1 &&
    inputWord[0].toUpperCase() === inputWord[0] &&
    inputWord.slice(1).toLowerCase() === inputWord.slice(1);
  if (isTitleCase) {
    return replacementWord[0].toUpperCase() + replacementWord.slice(1).toLowerCase();
  }
  return replacementWord.toLowerCase();
}

export function resolveUserDictionarySet(
  context: GrammarContext,
  fallbackSet: Set<string>,
): Set<string> {
  const dictionary = context.hints?.userDictionary;
  if (!Array.isArray(dictionary)) {
    return fallbackSet;
  }
  return normalizeWordSetEntries(dictionary);
}
