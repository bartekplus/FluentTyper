import { describe, expect, test } from "bun:test";
import { TextTargetAdapter } from "../src/adapters/chrome/content-script/suggestions/TextTargetAdapter";

describe("TextTargetAdapter", () => {
  test("captures before/after cursor for text inputs", () => {
    const input = document.createElement("input");
    input.value = "hello world";
    input.selectionStart = 5;
    input.selectionEnd = 5;

    const snapshot = TextTargetAdapter.snapshot(input);
    expect(snapshot.beforeCursor).toBe("hello");
    expect(snapshot.afterCursor).toBe(" world");
    expect(snapshot.cursorOffset).toBe(5);
  });
});
