// German-only Review checks, one module per area.
import * as confusions from "./confusions";
import * as nounCasing from "./nounCasing";
import * as prepositionCase from "./prepositionCase";

import * as adjectiveForms from "./adjectiveForms";

const MODULES = [adjectiveForms, nounCasing, prepositionCase, confusions];
export const GERMAN_DETECTORS = MODULES.flatMap((m) => m.DETECTORS);
