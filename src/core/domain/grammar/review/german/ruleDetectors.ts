// The named Review detectors of grammar/rules/de.yaml; the rule file sets their checks,
// languages and order.
import {
  mergePredicates,
  type Detector,
  type Fixer,
  type FindingsFilter,
} from "../../engine/reviewRules";
import * as abbreviations from "./abbreviations";
import * as adjectiveForms from "./adjectiveForms";
import * as articleGender from "./articleGender";
import * as colloquial from "./colloquial";
import * as commas from "./commas";
import * as compounds from "./compounds";
import * as dates from "./dates";
import * as joinedVerbs from "./joinedVerbs";
import * as nounCasing from "./nounCasing";
import * as nominalized from "./nominalized";
import * as capitalized from "./capitalized";
import * as names from "./names";
import * as numbers from "./numbers";
import * as prepositionCase from "./prepositionCase";
import * as questions from "./questions";
import * as quotes from "./quotes";
import * as suspendedHyphen from "./suspendedHyphen";
import * as verbAgreement from "./verbAgreement";

export const PREDICATES = mergePredicates<Detector>();

/** The named frame fixes of grammar/rules/de.yaml (`fixer:`). */
export const FIXERS = mergePredicates<Fixer>(
  abbreviations.FIXERS,
  suspendedHyphen.FIXERS,
  questions.FIXERS,
  quotes.FIXERS,
  dates.FIXERS,
  numbers.FIXERS,
  colloquial.FIXERS,
  compounds.FIXERS,
  joinedVerbs.FIXERS,
  adjectiveForms.FIXERS,
  commas.FIXERS,
  prepositionCase.FIXERS,
  verbAgreement.FIXERS,
  articleGender.FIXERS,
  nounCasing.FIXERS,
  nominalized.FIXERS,
  capitalized.FIXERS,
  names.FIXERS,
);

/** The named findings filters of grammar/rules/de.yaml (`filter:`). */
export const FILTERS = mergePredicates<FindingsFilter>(
  numbers.FILTERS,
  commas.FILTERS,
  nounCasing.FILTERS,
);
