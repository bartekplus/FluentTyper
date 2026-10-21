// The named Review detectors of grammar/rules/pt_BR.yaml; the rule file sets their checks,
// languages and order.
import {
  mergePredicates,
  type AnyFixer,
  type Detector,
  type FindingsFilter,
} from "../../engine/reviewRules";
import { FIXERS as AGREEMENT_FIXERS } from "./agreement";
import { FIXERS as NOUN_AGREEMENT_FIXERS } from "./nounAgreement";
import { FIXERS as PERSON_FIXERS } from "./personAgreement";
import { FIXERS as PREDICATE_FIXERS } from "./predicates";
import { FIXERS as SUBJUNCTIVE_FIXERS } from "./subjunctive";
import { FIXERS as VERB_AGREEMENT_FIXERS } from "./verbAgreement";

export const PREDICATES = {} satisfies Record<string, Detector>;

/** The named frame fixes of grammar/rules/pt_BR.yaml (`fixer:`). */
export const FIXERS = mergePredicates<AnyFixer>(
  PERSON_FIXERS,
  PREDICATE_FIXERS,
  SUBJUNCTIVE_FIXERS,
  AGREEMENT_FIXERS,
  VERB_AGREEMENT_FIXERS,
  NOUN_AGREEMENT_FIXERS,
);

/** The named findings filters of grammar/rules/pt_BR.yaml (`filter:`). */
export const FILTERS = {} satisfies Record<string, FindingsFilter>;
