// The named Review detectors of grammar/rules/ar_SA.yaml; the rule file sets their checks,
// languages and order.
import { mergePredicates, type Fixer, type FindingsFilter } from "../../engine/reviewRules";
import { PREDICATES as CHECKS } from "./checks";

export const PREDICATES = mergePredicates(CHECKS);

/** The named frame fixes of grammar/rules/ar_SA.yaml (`fixer:`). */
export const FIXERS = mergePredicates<Fixer>();

/** The named findings filters of grammar/rules/ar_SA.yaml (`filter:`). */
export const FILTERS = mergePredicates<FindingsFilter>();
