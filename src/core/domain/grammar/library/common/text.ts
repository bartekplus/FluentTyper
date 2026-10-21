// The rule library (library.ts): clause and sentence bounds of the text.

const isBlank = (code: number) => code === 32 || code === 9 || code === 0xa0;

/**
 * The subject opens its clause, so no noun-clause opener owns it ("What it was took…"): only
 * spaces from the text start (in 96 characters), or a clause mark and at most 8 spaces before it.
 * A backward read: a regex anchored at the end of the slice tries each start in it.
 */
export function atClauseStart(text: string, index: number): boolean {
  const low = Math.max(0, index - 96);
  let i = index;
  while (i > low && isBlank(text.charCodeAt(i - 1))) i--;
  if (i === low) return index <= 96;
  return index - i <= 8 && '.!?;:\n"“'.includes(text[i - 1]);
}
