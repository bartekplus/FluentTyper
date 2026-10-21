// The Review detectors of the rules of grammar/rules/fr.yaml.
import { REVIEW_DETECTORS } from "../reviewDetectors";

export const FRENCH_DETECTORS = REVIEW_DETECTORS.filter((entry) => entry.source === "fr");
