import { describe, expect, test } from "bun:test";
import { GRAMMAR_RULE_CATALOG } from "../src/core/domain/grammar/ruleCatalog";
import { REVIEW_RULE_METADATA } from "../src/core/domain/grammar/review/reviewCatalog";
import { applyEdits } from "../src/core/domain/grammar/review/textRanges";
import { GRAMMAR_RULE_EXAMPLES, REVIEW_RULE_TEXT } from "../src/ui/options/grammarRuleCopy";
import { review, typeText } from "./grammar/grammarTestUtils";

const UI_LANGUAGES = ["en", "fr", "hr", "es", "el", "sv", "de", "pl", "pr"];
const TEXT: Record<string, Record<string, string>> = REVIEW_RULE_TEXT;

describe("settings copy for each grammar rule", () => {
  test.each(GRAMMAR_RULE_CATALOG.filter((rule) => rule.typing === false).map((rule) => rule.id))(
    "%s has a title and a description in every UI language",
    (id) => {
      for (const key of [`grammar_rule_${id}`, `grammar_rule_${id}_desc`])
        for (const lang of UI_LANGUAGES) expect(TEXT[key]?.[lang]?.trim()).toBeTruthy();
      expect(TEXT[`grammar_rule_${id}`].en.length).toBeLessThanOrEqual(45);
    },
  );

  // A typing rule's example is typed key by key; a Review check's example is reviewed by
  // that check alone, and one of its fixes (or all of them together) gives "after".
  test.each(GRAMMAR_RULE_CATALOG.map((rule) => [rule.id, rule.typing !== false] as const))(
    "%s example is what the rule does",
    (id, typing) => {
      const { text, lang } = GRAMMAR_RULE_EXAMPLES[id];
      const [before, after] = text;
      if (typing) {
        const { beforeCursor, afterCursor } = typeText(before, {
          lang,
          hints: { measurementContext: "prose" },
          rules: [id],
          sequence: true,
          boundaries: [" "],
          sentenceEndBoundary: true,
        });
        expect(beforeCursor + afterCursor).toBe(after!);
        return;
      }
      // The user's own terminology decides what this check finds.
      if (id === "preferredTerminology") return;
      const metadata = REVIEW_RULE_METADATA[id];
      expect(metadata.review).toBe("supported");
      const findings = review(before, {}, { lang, enabledRules: [id] }).diagnostics.filter(
        (d) => d.ruleId === id,
      );
      expect(findings.length).toBeGreaterThan(0);
      if (after === null) {
        expect(findings.some((d) => d.warningOnly || d.alternatives.length === 0)).toBe(true);
        return;
      }
      const results = findings.flatMap((d) =>
        d.alternatives.map((a) => applyEdits(before, a.edits)),
      );
      results.push(
        applyEdits(
          before,
          findings.flatMap((d) => d.alternatives[0]?.edits ?? []),
        ),
      );
      expect(results).toContain(after);
    },
  );
});
