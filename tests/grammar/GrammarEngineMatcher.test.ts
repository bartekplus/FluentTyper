import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { compileRuleFiles, RULE_FILES } from "../../src/core/domain/grammar/engine/compiler";
import { findMatches, type PatternSet } from "../../src/core/domain/grammar/engine/matcher";
import { PatternLiveRule } from "../../src/core/domain/grammar/engine/liveRules";
import { patternDetector } from "../../src/core/domain/grammar/engine/reviewRules";
import { tokenize } from "../../src/core/domain/grammar/engine/tokenizer";
import type { RuleFile, RuleSpec } from "../../src/core/domain/grammar/engine/types";
import { GrammarRuleEngine } from "../../src/core/domain/grammar/GrammarRuleEngine";
import { applyGrammarEditToContext } from "../../src/core/domain/grammar/GrammarEditSequencing";
import type { DetectContext } from "../../src/core/domain/grammar/review/reviewDetectors";
import type { GrammarContext, GrammarRuleId } from "../../src/core/domain/grammar/types";

// Settings copy that every check carries.
const COPY = {
  text: {
    title: Object.fromEntries(
      ["en", "fr", "hr", "es", "el", "sv", "de", "pl", "pr"].map((l) => [l, "Demo"]),
    ),
    description: Object.fromEntries(
      ["en", "fr", "hr", "es", "el", "sv", "de", "pl", "pr"].map((l) => [l, "Demo."]),
    ),
  },
  example: { lang: "en_US", before: "a", after: "b" },
};
const RULES: RuleSpec[] = [
  {
    id: "en.couldOf",
    checks: ["demoCheck"],
    modes: ["live", "review"],
    pattern: [{ lower: ["could", "should", "would"] }, { lower: "of" }],
    target: [2, 2],
    replacements: ["have"],
    message: "review_msg_typo",
  },
  {
    id: "en.repeated",
    checks: ["demoCheck"],
    pattern: [{ type: "word" }, { matchRef: 1, spaceBefore: true }],
    replacements: ["$1"],
    message: "review_msg_repeated_words",
  },
  {
    id: "en.spaceComma",
    checks: ["demoCheck"],
    lang: "*",
    pattern: [{ type: "word" }, { surface: ",", spaceBefore: true }],
    replacements: ["$1,"],
    message: "review_msg_typo",
  },
  {
    id: "en.aHour",
    checks: ["demoCheck"],
    pattern: [{ lower: "a" }, { type: "word", predicate: "enStartsWithVowelSound" }],
    replacements: ["${1}n $2"],
    message: "review_msg_typo",
  },
];
const SET = compileRuleFiles([
  [
    "common",
    {
      lang: "*",
      checks: [
        {
          ...COPY,
          id: "demoCheck",
          modes: ["live", "review"],
          priority: 1,
          category: "grammar",
          kind: "usage",
          safeToFix: true,
        },
      ],
    },
  ],
  ["en", { lang: "en", rules: RULES }],
]);
const REVIEW = SET.reviewPatterns as PatternSet;

const fixes = (text: string, lang = "en_US", set = REVIEW) =>
  findMatches(set, tokenize(text), text, lang, () => true).map(
    (m) => `${text.slice(m.targetStart, m.targetEnd)} -> ${m.alternatives.join(" | ")}`,
  );

test("anchored rules match and keep the casing of the replaced text", () => {
  expect(fixes("We could of left.")).toEqual(["of -> have"]);
  expect(fixes("WE SHOULD OF LEFT")).toEqual(["OF -> HAVE"]);
  expect(fixes("A hour and a user.")).toEqual(["A hour -> An hour"]);
});

test("structural rules: back references and whitespace", () => {
  expect(fixes("It is is the the end")).toEqual(["is is -> is", "the the -> the"]);
  // No space between the words: not a repetition.
  expect(fixes("bye-bye")).toEqual([]);
  expect(fixes("one , two")).toEqual(["one , -> one,"]);
});

test("protected spans, line breaks and other languages stay silent", () => {
  expect(fixes("Run `could of` or see https://x.org/could/of")).toEqual([]);
  expect(fixes("could\nof")).toEqual([]);
  expect(fixes("could of", "de_DE")).toEqual([]);
  // "*" rules run in every language.
  expect(fixes("eins , zwei", "de_DE")).toEqual(["eins , -> eins,"]);
});

const context = (text: string, overrides: Partial<DetectContext> = {}): DetectContext => ({
  source: text,
  text,
  scanText: text,
  from: 0,
  to: text.length,
  lang: "en_US",
  dictionary: new Set(),
  insertSpaceAfterAutocomplete: true,
  ...overrides,
});

test("the Review adapter: findings, ownership, dictionary and one scan per chunk", () => {
  const detect = patternDetector(0, REVIEW);
  const text = "I could of known. You would of too.";
  const ctx = context(text);
  // A test check id, outside the catalog type.
  expect(detect(ctx) as unknown[]).toEqual([
    {
      ruleId: "demoCheck",
      messageKey: "review_msg_typo",
      range: { start: 8, end: 10 },
      alternatives: ["have"],
      context: { start: 2, end: 10 },
    },
    {
      ruleId: "demoCheck",
      messageKey: "review_msg_typo",
      range: { start: 28, end: 30 },
      alternatives: ["have"],
      context: { start: 22, end: 30 },
    },
  ]);
  // The chunk owns the findings whose range starts in [from, to).
  expect(detect(context(text, { from: 11 })).map((f) => f.range.start)).toEqual([28]);
  expect(detect(context(text, { dictionary: new Set(["of"]) }))).toEqual([]);
  expect(detect(context(text, { rules: new Set(["other"]) }))).toEqual([]);
  // Every pattern detector of a chunk reads one shared scan.
  expect(detect(ctx)).toBe(detect(ctx));
});

test("the live adapter fixes a safe pattern when the word ends", () => {
  const engine = new GrammarRuleEngine();
  const live = SET.livePatterns as PatternSet;
  engine.registerRule(new PatternLiveRule("demoCheck" as GrammarRuleId, new Set([0]), live));
  let state: GrammarContext = { beforeCursor: "", afterCursor: "", hints: { lang: "en_US" } };
  for (const char of "I could of gone, Could of.") {
    state.beforeCursor += char;
    for (const edit of engine.process(char === " " ? "wordBoundary" : "insertChar", state))
      state = applyGrammarEditToContext(state, edit);
  }
  expect(state.beforeCursor).toBe("I could have gone, Could have.");
  // A user-dictionary word stays as typed.
  state = { beforeCursor: "could of ", afterCursor: "", hints: { userDictionary: ["of"] } };
  expect(engine.process("wordBoundary", state)).toEqual([]);
});

test("a new rule needs only YAML: appended to en.yaml it compiles and matches", () => {
  const dir = new URL("../../src/core/domain/grammar/rules/", import.meta.url);
  const yaml = `
  - id: en.irregardless
    checks: [englishPhraseCorrections]
    pattern: [{ lower: irregardless }]
    replacements: [regardless]
    message: review_msg_typo
`;
  const files = RULE_FILES.map((name) => {
    let text = readFileSync(new URL(`${name}.yaml`, dir), "utf8");
    if (name === "en") text = text.replace(/^rules:\n/m, `rules:${yaml}`);
    return [name, Bun.YAML.parse(text) as RuleFile] as const;
  });
  const set = compileRuleFiles(files);
  expect(set.rules.some((rule) => rule.id === "en.irregardless")).toBe(true);
  expect(fixes("Irregardless, we go.", "en_US", set.reviewPatterns as PatternSet)).toContain(
    "Irregardless -> Regardless",
  );
});
