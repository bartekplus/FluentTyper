import { REVIEW_DETECTORS } from "../reviewDetectors";

/** The Arabic Review detectors (grammar/rules/ar_SA.yaml), in evaluation order. */
export const DETECTORS = REVIEW_DETECTORS.filter((entry) => entry.source === "ar_SA");
