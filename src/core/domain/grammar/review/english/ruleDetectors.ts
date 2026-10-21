// The named Review detectors of grammar/rules/en.yaml; the rule file sets their checks,
// languages and order.
import {
  frameRuleDetector,
  mergePredicates,
  type FindingsFilter,
  type Fixer,
} from "../../engine/reviewRules";
import { useRuleDetectors } from "../../library/english/views";
import * as apostrophes from "./apostrophes";
import * as plainStyle from "./plainStyle";
import * as punctuation from "./punctuation";
import * as articles from "./articles";
import * as typography from "./typography";
import * as confusionSlots from "./confusionSlots";
import * as collocationSlots from "./collocationSlots";
import * as grammarStyle1 from "./grammarStyle1";
import * as everydaySlots from "./everydaySlots";
import * as wordFormSlots from "./wordFormSlots";

export const PREDICATES = mergePredicates();

// Group 5: rule code runs some frame rules of en.yaml in a view (library enRuleFindings).
useRuleDetectors((id) => frameRuleDetector(id, { en: FIXERS }, { en: FILTERS }));

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = mergePredicates<Fixer>(
  articles.FIXERS,
  everydaySlots.FIXERS,
  wordFormSlots.FIXERS,
  collocationSlots.FIXERS,
  grammarStyle1.FIXERS,
  typography.FIXERS,
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
  punctuation.FILTERS,
  confusionSlots.FILTERS,
);
