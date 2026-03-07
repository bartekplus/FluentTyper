import { describe, expect, test } from "bun:test";
import { TextTargetAdapter } from "../src/adapters/chrome/content-script/suggestions/TextTargetAdapter";

describe("TextTargetAdapter", () => {
  describe("isInput", () => {
    test("returns true for input elements", () => {
      expect(TextTargetAdapter.isInput(document.createElement("input"))).toBe(true);
    });

    test("returns false for textarea", () => {
      expect(TextTargetAdapter.isInput(document.createElement("textarea"))).toBe(false);
    });

    test("returns false for non-form elements", () => {
      expect(TextTargetAdapter.isInput(document.createElement("div"))).toBe(false);
      expect(TextTargetAdapter.isInput(document.createElement("span"))).toBe(false);
    });
  });

  describe("isTextArea", () => {
    test("returns true for textarea elements", () => {
      expect(TextTargetAdapter.isTextArea(document.createElement("textarea"))).toBe(true);
    });

    test("returns false for input", () => {
      expect(TextTargetAdapter.isTextArea(document.createElement("input"))).toBe(false);
    });

    test("returns false for non-form elements", () => {
      expect(TextTargetAdapter.isTextArea(document.createElement("div"))).toBe(false);
    });
  });

  describe("isTextValue", () => {
    test("returns true for input elements", () => {
      expect(TextTargetAdapter.isTextValue(document.createElement("input"))).toBe(true);
    });

    test("returns true for textarea elements", () => {
      expect(TextTargetAdapter.isTextValue(document.createElement("textarea"))).toBe(true);
    });

    test("returns false for contenteditable and other elements", () => {
      expect(TextTargetAdapter.isTextValue(document.createElement("div"))).toBe(false);
      expect(TextTargetAdapter.isTextValue(document.createElement("span"))).toBe(false);
      expect(TextTargetAdapter.isTextValue(document.createElement("p"))).toBe(false);
    });
  });

  describe("snapshot", () => {
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

    test("captures before/after cursor for textarea", () => {
      const textarea = document.createElement("textarea");
      textarea.value = "hello world";
      textarea.selectionStart = 5;
      textarea.selectionEnd = 5;

      const snapshot = TextTargetAdapter.snapshot(textarea);
      expect(snapshot.beforeCursor).toBe("hello");
      expect(snapshot.afterCursor).toBe(" world");
      expect(snapshot.cursorOffset).toBe(5);
    });

    test("uses end of value when selectionStart is null", () => {
      const input = document.createElement("input");
      input.value = "hello";
      Object.defineProperty(input, "selectionStart", { value: null, configurable: true });

      const snapshot = TextTargetAdapter.snapshot(input);
      expect(snapshot.beforeCursor).toBe("hello");
      expect(snapshot.afterCursor).toBe("");
      expect(snapshot.cursorOffset).toBe(5);
    });

    test("handles cursor at start of input", () => {
      const input = document.createElement("input");
      input.value = "hello";
      input.selectionStart = 0;
      input.selectionEnd = 0;

      const snapshot = TextTargetAdapter.snapshot(input);
      expect(snapshot.beforeCursor).toBe("");
      expect(snapshot.afterCursor).toBe("hello");
      expect(snapshot.cursorOffset).toBe(0);
    });
  });

  describe("hasCollapsedSelection", () => {
    test("returns true when selection is collapsed in input", () => {
      const input = document.createElement("input");
      input.value = "hello";
      input.selectionStart = 3;
      input.selectionEnd = 3;
      expect(TextTargetAdapter.hasCollapsedSelection(input)).toBe(true);
    });

    test("returns false when selection is expanded in input", () => {
      const input = document.createElement("input");
      input.value = "hello";
      input.selectionStart = 1;
      input.selectionEnd = 3;
      expect(TextTargetAdapter.hasCollapsedSelection(input)).toBe(false);
    });

    test("returns true when selectionStart is null", () => {
      const input = document.createElement("input");
      input.value = "hello";
      Object.defineProperty(input, "selectionStart", { value: null, configurable: true });
      Object.defineProperty(input, "selectionEnd", { value: null, configurable: true });
      expect(TextTargetAdapter.hasCollapsedSelection(input)).toBe(true);
    });

    test("returns true for collapsed selection in textarea", () => {
      const textarea = document.createElement("textarea");
      textarea.value = "hello world";
      textarea.selectionStart = 5;
      textarea.selectionEnd = 5;
      expect(TextTargetAdapter.hasCollapsedSelection(textarea)).toBe(true);
    });

    test("returns false for expanded selection in textarea", () => {
      const textarea = document.createElement("textarea");
      textarea.value = "hello world";
      textarea.selectionStart = 0;
      textarea.selectionEnd = 5;
      expect(TextTargetAdapter.hasCollapsedSelection(textarea)).toBe(false);
    });
  });
});
