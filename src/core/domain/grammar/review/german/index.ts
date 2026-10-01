// German-only Review checks, one module per area.
import * as nounCasing from "./nounCasing";
import * as prepositionCase from "./prepositionCase";

const MODULES = [nounCasing, prepositionCase];
export const GERMAN_DETECTORS = MODULES.flatMap((m) => m.DETECTORS);
