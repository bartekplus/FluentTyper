import { describe, expect, test } from "bun:test";
import { DEFAULT_CURRENT_GRAMMAR_RULES } from "../../src/core/domain/grammar/ruleCatalog";
import { typeText } from "./grammarTestUtils";

const type = (input: string, lang: string, insertSpaceAfterAutocomplete = true) =>
  typeText(input, { lang, rules: DEFAULT_CURRENT_GRAMMAR_RULES, insertSpaceAfterAutocomplete })
    .beforeCursor;

describe("measurement formatting during typing", () => {
  for (const [input, lang, expected] of [
    ["Mass: 1.50kg ", "en_US", "Mass: 1.50\u00a0kg "],
    ["Masa: 1,50kg ", "pl_PL", "Masa: 1,50\u00a0kg "],
    ["Speed: 5m/s ", "en_US", "Speed: 5\u00a0m/s "],
    ["Flux: 2W/(m·K) ", "en_US", "Flux: 2\u00a0W/(m·K) "],
    ["Area: 3m² ", "en_US", "Area: 3\u00a0m² "],
    ["Scientific: 1.e3 and 1.e+3kg ", "en_US", "Scientific: 1.e3 and 1.e+3kg "],
    // The same text twice must format the same way: nothing before a
    // measurement is not evidence against prose.
    ["2Mbit 2Mbit ", "en_US", "2\u00a0Mbit 2\u00a0Mbit "],
    ["2kg 2kg ", "en_US", "2\u00a0kg 2\u00a0kg "],
    ["10kg ", "en_US", "10\u00a0kg "],
    ["/tmp/10kg ", "en_US", "/tmp/10kg "],
    ["```\nMass: 10kg ", "en_US", "```\nMass: 10kg "],
  ])
    test(input, () => expect(type(input, lang)).toBe(expected));

  test("defers numeric punctuation until prose continuation is known", () => {
    expect(type("There were 2,and", "en_US")).toBe("There were 2, and");
    // A period after a number is left alone: "v2.next" and "1.x" are tokens.
    expect(type("It ended in 2026.next", "en_US")).toBe("It ended in 2026.next");
    expect(type("It ended in 2026. next ", "en_US")).toBe("It ended in 2026. Next ");
    expect(type("It cost 1.50,and", "en_US")).toBe("It cost 1.50, and");
    expect(type("It cost 1.50.next", "en_US")).toBe("It cost 1.50.next");
    expect(type("There were 1,234,and", "en_US")).toBe("There were 1,234, and");
    expect(type("Values: 1.50 and 1,234", "en_US")).toBe("Values: 1.50 and 1,234");
  });

  test("leaves deferred punctuation alone when automatic spacing is disabled", () => {
    expect(type("There were 2,and", "en_US", false)).toBe("There were 2,and");
  });
});
