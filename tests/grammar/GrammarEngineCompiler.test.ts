import { expect, test } from "bun:test";
import { notAfter, SPACE, WORD_END } from "../../src/core/domain/grammar/review/phraseTemplates";
import { readFileSync } from "node:fs";
import {
  compileRuleFiles,
  expandFrame,
  parseRows,
  RULE_FILES,
  type ReviewMetadataOut,
} from "../../src/core/domain/grammar/engine/compiler";
import type { RuleFile, RuleSpec } from "../../src/core/domain/grammar/engine/types";
import { demoCheck as check, errorsOf } from "./grammarRuleFixtures";

const rule = (overrides: Partial<RuleSpec> = {}): RuleSpec => ({
  id: "en.demo",
  checks: ["demoCheck"],
  message: "review_msg_typo",
  frames: [{ regex: "could{{S}}(?<target>of){{E}}", fix: "have" }],
  ...overrides,
});
const compile = (common: RuleFile, en: RuleFile = { lang: "en" }) =>
  compileRuleFiles([
    ["common", common],
    ["en", en],
  ]);
const languagesOf = (metadata: ReviewMetadataOut) =>
  metadata.review === "supported" ? metadata.languages : undefined;
test("stage orders rules before file order", () => {
  const set = compile(
    {
      lang: "*",
      checks: [check()],
      rules: [{ id: "late", checks: ["demoCheck"], return: "[]", stage: 1 }],
    },
    { lang: "en", rules: [{ id: "en.early", checks: ["demoCheck"], return: "[]" }] },
  );
  expect(set.rules.map((r) => [r.id, r.predicate])).toEqual([
    ["en.early", "en:@en.early"],
    ["late", "common:@late"],
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
      {
        id: "typed.live",
        checks: ["typed"],
        modes: ["live"],
        triggers: ["insertChar"],
        return: "null",
      },
      {
        id: "both.live",
        checks: ["both"],
        modes: ["live"],
        triggers: ["insertChar"],
        return: "null",
      },
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
    ["typed", "common:@typed.live"],
    ["both", "common:@both.live"],
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
          rule({ id: "en.demo2", message: undefined }),
          rule({ id: "en.demo3", frames: [{ regex: "(?<target>(", fix: "x" }] }),
          // Token patterns are gone: `pattern` is no rule field.
          rule({ id: "en.demo4", pattern: [{ lower: "alot" }] } as never),
          rule({ id: "en.demo5", checks: ["liveCheck"], modes: ["live"], frames: undefined }),
          rule({ id: "en.demo5", frames: undefined, return: "null", modes: ["live"] }),
        ],
      },
    ),
  );
  for (const fragment of [
    'unknown check "missing"',
    'a frame rule needs "message"',
    "regex does not compile",
    'unknown field "pattern"',
    "duplicate rule id",
    'give exactly one of "frames", "findings" and a "return" expression',
    'a typing rule with code needs "triggers"',
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
          text: { title: { en: "Only English" }, description: check().text!.description },
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
            { regex: "{{SLOT}}(?<target>wich){{E}}", return: '"which"', raw: true },
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
  expect(set.frames[1]).toMatchObject({ fixer: "en:@en.frames/2", raw: true });
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
            frames: [{ regex: "(wich", fix: "which", return: '"x"' }],
          },
        ],
      },
    ),
  );
  for (const fragment of [
    'a frame rule needs "message"',
    'give exactly one of "fix" and a "return" expression',
    "regex does not compile",
    'a frame needs a "target" group',
  ])
    expect(message).toContain(fragment);
});

test("match frames: language files read common fragments; their own fragments win", () => {
  const set = compile(
    { lang: "*", checks: [check()], fragments: { YEAR: "[0-9]{4}", WORD: "\\p{L}+" } },
    {
      lang: "en",
      fragments: { WORD: "[a-z]+" },
      rules: [
        {
          id: "en.match",
          checks: ["demoCheck"],
          message: "review_msg_phrase_correction",
          style: "match",
          frames: [
            { regex: "(?<target>{{YEAR}}) {{WORD}}", return: "null" },
            { regex: "{{WORD}}", scan: "owned", flags: "gu", lookahead: 8, return: "null" },
          ],
        },
      ],
    },
  );
  expect(set.frames[0].pattern).toBe("(?<target>[0-9]{4}) [a-z]+");
  // An owned scan needs no target group.
  expect(set.frames[1]).toMatchObject({ pattern: "[a-z]+", scan: "owned", lookahead: 8 });
});

test("rule kinds: findings, groups, frame languages and frames with a predicate", () => {
  const set = compile(
    { lang: "*", checks: [check()] },
    {
      lang: "en",
      rules: [
        { id: "en.found", checks: ["demoCheck"], findings: "style", group: "g" },
        {
          id: "en.both",
          checks: ["demoCheck"],
          group: "g",
          style: "match",
          message: "review_msg_phrase_correction",
          return: "[]",
          frames: [{ regex: "[a-z]+", scan: "owned", flags: "gu", lang: "de", return: "null" }],
        },
      ],
    },
  );
  expect(set.rules[0]).toMatchObject({ id: "en.found", findings: "style", group: "g" });
  expect(set.rules[1]).toMatchObject({ predicate: "en:@en.both", group: "g", frames: [0] });
  expect(set.frames[0]).toMatchObject({ lang: "de", scan: "owned" });
  const message = errorsOf(() =>
    compile(
      { lang: "*", checks: [check()] },
      {
        lang: "en",
        rules: [{ id: "en.bad", checks: ["demoCheck"], findings: "other" as "style" }],
      },
    ),
  );
  expect(message).toContain('unknown findings "other"');
});

test("a new rule needs only YAML: the docs example appended to en.yaml compiles", () => {
  const dir = new URL("../../src/core/domain/grammar/rules/", import.meta.url);
  const yaml = `
  - id: en.couldOf
    checks: [englishModalOfCorrection]
    message: review_msg_contextual_grammar
    frames:
      - regex: "(?:could|should|would){{S}}(?<target>of){{E}}"
        fix: have
`;
  const files = RULE_FILES.map((name) => {
    let text = readFileSync(new URL(`${name}.yaml`, dir), "utf8");
    if (name === "en") text = text.replace(/^rules:\n/m, `rules:${yaml}`);
    return [name, Bun.YAML.parse(text) as RuleFile] as const;
  });
  const set = compileRuleFiles(files);
  const added = set.rules.find((entry) => entry.id === "en.couldOf")!;
  const { pattern, fix } = set.frames[added.frames![0]];
  expect(fix).toBe("have");
  expect(new RegExp(pattern, "iu").exec("You could of told me.")?.groups?.target).toBe("of");
});
