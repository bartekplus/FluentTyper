import { expect, test } from "bun:test";
import { notAfter, SPACE, WORD_END } from "../../src/core/domain/grammar/review/phraseTemplates";
import {
  compileRuleFiles,
  expandFrame,
  parseRows,
  type ReviewMetadataOut,
} from "../../src/core/domain/grammar/engine/compiler";
import type { CheckSpec, RuleFile, RuleSpec } from "../../src/core/domain/grammar/engine/types";

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
const check = (overrides: Partial<CheckSpec> = {}): CheckSpec => ({
  ...COPY,
  id: "demoCheck",
  modes: ["review"],
  priority: 5,
  category: "grammar",
  kind: "usage",
  ...overrides,
});
const rule = (overrides: Partial<RuleSpec> = {}): RuleSpec => ({
  id: "en.demo",
  checks: ["demoCheck"],
  pattern: [{ lower: "could" }, { lower: "of" }],
  replacements: ["could have"],
  message: "review_msg_typo",
  ...overrides,
});
const compile = (common: RuleFile, en: RuleFile = { lang: "en" }) =>
  compileRuleFiles([
    ["common", common],
    ["en", en],
  ]);
const languagesOf = (metadata: ReviewMetadataOut) =>
  metadata.review === "supported" ? metadata.languages : undefined;
const errorsOf = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return String(error);
  }
  return "";
};

test("a pattern rule compiles with its anchor, language and check", () => {
  const set = compile({ lang: "*", checks: [check()] }, { lang: "en", rules: [rule()] });
  expect(set.reviewPatterns.patterns).toHaveLength(1);
  const [pattern] = set.reviewPatterns.patterns;
  // "could" is longer than "of": the more selective literal anchors the rule.
  expect(pattern).toMatchObject({ anchor: 0, langs: ["en"], check: "demoCheck", target: [1, 2] });
  expect(set.reviewPatterns.anchors).toEqual({ could: [0] });
  expect(set.rules).toEqual([
    { id: "en.demo", checks: ["demoCheck"], lang: "en", pattern: 0, source: "en" },
  ]);
});

test("a rule without a literal is structural; every literal of the anchor indexes it", () => {
  const set = compile(
    { lang: "*", checks: [check()] },
    {
      lang: "en",
      rules: [
        rule({
          id: "en.repeat",
          pattern: [{ type: "word" }, { matchRef: 1 }],
          replacements: ["$1"],
        }),
        rule({ id: "en.either", pattern: [{ lower: ["Alot", "alott"] }] }),
      ],
    },
  );
  expect(set.reviewPatterns.structural).toEqual([0]);
  expect(set.reviewPatterns.anchors).toEqual({ alot: [1], alott: [1] });
});

test("stage orders rules before file order", () => {
  const set = compile(
    {
      lang: "*",
      checks: [check()],
      rules: [{ id: "late", checks: ["demoCheck"], predicate: "late", stage: 1 }],
    },
    { lang: "en", rules: [{ id: "en.early", checks: ["demoCheck"], predicate: "early" }] },
  );
  expect(set.rules.map((r) => [r.id, r.predicate])).toEqual([
    ["en.early", "en:early"],
    ["late", "common:late"],
  ]);
});

test("the catalog keeps file order, defaults and Review metadata", () => {
  const set = compile({
    lang: "*",
    checks: [
      check({
        id: "typed",
        modes: ["live"],
        title: "grammar_rule_typed",
        excluded: "Typing only.",
      }),
      check({ id: "both", modes: ["live", "review"], rollout: "off", safeToFix: true }),
      check({ id: "optional", enabled: false, languages: "named", note: "Optional." }),
    ],
    rules: [
      { id: "typed.live", checks: ["typed"], modes: ["live"], predicate: "TypedRule" },
      { id: "both.live", checks: ["both"], modes: ["live"], predicate: "BothRule" },
    ],
  });
  expect(set.catalog.map((entry) => entry.id)).toEqual(["typed", "both", "optional"]);
  expect(set.catalog[0]).toEqual({
    id: "typed",
    titleI18nKey: "grammar_rule_typed",
    descriptionI18nKey: "grammar_rule_typed_desc",
    languageScope: "all",
    defaultRollout: "on",
    priority: 5,
  });
  expect(set.catalog[2]).toMatchObject({ typing: false, titleI18nKey: "grammar_rule_optional" });
  expect(set.reviewMetadata.typed).toEqual({
    review: "excluded",
    category: "grammar",
    reason: "Typing only.",
  });
  expect(set.reviewMetadata.both).toMatchObject({ bulk: "eligible", defaultEnabled: true });
  expect(set.reviewMetadata.optional).toMatchObject({ defaultEnabled: false, note: "Optional." });
  expect(languagesOf(set.reviewMetadata.optional)).toContain("ar_SA");
  expect(set.live.map((r) => [r.check, r.predicate])).toEqual([
    ["typed", "TypedRule"],
    ["both", "BothRule"],
  ]);
});

test("phrase tables: kinds per language and the languages of a check", () => {
  const set = compileRuleFiles([
    ["common", { lang: "*", checks: [check({ languages: { phraseTables: ["compounds"] } })] }],
    ["hr", { lang: "hr", phrases: { words: "a = b\n", compounds: "c d = cd\n" } }],
    ["de", { lang: "de", phrases: { words: "x = y\n" } }],
  ]);
  expect(set.phraseTableKinds).toEqual({ hr: ["words", "compounds"], de: ["words"] });
  expect(languagesOf(set.reviewMetadata.demoCheck)).toEqual(["en_US", "hr_HR"]);
});

test("phrase rows: variants, choices and comments", () => {
  const errors: string[] = [];
  expect(
    parseRows(
      "# a comment\nalot = a lot\nRythmus | Rhytmus = Rhythmus\nbisherig = bisher; bisherige\n",
      "t",
      errors,
    ),
  ).toEqual([
    ["alot", "a lot"],
    [["Rythmus", "Rhytmus"], "Rhythmus"],
    ["bisherig", ["bisher", "bisherige"]],
  ]);
  expect(errors).toEqual([]);
  parseRows("no separator\n", "t", errors);
  expect(errors).toEqual(['t: row "no separator" has no " = "']);
});

test("invalid rules are reported together", () => {
  const message = errorsOf(() =>
    compile(
      {
        lang: "*",
        checks: [check(), check({ id: "liveCheck", modes: ["live", "review"] })],
      },
      {
        lang: "en",
        rules: [
          rule({ checks: ["missing"] }),
          rule({ id: "en.demo2", replacements: [], message: undefined }),
          rule({ id: "en.demo3", pattern: [{ regex: "(" }, { matchRef: 2 }] }),
          rule({ id: "en.demo4", pattern: [{ predicate: "noSuchPredicate", bogus: 1 } as never] }),
          rule({ id: "en.demo5", checks: ["liveCheck"], modes: ["live"] }),
          rule({ id: "en.demo5", predicate: "x" }),
        ],
      },
    ),
  );
  for (const fragment of [
    'unknown check "missing"',
    'a pattern needs "replacements"',
    'a Review pattern needs "message"',
    "regex does not compile",
    "matchRef must name an earlier element",
    'unknown token predicate "noSuchPredicate"',
    'unknown pattern field "bogus"',
    "a live pattern needs a check with safeToFix",
    "duplicate rule id",
    'give exactly one of "predicate", "pattern" and "frames"',
  ])
    expect(message).toContain(fragment);
  expect(
    errorsOf(() => compile({ lang: "*", checks: [check({ modes: ["live", "review"] })] })),
  ).toContain("live check demoCheck has no live rule");
});

test("a check carries its settings copy and example", () => {
  const set = compile({ lang: "*", checks: [check()] });
  expect(set.text.grammar_rule_demoCheck.pr).toBe("Demo");
  expect(set.text.grammar_rule_demoCheck_desc.en).toBe("Demo.");
  expect(set.examples.demoCheck).toEqual({ text: ["a", "b"], lang: "en_US" });
  const message = errorsOf(() =>
    compile({
      lang: "*",
      checks: [
        check({ text: undefined }),
        check({
          id: "partial",
          text: { title: { en: "Only English" }, description: COPY.text.description },
        }),
        { ...check({ id: "noExample" }), example: undefined as never },
      ],
    }),
  );
  expect(message).toContain('check demoCheck: a Review-only check needs "text"');
  expect(message).toContain(
    "check partial: grammar_rule_partial has no text in fr, hr, es, el, sv, de, pl, pr",
  );
  expect(message).toContain('check noExample: "example" needs lang, before and after');
});

test("frames: fragments, guards, literals and fixes", () => {
  const set = compile(
    { lang: "*", checks: [check()] },
    {
      lang: "en",
      fragments: { OWNER: "my|your", SLOT: "(?:{{OWNER}}){{S}}" },
      rules: [
        {
          id: "en.frames",
          checks: ["demoCheck"],
          message: "review_msg_phrase_correction",
          frames: [
            { regex: "{{notAfter:{{OWNER}}}}(?<target>curse){{S}}through{{E}}", fix: "course" },
            { regex: "{{SLOT}}(?<target>wich){{E}}", fixer: "which", raw: true },
          ],
        },
      ],
    },
  );
  expect(set.rules).toEqual([
    {
      id: "en.frames",
      checks: ["demoCheck"],
      lang: "en",
      frames: [0, 1],
      message: "review_msg_phrase_correction",
      source: "en",
    },
  ]);
  expect(set.frames[0]).toEqual({
    pattern: `${notAfter("my|your")}(?<target>curse)${SPACE}through${WORD_END}`,
    literals: set.frames[0].literals,
    fix: "course",
  });
  expect(set.frames[0].literals.length).toBeGreaterThan(0);
  expect(set.frames[1]).toMatchObject({ fixer: "en:which", raw: true });
  const errors: string[] = [];
  expect(expandFrame("{{NOPE}}x", {}, "t", errors)).toBe("x");
  expect(errors).toEqual(['t: unknown fragment "NOPE"']);
  const message = errorsOf(() =>
    compile(
      { lang: "*", checks: [check()] },
      {
        lang: "en",
        rules: [
          {
            id: "en.bad",
            checks: ["demoCheck"],
            frames: [{ regex: "(wich", fix: "which", fixer: "x" }],
          },
        ],
      },
    ),
  );
  for (const fragment of [
    'a frame rule needs "message"',
    'give exactly one of "fix" and "fixer"',
    "regex does not compile",
    'a frame needs a "target" group',
  ])
    expect(message).toContain(fragment);
});
