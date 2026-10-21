// The Review detectors of the rules of grammar/rules/pl.yaml, in their order.
import { REVIEW_DETECTORS } from "../reviewDetectors";

export const POLISH_DETECTORS = REVIEW_DETECTORS.filter((entry) => entry.source === "pl");
