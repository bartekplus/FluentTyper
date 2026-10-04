import { describe, expect, test } from "bun:test";
import type { GrammarContext } from "../../src/core/domain/grammar/types";
import { AutoBracketCloseRule } from "../../src/core/domain/grammar/implementations/AutoBracketCloseRule";
import {
  applyGrammarEditToContext,
  mergeSequentialGrammarEdits,
} from "../../src/core/domain/grammar/GrammarEditSequencing";
import { GrammarRuleEngine } from "../../src/core/domain/grammar/GrammarRuleEngine";

function context(beforeCursor: string, afterCursor = ""): GrammarContext {
  return { beforeCursor, afterCursor, hints: { inputAction: "insert" } };
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
      const result = rule.apply(context(`Hello ${openChar}`, " world"));
      expect(result).toEqual({
        replacement,
        deleteBackwards: 1,
        deleteForwards: 0,
        cursorOffset: 1,
      });
    });

    test("auto-closes at start of text", () => {
      const result = rule.apply(context("("));
      expect(result).not.toBeNull();
      expect(result!.replacement).toBe("()");
      expect(result!.cursorOffset).toBe(1);
    });

    test("does not auto-close with empty beforeCursor", () => {
      expect(rule.apply({ beforeCursor: "", afterCursor: ")" })).toBeNull();
    });
  });

  // Auto-close after a space, at the start or before a different character, and skip over a matching close character.
  test.each([
    ["text[", "", "[]"],
    ["hello '", "world", "''"],
    ["'", "world", "''"],
    ["hello <", "world", "<>"],
    ["(", "]rest", "()"],
    ["text}", "}more", "}"],
    ["it's'", "'rest", "'"],
    [' "hello"', '"rest', '"'],
    [" >", ">rest", ">"],
  ])("before %p, after %p gives %p", (before, after, replacement) => {
    expect(rule.apply(context(before, after))?.replacement).toBe(replacement);
  });

  // No auto-close or overtype after a word character, and no overtype without a matching close character.
  test.each([
    ["it'", "s a test"],
    ['word"', " more"],
    ["word`", " more"],
    ["value<", "3"],
    ["value>", ">3"],
    ["text)", "other"],
    ["text)", ""],
  ])("before %p, after %p gives no edit", (before, after) => {
    expect(rule.apply(context(before, after))).toBeNull();
  });

  describe("suppression guards", () => {
    test("a space right after < drops the auto-inserted >: a comparison, not a tag", () => {
      expect(rule.apply(context("3 < ", "> rest"))).toEqual({
        replacement: " ",
        deleteBackwards: 1,
        deleteForwards: 1,
      });
      // Only "<": French spaces the inside of guillemets on purpose.
      expect(rule.apply(context("« ", "»"))).toBeNull();
      expect(rule.apply(context("a <b ", ">"))).toBeNull();
    });

    test("does not auto-close when afterCursor starts with matching close char", () => {
      expect(rule.apply(context("(", ")"))).toBeNull();
      expect(rule.apply(context("[", "]"))).toBeNull();
      expect(rule.apply(context("{", "}"))).toBeNull();
    });
  });

  describe("overtype (skip-over)", () => {
    test("skips over closing paren when it matches afterCursor", () => {
      const result = rule.apply(context("hello())", ")"));
      expect(result).toEqual({
        replacement: ")",
        deleteBackwards: 1,
        deleteForwards: 1,
      });
    });

    test("skips over closing bracket", () => {
      const result = rule.apply(context("text]", "]more"));
      expect(result).not.toBeNull();
      expect(result!.replacement).toBe("]");
      expect(result!.deleteBackwards).toBe(1);
      expect(result!.deleteForwards).toBe(1);
    });

    test("does not overtype symmetric quote after non-word char (prevents oscillation)", () => {
      // After auto-close, engine re-evaluates: beforeCursor='"', afterCursor='"'
      // The char before the quote is a space (or start of string) — NOT a closing quote scenario
      expect(rule.apply(context(' "', '"rest'))).toBeNull();
      expect(rule.apply(context('"', '"rest'))).toBeNull();
      expect(rule.apply(context(" '", "'rest"))).toBeNull();
      expect(rule.apply(context(" `", "`rest"))).toBeNull();
    });
  });

  describe("rule metadata", () => {
    test("has correct id", () => {
      expect(rule.id).toBe("autoBracketClose");
    });

    test("triggers on insertChar and on a typed space", () => {
      expect(rule.triggers).toEqual(["insertChar", "wordBoundary"]);
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

describe("typing through the engine", () => {
  // Mirrors the content script: a space is a wordBoundary, anything else insertChar.
  function type(input: string): string {
    const engine = new GrammarRuleEngine();
    engine.registerRule(new AutoBracketCloseRule());
    let ctx: GrammarContext = {
      beforeCursor: "",
      afterCursor: "",
      hints: { inputAction: "insert" },
    };
    for (const char of input) {
      ctx = { ...ctx, beforeCursor: ctx.beforeCursor + char, charTyped: undefined };
      for (const edit of engine.process(char === " " ? "wordBoundary" : "insertChar", ctx))
        ctx = applyGrammarEditToContext(ctx, edit);
    }
    return ctx.beforeCursor + ctx.afterCursor;
  }

  test.each([
    ["3 < 4", "3 < 4"],
    ["if x < y then", "if x < y then"],
    ["3<4", "3<4"],
    ["see <b", "see <b>"],
    ["<div", "<div>"],
  ])("%s becomes %s", (input, expected) => expect(type(input)).toBe(expected));
});
