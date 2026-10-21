// The named Review detectors of grammar/rules/en.yaml; the rule file sets their checks,
// languages and order.
import { mergePredicates, type FindingsFilter, type Fixer } from "../../engine/reviewRules";
import * as apostrophes from "./apostrophes";
import * as compoundForms from "./compoundForms";
import * as plainStyle from "./plainStyle";
import * as punctuation from "./punctuation";
import * as articles from "./articles";
import * as typography from "./typography";
import * as confusions1 from "./confusions1";
import * as confusionSlots from "./confusionSlots";
import * as collocationSlots from "./collocationSlots";
import * as lexical from "./lexical";
import * as remaining from "./remaining";
import * as confusions2 from "./confusions2";
import * as fixedPhrases from "./fixedPhrases";
import * as grammarStyle1 from "./grammarStyle1";
import * as grammarStyle2 from "./grammarStyle2";
import * as idioms1 from "./idioms1";
import * as everydaySlots from "./everydaySlots";
import * as wordFormSlots from "./wordFormSlots";

export const PREDICATES = mergePredicates();

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = mergePredicates<Fixer>(
  articles.FIXERS,
  idioms1.FIXERS,
  remaining.FIXERS,
  everydaySlots.FIXERS,
  wordFormSlots.FIXERS,
  collocationSlots.FIXERS,
  grammarStyle1.FIXERS,
  grammarStyle2.FIXERS,
  fixedPhrases.FIXERS,
  confusions1.FIXERS,
  confusions2.FIXERS,
  lexical.FIXERS,
  typography.FIXERS,
  compoundForms.FIXERS,
  punctuation.FIXERS,
  confusionSlots.FIXERS,
  apostrophes.FIXERS,
  plainStyle.FIXERS,
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
