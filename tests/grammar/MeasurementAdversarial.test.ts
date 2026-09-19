import { describe, expect, test } from "bun:test";
import { SUPPORTED_LANGUAGES } from "@core/domain/lang";
import { GrammarRuleEngine } from "../../src/core/domain/grammar/GrammarRuleEngine";
import { applyGrammarEditToContext } from "../../src/core/domain/grammar/GrammarEditSequencing";
import { createGrammarRuleCatalogRuntime } from "../../src/core/domain/grammar/ruleFactory";
import { MeasurementUnitFormattingRule } from "../../src/core/domain/grammar/implementations/MeasurementUnitFormattingRule";
import type { GrammarContext, GrammarEdit } from "../../src/core/domain/grammar/types";
import { MEASUREMENT_LOCALES } from "../../src/core/domain/grammar/measurement/registry-data.generated";

const NBSP = "\u00a0";
const rule = new MeasurementUnitFormattingRule();

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

function apply(input: string, edit: GrammarEdit | null): string {
  if (!edit) return input;
  const start = input.length - edit.deleteBackwards;
  return `${input.slice(0, start)}${edit.replacement}${input.slice(input.length + edit.deleteForwards)}`;
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
    const event =
      char === " " || char === "\u00a0" || char === "\n" ? "wordBoundary" : "insertChar";
    const edit = engine.processSequence([event], state);
    if (edit) state = applyGrammarEditToContext(state, edit);
  }
  return state.beforeCursor + state.afterCursor;
}

describe("measurement formatting adversarial verification", () => {
  test("preserves the authored quantity and unit in every supported locale", () => {
    const cases = [
      ["en_US", "Mass: 1.50kg ", `Mass: 1.50${NBSP}kg `],
      ["fr_FR", "Masse : 1,50kg ", `Masse : 1,50${NBSP}kg `],
      ["hr_HR", "Masa: 1,50kg ", `Masa: 1,50${NBSP}kg `],
      ["es_ES", "Masa: 1,50kg ", `Masa: 1,50${NBSP}kg `],
      ["el_GR", "Μάζα: 1,50kg ", `Μάζα: 1,50${NBSP}kg `],
      ["sv_SE", "Massa: 1,50kg ", `Massa: 1,50${NBSP}kg `],
      ["de_DE", "Masse: 1,50kg ", `Masse: 1,50${NBSP}kg `],
      ["pl_PL", "Masa: 1,50kg ", `Masa: 1,50${NBSP}kg `],
      ["pt_BR", "Massa: 1,50kg ", `Massa: 1,50${NBSP}kg `],
    ] as const;
    expect(cases.map(([lang]) => lang).sort()).toEqual(
      Object.keys(SUPPORTED_LANGUAGES)
        .filter((lang) => !["auto_detect", "textExpander"].includes(lang))
        .sort(),
    );
    expect(MEASUREMENT_LOCALES.map(({ locale }) => locale)).toEqual(
      cases.map(([locale]) => locale),
    );
    for (const [lang, input, expected] of cases) {
      expect(apply(input, rule.apply(context(input, lang)))).toBe(expected);
    }
  });

  test("preserves exact accepted lexemes and rejects unsupported numeric notation", () => {
    const accepted = [
      ["Mass: -0012.340kg ", `Mass: -0012.340${NBSP}kg `],
      ["Mass: +999999999999999999999999kg ", `Mass: +999999999999999999999999${NBSP}kg `],
      ["Temperatura: 20°C ", `Temperatura: 20${NBSP}°C `],
      ["Μάζα: 10μg ", `Μάζα: 10${NBSP}μg `],
    ] as const;
    for (const [input, expected] of accepted)
      expect(apply(input, rule.apply(context(input)))).toBe(expected);

    const rejected = [
      ["en_US", "Value: 1,234kg "],
      ["fr_FR", "Valeur : 1.234kg "],
      ["en_US", "Value: 1 234kg "],
      ["fr_FR", "Valeur : 1\u202f234kg "],
      ["en_US", "Value: 1,23.4kg "],
      ["en_US", "Value: 1e3kg "],
      ["en_US", "Value: 1E+3kg "],
      ["en_US", "Value: ½kg "],
      ["en_US", "Value: 10–12kg "],
      ["en_US", "Value: 10—12kg "],
      ["en_US", "Value: 10±2kg "],
    ] as const;
    for (const [lang, input] of rejected) expect(rule.apply(context(input, lang))).toBeNull();
  });

  test("does not reinterpret localized words or written unit names as symbols", () => {
    const cases = [
      ["pl_PL", "Zdanie: 10Pa "],
      ["de_DE", "Termin: 10am "],
      ["sv_SE", "Tid: 10minuter "],
      ["pt_BR", "Texto: 10as "],
      ["en_US", "Mass: 10kilograms "],
    ] as const;
    for (const [lang, input] of cases) expect(rule.apply(context(input, lang))).toBeNull();
  });

  test("bounded parser leaves long malformed Unicode tails unchanged", () => {
    const fragments = ["λ", "Ж", "漢", "🙂", "\u0301", "⁻", "(", "/", "·"];
    for (let index = 0; index < 300; index += 1) {
      const tail = Array.from(
        { length: 160 },
        (_, offset) => fragments[(index + offset) % fragments.length],
      ).join("");
      const input = `Note: ${index}${tail} `;
      expect(rule.apply(context(input))).toBeNull();
    }
  });

  test("accepts signed, prefixed, exponent, compound, and grouped unit expressions", () => {
    const cases = [
      "Value: -12kg ",
      "Value: +2MiB ",
      "Area: 3m² ",
      "Rate: 4kg/m³ ",
      "Flux: 2W/(m·K) ",
    ];
    for (const input of cases) {
      const output = apply(input, rule.apply(context(input)));
      expect(output).toBe(input.replace(/(?<=\d)(?=[+\p{L}%°Ωµμ(])/u, NBSP));
    }
  });

  test("rejects malformed tails, identifiers, ambiguous symbols, code, paste, and non-insert actions", () => {
    const rejected = [
      "Value: 1.kg ",
      "Value: 1,5kg ",
      "Value: 2m/ ",
      "Value: 2m^- ",
      "Value: 2W/(m·K ",
      "Value: 2m//s ",
      "Identifier: item10kg ",
      "Identifier: value_10kg ",
      "Range: 10-12kg ",
      "Fraction: 1/2kg ",
      "Uncertainty: 10±2kg ",
      "Text: 10in ",
      "Text: 10as ",
      "Text: 10Ms ",
      "Path: /tmp/10kg ",
      "URL: https://example.test/10kg ",
      "Code: `10kg ",
      "Code: const x=10kg ",
      "Option: --mass 10kg ",
      "sudo echo 10kg ",
      "git tag 10kg ",
      "let mass 10kg ",
      "Value: 10(m) ",
      "width: 10cm ",
      "font-size: 10em ",
      "~~~\nMass: 10kg ",
      "`code\nMass: 10kg ",
      "Video: 4K ",
      "Network: 5G ",
      "Grade: 10A ",
      "Temperature: 10°C² ",
    ];
    for (const input of rejected) expect(rule.apply(context(input))).toBeNull();
    expect(rule.apply(context("Mass: 10kg ", "en_US", { isPaste: true }))).toBeNull();
    expect(rule.apply(context("Mass: 10kg ", "en_US", { inputAction: "delete" }))).toBeNull();
    expect(
      rule.apply(context("Mass: 10kg ", "en_US", { measurementContext: "protected" })),
    ).toBeNull();
  });

  test("leaves existing regular, nonbreaking, and narrow nonbreaking separators unchanged", () => {
    for (const input of ["Mass: 10 kg ", `Mass: 10${NBSP}kg `, "Mass: 10\u202fkg "]) {
      expect(rule.apply(context(input))).toBeNull();
    }
  });

  test("all-default pipeline reaches a stable result without rewriting operators or exponents", () => {
    const engine = new GrammarRuleEngine();
    for (const item of createGrammarRuleCatalogRuntime({
      insertSpaceAfterAutocomplete: true,
      userDictionaryList: [],
    }))
      engine.registerRule(item);
    for (const input of [
      "Value: 10kg ",
      "Value: 1.50kg ",
      "Area: 3m² ",
      "Rate: 4kg/m³ ",
      "Flux: 2W/(m·K) ",
    ]) {
      const edit = engine.processSequence(["insertChar", "wordBoundary"], context(input));
      const output = apply(input, edit);
      expect(output).toBe(input.replace(/(?<=\d)(?=[+\p{L}%°Ωµμ(])/u, NBSP));
      expect(engine.processSequence(["insertChar", "wordBoundary"], context(output))).toBeNull();
    }
  });

  test("type-by-type all-rule pipeline preserves numeric and compound syntax", () => {
    const cases = [
      ["en_US", "Mass: 1.50kg ", `Mass: 1.50${NBSP}kg `],
      ["pl_PL", "Masa: 1,50kg ", `Masa: 1,50${NBSP}kg `],
      ["en_US", "Flux: 2W/(m·K) ", `Flux: 2${NBSP}W/(m·K) `],
      ["en_US", "Area: 3m^2 ", `Area: 3${NBSP}m^2 `],
      ["en_US", "Rate: 4m^-2 ", `Rate: 4${NBSP}m^-2 `],
      ["en_US", "Scientific: 1e+3kg ", "Scientific: 1e+3kg "],
      ["en_US", "Scientific: -1.2e-3kg ", "Scientific: -1.2e-3kg "],
      ["en_US", "Grouped: 1,234.50kg ", "Grouped: 1,234.50kg "],
      ["pl_PL", "Grupa: 1.234,50kg ", "Grupa: 1.234,50kg "],
      ["en_US", "Range: 10-12kg ", "Range: 10-12kg "],
    ] as const;
    for (const [lang, input, expected] of cases) {
      expect(typeThroughAllRules(input, lang)).toBe(expected);
    }
  });
});

test("generated approved edits preserve independent quantities, units, and UTF-16 bounds", () => {
  for (const number of ["0", "-0", "+1", "1.50", "1.234", "90071992547409931234567890"]) {
    for (const unit of [
      "kg",
      "ms",
      "mW",
      "MW",
      "nm",
      "kWh",
      "MiB",
      "°C",
      "°F",
      "m²",
      "m/s²",
      "N·m",
      "W/(m·K)",
      "ml",
    ]) {
      const input = `Measured: ${number}${unit} `;
      const edit = rule.apply(context(input));
      expect(edit).not.toBeNull();
      expect(edit!.deleteBackwards).toBeGreaterThan(0);
      expect(edit!.deleteBackwards).toBeLessThanOrEqual(input.length);
      expect(edit!.deleteForwards).toBe(0);
      const expected = `Measured: ${number}${NBSP}${unit} `;
      expect(apply(input, edit)).toBe(expected);
      expect(rule.apply(context(expected))).toBeNull();
    }
  }
  for (const symbol of [
    "C",
    "F",
    "K",
    "ms",
    "Ms",
    "mW",
    "MW",
    "Mb",
    "MB",
    "kB",
    "KiB",
    "kW",
    "kWh",
    "nm",
  ]) {
    const input = `Measured: 10 ${symbol} `;
    expect(rule.apply(context(input))).toBeNull();
  }
});

test("arbitrary Unicode input never throws or emits out-of-bounds edits", () => {
  let seed = 1729;
  for (let sample = 0; sample < 1000; sample += 1) {
    let text = "";
    for (let i = 0; i < sample % 130; i += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      text += String.fromCharCode(seed & 0xffff);
    }
    const input = `${text} `;
    const edit = rule.apply(context(input));
    if (edit) {
      expect(edit.deleteBackwards).toBeLessThanOrEqual(input.length);
      expect(edit.deleteForwards).toBe(0);
      const output = apply(input, edit);
      expect(output.replace(NBSP, "")).toBe(input);
      expect(rule.apply(context(output))).toBeNull();
    }
  }
});
