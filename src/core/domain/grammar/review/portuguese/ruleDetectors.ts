// The named Review detectors of grammar/rules/pt_BR.yaml; the rule file sets their checks,
// languages and order.
import type { Detector } from "../../engine/reviewRules";
import { agreement } from "./agreement";
import { ao90 } from "./ao90";
import { cliticPlacement } from "./clitics";
import { commas, introductoryCommas } from "./commas";
import { confusions } from "./confusions";
import { contractions } from "./contractions";
import { invalidDates } from "./dates";
import { formalVerbs } from "./formal";
import { auxiliaryInfinitives } from "./infinitives";
import { markSpacing, unitSpacing } from "./marks";
import { nounAgreement } from "./nounAgreement";
import { sentenceStartNumbers } from "./numbers";
import { accentParonyms } from "./paronyms";
import { personAgreement } from "./personAgreement";
import {
  fixedAgreements,
  passiveNumber,
  quantifiedAdjectives,
  relativeAgreement,
  subjectPredicates,
} from "./predicates";
import { verbFrames } from "./style";
import { subjunctives } from "./subjunctive";
import { numberFormat, rangeDash, typographyStyle } from "./typography";
import { verbAgreement } from "./verbAgreement";

export const PREDICATES = {
  accentParonyms,
  confusions,
  contractions,
  numberFormat,
  typographyStyle,
  rangeDash,
  cliticPlacement,
  ao90,
  invalidDates,
  commas,
  introductoryCommas,
  agreement,
  nounAgreement,
  verbAgreement,
  subjunctives,
  subjectPredicates,
  relativeAgreement,
  quantifiedAdjectives,
  fixedAgreements,
  passiveNumber,
  personAgreement,
  auxiliaryInfinitives,
  verbFrames,
  formalVerbs,
  sentenceStartNumbers,
  markSpacing,
  unitSpacing,
} satisfies Record<string, Detector>;
