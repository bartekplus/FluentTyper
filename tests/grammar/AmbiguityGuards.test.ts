import { describe, expect, test } from "bun:test";
import { GrammarRuleEngine } from "../../src/core/domain/grammar/GrammarRuleEngine";
import { applyGrammarEditToContext } from "../../src/core/domain/grammar/GrammarEditSequencing";
import { createGrammarRuleCatalogRuntime } from "../../src/core/domain/grammar/ruleFactory";
import {
  DEFAULT_CURRENT_GRAMMAR_RULES,
  GRAMMAR_RULE_IDS,
} from "../../src/core/domain/grammar/ruleCatalog";
import type { GrammarContext } from "../../src/core/domain/grammar/types";

/** Types `input` one character at a time through the given rules. */
function type(
  input: string,
  lang = "en_US",
  rules: readonly string[] = DEFAULT_CURRENT_GRAMMAR_RULES,
): string {
  const engine = new GrammarRuleEngine();
  for (const rule of createGrammarRuleCatalogRuntime({
    insertSpaceAfterAutocomplete: true,
    userDictionaryList: [],
  }))
    engine.registerRule(rule);
  let context: GrammarContext = {
    beforeCursor: "",
    afterCursor: "",
    hints: { lang, inputAction: "insert", measurementContext: "prose" },
  };
  for (const char of input) {
    context.beforeCursor += char;
    const edits = engine.process(
      char === " " || char === "\n" ? "wordBoundary" : "insertChar",
      context,
      [...rules],
    );
    for (const edit of edits) context = applyGrammarEditToContext(context, edit);
  }
  return context.beforeCursor;
}

describe("default-on rules never rewrite ambiguous input", () => {
  for (const input of [
    // Abbreviations, not sentence ends.
    "Use fruit e.g. apples and pears ",
    "Use fruit i.e. apples here ",
    "Buy milk etc. and bread ",
    "Java vs. python here ",
    "We left at 5 p.m. and came back ",
    // "of course" after a modal is valid English.
    "You must of course agree ",
    "We should of course try ",
    "They could of necessity leave ",
    // Possessive "your", not the phrase.
    "Your welcome package arrived ",
    // Ordinary English words that look like contractions.
    "I feel ill today ",
    "As is his wont he left ",
    "The cant of the deck ",
    // Acronym, not a contraction.
    "Please IM me later ",
    // A sentence boundary, not a decimal.
    "We sold 12. 5 were returned ",
    // An auto-inserted space plus the user's own must not become ". ".
    "He said (quietly) that it works ",
    "Call foo(bar) now ",
    "Use arr[0] here ",
    // Consecutive periods: a relative path or an ellipsis, never sentence spacing.
    "Spread [...arr] here ",
    "Call f(...args) now ",
    "Hmm... ok ",
    "Ratio 1.5 and 2.5 ",
  ])
    test(input, () => expect(type(input)).toBe(input));
});

describe("unambiguous corrections still apply", () => {
  for (const [input, expected] of [
    ["and so did i. Then we left ", "And so did I. Then we left "],
    ["They could of gone ", "They could have gone "],
    ["Your welcome! ", "You're welcome! "],
    ["I dont know ", "I don't know "],
    ["im going now ", "I'm going now "],
    ["I have alot to do ", "I have a lot to do "],
    ["Their is a problem ", "There is a problem "],
    ["Meeting at 9: 30 today ", "Meeting at 9:30 today "],
    ["we sold 2026. next year ", "We sold 2026. Next year "],
    ["i think i am right ", "I think I am right "],
    ["so do i, and you ", "So do I, and you "],
    ["i was there too ", "I was there too "],
    ["i is wrong here ", "I am wrong here "],
    ["he are going ", "He is going "],
    // "i"/"it" are identifiers here: only the sentence-start capital changes,
    // the identifiers and their verbs are left exactly as typed.
    ["for i in range(10) ", "For i in range(10) "],
    ["print(i) if i is not None ", "Print(i) if i is not None "],
    ["it are null here ", "It are null here "],
    ["if i is None then ", "If i is None then "],
    ["when i = 3 then ", "When i = 3 then "],
    // Only the sentence-start capital changes; brackets and links are intact.
    ["set x = {a: 1} now ", "Set x = {a: 1} now "],
    // A sentence period is still spaced on the very next keystroke.
    ["Hello.", "Hello. "],
    ["this is awsome.", "This is awsome. "],
    // A stray space before a period is still tidied on the spot.
    ["Hello .", "Hello. "],
    // ponytail: the periods survive, but the space before a relative path is
    // eaten by that same cleanup. Better than "Path. ./. ./src"; not perfect.
    ["Path ../../src here ", "Path../../src here "],
    ["see [link](http://x.test) here ", "See [link](http://x.test) here "],
  ])
    test(input, () => expect(type(input)).toBe(expected));
});

describe("advanced opt-in rules never rewrite code punctuation", () => {
  const all = GRAMMAR_RULE_IDS;
  for (const input of [
    // "::" is a scope operator, not a doubled colon.
    "Std::vector<int> x ",
    "Ratio a::b here ",
    // Spread syntax, not an ellipsis.
    "Spread [...arr] here ",
    "Call f(...args) now ",
  ])
    test(input, () => expect(type(input, "en_US", all)).toBe(input));

  test("the prose forms still convert", () => {
    expect(type("Hmm... ok ", "en_US", all)).toBe("Hmm\u2026 ok ");
    expect(type("Csv a,,b here ", "en_US", all)).toBe("Csv a, b here ");
  });
});

describe("non-English locales keep their punctuation", () => {
  for (const lang of ["fr_FR", "de_DE", "pl_PL", "es_ES", "sv_SE", "el_GR", "hr_HR", "pt_BR"])
    for (const input of [
      "Il a dit : oui ",
      "Prix 1,50 euros ",
      "Kosten 1.234,56 Euro ",
      "Zobacz [link](http://x.test) tutaj ",
      "Tekst (cicho) dziala ",
    ])
      test(`${lang} ${input}`, () => expect(type(input, lang)).toBe(input));

  test("a space before a comma is still removed in every locale", () => {
    expect(type("Bonjour , le monde ", "fr_FR")).toBe("Bonjour, le monde ");
  });
});
