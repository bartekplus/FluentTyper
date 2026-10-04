import { describe, expect, test } from "bun:test";
import { GrammarRuleEngine } from "../../src/core/domain/grammar/GrammarRuleEngine";
import { createGrammarRuleCatalogRuntime } from "../../src/core/domain/grammar/ruleFactory";
import {
  CapitalizeSentenceStartRule,
  closesAbbreviation,
} from "../../src/core/domain/grammar/implementations/CapitalizeSentenceStartRule";
import {
  GRAMMAR_RULE_CATALOG,
  GRAMMAR_RULE_IDS,
  TYPING_RULE_IDS,
  DEFAULT_CURRENT_GRAMMAR_RULES,
} from "../../src/core/domain/grammar/ruleCatalog";
import { SUPPORTED_PREDICTION_LANGUAGE_KEYS } from "../../src/core/domain/lang";
import type { GrammarHints } from "../../src/core/domain/grammar/types";
import { review, typeText } from "./grammarTestUtils";
import type { ReviewOptions } from "../../src/core/domain/grammar/review/types";

const scan = (text: string, options: Partial<ReviewOptions>) =>
  review(text, {}, options).diagnostics;

const NBSP = " ";
const NNBSP = " ";

/** The default rules plus language-aware quotes and punctuation. */
const TYPOGRAPHY_GRAMMAR_RULES = [
  ...DEFAULT_CURRENT_GRAMMAR_RULES,
  "smartQuoteNormalization",
  "frenchPunctuationSpacing",
  "ellipsisShortcut",
];

/** Types `input` one character at a time with the content script's triggers. */
function type(
  input: string,
  lang: string,
  measurementContext: GrammarHints["measurementContext"] = "prose",
  rules: readonly string[] = TYPOGRAPHY_GRAMMAR_RULES,
): string {
  const { beforeCursor, afterCursor } = typeText(input, {
    lang,
    hints: { measurementContext },
    rules,
    sequence: true,
    boundaries: [" "],
    sentenceEndBoundary: true,
  });
  return beforeCursor + afterCursor;
}

describe("language-aware typography rules", () => {
  test.each([
    ["en_US", "She said \"quoted text\" and 'this' too.", "She said “quoted text” and ‘this’ too."],
    ["pl_PL", "Powiedział \"cytowany tekst\" i 'to'.", "Powiedział „cytowany tekst” i «to»."],
    ["de_DE", "Er sagte \"zitierter Text\" und 'das'.", "Er sagte „zitierter Text“ und ‚das‘."],
    ["fr_FR", 'Il a dit "texte cité" hier.', `Il a dit «${NBSP}texte cité${NBSP}» hier.`],
    // A space typed inside the guillemets is absorbed, not doubled.
    ["fr_FR", 'Il a dit " texte cité " hier.', `Il a dit «${NBSP}texte cité${NBSP}» hier.`],
    ["el_GR", "Είπε \"γεια\" και 'αντίο'.", "Είπε «γεια» και “αντίο”."],
    ["sv_SE", "Han sa \"hej\" och 'då'.", "Han sa ”hej” och ’då’."],
    ["hr_HR", "Rekao je \"bok\" i 'zbogom'.", "Rekao je „bok“ i ‚zbogom‘."],
    // CLDR gives Spanish and Portuguese the English marks.
    ["es_ES", 'Dijo "hola" ayer.', "Dijo “hola” ayer."],
    ["pt_BR", "Ele disse \"oi\" e 'tchau'.", "Ele disse “oi” e ‘tchau’."],
    // Arabic has no verified profile (CLDR reverses the marks for RTL): English marks.
    ["ar_SA", 'قال "مرحبا" امس.', "قال “مرحبا” امس."],
  ])("%s quotes: %s", (lang, input, expected) => {
    expect(type(input, lang)).toBe(expected);
  });

  test("apostrophes stay apostrophes in every language", () => {
    expect(type("it's fine ", "en_US")).toBe("It’s fine ");
    expect(type("c'est l'heure ", "fr_FR")).toBe("C’est l’heure ");
    expect(type("Peter's Haus ", "de_DE")).toBe("Peter’s Haus ");
  });

  test("French (France) punctuation gets no-break spaces", () => {
    expect(type("Bonjour! Ça va? Oui; enfin: presque.", "fr_FR")).toBe(
      `Bonjour${NNBSP}! Ça va${NNBSP}? Oui${NNBSP}; enfin${NBSP}: presque.`,
    );
    // A plain space the writer typed is replaced, not doubled.
    // A trailing space is typed here (unlike above) because a colon only gets
    // spaced once it is confirmed to end a word, not on its own keystroke.
    expect(type("Quoi ? Voici : ", "fr_FR")).toBe(`Quoi${NNBSP}? Voici${NBSP}: `);
    expect(type("Quoi?! ", "fr_FR")).toBe(`Quoi${NNBSP}?! `);
    expect(type('Il dit "non"!', "fr_FR")).toBe(`Il dit «${NBSP}non${NBSP}»${NNBSP}!`);
  });

  test("French spacing leaves times, URLs and other languages alone", () => {
    expect(type("Rendez-vous à 12:30 ", "fr_FR")).toBe("Rendez-vous à 12:30 ");
    expect(type("Voir https://exemple.fr?a=1 ", "fr_FR")).toBe("Voir https://exemple.fr?a=1 ");
    expect(type("Hello! Why? ", "en_US")).toBe("Hello! Why? ");
    expect(type("Hallo! Warum? ", "de_DE")).toBe("Hallo! Warum? ");
  });

  test.each([
    ["fr_FR", "Il dit 'c'est bon' ", "Il dit “c’est bon” "],
    ["pl_PL", "Nazwa 'McDonald's' ", "Nazwa «McDonald’s» "],
    ["de_DE", "Er sagt 'Peter's Haus' ", "Er sagt ‚Peter’s Haus‘ "],
    ["de_DE", "Er sagt 'Wort'. ", "Er sagt ‚Wort‘. "],
  ])("%s keeps in-word apostrophes inside nested quotes: %s", (lang, input, expected) => {
    expect(type(input, lang)).toBe(expected);
  });

  test("a trailing space before the outer closer closes it after a nested quote", () => {
    expect(type("Er sagt \"ein 'Wort' \"", "de_DE")).toBe("Er sagt „ein ‚Wort‘“");
  });

  test.each([
    ["de_DE", 'Er sagt "hallo!" danach ', "Er sagt „hallo!“ Danach "],
    ["pl_PL", "Mówi 'dobrze!' potem ", "Mówi «dobrze!» Potem "],
    ["en_US", 'She said "hi!" then ', "She said “hi!” Then "],
    ["fr_FR", 'Il dit "bonjour!" ensuite ', `Il dit «${NBSP}bonjour${NNBSP}!${NBSP}» Ensuite `],
  ])("%s capitalizes a sentence after its closing quote: %s", (lang, input, expected) => {
    expect(type(input, lang)).toBe(expected);
  });

  test("French spacing keeps URLs after delimiters and HTML character references", () => {
    expect(type("Voir (https://exemple.fr) ", "fr_FR")).toBe("Voir (https://exemple.fr) ");
    expect(type("Voir [ici](https://exemple.fr) ", "fr_FR")).toBe(
      "Voir [ici](https://exemple.fr) ",
    );
    for (const reference of ["&nbsp;", "&amp;", "&#160;", "&#xA0;"]) {
      expect(type(`Entité ${reference} `, "fr_FR")).toBe(`Entité ${reference} `);
    }
    expect(type("Oui; enfin ", "fr_FR")).toBe(`Oui${NNBSP}; enfin `);
  });

  test("French colon spacing leaves a colon inside a token alone", () => {
    expect(type("C:\\Users\\moi ", "fr_FR")).toBe("C:\\Users\\moi ");
  });

  test("French colon spacing leaves emoji shortcodes alone", () => {
    expect(type("Merci :smile: ", "fr_FR")).toBe("Merci :smile: ");
  });

  test("French question spacing leaves x?y alone", () => {
    // Written mid-sentence so the unrelated sentence-start capitalization rule
    // (which also applies in English, since "?" mid-word isn't a word boundary)
    // doesn't capitalize "x" and obscure what this test is checking.
    expect(type("Vu x?y ", "fr_FR")).toBe("Vu x?y ");
  });

  test("French question spacing only retracts a space it inserted itself", () => {
    for (const space of [NBSP, NNBSP]) {
      // Inside Markdown code the rule never runs, so nothing is retracted.
      for (const input of [`Run \`a${space}?b`, `\`\`\`\na${space}?b`]) {
        // Only the tail: sentence capitalization is a separate rule.
        expect(type(input, "fr_FR").slice(-3)).toBe(`${space}?b`);
      }
    }
    // A space the writer typed before "?" is normalized, never removed.
    expect(type(`Vu a${NNBSP}?b `, "fr_FR")).toBe(`Vu a${NNBSP}?b `);
    expect(type(`Vu a${NBSP}?b `, "fr_FR")).toBe(`Vu a${NNBSP}?b `);
    expect(type("Vu a ?b ", "fr_FR")).toBe(`Vu a${NNBSP}?b `);
  });

  test("French colon spacing still spaces a sentence colon", () => {
    expect(type("Note: ", "fr_FR")).toBe(`Note${NBSP}: `);
  });

  test("French colon spacing leaves other technical tokens alone", () => {
    expect(type("Vu a:b localhost:3000 ", "fr_FR")).toBe("Vu a:b localhost:3000 ");
  });

  test("French empty quotes open and close", () => {
    expect(type('Il dit "" ', "fr_FR")).toBe(`Il dit «${NBSP}${NBSP}» `);
  });

  test("an English opening quote followed by a space is not closed over the typed space", () => {
    // A second "“" here is a German-style closer only for German; in English
    // it's just another opener typed after whitespace, so the space must
    // survive rather than being swallowed into a bogus close-with-trim.
    expect(type('Type " " here', "en_US")).toBe("Type “ “ here");
  });

  test("straight quotes stay straight in code and protected contexts", () => {
    expect(type('Run `echo "hi"` now', "en_US")).toBe('Run `echo "hi"` now');
    expect(type('Say "hi" there', "fr_FR", "protected")).toBe('Say "hi" there');
    expect(type("Bonjour! ", "fr_FR", "protected")).toBe("Bonjour! ");
  });
});

describe("per-language sentence and spacing behavior", () => {
  test("Swedish same-glyph quotes pair by position, not by count", () => {
    // The second pair opens after a closed one instead of closing over the space.
    expect(type('Han sa "hej" och sa "då" ', "sv_SE")).toBe("Han sa ”hej” och sa ”då” ");
  });

  test.each([
    ["es_ES", "hola. ¿qué tal? bien ", "Hola. ¿Qué tal? Bien "],
    ["es_ES", "vale. ¡hola amigo! ", "Vale. ¡Hola amigo! "],
    ["es_ES", "hola\n¿qué tal ", "Hola\n¿Qué tal "],
    ["es_ES", "hola\n¡vamos ", "Hola\n¡Vamos "],
  ])("%s capitalizes after an inverted opening mark: %s", (lang, input, expected) => {
    expect(type(input, lang)).toBe(expected);
  });

  test("an inverted mark mid-sentence does not start a sentence", () => {
    expect(type("Dime ¿qué tal? ", "es_ES")).toBe("Dime ¿qué tal? ");
  });

  test("the Greek question mark ; ends a sentence only in Greek", () => {
    expect(type("γεια σου; καλά ", "el_GR")).toBe("Γεια σου; Καλά ");
    expect(type("Τι κάνεις ; καλά ", "el_GR")).toBe("Τι κάνεις; Καλά ");
    expect(type("Ok; then more ", "en_US")).toBe("Ok; then more ");
    expect(type("Ok ; then ", "en_US")).toBe("Ok ; then ");
  });

  test.each([
    ["pl_PL", "Nie wiem co. ale dobrze ", "Nie wiem co. Ale dobrze "],
    ["fr_FR", "Le vent vient de l'est. il fait froid ", "Le vent vient de l’est. Il fait froid "],
    ["pt_BR", "Vi uma ave. ela voou ", "Vi uma ave. Ela voou "],
    ["sv_SE", "Den är min. vi går ", "Den är min. Vi går "],
  ])("%s: another language's abbreviation is a word here: %s", (lang, input, expected) => {
    expect(type(input, lang)).toBe(expected);
  });

  test.each([
    ["en_US", "Ask Mr. smith and co. today "],
    ["de_DE", "Äpfel, Birnen usw. und mehr "],
    ["pl_PL", "Owoce, np. jabłka "],
    ["es_ES", "Hola, sra. lópez "],
    ["sv_SE", "Frukt, dvs. äpplen "],
    ["hr_HR", "Voće, npr. jabuke "],
    ["fr_FR", "Des fruits, etc. et plus "],
    ["el_GR", "Φρούτα, κλπ. και άλλα "],
  ])("%s keeps its own abbreviations: %s", (lang, input) => {
    expect(type(input, lang)).toBe(input);
  });

  // Review reads a subject pronoun after "etc." as a new sentence. Typing cannot see the rest of
  // the sentence, so it keeps the word as typed.
  test.each([
    ["en_US", "We sold pens, etc. she left "],
    ["en_US", "It was Smith Inc. the firm grew "],
    ["es_ES", "Vendimos lápices, etc. ella se fue "],
    ["de_DE", "Stifte, Papier usw. wir gehen "],
  ])("%s: typing adds no capital after an abbreviation: %s", (lang, input) => {
    expect(type(input, lang)).toBe(input);
  });

  test("without a resolved language every abbreviation still counts", () => {
    expect(type("Äpfel usw. und co. mehr ", "auto_detect")).toBe("Äpfel usw. und co. mehr ");
  });
});

describe("rule interactions", () => {
  const withAutoClose = [...TYPOGRAPHY_GRAMMAR_RULES, "autoBracketClose"];

  test("a typed closer overtypes the auto-closed one before bracket spacing runs", () => {
    expect(type("see (item 1) now", "en_US", "prose", withAutoClose)).toBe("See (item 1) now");
    expect(type("list [a] and {b} ok", "en_US", "prose", withAutoClose)).toBe(
      "List [a] and {b} ok",
    );
  });

  test("sentence punctuation closes up to the space bracket spacing added", () => {
    const defaults = DEFAULT_CURRENT_GRAMMAR_RULES;
    expect(type("he left (quietly). then ", "en_US", "prose", defaults)).toBe(
      "He left (quietly). Then ",
    );
    expect(type("wirklich (ja)? gut ", "de_DE", "prose", defaults)).toBe("Wirklich (ja)? Gut ");
    // The space typed before a period after a word still goes, as before.
    expect(type("done . next ", "en_US", "prose", defaults)).toBe("Done. Next ");
  });

  test("a closing straight quote overtypes its auto-closed twin after punctuation", () => {
    const rules = [...DEFAULT_CURRENT_GRAMMAR_RULES, "autoBracketClose"];
    expect(type('he said "hi," ok ', "en_US", "prose", rules)).toBe('He said "hi," ok ');
    expect(type('say "" ok ', "en_US", "prose", rules)).toBe('Say "" ok ');
    expect(type("run `ls` ok ", "en_US", "prose", rules)).toBe("Run `ls` ok ");
  });

  test("auto-close pairs only what was typed, not a mark smart quotes produced", () => {
    // Polish nests quotes in «…» and Greek opens with «: neither may strand a "»".
    expect(type("Mówi 'tak' dziś ", "pl_PL", "prose", withAutoClose)).toBe("Mówi «tak» dziś ");
    expect(type('Είπε "ναι" τώρα ', "el_GR", "prose", withAutoClose)).toBe("Είπε «ναι» τώρα ");
    // A guillemet typed directly is still paired.
    expect(type("Il dit «", "fr_FR", "prose", withAutoClose)).toBe("Il dit «»");
  });

  test("digits on both sides of = are spaced like other arithmetic", () => {
    expect(type("so 2=2 and x=1 ", "en_US")).toBe("So 2 = 2 and x = 1 ");
    expect(type("FOO=bar ", "en_US")).toBe("FOO=bar ");
    // A number ending a name is not a number operand.
    expect(type("set FOO2=bar and var1=2 ", "en_US")).toBe("Set FOO2=bar and var1=2 ");
  });

  test("a lone inverted mark is left alone", () => {
    // The engine swallows rule errors, so call the rule itself.
    expect(
      new CapitalizeSentenceStartRule().apply({
        beforeCursor: "hola. ¿ ",
        afterCursor: "",
        hints: { lang: "es_ES" },
      }),
    ).toBeNull();
    expect(type("hola. ¿ vale ", "es_ES")).toBe("Hola. ¿ vale ");
  });

  test("a stray space before a closer is repaired even right before the same closer", () => {
    // Cursor inside an existing pair: no auto-close involved.
    const rules = ["closingBracketSpacing"];
    const engine = new GrammarRuleEngine();
    for (const rule of createGrammarRuleCatalogRuntime({
      insertSpaceAfterAutocomplete: true,
    }))
      engine.registerRule(rule);
    const edit = engine.processSequence(
      ["insertChar"],
      {
        beforeCursor: "f(g(x )",
        afterCursor: ")",
        hints: { lang: "en_US", inputAction: "insert" },
      },
      rules,
    );
    expect(edit).toEqual(
      expect.objectContaining({ replacement: ")", deleteBackwards: 2, deleteForwards: 0 }),
    );
  });

  test("an inch mark does not count as an open quote for auto-close", () => {
    const rules = ["autoBracketClose"];
    expect(type('a 5" screen and "', "en_US", "prose", rules)).toBe('a 5" screen and ""');
  });
});

describe("cross-language parity", () => {
  // Rules scoped to every language must not depend on it. The only intended
  // differences are asserted elsewhere in this file: quote marks, French
  // punctuation spacing, the Greek ";" and each language's abbreviations.
  test.each([
    ["hello ,world. next (aside ) done ", "Hello, world. Next (aside) done "],
    ["so x=y and 2+3 at 12: 30 ", "So x = y and 2 + 3 at 12:30 "],
    ["wait... and word--more ", "Wait… and word—more "],
    ["one,, two  three ", "One, two. Three "],
    ["see https: //x.com and a /b ", "See https://x.com and a / b "],
    ["line one  \nline two ", "Line one.\nLine two "],
  ])("%s is typed the same in every language", (input, expected) => {
    for (const lang of SUPPORTED_PREDICTION_LANGUAGE_KEYS) {
      expect({ lang, out: type(input, lang, "prose", GRAMMAR_RULE_IDS) }).toEqual({
        lang,
        out: expected,
      });
    }
  });

  test("measurement and currency spacing apply in every writing language", () => {
    for (const lang of SUPPORTED_PREDICTION_LANGUAGE_KEYS) {
      // Text Expander is not a writing language, so it has no locale policy.
      const expected =
        lang === "textExpander" ? "It is 10kg for 5EUR " : `It is 10${NBSP}kg for 5${NBSP}EUR `;
      expect({ lang, out: type("it is 10kg for 5EUR ", lang) }).toEqual({ lang, out: expected });
    }
  });

  test("English-only rules never fire in another language", () => {
    const englishOnly = GRAMMAR_RULE_CATALOG.filter((rule) => rule.languageScope === "en_US").map(
      (rule) => rule.id,
    );
    const input = "Well i dont know, teh cat has alot. i is 2th on monday, an user. your welcome. ";
    expect(type(input, "en_US", "prose", englishOnly)).not.toBe(input);
    for (const lang of SUPPORTED_PREDICTION_LANGUAGE_KEYS.filter((key) => key !== "en_US")) {
      expect({ lang, out: type(input, lang, "prose", englishOnly) }).toEqual({ lang, out: input });
    }
  });
});

describe("rule contract: every rule has a positive and a negative case", () => {
  // Each rule runs alone. [lang, typed, expected] where the rule fires, and
  // [lang, typed] where it must not. A new catalog rule fails until listed.
  const CASES: Record<string, { fires: [string, string, string]; skips: [string, string] }> = {
    capitalizeSentenceStart: {
      fires: ["en_US", "done. next ", "Done. Next "],
      skips: ["en_US", "e.g. next "],
    },
    capitalizeAfterLineBreak: { fires: ["en_US", "a\nbe ", "a\nBe "], skips: ["en_US", "a be "] },
    englishPronounICapitalization: {
      fires: ["en_US", "so i think ", "so I think "],
      skips: ["en_US", "for i in x "],
    },
    englishContractionNormalization: {
      fires: ["en_US", "we dont go ", "we don't go "],
      skips: ["en_US", "we wont go "],
    },
    englishTypoWhitelistCorrection: {
      fires: ["en_US", "teh cat ", "the cat "],
      skips: ["en_US", "tech cat "],
    },
    doubleSpaceToPeriod: { fires: ["en_US", "done  ", "done. "], skips: ["en_US", "(done)  "] },
    englishModalOfCorrection: {
      fires: ["en_US", "could of gone ", "could have gone "],
      skips: ["en_US", "must of course go "],
    },
    englishYourWelcomeCorrection: {
      fires: ["en_US", "your welcome.", "you're welcome."],
      skips: ["en_US", "your welcome email "],
    },
    englishTheirThereBeVerb: {
      fires: ["en_US", "their is one ", "there is one "],
      skips: ["en_US", "their car is "],
    },
    englishAlotCorrection: {
      fires: ["en_US", "thanks alot ", "thanks a lot "],
      skips: ["en_US", "thanks a lot "],
    },
    englishPronounVerbWhitelistAgreement: {
      fires: ["en_US", "he are here ", "he is here "],
      skips: ["en_US", "they are here "],
    },
    englishArticleAnCorrection: {
      fires: ["en_US", "it is a apple ", "it is an apple "],
      skips: ["en_US", "plan A is "],
    },
    englishOrdinalSuffix: {
      fires: ["en_US", "the 2th time ", "the 2nd time "],
      skips: ["en_US", "he is 11st "],
    },
    englishProperNounCapitalization: {
      fires: ["en_US", "on monday we ", "on Monday we "],
      skips: ["en_US", "it may rain "],
    },
    technicalTokenCompaction: {
      fires: ["en_US", "at 12: 30 ", "at 12:30 "],
      skips: ["en_US", "we sold 12. 5 "],
    },
    mathOperatorSpacing: {
      fires: ["en_US", "so x=y ", "so x = y "],
      skips: ["en_US", "use --port=8080 "],
    },
    measurementUnitFormatting: {
      fires: ["en_US", "it is 10kg ", `it is 10${NBSP}kg `],
      skips: ["en_US", "it is 3d "],
    },
    currencySpacing: {
      fires: ["en_US", "costs 5EUR ", `costs 5${NBSP}EUR `],
      skips: ["en_US", "costs 5TRY "],
    },
    slashContextSpacing: { fires: ["en_US", "a /b ", "a / b "], skips: ["en_US", "and/or "] },
    openingBracketSpacing: { fires: ["en_US", "(a){x ", "(a) {x "], skips: ["en_US", "item(s) "] },
    closingBracketSpacing: {
      fires: ["en_US", "see (a )", "see (a) "],
      skips: ["en_US", "- [ ] todo "],
    },
    commaPeriodSpacing: { fires: ["en_US", "a ,b ", "a, b "], skips: ["en_US", "we paid 1,5 "] },
    collapseRepeatedSpaces: { fires: ["en_US", "a   b", "a b"], skips: ["en_US", "    indented"] },
    trimSpaceBeforeLineBreak: { fires: ["en_US", "a  \nb", "a\nb"], skips: ["en_US", "a\nb"] },
    ellipsisShortcut: { fires: ["en_US", "wait...", "wait…"], skips: ["en_US", "f(...args"] },
    emdashShortcut: { fires: ["en_US", "word--x", "word—x"], skips: ["en_US", "use --force "] },
    smartQuoteNormalization: {
      fires: ["en_US", 'say "hi" ', "say “hi” "],
      skips: ["en_US", 'run `echo "hi"` '],
    },
    frenchPunctuationSpacing: {
      fires: ["fr_FR", "Oui! ", `Oui${NNBSP}! `],
      skips: ["en_US", "Oui! "],
    },
    duplicatePunctuationCollapse: {
      fires: ["en_US", "a,, b", "a, b"],
      skips: ["en_US", "std::vector "],
    },
    autoBracketClose: { fires: ["en_US", "f(", "f()"], skips: ["en_US", "it's"] },
  };

  test("every catalog rule is listed", () => {
    expect(Object.keys(CASES).sort()).toEqual([...TYPING_RULE_IDS].sort());
  });

  test.each(Object.entries(CASES))("%s", (ruleId, { fires, skips }) => {
    const [lang, typed, expected] = fires;
    expect(expected).not.toBe(typed);
    expect(type(typed, lang, "prose", [ruleId])).toBe(expected);
    expect(type(skips[1], skips[0], "prose", [ruleId])).toBe(skips[1]);
  });
});

describe("sentence starts after language abbreviations", () => {
  test.each([
    ["pl_PL", "Mam 10 tys. zł i dom."],
    ["pl_PL", "To tzw. problem."],
    ["hr_HR", "Tj. ne znam."],
    ["sv_SE", "Ca 5 st. äpplen."],
    ["de_DE", "Das sog. Problem."],
    ["es_ES", "Vive en la Avda. del Mar."],
    ["fr_FR", "Voir chap. deux."],
    ["de_DE", "Die Praxis von Dr. med. Weber öffnet am 4. Feb. wieder."],
    ["de_DE", "Kaiser Karl IV. ließ die Brücke bauen."],
    ["de_DE", "Gemüse, Obst und Co. stehen im Regal."],
    ["de_DE", "Es gilt lt. Vertrag nur bis Okt. dieses Jahres."],
    ["pl_PL", "W lipcu br. ruszy budowa."],
    ["pl_PL", "Zysk wzrósł o 12 proc. w skali roku."],
    ["pl_PL", "Wspomniany ww. dokument leży na biurku."],
    ["en_US", "The museum opens on Jan. twelfth, ca. noon."],
    ["es_ES", "El plazo vence el 3 de dic. por la tarde."],
    ["es_ES", "Llegó en 2a. posición."],
    ["pt_BR", "A reunião ficou para 5 de out. de manhã."],
    ["pt_BR", "Ficou em 3o. lugar."],
    ["fr_FR", "La réunion du 5 janv. aura lieu ici."],
    // The lowercase forms of name-like abbreviations still continue the sentence.
    ["en_US", "The study by Lee et al. shows this."],
    ["en_US", "See the second ed. for details."],
    ["en_US", "Set the dial to max. and wait."],
    ["de_DE", "Sie ist Dr. phil. und lehrt hier."],
    ["sv_SE", "Det tar en tim. att gå dit."],
    ["de_DE", "Er las die franz. und die engl. Ausgabe."],
    // A capitalized month is a month with a number, a date word or another month joined to it.
    ["en_US", "We moved in Jan. and the house was cold."],
    ["en_US", "It was 5 Jan. and the house was cold."],
    ["en_US", "Sales fell Jan. and Feb. but rose later."],
    ["en_US", "We left early Mar. and came back."],
    ["en_US", "It rained until mid-Mar. and then stopped."],
    ["en_US", "It was the 5th of Aug. and hot."],
    ["en_US", "We rest until the end of Aug. and then start."],
    ["en_US", "He arrives 3 Jun. and leaves soon."],
    ["en_US", "Wait 5 Min. and then go."],
    ["de_DE", "Wir warten 5 Min. und gehen dann."],
    ["de_DE", "Wir kommen Anfang Jan. und bleiben."],
    ["de_DE", "Seit Aug. wohnt sie hier."],
    ["pt_BR", "Voltamos em Jan. e ficamos."],
    // A weak date word ("from", "to", "by", "on") needs a number or another month.
    ["en_US", "From Jan. to Mar. we worked."],
    ["en_US", "Pay by Jan. 5 or later."],
    ["en_US", "It opens on Mar. twenty-first and closes soon."],
  ])("%s: %s", (lang, text) => {
    const found = review(text, {}, { enabledRules: ["capitalizeSentenceStart"], lang }).diagnostics;
    expect(found).toEqual([]);
  });

  test("words that end sentences in their own language still do", () => {
    const text = "C'est de l'art. puis on part.";
    const found = review(
      text,
      {},
      { enabledRules: ["capitalizeSentenceStart"], lang: "fr_FR" },
    ).diagnostics;
    expect(found.map((d) => d.original)).toEqual(["p"]);
  });

  test.each([
    // Words, not abbreviations, in their own language: "dez" (ten), "mar" (sea).
    ["pt_BR", "Contei até dez. depois parei."],
    ["es_ES", "Fuimos al mar. luego comimos."],
    // A Roman numeral is an ordinal only where "1." is.
    ["en_US", "He owns a CV. then he left."],
    // A capitalized name is not the lowercase abbreviation it spells.
    ["en_US", "I spoke with Ed. he agreed."],
    ["en_US", "We met Al. he paid."],
    ["en_US", "The dog is called Max. he barks."],
    ["fr_FR", "Le chat s'appelle Max. il dort."],
    ["de_DE", "Ich traf Phil. er lachte."],
    ["sv_SE", "Jag ringde Tim. han svarade."],
    ["de_DE", "Ich traf Franz. er lachte."],
    // A capitalized month without date context is a name.
    ["en_US", "I spoke with Jan. she agreed."],
    ["en_US", "We hired Mar. she starts soon."],
    ["en_US", "Ask Aug. he knows."],
    ["en_US", "I met Jun. he was kind."],
    ["en_US", "I met Min. she was kind."],
    ["de_DE", "Ich traf Jan. er lachte."],
    ["de_DE", "Ich traf Min. sie lachte."],
    ["pt_BR", "Falei com Jan. ele riu."],
    // A weak date word alone does not make a month.
    ["en_US", "I talked to Jan. she agreed."],
    ["en_US", "I got a gift from Jan. it was nice."],
    ["en_US", "I relied on Aug. he helped."],
    ["de_DE", "Ich wartete ab Jan. er kam nicht."],
    // Another month that is not joined to it does not make a month.
    ["en_US", "I spoke with Jan. she moved in Feb."],
    ["en_US", "I spoke with Jan. she left in Feb. and Mar."],
    ["de_DE", "Ich traf Jan. er zog im Feb. um."],
  ])("%s still flags the next sentence: %s", (lang, text) => {
    const found = scan(text, { enabledRules: ["capitalizeSentenceStart"], lang });
    expect(found).toHaveLength(1);
  });
});

describe("acronym casing", () => {
  const casing = (text: string, lang: string) =>
    scan(text, { enabledRules: ["englishCanonicalCasing"], lang }).map((d) => [
      d.original,
      d.alternatives[0].preview,
    ]);

  test("English writes acronyms in capitals", () => {
    expect(casing("The Nasa probe and the Cpu.", "en_US")).toEqual([
      ["Nasa", "NASA"],
      ["Cpu", "CPU"],
    ]);
  });

  test.each([
    ["de_DE", "Sehr geehrter Hr. Braun, die Nato tagt."],
    ["pt_BR", "A Nasa e a Lego assinaram com Souza & Cia. hoje."],
    ["fr_FR", "Le peintre Ai expose à Paris."],
  ])("%s keeps its own spelling: %s", (lang, text) => {
    expect(casing(text, lang)).toEqual([]);
  });

  test("brand names keep their casing in every language", () => {
    expect(casing("Ich nutze github.", "de_DE")).toEqual([["github", "GitHub"]]);
  });
});

test("Review removes a space before the Greek question mark only in Greek", () => {
  const text = "Τι κάνεις ; Καλά. Ένα ; δύο.";
  const found = (lang: string) =>
    review(text, {}, { enabledRules: ["commaPeriodSpacing"], lang }).diagnostics.map((d) => [
      d.original,
      d.alternatives[0].preview,
    ]);
  expect(found("el_GR")).toEqual([
    [" ;", ";"],
    [" ;", ";"],
  ]);
  expect(found("en_US")).toEqual([]);
});

describe("typing capitalization after language abbreviations", () => {
  test.each([
    [
      "sv_SE",
      "vi köpte 5 st. äpplen och bl.a. päron. sen gick vi ",
      "Vi köpte 5 st. äpplen och bl.a. päron. Sen gick vi ",
    ],
    ["sv_SE", "se jfr. kapitel två. klart ", "Se jfr. kapitel två. Klart "],
    ["hr_HR", "tj. ne znam. dobro ", "Tj. ne znam. Dobro "],
    ["hr_HR", "kupio sam npr. kruh. zatim ", "Kupio sam npr. kruh. Zatim "],
    ["pl_PL", "mam 10 tys. zł i tzw. dom. potem ", "Mam 10 tys. zł i tzw. dom. Potem "],
    ["pl_PL", "przy ul. długiej. dalej ", "Przy ul. długiej. Dalej "],
    ["de_DE", "das sog. problem bzgl. geld. dann ", "Das sog. problem bzgl. geld. Dann "],
    ["de_DE", "es kostet ca. 5 tsd. euro. gut ", "Es kostet ca. 5 tsd. euro. Gut "],
    // A capitalized name is not the lowercase abbreviation it spells.
    ["en_US", "i spoke with Ed. he agreed ", "I spoke with Ed. He agreed "],
    ["en_US", "we met Al. he paid ", "We met Al. He paid "],
    ["en_US", "see the second ed. for it ", "See the second ed. for it "],
    ["en_US", "work by Lee et al. shows it ", "Work by Lee et al. shows it "],
    ["sv_SE", "jag ringde Tim. han svarade ", "Jag ringde Tim. Han svarade "],
    ["de_DE", "ich traf Franz. er lachte ", "Ich traf Franz. Er lachte "],
    // Typing reads every capitalized month as a month: a wrong capital is worse.
    ["en_US", "i spoke with Jan. she agreed ", "I spoke with Jan. she agreed "],
    ["en_US", "we moved in Jan. the house ", "We moved in Jan. the house "],
    ["en_US", "we hired Mar. she starts ", "We hired Mar. she starts "],
    ["en_US", "it rained until mid-Mar. and ", "It rained until mid-Mar. and "],
    ["en_US", "ask Aug. he knows ", "Ask Aug. he knows "],
    ["en_US", "it was 5 Aug. and cold ", "It was 5 Aug. and cold "],
    ["en_US", "i met Jun. he smiled ", "I met Jun. he smiled "],
    ["en_US", "it ends early Jun. and ", "It ends early Jun. and "],
    ["en_US", "it rained in Jan. and Feb. then ", "It rained in Jan. and Feb. then "],
    ["en_US", "i met Min. she smiled ", "I met Min. She smiled "],
    ["de_DE", "wir warten 5 Min. und gehen ", "Wir warten 5 Min. und gehen "],
    ["de_DE", "ich traf Jan. er lachte ", "Ich traf Jan. er lachte "],
    ["de_DE", "seit Jan. wohnt sie ", "Seit Jan. wohnt sie "],
    ["en_US", "pay by Jan. 5 or later ", "Pay by Jan. 5 or later "],
    ["en_US", "we worked from Jan. 2 to Mar. 5 then ", "We worked from Jan. 2 to Mar. 5 then "],
  ])("%s: %s", (lang, input, expected) => {
    expect(type(input, lang, "prose", ["capitalizeSentenceStart"])).toBe(expected);
  });

  test("while typing, every capitalized month is a month: a wrong capital is worse", () => {
    const typed = (input: string) => type(input, "en_US", "prose", ["capitalizeSentenceStart"]);
    expect(typed("from Jan. to ")).toBe("From Jan. to ");
    expect(typed("i talked to Jan. she agreed ")).toBe("I talked to Jan. she agreed ");
  });

  test("Review still needs a number or another month after a weak date word", () => {
    const flagged = (text: string) =>
      scan(text, { enabledRules: ["capitalizeSentenceStart"] }).map(
        (d) => d.alternatives[0].preview,
      );
    expect(flagged("I talked to Jan. she agreed.")).toEqual(["S"]);
    expect(flagged("From Jan. to Mar. we worked.")).toEqual([]);
  });

  test.each([
    ["en_US", "Jan. and Feb. were cold."],
    ["en_US", "Jan.–Mar. was cold."],
    ["en_US", "Jan.-Mar. was cold."],
    ["en_US", "Jan./Feb. was cold."],
    ["en_US", "Jan., Feb. and Mar. were cold."],
    ["en_US", "Jan., Feb., and Mar. were cold."],
    ["en_US", "We worked from Jan. to Mar. and rested."],
    ["en_US", "Sep. through Nov. is busy."],
    ["de_DE", "Jan. bis Mär. war kalt."],
    ["es_ES", "Ene. y Abr. fueron fríos."],
    ["pt_BR", "Jan. a Abr. foram frios."],
    ["fr_FR", "Janv. et Févr. étaient froids."],
  ])("Review keeps months joined to another month: %s %s", (lang, text) => {
    const found = scan(text, { enabledRules: ["capitalizeSentenceStart"], lang });
    expect(found).toEqual([]);
  });

  test.each([
    ["i spoke with Jan. she moved in Feb. ", "I spoke with Jan. she moved in Feb. "],
    ["sales fell Jan. and again Feb. but ", "Sales fell Jan. and again Feb. but "],
    ["we left in Jan. or Feb. then ", "We left in Jan. or Feb. then "],
    ["it rained Jan./Feb. then ", "It rained Jan./Feb. then "],
    ["Jan.–Mar. was cold ", "Jan.–Mar. was cold "],
    ["Jan., Feb. and Mar. were cold ", "Jan., Feb. and Mar. were cold "],
    ["we worked from Jan. to Mar. and rested ", "We worked from Jan. to Mar. and rested "],
  ])("typing reads joined months: %s", (input, expected) => {
    expect(type(input, "en_US", "prose", ["capitalizeSentenceStart"])).toBe(expected);
  });

  test("a month counts only when a joiner connects it directly to another month", () => {
    const at = (text: string, from = 0) =>
      closesAbbreviation(text, text.indexOf(".", from), "en_US");
    expect(at("I spoke with Jan. she moved in Feb.")).toBe(false);
    expect(at("Jan. and Feb.")).toBe(true);
    expect(at("Jan.–Mar.")).toBe(true);
    expect(at("Jan., Feb. and Mar.")).toBe(true);
    expect(at("Jan., Feb. and Mar.", 5)).toBe(true);
    expect(at("from Jan. to Mar.")).toBe(true);
    expect(at("Jan. then Feb.")).toBe(false);
  });

  test("a number after a capitalized month makes it a month", () => {
    const at = (text: string) => closesAbbreviation(text, text.indexOf("."), "en_US");
    expect(at("Jan. 2020 was cold")).toBe(true);
    expect(at("Mar. 5 is late")).toBe(true);
    expect(at("Min. 8 chars")).toBe(true);
    expect(at("Jan. she agreed")).toBe(false);
    // A lowercase month needs no context.
    expect(at("jan. she agreed")).toBe(true);
  });

  test("an abbreviation of one language still ends a sentence in another", () => {
    // Swedish "min." is "my": it is only an abbreviation in English.
    expect(type("det är min. nu ", "sv_SE", "prose", ["capitalizeSentenceStart"])).toBe(
      "Det är min. Nu ",
    );
    // French "art." ends a sentence; Spanish lists it.
    expect(type("c'est de l'art. puis ", "fr_FR", "prose", ["capitalizeSentenceStart"])).toBe(
      "C'est de l'art. Puis ",
    );
  });
});

describe("unresolved auto-detect", () => {
  const text = "The the report is on monday, alot better. Hello , world.\n\nnext line.";
  const found = (lang: string) => review(text, {}, { lang }).diagnostics.map((d) => d.ruleId);

  test("runs only the language-independent rules", () => {
    const rules = new Set(found("auto_detect"));
    expect(rules).toEqual(new Set(["commaPeriodSpacing", "capitalizeAfterLineBreak"]));
    // The same text in English also gets the English rules.
    expect(found("en_US")).toContain("englishRepeatedWords");
    expect(found("en_US")).toContain("englishAlotCorrection");
  });
});
