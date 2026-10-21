import { expect, test } from "bun:test";
import { languageRules, scanResult } from "./reviewHarness";

// Word tables that are plain objects must not read Object members ("constructor") as entries:
// a member is a function, so a check fails or gives a function as its fix.
const MEMBERS = Object.getOwnPropertyNames(Object.prototype);
const LANGS = [
  "en_US",
  "de_DE",
  "fr_FR",
  "es_ES",
  "pt_BR",
  "pl_PL",
  "hr_HR",
  "el_GR",
  "sv_SE",
  "ar_SA",
];

test.each(LANGS)("%s: Object member names are plain words", (lang) => {
  for (const member of MEMBERS)
    for (const text of [
      member,
      `${member} geht. El ${member} llega mañana. The ${member} runs.`,
      `${member[0].toUpperCase()}${member.slice(1)} ${member} ${member}s. ${member}, ${member}?`,
    ]) {
      const { coverage, diagnostics } = scanResult(text, {
        lang,
        enabledRules: languageRules(lang),
      });
      expect({ text, failed: coverage.failedRules }).toEqual({ text, failed: [] });
      for (const diagnostic of diagnostics)
        for (const alternative of diagnostic.alternatives)
          expect(typeof alternative.preview).toBe("string");
    }
});
