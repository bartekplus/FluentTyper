// One module per extension area keeps parallel table work out of each other's files.
import * as confusions1 from "./confusions1";
import * as contractionSlots from "./contractionSlots";
import * as dialects from "./dialects";
import * as lexical from "./lexical";
import * as remaining from "./remaining";
import * as confusions2 from "./confusions2";
import * as fixedPhrases from "./fixedPhrases";
import * as grammarStyle1 from "./grammarStyle1";
import * as grammarStyle2 from "./grammarStyle2";
import * as idioms1 from "./idioms1";
import * as idioms2 from "./idioms2";
import * as idioms3 from "./idioms3";
import * as idioms4 from "./idioms4";
import * as idioms5 from "./idioms5";

const MODULES = [
  fixedPhrases,
  confusions1,
  confusions2,
  idioms1,
  idioms2,
  idioms3,
  idioms4,
  idioms5,
  grammarStyle1,
  grammarStyle2,
  dialects,
  lexical,
  remaining,
  contractionSlots,
];
export const EXTENSION_PHRASES = MODULES.flatMap((m) => m.PHRASES);
export const EXTENSION_COMPOUNDS = MODULES.flatMap((m) => m.COMPOUNDS);
export const EXTENSION_STYLE = MODULES.flatMap((m) => m.STYLE);
export const EXTENSION_DETECTORS = MODULES.flatMap((m) => m.DETECTORS);
