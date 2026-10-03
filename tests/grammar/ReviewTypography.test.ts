import { describe, expect, test } from "bun:test";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type { ReviewDiagnostic } from "../../src/core/domain/grammar/review/types";
import { ALL_RULES, scan as reviewScan } from "./reviewHarness";

// english/typography.ts: englishNotation (numbers, initialisms, degrees) and the optional
// englishTypography (symbols, quotes, dashes). All sentences are our own.
function scan(text: string, rule: string, lang = "en_US"): ReviewDiagnostic[] {
  return reviewScan(text, { lang, enabledRules: ALL_RULES }).filter((d) => d.ruleId === rule);
}
const fixAll = (text: string, ds: ReviewDiagnostic[]) =>
  applyEdits(
    text,
    ds.flatMap((d) => d.alternatives[0].edits),
  );

describe("englishNotation", () => {
  test.each([
    ["Sales grew 7,5% this year.", "Sales grew 7.5% this year."],
    ["The ticket costs $9,99 today.", "The ticket costs $9.99 today."],
    ["The file is 3,2 MB.", "The file is 3.2 MB."],
    ["About 4,5 million fans watched.", "About 4.5 million fans watched."],
    ["The city has 1.250.000 residents.", "The city has 1,250,000 residents."],
    ["We raised 14.000,75 in total.", "We raised 14,000.75 in total."],
    ["Over 45.000 guests came.", "Over 45,000 guests came."],
    ["Meet me on the 3 rd of May.", "Meet me on the 3rd of May."],
    ["The 4 th floor is closed.", "The 4th floor is closed."],
    ["Are you sure？", "Are you sure?"],
    ["He moved to the U.K last year.", "He moved to the U.K. last year."],
    ["Bring snacks, e.g fruit or nuts.", "Bring snacks, e.g. fruit or nuts."],
    ["She earned a PHD in biology.", "She earned a PhD in biology."],
    ["She earned a Ph. D. in biology.", "She earned a Ph.D. in biology."],
    ["He finished his B. Eng. early.", "He finished his B.Eng. early."],
  ])("fixes %p", (text, expected) => {
    expect(fixAll(text, scan(text, "englishNotation"))).toBe(expected);
  });

  test.each([
    "Pick rows 1,2 and 3.",
    "Version 2.4.1 is out.",
    "The router is at 192.168.100.200 now.",
    "The run took 1.000 seconds.",
    "It costs 3.50 dollars.",
    "We counted 12,000 birds.",
    "She has a PhD.",
    "She has a Ph.D. in law.",
    "He studied in the U.S.",
    "Turn to page 4 then stop.",
  ])("keeps %p", (text) => {
    expect(scan(text, "englishNotation")).toEqual([]);
  });

  test("is English only", () => {
    expect(scan("Es kostet 7,5% mehr.", "englishNotation", "de_DE")).toEqual([]);
  });
});

describe("englishTypography (optional)", () => {
  test.each([
    ["The room is 4 x 5 metres.", "The room is 4 × 5 metres."],
    ["A 1280x720 video.", "A 1280×720 video."],
    ["Step one -> step two.", "Step one → step two."],
    ["Copyright (c) 2021 Ada Lane.", "Copyright © 2021 Ada Lane."],
    ["Acme(TM) glue sticks.", "Acme™ glue sticks."],
    ["It weighs 12 +- 2 kg.", "It weighs 12 ± 2 kg."],
    ["H1: The drug works.", "H₁: The drug works."],

    ["He wrote „never“ there.", "He wrote “never” there."],
    ["Open 9am - 6pm daily.", "Open 9am–6pm daily."],
    ["The war lasted 1914-1918.", "The war lasted 1914–1918."],
    ["We work Monday - Friday.", "We work Monday–Friday."],
    ["It was cold - very cold.", "It was cold—very cold."],
  ])("fixes %p", (text, expected) => {
    expect(fixAll(text, scan(text, "englishTypography"))).toBe(expected);
  });

  test.each([
    "Call 555-1234 now.",
    "It happened on 2021-03-04.",
    "Use 0x1F as the mask.",
    "Pick (a), (b) or (c) now.",
    'The board is 12" wide.',
    "It runs 2x faster.",
  ])("keeps %p", (text) => {
    expect(scan(text, "englishTypography")).toEqual([]);
  });
});
