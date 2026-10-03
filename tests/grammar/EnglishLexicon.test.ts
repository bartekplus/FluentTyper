import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { buildEnglishLexicon, LEXICON_SOURCES } from "../../scripts/generate-english-lexicon";
import {
  englishLexiconInflect,
  englishWordInfo,
} from "../../src/core/domain/grammar/implementations/helpers/EnglishLexicon";

test("the committed lexicon matches en_US.dic/.aff (bun run generate:english-lexicon)", async () => {
  const [dic, aff, committed] = await Promise.all(
    [LEXICON_SOURCES.dic, LEXICON_SOURCES.aff, LEXICON_SOURCES.out].map((path) =>
      readFile(path, "utf8"),
    ),
  );
  expect(buildEnglishLexicon(dic, aff)).toBe(committed);
});

// [word, "lemma:form ...", "classes"], or [word, null, ""] when the lexicon does not know it.
test.each([
  ["walk", "walk:base", "noun"],
  ["walks", "walk:third", "noun plural"],
  ["walked", "walk:past walk:participle", ""],
  ["walking", "walk:ing", "noun"],
  ["walker", "", "noun"],
  ["needs", "need:third", "noun plural"],
  ["fixed", "fix:past fix:participle", "adjective"],
  // Doubling, c -> ck, a kept -e and ie -> y, read from entries listed on their own.
  ["stopped", "stop:past stop:participle", ""],
  ["stopping", "stop:ing", ""],
  ["hopped", "hop:past hop:participle", ""],
  ["panicked", "panic:past panic:participle", ""],
  ["agreeing", "agree:ing", ""],
  ["dying", "die:ing", ""],
  ["dyeing", "dye:ing", ""],
  // The .aff spells hope's forms on hop/DG; the -e twin gets them back.
  ["hoped", "hope:past hope:participle", ""],
  ["hoping", "hope:ing", ""],
  ["deleted", "delete:past delete:participle", ""],
  ["visited", "visit:past visit:participle", ""],
  // car/D, fir/DG spell care's and fire's forms: a one-vowel base would double its own.
  ["car", "", "noun"],
  ["cared", "care:past care:participle", ""],
  ["fir", "", "noun"],
  ["met", "meet:past meet:participle", ""],
  // An -ly adjective with -ness (sisterly/P) is built on a noun; duly/solely make adjectives.
  ["sister", "", "noun"],
  ["sisterly", "", "adjective"],
  ["due", "", "noun adjective"],
  // Prefix flags: con+figure, re+visit, in+accessible.
  ["configured", "configure:past configure:participle", ""],
  ["revisited", "revisit:past revisit:participle", ""],
  ["inaccessible", "", "adjective"],
  // A noun reading crosses a prefix only where the dictionary spells its possessive (file's/K:
  // profile, crease/CM: decrease), an adjective only from a base that is not a verb.
  ["propose", "propose:base", ""],
  ["proposes", "propose:third", ""],
  ["remember", "remember:base", ""],
  ["profile", "profile:base", "noun"],
  ["decrease", "decrease:base", "noun"],
  ["prolong", "prolong:base", ""],
  ["refine", "refine:base", ""],
  ["unkind", "", "adjective"],
  // -ly and -est munching: truly is true's, earnest and honest are words of their own.
  ["try", "try:base", "noun"],
  ["truly", "", "adverb"],
  ["earn", "earn:base", ""],
  ["we", "", ""],
  ["later", "", "adjective"],
  // The irregular table.
  ["began", "begin:past", ""],
  ["begun", "begin:participle", ""],
  ["lay", "lay:base lie:past", "noun"],
  ["information", "", "noun"],
  ["informations", null, ""],
  ["such", "", ""],
  ["the", "", ""],
  ["day", "", "noun"],
  ["days", "", "noun plural"],
  ["nice", "", "adjective"],
  ["nicer", "", "adjective"],
  ["nicest", "", "adjective"],
  ["nicely", "", "adverb"],
  ["niceness", "", "noun"],
  ["happily", "", "adverb"],
  ["possibly", "", "adverb"],
  ["accessible", "", "adjective"],
  ["available", "", "adjective"],
  ["monthly", "", "adjective adverb"],
  ["fanged", "", "adjective"],
  ["deletion", "", "noun"],
  ["deletions", "", "noun plural"],
  ["series", "", "noun"],
  ["morning", "", "noun"],
  ["Walked", "walk:past walk:participle", ""],
  ["WALKS", "walk:third", "noun plural"],
  ["qwzx", null, ""],
  ["can't", null, ""],
] as [string, string | null, string][])("%p reads as %p %p", (word, verbs, classes) => {
  const info = englishWordInfo(word);
  if (verbs === null) return expect(info).toBeNull();
  expect(info!.verbs.map((v) => `${v.lemma}:${v.form}`).join(" ")).toBe(verbs);
  const kinds = (["noun", "plural", "adjective", "adverb"] as const).filter((k) => info![k]);
  expect(kinds.join(" ")).toBe(classes);
});

test.each([
  ["fix", "fixes", "fixed", "fixing"],
  ["stop", "stops", "stopped", "stopping"],
  ["panic", "panics", "panicked", "panicking"],
  ["visit", "visits", "visited", "visiting"],
  ["travel", "travels", "traveled", "traveling"],
  ["die", "dies", "died", "dying"],
  ["dye", "dyes", "dyed", "dyeing"],
  ["begin", "begins", "began", "beginning"],
  ["revisit", "revisits", "revisited", "revisiting"],
  // Known, not a base verb.
  ["such", null, null, null],
  ["combated", null, null, null],
  // Unknown: spelling rules decide.
  ["qwzx", undefined, undefined, undefined],
])("%p inflects to %p, %p, %p", (lemma, third, past, ing) => {
  expect(englishLexiconInflect(lemma, "third")).toBe(third);
  expect(englishLexiconInflect(lemma, "past")).toBe(past);
  expect(englishLexiconInflect(lemma, "ing")).toBe(ing);
});
