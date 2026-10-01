// Spanish Review checks, appended to REVIEW_DETECTORS after the English extensions.
import type { ReviewDetectorEntry } from "../reviewDetectors";
import * as accents from "./accents";
import * as confusions from "./confusions";
import * as diacritics from "./diacritics";
import * as verbForms from "./verbForms";

// One registry entry per rule: modules serving the same rule run as one detector.
const byRule = new Map<string, ReviewDetectorEntry[]>();
for (const entry of [
  ...accents.DETECTORS,
  ...diacritics.DETECTORS,
  ...confusions.DETECTORS,
  ...verbForms.DETECTORS,
])
  byRule.set(entry.rules.join(), [...(byRule.get(entry.rules.join()) ?? []), entry]);

export const SPANISH_DETECTORS: ReviewDetectorEntry[] = [...byRule.values()].map((entries) => ({
  rules: entries[0].rules,
  detect: (ctx) => entries.flatMap((entry) => entry.detect(ctx)),
}));
