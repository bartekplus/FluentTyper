// Spanish Review checks, appended to REVIEW_DETECTORS after the English extensions.
import * as accents from "./accents";
import * as confusions from "./confusions";

export const SPANISH_DETECTORS = [...accents.DETECTORS, ...confusions.DETECTORS];
