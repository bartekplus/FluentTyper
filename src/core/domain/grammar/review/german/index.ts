// German-only Review checks, one module per area.
import * as abbreviations from "./abbreviations";
import * as adjectiveForms from "./adjectiveForms";
import * as articleGender from "./articleGender";
import * as confusions from "./confusions";
import * as nounCasing from "./nounCasing";
import * as prepositionCase from "./prepositionCase";
import * as quotes from "./quotes";
import * as suspendedHyphen from "./suspendedHyphen";

import * as dates from "./dates";

import * as colloquial from "./colloquial";
import * as commas from "./commas";
import * as compounds from "./compounds";
import * as numbers from "./numbers";
import * as questions from "./questions";
import * as recommended from "./recommended";
import * as redundancy from "./redundancy";
import * as verbAgreement from "./verbAgreement";

const MODULES = [
  compounds,
  dates,
  nounCasing,
  prepositionCase,
  confusions,
  adjectiveForms,
  articleGender,
  suspendedHyphen,
  abbreviations,
  quotes,
  commas,
  verbAgreement,
  questions,
  numbers,
  colloquial,
  recommended,
  redundancy,
];
export const GERMAN_DETECTORS = MODULES.flatMap((m) => m.DETECTORS);
export { germanUnits } from "./numbers";
