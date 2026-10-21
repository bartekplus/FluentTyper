import { expect, test } from "bun:test";
import { languageRules, scanResult } from "./reviewHarness";

// English frames that look a typed word up in a map: an Object member name ("constructor") in
// the frame's slot is a plain word, not a map entry.
const MEMBERS = Object.getOwnPropertyNames(Object.prototype);

test.each(MEMBERS)("en_US: %s in a frame slot is a plain word", (member) => {
  for (const text of [
    `It was one of the ${member} that failed.`,
    `We met ${member}' s friend there.`,
    `You ${member}n't do that.`,
  ]) {
    const { coverage, diagnostics } = scanResult(text, {
      lang: "en_US",
      enabledRules: languageRules("en_US"),
    });
    expect({ text, failed: coverage.failedRules }).toEqual({ text, failed: [] });
    for (const diagnostic of diagnostics)
      for (const alternative of diagnostic.alternatives)
        expect(typeof alternative.preview).toBe("string");
  }
});
