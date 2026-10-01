// German-only Review checks, one module per area.
import * as abbreviations from "./abbreviations";
import * as adjectiveForms from "./adjectiveForms";
import * as confusions from "./confusions";
import * as nounCasing from "./nounCasing";
import * as prepositionCase from "./prepositionCase";
import * as quotes from "./quotes";
import * as suspendedHyphen from "./suspendedHyphen";

const MODULES = [
  nounCasing,
  prepositionCase,
  confusions,
  adjectiveForms,
  suspendedHyphen,
  abbreviations,
  quotes,
];
export const GERMAN_DETECTORS = MODULES.flatMap((m) => m.DETECTORS);
