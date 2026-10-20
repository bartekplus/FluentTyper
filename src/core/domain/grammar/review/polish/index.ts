// Polish-only Review checks, one module per area. The rule file grammar/rules/pl.yaml
// names them and sets their order.
import { REVIEW_DETECTORS } from "../reviewDetectors";

export const POLISH_DETECTORS = REVIEW_DETECTORS.filter((entry) => entry.source === "pl");
export { SPLIT_WORDS as POLISH_SPLIT_WORDS } from "./compounds";
