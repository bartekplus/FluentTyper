// French Review checks: grammar/rules/fr.yaml names the detectors of ruleDetectors.ts.
import { REVIEW_DETECTORS } from "../reviewDetectors";

export const FRENCH_DETECTORS = REVIEW_DETECTORS.filter((entry) => entry.source === "fr");
