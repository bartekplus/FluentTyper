import { describe, expect, test } from "bun:test";
import { GRAMMAR_RULE_IDS } from "../../src/core/domain/grammar/ruleCatalog";
import {
  detectReviewDiagnostics,
  prepareReview,
  spellingDiagnostic,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";
import {
  rankSpellingSuggestions,
  spellingCandidates,
  spellingDistance,
} from "../../src/core/domain/grammar/review/reviewSpelling";
import type { ProtectedRange, ReviewOptions } from "../../src/core/domain/grammar/review/types";

function options(overrides: Partial<ReviewOptions> = {}): ReviewOptions {
  return {
    lang: "en_US",
    enabledRules: GRAMMAR_RULE_IDS,
    userDictionary: [],
    insertSpaceAfterAutocomplete: true,
    ...overrides,
  };
}

function prepared(
  text: string,
  overrides: Partial<ReviewOptions> = {},
  protectedRanges: ProtectedRange[] = [],
) {
  return prepareReview(
    { id: "s", text, scope: { start: 0, end: text.length }, protectedRanges },
    options(overrides),
  );
}

function words(
  text: string,
  overrides: Partial<ReviewOptions> = {},
  protectedRanges: ProtectedRange[] = [],
) {
  return spellingCandidates(prepared(text, overrides, protectedRanges), []).map((c) => c.word);
}

describe("review spelling: which words are looked up", () => {
  test("prose words are candidates, with up to two words of context from the same sentence", () => {
    const candidates = spellingCandidates(prepared("Where wa it? Then it went."), []);
    expect(candidates.map((c) => [c.word, c.before])).toEqual([
      ["Where", ""],
      ["wa", "Where "],
      ["it", "Where wa "],
      ["Then", ""],
      ["it", "Then "],
      ["went", "Then it "],
    ]);
    expect(candidates[1].range).toEqual({ start: 6, end: 8 });
  });

  test("names, acronyms, identifiers, compounds, code and the user's words are left out", () => {
    expect(
      words("We met Bartek and NASA at iPhone launch with user_name, v2x and co-op in email.com."),
    ).toEqual(["We", "met", "and", "at", "launch", "with", "and", "in"]);
    // A capitalized word opening a sentence or a line is still checked.
    expect(words("Thsi is.\nKrakow is")).toEqual(["Thsi", "is", "Krakow", "is"]);
    expect(words('"Thsi is" he said')).toEqual(["Thsi", "is", "he", "said"]);
    // A capitalized word quoted inside a sentence is treated like a name.
    expect(words('He said "Bartek" twice')).toEqual(["He", "said", "twice"]);
    // One-letter words and words beside protected text are not looked up.
    expect(words("a b wa", {}, [])).toEqual(["wa"]);
    expect(words("run teh now", {}, [{ start: 4, end: 7, reason: "code" }])).toEqual([
      "run",
      "now",
    ]);
    expect(words("my wa and wa", { userDictionary: ["WA"] })).toEqual(["my", "and"]);
  });

  test("words another finding already covers are not looked up again", () => {
    const review = prepared("We saw teh cat");
    expect(spellingCandidates(review, [{ start: 7, end: 10 }]).map((c) => c.word)).toEqual([
      "We",
      "saw",
      "cat",
    ]);
  });

  test("typographic apostrophes are looked up plain and kept in suggestions", () => {
    const [candidate] = spellingCandidates(prepared("dont’t"), []);
    expect(candidate.lookup).toBe("dont't");
    expect(rankSpellingSuggestions("dont’t", ["don't"])).toEqual(["don’t"]);
  });
});

describe("review spelling: suggestions", () => {
  test("distance counts one transposition as one step", () => {
    expect(spellingDistance("recieve", "receive")).toBe(1);
    expect(spellingDistance("wa", "was")).toBe(1);
    expect(spellingDistance("wa", "water")).toBe(3);
  });

  test("close corrections are kept, closest first; completions and phrases are dropped", () => {
    // Presage's candidates for "Where wa", in its order.
    const presage = ["was", "way", "want", "wanted", "water", "war", "walked", "walk"];
    expect(rankSpellingSuggestions("wa", presage)).toEqual(["was", "way", "war"]);
    expect(
      rankSpellingSuggestions("recieve", [
        "receive",
        "relieve",
        "receiver",
        "reverie",
        "Recife",
        "received",
      ]),
    ).toEqual(["receive", "relieve", "receiver", "received", "Recife"]);
    // Multi-word candidates are never offered as replacements.
    expect(rankSpellingSuggestions("colr", ["color", "co lr", "col-r"])).toEqual(["color"]);
    // Nothing close: nothing offered (a name, not a typo).
    expect(rankSpellingSuggestions("Bartek", ["barter", "Bartok"])).toEqual(["Barter", "Bartok"]);
    expect(rankSpellingSuggestions("Fluenttyper", ["Fluently", "Superfluity"])).toEqual([]);
    // A compound of two dictionary words is deliberate, not a typo; fragments are not words.
    expect(
      rankSpellingSuggestions("changelog", ["change log", "change-log", "changeling", "change"]),
    ).toEqual([]);
    expect(rankSpellingSuggestions("webhook", ["web hook", "weblog"])).toEqual([]);
    expect(rankSpellingSuggestions("occured", ["occurred", "occur ed", "occur-ed"])).toEqual([
      "occurred",
    ]);
    expect(rankSpellingSuggestions("definately", ["definitely", "defiantly"])).toEqual([
      "definitely",
      "defiantly",
    ]);
    expect(rankSpellingSuggestions("wa", ["wa", "WA"])).toEqual([]);
  });

  test("a capitalized word gets capitalized suggestions; at most five", () => {
    expect(rankSpellingSuggestions("Thsi", ["this", "thus", "tsi"])).toEqual(["This", "Tsi"]);
    expect(
      rankSpellingSuggestions("bat", ["bad", "bag", "ban", "bar", "bay", "bet", "bit"]),
    ).toHaveLength(5);
  });
});

describe("review spelling: findings", () => {
  test("an unknown word is a pick-one finding: several alternatives, none applied, not batched", () => {
    const text = "Where wa it?";
    const review = prepared(text);
    const [, candidate] = spellingCandidates(review, []);
    const diagnostic = spellingDiagnostic(review, candidate, ["was", "way", "war"])!;
    expect(diagnostic).toMatchObject({
      ruleId: "reviewSpelling",
      category: "spelling",
      messageKey: "review_msg_unknown_word",
      original: "wa",
      range: { start: 6, end: 8 },
      requiresChoice: true,
      dictionaryWord: "wa",
      bulk: { eligible: false },
    });
    expect(diagnostic.alternatives.map((a) => a.preview)).toEqual(["was", "way", "war"]);
    expect(diagnostic.alternatives[0].edits).toEqual([
      { start: 7, end: 8, original: "a", replacement: "as" },
    ]);
    // No suggestion, no finding.
    expect(spellingDiagnostic(review, candidate, [])).toBeNull();
  });

  test("the rule-based review is unchanged: spelling is a separate, later step", () => {
    const found = detectReviewDiagnostics(
      { id: "s", text: "Where wa it?", scope: { start: 0, end: 12 }, protectedRanges: [] },
      options(),
    ).diagnostics;
    expect(found).toEqual([]);
  });
});
