import { describe, expect, test } from "bun:test";
import { ContentEditableAdapter } from "../src/adapters/chrome/content-script/suggestions/ContentEditableAdapter";
import { SuggestionTextEditService } from "../src/adapters/chrome/content-script/suggestions/SuggestionTextEditService";
import { createSuggestionEntry } from "./suggestionTestUtils";

function findMentionToken(beforeCursor: string): { token: string; start: number } {
  const parts = beforeCursor.split(/\s+/);
  const token = parts.at(-1) ?? "";
  const start = beforeCursor.length - token.length;
  return { token, start: Math.max(0, start) };
}

function setContentEditableCursor(target: HTMLElement, offset: number): void {
  const showText =
    (globalThis as { NodeFilter?: { SHOW_TEXT?: number } }).NodeFilter?.SHOW_TEXT ?? 4;
  const walker = document.createTreeWalker(target, showText);
  let current = walker.nextNode() as Text | null;
  if (!current) {
    current = target.appendChild(document.createTextNode(""));
  }

  let remaining = Math.max(0, offset);
  let node: Text = current;
  let nodeOffset = 0;

  while (current) {
    const length = current.textContent?.length ?? 0;
    if (remaining <= length) {
      node = current;
      nodeOffset = remaining;
      break;
    }
    remaining -= length;
    node = current;
    nodeOffset = length;
    current = walker.nextNode() as Text | null;
  }

  const range = document.createRange();
  range.setStart(node, nodeOffset);
  range.collapse(true);

  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

class HostHandledContentEditableAdapter extends ContentEditableAdapter {
  public override getBlockContext(
    elem: HTMLElement,
  ): { beforeCursor: string; afterCursor: string } | null {
    const fullText = elem.textContent ?? "";
    return {
      beforeCursor: fullText,
      afterCursor: "",
    };
  }

  public override replaceTextByOffsets(
    elem: HTMLElement,
    replaceStart: number,
    replaceEnd: number,
    replacementText: string,
    cursorAfter: number,
  ) {
    void elem;
    void replaceStart;
    void replaceEnd;
    void replacementText;
    void cursorAfter;
    return {
      appliedBy: "host-beforeinput" as const,
      didMutateDom: true,
      didDispatchInput: false,
    };
  }
}

class EmptyBlockContextContentEditableAdapter extends ContentEditableAdapter {
  public override getBlockContext(
    elem: HTMLElement,
  ): { beforeCursor: string; afterCursor: string } | null {
    void elem;
    return {
      beforeCursor: "",
      afterCursor: "",
    };
  }

  public override replaceTextByOffsets(
    elem: HTMLElement,
    replaceStart: number,
    replaceEnd: number,
    replacementText: string,
    cursorAfter: number,
  ) {
    const text = elem.textContent ?? "";
    elem.textContent = `${text.slice(0, replaceStart)}${replacementText}${text.slice(replaceEnd)}`;
    setContentEditableCursor(elem, cursorAfter);
    return {
      appliedBy: "fallback-dom" as const,
      didMutateDom: true,
      didDispatchInput: true,
    };
  }
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

  test("dispatches one input event for input/textarea replacement paths", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
    });

    const input = document.createElement("input");
    input.value = "teh ";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    const entry = createSuggestionEntry({ elem: input });

    let inputEventCount = 0;
    input.addEventListener("input", () => {
      inputEventCount += 1;
    });

    service.applyTextEdit(entry, {
      replacementText: "the ",
      replaceBackwardCount: 4,
      evaluatedTextLength: 4,
      expectedReplacedText: "teh ",
    });

    expect(input.value).toBe("the ");
    expect(inputEventCount).toBe(1);
  });

  test("does not dispatch duplicate input event when contenteditable edit is host-owned", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
      contentEditableAdapter: new HostHandledContentEditableAdapter(),
    });

    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.textContent = "teh ";
    document.body.appendChild(editable);
    const entry = createSuggestionEntry({ elem: editable });

    let inputEventCount = 0;
    editable.addEventListener("input", () => {
      inputEventCount += 1;
    });

    service.applyTextEdit(entry, {
      replacementText: "the ",
      replaceBackwardCount: 4,
      evaluatedTextLength: 4,
      expectedReplacedText: "teh ",
    });

    expect(inputEventCount).toBe(0);
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

  test("uses fresh mention metadata for contenteditable acceptance when block context is empty", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
      contentEditableAdapter: new EmptyBlockContextContentEditableAdapter(),
    });

    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.textContent = "first second";
    document.body.appendChild(editable);
    setContentEditableCursor(editable, "first second".length);

    const entry = createSuggestionEntry({
      elem: editable,
      latestMentionText: "second",
      latestMentionStart: 6,
    });

    const accepted = service.acceptSuggestion(entry, "SECOND");

    expect(accepted).toEqual({
      triggerText: "second",
      insertedText: "SECOND",
    });
    expect(editable.textContent).toBe("first SECOND");
  });

  test("skips ambiguous contenteditable acceptance instead of applying stale off-caret range", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
      contentEditableAdapter: new EmptyBlockContextContentEditableAdapter(),
    });

    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.textContent = "first second third";
    document.body.appendChild(editable);
    setContentEditableCursor(editable, "first second ".length);

    const entry = createSuggestionEntry({
      elem: editable,
      latestMentionText: "first",
      latestMentionStart: 0,
    });

    const accepted = service.acceptSuggestion(entry, "FIRST");

    expect(accepted).toBeNull();
    expect(editable.textContent).toBe("first second third");
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

  test("deletes punctuation space when after-cursor contains only word-joiner filler", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
    });

    const input = document.createElement("input");
    input.value = "Hello. \u2060";
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
    expect(input.value).toBe("Hello.\u2060");
  });

  test("deletes punctuation space when word-joiner filler is before the caret", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
    });

    const input = document.createElement("input");
    input.value = "Hello. \u2060";
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
    expect(input.value).toBe("Hello.\u2060");
  });

  test("reverts latest grammar auto-fix on Backspace when caret is unchanged", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
    });

    const input = document.createElement("input");
    input.value = "teh ";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    const entry = createSuggestionEntry({ elem: input });

    service.applyTextEdit(entry, {
      replacementText: "the ",
      replaceBackwardCount: 4,
      evaluatedTextLength: 4,
      expectedReplacedText: "teh ",
    });
    expect(input.value).toBe("the ");

    const keyboardEvent = new Event("keydown", {
      bubbles: true,
      cancelable: true,
    }) as KeyboardEvent;
    Object.defineProperty(keyboardEvent, "key", { value: "Backspace" });
    const consumeKeyboardEvent = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };

    const handled = service.tryRevertLastAutoFix(entry, keyboardEvent, {
      consumeKeyboardEvent,
      clearSuggestions: () => undefined,
    });

    expect(handled).toBe(true);
    expect(input.value).toBe("teh ");
    expect(input.selectionStart).toBe(4);
    expect(entry.lastAutoFixReplacement).toBeNull();
  });

  test("does not revert grammar auto-fix after user modifies text", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
    });

    const input = document.createElement("input");
    input.value = "teh ";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    const entry = createSuggestionEntry({ elem: input });

    service.applyTextEdit(entry, {
      replacementText: "the ",
      replaceBackwardCount: 4,
      evaluatedTextLength: 4,
      expectedReplacedText: "teh ",
    });

    input.value = "the x";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;

    const keyboardEvent = new Event("keydown", {
      bubbles: true,
      cancelable: true,
    }) as KeyboardEvent;
    Object.defineProperty(keyboardEvent, "key", { value: "Backspace" });

    const firstHandled = service.tryRevertLastAutoFix(entry, keyboardEvent, {
      consumeKeyboardEvent: () => undefined,
      clearSuggestions: () => undefined,
    });

    expect(firstHandled).toBe(false);
    expect(input.value).toBe("the x");
    expect(entry.lastAutoFixReplacement).toBeNull();

    // After the normal delete, a second Backspace must not resurrect the original typo.
    input.value = "the ";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    const secondBackspace = new Event("keydown", {
      bubbles: true,
      cancelable: true,
    }) as KeyboardEvent;
    Object.defineProperty(secondBackspace, "key", { value: "Backspace" });
    const secondHandled = service.tryRevertLastAutoFix(entry, secondBackspace, {
      consumeKeyboardEvent: () => undefined,
      clearSuggestions: () => undefined,
    });
    expect(secondHandled).toBe(false);
    expect(input.value).toBe("the ");
  });

  test("clears auto-fix snapshot when caret no longer matches post-fix cursor", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
    });

    const input = document.createElement("input");
    input.value = "teh ";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    const entry = createSuggestionEntry({ elem: input });

    service.applyTextEdit(entry, {
      replacementText: "the ",
      replaceBackwardCount: 4,
      evaluatedTextLength: 4,
      expectedReplacedText: "teh ",
    });

    // User moved caret before pressing Backspace; snapshot must be invalidated.
    input.selectionStart = input.value.length - 1;
    input.selectionEnd = input.value.length - 1;

    const keyboardEvent = new Event("keydown", {
      bubbles: true,
      cancelable: true,
    }) as KeyboardEvent;
    Object.defineProperty(keyboardEvent, "key", { value: "Backspace" });

    const handled = service.tryRevertLastAutoFix(entry, keyboardEvent, {
      consumeKeyboardEvent: () => undefined,
      clearSuggestions: () => undefined,
    });

    expect(handled).toBe(false);
    expect(entry.lastAutoFixReplacement).toBeNull();
    expect(input.value).toBe("the ");
  });

  test("clears auto-fix snapshot when edited text can no longer contain replacement span", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
    });

    const input = document.createElement("input");
    input.value = "teh ";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    const entry = createSuggestionEntry({ elem: input });

    service.applyTextEdit(entry, {
      replacementText: "the ",
      replaceBackwardCount: 4,
      evaluatedTextLength: 4,
      expectedReplacedText: "teh ",
    });

    // User deleted content; stored replacement span is no longer valid.
    input.value = "t";
    input.selectionStart = 1;
    input.selectionEnd = 1;

    const keyboardEvent = new Event("keydown", {
      bubbles: true,
      cancelable: true,
    }) as KeyboardEvent;
    Object.defineProperty(keyboardEvent, "key", { value: "Backspace" });

    const handled = service.tryRevertLastAutoFix(entry, keyboardEvent, {
      consumeKeyboardEvent: () => undefined,
      clearSuggestions: () => undefined,
    });

    expect(handled).toBe(false);
    expect(entry.lastAutoFixReplacement).toBeNull();
    expect(input.value).toBe("t");
  });
});
