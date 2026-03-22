import { describe, expect, test } from "bun:test";
import type { GrammarContext } from "../../src/core/domain/grammar/types";
import { AutoBracketCloseRule } from "../../src/core/domain/grammar/implementations/AutoBracketCloseRule";
import {
  applyGrammarEditToContext,
  mergeSequentialGrammarEdits,
} from "../../src/core/domain/grammar/GrammarEditSequencing";
import { GrammarRuleEngine } from "../../src/core/domain/grammar/GrammarRuleEngine";

function context(
  beforeCursor: string,
  afterCursor = "",
  hints?: GrammarContext["hints"],
): GrammarContext {
  return {
    beforeCursor,
    afterCursor,
    ...(hints ? { hints } : {}),
  };
}

describe("AutoBracketCloseRule", () => {
  const rule = new AutoBracketCloseRule();

  describe("auto-close", () => {
    test.each([
      ["(", "()", ")"],
      ["[", "[]", "]"],
      ["{", "{}", "}"],
      ["'", "''", "'"],
      ['"', '""', '"'],
      ["`", "``", "`"],
      ["<", "<>", ">"],
      ["«", "«»", "»"],
    ])("typing %s auto-closes to %s", (openChar, replacement) => {
      const result = rule.apply(context(`Hello ${openChar}`, " world", { inputAction: "insert" }));
      expect(result).toEqual({
        replacement,
        deleteBackwards: 1,
        deleteForwards: 0,
        cursorOffset: 1,
        confidence: "medium",
        safetyTier: "advanced",
        sourceRuleId: "autoBracketClose",
        description: `Auto-closed ${replacement}`,
      });
    });

    test("auto-closes at start of text", () => {
      const result = rule.apply(context("(", "", { inputAction: "insert" }));
      expect(result).not.toBeNull();
      expect(result!.replacement).toBe("()");
      expect(result!.cursorOffset).toBe(1);
    });

    test("auto-closes with empty afterCursor", () => {
      const result = rule.apply(context("text[", "", { inputAction: "insert" }));
      expect(result).not.toBeNull();
      expect(result!.replacement).toBe("[]");
    });

    test("does not auto-close on delete action", () => {
      expect(rule.apply(context("(", "", { inputAction: "delete" }))).toBeNull();
    });

    test("does not auto-close with empty beforeCursor", () => {
      expect(rule.apply(context("", ")"))).toBeNull();
    });
  });

  describe("suppression guards", () => {
    test("does not auto-close single quote after word character (apostrophe)", () => {
      expect(rule.apply(context("it'", "s a test", { inputAction: "insert" }))).toBeNull();
    });

    test("does not auto-close double quote after word character", () => {
      expect(rule.apply(context('word"', " more", { inputAction: "insert" }))).toBeNull();
    });

    test("does not auto-close backtick after word character", () => {
      expect(rule.apply(context("word`", " more", { inputAction: "insert" }))).toBeNull();
    });

    test("auto-closes single quote after space", () => {
      const result = rule.apply(context("hello '", "world", { inputAction: "insert" }));
      expect(result).not.toBeNull();
      expect(result!.replacement).toBe("''");
    });

    test("auto-closes single quote at start of text", () => {
      const result = rule.apply(context("'", "world", { inputAction: "insert" }));
      expect(result).not.toBeNull();
      expect(result!.replacement).toBe("''");
    });

    test("does not auto-close < after word character", () => {
      expect(rule.apply(context("value<", "3", { inputAction: "insert" }))).toBeNull();
    });

    test("auto-closes < after space", () => {
      const result = rule.apply(context("hello <", "world", { inputAction: "insert" }));
      expect(result).not.toBeNull();
      expect(result!.replacement).toBe("<>");
    });

    test("does not auto-close when afterCursor starts with matching close char", () => {
      expect(rule.apply(context("(", ")", { inputAction: "insert" }))).toBeNull();
      expect(rule.apply(context("[", "]", { inputAction: "insert" }))).toBeNull();
      expect(rule.apply(context("{", "}", { inputAction: "insert" }))).toBeNull();
    });

    test("auto-closes when afterCursor starts with non-matching char", () => {
      const result = rule.apply(context("(", "]rest", { inputAction: "insert" }));
      expect(result).not.toBeNull();
      expect(result!.replacement).toBe("()");
    });
  });

  describe("overtype (skip-over)", () => {
    test("skips over closing paren when it matches afterCursor", () => {
      const result = rule.apply(context("hello())", ")", { inputAction: "insert" }));
      expect(result).toEqual({
        replacement: ")",
        deleteBackwards: 1,
        deleteForwards: 1,
        confidence: "high",
        safetyTier: "advanced",
        sourceRuleId: "autoBracketClose",
        description: "Skipped over auto-inserted )",
      });
    });

    test("skips over closing bracket", () => {
      const result = rule.apply(context("text]", "]more", { inputAction: "insert" }));
      expect(result).not.toBeNull();
      expect(result!.replacement).toBe("]");
      expect(result!.deleteBackwards).toBe(1);
      expect(result!.deleteForwards).toBe(1);
    });

    test("skips over closing brace", () => {
      const result = rule.apply(context("text}", "}more", { inputAction: "insert" }));
      expect(result).not.toBeNull();
      expect(result!.replacement).toBe("}");
    });

    test("skips over closing single quote", () => {
      const result = rule.apply(context("it's'", "'rest", { inputAction: "insert" }));
      expect(result).not.toBeNull();
      expect(result!.replacement).toBe("'");
    });

    test("skips over closing double quote", () => {
      const result = rule.apply(context(' "hello"', '"rest', { inputAction: "insert" }));
      expect(result).not.toBeNull();
      expect(result!.replacement).toBe('"');
    });

    test("skips over closing > after non-word context", () => {
      const result = rule.apply(context(" >", ">rest", { inputAction: "insert" }));
      expect(result).not.toBeNull();
      expect(result!.replacement).toBe(">");
    });

    test("does not overtype > after word character (comparison operator)", () => {
      expect(rule.apply(context("value>", ">3", { inputAction: "insert" }))).toBeNull();
    });

    test("does not overtype symmetric quote after non-word char (prevents oscillation)", () => {
      // After auto-close, engine re-evaluates: beforeCursor='"', afterCursor='"'
      // The char before the quote is a space (or start of string) — NOT a closing quote scenario
      expect(rule.apply(context(' "', '"rest', { inputAction: "insert" }))).toBeNull();
      expect(rule.apply(context('"', '"rest', { inputAction: "insert" }))).toBeNull();
      expect(rule.apply(context(" '", "'rest", { inputAction: "insert" }))).toBeNull();
      expect(rule.apply(context(" `", "`rest", { inputAction: "insert" }))).toBeNull();
    });

    test("does not overtype when afterCursor does not match", () => {
      expect(rule.apply(context("text)", "other", { inputAction: "insert" }))).toBeNull();
    });

    test("does not overtype when afterCursor is empty", () => {
      expect(rule.apply(context("text)", "", { inputAction: "insert" }))).toBeNull();
    });

    test("does not overtype on delete action", () => {
      expect(rule.apply(context("text)", ")", { inputAction: "delete" }))).toBeNull();
    });
  });

  describe("rule metadata", () => {
    test("has correct id", () => {
      expect(rule.id).toBe("autoBracketClose");
    });

    test("triggers on insertChar", () => {
      expect(rule.triggers).toEqual(["insertChar"]);
    });
  });
});

describe("mergeSequentialGrammarEdits with cursorOffset", () => {
  test("preserves cursorOffset from single edit", () => {
    const result = mergeSequentialGrammarEdits([
      {
        replacement: "()",
        deleteBackwards: 1,
        deleteForwards: 0,
        cursorOffset: 1,
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].cursorOffset).toBe(1);
  });

  test("rebases cursorOffset when preceded by another edit", () => {
    const result = mergeSequentialGrammarEdits([
      {
        replacement: " (",
        deleteBackwards: 1,
        deleteForwards: 0,
      },
      {
        replacement: "()",
        deleteBackwards: 1,
        deleteForwards: 0,
        cursorOffset: 1,
      },
    ]);
    expect(result).toHaveLength(1);
    // First edit: accumulatedString = " (" (len 2), keepAccumulated for 2nd = 2 - 1 + 0 = 1
    // So: accumulatedString = " " + "()" = " ()" (len 3)
    // mergedCursorOffset = 1 + 1 = 2
    expect(result[0].replacement).toBe(" ()");
    expect(result[0].cursorOffset).toBe(2);
  });

  test("does not include cursorOffset when no edit sets it", () => {
    const result = mergeSequentialGrammarEdits([
      {
        replacement: "hello",
        deleteBackwards: 3,
        deleteForwards: 0,
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].cursorOffset).toBeUndefined();
  });
});

describe("applyGrammarEditToContext with cursorOffset", () => {
  test("splits replacement at cursorOffset between beforeCursor and afterCursor", () => {
    const result = applyGrammarEditToContext(
      { beforeCursor: "hello(", afterCursor: "world" },
      { replacement: "()", deleteBackwards: 1, deleteForwards: 0, cursorOffset: 1 },
    );
    expect(result.beforeCursor).toBe("hello(");
    expect(result.afterCursor).toBe(")world");
  });

  test("places full replacement in beforeCursor when cursorOffset is absent", () => {
    const result = applyGrammarEditToContext(
      { beforeCursor: "hello(", afterCursor: "world" },
      { replacement: "()", deleteBackwards: 1, deleteForwards: 0 },
    );
    expect(result.beforeCursor).toBe("hello()");
    expect(result.afterCursor).toBe("world");
  });

  test("handles cursorOffset at end of replacement (same as no offset)", () => {
    const result = applyGrammarEditToContext(
      { beforeCursor: "hello(", afterCursor: "world" },
      { replacement: "()", deleteBackwards: 1, deleteForwards: 0, cursorOffset: 2 },
    );
    expect(result.beforeCursor).toBe("hello()");
    expect(result.afterCursor).toBe("world");
  });

  test("handles cursorOffset at start of replacement", () => {
    const result = applyGrammarEditToContext(
      { beforeCursor: "hello(", afterCursor: "world" },
      { replacement: "()", deleteBackwards: 1, deleteForwards: 0, cursorOffset: 0 },
    );
    expect(result.beforeCursor).toBe("hello");
    expect(result.afterCursor).toBe("()world");
  });
});

describe("GrammarRuleEngine integration with AutoBracketCloseRule", () => {
  function makeEngine(): GrammarRuleEngine {
    const engine = new GrammarRuleEngine();
    engine.registerRule(new AutoBracketCloseRule());
    return engine;
  }

  test("auto-closes ( without oscillation", () => {
    const engine = makeEngine();
    const edits = engine.process("insertChar", {
      beforeCursor: "hello (",
      afterCursor: " world",
      hints: { inputAction: "insert" },
    });
    expect(edits).toHaveLength(1);
    expect(edits[0].replacement).toBe("()");
    expect(edits[0].cursorOffset).toBe(1);
    expect(edits[0].deleteBackwards).toBe(1);
  });

  test('auto-closes " without oscillation — must NOT produce """"', () => {
    const engine = makeEngine();
    const edits = engine.process("insertChar", {
      beforeCursor: 'hello "',
      afterCursor: " world",
      hints: { inputAction: "insert" },
    });
    expect(edits).toHaveLength(1);
    expect(edits[0].replacement).toBe('""');
    expect(edits[0].cursorOffset).toBe(1);
    expect(edits[0].deleteBackwards).toBe(1);
  });

  test("auto-closes ' without oscillation", () => {
    const engine = makeEngine();
    const edits = engine.process("insertChar", {
      beforeCursor: "hello '",
      afterCursor: " world",
      hints: { inputAction: "insert" },
    });
    expect(edits).toHaveLength(1);
    expect(edits[0].replacement).toBe("''");
    expect(edits[0].cursorOffset).toBe(1);
  });

  test("auto-closes ` without oscillation", () => {
    const engine = makeEngine();
    const edits = engine.process("insertChar", {
      beforeCursor: "hello `",
      afterCursor: " world",
      hints: { inputAction: "insert" },
    });
    expect(edits).toHaveLength(1);
    expect(edits[0].replacement).toBe("``");
    expect(edits[0].cursorOffset).toBe(1);
  });

  test('overtypes closing " after word character', () => {
    const engine = makeEngine();
    const edits = engine.process("insertChar", {
      beforeCursor: '"hello"',
      afterCursor: '"rest',
      hints: { inputAction: "insert" },
    });
    expect(edits).toHaveLength(1);
    expect(edits[0].replacement).toBe('"');
    expect(edits[0].deleteForwards).toBe(1);
  });
});
