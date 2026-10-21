// The Review detectors of the rules of grammar/rules/de.yaml, in their order.
import { REVIEW_DETECTORS } from "../reviewDetectors";

export const GERMAN_DETECTORS = REVIEW_DETECTORS.filter((entry) => entry.source === "de");
