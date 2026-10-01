import { describe, expect, test } from "bun:test";
import { detectReviewDiagnostics } from "../../src/core/domain/grammar/review/reviewDiagnostics";
import {
  REVIEW_SUPPORTED_RULE_IDS,
  reviewRuleIds,
  reviewRuleSelectionToOverrides,
} from "../../src/core/domain/grammar/review/reviewCatalog";
import { namedExampleBefore } from "../../src/core/domain/grammar/review/exampleCues";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type { ReviewDiagnostic } from "../../src/core/domain/grammar/review/types";

// Generic conditions (casing, apostrophes, offsets, boundaries, punctuation,
// markup, quotes, overlaps, line breaks) around existing native Review rules.
// Opt-in register and serial-comma styles rewrite other rules' output (and the two comma
// styles oppose each other), so "everything on" leaves them out.
const enabledRules = reviewRuleIds({
  codeMode: false,
  overrides: reviewRuleSelectionToOverrides(
    REVIEW_SUPPORTED_RULE_IDS.filter(
      (id) => !["styleContractions", "styleOxfordComma", "styleNoOxfordComma"].includes(id),
    ),
  ),
});

function review(text: string): ReviewDiagnostic[] {
  const diagnostics = detectReviewDiagnostics(
    { id: "edge", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
    { lang: "en_US", enabledRules, userDictionary: [], insertSpaceAfterAutocomplete: true },
  ).diagnostics;
  for (const d of diagnostics) expect(d.original).toBe(text.slice(d.range.start, d.range.end));
  return diagnostics;
}

/** Applies the first alternative of every finding, one at a time, rechecking between. */
function fixAll(text: string): string {
  for (let i = 0; i < 10; i += 1) {
    const next = review(text).find((d) => d.alternatives.length > 0);
    if (!next) return text;
    text = applyEdits(text, next.alternatives[0].edits)!;
  }
  throw new Error("did not settle");
}

describe("casing of the input is kept", () => {
  test.each([
    ["We could of won.", "We could have won."],
    ["WE COULD OF WON.", "WE COULD HAVE WON."],
    ["We Could Of Won.", "We Could Have Won."],
    ["Your welcome!", "You're welcome!"],
    ["YOUR WELCOME!", "YOU'RE WELCOME!"],
    ["YOU WAS LATE.", "YOU WERE LATE."],
    ["I DONT KNOW.", "I DON'T KNOW."],
    ["Their are two.", "There are two."],
    ["their is no way.", "There is no way."],
  ])("%s", (source, expected) => expect(fixAll(source)).toBe(expected));
});

describe("a new apostrophe follows the text's style", () => {
  test.each([
    ["It’s late and I dont care.", "It’s late and I don’t care."],
    ["It's late and I dont care.", "It's late and I don't care."],
    ["I dont care.", "I don't care."],
    // Mixed styles fall back to the plain apostrophe.
    ["It's fine, but I dont think it’s done.", "It's fine, but I don't think it’s done."],
    ["We’re here. Your welcome!", "We’re here. You’re welcome!"],
  ])("%s", (source, expected) => expect(fixAll(source)).toBe(expected));
});

describe("offsets are UTF-16 code units", () => {
  test.each([
    "😀 We could of won.",
    "𝒳 🇵🇱 We could of won.",
    "Café and we could of won.",
    "👩‍👩‍👧 We could of won.",
  ])("%s", (text) => {
    const [d] = review(text);
    expect(d.ruleId).toBe("englishModalOfCorrection");
    expect(d.range.start).toBe(text.indexOf("could of"));
    expect(applyEdits(text, d.alternatives[0].edits)).toBe(text.replace("could of", "could have"));
  });
});

describe("sentence boundaries", () => {
  test("a finding at offset 0 and one before the final period", () => {
    const text = "i knew it was i.";
    const findings = review(text).filter((d) => d.ruleId === "englishPronounICapitalization");
    expect(findings.map((d) => d.range)).toEqual([
      { start: 0, end: 1 },
      { start: 14, end: 15 },
    ]);
    expect(fixAll(text)).toBe("I knew it was I.");
  });

  test("a bare final i may be a variable and is left alone", () =>
    expect(review("so do i").filter((d) => d.ruleId === "englishPronounICapitalization")).toEqual(
      [],
    ));

  test("no terminal punctuation still fixes", () =>
    expect(fixAll("we could of won")).toBe("We could have won"));

  test("capitalization and a phrase fix at the same start compose", () => {
    const text = "their is a cat.";
    const findings = review(text);
    expect(findings.map((d) => d.ruleId).sort()).toEqual([
      "capitalizeSentenceStart",
      "englishTheirThereBeVerb",
    ]);
    // Their edits do not overlap, so both can apply.
    const [a, b] = findings.flatMap((d) => d.alternatives[0].edits);
    expect(a.end <= b.start || b.end <= a.start).toBe(true);
    expect(fixAll(text)).toBe("There is a cat.");
  });
});

describe("adjacent punctuation", () => {
  test.each([
    ["(We could of won.)", "(We could have won.)"],
    ["“We could of won,” she said.", "“We could have won,” she said."],
    ["(i dont know)", "(I don't know)"],
    ["i, too, left.", "I, too, left."],
    ["Was it i?", "Was it I?"],
    ["It was the the best!", "It was the best!"],
  ])("%s", (source, expected) => expect(fixAll(source)).toBe(expected));
});

describe("markup, code, URLs and addresses stay untouched", () => {
  test.each([
    "Use `could of` only in the code sample.",
    "Check `i dont` in the log.",
    "Visit https://example.test/i/dont/the/the now.",
    "Email dont@example.test today.",
    "Open src/dont/file.ts now.",
    "Tag @dont in the thread.",
  ])("%s", (text) => expect(review(text)).toEqual([]));
});

describe("quoted examples are evidence; quoted speech is prose", () => {
  test.each([
    'Never write "could of" in essays.',
    "The phrase “could of” is wrong.",
    "Do not type “the the” twice.",
  ])("%s", (text) => expect(review(text)).toEqual([]));

  test("dialogue inside quotes is still reviewed", () =>
    expect(fixAll('She said "we could of won" loudly.')).toBe(
      'She said "we could have won" loudly.',
    ));

  // The one frame guard covers every cue, link and quote style the detectors once split between them.
  test.each([
    ['Write "', true],
    ["The label is 'Oh. ", true],
    ["Replace “their ", true],
    ['The heading: "Done." Then ', true],
    ["It says « ", true],
    ['She said "', false],
    ['Write "done"\nThen ', false],
    [`Write "${"x".repeat(81)}`, false],
  ])("named example before %j: %p", (before, expected) =>
    expect(namedExampleBefore(`${before}he go`, before.length)).toBe(expected as boolean),
  );
});

describe("several findings in one sentence", () => {
  test("adjacent findings apply independently", () => {
    const text = "i dont know.";
    const findings = review(text);
    expect(findings.map((d) => d.ruleId).sort()).toEqual([
      "englishContractionNormalization",
      "englishPronounICapitalization",
    ]);
    expect(fixAll(text)).toBe("I don't know.");
  });

  test("a repeated word and a contraction", () =>
    expect(fixAll("We dont need the the report.")).toBe("We don't need the report."));
});

describe("line breaks", () => {
  test("a wrapped phrase is fixed and keeps its line break", () => {
    expect(fixAll("We could\nof won.")).toBe("We could\nhave won.");
    expect(fixAll("We could of\nwon.")).toBe("We could have\nwon.");
  });

  test("a word repeated across lines may be a list or a heading", () =>
    expect(review("the\nthe report").filter((d) => d.ruleId === "englishRepeatedWords")).toEqual(
      [],
    ));

  test("a new line starts a new check", () =>
    expect(fixAll("Line one.\ni dont know.")).toBe("Line one.\nI don't know."));

  test("CRLF offsets", () => {
    const text = "First line.\r\nWe could of won.";
    const [d] = review(text);
    expect(d.range.start).toBe(text.indexOf("could"));
    expect(fixAll(text)).toBe("First line.\r\nWe could have won.");
  });
});
