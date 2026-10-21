import { REVIEW_DETECTORS } from "../reviewDetectors";

/** The Swedish Review detectors (grammar/rules/sv.yaml), in evaluation order. */
export const DETECTORS = REVIEW_DETECTORS.filter((entry) => entry.source === "sv");
