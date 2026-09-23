import { describe, expect, test } from "bun:test";
import { GrammarRuleEngine } from "../../src/core/domain/grammar/GrammarRuleEngine";
import { applyGrammarEditToContext } from "../../src/core/domain/grammar/GrammarEditSequencing";
import { createGrammarRuleCatalogRuntime } from "../../src/core/domain/grammar/ruleFactory";
import { CurrencySpacingRule } from "../../src/core/domain/grammar/implementations/CurrencySpacingRule";
import type { GrammarContext } from "../../src/core/domain/grammar/types";

const NBSP = " ";
const rule = new CurrencySpacingRule();

function context(
  beforeCursor: string,
  lang = "en_US",
  hints: GrammarContext["hints"] = {},
): GrammarContext {
  return {
    beforeCursor,
    afterCursor: "",
    hints: { lang, inputAction: "insert", measurementContext: "prose", ...hints },
  };
}

function applyRule(input: string, lang = "en_US", hints: GrammarContext["hints"] = {}): string {
  const edit = rule.apply(context(input, lang, hints));
  if (!edit) return input;
  return input.slice(0, input.length - edit.deleteBackwards) + edit.replacement;
}

function typeThroughAllRules(input: string, lang: string): string {
  const engine = new GrammarRuleEngine();
  for (const item of createGrammarRuleCatalogRuntime({
    insertSpaceAfterAutocomplete: true,
    userDictionaryList: [],
  })) {
    engine.registerRule(item);
  }
  let state = context("", lang);
  for (const char of input) {
    state.beforeCursor += char;
    const event = char === " " || char === "\n" ? "wordBoundary" : "insertChar";
    const edit = engine.processSequence([event], state);
    if (edit) state = applyGrammarEditToContext(state, edit);
  }
  return state.beforeCursor + state.afterCursor;
}

describe("currency spacing", () => {
  test("inserts one NBSP and keeps number, decimals, zeros and marker exactly", () => {
    const cases = [
      ["pl_PL", "Cena: 120zł ", `Cena: 120${NBSP}zł `],
      ["pl_PL", "Cena: 19,99zł ", `Cena: 19,99${NBSP}zł `],
      ["pl_PL", "Cena: 19,90zł\n", `Cena: 19,90${NBSP}zł\n`],
      ["en_US", "Budget: 250EUR ", `Budget: 250${NBSP}EUR `],
      ["en_US", "It costs 0.50USD ", `It costs 0.50${NBSP}USD `],
      ["de_DE", "Preis: 9,00€ ", `Preis: 9,00${NBSP}€ `],
      ["fr_FR", "Prix : 12€ ", `Prix : 12${NBSP}€ `],
      ["sv_SE", "Pris: 99kr ", `Pris: 99${NBSP}kr `],
      ["pt_BR", "Custa 100BRL ", `Custa 100${NBSP}BRL `],
      ["ar_SA", "السعر 50SAR ", `السعر 50${NBSP}SAR `],
      ["ar_SA", "السعر ١٫٥SAR ", `السعر ١٫٥${NBSP}SAR `],
    ] as const;
    for (const [lang, input, expected] of cases) {
      expect(applyRule(input, lang)).toBe(expected);
      expect(typeThroughAllRules(input, lang)).toBe(expected);
    }
  });

  test("never reorders, converts, regroups or renames", () => {
    const unchanged = [
      ["en_US", "Price: $100 "],
      ["en_US", "Price: €100 "],
      ["en_US", "Price: 100$ "],
      ["en_US", "Price: 100£ "],
      ["en_US", "Price: 1,000USD "],
      ["de_DE", "Preis: 1.000EUR "],
      ["pl_PL", "Cena: 1 000zł "],
      ["en_US", "Price: 10-20EUR "],
      ["en_US", "Rate: 1.5e3USD "],
    ] as const;
    for (const [lang, input] of unchanged) {
      expect(applyRule(input, lang)).toBe(input);
      expect(typeThroughAllRules(input, lang)).toBe(input);
    }
  });

  test("leaves existing separators, unknown markers and non-currency words alone", () => {
    const unchanged = [
      "Budget: 250 EUR ",
      `Budget: 250${NBSP}EUR `,
      "Budget: 250 EUR ",
      "Budget: 250eur ",
      "Budget: 250Eur ",
      "Budget: 250EURO ",
      "Budget: 250EURs ",
      "Budget: 250EURUSD ",
      "Pair: EUR250 ",
      "Tickets: 3ALL ",
      "Go 2TRY ",
      "Model 3CAD ",
      "Budget: 250zl ",
      "Budget: 250ZŁ ",
      "Budget: 250kr. ",
      "Budget: 250EUR",
      "Budget: 250EUR, ",
    ];
    for (const input of unchanged) {
      expect(applyRule(input)).toBe(input);
    }
  });

  test("requires prose context and a verified locale", () => {
    const unchanged: Array<[string, string, GrammarContext["hints"]?]> = [
      ["let price = 250EUR ", "en_US"],
      ["const x = 5USD ", "en_US"],
      ["https://shop.example/250EUR ", "en_US"],
      ["path/to/250EUR ", "en_US"],
      ["`250EUR ", "en_US"],
      ["```\n250EUR ", "en_US"],
      ["f(250EUR ", "en_US"],
      ["id_250EUR ", "en_US"],
      ["$250EUR ", "en_US"],
      ["Budget: 250EUR ", "en_GB"],
      ["Budget: 250EUR ", "pt_PT"],
      ["Budget: 250EUR ", "en"],
      ["Budget: 250EUR ", "en_US", { measurementContext: "protected" }],
      ["Budget: 250EUR ", "en_US", { measurementContext: undefined }],
      ["Budget: 250EUR ", "en_US", { isPaste: true }],
      ["Budget: 250EUR ", "en_US", { inputAction: "delete" }],
    ];
    for (const [input, lang, hints] of unchanged) {
      expect(applyRule(input, lang, hints)).toBe(input);
    }
    expect(rule.apply({ ...context("Budget: 250EUR "), afterCursor: "x" })).toBeNull();
  });

  test("does not fire on idle or ordinary characters, and output is stable", () => {
    expect(rule.triggers).toEqual(["wordBoundary"]);
    const once = applyRule("Cena: 120zł ", "pl_PL");
    expect(applyRule(once, "pl_PL")).toBe(once);
    expect(typeThroughAllRules("Cena: 120zł i 5,50zł dopłaty ", "pl_PL")).toBe(
      `Cena: 120${NBSP}zł i 5,50${NBSP}zł dopłaty `,
    );
  });
});
