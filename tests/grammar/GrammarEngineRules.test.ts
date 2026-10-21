import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { generateGrammarRuleModules } from "../../scripts/grammarRules";
import { LIVE_RULES } from "../../src/core/domain/grammar/engine/live.generated";
import { LIVE_PREDICATES } from "../../src/core/domain/grammar/engine/liveRules";
import { REVIEW_RULES } from "../../src/core/domain/grammar/engine/review.generated";
import { REVIEW_DETECTORS } from "../../src/core/domain/grammar/review/reviewDetectors";
import { REVIEW_RULE_METADATA } from "../../src/core/domain/grammar/review/reviewCatalog";
import { TYPING_RULE_CATALOG } from "../../src/core/domain/grammar/ruleCatalog";
import { createGrammarRuleCatalogRuntime } from "../../src/core/domain/grammar/ruleFactory";
import { reviewRuleIds } from "../../src/core/domain/grammar/review/reviewCatalog";
import { review } from "./grammarTestUtils";

test("the generated modules are current with grammar/rules/*.yaml", async () => {
  for (const [file, content] of Object.entries(await generateGrammarRuleModules()))
    expect({ file, current: readFileSync(file, "utf8") === content }).toEqual({
      file,
      current: true,
    });
});

test("each typing check has one live rule, in priority order", () => {
  const rules = createGrammarRuleCatalogRuntime({ insertSpaceAfterAutocomplete: true });
  expect(rules.map((rule) => rule.id)).toEqual(
    TYPING_RULE_CATALOG.slice()
      .sort((a, b) => a.priority - b.priority)
      .map((entry) => entry.id),
  );
  // Every named live implementation is in use.
  const named = new Set(LIVE_RULES.flatMap((rule) => rule.predicate ?? []));
  expect(Object.keys(LIVE_PREDICATES).filter((name) => !named.has(name))).toEqual([]);
});

test("the Review detectors are the compiled rules, in order", () => {
  const compiled = REVIEW_DETECTORS.filter((entry) => entry.source !== undefined);
  const shape = (checks: readonly string[], lang?: string, source?: string) =>
    `${checks.join(",")} ${lang ?? "*"} ${source}`;
  // Consecutive rules of one group (same file) are one detector, with the checks of its rules.
  const expected: string[] = [];
  for (let i = 0; i < REVIEW_RULES.length;) {
    const rule = REVIEW_RULES[i];
    let end = i + 1;
    while (
      rule.group !== undefined &&
      end < REVIEW_RULES.length &&
      REVIEW_RULES[end].group === rule.group &&
      REVIEW_RULES[end].source === rule.source
    )
      end++;
    const checks = [...new Set(REVIEW_RULES.slice(i, end).flatMap((part) => part.checks))];
    expected.push(shape(checks, rule.lang, rule.source));
    i = end;
  }
  expect(compiled.map((entry) => shape(entry.rules, entry.lang, entry.source))).toEqual(expected);
  // A language file's rule runs only for its language, unless it names another one.
  for (const entry of compiled)
    if (entry.source !== "common" && entry.source !== "en")
      expect([entry.source, entry.lang]).toEqual([entry.source, entry.source!.slice(0, 2)]);
});

test("a Review check has a rule; an excluded check has none", () => {
  const served = new Set(REVIEW_RULES.flatMap((rule) => rule.checks));
  for (const [id, metadata] of Object.entries(REVIEW_RULE_METADATA))
    expect([id, served.has(id)]).toEqual([id, metadata.review === "supported"]);
});

// The ellipsis rule was a token pattern before it was a frame: the frame keeps its findings.
test.each([
  ["Hold on... I found it.", [7]],
  ["(...)", [1]],
  ["(... args)", [1]],
  ["{...rest}", []],
  ["(...$x)", []],
  ["a...1", []],
  ["1...a", []],
  ["....", []],
  ["x ... y", [2]],
  ["wait\n...next", [5]],
  ["a...b...c", [1, 5]],
  ["see http://example.com/a...b now", []],
  ["code `a...b` here", []],
  ["x/... ok", [2]],
  ["a/b... ok", [3]],
  ["/usr/bin/... ok", []],
  ["~/a/b... ok", []],
  ["/a...b/c", []],
  ["a/b/c d/e... ok", [9]],
  ["/a//b/c... ok", []],
  ["a.../b", []],
  ["a...\\b", []],
  ["foo.bar...baz", []],
  ["مرحبا... كيف", [5]],
] as const)("the ellipsis rule offers … in %p at %p", (text, starts) => {
  const enabledRules = [...reviewRuleIds({ codeMode: false }), "ellipsisShortcut" as const];
  const found = review(text, {}, { enabledRules }).diagnostics.filter(
    (d) => d.ruleId === "ellipsisShortcut",
  );
  expect(
    found.map((d) => [d.range, d.context, d.alternatives.map((a) => a.preview), d.bulk.eligible]),
  ).toEqual(
    starts.map((start) => {
      const range = { start, end: start + 3 };
      return [range, range, ["…"], false];
    }),
  );
});
