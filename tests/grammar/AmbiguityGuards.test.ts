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
    // Suffixes and signs, not arithmetic.
    "100+ users ",
    "Requires Node 18+ to run ",
    "Call +1 555 123 4567 ",
    // Flags, env vars and query strings, not assignment spacing.
    "Run --port=8080 now ",
    "FOO=bar npm start ",
    // A markdown checkbox, not an empty bracket pair.
    "- [ ] todo item ",
    // A label, not a URL scheme.
    "Path: /home/user ",
    // Titles and company forms are abbreviations.
    "Mr. and Mrs. Smith ",
    "Apple Inc. is a company ",
    "John Smith, Ph.D. is here ",
    // A capitalized name, not a missing apostrophe.
    "Jony Ive said ",
    // Consecutive periods: a relative path or an ellipsis, never sentence spacing.
    "Spread [...arr] here ",
    "Call f(...args) now ",
    "Hmm... ok ",
    "Ratio 1.5 and 2.5 ",
    // Dotted identifiers, paths and mentions: a period inside a token is not a
    // sentence end, and its first letter is not a sentence start.
    "Hello.world ",
    "google.com ",
    "node.js ",
    "README.md ",
    "user.save() ",
    "@john.doe ",
    "Open src/index.ts ",
    "Path ../../src here ",
    // Articles by sound, not by first letter: all already correct.
    "It took an hour ",
    "She is a university student ",
    "We need a user account ",
    "It is a one-time fee ",
    "An honest answer ",
    "A euro coin ",
    "An unimportant detail ",
    "A unicorn appeared ",
    "Take an x-ray ",
    // Names, acronyms and numbers: pronunciation is a guess, so no edit.
    "We met a Uber driver ",
    "Write an sql query ",
    "Get an mri scan ",
    "Sign an nda first ",
    "It was a 8 hour day ",
    // The letter "a", not the article.
    "Pick option a or b ",
    "Grade A apples ",
    "Plan A is fine ",
    "Let a equals b ",
  ])
    test(input, () => expect(type(input)).toBe(input));

  // Every keystroke is checked, so the text is not corrupted before a whole
  // token exists for a detector to see.
  test("technical tokens survive every intermediate keystroke", () => {
    for (const input of ["Go to google.com now ", "user.save() now ", "Path ../../src here "])
      for (let end = 1; end <= input.length; end += 1)
        expect(type(input.slice(0, end))).toBe(input.slice(0, end));
  });
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
    ["This is a error. ", "This is an error. "],
    ["It took a hour. ", "It took an hour. "],
    ["She is an university student ", "She is a university student "],
    ["We need an user account ", "We need a user account "],
    ["a apple a day ", "An apple a day "],
    // ponytail: hyphenated compounds are skipped even when wrong.
    ["It was an one-off ", "It was an one-off "],
    ["He is an good man ", "He is a good man "],
    ["an year ago ", "A year ago "],
    ["Wait a hour, ok ", "Wait an hour, ok "],
    ["It is a umbrella ", "It is an umbrella "],
    ["Buy an euro coin ", "Buy a euro coin "],
    ["Hello. A error occurred ", "Hello. An error occurred "],
    // "i"/"it" are identifiers here: only the sentence-start capital changes,
    // the identifiers and their verbs are left exactly as typed.
    ["for i in range(10) ", "For i in range(10) "],
    ["print(i) if i is not None ", "Print(i) if i is not None "],
    ["it are null here ", "It are null here "],
    ["if i is None then ", "If i is None then "],
    ["when i = 3 then ", "When i = 3 then "],
    // Only the sentence-start capital changes; brackets and links are intact.
    ["set x = {a: 1} now ", "Set x = {a: 1} now "],
    // A sentence period is never spaced by the rule; the user's space after
    // it (or a stray one before it) is all the confirmation there is.
    ["Hello.", "Hello."],
    ["this is awsome. ", "This is awsome. "],
    ["Hello . ", "Hello. "],
    ["Hello. world ", "Hello. World "],
    ["see [link](http://x.test) here ", "See [link](http://x.test) here "],
    // A citation followed by a parenthesis: the user's space stays.
    ["see [1] (the paper) ", "See [1] (the paper) "],
    // "d" and "g" are not a day and a gram in prose.
    ["a 3d printer ", "A 3d printer "],
    ["the 5g network ", "The 5g network "],
    // ponytail: known-wrong. "Chapter 3: 5 tips" reads as a clock because the
    // minute digit that would disprove it is not typed yet.
    ["Chapter 3: 5 tips ", "Chapter 3:5 tips "],
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
  for (const lang of [
    "fr_FR",
    "de_DE",
    "pl_PL",
    "es_ES",
    "sv_SE",
    "el_GR",
    "hr_HR",
    "pt_BR",
    "ar_SA",
  ])
    for (const input of [
      "Il a dit : oui ",
      "Prix 1,50 euros ",
      "Kosten 1.234,56 Euro ",
      "Zobacz [link](http://x.test) tutaj ",
      "Tekst (cicho) dziala ",
    ])
      test(`${lang} ${input}`, () => expect(type(input, lang)).toBe(input));

  test("ordinals keep their period", () => {
    expect(type("der 1. und 2. Platz ", "de_DE")).toBe("Der 1. und 2. Platz ");
    expect(type("el 1.\u00ba de mayo ", "es_ES")).toBe("El 1.\u00ba de mayo ");
    expect(type("np. to jest ", "pl_PL")).toBe("Np. to jest ");
  });

  test("a space before a comma is still removed in every locale", () => {
    expect(type("Bonjour , le monde ", "fr_FR")).toBe("Bonjour, le monde ");
  });
});

describe("Arabic punctuation", () => {
  test("default rules leave well-formed Arabic prose unchanged", () => {
    for (const input of [
      "\u0643\u062a\u0627\u0628\u060c \u0642\u0644\u0645\u061f ",
      "\u0646\u0639\u0645\u061b \u0644\u0627 ",
      '\u0642\u0627\u0644 "\u0645\u0631\u062d\u0628\u0627" \u0644\u0647 ',
    ])
      expect(type(input, "ar_SA")).toBe(input);
  });

  test("opt-in rules treat Arabic punctuation like its Latin forms", () => {
    const all = GRAMMAR_RULE_IDS;
    expect(type("\u0643\u062a\u0627\u0628\u060c \u0642\u0644\u0645\u061f ", "ar_SA", all)).toBe(
      "\u0643\u062a\u0627\u0628\u060c \u0642\u0644\u0645\u061f ",
    );
    expect(type("\u0643\u062a\u0627\u0628\u060c\u060c \u0642\u0644\u0645 ", "ar_SA", all)).toBe(
      "\u0643\u062a\u0627\u0628\u060c \u0642\u0644\u0645 ",
    );
    expect(type("\u0646\u0639\u0645\u061b\u061b \u0644\u0627 ", "ar_SA", all)).toBe(
      "\u0646\u0639\u0645\u061b \u0644\u0627 ",
    );
  });

  test("a space before an Arabic comma is removed like before a Latin comma", () => {
    expect(type("\u0643\u062a\u0627\u0628 \u060c \u0642\u0644\u0645 ", "ar_SA")).toBe(
      "\u0643\u062a\u0627\u0628\u060c \u0642\u0644\u0645 ",
    );
  });
});
