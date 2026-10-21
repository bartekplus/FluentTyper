// The English phrase tables: the `tables:` section of grammar/rules/en.yaml.
import { TABLES } from "../../engine/review.generated";
import type { PhraseRow } from "../englishPhraseTables";

/** The rows of en.yaml table `name`; a missing table is an error at load. */
export function table(name: string): readonly PhraseRow[] {
  const rows = TABLES[`en.${name}`];
  if (!rows) throw new Error(`grammar/rules/en.yaml has no table "${name}"`);
  return rows;
}

// The "<module>.<kind>" tables of one kind, in rule-file order.
const moduleTables = (kind: string): PhraseRow[] =>
  Object.entries(TABLES).flatMap(([name, rows]) =>
    name.startsWith("en.") && name.split(".").length === 3 && name.endsWith(`.${kind}`) ? rows : [],
  );
export const EXTENSION_PHRASES = moduleTables("phrases");
export const EXTENSION_COMPOUNDS = moduleTables("compounds");
export const EXTENSION_STYLE = moduleTables("style");
