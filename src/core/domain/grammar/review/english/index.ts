// The English extension checks. The detectors run from grammar/rules/en.yaml; the phrase
// tables are in ./tables.
import { REVIEW_DETECTORS } from "../reviewDetectors";

export { EXTENSION_PHRASES } from "./tables";

export const EXTENSION_DETECTORS = REVIEW_DETECTORS.filter((entry) => entry.source === "en");
