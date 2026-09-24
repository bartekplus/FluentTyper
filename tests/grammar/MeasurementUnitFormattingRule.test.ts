import { describe, expect, test } from "bun:test";
import { MeasurementUnitFormattingRule } from "../../src/core/domain/grammar/implementations/MeasurementUnitFormattingRule";
import type { GrammarContext } from "../../src/core/domain/grammar/types";

const rule = new MeasurementUnitFormattingRule();

function apply(
  beforeCursor: string,
  lang = "en_US",
  extra: Partial<NonNullable<GrammarContext["hints"]>> = {},
) {
  return rule.apply({
    beforeCursor,
    afterCursor: "",
    hints: { lang, inputAction: "insert", measurementContext: "prose", ...extra },
  });
}

function result(beforeCursor: string, lang = "en_US"): string {
  const edit = apply(beforeCursor, lang);
  if (!edit) return beforeCursor;
  return beforeCursor.slice(0, -edit.deleteBackwards) + edit.replacement;
}

describe("MeasurementUnitFormattingRule", () => {
  test("inserts one nonbreaking space without changing quantity text", () => {
    const cases = [
      ["Mass: 10kg ", "Mass: 10\u00a0kg "],
      ["Mass: 1.50kg ", "Mass: 1.50\u00a0kg "],
      ["Speed: 5m/s ", "Speed: 5\u00a0m/s "],
      ["Energy: 10kWh ", "Energy: 10\u00a0kWh "],
      ["Storage: 250MiB ", "Storage: 250\u00a0MiB "],
      ["Value: 2W/(m·K) ", "Value: 2\u00a0W/(m·K) "],
      ["Value: 3kg/m³ ", "Value: 3\u00a0kg/m³ "],
      ["Value: 4N·m\n", "Value: 4\u00a0N·m\n"],
    ];
    for (const [input, expected] of cases) expect(result(input)).toBe(expected);
    expect(result("Masa: 1,50kg ", "pl_PL")).toBe("Masa: 1,50\u00a0kg ");
    expect(result("Δοκιμή: 10kg ")).toBe("Δοκιμή: 10\u00a0kg ");
  });

  test("preserves valid spacing, symbol case, and idempotence", () => {
    for (const input of ["Mass: 10 kg ", "Mass: 10\u00a0kg "]) {
      expect(apply(input)).toBeNull();
    }
    expect(result("Value: 20C ")).toBe("Value: 20C ");
    expect(result("Value: 20F ")).toBe("Value: 20F ");
    expect(result("Value: 20K ")).toBe("Value: 20K ");
    expect(result("Value: 20°C ")).toBe("Value: 20\u00a0°C ");
    const once = result("Mass: 10kg ");
    expect(result(once)).toBe(once);
  });

  test("fails closed outside explicit insert prose context and known locale", () => {
    expect(apply("Mass: 10kg ", "xx_XX")).toBeNull();
    expect(apply("Mass: 10kg ", "en_US", { inputAction: "delete" })).toBeNull();
    expect(apply("Mass: 10kg ", "en_US", { isPaste: true })).toBeNull();
    expect(
      rule.apply({
        beforeCursor: "Mass: 10kg ",
        afterCursor: "",
        hints: { lang: "en_US", inputAction: "insert" },
      }),
    ).toBeNull();
    expect(
      rule.apply({
        beforeCursor: "Mass: 10kg ",
        afterCursor: "x",
        hints: { lang: "en_US", inputAction: "insert", measurementContext: "prose" },
      }),
    ).toBeNull();
  });

  test("rejects ambiguous, malformed, partial, and technical text", () => {
    const rejected = [
      "Note: 10in ",
      "Note: 10as ",
      "Note: 10am ",
      "Note: 10Ms ",
      "Name: 10Smith ",
      "Value: 10m/ ",
      "Value: 10W/(m·K ",
      "Value: 10m^ ",
      "Value: 10m⁻ ",
      "Value: 10m⁻⁻² ",
      "Range: 10-12kg ",
      "Fraction: 1/2kg ",
      "Uncertainty: 10±2kg ",
      "Grouped: 1,234kg ",
      "URL https://example.test/10kg ",
      "Path: /tmp/10kg ",
      "Code: value_10kg ",
      "Mass: \u202e10kg ",
    ];
    for (const input of rejected) expect(apply(input)).toBeNull();
    expect(apply(`Value: ${"1".repeat(129)}kg `)).toBeNull();
    expect(apply(`${"Prose ".repeat(90)}Mass: 10kg `)).toBeNull();
  });

  test("does not run before the expression is completed", () => {
    expect(apply("Mass: 10kg")).toBeNull();
    expect(apply("Mass: 10kg. ")).toBeNull();
    expect(rule.triggers).toEqual(["wordBoundary"]);
  });

  test("sentence-initial words that happen to be shell commands are prose", () => {
    expect(result("Cat weighs 5kg ")).toBe("Cat weighs 5 kg ");
    expect(result("Touch the 5kg ")).toBe("Touch the 5 kg ");
    expect(result("Tar det 5kg ", "sv_SE")).toBe("Tar det 5 kg ");
    expect(result("Sed de 5kg ", "es_ES")).toBe("Sed de 5 kg ");
  });

  test("indented lines are prose", () => {
    expect(result("\tThe box weighs 5kg ")).toBe("\tThe box weighs 5\u00a0kg ");
  });
});
