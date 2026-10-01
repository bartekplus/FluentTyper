// Portuguese-only Review checks (pt_BR). Each detector also guards on the language itself:
// live proposals and the tests call detectors directly.
import type { ReviewDetectorEntry } from "../reviewDetectors";
import { accentParonyms } from "./paronyms";

export const PORTUGUESE_DETECTORS: ReviewDetectorEntry[] = [
  { rules: ["portugueseAccentParonyms"], detect: accentParonyms },
];
