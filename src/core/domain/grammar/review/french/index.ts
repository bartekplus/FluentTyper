// French Review checks: phrase rows for the shared table detectors and French-only detectors.
import * as agreement from "./agreement";
import * as dates from "./dates";
import * as elision from "./elision";
import * as gender from "./gender";
import * as homophones from "./homophones";
import * as hyphenation from "./hyphenation";
import * as nounNumber from "./nounNumber";
import * as verbForms from "./verbForms";

const MODULES = [verbForms, homophones, hyphenation, agreement, elision, dates, nounNumber, gender];
export const FRENCH_DETECTORS = MODULES.flatMap((m) => m.DETECTORS);
