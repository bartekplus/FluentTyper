import type { GrammarContext } from "../../types";

const SPACE_REGEX = /[ \xA0]/;
const URL_OR_SCHEME_REGEX = /(https?:\/\/|www\.|mailto:)/i;
const EMAIL_LIKE_REGEX = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const CODE_TOKEN_REGEX = /[\\/_=<>`$]|::|->|=>|\w+\.\w+/;

export function isDeleteInputAction(context: GrammarContext): boolean {
  return context.hints?.inputAction === "delete";
}

export function splitTrailingSpaces(input: string): { core: string; trailingSpaces: string } {
  let idx = input.length;
  while (idx > 0 && SPACE_REGEX.test(input[idx - 1])) {
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

export function isLikelyUrlOrEmailContext(input: string): boolean {
  const trimmed = input.trimEnd();
  if (!trimmed) {
    return false;
  }
  return URL_OR_SCHEME_REGEX.test(trimmed) || EMAIL_LIKE_REGEX.test(trimmed);
}

export function isLikelyCodeLikeTokenContext(input: string): boolean {
  const token = getLastToken(input);
  if (!token) {
    return false;
  }
  return CODE_TOKEN_REGEX.test(token);
}

export function shouldSkipGenericReplacement(input: string): boolean {
  return isLikelyUrlOrEmailContext(input) || isLikelyCodeLikeTokenContext(input);
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
