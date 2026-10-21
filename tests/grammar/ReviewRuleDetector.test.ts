import { expect, test } from "bun:test";
import { REVIEW_RULES } from "../../src/core/domain/grammar/engine/review.generated";
import { ruleDetector } from "../../src/core/domain/grammar/engine/reviewRules";

// enRuleFindings reads another rule by its id: each Review rule has a detector, also a rule of
// frames and its own code, and a findings rule.
test("each Review rule id gives its detector", () => {
  const missing = REVIEW_RULES.filter((rule) => typeof ruleDetector(rule.id) !== "function");
  expect(missing.map((rule) => rule.id)).toEqual([]);
  expect(REVIEW_RULES.some((rule) => rule.frames !== undefined && rule.predicate)).toBe(true);
  expect(() => ruleDetector("no.such.rule")).toThrow("No Review rule no.such.rule");
});
