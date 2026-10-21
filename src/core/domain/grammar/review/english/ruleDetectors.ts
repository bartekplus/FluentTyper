// The named Review detectors of grammar/rules/en.yaml; the rule file sets their checks,
// languages and order.
import { mergePredicates, type FindingsFilter, type Fixer } from "../../engine/reviewRules";
import * as apostrophes from "./apostrophes";
import * as compoundForms from "./compoundForms";
import * as properNames from "./properNames";
import * as plainStyle from "./plainStyle";
import * as passiveVoice from "./passiveVoice";
import * as punctuation from "./punctuation";
import * as articles from "./articles";
import * as britishUsage from "./britishUsage";
import * as typography from "./typography";
import * as confusions1 from "./confusions1";
import * as dates from "./dates";
import * as degreeSlots from "./degreeSlots";
import * as adverbSlots from "./adverbSlots";
import * as confusionSlots from "./confusionSlots";
import * as negationSlots from "./negationSlots";
import * as questionSlots from "./questionSlots";
import * as comparisonSlots from "./comparisonSlots";
import * as collocationSlots from "./collocationSlots";
import * as tenseSlots from "./tenseSlots";
import * as dialects from "./dialects";
import * as lexical from "./lexical";
import * as remaining from "./remaining";
import * as usageTables from "./usageTables";
import * as confusions2 from "./confusions2";
import * as fixedPhrases from "./fixedPhrases";
import * as grammarStyle1 from "./grammarStyle1";
import * as grammarStyle2 from "./grammarStyle2";
import * as idioms1 from "./idioms1";
import * as clauseSlots from "./clauseSlots";
import * as everydaySlots from "./everydaySlots";
import * as wordFormSlots from "./wordFormSlots";
import * as prepositionSlots from "./prepositionSlots";
import * as clauseGaps from "./clauseGaps";
import * as nounSlots from "./nounSlots";
import * as clashFrames from "./clashFrames";

export const PREDICATES = mergePredicates();

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = mergePredicates<Fixer>(
  articles.FIXERS,
  clauseGaps.FIXERS,
  clashFrames.FIXERS,
  idioms1.FIXERS,
  britishUsage.FIXERS,
  nounSlots.FIXERS,
  prepositionSlots.FIXERS,
  remaining.FIXERS,
  everydaySlots.FIXERS,
  wordFormSlots.FIXERS,
  clauseSlots.FIXERS,
  collocationSlots.FIXERS,
  adverbSlots.FIXERS,
  comparisonSlots.FIXERS,
  tenseSlots.FIXERS,
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
  degreeSlots.FIXERS,
  plainStyle.FIXERS,
  properNames.FIXERS,
  questionSlots.FIXERS,
  negationSlots.FIXERS,
  passiveVoice.FIXERS,
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
