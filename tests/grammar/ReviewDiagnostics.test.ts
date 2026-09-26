import { describe, expect, test } from "bun:test";
import {
  GRAMMAR_RULE_CATALOG,
  GRAMMAR_RULE_IDS,
  type CatalogRuleId,
} from "../../src/core/domain/grammar/ruleCatalog";
import {
  REVIEW_RULE_METADATA,
  reviewCoverageMap,
} from "../../src/core/domain/grammar/review/reviewCatalog";
import { REVIEW_DETECTORS } from "../../src/core/domain/grammar/review/reviewDetectors";
import {
  MAX_REVIEW_CHARS,
  REVIEW_CHUNK_CHARS,
  detectReviewDiagnostics,
  finalizeReview,
  prepareReview,
  reviewChunks,
  scanReviewChunk,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";
import { applyEdits } from "../../src/core/domain/grammar/review/textRanges";
import type {
  ProtectedRange,
  ReviewDiagnostic,
  ReviewOptions,
} from "../../src/core/domain/grammar/review/types";

const ALL_RULES = GRAMMAR_RULE_IDS;

function options(overrides: Partial<ReviewOptions> = {}): ReviewOptions {
  return {
    lang: "en_US",
    enabledRules: ALL_RULES,
    userDictionary: [],
    insertSpaceAfterAutocomplete: true,
    ...overrides,
  };
}

function review(
  text: string,
  overrides: Partial<ReviewOptions> = {},
  extra: { scope?: { start: number; end: number }; protectedRanges?: ProtectedRange[] } = {},
): ReviewDiagnostic[] {
  return detectReviewDiagnostics(
    {
      id: "snap",
      text,
      scope: extra.scope ?? { start: 0, end: text.length },
      protectedRanges: extra.protectedRanges ?? [],
    },
    options(overrides),
  ).diagnostics;
}

/** [ruleId, highlighted text, [start, end], corrected text of the highlight]. */
function summary(diagnostics: ReviewDiagnostic[]) {
  return diagnostics.map((d) => [
    d.ruleId,
    d.original,
    [d.range.start, d.range.end],
    d.alternatives[0].preview,
  ]);
}

function only(text: string, ruleId: CatalogRuleId, overrides: Partial<ReviewOptions> = {}) {
  return summary(review(text, { ...overrides, enabledRules: [ruleId] }));
}

/** Applying the first alternative of every finding, one at a time, gives the fixed text. */
function fixOne(text: string, diagnostic: ReviewDiagnostic): string {
  const result = applyEdits(text, diagnostic.alternatives[0].edits);
  if (result === null) throw new Error("edits did not apply");
  return result;
}

describe("review rule coverage map", () => {
  test("classifies every catalog rule explicitly", () => {
    const map = reviewCoverageMap();
    expect(map.map((entry) => entry.ruleId)).toEqual(GRAMMAR_RULE_CATALOG.map((e) => e.id));
    for (const entry of map) {
      if (entry.review === "excluded") expect(entry.reason.length).toBeGreaterThan(10);
      else expect(["spelling", "grammar", "punctuation", "typography"]).toContain(entry.category);
    }
  });

  test("every supported rule has exactly one detector, and excluded rules have none", () => {
    const detected = REVIEW_DETECTORS.flatMap((detector) => detector.rules);
    expect(new Set(detected).size).toBe(detected.length);
    for (const ruleId of GRAMMAR_RULE_IDS) {
      expect(detected.includes(ruleId)).toBe(REVIEW_RULE_METADATA[ruleId].review === "supported");
    }
  });

  test("typing conveniences are excluded from review", () => {
    for (const ruleId of [
      "doubleSpaceToPeriod",
      "autoBracketClose",
      "ellipsisShortcut",
      "emdashShortcut",
      "smartQuoteNormalization",
    ] as const) {
      expect(REVIEW_RULE_METADATA[ruleId].review).toBe("excluded");
    }
    // Intentional whitespace is never turned into punctuation, brackets never inserted.
    expect(review('Hello  world (unclosed "quote')).toEqual([
      expect.objectContaining({ ruleId: "collapseRepeatedSpaces" }),
    ]);
  });
});

describe("review detectors: capitalization and typography", () => {
  test("capitalizeSentenceStart", () => {
    expect(only("Done. then more! and? yes", "capitalizeSentenceStart")).toEqual([
      ["capitalizeSentenceStart", "t", [6, 7], "T"],
      ["capitalizeSentenceStart", "a", [17, 18], "A"],
      ["capitalizeSentenceStart", "y", [22, 23], "Y"],
    ]);
    expect(only("hello there", "capitalizeSentenceStart")).toEqual([
      ["capitalizeSentenceStart", "h", [0, 1], "H"],
    ]);
    // Abbreviations, deliberate casing, technical tokens and numbers are left alone.
    expect(
      only("See Dr. smith, e.g. the one. iPhone ok. node.js is. x2 is", "capitalizeSentenceStart"),
    ).toEqual([]);
    // A newline is the line-break rule's.
    expect(only("Done.\nthen", "capitalizeSentenceStart")).toEqual([]);
  });

  test("capitalizeAfterLineBreak only after a finished sentence or paragraph", () => {
    expect(
      only("First line.\nsecond line\nwrapped text\n\nnew paragraph", "capitalizeAfterLineBreak"),
    ).toEqual([
      ["capitalizeAfterLineBreak", "s", [12, 13], "S"],
      ["capitalizeAfterLineBreak", "n", [38, 39], "N"],
    ]);
    const [finding] = review("Done.\nthen", { enabledRules: ["capitalizeAfterLineBreak"] });
    expect(finding.bulk).toEqual({ eligible: false, reason: "rule-not-batch-approved" });
  });

  test("englishPronounICapitalization", () => {
    expect(
      only("Yes i think so, and i'm sure i've, i, ok", "englishPronounICapitalization"),
    ).toEqual([
      ["englishPronounICapitalization", "i", [4, 5], "I"],
      ["englishPronounICapitalization", "i", [20, 21], "I"],
      ["englishPronounICapitalization", "i", [29, 30], "I"],
      ["englishPronounICapitalization", "i", [35, 36], "I"],
    ]);
    // A complete contraction after it identifies the pronoun too.
    expect(only("so i don't and i can’t, i 'quoted'", "englishPronounICapitalization")).toEqual([
      ["englishPronounICapitalization", "i", [3, 4], "I"],
      ["englishPronounICapitalization", "i", [15, 16], "I"],
    ]);
    // Loop variables, roman numerals, "i.e.", mentions and end-of-input ambiguity.
    expect(
      only(
        "for i in x; if i is 0; (i) first; i.e. that; @i here; last i",
        "englishPronounICapitalization",
      ),
    ).toEqual([]);
  });

  test('a sentence-final "i." is the pronoun; list markers and numbered parts are not', () => {
    const rule = "englishPronounICapitalization";
    // Typing cannot tell "i." from the start of "i.e."; the finished text can.
    expect(only("She is taller than i. Nobody but i.\nIt was i.", rule).map((r) => r[2])).toEqual([
      [19, 20],
      [33, 34],
      [43, 44],
    ]);
    for (const text of ["i.e. this", "i. First item", "  i. Second item", "See Part i. Next"]) {
      expect(only(text, rule)).toEqual([]);
    }
    // A loop variable can end a sentence too: one at a time.
    const [finding] = review("taller than i.", { enabledRules: [rule] });
    expect(finding.bulk).toEqual({ eligible: false, reason: "context-dependent" });
  });

  test('"i" named by the word before it is an identifier, not the pronoun', () => {
    const rule = "englishPronounICapitalization";
    for (const text of [
      "The variable i has a value.",
      "The index i represents a row.",
      "Let the counter i grow, then the iterator i stops.",
      "Use a i here.",
    ]) {
      expect(only(text, rule)).toEqual([]);
    }
    // A condition before it is not a name: "if i go" is still the pronoun.
    expect(only("Yesterday i went home.", rule)).toEqual([[rule, "i", [10, 11], "I"]]);
    expect(only("Call me if i go, and when i leave.", rule).map((row) => row[2])).toEqual([
      [11, 12],
      [26, 27],
    ]);
    // The deciding word before it is evidence: editing it re-checks the finding.
    const [finding] = review("Yesterday i went home.", { enabledRules: [rule] });
    expect(finding.context).toEqual({ start: 0, end: 16 });
  });

  test("englishProperNounCapitalization", () => {
    expect(
      only("See you on monday and on christmas eve, then july", "englishProperNounCapitalization"),
    ).toEqual([
      ["englishProperNounCapitalization", "monday", [11, 17], "Monday"],
      ["englishProperNounCapitalization", "christmas eve", [25, 38], "Christmas Eve"],
      ["englishProperNounCapitalization", "july", [45, 49], "July"],
    ]);
    const [may] = review("due mid-may", { enabledRules: ["englishProperNounCapitalization"] });
    expect([may.original, may.alternatives[0].preview, may.bulk]).toEqual([
      "may",
      "May",
      { eligible: false, reason: "context-dependent" },
    ]);
    expect(
      only("it may rain; we march on; visit monday.com", "englishProperNounCapitalization"),
    ).toEqual([]);
    expect(
      only("monday", "englishProperNounCapitalization", { userDictionary: ["monday"] }),
    ).toEqual([]);
  });

  test("may, march and august are months when the words after them say so", () => {
    const rule = "englishProperNounCapitalization";
    const months = (text: string) => only(text, rule).map(([, original]) => original);
    // Typing leaves these as typed: it never sees what follows the word.
    for (const text of [
      "We moved in may.",
      "We left in august, then came back.",
      "Last may, we met.",
      "It ends at the end of march.",
      "On the 5th of may, we left.",
      "Due on 5 may.",
      "Come in april or may.",
      "From may to june.",
      "Open until march",
      "Every august, they sail.",
    ]) {
      expect(months(text)).toContain(text.match(/may|march|august/)![0]);
    }
    // The verb, the adjective and the noun stay as written.
    for (const text of [
      "It may rain.",
      "This may.",
      "You may, of course.",
      "They march, then rest.",
      "On his last march, he fell.",
      "Log in may fail.",
      "Every may be wrong.",
      "an august institution in august company",
      "Only 5 may.",
    ]) {
      expect(months(text)).toEqual([]);
    }
    // Always one at a time, with the deciding words as evidence.
    const [finding] = review("We moved in may.", { enabledRules: [rule] });
    expect(finding.bulk).toEqual({ eligible: false, reason: "context-dependent" });
    expect(finding.context!.end).toBeGreaterThan(finding.range.end);
  });

  test("englishOrdinalSuffix", () => {
    expect(only("the 2th and 23th and 11th", "englishOrdinalSuffix")).toEqual([
      ["englishOrdinalSuffix", "2th", [4, 7], "2nd"],
      ["englishOrdinalSuffix", "23th", [12, 16], "23rd"],
    ]);
    expect(only('never write "3th" here; v1th; 11st', "englishOrdinalSuffix")).toEqual([]);
  });
});

describe("review detectors: spelling", () => {
  test("englishTypoWhitelistCorrection keeps case and honors the dictionary", () => {
    expect(only("Teh cat saw teh DEFINATELY", "englishTypoWhitelistCorrection")).toEqual([
      ["englishTypoWhitelistCorrection", "Teh", [0, 3], "The"],
      ["englishTypoWhitelistCorrection", "teh", [12, 15], "the"],
      ["englishTypoWhitelistCorrection", "DEFINATELY", [16, 26], "DEFINITELY"],
    ]);
    const [finding] = review("teh", { enabledRules: ["englishTypoWhitelistCorrection"] });
    expect(finding.category).toBe("spelling");
    expect(finding.dictionaryWord).toBe("teh");
    expect(only("teh", "englishTypoWhitelistCorrection", { userDictionary: ["Teh"] })).toEqual([]);
    // Parts of names, paths and longer words are not typos.
    expect(
      only("src/teh teh_x tehran teh.com @teh teh2", "englishTypoWhitelistCorrection"),
    ).toEqual([]);
  });

  test("englishContractionNormalization", () => {
    expect(only("I dont know, Im sure it isnt.", "englishContractionNormalization")).toEqual([
      ["englishContractionNormalization", "dont", [2, 6], "don't"],
      ["englishContractionNormalization", "Im", [13, 15], "I'm"],
      ["englishContractionNormalization", "isnt", [24, 28], "isn't"],
    ]);
    expect(only("Jony Ive says IM ok; cant wont ill", "englishContractionNormalization")).toEqual(
      [],
    );
    const [finding] = review("dont", { enabledRules: ["englishContractionNormalization"] });
    expect(finding.dictionaryWord).toBeUndefined();
  });

  test("cant, wont and ill are contractions only before a bare verb", () => {
    const rule = "englishContractionNormalization";
    expect(only("I cant go. It wont work. ill be there. Cant wait!", rule)).toEqual([
      [rule, "cant", [2, 6], "can't"],
      [rule, "wont", [14, 18], "won't"],
      [rule, "ill", [25, 28], "I'll"],
      [rule, "Cant", [39, 43], "Can't"],
    ]);
    expect(only("I cant really say, and ill call you.", rule).map((row) => row[3])).toEqual([
      "can't",
      "I'll",
    ]);
    // The ordinary words stay: no bare verb after them, or no subject before.
    for (const text of [
      "the cant of the roof",
      "They cant the deck.",
      "As is his wont to say.",
      "They were wont to go.",
      "He fell ill.",
      "ill health and ill will",
      "I cant.",
      "Ada Ill be",
      "ILL BE THERE",
    ]) {
      expect(only(text, rule)).toEqual([]);
    }
    const [finding] = review("It wont work.", { enabledRules: [rule] });
    expect(finding.bulk).toEqual({ eligible: false, reason: "context-dependent" });
    // The verb after it decided it: editing that word re-checks the finding.
    expect(finding.context).toEqual({ start: 0, end: 12 });
  });

  test("englishAlotCorrection", () => {
    expect(only("Thanks alot. ALOT", "englishAlotCorrection")).toEqual([
      ["englishAlotCorrection", "alot", [7, 11], "a lot"],
      ["englishAlotCorrection", "ALOT", [13, 17], "A LOT"],
    ]);
    expect(only("alot", "englishAlotCorrection", { userDictionary: ["alot"] })).toEqual([]);
  });
});

describe("review detectors: grammar", () => {
  test("englishModalOfCorrection edits only the word that changes", () => {
    const [finding] = review("We could of won.", { enabledRules: ["englishModalOfCorrection"] });
    expect(summary([finding])).toEqual([
      ["englishModalOfCorrection", "could of", [3, 11], "could have"],
    ]);
    expect(finding.alternatives[0].edits).toEqual([
      { start: 9, end: 11, original: "of", replacement: "have" },
    ]);
    expect(only("You must of course; could of", "englishModalOfCorrection")).toEqual([]);
  });

  test("englishYourWelcomeCorrection only sentence-final, including the end of input", () => {
    expect(only("Thanks! your welcome. Your welcome", "englishYourWelcomeCorrection")).toEqual([
      ["englishYourWelcomeCorrection", "your welcome", [8, 20], "you're welcome"],
      ["englishYourWelcomeCorrection", "Your welcome", [22, 34], "You're welcome"],
    ]);
    expect(only("Your welcome email arrived", "englishYourWelcomeCorrection")).toEqual([]);
  });

  test("englishTheirThereBeVerb", () => {
    expect(only("Their are two. their is one", "englishTheirThereBeVerb")).toEqual([
      ["englishTheirThereBeVerb", "Their are", [0, 9], "There are"],
      ["englishTheirThereBeVerb", "their is", [15, 23], "there is"],
    ]);
    expect(only("their island", "englishTheirThereBeVerb")).toEqual([]);
  });

  test("englishPronounVerbWhitelistAgreement capitalizes the pronoun it rewrites", () => {
    const [finding] = review("so i has time", {
      enabledRules: ["englishPronounVerbWhitelistAgreement"],
    });
    expect(summary([finding])).toEqual([
      ["englishPronounVerbWhitelistAgreement", "i has", [3, 8], "I have"],
    ]);
    expect(finding.alternatives[0].edits).toEqual([
      { start: 3, end: 4, original: "i", replacement: "I" },
      { start: 7, end: 8, original: "s", replacement: "ve" },
    ]);
    expect(only("he are late. you was there", "englishPronounVerbWhitelistAgreement")).toEqual([
      ["englishPronounVerbWhitelistAgreement", "he are", [0, 6], "he is"],
      ["englishPronounVerbWhitelistAgreement", "you was", [13, 20], "you were"],
    ]);
    // Needs the following word: "i is" at the end of input stays.
    expect(only("i is", "englishPronounVerbWhitelistAgreement")).toEqual([]);
  });

  test("englishArticleAnCorrection is individual-only", () => {
    const [finding] = review("It is a hour. We need an user.", {
      enabledRules: ["englishArticleAnCorrection"],
    });
    expect(summary([finding])).toEqual([
      ["englishArticleAnCorrection", "a hour", [6, 12], "an hour"],
    ]);
    expect(
      summary(review("We need an user.", { enabledRules: ["englishArticleAnCorrection"] })),
    ).toEqual([["englishArticleAnCorrection", "an user", [8, 15], "a user"]]);
    expect(finding.bulk.eligible).toBe(false);
    expect(
      only("grade A apples; option a early; Qur'an idea", "englishArticleAnCorrection"),
    ).toEqual([]);
  });
});

describe("adversarial review regressions: detection", () => {
  test('"your welcome" is corrected only as a reply, never as a possessive', () => {
    const rule = "englishYourWelcomeCorrection";
    expect(only("Thank you all for your welcome.", rule)).toEqual([]);
    expect(only("Did you enjoy your welcome?", rule)).toEqual([]);
    expect(only("Thanks, your welcome.", rule).map((row) => row[1])).toEqual(["your welcome"]);
    expect(only("your welcome", rule).map((row) => row[1])).toEqual(["your welcome"]);
  });

  test('a lowercase "i" that reads as a variable is not rewritten as "I am"/"I have"', () => {
    const rule = "englishPronounVerbWhitelistAgreement";
    for (const text of [
      "Check if i is None",
      "returns null if i is out of range",
      "The loop variable i is incremented",
      "while i has items left",
    ]) {
      expect(only(text, rule)).toEqual([]);
    }
    expect(only("so i has time", rule).map((row) => row[3])).toEqual(["I have"]);
    expect(only("I is here", rule).map((row) => row[3])).toEqual(["I am"]);
  });

  test('"im"/"ive" after a determiner is a word; the rest is one at a time', () => {
    const rule = "englishContractionNormalization";
    expect(only("The im tag and an ive file", rule)).toEqual([]);
    const [finding] = review("so im going", { enabledRules: [rule] });
    expect(finding.alternatives[0].preview).toContain("I'm");
    expect(finding.bulk.eligible).toBe(false);
    // A word the user added to the dictionary is theirs.
    expect(review("dont", { enabledRules: [rule], userDictionary: ["dont"] })).toEqual([]);
  });

  test("indented code is protected with CRLF and whitespace-only blank lines too", () => {
    for (const text of [
      "Intro text.\r\n\r\n    let teh = dont;\r\n",
      "Intro text.\n \n    let teh = dont;\n",
    ]) {
      const findings = review(text);
      expect(findings.filter((d) => d.range.start > text.indexOf("let"))).toEqual([]);
    }
  });
});

describe("review detectors: punctuation and spacing", () => {
  test("commaPeriodSpacing", () => {
    expect(only("Yes , no . Really ? ok,then 1,5 a,b x,y,z", "commaPeriodSpacing")).toEqual([
      ["commaPeriodSpacing", " ,", [3, 5], ","],
      ["commaPeriodSpacing", " .", [8, 10], "."],
      ["commaPeriodSpacing", " ?", [17, 19], "?"],
      ["commaPeriodSpacing", ",", [22, 23], ", "],
    ]);
    // The missing space follows the "space after autocomplete" setting.
    expect(only("ok,then", "commaPeriodSpacing", { insertSpaceAfterAutocomplete: false })).toEqual(
      [],
    );
    // French keeps its space before "?"; ellipses stay.
    expect(only("Vraiment ?", "commaPeriodSpacing", { lang: "fr_FR" })).toEqual([]);
    expect(only("wait ...", "commaPeriodSpacing")).toEqual([]);
    // An inserted space is anchored on the comma, never a bare insertion.
    const [after] = review("ok,then", { enabledRules: ["commaPeriodSpacing"] });
    expect(after.alternatives[0].edits).toEqual([
      { start: 2, end: 3, original: ",", replacement: ", " },
    ]);
  });

  test("collapseRepeatedSpaces keeps a deliberate first space and skips alignment", () => {
    expect(only("one  two", "collapseRepeatedSpaces")).toEqual([
      ["collapseRepeatedSpaces", "  ", [3, 5], " "],
    ]);
    expect(only("a\u00A0 b", "collapseRepeatedSpaces")).toEqual([
      ["collapseRepeatedSpaces", "\u00A0 ", [1, 3], "\u00A0"],
    ]);
    expect(only("name   age   city\n    indented", "collapseRepeatedSpaces")).toEqual([]);
    expect(only("trailing  \nnext", "collapseRepeatedSpaces")).toEqual([]);
  });

  test("duplicatePunctuationCollapse", () => {
    expect(only("yes,, no;; ok, , fine.. end... std::x", "duplicatePunctuationCollapse")).toEqual([
      ["duplicatePunctuationCollapse", ",,", [3, 5], ","],
      ["duplicatePunctuationCollapse", ";;", [8, 10], ";"],
      ["duplicatePunctuationCollapse", ", ,", [13, 16], ","],
      ["duplicatePunctuationCollapse", "..", [21, 23], "."],
    ]);
    expect(only("see ../dir", "duplicatePunctuationCollapse")).toEqual([]);
  });

  test("measurementUnitFormatting and currencySpacing follow the locale policy", () => {
    expect(only("It weighs 10kg.", "measurementUnitFormatting")).toEqual([
      ["measurementUnitFormatting", "10kg", [10, 14], "10\u00A0kg"],
    ]);
    expect(only("a 4K screen and 5g phone", "measurementUnitFormatting")).toEqual([]);
    expect(only("Price: 120zł today", "currencySpacing", { lang: "pl_PL" })).toEqual([
      ["currencySpacing", "120zł", [7, 12], "120\u00A0zł"],
    ]);
    const [measurement] = review("It weighs 10kg.", {
      enabledRules: ["measurementUnitFormatting"],
    });
    expect(measurement.bulk.eligible).toBe(false);
  });
});

describe("review detection invariants", () => {
  const DEMO =
    "i think teh release is ready , but their is one problem. we could of shipped on monday.";

  test("detection is read-only and deterministic", () => {
    const text = DEMO;
    const first = review(text);
    const second = review(text);
    expect(second).toEqual(first);
    expect(text).toBe(DEMO);
    for (const diagnostic of first) {
      expect(diagnostic.snapshotId).toBe("snap");
      expect(diagnostic.original).toBe(text.slice(diagnostic.range.start, diagnostic.range.end));
      for (const edit of diagnostic.alternatives[0].edits) {
        expect(text.slice(edit.start, edit.end)).toBe(edit.original);
        expect(edit.end).toBeGreaterThan(edit.start);
      }
    }
  });

  test("each fix changes only its own text", () => {
    const text = "teh cat and teh dog";
    const [first] = review(text, { enabledRules: ["englishTypoWhitelistCorrection"] });
    expect(fixOne(text, first)).toBe("the cat and teh dog");
  });

  test("identical fixes from two rules are one finding", () => {
    expect(summary(review("i think so."))).toEqual([
      ["englishPronounICapitalization", "i", [0, 1], "I"],
    ]);
  });

  test("categories come from the central metadata", () => {
    const categories = new Map(review(DEMO).map((d) => [d.ruleId, d.category]));
    expect(categories.get("englishTypoWhitelistCorrection")).toBe("spelling");
    expect(categories.get("englishTheirThereBeVerb")).toBe("grammar");
    expect(categories.get("commaPeriodSpacing")).toBe("punctuation");
    expect(categories.get("englishProperNounCapitalization")).toBe("typography");
  });

  test("disabled rules, language guards and code-mode selections are honored", () => {
    expect(review(DEMO, { enabledRules: [] })).toEqual([]);
    // Code mode leaves only code-safe rules, none of which review supports.
    expect(review(DEMO, { enabledRules: ["autoBracketClose"] })).toEqual([]);
    const german = detectReviewDiagnostics(
      { id: "s", text: "teh cat , ok", scope: { start: 0, end: 12 }, protectedRanges: [] },
      options({ lang: "de_DE" }),
    );
    expect(german.diagnostics.map((d) => d.ruleId)).toEqual([
      "capitalizeSentenceStart",
      "commaPeriodSpacing",
    ]);
    const prepared = prepareReview(
      { id: "s", text: "x", scope: { start: 0, end: 1 }, protectedRanges: [] },
      options({ lang: "de_DE" }),
    );
    expect(prepared.languageSkipped).toContain("englishTypoWhitelistCorrection");
  });

  test("Unicode: emoji, combining marks, NBSP and surrogate pairs", () => {
    // Combining acute: the capital keeps its mark and the edit covers the whole grapheme.
    const combining = "Done. e\u0301te\u0301 was hot";
    const [accent] = review(combining, { enabledRules: ["capitalizeSentenceStart"] });
    expect(accent.alternatives[0].edits).toEqual([
      { start: 6, end: 8, original: "e\u0301", replacement: "E\u0301" },
    ]);
    // Emoji before a typo keep UTF-16 offsets exact.
    const emoji = "👍🏽 teh 😀";
    const [typo] = review(emoji, { enabledRules: ["englishTypoWhitelistCorrection"] });
    expect(typo.range).toEqual({ start: 5, end: 8 });
    expect(fixOne(emoji, typo)).toBe("👍🏽 the 😀");
    // NBSP counts as a space before a comma.
    expect(only("word\u00A0, next", "commaPeriodSpacing")).toEqual([
      ["commaPeriodSpacing", "\u00A0,", [4, 6], ","],
    ]);
  });

  test("line boundaries and CRLF-free multi-line text", () => {
    expect(
      summary(review("one teh\nteh two", { enabledRules: ["englishTypoWhitelistCorrection"] })),
    ).toEqual([
      ["englishTypoWhitelistCorrection", "teh", [4, 7], "the"],
      ["englishTypoWhitelistCorrection", "teh", [8, 11], "the"],
    ]);
  });

  test("the last word is analyzed at end of input without an appended delimiter", () => {
    const text = "we saw teh";
    const [finding] = review(text, { enabledRules: ["englishTypoWhitelistCorrection"] });
    expect(finding.range).toEqual({ start: 7, end: 10 });
    expect(fixOne(text, finding)).toBe("we saw the");
  });

  test("repeated phrases get distinct identities", () => {
    const findings = review("teh a teh", { enabledRules: ["englishTypoWhitelistCorrection"] });
    expect(findings.map((d) => d.range.start)).toEqual([0, 6]);
    expect(new Set(findings.map((d) => d.id)).size).toBe(2);
  });
});

describe("review scope and protection", () => {
  test("a partial selection keeps surrounding context and edits only inside it", () => {
    const text = "Done. then teh end";
    // Scope is "then teh": the sentence start is known from context outside it.
    const findings = review(text, {}, { scope: { start: 6, end: 14 } });
    expect(summary(findings)).toEqual([
      ["capitalizeSentenceStart", "t", [6, 7], "T"],
      ["englishTypoWhitelistCorrection", "teh", [11, 14], "the"],
    ]);
    // A selection starting mid-word must not report the partial word.
    expect(
      review(
        "xteh teh",
        { enabledRules: ["englishTypoWhitelistCorrection"] },
        { scope: { start: 1, end: 4 } },
      ),
    ).toEqual([]);
    // A selection that does not start a sentence gets no sentence-start finding.
    expect(
      review(
        "hello there. ok",
        { enabledRules: ["capitalizeSentenceStart"] },
        { scope: { start: 6, end: 11 } },
      ),
    ).toEqual([]);
    // Findings crossing the scope end are dropped.
    expect(
      review(
        "their is",
        { enabledRules: ["englishTheirThereBeVerb"] },
        { scope: { start: 0, end: 5 } },
      ),
    ).toEqual([]);
  });

  test("inline and fenced Markdown code is skipped without joining prose across it", () => {
    const text = "Run `their is teh` now.\n```\nteh\n```\nand teh";
    expect(
      summary(
        review(text, {
          enabledRules: ["englishTypoWhitelistCorrection", "englishTheirThereBeVerb"],
        }),
      ),
    ).toEqual([["englishTypoWhitelistCorrection", "teh", [40, 43], "the"]]);
    // "i `x` has": the code span must not glue "i" to "has".
    expect(
      review("so i `x` has time", { enabledRules: ["englishPronounVerbWhitelistAgreement"] }),
    ).toEqual([]);
    const result = detectReviewDiagnostics(
      { id: "s", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
      options(),
    );
    // "`their is teh`" and the three-line fence, newlines included.
    expect(result.coverage.skipped.code).toBe(14 + 11);
  });

  test("adapter-protected ranges (DOM code, Quill code blocks, structure) are never edited", () => {
    const text = "teh cat teh\nteh";
    const findings = review(
      text,
      { enabledRules: ["englishTypoWhitelistCorrection"] },
      {
        protectedRanges: [
          { start: 8, end: 11, reason: "code" },
          { start: 11, end: 12, reason: "structure" },
        ],
      },
    );
    expect(findings.map((d) => d.range.start)).toEqual([0, 12]);
    // A phrase may not cross a structural boundary (a block break in rich text).
    expect(
      review(
        "so i\nhas time",
        { enabledRules: ["englishPronounVerbWhitelistAgreement"] },
        {
          protectedRanges: [{ start: 4, end: 5, reason: "structure" }],
        },
      ),
    ).toEqual([]);
  });

  test("formatting-only changes produce different results for the same text", () => {
    const text = "we saw teh cat";
    const prose = review(text, { enabledRules: ["englishTypoWhitelistCorrection"] });
    const code = review(
      text,
      { enabledRules: ["englishTypoWhitelistCorrection"] },
      {
        protectedRanges: [{ start: 7, end: 10, reason: "code" }],
      },
    );
    expect(prose).toHaveLength(1);
    expect(code).toEqual([]);
  });

  test("URLs, e-mail, paths, mentions and identifiers are protected", () => {
    expect(
      review("see https://x.io/teh , mail teh@x.io , path /tmp/teh , @teh , user.teh", {
        enabledRules: ["englishTypoWhitelistCorrection"],
      }),
    ).toEqual([]);
  });

  test("bounded processing: line-aligned chunks cover the scope exactly once", () => {
    const line = "teh cat sat on the mat and then left the room quietly.\n";
    const text = line.repeat(Math.ceil(12_000 / line.length));
    const prepared = prepareReview(
      { id: "s", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
      options({ enabledRules: ["englishTypoWhitelistCorrection"] }),
    );
    const chunks = reviewChunks(prepared);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0].start).toBe(0);
    expect(chunks.at(-1)!.end).toBe(text.length);
    for (let i = 1; i < chunks.length; i += 1) {
      expect(chunks[i].start).toBe(chunks[i - 1].end);
      expect(text[chunks[i].start - 1]).toBe("\n");
    }
    const chunked = finalizeReview(
      prepared,
      chunks.map((chunk) => scanReviewChunk(prepared, chunk)),
    );
    const whole = detectReviewDiagnostics(prepared.snapshot, prepared.options);
    expect(chunked.diagnostics).toEqual(whole.diagnostics);
    expect(whole.diagnostics).toHaveLength(text.split("teh").length - 1);
    expect(MAX_REVIEW_CHARS).toBeGreaterThanOrEqual(10_000);
  });

  test("chunked scanning finds exactly what one whole-text scan finds, for every rule", () => {
    const paragraph = [
      "i think teh meeting went well , and alot of people came.",
      "Their is a problem; we should of fixed it  sooner,, right..",
      "Thanks, your welcome. i has a question about a apple and an umbrella.",
      "The price is 5$ and we meet on monday, may 15 in the 2th week at 10kg.",
      "Here is `const x = teh;` and https://example.com/teh?alot=1 in text.",
      "We left in may, and i cant go; she is taller than i.",
    ].join(" ");
    // Short lines, then one long line: chunks end at line ends and, inside the
    // long line, at spaces mid-paragraph, where findings cross the boundary.
    let text = "";
    for (let i = 0; text.length < 12_000; i += 1) {
      text += i % 3 === 0 ? `${paragraph}\n` : `${paragraph} `;
    }
    text += `\n${paragraph} `.repeat(1) + `${paragraph} `.repeat(60);
    const prepared = prepareReview(
      { id: "s", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
      options(),
    );
    const chunks = reviewChunks(prepared);
    expect(chunks.length).toBeGreaterThan(5);
    const chunked = finalizeReview(
      prepared,
      chunks.map((chunk) => scanReviewChunk(prepared, chunk)),
    );
    const whole = finalizeReview(prepared, [
      scanReviewChunk(prepared, { start: 0, end: text.length }),
    ]);
    expect(chunked.diagnostics.length).toBeGreaterThan(400);
    expect(chunked.diagnostics).toEqual(whole.diagnostics);
  });

  test("a finding that crosses a chunk boundary is found by the chunk it starts in", () => {
    for (const [phrase, ruleId] of [
      ["Thanks, your welcome.", "englishYourWelcomeCorrection"],
      ["we should of been", "englishModalOfCorrection"],
      ["and their is more", "englishTheirThereBeVerb"],
      ["she said i has more", "englishPronounVerbWhitelistAgreement"],
      ["it was a apple", "englishArticleAnCorrection"],
      ["we met on may 15 then", "englishProperNounCapitalization"],
    ] as const) {
      // One line, so the first chunk ends at the first space at or after
      // REVIEW_CHUNK_CHARS: right after the phrase's second-to-last word.
      const lastSpace = phrase.lastIndexOf(" ");
      const padding = "x".repeat(REVIEW_CHUNK_CHARS - lastSpace - 1);
      const text = `${padding} ${phrase} Ok.`;
      const prepared = prepareReview(
        { id: "s", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
        options(),
      );
      const chunks = reviewChunks(prepared);
      expect(chunks[0].end).toBe(REVIEW_CHUNK_CHARS + 1);
      expect(text.slice(chunks[0].end)).toStartWith(phrase.slice(lastSpace + 1));
      const chunked = finalizeReview(
        prepared,
        chunks.map((chunk) => scanReviewChunk(prepared, chunk)),
      );
      expect(chunked.diagnostics.map((d) => d.ruleId)).toContain(ruleId);
    }
  });

  test("a long single line is still split into bounded chunks", () => {
    const text = "one teh two ".repeat(2_000);
    const prepared = prepareReview(
      { id: "s", text, scope: { start: 0, end: text.length }, protectedRanges: [] },
      options({ enabledRules: ["englishTypoWhitelistCorrection"] }),
    );
    const chunks = reviewChunks(prepared);
    expect(chunks.length).toBeGreaterThan(4);
    for (const chunk of chunks) {
      expect(chunk.end - chunk.start).toBeLessThanOrEqual(2 * REVIEW_CHUNK_CHARS);
      if (chunk.end < text.length) expect(text[chunk.end - 1]).toBe(" ");
    }
    const result = finalizeReview(
      prepared,
      chunks.map((chunk) => scanReviewChunk(prepared, chunk)),
    );
    expect(result.diagnostics).toHaveLength(2_000);
  });

  test("a throwing detector is reported as a coverage gap, not as no issues", () => {
    const prepared = prepareReview(
      { id: "s", text: "teh", scope: { start: 0, end: 3 }, protectedRanges: [] },
      options({ enabledRules: ["englishTypoWhitelistCorrection"] }),
    );
    const scan = scanReviewChunk(prepared, { start: 0, end: 3 });
    const result = finalizeReview(prepared, [
      { findings: [], failedRules: ["englishTypoWhitelistCorrection"] },
      scan,
    ]);
    expect(result.coverage.failedRules).toEqual(["englishTypoWhitelistCorrection"]);
    expect(result.coverage.skipped["rule-error"]).toBe(1);
  });
});
