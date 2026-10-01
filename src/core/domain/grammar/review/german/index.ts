// German-only Review checks, one module per area.
import * as nounCasing from "./nounCasing";

const MODULES = [nounCasing];
export const GERMAN_DETECTORS = MODULES.flatMap((m) => m.DETECTORS);
