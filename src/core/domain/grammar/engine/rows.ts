/** One phrase-table row: the typed form or forms, and the fix or the fixes to choose from. */
export type PhraseRow = readonly [string | readonly string[], string | readonly string[]];

/** Rows of a phrase table: "typed = fix", "a | b = fix", "typed = fix1; fix2"; "#" comments. */
export function parseRows(text: string, where: string, errors: string[]): PhraseRow[] {
  const rows: PhraseRow[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "" || line.startsWith("# ")) continue;
    const at = line.indexOf(" = ");
    if (at < 1) {
      errors.push(`${where}: row "${line}" has no " = "`);
      continue;
    }
    const typed = line.slice(0, at).split(" | ");
    const fix = line.slice(at + 3).split("; ");
    rows.push([typed.length > 1 ? typed : typed[0], fix.length > 1 ? fix : fix[0]]);
  }
  return rows;
}
