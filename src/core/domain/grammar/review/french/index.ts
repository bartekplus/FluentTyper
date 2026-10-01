// French Review checks: phrase rows for the shared table detectors and French-only detectors.
import * as verbForms from "./verbForms";

const MODULES = [verbForms];
export const FRENCH_DETECTORS = MODULES.flatMap((m) => m.DETECTORS);
