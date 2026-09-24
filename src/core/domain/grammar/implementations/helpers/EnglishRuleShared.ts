import type { GrammarContext } from "../../types";
import { normalizeWordSet, resolveInputAction } from "./GenericRuleShared";

const TRAILING_DELIMITER_REGEX = /[\s.,!?;:)\]"}]/;
const LETTER_REGEX = /[A-Za-z]/;

export interface EnglishBoundaryContext {
  input: string;
  core: string;
  trailing: string;
}

interface TrailingTokenInfo {
  core: string;
  trailing: string;
  token: string;
  tokenStart: number;
  tokenEnd: number;
}

function isEnglishLanguageContext(context: GrammarContext): boolean {
  return context.hints?.lang === "en_US";
}

function splitTrailingDelimiters(input: string): { core: string; trailing: string } {
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

/**
 * True when the token is glued to a mention, path, file or dotted name
 * ("@i", "src/dont", "my_file", "i.e"): changing it would break that name.
 */
export function isPartOfTechnicalToken(
  core: string,
  tokenStart: number,
  tokenEnd: number,
): boolean {
  const before = tokenStart > 0 ? core[tokenStart - 1] : "";
  const after = tokenEnd < core.length ? core[tokenEnd] : "";
  return ["@", "/", "\\", "_", "."].some((ch) => before === ch || after === ch);
}

/**
 * Boundary context + trailing `regex` match on its core, rejected when the
 * matched phrase is part of a technical token.
 */
export function matchTrailingEnglishPhrase(
  context: GrammarContext,
  regex: RegExp,
): { boundary: EnglishBoundaryContext; match: RegExpMatchArray; phraseStart: number } | null {
  const boundary = resolveEnglishBoundaryContext(context);
  if (!boundary) {
    return null;
  }
  const match = boundary.core.match(regex);
  if (!match) {
    return null;
  }
  const phraseStart = boundary.core.length - match[0].length;
  if (isPartOfTechnicalToken(boundary.core, phraseStart, boundary.core.length)) {
    return null;
  }
  return { boundary, match, phraseStart };
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
