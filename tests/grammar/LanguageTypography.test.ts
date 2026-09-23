import { describe, expect, test } from "bun:test";
import { GrammarRuleEngine } from "../../src/core/domain/grammar/GrammarRuleEngine";
import { applyGrammarEditToContext } from "../../src/core/domain/grammar/GrammarEditSequencing";
import { createGrammarRuleCatalogRuntime } from "../../src/core/domain/grammar/ruleFactory";
import {
  RECOMMENDED_CURRENT_GRAMMAR_RULES,
  TYPOGRAPHY_GRAMMAR_RULES,
} from "../../src/core/domain/grammar/ruleCatalog";
import type {
  GrammarContext,
  GrammarEventType,
  GrammarHints,
} from "../../src/core/domain/grammar/types";

const NBSP = " ";
const NNBSP = " ";

/** Types `input` one character at a time with the content script's triggers. */
function type(
  input: string,
  lang: string,
  measurementContext: GrammarHints["measurementContext"] = "prose",
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
    hints: { lang, inputAction: "insert", measurementContext },
  };
  for (const char of input) {
    context.beforeCursor += char;
    const triggers: GrammarEventType[] = [char === " " ? "wordBoundary" : "insertChar"];
    if (/[.!?]/.test(char)) triggers.push("wordBoundary");
    const edit = engine.processSequence(triggers, context, TYPOGRAPHY_GRAMMAR_RULES);
    if (edit) context = applyGrammarEditToContext(context, edit);
  }
  return context.beforeCursor;
}

describe("language-aware typography preset", () => {
  test("preset adds typography rules on top of the recommended set", () => {
    expect(TYPOGRAPHY_GRAMMAR_RULES).toEqual(
      expect.arrayContaining([
        ...RECOMMENDED_CURRENT_GRAMMAR_RULES,
        "smartQuoteNormalization",
        "frenchPunctuationSpacing",
      ]),
    );
  });

  test.each([
    ["en_US", "She said \"quoted text\" and 'this' too.", "She said “quoted text” and ‘this’ too."],
    ["pl_PL", "Powiedział \"cytowany tekst\" i 'to'.", "Powiedział „cytowany tekst” i «to»."],
    ["de_DE", "Er sagte \"zitierter Text\" und 'das'.", "Er sagte „zitierter Text“ und ‚das‘."],
    ["fr_FR", 'Il a dit "texte cité" hier.', `Il a dit «${NBSP}texte cité${NBSP}» hier.`],
    // A space typed inside the guillemets is absorbed, not doubled.
    ["fr_FR", 'Il a dit " texte cité " hier.', `Il a dit «${NBSP}texte cité${NBSP}» hier.`],
    // Languages without a verified profile keep English quotes.
    ["es_ES", 'Dijo "hola" ayer.', "Dijo “hola” ayer."],
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

  test("French colon spacing still spaces a sentence colon", () => {
    expect(type("Note: ", "fr_FR")).toBe(`Note${NBSP}: `);
  });

  test("French colon spacing leaves other technical tokens alone", () => {
    expect(type("std::vector a:b localhost:3000 ", "fr_FR")).toBe(
      "std::vector a:b localhost:3000 ",
    );
  });

  test("straight quotes stay straight in code and protected contexts", () => {
    expect(type('Run `echo "hi"` now', "en_US")).toBe('Run `echo "hi"` now');
    expect(type('Set x = "a"', "de_DE")).toBe('Set x = "a"');
    expect(type('Say "hi" there', "fr_FR", "protected")).toBe('Say "hi" there');
    expect(type("Bonjour! ", "fr_FR", "protected")).toBe("Bonjour! ");
  });
});
