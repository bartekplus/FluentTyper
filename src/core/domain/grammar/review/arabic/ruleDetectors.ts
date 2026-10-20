// The named Review detectors of grammar/rules/ar_SA.yaml; the rule file sets their checks,
// languages and order.
import { mergePredicates, type Fixer, type FindingsFilter } from "../../engine/reviewRules";
import { FILTERS as CHECK_FILTERS, FIXERS as CHECK_FIXERS, PREDICATES as CHECKS } from "./checks";
import { FILTERS as DATE_FILTERS, FIXERS as DATE_FIXERS } from "./dates";

export const PREDICATES = mergePredicates(CHECKS);

/** The named frame fixes of grammar/rules/ar_SA.yaml (`fixer:`). */
export const FIXERS = mergePredicates<Fixer>(CHECK_FIXERS, DATE_FIXERS);

/** The named findings filters of grammar/rules/ar_SA.yaml (`filter:`). */
export const FILTERS = mergePredicates<FindingsFilter>(CHECK_FILTERS, DATE_FILTERS);
