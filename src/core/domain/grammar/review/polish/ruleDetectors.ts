// The named Review detectors of grammar/rules/pl.yaml; the rule file sets their checks,
// languages and order.
import { mergePredicates, type Fixer, type FindingsFilter } from "../../engine/reviewRules";
import * as agreement from "./agreement";
import * as clauses from "./clauses";
import * as commas from "./commas";
import * as style from "./style";
import * as subjects from "./subjects";
import * as typos from "./typos";

export const PREDICATES = mergePredicates();

/** The named frame fixes of grammar/rules/pl.yaml (`fixer:`). */
export const FIXERS = mergePredicates<Fixer>(
  agreement.FIXERS,
  clauses.FIXERS,
  commas.FIXERS,
  style.FIXERS,
  subjects.FIXERS,
  typos.FIXERS,
);

/** The named findings filters of grammar/rules/pl.yaml (`filter:`). */
export const FILTERS = mergePredicates<FindingsFilter>();
