// One module per extension area keeps parallel table work out of each other's files.
import * as apostrophes from "./apostrophes";
import * as compoundForms from "./compoundForms";
import * as properNames from "./properNames";
import * as plainStyle from "./plainStyle";
import * as passiveVoice from "./passiveVoice";
import * as fixedFrames from "./fixedFrames";
import * as punctuation from "./punctuation";
import * as articles from "./articles";
import * as slotConfusions from "./slotConfusions";
import * as britishUsage from "./britishUsage";
import * as typography from "./typography";
import * as confusions1 from "./confusions1";
import * as dates from "./dates";
import * as contractionSlots from "./contractionSlots";
import * as degreeSlots from "./degreeSlots";
import * as nounNumberSlots from "./nounNumberSlots";
import * as verbGroupSlots from "./verbGroupSlots";
import * as complementSlots from "./complementSlots";
import * as missingVerbSlots from "./missingVerbSlots";
import * as determinerSlots from "./determinerSlots";
import * as agreementSlots from "./agreementSlots";
import * as adverbSlots from "./adverbSlots";
import * as confusionSlots from "./confusionSlots";
import * as countSlots from "./countSlots";
import * as negationSlots from "./negationSlots";
import * as relativeSlots from "./relativeSlots";
import * as questionSlots from "./questionSlots";
import * as comparisonSlots from "./comparisonSlots";
import * as collocationSlots from "./collocationSlots";
import * as tenseSlots from "./tenseSlots";
import * as noNotSlots from "./noNotSlots";
import * as clauseAgreementSlots from "./clauseAgreementSlots";
import * as wordClassSlots from "./wordClassSlots";
import * as dialects from "./dialects";
import * as lexical from "./lexical";
import * as remaining from "./remaining";
import * as usageTables from "./usageTables";
import * as confusions2 from "./confusions2";
import * as fixedPhrases from "./fixedPhrases";
import * as grammarStyle1 from "./grammarStyle1";
import * as grammarStyle2 from "./grammarStyle2";
import * as idioms1 from "./idioms1";
import * as idioms2 from "./idioms2";
import * as idioms3 from "./idioms3";
import * as idioms4 from "./idioms4";
import * as idioms5 from "./idioms5";
import * as clauseSlots from "./clauseSlots";
import * as everydaySlots from "./everydaySlots";
import * as wordFormSlots from "./wordFormSlots";
import * as typoSlots from "./typoSlots";
import * as neighbourSlots from "./neighbourSlots";
import * as prepositionSlots from "./prepositionSlots";
import * as clauseFrames from "./clauseFrames";
import * as slipFrames from "./slipFrames";
import * as realWordFrames from "./realWordFrames";
import * as clauseGaps from "./clauseGaps";

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
  compoundForms,
  dates,
  usageTables,
  contractionSlots,
  degreeSlots,
  nounNumberSlots,
  verbGroupSlots,
  complementSlots,
  missingVerbSlots,
  determinerSlots,
  agreementSlots,
  adverbSlots,
  confusionSlots,
  countSlots,
  negationSlots,
  relativeSlots,
  questionSlots,
  comparisonSlots,
  collocationSlots,
  tenseSlots,
  noNotSlots,
  clauseAgreementSlots,
  wordClassSlots,
  apostrophes,
  properNames,
  typography,
  plainStyle,
  passiveVoice,
  fixedFrames,
  punctuation,
  articles,
  slotConfusions,
  britishUsage,
  clauseSlots,
  everydaySlots,
  wordFormSlots,
  typoSlots,
  neighbourSlots,
  prepositionSlots,
  clauseFrames,
  slipFrames,
  realWordFrames,
  clauseGaps,
];
export const EXTENSION_PHRASES = MODULES.flatMap((m) => m.PHRASES);
export const EXTENSION_COMPOUNDS = MODULES.flatMap((m) => m.COMPOUNDS);
export const EXTENSION_STYLE = MODULES.flatMap((m) => m.STYLE);
export const EXTENSION_DETECTORS = MODULES.flatMap((m) => m.DETECTORS);
