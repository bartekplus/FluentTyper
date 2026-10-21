// The named Review detectors of grammar/rules/en.yaml; the rule file sets their checks,
// languages and order.
import { mergePredicates, type FindingsFilter, type Fixer } from "../../engine/reviewRules";
import * as apostrophes from "./apostrophes";
import * as compoundForms from "./compoundForms";
import * as properNames from "./properNames";
import * as plainStyle from "./plainStyle";
import * as punctuation from "./punctuation";
import * as articles from "./articles";
import * as slotConfusions from "./slotConfusions";
import * as typography from "./typography";
import * as confusions1 from "./confusions1";
import * as dates from "./dates";
import * as contractionSlots from "./contractionSlots";
import * as nounNumberSlots from "./nounNumberSlots";
import * as verbGroupSlots from "./verbGroupSlots";
import * as complementSlots from "./complementSlots";
import * as missingVerbSlots from "./missingVerbSlots";
import * as determinerSlots from "./determinerSlots";
import * as agreementSlots from "./agreementSlots";
import * as confusionSlots from "./confusionSlots";
import * as countSlots from "./countSlots";
import * as relativeSlots from "./relativeSlots";
import * as collocationSlots from "./collocationSlots";
import * as noNotSlots from "./noNotSlots";
import * as clauseAgreementSlots from "./clauseAgreementSlots";
import * as wordClassSlots from "./wordClassSlots";
import * as dialects from "./dialects";
import * as lexical from "./lexical";
import * as remaining from "./remaining";
import * as usageTables from "./usageTables";
import * as confusions2 from "./confusions2";
import * as fixedPhrases from "./fixedPhrases";
import * as grammarStyle1 from "./grammarStyle1";
import * as grammarStyle2 from "./grammarStyle2";
import * as idioms1 from "./idioms1";
import * as idioms2 from "./idioms2";
import * as idioms3 from "./idioms3";
import * as idioms4 from "./idioms4";
import * as idioms5 from "./idioms5";
import * as everydaySlots from "./everydaySlots";
import * as wordFormSlots from "./wordFormSlots";
import * as typoSlots from "./typoSlots";
import * as neighbourSlots from "./neighbourSlots";
import * as clauseFrames from "./clauseFrames";
import * as slipFrames from "./slipFrames";
import * as realWordFrames from "./realWordFrames";
import * as misheardWords from "./misheardWords";
import * as verbSlots from "./verbSlots";
import * as agreementFrames from "./agreementFrames";
import * as neighbourTypos from "./neighbourTypos";

export const PREDICATES = mergePredicates();

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = mergePredicates<Fixer>(
  idioms3.FIXERS,
  articles.FIXERS,
  idioms5.FIXERS,
  slotConfusions.FIXERS,
  slipFrames.FIXERS,
  neighbourTypos.FIXERS,
  idioms1.FIXERS,
  idioms2.FIXERS,
  idioms4.FIXERS,
  agreementFrames.FIXERS,
  clauseFrames.FIXERS,
  misheardWords.FIXERS,
  neighbourSlots.FIXERS,
  realWordFrames.FIXERS,
  typoSlots.FIXERS,
  verbSlots.FIXERS,
  remaining.FIXERS,
  everydaySlots.FIXERS,
  wordFormSlots.FIXERS,
  verbGroupSlots.FIXERS,
  agreementSlots.FIXERS,
  wordClassSlots.FIXERS,
  clauseAgreementSlots.FIXERS,
  collocationSlots.FIXERS,
  grammarStyle1.FIXERS,
  grammarStyle2.FIXERS,
  fixedPhrases.FIXERS,
  confusions1.FIXERS,
  confusions2.FIXERS,
  lexical.FIXERS,
  dialects.FIXERS,
  usageTables.FIXERS,
  typography.FIXERS,
  dates.FIXERS,
  compoundForms.FIXERS,
  punctuation.FIXERS,
  confusionSlots.FIXERS,
  apostrophes.FIXERS,
  relativeSlots.FIXERS,
  missingVerbSlots.FIXERS,
  plainStyle.FIXERS,
  properNames.FIXERS,
  complementSlots.FIXERS,
  contractionSlots.FIXERS,
  nounNumberSlots.FIXERS,
  countSlots.FIXERS,
  noNotSlots.FIXERS,
  determinerSlots.FIXERS,
);

/** The named findings filters of grammar/rules/en.yaml (`filter:`). */
export const FILTERS = mergePredicates<FindingsFilter>(
  articles.FILTERS,
  grammarStyle1.FILTERS,
  everydaySlots.FILTERS,
  fixedPhrases.FILTERS,
  punctuation.FILTERS,
  confusionSlots.FILTERS,
);
