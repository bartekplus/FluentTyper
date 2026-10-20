import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { compileRuleFiles } from "../../src/core/domain/grammar/engine/compiler";
import { findMatches, type PatternSet } from "../../src/core/domain/grammar/engine/matcher";
import { PatternLiveRule } from "../../src/core/domain/grammar/engine/liveRules";
import { TABLES } from "../../src/core/domain/grammar/engine/review.generated";
import { LANGUAGE_PHRASE_TABLES } from "../../src/core/domain/grammar/review/languagePhraseTables";
import { EXTENSION_PHRASES } from "../../src/core/domain/grammar/review/english";
import { tokenize } from "../../src/core/domain/grammar/engine/tokenizer";
import type { PhraseRow } from "../../src/core/domain/grammar/engine/rows";
import type { RuleSpec } from "../../src/core/domain/grammar/engine/types";
import { GrammarRuleEngine } from "../../src/core/domain/grammar/GrammarRuleEngine";
import { createGrammarRuleCatalogRuntime } from "../../src/core/domain/grammar/ruleFactory";
import type { GrammarRuleId } from "../../src/core/domain/grammar/types";

// Time budgets (thread CPU time). bun run test runs *.timing.test.ts files serially,
// after the parallel run, so the load of other test workers does not inflate the times.
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
const cpuMs = (run: () => void) => {
  const start = process.cpuUsage();
  run();
  const used = process.cpuUsage(start);
  return (used.user + used.system) / 1000;
};
/** The median CPU time of `runs` calls. */
const median = (runs: number, run: () => void) => {
  const times = Array.from({ length: runs }, () => cpuMs(run)).sort((a, b) => a - b);
  return times[runs >> 1];
};

// Every phrase row of every language as a literal token pattern: a rule set of real size.
const rows = [
  ...Object.entries(LANGUAGE_PHRASE_TABLES).flatMap(([lang, kinds]) =>
    Object.values(kinds).flatMap((list: readonly PhraseRow[]) =>
      list.map((row) => [lang, row] as const),
    ),
  ),
  ...[...EXTENSION_PHRASES, ...Object.values(TABLES).flat()].map((row) => ["en", row] as const),
];
const rules: RuleSpec[] = rows.flatMap(([lang, [typed, fix]], i) =>
  [typed].flat().flatMap((form, j) => {
    const tokens = tokenize(form);
    if (tokens.length === 0 || tokens.some((token) => token.type === "protected")) return [];
    return [
      {
        id: `bench.${i}.${j}`,
        checks: ["benchCheck"],
        lang,
        modes: ["live", "review"] as const,
        pattern: tokens.map((token) => ({ lower: token.key })),
        replacements: [[fix].flat()[0]],
        message: "review_msg_typo",
      },
    ];
  }),
);
const SET = compileRuleFiles([
  [
    "common",
    {
      lang: "*",
      checks: [
        {
          ...COPY,
          id: "benchCheck",
          modes: ["live", "review"],
          priority: 1,
          category: "grammar",
          kind: "usage",
          safeToFix: true,
        },
      ],
      rules,
    },
  ],
]);
const REVIEW = SET.reviewPatterns as PatternSet;

const corpus = (name: string) =>
  readFileSync(new URL(`../fixtures/native-review-corpus/${name}`, import.meta.url), "utf8");
const repeat = (text: string) => text.repeat(Math.ceil(3000 / text.length)).slice(0, 3000);
// Multi-paragraph drafts of about 3,000 characters in each Review language.
const DRAFTS: Record<string, string> = {
  en_US: corpus("reference.txt").slice(0, 3000),
  de_DE: corpus("german-clean.txt").slice(0, 3000),
  fr_FR: corpus("french-clean.txt").slice(0, 3000),
  es_ES: corpus("spanish-clean.txt").slice(0, 3000),
  pt_BR: corpus("portuguese-clean.txt").slice(0, 3000),
  pl_PL: corpus("polish-clean.txt").slice(0, 3000),
  ar_SA: corpus("arabic-clean.txt").slice(0, 3000),
  el_GR: repeat("Η ομάδα έστειλε την αναφορά χθες. Θα τη διαβάσουμε αύριο το πρωί.\n\n"),
  sv_SE: repeat("Teamet skickade rapporten i går. Vi läser den i morgon bitti.\n\n"),
  hr_HR: repeat("Tim je jučer poslao izvješće. Pročitat ćemo ga sutra ujutro.\n\n"),
};

test("the rule set has the size of all phrase tables", () => {
  expect(REVIEW.patterns.length).toBeGreaterThan(30_000);
});

test.each(Object.entries(DRAFTS))(
  "a full-draft pattern pass over %s stays under 5 ms",
  (lang, text) => {
    const pass = () => findMatches(REVIEW, tokenize(text), text, lang, () => true);
    for (let warm = 0; warm < 3; warm += 1) pass();
    expect(median(21, pass)).toBeLessThan(5);
  },
);

test("the pass time follows the token count, not the rule count", () => {
  const text = DRAFTS.en_US;
  const few: PatternSet = {
    patterns: REVIEW.patterns,
    anchors: { the: REVIEW.anchors.the ?? [] },
    structural: [],
  };
  const all = median(9, () => findMatches(REVIEW, tokenize(text), text, "en_US", () => true));
  const one = median(9, () => findMatches(few, tokenize(text), text, "en_US", () => true));
  // Over 1,000 times the rules of one word cost less than 100 times its pass: the time
  // follows the tokens and the matches, not the rule count.
  expect(REVIEW.patterns.length / Math.max(1, few.anchors.the.length)).toBeGreaterThan(1_000);
  expect(all).toBeLessThan(Math.max(one, 0.2) * 100);
  const twice = `${text}\n\n${text}`;
  const double = median(9, () => findMatches(REVIEW, tokenize(twice), twice, "en_US", () => true));
  expect(double).toBeLessThan(all * 3 + 0.5);
});

test("a single-sentence live check stays under 0.5 ms", () => {
  const rule = new PatternLiveRule(
    "benchCheck" as GrammarRuleId,
    new Set(SET.live[0].patterns),
    SET.livePatterns as PatternSet,
  );
  const sentence = `${DRAFTS.en_US.slice(0, 160)} `;
  const check = () =>
    rule.apply({ beforeCursor: sentence, afterCursor: "", hints: { lang: "en_US" } });
  check();
  expect(median(21, check)).toBeLessThan(0.5);
});

test("one keystroke through every typing rule stays under 1 ms", () => {
  const engine = new GrammarRuleEngine();
  for (const rule of createGrammarRuleCatalogRuntime({ insertSpaceAfterAutocomplete: true }))
    engine.registerRule(rule);
  const context = {
    beforeCursor: `${DRAFTS.en_US.slice(0, 400)} `,
    afterCursor: "",
    hints: { lang: "en_US", inputAction: "insert" as const, measurementContext: "prose" as const },
  };
  const keystroke = () => engine.process("wordBoundary", context);
  keystroke();
  expect(median(21, keystroke)).toBeLessThan(1);
});
