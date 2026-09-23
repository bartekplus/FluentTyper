import { describe, expect, test } from "bun:test";
import { GrammarRuleEngine } from "../../src/core/domain/grammar/GrammarRuleEngine";
import { applyGrammarEditToContext } from "../../src/core/domain/grammar/GrammarEditSequencing";
import { createGrammarRuleCatalogRuntime } from "../../src/core/domain/grammar/ruleFactory";
import { DEFAULT_CURRENT_GRAMMAR_RULES } from "../../src/core/domain/grammar/ruleCatalog";
import { CurrencySpacingRule } from "../../src/core/domain/grammar/implementations/CurrencySpacingRule";
import type { GrammarContext } from "../../src/core/domain/grammar/types";
import { SuggestionGrammarCoordinator } from "../../src/adapters/chrome/content-script/suggestions/SuggestionGrammarCoordinator";

const NBSP = " ";
const rule = new CurrencySpacingRule();
const DEFAULTS: string[] = DEFAULT_CURRENT_GRAMMAR_RULES;
const DEFAULTS_WITHOUT_RULE = DEFAULTS.filter((id) => id !== "currencySpacing");

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

/** Types `input` one keystroke at a time; `rules` undefined runs every registered rule. */
function type(input: string, lang: string, rules?: string[]): string {
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
    const edit = engine.processSequence([event], state, rules);
    if (edit) state = applyGrammarEditToContext(state, edit);
  }
  return state.beforeCursor + state.afterCursor;
}

/** The rule leaves `input` alone on its own, keystroke by keystroke, and in the default pipeline. */
function expectUnchanged(input: string, lang = "en_US"): void {
  expect(applyRule(input, lang)).toBe(input);
  expect(type(input, lang, ["currencySpacing"])).toBe(input);
  expect(type(input, lang, DEFAULTS)).toBe(type(input, lang, DEFAULTS_WITHOUT_RULE));
}

describe("currency spacing", () => {
  test("is on in the production default selection", () => {
    expect(DEFAULTS).toContain("currencySpacing");
  });

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
      expect(type(input, lang, ["currencySpacing"])).toBe(expected);
      expect(type(input, lang, DEFAULTS)).toBe(expected);
      expect(type(input, lang)).toBe(expected);
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
      expectUnchanged(input, lang);
    }
  });

  test("leaves existing separators, unknown markers and non-currency words alone", () => {
    for (const input of [
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
      "Budget: 250EUR, ",
    ]) {
      expectUnchanged(input);
    }
    expect(applyRule("Budget: 250EUR")).toBe("Budget: 250EUR");
  });

  test("leaves code, commands and literal text unchanged", () => {
    for (const input of [
      "let price = 250EUR ",
      "const x = 5USD ",
      "https://shop.example/250EUR ",
      "path/to/250EUR ",
      "`250EUR ",
      "```\n250EUR ",
      "f(250EUR ",
      "id_250EUR ",
      "$250EUR ",
      // Shell arguments are file names and patterns, not prices.
      ...["cp", "mv", "rm", "cd", "cat", "touch", "grep", "ls", "mkdir"].flatMap((cmd) => [
        `${cmd} 250EUR `,
        `${cmd[0].toUpperCase()}${cmd.slice(1)} 250EUR `,
        `${cmd} -r 250EUR `,
      ]),
      "cp 250EUR backup ",
      // Indented Markdown code blocks are literal.
      "    250EUR ",
      "\t250EUR ",
      "Example:\n\n    250EUR ",
      "Example:\n\n\t250EUR ",
      "    Price: 250EUR ",
    ]) {
      expectUnchanged(input);
    }
  });

  test("requires a verified locale", () => {
    for (const lang of ["en_GB", "pt_PT", "en"]) {
      expectUnchanged("Budget: 250EUR ", lang);
    }
    expect(rule.apply({ ...context("Budget: 250EUR "), afterCursor: "x" })).toBeNull();
  });

  test("coordinator leaves protected, paste, delete and idle input alone", () => {
    const grammar = new SuggestionGrammarCoordinator({
      enabledGrammarRules: DEFAULTS,
      insertSpaceAfterAutocomplete: true,
      lang: "en_US",
      userDictionaryList: [],
    });
    const input = {
      beforeCursor: "Budget: 250EUR ",
      afterCursor: "",
      inputAction: "insert" as const,
      measurementContext: "prose" as const,
      triggers: ["wordBoundary" as const],
    };
    const edit = grammar.run(input);
    expect(edit?.sourceRuleId).toBe("currencySpacing");
    expect(edit?.replacement).toBe(`250${NBSP}EUR `);
    expect(grammar.run({ ...input, measurementContext: "protected" })).toBeNull();
    expect(grammar.run({ ...input, measurementContext: undefined })).toBeNull();
    expect(grammar.run({ ...input, triggers: ["paste", "wordBoundary"] })).toBeNull();
    expect(grammar.run({ ...input, inputAction: "delete" })).toBeNull();
    expect(grammar.run({ ...input, triggers: ["idle"] })).toBeNull();
    grammar.updateLanguage("en-GB");
    expect(grammar.run(input)).toBeNull();
  });

  test("output is stable and repeated amounts are each spaced once", () => {
    const once = applyRule("Cena: 120zł ", "pl_PL");
    expect(applyRule(once, "pl_PL")).toBe(once);
    expect(type("Cena: 120zł i 5,50zł dopłaty ", "pl_PL", DEFAULTS)).toBe(
      `Cena: 120${NBSP}zł i 5,50${NBSP}zł dopłaty `,
    );
  });
});
