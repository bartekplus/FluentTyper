// Portuguese-only Review checks (pt_BR). Each detector also guards on the language itself:
// live proposals and the tests call detectors directly.
import type { ReviewDetectorEntry } from "../reviewDetectors";
import { confusions } from "./confusions";
import { contractions } from "./contractions";
import { accentParonyms } from "./paronyms";
import { ao90 } from "./ao90";
import { cliticPlacement } from "./clitics";
import { numberFormat, typographyStyle } from "./typography";

export const PORTUGUESE_DETECTORS: ReviewDetectorEntry[] = [
  { rules: ["portugueseAccentParonyms"], detect: accentParonyms },
  { rules: ["portugueseConfusions"], detect: confusions },
  { rules: ["portugueseContractions"], detect: contractions },
  { rules: ["portugueseNumberFormat"], detect: numberFormat },
  { rules: ["portugueseTypographyStyle"], detect: typographyStyle },
  { rules: ["portugueseCliticPlacement"], detect: cliticPlacement },
  { rules: ["portugueseAO90"], detect: ao90 },
];
