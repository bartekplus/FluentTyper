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

const MEMBERS = Object.getOwnPropertyNames(Object.prototype);
// "@" is the member, "^" the member with a capital. Shapes for all languages.
const SHAPES = ["@", "@ geht. El @ llega mañana. The @ runs.", "^ @ @s. @, @?"];
// Sentence shapes in which the English agreement, number and countability checks read the word.
const ENGLISH_SHAPES = [
  "These @ is fine.",
  "This @s are fine.",
  "Two @ are here.",
  "Each of the @s are here.",
  "The @ of the @s are good.",
  "My @ and his @ runs.",
  "many @",
  "less @s",
  "She @ it daily.",
  "They @s it.",
];
// English frames that look a typed word up in a map.
const ENGLISH_FRAME_SHAPES = [
  "It was one of the @ that failed.",
  "We met @' s friend there.",
  "You @n't do that.",
];
const LANG_SHAPES: Record<string, string[]> = {
  en_US: [...SHAPES, ...ENGLISH_SHAPES, ...ENGLISH_FRAME_SHAPES],
  ...Object.fromEntries(
    ["de_DE", "fr_FR", "es_ES", "pt_BR", "pl_PL", "hr_HR", "el_GR", "sv_SE", "ar_SA"].map(
      (lang) => [lang, SHAPES],
    ),
  ),
};
const capitalized = (word: string) => `${word[0].toUpperCase()}${word.slice(1)}`;

test.each(Object.entries(LANG_SHAPES))(
  "%s: Object member names are plain words",
  (lang, shapes) => {
    const rules = languageRules(lang);
    for (const member of MEMBERS)
      for (const shape of shapes) {
        const text = shape.replaceAll("^", capitalized(member)).replaceAll("@", member);
        const { coverage, diagnostics } = scanResult(text, { lang, enabledRules: rules });
        expect({ text, failed: coverage.failedRules }).toEqual({ text, failed: [] });
        for (const diagnostic of diagnostics)
          for (const alternative of diagnostic.alternatives)
            expect(typeof alternative.preview).toBe("string");
      }
  },
);

test('English: "constructor" gets the findings of another noun ("conductor")', () => {
  const rules = languageRules("en_US");
  const findings = (noun: string, shape: string) =>
    scanResult(shape.replaceAll("@", noun), { lang: "en_US", enabledRules: rules })
      .diagnostics.map((d) => `${d.ruleId}: ${d.alternatives.map((a) => a.preview).join(" | ")}`)
      .map((line) => line.replaceAll(noun, "@"));
  for (const shape of ENGLISH_SHAPES)
    expect({ shape, findings: findings("constructor", shape) }).toEqual({
      shape,
      findings: findings("conductor", shape),
    });
});
