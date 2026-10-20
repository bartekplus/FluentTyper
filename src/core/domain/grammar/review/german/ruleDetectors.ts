// The named Review detectors of grammar/rules/de.yaml; the rule file sets their checks,
// languages and order.
import { mergePredicates, type Fixer, type FindingsFilter } from "../../engine/reviewRules";
import * as idiomFrames from "./idiomFrames";
import * as lookalikes from "./lookalikes";
import * as abbreviations from "./abbreviations";
import * as adjectiveForms from "./adjectiveForms";
import * as anglicisms from "./anglicisms";
import * as articleGender from "./articleGender";
import * as colloquial from "./colloquial";
import * as commas from "./commas";
import * as compounds from "./compounds";
import * as confusions from "./confusions";
import * as dates from "./dates";
import * as joinedVerbs from "./joinedVerbs";
import * as nounCasing from "./nounCasing";
import * as numbers from "./numbers";
import * as prepositionCase from "./prepositionCase";
import * as questions from "./questions";
import * as quotes from "./quotes";
import * as recommended from "./recommended";
import * as redundancy from "./redundancy";
import * as suspendedHyphen from "./suspendedHyphen";
import * as verbAgreement from "./verbAgreement";

export const PREDICATES = mergePredicates(
  abbreviations.PREDICATES,
  adjectiveForms.PREDICATES,
  anglicisms.PREDICATES,
  articleGender.PREDICATES,
  colloquial.PREDICATES,
  commas.PREDICATES,
  compounds.PREDICATES,
  dates.PREDICATES,
  joinedVerbs.PREDICATES,
  nounCasing.PREDICATES,
  numbers.PREDICATES,
  prepositionCase.PREDICATES,
  questions.PREDICATES,
  quotes.PREDICATES,
  recommended.PREDICATES,
  redundancy.PREDICATES,
  suspendedHyphen.PREDICATES,
  verbAgreement.PREDICATES,
);

/** The named frame fixes of grammar/rules/de.yaml (`fixer:`). */
export const FIXERS = mergePredicates<Fixer>(
  confusions.FIXERS,
  lookalikes.FIXERS,
  idiomFrames.FIXERS,
);

/** The named findings filters of grammar/rules/de.yaml (`filter:`). */
export const FILTERS = mergePredicates<FindingsFilter>();
