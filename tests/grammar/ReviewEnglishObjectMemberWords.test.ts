import { expect, test } from "bun:test";
import { compileGrammarRules } from "../../scripts/grammarRules";
import { languageRules, scanResult } from "./reviewHarness";

// A word table that a typed word keys must not read Object members ("constructor", "toString"):
// the member is a function, so a check crashed or gave a function as its fix. The maps of the rule
// files are tables with no prototype.
test("the maps of the rule files have no prototype", async () => {
  const set = await compileGrammarRules();
  const withPrototype: string[] = [];
  for (const [file, code] of Object.entries(set.code)) {
    const names = Object.keys(code.maps);
    if (!names.length) continue;
    const module = (await import(
      `../../src/core/domain/grammar/review/rules/${file}.generated.ts`
    )) as Record<string, unknown>;
    for (const name of names)
      if (Object.getPrototypeOf(module[name]) !== null) withPrototype.push(`${file}.${name}`);
  }
  expect(withPrototype).toEqual([]);
});

const MEMBERS = Object.getOwnPropertyNames(Object.prototype).filter((name) => /^[a-z]/i.test(name));
// Sentence shapes in which the agreement, number and countability checks read the word.
const SHAPES = [
  "These W is fine.",
  "This Ws are fine.",
  "Two W are here.",
  "Each of the Ws are here.",
  "The W of the Ws are good.",
  "My W and his W runs.",
  "many W",
  "less Ws",
  "She W it daily.",
  "They Ws it.",
];

test("English: an Object member name is a plain word in every sentence shape", () => {
  const rules = languageRules("en_US");
  for (const member of MEMBERS)
    for (const shape of SHAPES) {
      const text = shape.replaceAll("W", member);
      const { coverage, diagnostics } = scanResult(text, { lang: "en_US", enabledRules: rules });
      expect({ text, failed: coverage.failedRules }).toEqual({ text, failed: [] });
      for (const diagnostic of diagnostics)
        for (const alternative of diagnostic.alternatives)
          expect(typeof alternative.preview).toBe("string");
    }
});

test('English: "constructor" gets the findings of another noun ("conductor")', () => {
  const rules = languageRules("en_US");
  const findings = (noun: string, shape: string) =>
    scanResult(shape.replaceAll("W", noun), { lang: "en_US", enabledRules: rules })
      .diagnostics.map((d) => `${d.ruleId}: ${d.alternatives.map((a) => a.preview).join(" | ")}`)
      .map((line) => line.replaceAll(noun, "W"));
  for (const shape of SHAPES)
    expect({ shape, findings: findings("constructor", shape) }).toEqual({
      shape,
      findings: findings("conductor", shape),
    });
});
