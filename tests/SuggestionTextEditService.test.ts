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

function setTextNodeCursor(node: Text, offset: number): void {
  const range = document.createRange();
  range.setStart(node, Math.max(0, Math.min(node.textContent?.length ?? 0, offset)));
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

class HostCanceledNoMutationContentEditableAdapter extends ContentEditableAdapter {
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
      didMutateDom: false,
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

  test("treats no-op input textEdit as not applied and does not dispatch input", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
    });

    const input = document.createElement("input");
    input.value = "the ";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    const entry = createSuggestionEntry({ elem: input });

    let inputEventCount = 0;
    input.addEventListener("input", () => {
      inputEventCount += 1;
    });

    const result = service.applyTextEdit(entry, {
      replacementText: "the ",
      replaceBackwardCount: 4,
      evaluatedTextLength: 4,
      expectedReplacedText: "the ",
    });

    expect(result).toEqual({ applied: false, didDispatchInput: false });
    expect(entry.pendingExtensionEdit).toBeNull();
    expect(input.value).toBe("the ");
    expect(inputEventCount).toBe(0);
  });

  test("keeps stale trailing-space guard for non-duplicate rules", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
    });

    const input = document.createElement("input");
    input.value = "Hello.,";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    const entry = createSuggestionEntry({ elem: input });

    const result = service.applyTextEdit(entry, {
      replacementText: ". ",
      replaceBackwardCount: 1,
      evaluatedTextLength: "Hello.".length,
      expectedReplacedText: ".",
      sourceRuleId: "commaPeriodSpacing",
    });

    expect(result).toEqual({ applied: false, didDispatchInput: false });
    expect(input.value).toBe("Hello.,");
  });

  test("allows stale trailing-space edits for duplicate punctuation collapse", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
    });

    const input = document.createElement("input");
    input.value = "Hello,, x";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    const entry = createSuggestionEntry({ elem: input });

    const result = service.applyTextEdit(entry, {
      replacementText: ", ",
      replaceBackwardCount: 3,
      evaluatedTextLength: "Hello,, ".length,
      expectedReplacedText: ",, ",
      sourceRuleId: "duplicatePunctuationCollapse",
    });

    expect(result).toEqual({ applied: true, didDispatchInput: true });
    expect(input.value).toBe("Hello, x");
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

  test("treats host-canceled no-mutation contenteditable textEdit as no-op", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
      contentEditableAdapter: new HostCanceledNoMutationContentEditableAdapter(),
    });

    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.textContent = "teh ";
    document.body.appendChild(editable);
    const entry = createSuggestionEntry({ elem: editable });

    const result = service.applyTextEdit(entry, {
      replacementText: "the ",
      replaceBackwardCount: 4,
      evaluatedTextLength: 4,
      expectedReplacedText: "teh ",
    });

    expect(result).toEqual({ applied: false, didDispatchInput: false });
    expect(entry.pendingExtensionEdit).toBeNull();
    expect(editable.textContent).toBe("teh ");
  });

  test("applies contenteditable textEdit against active block offsets in multi-line content", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
    });

    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.innerHTML = "<p>Title</p><p>fixed .</p>";
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);

    const secondParagraph = editable.querySelectorAll("p")[1];
    if (!secondParagraph) {
      throw new Error("Expected second paragraph");
    }
    const secondTextNode = secondParagraph.firstChild as Text | null;
    if (!secondTextNode) {
      throw new Error("Expected second paragraph text node");
    }
    setTextNodeCursor(secondTextNode, secondTextNode.textContent?.length ?? 0);

    const entry = createSuggestionEntry({ elem: editable });
    service.applyTextEdit(entry, {
      replacementText: ". ",
      replaceBackwardCount: 2,
      evaluatedTextLength: 7,
      expectedReplacedText: " .",
      expectedPrefixToken: "fixed",
    });

    const paragraphs = editable.querySelectorAll("p");
    expect(paragraphs[0]?.textContent).toBe("Title");
    expect((paragraphs[1]?.textContent ?? "").replace(/\u00a0/g, " ")).toBe("fixed. ");
  });

  test("treats NBSP and regular space as equivalent for duplicate punctuation replaced text", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
    });

    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.textContent = "This is awseome,,\u00A0";
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);
    setContentEditableCursor(editable, (editable.textContent ?? "").length);

    const entry = createSuggestionEntry({ elem: editable });
    const result = service.applyTextEdit(entry, {
      replacementText: ", ",
      replaceBackwardCount: 3,
      evaluatedTextLength: "This is awseome,, ".length,
      expectedReplacedText: ",, ",
      sourceRuleId: "duplicatePunctuationCollapse",
    });

    expect(result).toEqual({ applied: true, didDispatchInput: true });
    expect((editable.textContent ?? "").replace(/\u00a0/g, " ")).toBe("This is awseome, ");
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

  test("undoes latest accepted suggestion when caret and text are unchanged", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
    });

    const input = document.createElement("input");
    input.value = "h";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    const entry = createSuggestionEntry({
      elem: input,
      latestMentionText: "h",
      latestMentionStart: 0,
    });

    service.acceptSuggestion(entry, "hi ");
    expect(input.value).toBe("hi ");

    const keyboardEvent = new Event("keydown", {
      bubbles: true,
      cancelable: true,
    }) as KeyboardEvent;
    Object.defineProperty(keyboardEvent, "key", { value: "z" });
    Object.defineProperty(keyboardEvent, "ctrlKey", { value: true });
    const consumeKeyboardEvent = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };

    const handled = service.tryUndoLastExtensionEdit(entry, keyboardEvent, {
      consumeKeyboardEvent,
      clearSuggestions: () => undefined,
    });

    expect(handled).toBe(true);
    expect(input.value).toBe("h");
    expect(input.selectionStart).toBe(1);
    expect(entry.pendingExtensionEdit).toBeNull();
    expect(entry.manualAutoFixSuppression).toBeNull();
  });

  test("undoes latest grammar auto-fix on Cmd/Ctrl+Z when caret is unchanged", () => {
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
    Object.defineProperty(keyboardEvent, "key", { value: "z" });
    Object.defineProperty(keyboardEvent, "ctrlKey", { value: true });

    const handled = service.tryUndoLastExtensionEdit(entry, keyboardEvent, {
      consumeKeyboardEvent: () => undefined,
      clearSuggestions: () => undefined,
    });

    expect(handled).toBe(true);
    expect(input.value).toBe("teh ");
    expect(input.selectionStart).toBe(4);
    expect(entry.pendingExtensionEdit).toBeNull();
    expect(entry.manualAutoFixSuppression).toEqual({
      ruleKey: "fallback:teh ->the ",
      replaceStart: 0,
      tokenStart: 0,
      tokenText: "teh",
    });
  });

  test("suppresses immediate auto-reapply after manual grammar revert", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
    });

    const input = document.createElement("input");
    input.value = "alot";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    const entry = createSuggestionEntry({ elem: input });

    service.applyTextEdit(entry, {
      replacementText: "a lot",
      replaceBackwardCount: 4,
      evaluatedTextLength: 4,
      expectedReplacedText: "alot",
      sourceRuleId: "englishAlotCorrection",
    });
    expect(input.value).toBe("a lot");

    const keyboardEvent = new Event("keydown", {
      bubbles: true,
      cancelable: true,
    }) as KeyboardEvent;
    Object.defineProperty(keyboardEvent, "key", { value: "z" });
    Object.defineProperty(keyboardEvent, "ctrlKey", { value: true });
    const reverted = service.tryUndoLastExtensionEdit(entry, keyboardEvent, {
      consumeKeyboardEvent: () => undefined,
      clearSuggestions: () => undefined,
    });
    expect(reverted).toBe(true);
    expect(input.value).toBe("alot");

    const reapplyResult = service.applyTextEdit(entry, {
      replacementText: "a lot",
      replaceBackwardCount: 4,
      evaluatedTextLength: 4,
      expectedReplacedText: "alot",
      sourceRuleId: "englishAlotCorrection",
    });

    expect(reapplyResult).toEqual({ applied: false, didDispatchInput: false });
    expect(input.value).toBe("alot");
  });

  test("clears manual-revert suppression after token context changes", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
    });

    const input = document.createElement("input");
    input.value = "alot";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    const entry = createSuggestionEntry({ elem: input });

    service.applyTextEdit(entry, {
      replacementText: "a lot",
      replaceBackwardCount: 4,
      evaluatedTextLength: 4,
      expectedReplacedText: "alot",
      sourceRuleId: "englishAlotCorrection",
    });

    const keyboardEvent = new Event("keydown", {
      bubbles: true,
      cancelable: true,
    }) as KeyboardEvent;
    Object.defineProperty(keyboardEvent, "key", { value: "z" });
    Object.defineProperty(keyboardEvent, "ctrlKey", { value: true });
    service.tryUndoLastExtensionEdit(entry, keyboardEvent, {
      consumeKeyboardEvent: () => undefined,
      clearSuggestions: () => undefined,
    });
    expect(entry.manualAutoFixSuppression).not.toBeNull();

    input.value = "alot x";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    service.syncManualAutoFixSuppression(entry);
    expect(entry.manualAutoFixSuppression).toBeNull();

    input.selectionStart = 4;
    input.selectionEnd = 4;
    const applyResult = service.applyTextEdit(entry, {
      replacementText: "a lot",
      replaceBackwardCount: 4,
      evaluatedTextLength: 4,
      expectedReplacedText: "alot",
      sourceRuleId: "englishAlotCorrection",
    });
    expect(applyResult.applied).toBe(true);
    expect(input.value).toBe("a lot x");
  });

  test("does not undo grammar auto-fix after user modifies text", () => {
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
    Object.defineProperty(keyboardEvent, "key", { value: "z" });
    Object.defineProperty(keyboardEvent, "ctrlKey", { value: true });

    const firstHandled = service.tryUndoLastExtensionEdit(entry, keyboardEvent, {
      consumeKeyboardEvent: () => undefined,
      clearSuggestions: () => undefined,
    });

    expect(firstHandled).toBe(false);
    expect(input.value).toBe("the x");
    expect(entry.pendingExtensionEdit).toBeNull();

    // A later undo attempt must not resurrect the original typo once the snapshot is invalidated.
    input.value = "the ";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    const secondUndo = new Event("keydown", {
      bubbles: true,
      cancelable: true,
    }) as KeyboardEvent;
    Object.defineProperty(secondUndo, "key", { value: "z" });
    Object.defineProperty(secondUndo, "ctrlKey", { value: true });
    const secondHandled = service.tryUndoLastExtensionEdit(entry, secondUndo, {
      consumeKeyboardEvent: () => undefined,
      clearSuggestions: () => undefined,
    });
    expect(secondHandled).toBe(false);
    expect(input.value).toBe("the ");
  });

  test("does not undo after same-length edit outside the replaced span", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
    });

    const input = document.createElement("input");
    input.value = "abc teh ";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    const entry = createSuggestionEntry({ elem: input });

    service.applyTextEdit(entry, {
      replacementText: "the ",
      replaceBackwardCount: 4,
      evaluatedTextLength: input.value.length,
      expectedReplacedText: "teh ",
    });
    expect(input.value).toBe("abc the ");

    input.value = "Abc the ";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;

    const keyboardEvent = new Event("keydown", {
      bubbles: true,
      cancelable: true,
    }) as KeyboardEvent;
    Object.defineProperty(keyboardEvent, "key", { value: "z" });
    Object.defineProperty(keyboardEvent, "ctrlKey", { value: true });

    const handled = service.tryUndoLastExtensionEdit(entry, keyboardEvent, {
      consumeKeyboardEvent: () => undefined,
      clearSuggestions: () => undefined,
    });

    expect(handled).toBe(false);
    expect(input.value).toBe("Abc the ");
    expect(entry.pendingExtensionEdit).toBeNull();
  });

  test("clears pending undo when caret no longer matches post-edit cursor", () => {
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

    // User moved caret before pressing undo; snapshot must be invalidated.
    input.selectionStart = input.value.length - 1;
    input.selectionEnd = input.value.length - 1;

    const keyboardEvent = new Event("keydown", {
      bubbles: true,
      cancelable: true,
    }) as KeyboardEvent;
    Object.defineProperty(keyboardEvent, "key", { value: "z" });
    Object.defineProperty(keyboardEvent, "ctrlKey", { value: true });

    const handled = service.tryUndoLastExtensionEdit(entry, keyboardEvent, {
      consumeKeyboardEvent: () => undefined,
      clearSuggestions: () => undefined,
    });

    expect(handled).toBe(false);
    expect(entry.pendingExtensionEdit).toBeNull();
    expect(input.value).toBe("the ");
  });

  test("clears pending undo when edited text can no longer contain replacement span", () => {
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
    Object.defineProperty(keyboardEvent, "key", { value: "z" });
    Object.defineProperty(keyboardEvent, "ctrlKey", { value: true });

    const handled = service.tryUndoLastExtensionEdit(entry, keyboardEvent, {
      consumeKeyboardEvent: () => undefined,
      clearSuggestions: () => undefined,
    });

    expect(handled).toBe(false);
    expect(entry.pendingExtensionEdit).toBeNull();
    expect(input.value).toBe("t");
  });
});
