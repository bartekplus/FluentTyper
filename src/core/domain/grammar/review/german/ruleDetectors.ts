// The named Review detectors of grammar/rules/de.yaml; the rule file sets their checks,
// languages and order.
import {
  mergePredicates,
  type Detector,
  type Fixer,
  type FindingsFilter,
} from "../../engine/reviewRules";
import * as adjectiveForms from "./adjectiveForms";
import * as articleGender from "./articleGender";
import * as commas from "./commas";
import * as numbers from "./numbers";
import * as verbAgreement from "./verbAgreement";

export const PREDICATES = mergePredicates<Detector>();

/** The named frame fixes of grammar/rules/de.yaml (`fixer:`). */
export const FIXERS = mergePredicates<Fixer>(
  numbers.FIXERS,
  adjectiveForms.FIXERS,
  commas.FIXERS,
  verbAgreement.FIXERS,
  articleGender.FIXERS,
);

/** The named findings filters of grammar/rules/de.yaml (`filter:`). */
export const FILTERS = mergePredicates<FindingsFilter>(
  commas.FILTERS,
);
