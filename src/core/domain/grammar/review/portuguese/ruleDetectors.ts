// The named Review detectors of grammar/rules/pt_BR.yaml; the rule file sets their checks,
// languages and order.
import {
  mergePredicates,
  type AnyFixer,
  type Detector,
  type FindingsFilter,
} from "../../engine/reviewRules";
import { FIXERS as AGREEMENT_FIXERS } from "./agreement";
import { FIXERS as AO90_FIXERS } from "./ao90";
import { FILTERS as CLITIC_FILTERS, FIXERS as CLITIC_FIXERS } from "./clitics";
import { FIXERS as COMMA_FIXERS } from "./commas";
import { CRASE_FIXERS, FIXERS as CONFUSION_FIXERS } from "./confusions";
import { FIXERS as CONTRACTION_FIXERS } from "./contractions";
import { FIXERS as WORD_CHOICE_FIXERS } from "./wordChoice";
import { FIXERS as DATE_FIXERS, isoDates } from "./dates";
import { FIXERS as FORMAL_FIXERS } from "./formal";
import { FIXERS as INFINITIVE_FIXERS } from "./infinitives";
import { FIXERS as MARK_FIXERS } from "./marks";
import { nounAgreement } from "./nounAgreement";
import { FIXERS as NUMBER_START_FIXERS } from "./numbers";
import { FILTERS as PARONYM_FILTERS, FIXERS as PARONYM_FIXERS } from "./paronyms";
import { FIXERS as PERSON_FIXERS } from "./personAgreement";
import { FIXERS as PREDICATE_FIXERS } from "./predicates";
import { FIXERS as VERB_FRAME_FIXERS } from "./style";
import { FIXERS as SUBJUNCTIVE_FIXERS } from "./subjunctive";
import {
  FIXERS as TYPOGRAPHY_FIXERS,
  FORMULA_FIXERS,
  NUMBER_FIXERS,
  rangeDash,
} from "./typography";
import { FIXERS as VERB_AGREEMENT_FIXERS } from "./verbAgreement";

export const PREDICATES = {
  rangeDash,
  isoDates,
  nounAgreement,
} satisfies Record<string, Detector>;

/** The named frame fixes of grammar/rules/pt_BR.yaml (`fixer:`). */
export const FIXERS = mergePredicates<AnyFixer>(
  CONFUSION_FIXERS,
  WORD_CHOICE_FIXERS,
  NUMBER_FIXERS,
  TYPOGRAPHY_FIXERS,
  INFINITIVE_FIXERS,
  MARK_FIXERS,
  NUMBER_START_FIXERS,
  FORMULA_FIXERS,
  VERB_FRAME_FIXERS,
  AO90_FIXERS,
  DATE_FIXERS,
  CONTRACTION_FIXERS,
  FORMAL_FIXERS,
  COMMA_FIXERS,
  CLITIC_FIXERS,
  PARONYM_FIXERS,
  CRASE_FIXERS,
  PERSON_FIXERS,
  PREDICATE_FIXERS,
  SUBJUNCTIVE_FIXERS,
  AGREEMENT_FIXERS,
  VERB_AGREEMENT_FIXERS,
);

/** The named findings filters of grammar/rules/pt_BR.yaml (`filter:`). */
export const FILTERS = mergePredicates<FindingsFilter>(CLITIC_FILTERS, PARONYM_FILTERS);
