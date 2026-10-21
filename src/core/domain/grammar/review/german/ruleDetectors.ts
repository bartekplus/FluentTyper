// The named Review detectors of grammar/rules/de.yaml; the rule file sets their checks,
// languages and order.
import {
  mergePredicates,
  type Detector,
  type Fixer,
  type FindingsFilter,
} from "../../engine/reviewRules";
import * as commas from "./commas";
import * as numbers from "./numbers";

export const PREDICATES = mergePredicates<Detector>();

/** The named frame fixes of grammar/rules/de.yaml (`fixer:`). */
export const FIXERS = mergePredicates<Fixer>(
  numbers.FIXERS,
  commas.FIXERS,
);

/** The named findings filters of grammar/rules/de.yaml (`filter:`). */
export const FILTERS = mergePredicates<FindingsFilter>(
  commas.FILTERS,
);
