import { expect, test, describe, beforeEach } from "bun:test";
import { GrammarRuleEngine } from "../../src/core/domain/grammar/GrammarRuleEngine";
import type { GrammarRule } from "../../src/core/domain/grammar/types";
import { CommaPeriodSpacingRule } from "../../src/core/domain/grammar/implementations/CommaPeriodSpacingRule";
import { DuplicatePunctuationCollapseRule } from "../../src/core/domain/grammar/implementations/DuplicatePunctuationCollapseRule";
import { ZERO_WIDTH_FILLER_CHARS } from "../../src/core/domain/spacingRules";

describe("GrammarRuleEngine", () => {
  let engine: GrammarRuleEngine;

  beforeEach(() => {
    engine = new GrammarRuleEngine();
  });

  test("pipeline ordering triggers rules in sequence of registration", () => {
    const applyOrder: string[] = [];

    const rule1: GrammarRule = {
      id: "rule1",
      name: "Rule 1",
      triggers: ["insertChar"],
      apply: () => {
        applyOrder.push("rule1");
        return null;
      },
    };

    const rule2: GrammarRule = {
      id: "rule2",
      name: "Rule 2",
      triggers: ["insertChar"],
      apply: () => {
        applyOrder.push("rule2");
        return null;
      },
    };

    engine.registerRule(rule1);
    engine.registerRule(rule2);

    engine.process("insertChar", { beforeCursor: "test", afterCursor: "" });

    expect(applyOrder).toEqual(["rule1", "rule2"]);
  });

  test("enabledRules filter prevents disabled rules from running", () => {
    const applyOrder: string[] = [];

    const rule1: GrammarRule = {
      id: "rule1",
      name: "Rule 1",
      triggers: ["insertChar"],
      apply: () => {
        applyOrder.push("rule1");
        return null;
      },
    };

    const rule2: GrammarRule = {
      id: "rule2",
      name: "Rule 2",
      triggers: ["insertChar"],
      apply: () => {
        applyOrder.push("rule2");
        return null;
      },
    };

    engine.registerRule(rule1);
    engine.registerRule(rule2);

    engine.process("insertChar", { beforeCursor: "test", afterCursor: "" }, ["rule2"]);

    expect(applyOrder).toEqual(["rule2"]);
  });

  test("mergeEdits correctness across multiple rule applications", () => {
    const rule1: GrammarRule = {
      id: "rule1",
      name: "Rule 1",
      triggers: ["insertChar"],
      apply: (ctx) => {
        if (ctx.beforeCursor.endsWith("a")) {
          return {
            replacement: "A",
            deleteBackwards: 1,
            deleteForwards: 0,
          };
        }
        return null;
      },
    };

    const rule2: GrammarRule = {
      id: "rule2",
      name: "Rule 2",
      triggers: ["insertChar"],
      apply: (ctx) => {
        if (ctx.afterCursor.startsWith("b")) {
          return {
            replacement: "",
            deleteBackwards: 0,
            deleteForwards: 1,
          };
        }
        return null;
      },
    };

    engine.registerRule(rule1);
    engine.registerRule(rule2);

    const result = engine.process("insertChar", {
      beforeCursor: "hello_a",
      afterCursor: "b_world",
    });

    expect(result.length).toBe(1);
    expect(result[0]).toEqual({
      replacement: "A",
      deleteBackwards: 1,
      deleteForwards: 1,
      sourceRuleId: "rule2",
      description: "Merged edits",
    });
  });

  test("re-evaluates rules until steady state", () => {
    let runs = 0;
    const rule1: GrammarRule = {
      id: "incrementRule",
      name: "Increment Rule",
      triggers: ["insertChar"],
      apply: (ctx) => {
        runs++;
        if (ctx.beforeCursor === "1") {
          return {
            replacement: "2",
            deleteBackwards: 1,
            deleteForwards: 0,
          };
        }
        if (ctx.beforeCursor === "2") {
          return {
            replacement: "3",
            deleteBackwards: 1,
            deleteForwards: 0,
          };
        }
        return null;
      },
    };

    engine.registerRule(rule1);
    const result = engine.process("insertChar", { beforeCursor: "1", afterCursor: "" });

    expect(runs).toBeGreaterThanOrEqual(2);
    expect(result[0].replacement).toBe("3");
    expect(result[0].deleteBackwards).toBe(1);
    expect(result[0].deleteForwards).toBe(0);
  });

  test("processSequence applies trigger outputs in order using shared merge semantics", () => {
    const insertRule: GrammarRule = {
      id: "rule1",
      name: "Insert Rule",
      triggers: ["insertChar"],
      apply: (ctx) => {
        if (ctx.beforeCursor.endsWith("a")) {
          return {
            replacement: "A",
            deleteBackwards: 1,
            deleteForwards: 0,
          };
        }
        return null;
      },
    };

    const boundaryRule: GrammarRule = {
      id: "rule2",
      name: "Boundary Rule",
      triggers: ["wordBoundary"],
      apply: (ctx) => {
        if (ctx.afterCursor.startsWith("b")) {
          return {
            replacement: "",
            deleteBackwards: 0,
            deleteForwards: 1,
          };
        }
        return null;
      },
    };

    engine.registerRule(insertRule);
    engine.registerRule(boundaryRule);

    const result = engine.processSequence(
      ["insertChar", "wordBoundary"],
      {
        beforeCursor: "hello_a",
        afterCursor: "b_world",
      },
      ["rule1", "rule2"],
    );

    expect(result).toEqual({
      replacement: "A",
      deleteBackwards: 1,
      deleteForwards: 1,
      sourceRuleId: "rule2",
      description: "Merged edits",
    });
  });

  test("mergeEdits preserves deleteForwards for local apply paths", () => {
    let invoked = false;
    const rule: GrammarRule = {
      id: "forwardDeleteRule",
      name: "Forward Delete Rule",
      triggers: ["insertChar"],
      apply: () => {
        if (invoked) {
          return null;
        }
        invoked = true;
        return {
          replacement: "X",
          deleteBackwards: 0,
          deleteForwards: 3,
        };
      },
    };

    engine.registerRule(rule);

    const result = engine.process("insertChar", {
      beforeCursor: "hello",
      afterCursor: "world",
    });

    expect(result.length).toBe(1);
    expect(result[0].deleteForwards).toBe(3);
    expect(result[0].deleteBackwards).toBe(0);
    expect(result[0].replacement).toBe("X");
  });

  test("collapses long comma run after typing comma at trailing-space boundary", () => {
    engine.registerRule(new CommaPeriodSpacingRule(true));
    engine.registerRule(new DuplicatePunctuationCollapseRule());

    const result = engine.process("insertChar", {
      beforeCursor: "This is,,,,,,,,,,,, ,",
      afterCursor: "",
      hints: { inputAction: "insert" },
    });

    expect(result).toEqual([
      {
        replacement: ", ",
        deleteBackwards: 14,
        deleteForwards: 0,
        confidence: "medium",
        sourceRuleId: "duplicatePunctuationCollapse",
        safetyTier: "advanced",
        description: "Merged edits",
      },
    ]);
  });

  test("collapses rapid comma burst and removes preceding space before comma", () => {
    engine.registerRule(new CommaPeriodSpacingRule(true));
    engine.registerRule(new DuplicatePunctuationCollapseRule());

    const result = engine.process("wordBoundary", {
      beforeCursor: "What the fewer ,,,,,,,,,, ",
      afterCursor: "",
      hints: { inputAction: "insert" },
    });

    expect(result).toEqual([
      {
        replacement: ", ",
        deleteBackwards: 12,
        deleteForwards: 0,
        confidence: "medium",
        sourceRuleId: "duplicatePunctuationCollapse",
        safetyTier: "advanced",
        description: "Merged edits",
      },
    ]);
  });

  test("does not emit comma spacing edit for repeated comma bursts", () => {
    engine.registerRule(new CommaPeriodSpacingRule(true));

    const result = engine.process("insertChar", {
      beforeCursor: "What the fewer ,,,,,,,,,,",
      afterCursor: "",
      hints: { inputAction: "insert" },
    });

    expect(result).toEqual([]);
  });

  test("zero-width filler-separated comma bursts are owned by duplicate collapse", () => {
    engine.registerRule(new CommaPeriodSpacingRule(true));
    engine.registerRule(new DuplicatePunctuationCollapseRule());

    for (const filler of ZERO_WIDTH_FILLER_CHARS) {
      const result = engine.process("insertChar", {
        beforeCursor: `Hello,,${filler},`,
        afterCursor: "",
        hints: { inputAction: "insert" },
      });

      expect(result).toEqual([
        {
          replacement: `,${filler}`,
          deleteBackwards: 4,
          deleteForwards: 0,
          confidence: "medium",
          sourceRuleId: "duplicatePunctuationCollapse",
          safetyTier: "advanced",
          description: "Merged edits",
        },
      ]);
    }
  });
});
