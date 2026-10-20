// The named Review detectors of grammar/rules/pt_BR.yaml; the rule file sets their checks,
// languages and order.
import {
  mergePredicates,
  type AnyFixer,
  type Detector,
  type FindingsFilter,
} from "../../engine/reviewRules";
import { agreement } from "./agreement";
import { ao90 } from "./ao90";
import { cliticPlacement } from "./clitics";
import { commas, introductoryCommas } from "./commas";
import { confusions, FIXERS as CONFUSION_FIXERS } from "./confusions";
import { contractions } from "./contractions";
import { FIXERS as WORD_CHOICE_FIXERS } from "./wordChoice";
import { invalidDates } from "./dates";
import { formalVerbs } from "./formal";
import { FIXERS as INFINITIVE_FIXERS } from "./infinitives";
import { FIXERS as MARK_FIXERS } from "./marks";
import { nounAgreement } from "./nounAgreement";
import { FIXERS as NUMBER_START_FIXERS } from "./numbers";
import { accentParonyms } from "./paronyms";
import { personAgreement } from "./personAgreement";
import {
  fixedAgreements,
  passiveNumber,
  quantifiedAdjectives,
  relativeAgreement,
  subjectPredicates,
} from "./predicates";
import { FIXERS as VERB_FRAME_FIXERS } from "./style";
import { subjunctives } from "./subjunctive";
import {
  FIXERS as TYPOGRAPHY_FIXERS,
  FORMULA_FIXERS,
  NUMBER_FIXERS,
  rangeDash,
} from "./typography";
import { verbAgreement } from "./verbAgreement";

export const PREDICATES = {
  accentParonyms,
  confusions,
  contractions,
  rangeDash,
  cliticPlacement,
  ao90,
  invalidDates,
  commas,
  introductoryCommas,
  agreement,
  nounAgreement,
  verbAgreement,
  subjunctives,
  subjectPredicates,
  relativeAgreement,
  quantifiedAdjectives,
  fixedAgreements,
  passiveNumber,
  personAgreement,
  formalVerbs,
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
);

/** The named findings filters of grammar/rules/pt_BR.yaml (`filter:`). */
export const FILTERS = mergePredicates<FindingsFilter>();
