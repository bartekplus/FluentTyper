import { describe, expect, test } from "bun:test";
import { GRAMMAR_RULE_IDS } from "../../src/core/domain/grammar/ruleCatalog";
import { spellingDiagnostic } from "../../src/core/domain/grammar/review/reviewFindings";
import {
  otherLanguageParagraphs,
  parseSpellingRequest,
  rankSpellingSuggestions,
  spellingCandidates,
} from "../../src/core/domain/grammar/review/reviewSpelling";
import type {
  ProtectedRange,
  ReviewOptions,
  ReviewSourceSnapshot,
} from "../../src/core/domain/grammar/review/types";
import { prepared as prepare, review } from "./grammarTestUtils";

const prepared = (
  text: string,
  extra: Partial<ReviewSourceSnapshot> = {},
  overrides: Partial<ReviewOptions> = {},
) => prepare(text, extra, { enabledRules: GRAMMAR_RULE_IDS, ...overrides });

function words(
  text: string,
  overrides: Partial<ReviewOptions> = {},
  protectedRanges: ProtectedRange[] = [],
) {
  return spellingCandidates(prepared(text, { protectedRanges }, overrides), []).map((c) => c.word);
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
      spellingCandidates(prepared(text, { scope: { start, end } }), []).map((candidate) => [
        candidate.word,
        candidate.range.start,
      ]);
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
    // Presage's composed suggestion is offered for the original spelling.
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
  test("Presage's single-word corrections keep their order without an edit cutoff", () => {
    // Presage's candidates for "Where wa", in its order.
    const presage = ["was", "way", "want", "wanted", "water", "war", "walked", "walk"];
    expect(rankSpellingSuggestions("wa", presage)).toEqual([
      "was",
      "way",
      "want",
      "wanted",
      "water",
    ]);
    expect(
      rankSpellingSuggestions("recieve", [
        "receive",
        "relieve",
        "receiver",
        "reverie",
        "Recife",
        "received",
      ]),
    ).toEqual(["receive", "relieve", "receiver", "reverie", "Recife"]);
    // Multi-word candidates are never offered as replacements.
    expect(rankSpellingSuggestions("colr", ["color", "co lr", "col-r"])).toEqual(["color"]);
    expect(rankSpellingSuggestions("Bartek", ["barter", "Bartok"])).toEqual(["Barter", "Bartok"]);
    expect(rankSpellingSuggestions("Fluenttyper", ["Fluently", "Superfluity"])).toEqual([
      "Fluently",
      "Superfluity",
    ]);
    // A split ranked first suggests a correct compound missing from the dictionary.
    expect(
      rankSpellingSuggestions("changelog", ["change log", "change-log", "changeling", "change"]),
    ).toEqual([]);
    expect(rankSpellingSuggestions("webhook", ["web hook", "weblog"])).toEqual([]);
    expect(rankSpellingSuggestions("needeed", ["needed", "nee deed", "nee-deed"])).toEqual([
      "needed",
    ]);
    expect(rankSpellingSuggestions("needdeed", ["needed", "need deed", "need-deed"])).toEqual([
      "needed",
    ]);
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
    expect(rankSpellingSuggestions("Thsi", ["this", "thus", "tsi"])).toEqual([
      "This",
      "Thus",
      "Tsi",
    ]);
    expect(
      rankSpellingSuggestions("bat", ["bad", "bag", "ban", "bar", "bay", "bet", "bit"]),
    ).toHaveLength(5);
  });

  test("an English regular ending on an irregular stem offers the irregular form first", () => {
    const en = (word: string, candidates: string[] = []) =>
      rankSpellingSuggestions(word, candidates, "en_US");
    expect(en("finded", ["fined", "fender"])).toEqual(["found", "fined", "fender"]);
    expect(en("Buyed", ["Bayed"])).toEqual(["Bought", "Bayed"]);
    // A doubled final consonant and a dropped silent "e".
    expect(en("runned", ["runner"])).toEqual(["ran", "run", "runner"]);
    expect(en("resetted")).toEqual(["reset"]);
    expect(en("digged")).toEqual(["dug"]);
    expect(en("writed")).toEqual(["wrote", "written"]);
    expect(en("feeded", ["fed"])).toEqual(["fed"]);
    expect(en("thinked")).toEqual(["thought"]);
    expect(en("goed")).toEqual(["went", "gone"]);
    // Plurals: "-s" and "-es".
    expect(en("childs", ["child's", "chills"])).toEqual(["children", "child's", "chills"]);
    expect(en("oxes")).toEqual(["oxen"]);
    expect(en("womans")).toEqual(["women"]);
    expect(en("criterions")).toEqual(["criteria"]);
    expect(en("Tooths")).toEqual(["Teeth"]);
    // Degree.
    expect(en("gooder", ["goodies"])).toEqual(["better", "goodies"]);
    expect(en("baddest")).toEqual(["worst"]);
    // An irregular form ranks ahead of a split, so the word is not taken for a compound.
    expect(en("childs", ["chi lds"])).toEqual(["children"]);
    expect(rankSpellingSuggestions("childs", ["chi lds"])).toEqual([]);
    // No guess: "lay" is two verbs, unknown stems, other languages and no language.
    expect(en("layed", ["laid"])).toEqual(["laid"]);
    expect(en("jumped")).toEqual([]);
    expect(en("colors")).toEqual([]);
    expect(en("s")).toEqual([]);
    expect(en("ed")).toEqual([]);
    expect(rankSpellingSuggestions("finded", ["fined"], "fr_FR")).toEqual(["fined"]);
    expect(rankSpellingSuggestions("finded", ["fined"])).toEqual(["fined"]);
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
    const found = review("Where wa it?", {}, { enabledRules: GRAMMAR_RULE_IDS }).diagnostics;
    expect(found).toEqual([]);
  });
});

describe("review spelling: paragraphs in another language", () => {
  // A stand-in English dictionary: the words these examples use correctly.
  const ENGLISH = new Set(
    "hi thanks for the notes i will send my reply tonight we got package this morning but address on label was wrong again die an so".split(
      " ",
    ),
  );

  function marked(text: string, scope = { start: 0, end: text.length }) {
    const review = prepared(text, { scope }, { enabledRules: [] });
    const lookups = spellingCandidates(review, []).map(({ range, lookup }) => ({
      range,
      known: ENGLISH.has(lookup.toLowerCase()),
    }));
    return otherLanguageParagraphs(review, lookups).map(({ start, end }) => text.slice(start, end));
  }

  const german = "Wir haben die Unterlagen gestern bekommen, aber die Adresse war leider falsch.";

  test("a paragraph with mostly unknown words is marked; the English ones around it are not", () => {
    const text = `Hi,\nThanks for the notes.\n${german}\nI will send my reply tonight.`;
    expect(marked(text)).toEqual([german]);
    // Also as the only paragraph, and cut to the reviewed scope.
    expect(marked(german)).toEqual([german]);
    const start = german.indexOf("gestern");
    expect(marked(german, { start, end: german.length })).toEqual([]);
    expect(marked(`${german}\n${german}`, { start: 4, end: german.length })).toEqual([
      german.slice(4),
    ]);
  });

  test("typos, even many of them, leave most words known: nothing is marked", () => {
    // 4 of 13 looked-up words misspelled.
    expect(
      marked("We got the pakage this mornign but the adress on the lable was wrong again."),
    ).toEqual([]);
    // Half the words unknown is still not another language.
    expect(marked("We got teh pakage this mornign but teh adress again")).toEqual([]);
  });

  test("too few looked-up words to tell: nothing is marked", () => {
    // Seven words, none known; capitalized nouns and names are never looked up.
    expect(marked("Danke, bis morgen und schönes Wochenende, Anna!")).toEqual([]);
    expect(marked("Viele Grüße aus Berlin und bis bald dann")).toEqual([]);
  });

  test("the threshold: under 40% known words", () => {
    // Ten looked-up words: three known is another language, four is not.
    const three = "die an so zwei drei vier fünf sechs sieben acht";
    const four = "die an so we drei vier fünf sechs sieben acht";
    expect(marked(three)).toEqual([three]);
    expect(marked(four)).toEqual([]);
  });
});
