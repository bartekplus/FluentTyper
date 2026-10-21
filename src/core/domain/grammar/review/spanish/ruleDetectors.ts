// The named Review detectors of grammar/rules/es.yaml; the rule file sets their checks,
// languages and order.
import { mergePredicates, type Fixer, type FindingsFilter } from "../../engine/reviewRules";
import * as agreement from "./agreement";
import * as verbAgreement from "./verbAgreement";

export const PREDICATES = mergePredicates();

/** The named frame fixes of grammar/rules/es.yaml (`fixer:`). */
export const FIXERS = mergePredicates<Fixer>(
  agreement.FIXERS,
  verbAgreement.FIXERS,
);

/** The named findings filters of grammar/rules/es.yaml (`filter:`). */
export const FILTERS = mergePredicates<FindingsFilter>(verbAgreement.FILTERS);
