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

describe("measurement formatting on indented lines", () => {
  // Indentation is not treated as code: code mode is the user's switch.
  test("formats an indented sentence", () =>
    expect(type("\tThe box weighs 5kg ")).toBe("\tThe box weighs 5\u00a0kg "));
});

describe("comma/period spacing never adds a space before a closing quote", () => {
  for (const input of ['"Hi," he said ', 'She said "stop." Then ', "He wrote “done.” Ok "])
    test(input, () => expect(type(input)).toBe(input));

  // Markdown code and punctuation-only quotes keep their meaningful spaces.
  const withoutCommaPeriod = DEFAULT_CURRENT_GRAMMAR_RULES.filter(
    (id) => id !== "commaPeriodSpacing",
  );
  for (const input of [
    'const separator = ", " ',
    'const padding = ". " ',
    '`a, "b, "` ',
    '```\nx = ", "\n```',
    'foo(a, ", ") ',
    '{"sep": ", "} ',
    // No punctuation-only quote, and no statement keyword, is ever dialogue.
    'return ". " ',
    'yield ". " ',
    'sep: ". " ',
    'x: ", " ',
  ])
    test(`leaves the literal ${JSON.stringify(input)}`, () =>
      expect(type(input)).toBe(type(input, "en_US", withoutCommaPeriod)));

  // Dialogue after ", " or ": " is prose, not a string literal.
  for (const input of [
    'He said, "Hi," she replied ',
    'He said: "No," and left ',
    'When she said, "Hi," he left ',
    'If he says "no," stop ',
    'Let him say "yes," then go ',
  ])
    test(`closes dialogue tight ${JSON.stringify(input)}`, () => expect(type(input)).toBe(input));

  // An inch mark after a digit is not a quote, so the next " opens one.
  for (const input of ['The 5" screen. "Next" ', 'He is 6" tall, "really" '])
    test(`keeps the space after an inch mark ${JSON.stringify(input)}`, () =>
      expect(type(input)).toBe(input));

  // A " after a digit inside an open quote may close it or be an inch mark:
  // too ambiguous to pair the next quote, so nothing is trimmed.
  for (const input of [
    'He said "5". "Next" ',
    'The year "2026". "Next" ',
    'He said "Room 5". "Next" ',
    'She wrote "Size 6", "ok" ',
  ])
    test(`keeps the space after a quoted number ${JSON.stringify(input)}`, () =>
      expect(type(input)).toBe(input));

  // Normal comma spacing before an ordinary word is untouched.
  test("normal comma spacing still applies", () => {
    expect(type("a,b ")).toBe("A, b ");
  });

  // An opening quote right after a comma/period is not a closing quote: only
  // an unmatched " or " earlier in the paragraph makes the current one a
  // closer, so these keep their space, straight or curly, default pipeline
  // or all rules on (smart-quote normalization included, which is why the
  // quote characters differ between the two expectations below).
  for (const [input, allRulesExpected] of [
    ['He said, "hello" ', "He said, “hello” "],
    ['End. "Next" one ', "End. “Next” one "],
    ["He said, 'hi' ", "He said, ‘hi’ "],
  ] as const) {
    test(`keeps the space before an opening quote ${JSON.stringify(input)}`, () =>
      expect(type(input)).toBe(input));
    test(`keeps the space before an opening quote, all rules ${JSON.stringify(input)}`, () =>
      expect(type(input, "en_US", GRAMMAR_RULE_IDS)).toBe(allRulesExpected));
  }
});

describe("opt-in a/an correction", () => {
  const withRule = [...DEFAULT_CURRENT_GRAMMAR_RULES, "englishArticleAnCorrection"];

  for (const [input, expected] of [
    ["This is a error. ", "This is an error. "],
    ["It took a hour. ", "It took an hour. "],
    ["She is an university student ", "She is a university student "],
    ["We need an user account ", "We need a user account "],
    ["a apple a day ", "An apple a day "],
    ["We need an unit ", "We need a unit "],
    ["I have a umbrella ", "I have an umbrella "],
    ["He is an good man ", "He is a good man "],
    ["an year ago ", "A year ago "],
    ["Wait a hour, ok ", "Wait an hour, ok "],
    ["It is a umbrella ", "It is an umbrella "],
    ["Buy an euro coin ", "Buy a euro coin "],
    ["Hello. A error occurred ", "Hello. An error occurred "],
    ["This is a error in `code` here ", "This is an error in `code` here "],
    ["He said it's a error ", "He said it's an error "],
    ["```\ncode\n```\nThis is a error ", "```\ncode\n```\nThis is an error "],
  ])
    test(`corrects ${JSON.stringify(input)}`, () =>
      expect(type(input, "en_US", withRule)).toBe(expected));

  // Every keystroke, full default pipeline with the rule on versus off, so only
  // this rule's edits are judged.
  for (const input of [
    // Already correct: articles follow sound, not spelling.
    "It took an hour ",
    "She is a university student ",
    "We need a user account ",
    "An honest answer ",
    "A euro coin ",
    "An unimportant detail ",
    "A unicorn appeared ",
    "She bought a onesie ",
    "He was a onetime teacher ",
    "We received an unitemized bill ",
    "It was an onerous task ",
    "Take an x-ray ",
    "It is a one-time fee ",
    // Names: the "an" inside a word is not an article.
    "Read the Qur'an carefully ",
    "The Qur'an was revealed ",
    "We visited Xi'an last year ",
    "We met a Uber driver ",
    // Initialisms and numbers.
    "We need an sla ",
    "Just an fyi ",
    "Write an sql query ",
    "Get an mri scan ",
    "It was a 8 hour day ",
    "It was an one-off ",
    // Both pronunciations are accepted.
    "She plays an ukulele ",
    "I bought an ukulele yesterday ",
    "She plays a ukulele ",
    // The letter or a variable, not the article.
    "Let a equal b ",
    "Let a equals b ",
    "We chose option a instead ",
    "If a exists ",
    "Press a eight times ",
    "Pick option a or b ",
    "Grade A apples ",
    "Plan A is fine ",
    // Code and string literals.
    "Type `return a instanceof Foo` here ",
    "```\nreturn a instanceof Foo;\n``` ",
    "Type `a error` here ",
    'Set text = "a error " ',
    // Re-review: identifiers before listed words, in both directions.
    "Keep a independent of b ",
    "We chose option a early ",
    "Make a unknown ",
    "Please make a internal ",
    "Is a important here? ",
    "select an.name from users an group by an.name ",
    // Re-review: quotes of the other kind, and escapes, inside a literal.
    'Set text = "don\'t type a error " ',
    'const text = "it\'s a error message"; ',
    "const text = 'write \"example\" then a error here'; ",
    'const text = "write \\"example\\" then a error here"; ',
    // Re-review: code spans and fences by delimiter run, not backtick parity.
    "Type ``this is a error here`` now ",
    "````\na error \n```` ",
    "~~~\na error \n~~~ ",
    "```js\nconst text = `got a error here`;\n``` ",
  ])
    test(`leaves ${JSON.stringify(input)}`, () => {
      for (let end = 1; end <= input.length; end += 1) {
        const prefix = input.slice(0, end);
        expect(type(prefix, "en_US", withRule)).toBe(type(prefix));
      }
    });
});

describe("opt-in ordinal suffix repair", () => {
  const RULE = "englishOrdinalSuffix";
  const pipelines = [
    ["default + rule", [...DEFAULT_CURRENT_GRAMMAR_RULES, RULE]],
    ["all rules", GRAMMAR_RULE_IDS],
  ] as const;
  const without = (rules: readonly string[]) => rules.filter((id) => id !== RULE);

  test("is off by default", () => {
    expect(DEFAULT_CURRENT_GRAMMAR_RULES).not.toContain(RULE);
    expect(type("my 3th attempt ")).toBe("My 3th attempt ");
  });

  for (const [input, expected] of [
    ["my 3th attempt ", "My 3rd attempt "],
    ["1th place ", "1st place "],
    ["2th attempt ", "2nd attempt "],
    ["the 3nd lap ", "The 3rd lap "],
    ["the 4nd lap ", "The 4th lap "],
    ["the 12nd item ", "The 12th item "],
    ["the 21th birthday ", "The 21st birthday "],
    ["the 112nd floor ", "The 112th floor "],
    ["her 102th year. ", "Her 102nd year. "],
    ["on the (22th) ", "On the (22nd) "],
    // Documented: an unquoted example is corrected once the rule is enabled.
    ["Never write 3th ", "Never write 3rd "],
  ])
    for (const [name, rules] of pipelines)
      test(`corrects ${JSON.stringify(input)} (${name})`, () => {
        // Nothing changes before the token is finished, then the fix lands.
        const boundary =
          input.search(/\d+(?:nd|th)[\s.)]/) + input.match(/\d+(?:nd|th)/)![0].length;
        for (let end = 1; end <= boundary; end += 1) {
          const prefix = input.slice(0, end);
          expect(type(prefix, "en_US", rules)).toBe(type(prefix, "en_US", without(rules)));
        }
        expect(type(input, "en_US", rules)).toBe(expected);
      });

  // Measurement formatting must not split the corrected token into "1 st".
  for (const [name, rules] of pipelines)
    test(`keeps "1st" intact after correction (${name})`, () => {
      const input = "Took 1th place in 2 laps ";
      const corrected = input.indexOf("1th ") + "1th ".length;
      for (let end = corrected; end <= input.length; end += 1)
        expect(type(input.slice(0, end), "en_US", rules)).toMatch(/^Took 1st( |$)/);
      expect(type(input, "en_US", rules)).toBe("Took 1st place in 2 laps ");
    });

  // Quoted text is left alone even when the opening quote follows a dash, or
  // is a guillemet rather than a straight/curly quote.
  const rules = [...DEFAULT_CURRENT_GRAMMAR_RULES, RULE];
  for (const input of ['He said—"use 3th" ', "Il a dit « 3th » "])
    test(`leaves quoted ${JSON.stringify(input)}`, () => {
      expect(type(input, "en_US", rules)).toBe(type(input, "en_US", without(rules)));
    });

  // A Markdown bullet marker is prose, not a code operator.
  test("corrects a bulleted item", () => {
    expect(type("- 3th item ", "en_US", rules)).toBe("- 3rd item ");
  });

  // Every keystroke, each pipeline with the rule on versus off.
  for (const input of [
    // Already correct, and bare numbers never gain a suffix.
    "1st 2nd 3rd 4th 11th 12th 13th 21st 22nd 23rd 101st 111th ",
    "We had 21 guests ",
    // "st" is never rewritten: it is also stone.
    "He is 11st ",
    "Currently 12st ",
    "11st 4lb ",
    "He weighs 11st now ",
    "I lost 2st last year ",
    "We took 11st place ",
    // "rd" is never rewritten: it is also rod.
    "a 16rd chain ",
    "the 5rd mark ",
    // Uppercase and mixed case are never rewritten: "RD" is also road.
    "at 42RD ",
    "sheet 3TH ",
    "row 4ND ",
    "It was 2ST ",
    "Mixed 1St case ",
    "Mixed 2Th case ",
    // Quotations.
    '"21th" is wrong ',
    'Write "never 3th" now ',
    "He said \u201cuse 3th here\u201d ",
    "She wrote \u20183th\u2019 today ",
    "He wrote '1th' today ",
    'He said "the\n3th line" ',
    // Not a whole ordinal token.
    "Use v1th here ",
    "Version 1.1th here ",
    "Tag #1th here ",
    "the 21th-century view ",
    // Technical tokens containing those sequences.
    "Use v11st now ",
    "Set id_12st here ",
    "Open path/11st/4lb now ",
    "Call f(11st) now ",
    "Tag #12st here ",
    "Load build-2th.json now ",
    "Use 0x1th here ",
    "Set weight=11st 4lb ",
    // Code and literals.
    "Type `1th` here ",
    "Type `11st 4lb` here ",
    "```\n1th\n``` ",
    'Set text = "1th " ',
  ])
    for (const [name, rules] of pipelines)
      test(`leaves ${JSON.stringify(input)} (${name})`, () => {
        for (let end = 1; end <= input.length; end += 1) {
          const prefix = input.slice(0, end);
          expect(type(prefix, "en_US", rules)).toBe(type(prefix, "en_US", without(rules)));
        }
      });
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
