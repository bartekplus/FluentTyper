// French Review checks: phrase rows for the shared table detectors and French-only detectors.
import * as homophones from "./homophones";
import * as hyphenation from "./hyphenation";
import * as verbForms from "./verbForms";

const MODULES = [verbForms, homophones, hyphenation];
export const FRENCH_DETECTORS = MODULES.flatMap((m) => m.DETECTORS);
