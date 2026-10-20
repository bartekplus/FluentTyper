// The named Review detectors of grammar/rules/fr.yaml; the rule file sets their checks,
// languages and order.
import { mergePredicates, type Fixer, type FindingsFilter } from "../../engine/reviewRules";
import * as adjectives from "./adjectives";
import * as agreement from "./agreement";
import * as auxiliary from "./auxiliary";
import * as bareNoun from "./bareNoun";
import * as commas from "./commas";
import * as countries from "./countries";
import * as dates from "./dates";
import * as determiners from "./determiners";
import * as elision from "./elision";
import * as gender from "./gender";
import * as homophones from "./homophones";
import * as hyphenation from "./hyphenation";
import * as imperative from "./imperative";
import * as invariables from "./invariables";
import * as mood from "./mood";
import * as negation from "./negation";
import * as nounNumber from "./nounNumber";
import * as ordinals from "./ordinals";
import * as questions from "./questions";
import * as repeatedWords from "./repeatedWords";
import * as smallWords from "./smallWords";
import * as style from "./style";
import * as tout from "./tout";
import * as verbForms from "./verbForms";

export const PREDICATES = mergePredicates(
  adjectives.PREDICATES,
  agreement.PREDICATES,
  auxiliary.PREDICATES,
  bareNoun.PREDICATES,
  commas.PREDICATES,
  dates.PREDICATES,
  determiners.PREDICATES,
  elision.PREDICATES,
  gender.PREDICATES,
  homophones.PREDICATES,
  hyphenation.PREDICATES,
  imperative.PREDICATES,
  invariables.PREDICATES,
  mood.PREDICATES,
  negation.PREDICATES,
  nounNumber.PREDICATES,
  ordinals.PREDICATES,
  questions.PREDICATES,
  smallWords.PREDICATES,
  style.PREDICATES,
  tout.PREDICATES,
  verbForms.PREDICATES,
);

/** The named frame fixes of grammar/rules/fr.yaml (`fixer:`). */
export const FIXERS = mergePredicates<Fixer>(
  countries.FIXERS,
  ordinals.FIXERS,
  repeatedWords.FIXERS,
);

/** The named findings filters of grammar/rules/fr.yaml (`filter:`). */
export const FILTERS = mergePredicates<FindingsFilter>();
