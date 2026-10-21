// The named Review detectors of grammar/rules/en.yaml; the rule file sets their checks,
// languages and order.
import {
  frameRuleDetector,
  mergePredicates,
  type FindingsFilter,
  type Fixer,
} from "../../engine/reviewRules";
import { useEnFrameRules } from "../../library/english/rules";
import { useRuleDetectors } from "../../library/english/views";
import * as collocationSlots from "./collocationSlots";

export const PREDICATES = mergePredicates();

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = mergePredicates<Fixer>(collocationSlots.FIXERS);

/** The named findings filters of grammar/rules/en.yaml (`filter:`). */
export const FILTERS = mergePredicates<FindingsFilter>();

// The rule files read the findings of another frame rule (library enFrameRuleFindings).
useEnFrameRules((id) => frameRuleDetector(id, {}));

// Rule code runs some frame rules of en.yaml in a view (library enRuleFindings).
useRuleDetectors((id) => frameRuleDetector(id, { en: FIXERS }, { en: FILTERS }));
