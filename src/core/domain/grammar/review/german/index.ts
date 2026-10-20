// German-only Review checks, one module per area. The rule file grammar/rules/de.yaml
// names them and sets their order.
import { REVIEW_DETECTORS } from "../reviewDetectors";

export const GERMAN_DETECTORS = REVIEW_DETECTORS.filter((entry) => entry.source === "de");
export { germanUnits } from "./numbers";
