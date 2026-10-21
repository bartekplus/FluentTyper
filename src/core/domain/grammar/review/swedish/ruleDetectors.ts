// The named Review detectors of grammar/rules/sv.yaml; the rule file sets their checks,
// languages and order.
import { mergePredicates, type Fixer, type FindingsFilter } from "../../engine/reviewRules";
import { FIXERS as CHECK_FIXERS } from "./checks";

export const PREDICATES = mergePredicates();

/** The named frame fixes of grammar/rules/sv.yaml (`fixer:`). */
export const FIXERS = mergePredicates<Fixer>(CHECK_FIXERS);

/** The named findings filters of grammar/rules/sv.yaml (`filter:`). */
export const FILTERS = mergePredicates<FindingsFilter>();
