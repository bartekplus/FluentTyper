// Portuguese-only Review checks (pt_BR). Each detector also guards on the language itself:
// live proposals and the tests call detectors directly.
import { REVIEW_DETECTORS } from "../reviewDetectors";

export const PORTUGUESE_DETECTORS = REVIEW_DETECTORS.filter((entry) => entry.source === "pt_BR");
