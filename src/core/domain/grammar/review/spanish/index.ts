// Spanish Review checks, appended to REVIEW_DETECTORS after the English extensions.
import type { ReviewDetectorEntry } from "../reviewDetectors";
import * as accents from "./accents";
import * as agreement from "./agreement";
import * as clauses from "./clauses";
import * as commas from "./commas";
import * as confusions from "./confusions";
import * as diacritics from "./diacritics";
import * as porque from "./porque";
import * as prefixes from "./prefixes";
import * as typography from "./typography";
import * as verbAccents from "./verbAccents";
import * as verbAgreement from "./verbAgreement";
import * as verbForms from "./verbForms";

// One registry entry per rule: modules serving the same rule run as one detector.
const byRule = new Map<string, ReviewDetectorEntry[]>();
for (const entry of [
  ...accents.DETECTORS,
  ...diacritics.DETECTORS,
  ...verbAccents.DETECTORS,
  ...confusions.DETECTORS,
  ...verbForms.DETECTORS,
  ...prefixes.DETECTORS,
  ...porque.DETECTORS,
  ...typography.DETECTORS,
  ...agreement.DETECTORS,
  ...commas.DETECTORS,
  ...verbAgreement.DETECTORS,
  ...clauses.DETECTORS,
])
  byRule.set(entry.rules.join(), [...(byRule.get(entry.rules.join()) ?? []), entry]);

export const SPANISH_DETECTORS: ReviewDetectorEntry[] = [...byRule.values()].map((entries) => ({
  rules: entries[0].rules,
  detect: (ctx) => entries.flatMap((entry) => entry.detect(ctx)),
}));
