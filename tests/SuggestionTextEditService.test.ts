import { describe, expect, test } from "bun:test";
import { SuggestionTextEditService } from "../src/adapters/chrome/content-script/suggestions/SuggestionTextEditService";
import { createSuggestionEntry } from "./suggestionTestUtils";

function findMentionToken(beforeCursor: string): { token: string; start: number } {
  const parts = beforeCursor.split(/\s+/);
  const token = parts.at(-1) ?? "";
  const start = beforeCursor.length - token.length;
  return { token, start: Math.max(0, start) };
}

describe("SuggestionTextEditService", () => {
  test("accepts suggestion and replaces current token in input", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
    });

    const input = document.createElement("input");
    input.value = "fun";
    input.selectionStart = 3;
    input.selectionEnd = 3;
    const entry = createSuggestionEntry({
      elem: input,
      latestMentionText: "fun",
      latestMentionStart: 0,
    });

    const accepted = service.acceptSuggestion(entry, "function");

    expect(accepted).toEqual({ triggerText: "fun", insertedText: "function" });
    expect(input.value).toBe("function");
  });

  test("avoids introducing double space when accepted suggestion ends with space", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
    });

    const input = document.createElement("input");
    input.value = "fun next";
    input.selectionStart = 3;
    input.selectionEnd = 3;
    const entry = createSuggestionEntry({
      elem: input,
      latestMentionText: "fun",
      latestMentionStart: 0,
    });

    service.acceptSuggestion(entry, "function ");

    expect(input.value).toBe("function next");
  });

  test("deletes trailing punctuation space on Backspace when caret is at end", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
    });

    const input = document.createElement("input");
    input.value = "Hello. ";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    const entry = createSuggestionEntry({ elem: input });

    const keyboardEvent = new Event("keydown", {
      bubbles: true,
      cancelable: true,
    }) as KeyboardEvent;
    Object.defineProperty(keyboardEvent, "key", { value: "Backspace" });
    const consumeKeyboardEvent = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };

    const handled = service.tryDeleteTrailingPunctuationSpace(
      entry,
      keyboardEvent,
      consumeKeyboardEvent,
    );

    expect(handled).toBe(true);
    expect(input.value).toBe("Hello.");
  });

  test("does not delete trailing space when preceding character is not punctuation", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
    });

    const input = document.createElement("input");
    input.value = "Hello ";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    const entry = createSuggestionEntry({ elem: input });

    const keyboardEvent = new Event("keydown", {
      bubbles: true,
      cancelable: true,
    }) as KeyboardEvent;
    Object.defineProperty(keyboardEvent, "key", { value: "Backspace" });

    const handled = service.tryDeleteTrailingPunctuationSpace(
      entry,
      keyboardEvent,
      () => undefined,
    );

    expect(handled).toBe(false);
    expect(input.value).toBe("Hello ");
  });

  test("deletes punctuation space when after-cursor contains only zero-width filler", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
    });

    const input = document.createElement("input");
    input.value = "Hello. \u200B";
    input.selectionStart = "Hello. ".length;
    input.selectionEnd = "Hello. ".length;
    const entry = createSuggestionEntry({ elem: input });

    const keyboardEvent = new Event("keydown", {
      bubbles: true,
      cancelable: true,
    }) as KeyboardEvent;
    Object.defineProperty(keyboardEvent, "key", { value: "Backspace" });

    const handled = service.tryDeleteTrailingPunctuationSpace(
      entry,
      keyboardEvent,
      () => undefined,
    );

    expect(handled).toBe(true);
    expect(input.value).toBe("Hello.\u200B");
  });

  test("deletes punctuation space when zero-width filler is before the caret", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
    });

    const input = document.createElement("input");
    input.value = "Hello. \u200B";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    const entry = createSuggestionEntry({ elem: input });

    const keyboardEvent = new Event("keydown", {
      bubbles: true,
      cancelable: true,
    }) as KeyboardEvent;
    Object.defineProperty(keyboardEvent, "key", { value: "Backspace" });

    const handled = service.tryDeleteTrailingPunctuationSpace(
      entry,
      keyboardEvent,
      () => undefined,
    );

    expect(handled).toBe(true);
    expect(input.value).toBe("Hello.\u200B");
  });
});
