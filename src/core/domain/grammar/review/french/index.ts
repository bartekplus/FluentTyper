// French Review checks: phrase rows for the shared table detectors and French-only detectors.
import * as agreement from "./agreement";
import * as dates from "./dates";
import * as elision from "./elision";
import * as gender from "./gender";
import * as adjectives from "./adjectives";
import * as homophones from "./homophones";
import * as hyphenation from "./hyphenation";
import * as nounNumber from "./nounNumber";
import * as verbForms from "./verbForms";
import * as tout from "./tout";
import * as mood from "./mood";
import * as negation from "./negation";
import * as smallWords from "./smallWords";
import * as determiners from "./determiners";
import * as ordinals from "./ordinals";
import * as commas from "./commas";
import * as countries from "./countries";

const MODULES = [
  verbForms,
  homophones,
  hyphenation,
  agreement,
  elision,
  dates,
  nounNumber,
  gender,
  adjectives,
  tout,
  mood,
  negation,
  smallWords,
  determiners,
  ordinals,
  commas,
  countries,
];
export const FRENCH_DETECTORS = MODULES.flatMap((m) => m.DETECTORS);
