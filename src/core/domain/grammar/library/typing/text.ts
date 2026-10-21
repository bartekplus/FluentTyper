// The rule library (library.ts): generic text scans and the edit of a typing rule.
import type { GrammarEdit } from "../../types";

/** An edit that replaces the `deleteBackwards` characters before the cursor with `replacement`. */
export function typingEdit(
  replacement: string,
  deleteBackwards: number,
  deleteForwards = 0,
): GrammarEdit {
  return { replacement, deleteBackwards, deleteForwards };
}

/**
 * `regex` (with the g flag) run from index `from` of `text`. Its lookbehinds still read the text
 * before `from`.
 */
export function execFrom(regex: RegExp, text: string, from: number): RegExpExecArray | null {
  regex.lastIndex = Math.max(0, from);
  return regex.exec(text);
}

/** The start of the run of characters that `chars` matches (each one) and that ends at `end`. */
export function runStart(text: string, end: number, chars: RegExp): number {
  let start = end;
  while (start > 0 && chars.test(text[start - 1])) start -= 1;
  return start;
}

/**
 * The text that `memo` holds for `key`. The entry stays only while `text` is that text: other
 * text removes it. The old text is given back in both cases.
 */
export function readMemo<K extends object>(
  memo: WeakMap<K, string>,
  key: K,
  text: string,
): string | undefined {
  const value = memo.get(key);
  if (value !== text) memo.delete(key);
  return value;
}

/** Keeps `value` for `key` in `memo` (when it is not undefined) and gives back `result`. */
export function storeMemo<K extends object, V, R>(
  memo: WeakMap<K, V>,
  key: K,
  value: V | undefined,
  result: R,
): R {
  if (value !== undefined) memo.set(key, value);
  return result;
}

/**
 * The index of the `open` bracket that the `close` bracket at `closeIndex` pairs with (nested
 * pairs count), or null when no bracket opens it.
 */
export function matchingOpenIndex(
  text: string,
  closeIndex: number,
  open: string,
  close: string,
): number | null {
  let depth = 0;
  for (let i = closeIndex; i >= 0; i -= 1) {
    if (text[i] === close) depth += 1;
    else if (text[i] === open) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return null;
}
