// The named Review detectors of grammar/rules/el.yaml; the rule file sets their checks,
// languages and order.
import { mergePredicates } from "../../engine/reviewRules";
import { PREDICATES as CHECKS } from "./checks";

export const PREDICATES = mergePredicates(CHECKS);
