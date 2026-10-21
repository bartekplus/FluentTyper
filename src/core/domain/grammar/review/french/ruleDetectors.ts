// The named Review detectors of grammar/rules/fr.yaml; the rule file sets their checks,
// languages and order.
import { mergePredicates, type Fixer, type FindingsFilter } from "../../engine/reviewRules";
import * as adjectives from "./adjectives";
import * as agreement from "./agreement";
import * as mood from "./mood";
import * as smallWords from "./smallWords";
import * as style from "./style";
import * as tout from "./tout";
import * as verbForms from "./verbForms";

export const PREDICATES = mergePredicates();

/** The named frame fixes of grammar/rules/fr.yaml (`fixer:`). */
export const FIXERS = mergePredicates<Fixer>(
  adjectives.FIXERS,
  verbForms.FIXERS,
  agreement.FIXERS,
  style.FIXERS,
  tout.FIXERS,
  mood.FIXERS,
  smallWords.FIXERS,
);

/** The named findings filters of grammar/rules/fr.yaml (`filter:`). */
export const FILTERS = mergePredicates<FindingsFilter>();
