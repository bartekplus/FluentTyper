// Spanish Review checks: the entries of grammar/rules/es.yaml in REVIEW_DETECTORS.
import { REVIEW_DETECTORS, type ReviewDetectorEntry } from "../reviewDetectors";

export const SPANISH_DETECTORS: ReviewDetectorEntry[] = REVIEW_DETECTORS.filter(
  (entry) => entry.source === "es",
);
