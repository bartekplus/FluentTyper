// The named Review detectors of grammar/rules/pl.yaml; the rule file sets their checks,
// languages and order.
import { mergePredicates, type Fixer, type FindingsFilter } from "../../engine/reviewRules";
import * as agreement from "./agreement";
import * as casing from "./casing";
import * as clauses from "./clauses";
import * as commaFrames from "./commaFrames";
import * as commas from "./commas";
import * as compounds from "./compounds";
import * as confusions from "./confusions";
import * as conjunctions from "./conjunctions";
import * as dates from "./dates";
import * as degree from "./degree";
import * as forms from "./forms";
import * as fragments from "./fragments";
import * as numbers from "./numbers";
import * as officialese from "./officialese";
import * as prepositions from "./prepositions";
import * as questions from "./questions";
import * as style from "./style";
import * as subjects from "./subjects";
import * as typography from "./typography";
import * as typos from "./typos";

export const PREDICATES = mergePredicates(
  agreement.PREDICATES,
  clauses.PREDICATES,
  compounds.PREDICATES,
  confusions.PREDICATES,
  conjunctions.PREDICATES,
  dates.PREDICATES,
  degree.PREDICATES,
  forms.PREDICATES,
  fragments.PREDICATES,
  prepositions.PREDICATES,
  questions.PREDICATES,
  subjects.PREDICATES,
  typography.PREDICATES,
);

/** The named frame fixes of grammar/rules/pl.yaml (`fixer:`). */
export const FIXERS = mergePredicates<Fixer>(
  agreement.FIXERS,
  casing.FIXERS,
  commaFrames.FIXERS,
  commas.FIXERS,
  compounds.FIXERS,
  confusions.FIXERS,
  dates.FIXERS,
  forms.FIXERS,
  numbers.FIXERS,
  officialese.FIXERS,
  style.FIXERS,
  typography.FIXERS,
  subjects.FIXERS,
  typos.FIXERS,
);

/** The named findings filters of grammar/rules/pl.yaml (`filter:`). */
export const FILTERS = mergePredicates<FindingsFilter>();
