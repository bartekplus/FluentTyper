import { describe, expect, test } from "bun:test";
import { GRAMMAR_RULE_IDS } from "../../src/core/domain/grammar/ruleCatalog";
import {
  detectReviewDiagnostics,
  prepareReview,
  spellingDiagnostic,
} from "../../src/core/domain/grammar/review/reviewDiagnostics";
import {
  parseSpellingRequest,
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

  test("a selection looks up only the whole words it contains", () => {
    const scoped = (text: string, start: number, end: number) =>
      spellingCandidates(
        prepareReview({ id: "s", text, scope: { start, end }, protectedRanges: [] }, options()),
        [],
      ).map((candidate) => [candidate.word, candidate.range.start]);
    // Starting inside "carefully" (or inside "don't"): the cut word is not a word.
    expect(scoped("carefully done", 1, 14)).toEqual([["done", 10]]);
    expect(scoped("I don't know", 6, 12)).toEqual([["know", 8]]);
    // The whole word selected: looked up.
    expect(scoped("so carefully done", 3, 12)).toEqual([["carefully", 3]]);
    // Ending inside a word: that word is left out too.
    expect(scoped("done carefully", 0, 8)).toEqual([["done", 0]]);
    // A decomposed accent is part of its word, not a boundary.
    expect(scoped("cafe\u0301 ok", 0, 8).map(([word]) => word)).toEqual(["cafe\u0301", "ok"]);
  });

  test("words with combining marks are looked up composed, in a request the background accepts", () => {
    const text = "We visited the cafe\u0301 today, then teh caf\u00e9, and read हिंदी.";
    const candidates = spellingCandidates(prepared(text), []);
    const byWord = new Map(candidates.map((c) => [c.word, c]));
    // Decomposed: looked up as the composed word; the range still covers what was written.
    const decomposed = byWord.get("cafe\u0301")!;
    expect(decomposed.lookup).toBe("caf\u00e9");
    expect(text.slice(decomposed.range.start, decomposed.range.end)).toBe("cafe\u0301");
    // Devanagari vowel signs are combining marks too.
    expect(byWord.get("हिंदी")!.lookup).toBe("हिंदी");
    // The request the session sends is accepted whole.
    const request = {
      lang: "en_US",
      words: candidates.map(({ lookup, before }) => ({ word: lookup, before })),
    };
    expect(parseSpellingRequest(request)?.words).toHaveLength(candidates.length);
    // A decomposed accent is one edit away from its composed suggestion, like any other.
    expect(rankSpellingSuggestions("cafe\u0301e", ["caf\u00e9"])).toEqual(["caf\u00e9"]);
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
