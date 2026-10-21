// The rule library (library/english.ts): the named phrase tables of en.yaml (`tables:`).
// Review gives them (review/english/tables.ts sets the reader): an import of the tables here
// would put them into each bundle that holds a typing rule (the content scripts).
import type { PhraseRow } from "../../review/englishPhraseTables";

type Reader = (name: string) => readonly PhraseRow[];
let read: Reader | undefined;

/** Sets the reader of `enTable`. */
export function useEnglishTables(reader: Reader): void {
  read = reader;
}

/** The rows of the en.yaml table `name` ("dialects.ise"). */
export function enTable(name: string): readonly PhraseRow[] {
  if (!read) throw new Error("enTable: Review did not set the English tables");
  return read(name);
}
