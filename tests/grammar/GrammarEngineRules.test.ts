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
  expect(compiled.map((entry) => shape(entry.rules, entry.lang, entry.source))).toEqual(
    REVIEW_RULES.map((rule) => shape(rule.checks, rule.lang, rule.source)),
  );
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
