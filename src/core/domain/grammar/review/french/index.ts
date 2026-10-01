// French Review checks: phrase rows for the shared table detectors and French-only detectors.
import * as agreement from "./agreement";
import * as elision from "./elision";
import * as homophones from "./homophones";
import * as hyphenation from "./hyphenation";
import * as verbForms from "./verbForms";

const MODULES = [verbForms, homophones, hyphenation, agreement, elision];
export const FRENCH_DETECTORS = MODULES.flatMap((m) => m.DETECTORS);
