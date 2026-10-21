// The named Review detectors of grammar/rules/el.yaml; the rule file sets their checks,
// languages and order.
import { mergePredicates, type Fixer, type FindingsFilter } from "../../engine/reviewRules";

export const PREDICATES = mergePredicates();

/** The named frame fixes of grammar/rules/el.yaml (`fixer:`). */
export const FIXERS = mergePredicates<Fixer>();

/** The named findings filters of grammar/rules/el.yaml (`filter:`). */
export const FILTERS = mergePredicates<FindingsFilter>();
