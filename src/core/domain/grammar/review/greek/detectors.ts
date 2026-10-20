import { REVIEW_DETECTORS } from "../reviewDetectors";

/** The Greek Review detectors (grammar/rules/el.yaml), in evaluation order. */
export const DETECTORS = REVIEW_DETECTORS.filter((entry) => entry.source === "el");
