// The rule library (library.ts): German word helpers.

const SPACE_BEFORE = " \t\u00a0";
const WORD_CHAR = /^[\p{L}\p{N}]$/u;

/**
 * The word of letters and digits right before `index`, and where it starts, when only spaces
 * come between (spaces, tabs or no-break spaces), read back over the 64 characters before
 * `index`.
 */
export function deWordBefore(text: string, index: number): { word: string; start: number } | null {
  const low = Math.max(0, index - 64);
  let at = index;
  while (at > low && SPACE_BEFORE.includes(text[at - 1])) at--;
  const end = at;
  if (end === index) return null;
  while (at > low) {
    // A surrogate pair is one character, unless the window cuts it.
    const pair = at - 2 >= low && /^[\ud800-\udbff][\udc00-\udfff]$/.test(text.slice(at - 2, at));
    const from = pair ? at - 2 : at - 1;
    if (!WORD_CHAR.test(text.slice(from, at))) break;
    at = from;
  }
  return at === end ? null : { word: text.slice(at, end), start: at };
}
