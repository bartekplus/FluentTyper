import { describe, expect, jest, test } from "bun:test";
import { ContentEditableAdapter } from "../src/adapters/chrome/content-script/suggestions/ContentEditableAdapter";
import { HostEditorAdapterResolver } from "../src/adapters/chrome/content-script/suggestions/HostEditorAdapterResolver";
import type { HostEditorPageBridge } from "../src/adapters/chrome/content-script/suggestions/HostEditorPageBridge";
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
    options?: { preferDomMutation?: boolean; scopeRoot?: HTMLElement | null },
  ) {
    void elem;
    void replaceStart;
    void replaceEnd;
    void replacementText;
    void cursorAfter;
    void options;
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
    options?: { preferDomMutation?: boolean; scopeRoot?: HTMLElement | null },
  ) {
    void elem;
    void replaceStart;
    void replaceEnd;
    void replacementText;
    void cursorAfter;
    void options;
    return {
      appliedBy: "host-beforeinput" as const,
      didMutateDom: false,
      didDispatchInput: false,
    };
  }
}

class DeferredHostThenDomFallbackContentEditableAdapter extends ContentEditableAdapter {
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
    options?: { preferDomMutation?: boolean; scopeRoot?: HTMLElement | null },
  ) {
    if (options?.preferDomMutation === true) {
      return super.replaceTextByOffsets(
        elem,
        replaceStart,
        replaceEnd,
        replacementText,
        cursorAfter,
        options,
      );
    }

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
    options?: { preferDomMutation?: boolean; scopeRoot?: HTMLElement | null },
  ) {
    const text = elem.textContent ?? "";
    void options;
    elem.textContent = `${text.slice(0, replaceStart)}${replacementText}${text.slice(replaceEnd)}`;
    setContentEditableCursor(elem, cursorAfter);
    return {
      appliedBy: "fallback-dom" as const,
      didMutateDom: true,
      didDispatchInput: true,
    };
  }
}

class LearningMismatchContentEditableAdapter extends ContentEditableAdapter {
  public readonly preferDomMutationCalls: boolean[] = [];

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
    options?: { preferDomMutation?: boolean; scopeRoot?: HTMLElement | null },
  ) {
    const preferDomMutation = options?.preferDomMutation === true;
    this.preferDomMutationCalls.push(preferDomMutation);
    const text = elem.textContent ?? "";

    if (!preferDomMutation) {
      const insertionPoint = Math.min(text.length, replaceStart + 1);
      elem.textContent = `${text.slice(0, insertionPoint)}${replacementText}${text.slice(insertionPoint)}`;
      return {
        appliedBy: "host-beforeinput" as const,
        didMutateDom: true,
        didDispatchInput: false,
      };
    }

    elem.textContent = `${text.slice(0, replaceStart)}${replacementText}${text.slice(replaceEnd)}`;
    setContentEditableCursor(elem, cursorAfter);
    return {
      appliedBy: "fallback-dom" as const,
      didMutateDom: true,
      didDispatchInput: true,
    };
  }
}

class RecordingAcceptContentEditableAdapter extends ContentEditableAdapter {
  public lastScopeRoot: HTMLElement | null = null;
  public lastReplaceStart: number | null = null;
  public lastReplaceEnd: number | null = null;

  public override replaceTextByOffsets(
    elem: HTMLElement,
    replaceStart: number,
    replaceEnd: number,
    replacementText: string,
    cursorAfter: number,
    options?: { preferDomMutation?: boolean; scopeRoot?: HTMLElement | null },
  ) {
    this.lastScopeRoot = options?.scopeRoot ?? null;
    this.lastReplaceStart = replaceStart;
    this.lastReplaceEnd = replaceEnd;
    return super.replaceTextByOffsets(
      elem,
      replaceStart,
      replaceEnd,
      replacementText,
      cursorAfter,
      options,
    );
  }
}

function createHostModelEditable({
  text,
  cursor,
  controllerAncestorDepth = 0,
}: {
  text: string;
  cursor: number;
  controllerAncestorDepth?: number;
}): {
  editable: HTMLElement;
  getReplaceRangeCalls: () => number;
  setControllerLine: (value: string) => void;
} {
  const controllerRoot = document.createElement("div");
  document.body.appendChild(controllerRoot);

  let current = controllerRoot;
  for (let index = 0; index < controllerAncestorDepth; index += 1) {
    const wrapper = document.createElement("div");
    current.appendChild(wrapper);
    current = wrapper;
  }

  const editable = document.createElement("div");
  editable.setAttribute("contenteditable", "true");
  Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
  editable.textContent = text;
  current.appendChild(editable);
  setContentEditableCursor(editable, cursor);

  let line = text;
  let ch = cursor;
  let replaceRangeCalls = 0;
  (controllerRoot as HTMLElement & { genericEditorController?: unknown }).genericEditorController =
    {
      replaceRange(
        replacementText: string,
        from: { line: number; ch: number },
        to?: { line: number; ch: number },
      ) {
        replaceRangeCalls += 1;
        line = `${line.slice(0, from.ch)}${replacementText}${line.slice(to?.ch ?? from.ch)}`;
        editable.textContent = line;
      },
      setCursor(position: { line: number; ch: number }) {
        ch = position.ch;
        setContentEditableCursor(editable, ch);
      },
      getCursor() {
        return { line: 0, ch };
      },
      getLine(lineIndex: number) {
        return lineIndex === 0 ? line : "";
      },
      posFromIndex(index: number) {
        return { line: 0, ch: index };
      },
      indexFromPos(position: { line: number; ch: number }) {
        return position.ch;
      },
      operation(callback: () => void) {
        callback();
      },
    };

  return {
    editable,
    getReplaceRangeCalls: () => replaceRangeCalls,
    setControllerLine: (value: string) => {
      line = value;
    },
  };
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

    expect(accepted).toEqual({
      triggerText: "fun",
      insertedText: "function",
      cursorAfter: 8,
      cursorAfterIsBlockLocal: false,
    });
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

    service.applyGrammarEdit(entry, {
      replacementText: "the ",
      replaceBackwardCount: 4,
      evaluatedTextLength: 4,
      expectedReplacedText: "teh ",
    });

    expect(input.value).toBe("the ");
    expect(inputEventCount).toBe(1);
  });

  test("dispatches a bubbling input event for text-value grammar edits", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
    });

    const input = document.createElement("input");
    input.value = "teh ";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    const entry = createSuggestionEntry({ elem: input });

    let receivedBubblingInput = false;
    input.addEventListener("input", (event) => {
      receivedBubblingInput = event.bubbles;
    });

    const result = service.applyGrammarEdit(entry, {
      replacementText: "the ",
      replaceBackwardCount: 4,
      evaluatedTextLength: 4,
      expectedReplacedText: "teh ",
    });

    expect(result).toEqual({ applied: true, didDispatchInput: true });
    expect(receivedBubblingInput).toBe(true);
  });

  test("supports forward-delete grammar edits from the live caret", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
    });

    const input = document.createElement("input");
    input.value = "asap";
    input.selectionStart = 0;
    input.selectionEnd = 0;
    const entry = createSuggestionEntry({ elem: input });

    const result = service.applyGrammarEdit(entry, {
      replacement: "A",
      deleteBackwards: 0,
      deleteForwards: 1,
      sourceRuleId: "capitalizeSentenceStart",
    });

    expect(result).toEqual({ applied: true, didDispatchInput: true });
    expect(input.value).toBe("Asap");
    expect(input.selectionStart).toBe(1);
    expect(input.selectionEnd).toBe(1);
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

    const result = service.applyGrammarEdit(entry, {
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

  test("applies live punctuation spacing edits at the caret", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
    });

    const input = document.createElement("input");
    input.value = "Hello .";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    const entry = createSuggestionEntry({ elem: input });

    const result = service.applyGrammarEdit(entry, {
      replacement: ". ",
      deleteBackwards: 2,
      deleteForwards: 0,
      sourceRuleId: "commaPeriodSpacing",
    });

    expect(result).toEqual({ applied: true, didDispatchInput: true });
    expect(input.value).toBe("Hello. ");
  });

  test("applies duplicate punctuation cleanup at the live caret", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
    });

    const input = document.createElement("input");
    input.value = "Hello,, ";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    const entry = createSuggestionEntry({ elem: input });

    const result = service.applyGrammarEdit(entry, {
      replacement: ", ",
      deleteBackwards: 3,
      deleteForwards: 0,
      sourceRuleId: "duplicatePunctuationCollapse",
    });

    expect(result).toEqual({ applied: true, didDispatchInput: true });
    expect(input.value).toBe("Hello, ");
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

    service.applyGrammarEdit(entry, {
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

    const result = service.applyGrammarEdit(entry, {
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
    service.applyGrammarEdit(entry, {
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

  test("applies contenteditable textEdit from provided block context when live selection drifts", () => {
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

    // Simulate a rich editor where the live selection has already drifted back
    // before the punctuation by the time the grammar edit is applied.
    setTextNodeCursor(secondTextNode, (secondTextNode.textContent?.length ?? 1) - 1);

    const entry = createSuggestionEntry({ elem: editable });
    const fullText = editable.textContent ?? "";
    const result = service.applyGrammarEdit(
      entry,
      {
        replacement: ". ",
        deleteBackwards: 2,
        deleteForwards: 0,
        sourceRuleId: "commaPeriodSpacing",
      },
      {
        snapshot: {
          beforeCursor: fullText,
          afterCursor: "",
          cursorOffset: fullText.length,
        },
        contentEditableContext: {
          beforeCursor: "fixed .",
          afterCursor: "",
          useFullTextOffsets: false,
        },
      },
    );

    expect(result).toEqual({ applied: true, didDispatchInput: true });
    const paragraphs = editable.querySelectorAll("p");
    expect(paragraphs[0]?.textContent).toBe("Title");
    expect((paragraphs[1]?.textContent ?? "").replace(/\u00a0/g, " ")).toBe("fixed. ");
  });

  test("learns DOM grammar fallback after host replacement mismatch without editor-specific checks", () => {
    const adapter = new LearningMismatchContentEditableAdapter();
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
      contentEditableAdapter: adapter,
    });

    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    document.body.appendChild(editable);
    const entry = createSuggestionEntry({ elem: editable });

    editable.textContent = "fixed .";
    const firstResult = service.applyGrammarEdit(
      entry,
      {
        replacement: ". ",
        deleteBackwards: 2,
        deleteForwards: 0,
        sourceRuleId: "commaPeriodSpacing",
      },
      {
        snapshot: {
          beforeCursor: "fixed .",
          afterCursor: "",
          cursorOffset: "fixed .".length,
        },
        contentEditableContext: {
          beforeCursor: "fixed .",
          afterCursor: "",
          useFullTextOffsets: false,
        },
      },
    );

    expect(firstResult).toEqual({ applied: true, didDispatchInput: true });
    expect(editable.textContent).toBe("fixed. ");
    expect(adapter.preferDomMutationCalls).toEqual([false, true]);

    editable.textContent = "Hello .";
    const secondResult = service.applyGrammarEdit(
      entry,
      {
        replacement: ". ",
        deleteBackwards: 2,
        deleteForwards: 0,
        sourceRuleId: "commaPeriodSpacing",
      },
      {
        snapshot: {
          beforeCursor: "Hello .",
          afterCursor: "",
          cursorOffset: "Hello .".length,
        },
        contentEditableContext: {
          beforeCursor: "Hello .",
          afterCursor: "",
          useFullTextOffsets: false,
        },
      },
    );

    expect(secondResult).toEqual({ applied: true, didDispatchInput: true });
    expect(editable.textContent).toBe("Hello. ");
    expect(adapter.preferDomMutationCalls).toEqual([false, true, true]);
  });

  test("normalizes duplicate punctuation before NBSP in contenteditable", () => {
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
    const result = service.applyGrammarEdit(entry, {
      replacement: ", ",
      deleteBackwards: 3,
      deleteForwards: 0,
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
      cursorAfter: 12,
      cursorAfterIsBlockLocal: false,
    });
    expect(editable.textContent).toBe("first SECOND");
  });

  test("keeps accepted expansion before a following signature block in contenteditable", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
    });

    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.innerHTML =
      'asap<div><span class="gmail_signature_prefix">-- </span><br><div class="gmail_signature">Pozdrawiam Bartek</div></div>';
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);

    const selection = window.getSelection();
    if (!selection) {
      throw new Error("Selection API unavailable");
    }
    const range = document.createRange();
    range.setStart(editable, 1);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    const entry = createSuggestionEntry({
      elem: editable,
      latestMentionText: "asap",
      latestMentionStart: 0,
    });

    const accepted = service.acceptSuggestion(entry, "As soon as possible ");

    expect(accepted).toEqual({
      triggerText: "asap",
      insertedText: "As soon as possible\u00A0",
      cursorAfter: 20,
      cursorAfterIsBlockLocal: false,
    });
    expect(editable.innerHTML).toContain("As soon as possible&nbsp;<div");
    expect(editable.querySelector(".gmail_signature_prefix")?.textContent).toBe("-- ");
  });

  test("accepts contenteditable suggestion using active block offsets", () => {
    const adapter = new RecordingAcceptContentEditableAdapter();
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
      contentEditableAdapter: adapter,
    });

    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.innerHTML = "<p>Intro line</p><p>What is the bes</p>";
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);

    const secondParagraph = editable.querySelectorAll("p")[1] as HTMLElement;
    const secondText = secondParagraph.firstChild as Text;
    setTextNodeCursor(secondText, secondText.textContent?.length ?? 0);

    const entry = createSuggestionEntry({
      elem: editable,
      latestMentionText: "bes",
      latestMentionStart: -1,
    });

    const accepted = service.acceptSuggestion(entry, "best ");

    expect(accepted).toEqual({
      triggerText: "bes",
      insertedText: "best\u00A0",
      cursorAfter: 17,
      cursorAfterIsBlockLocal: true,
    });
    expect(secondParagraph.textContent).toBe("What is the best\u00A0");
    expect((editable.querySelectorAll("p")[0] as HTMLElement).textContent).toBe("Intro line");
    expect(adapter.lastScopeRoot).toBe(secondParagraph);
    expect(adapter.lastReplaceStart).toBe(12);
    expect(adapter.lastReplaceEnd).toBe(15);
    expect(entry.pendingExtensionEdit?.blockScoped).toBe(true);
    expect(entry.pendingExtensionEdit?.postEditBlockText).toBe("What is the best\u00A0");
  });

  test("uses a generic host editor session for contenteditable acceptance when capabilities match", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
      hostEditorAdapterResolver: new HostEditorAdapterResolver(),
    });
    const hostModel = createHostModelEditable({ text: "What is the bes", cursor: 15 });

    const entry = createSuggestionEntry({
      elem: hostModel.editable,
      latestMentionText: "bes",
      latestMentionStart: -1,
    });

    const accepted = service.acceptSuggestion(entry, "best ");

    expect(accepted).toEqual({
      triggerText: "bes",
      insertedText: "best ",
      cursorAfter: 17,
      cursorAfterIsBlockLocal: true,
    });
    expect(hostModel.getReplaceRangeCalls()).toBe(1);
    expect(hostModel.editable.textContent).toBe("What is the best ");
    expect(entry.pendingExtensionEdit?.postEditFingerprint.fullText).toBe("What is the best ");
    expect(entry.pendingExtensionEdit?.postEditFingerprint.cursorOffset).toBe(17);
  });

  test("uses a host editor session when the controller is mounted above the editable subtree", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
      hostEditorAdapterResolver: new HostEditorAdapterResolver(),
    });
    const hostModel = createHostModelEditable({
      text: "What is the bes",
      cursor: 15,
      controllerAncestorDepth: 7,
    });

    const entry = createSuggestionEntry({
      elem: hostModel.editable,
      latestMentionText: "bes",
      latestMentionStart: -1,
    });

    const accepted = service.acceptSuggestion(entry, "best ");

    expect(accepted).toEqual({
      triggerText: "bes",
      insertedText: "best ",
      cursorAfter: 17,
      cursorAfterIsBlockLocal: true,
    });
    expect(hostModel.getReplaceRangeCalls()).toBe(1);
    expect(hostModel.editable.textContent).toBe("What is the best ");
  });

  test("uses the page-bridge host editor path when the page-owned controller is not directly visible", () => {
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    editable.textContent = "What is the bes";
    document.body.appendChild(editable);
    setContentEditableCursor(editable, 15);

    let blockText = "What is the bes";
    let beforeCursor = "What is the bes";
    let afterCursor = "";
    let applyCalls = 0;
    const pageBridge: HostEditorPageBridge = {
      getBlockContextAtSelection() {
        return { beforeCursor, afterCursor, blockText };
      },
      applyBlockReplacement(_elem, args) {
        applyCalls += 1;
        blockText = `${blockText.slice(0, args.replaceStart)}${args.replacementText}${blockText.slice(args.replaceEnd)}`;
        beforeCursor = blockText.slice(0, args.cursorAfter);
        afterCursor = blockText.slice(args.cursorAfter);
        editable.textContent = blockText;
        setContentEditableCursor(editable, args.cursorAfter);
        return { applied: true, didDispatchInput: false };
      },
    };

    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
      hostEditorAdapterResolver: new HostEditorAdapterResolver(pageBridge),
    });
    const entry = createSuggestionEntry({
      elem: editable,
      latestMentionText: "bes",
      latestMentionStart: -1,
    });

    const accepted = service.acceptSuggestion(entry, "best ");

    expect(accepted).toEqual({
      triggerText: "bes",
      insertedText: "best ",
      cursorAfter: 17,
      cursorAfterIsBlockLocal: true,
    });
    expect(applyCalls).toBe(1);
    expect(editable.textContent).toBe("What is the best ");
    expect(entry.pendingExtensionEdit?.postEditFingerprint.fullText).toBe("What is the best ");
    expect(entry.pendingExtensionEdit?.postEditFingerprint.cursorOffset).toBe(17);
    expect(entry.pendingExtensionEdit?.awaitingHostInputEcho ?? false).toBe(false);
  });

  test("restores the visible block caret after host-owned acceptance when the host model does not update DOM selection itself", () => {
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    editable.textContent = "What is the bes";
    document.body.appendChild(editable);
    setContentEditableCursor(editable, 15);

    let blockText = "What is the bes";
    let beforeCursor = "What is the bes";
    let afterCursor = "";
    const pageBridge: HostEditorPageBridge = {
      getBlockContextAtSelection() {
        return { beforeCursor, afterCursor, blockText };
      },
      applyBlockReplacement(_elem, args) {
        blockText = `${blockText.slice(0, args.replaceStart)}${args.replacementText}${blockText.slice(args.replaceEnd)}`;
        beforeCursor = blockText.slice(0, args.cursorAfter);
        afterCursor = blockText.slice(args.cursorAfter);
        editable.textContent = blockText;
        return { applied: true, didDispatchInput: false };
      },
    };

    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
      hostEditorAdapterResolver: new HostEditorAdapterResolver(pageBridge),
    });
    const entry = createSuggestionEntry({
      elem: editable,
      latestMentionText: "bes",
      latestMentionStart: -1,
    });

    const accepted = service.acceptSuggestion(entry, "best ");
    const selection = window.getSelection();

    expect(accepted).toEqual({
      triggerText: "bes",
      insertedText: "best ",
      cursorAfter: 17,
      cursorAfterIsBlockLocal: true,
    });
    expect(selection?.anchorNode?.textContent).toContain("What is the best ");
    expect(selection?.anchorOffset).toBe(17);
  });

  test("keeps the caret at end-of-word for mid-word host acceptance instead of moving past the separator", () => {
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    editable.textContent = "What is the txxxxypos thing";
    document.body.appendChild(editable);
    setContentEditableCursor(editable, 17);

    let blockText = "What is the txxxxypos thing";
    let beforeCursor = "What is the txxxx";
    let afterCursor = "ypos thing";
    const pageBridge: HostEditorPageBridge = {
      getBlockContextAtSelection() {
        return { beforeCursor, afterCursor, blockText };
      },
      applyBlockReplacement(_elem, args) {
        blockText = `${blockText.slice(0, args.replaceStart)}${args.replacementText}${blockText.slice(args.replaceEnd)}`;
        beforeCursor = blockText.slice(0, args.cursorAfter);
        afterCursor = blockText.slice(args.cursorAfter);
        editable.textContent = blockText;
        setContentEditableCursor(editable, args.cursorAfter);
        return { applied: true, didDispatchInput: false };
      },
    };

    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
      hostEditorAdapterResolver: new HostEditorAdapterResolver(pageBridge),
    });
    const entry = createSuggestionEntry({
      elem: editable,
      latestMentionText: "txxxx",
      latestMentionStart: -1,
    });

    const accepted = service.acceptSuggestion(entry, "toxicologists ");

    expect(accepted).toEqual({
      triggerText: "txxxx",
      insertedText: "toxicologists",
      cursorAfter: 25,
      cursorAfterIsBlockLocal: true,
    });
    expect(editable.textContent).toBe("What is the toxicologists thing");
    expect(entry.pendingExtensionEdit?.postEditFingerprint.cursorOffset).toBe(25);
    expect(entry.pendingExtensionEdit?.postEditBlockText).toBe("What is the toxicologists thing");
  });

  test("falls back to generic DOM contenteditable acceptance when host block parity does not match", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
      hostEditorAdapterResolver: new HostEditorAdapterResolver(),
    });
    const hostModel = createHostModelEditable({ text: "What is the bes", cursor: 15 });
    hostModel.setControllerLine("Mismatched text");

    const entry = createSuggestionEntry({
      elem: hostModel.editable,
      latestMentionText: "bes",
      latestMentionStart: -1,
    });

    const accepted = service.acceptSuggestion(entry, "best ");

    expect(accepted).toEqual({
      triggerText: "bes",
      insertedText: "best\u00A0",
      cursorAfter: 17,
      cursorAfterIsBlockLocal: true,
    });
    expect(hostModel.getReplaceRangeCalls()).toBe(0);
    expect(hostModel.editable.textContent).toBe("What is the best\u00A0");
  });

  test("falls back to generic DOM contenteditable acceptance when host cursor context drifts on identical line text", () => {
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    editable.textContent = "repeat line";
    document.body.appendChild(editable);
    setContentEditableCursor(editable, 10);

    let applyCalls = 0;
    const pageBridge: HostEditorPageBridge = {
      getBlockContextAtSelection() {
        return {
          beforeCursor: "repeat li",
          afterCursor: "ne",
          blockText: "repeat line",
        };
      },
      applyBlockReplacement() {
        applyCalls += 1;
        return { applied: true, didDispatchInput: false };
      },
    };

    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
      hostEditorAdapterResolver: new HostEditorAdapterResolver(pageBridge),
    });
    const entry = createSuggestionEntry({
      elem: editable,
      latestMentionText: "lin",
      latestMentionStart: -1,
    });

    const accepted = service.acceptSuggestion(entry, "line ");

    expect(accepted).toEqual({
      triggerText: "lin",
      insertedText: "line\u00A0",
      cursorAfter: 12,
      cursorAfterIsBlockLocal: true,
    });
    expect(applyCalls).toBe(0);
    expect(editable.textContent).toBe("repeat line\u00A0");
  });

  test("arms pending contenteditable suggestion edit before synthetic input dispatch", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
    });

    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.innerHTML = "<p>What is the bes</p>";
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);

    const paragraph = editable.querySelector("p") as HTMLElement | null;
    const textNode = paragraph?.firstChild as Text | null;
    if (!paragraph || !textNode) {
      throw new Error("Expected paragraph text node");
    }
    setTextNodeCursor(textNode, textNode.textContent?.length ?? 0);

    const entry = createSuggestionEntry({
      elem: editable,
      latestMentionText: "bes",
      latestMentionStart: -1,
    });

    let pendingEditDuringInput: typeof entry.pendingExtensionEdit | null = null;
    editable.addEventListener("input", () => {
      pendingEditDuringInput = entry.pendingExtensionEdit
        ? { ...entry.pendingExtensionEdit }
        : null;
    });

    const accepted = service.acceptSuggestion(entry, "best ");

    expect(accepted).toEqual({
      triggerText: "bes",
      insertedText: "best\u00A0",
      cursorAfter: 17,
      cursorAfterIsBlockLocal: true,
    });
    expect(pendingEditDuringInput?.blockScoped).toBe(true);
    expect(pendingEditDuringInput?.replacementText).toBe("best\u00A0");
    expect(pendingEditDuringInput?.postEditBlockText).toBe("What is the best\u00A0");
  });

  test("treats deferred host-owned contenteditable acceptance as successful", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
      contentEditableAdapter: new HostCanceledNoMutationContentEditableAdapter(),
    });

    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.innerHTML = "<p><span>Wh</span></p>";
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);

    const textNode = editable.querySelector("span")?.firstChild as Text | null;
    if (!textNode) {
      throw new Error("Expected text node");
    }
    setTextNodeCursor(textNode, textNode.textContent?.length ?? 0);

    const entry = createSuggestionEntry({
      elem: editable,
      latestMentionText: "Wh",
      latestMentionStart: -1,
    });

    const accepted = service.acceptSuggestion(entry, "What ");

    expect(accepted).toEqual({
      triggerText: "Wh",
      insertedText: "What\u00A0",
      cursorAfter: 5,
      cursorAfterIsBlockLocal: true,
    });
    expect(entry.pendingExtensionEdit?.blockScoped).toBe(true);
    expect(entry.pendingExtensionEdit?.replacementText).toBe("What\u00A0");
    expect(entry.pendingExtensionEdit?.postEditBlockText).toBe("What\u00A0");
    expect(entry.pendingExtensionEdit?.awaitingHostInputEcho).toBe(true);
    expect(editable.textContent).toBe("Wh");
  });

  test("keeps generic contenteditable acceptance deferred when beforeinput is canceled without immediate DOM mutation", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
      contentEditableAdapter: new DeferredHostThenDomFallbackContentEditableAdapter(),
    });

    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.innerHTML = "<p><span>Wh</span></p>";
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);

    const textNode = editable.querySelector("span")?.firstChild as Text | null;
    if (!textNode) {
      throw new Error("Expected text node");
    }
    setTextNodeCursor(textNode, textNode.textContent?.length ?? 0);

    const entry = createSuggestionEntry({
      elem: editable,
      latestMentionText: "Wh",
      latestMentionStart: -1,
    });

    const accepted = service.acceptSuggestion(entry, "What ");

    expect(accepted).toEqual({
      triggerText: "Wh",
      insertedText: "What\u00A0",
      cursorAfter: 5,
      cursorAfterIsBlockLocal: true,
    });
    expect(editable.textContent).toBe("Wh");
    expect(entry.pendingExtensionEdit?.awaitingHostInputEcho).toBe(true);
  });

  test("does nothing when delayed post-accept spacing is not armed", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
    });

    const input = document.createElement("input");
    input.type = "text";
    input.value = "Crab";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    document.body.appendChild(input);

    const entry = createSuggestionEntry({
      elem: input,
      missingTrailingSpace: false,
      expectedCursorPos: input.value.length,
    });

    let consumed = false;
    const keyboardEvent = new Event("keydown", {
      bubbles: true,
      cancelable: true,
    }) as KeyboardEvent;
    Object.defineProperty(keyboardEvent, "key", { value: "s" });

    service.handleMissingSpaceAfterAccept(entry, keyboardEvent, () => {
      consumed = true;
    });

    expect(consumed).toBe(false);
    expect(input.value).toBe("Crab");
    expect(entry.missingTrailingSpace).toBe(false);
  });

  test("inserts delayed post-accept spacing for the next typed character", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
    });

    const input = document.createElement("input");
    input.type = "text";
    input.value = "Crab";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    document.body.appendChild(input);

    const entry = createSuggestionEntry({
      elem: input,
      missingTrailingSpace: true,
      expectedCursorPos: input.value.length,
      suppressNextSuggestionInputPrediction: true,
      pendingExtensionEdit: {
        replaceStart: 0,
        originalText: "Wa",
        replacementText: "Was",
        cursorBefore: 2,
        cursorAfter: 3,
        postEditFingerprint: {
          fullText: "Was",
          cursorOffset: 3,
          selectionCollapsed: true,
        },
        awaitingHostInputEcho: true,
        source: "suggestion",
      },
    });

    let consumed = false;
    const keyboardEvent = new Event("keydown", {
      bubbles: true,
      cancelable: true,
    }) as KeyboardEvent;
    Object.defineProperty(keyboardEvent, "key", { value: "s" });

    service.handleMissingSpaceAfterAccept(entry, keyboardEvent, () => {
      consumed = true;
      keyboardEvent.preventDefault();
    });

    expect(consumed).toBe(true);
    expect(input.value).toBe("Crab s");
    expect(input.selectionStart).toBe(6);
    expect(input.selectionEnd).toBe(6);
    expect(entry.missingTrailingSpace).toBe(false);
    expect(entry.expectedCursorPos).toBe(0);
  });

  test("clears delayed post-accept spacing when the user types a literal space", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
    });

    const input = document.createElement("input");
    input.type = "text";
    input.value = "Was";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    document.body.appendChild(input);

    const entry = createSuggestionEntry({
      elem: input,
      missingTrailingSpace: true,
      expectedCursorPos: input.value.length,
      suppressNextSuggestionInputPrediction: true,
      pendingExtensionEdit: {
        replaceStart: 0,
        originalText: "Wa",
        replacementText: "Was",
        cursorBefore: 2,
        cursorAfter: 3,
        postEditFingerprint: {
          fullText: "Was",
          cursorOffset: 3,
          selectionCollapsed: true,
        },
        awaitingHostInputEcho: true,
        source: "suggestion",
      },
    });

    let consumed = false;
    const keyboardEvent = new Event("keydown", {
      bubbles: true,
      cancelable: true,
    }) as KeyboardEvent;
    Object.defineProperty(keyboardEvent, "key", { value: " " });

    service.handleMissingSpaceAfterAccept(entry, keyboardEvent, () => {
      consumed = true;
      keyboardEvent.preventDefault();
    });

    expect(consumed).toBe(false);
    expect(input.value).toBe("Was");
    expect(entry.missingTrailingSpace).toBe(false);
    expect(entry.expectedCursorPos).toBe(0);
    expect(entry.suppressNextSuggestionInputPrediction).toBe(true);
    expect(entry.pendingExtensionEdit?.awaitingHostInputEcho ?? false).toBe(true);
  });

  test("clears delayed post-accept spacing when the user types a literal space in contenteditable", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
    });

    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    editable.textContent = "Was";
    document.body.appendChild(editable);
    setContentEditableCursor(editable, 3);

    const entry = createSuggestionEntry({
      elem: editable,
      missingTrailingSpace: true,
      expectedCursorPos: 3,
      expectedCursorPosIsBlockLocal: true,
      expectedCursorPosBlockElement: editable,
      expectedCursorPosBlockText: "Was",
      suppressNextSuggestionInputPrediction: true,
      pendingExtensionEdit: {
        replaceStart: 0,
        originalText: "Wa",
        replacementText: "Was",
        cursorBefore: 2,
        cursorAfter: 3,
        postEditFingerprint: {
          fullText: "",
          cursorOffset: 3,
          selectionCollapsed: true,
        },
        awaitingHostInputEcho: true,
        source: "suggestion",
        blockScoped: true,
        blockElement: editable,
        postEditBlockText: "Was",
      },
    });

    let consumed = false;
    const keyboardEvent = new Event("keydown", {
      bubbles: true,
      cancelable: true,
    }) as KeyboardEvent;
    Object.defineProperty(keyboardEvent, "key", { value: " " });

    service.handleMissingSpaceAfterAccept(entry, keyboardEvent, () => {
      consumed = true;
      keyboardEvent.preventDefault();
    });

    expect(consumed).toBe(false);
    expect(entry.missingTrailingSpace).toBe(false);
    expect(entry.expectedCursorPos).toBe(0);
    expect(entry.expectedCursorPosIsBlockLocal).toBe(false);
    expect(entry.expectedCursorPosBlockElement).toBeNull();
    expect(entry.expectedCursorPosBlockText).toBeNull();
    expect(entry.suppressNextSuggestionInputPrediction).toBe(true);
    expect(entry.pendingExtensionEdit?.awaitingHostInputEcho).toBe(true);
  });

  test("uses the host editor path for delayed post-accept spacing in host-owned contenteditables", () => {
    const hostModel = createHostModelEditable({ text: "What is the best", cursor: 16 });
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
    });
    const entry = createSuggestionEntry({
      elem: hostModel.editable,
      missingTrailingSpace: true,
      expectedCursorPos: 16,
      expectedCursorPosIsBlockLocal: true,
      expectedCursorPosBlockElement: hostModel.editable,
      expectedCursorPosBlockText: "What is the best",
    });

    let consumed = false;
    const keyboardEvent = new Event("keydown", {
      bubbles: true,
      cancelable: true,
    }) as KeyboardEvent;
    Object.defineProperty(keyboardEvent, "key", { value: "s" });

    service.handleMissingSpaceAfterAccept(entry, keyboardEvent, () => {
      consumed = true;
      keyboardEvent.preventDefault();
    });

    expect(consumed).toBe(true);
    expect(hostModel.getReplaceRangeCalls()).toBe(1);
    expect(hostModel.editable.textContent).toBe("What is the best s");
    expect(entry.missingTrailingSpace).toBe(false);
  });

  test("clears delayed post-accept space state when caret moves to a different paragraph at the same local offset", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
    });

    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.innerHTML = "<p>Alpha bes</p><p>Gamma line</p>";
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);

    const firstParagraph = editable.querySelectorAll("p")[0] as HTMLElement;
    const secondParagraph = editable.querySelectorAll("p")[1] as HTMLElement;
    setTextNodeCursor(firstParagraph.firstChild as Text, "Alpha bes".length);

    const entry = createSuggestionEntry({
      elem: editable,
      latestMentionText: "bes",
      latestMentionStart: -1,
    });

    const accepted = service.acceptSuggestion(entry, "best");
    expect(accepted).toEqual({
      triggerText: "bes",
      insertedText: "best",
      cursorAfter: 10,
      cursorAfterIsBlockLocal: true,
    });

    entry.missingTrailingSpace = true;
    entry.expectedCursorPos = 10;
    entry.expectedCursorPosIsBlockLocal = true;
    entry.expectedCursorPosBlockElement = entry.pendingExtensionEdit?.blockElement ?? null;
    entry.expectedCursorPosBlockText = entry.pendingExtensionEdit?.postEditBlockText ?? null;

    setTextNodeCursor(secondParagraph.firstChild as Text, "Gamma line".length);

    let consumed = false;
    const keyboardEvent = new Event("keydown", {
      bubbles: true,
      cancelable: true,
    }) as KeyboardEvent;
    Object.defineProperty(keyboardEvent, "key", { value: "x" });

    service.handleMissingSpaceAfterAccept(entry, keyboardEvent, () => {
      consumed = true;
    });

    expect(consumed).toBe(false);
    expect(entry.missingTrailingSpace).toBe(false);
    expect(entry.expectedCursorPos).toBe(0);
    expect(entry.expectedCursorPosIsBlockLocal).toBe(false);
    expect(entry.expectedCursorPosBlockElement).toBeNull();
    expect(entry.expectedCursorPosBlockText).toBeNull();
    expect(firstParagraph.textContent).toBe("Alpha best");
    expect(secondParagraph.textContent).toBe("Gamma line");
  });

  test("does not undo block-scoped acceptance after caret moves to a different paragraph at the same local offset", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
    });

    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.innerHTML = "<p>Alpha bes</p><p>Gamma line</p>";
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    document.body.appendChild(editable);

    const firstParagraph = editable.querySelectorAll("p")[0] as HTMLElement;
    const secondParagraph = editable.querySelectorAll("p")[1] as HTMLElement;
    setTextNodeCursor(firstParagraph.firstChild as Text, "Alpha bes".length);

    const entry = createSuggestionEntry({
      elem: editable,
      latestMentionText: "bes",
      latestMentionStart: -1,
    });

    service.acceptSuggestion(entry, "best");
    expect(firstParagraph.textContent).toBe("Alpha best");
    expect(entry.pendingExtensionEdit?.blockScoped).toBe(true);

    setTextNodeCursor(secondParagraph.firstChild as Text, "Gamma line".length);

    let consumed = false;
    const keyboardEvent = new Event("keydown", {
      bubbles: true,
      cancelable: true,
    }) as KeyboardEvent;
    Object.defineProperty(keyboardEvent, "key", { value: "z" });
    Object.defineProperty(keyboardEvent, "ctrlKey", { value: true });

    const handled = service.tryUndoLastExtensionEdit(entry, keyboardEvent, {
      consumeKeyboardEvent: () => {
        consumed = true;
      },
      clearSuggestions: () => undefined,
    });

    expect(handled).toBe(false);
    expect(consumed).toBe(false);
    expect(firstParagraph.textContent).toBe("Alpha best");
    expect(secondParagraph.textContent).toBe("Gamma line");
    expect(entry.pendingExtensionEdit).toBeNull();
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

    service.applyGrammarEdit(entry, {
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

    service.applyGrammarEdit(entry, {
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

    const reapplyResult = service.applyGrammarEdit(entry, {
      replacementText: "a lot",
      replaceBackwardCount: 4,
      evaluatedTextLength: 4,
      expectedReplacedText: "alot",
      sourceRuleId: "englishAlotCorrection",
    });

    expect(reapplyResult).toEqual({
      applied: false,
      didDispatchInput: false,
      suppressedByManualRevert: true,
    });
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

    service.applyGrammarEdit(entry, {
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
    const applyResult = service.applyGrammarEdit(entry, {
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

    service.applyGrammarEdit(entry, {
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

    service.applyGrammarEdit(entry, {
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

    service.applyGrammarEdit(entry, {
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

    service.applyGrammarEdit(entry, {
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

  test("routes block-scoped grammar edit through host editor session when available", () => {
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    editable.textContent = "hello world";
    document.body.appendChild(editable);
    setContentEditableCursor(editable, 1);

    let blockText = "hello world";
    let beforeCursor = "h";
    let afterCursor = "ello world";
    let applyCalls = 0;
    const pageBridge: HostEditorPageBridge = {
      getBlockContextAtSelection() {
        return { beforeCursor, afterCursor, blockText };
      },
      applyBlockReplacement(_elem, args) {
        applyCalls += 1;
        blockText = `${blockText.slice(0, args.replaceStart)}${args.replacementText}${blockText.slice(args.replaceEnd)}`;
        beforeCursor = blockText.slice(0, args.cursorAfter);
        afterCursor = blockText.slice(args.cursorAfter);
        editable.textContent = blockText;
        setContentEditableCursor(editable, args.cursorAfter);
        return { applied: true, didDispatchInput: false };
      },
    };

    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
      hostEditorAdapterResolver: new HostEditorAdapterResolver(pageBridge),
    });
    const entry = createSuggestionEntry({ elem: editable });

    const result = service.applyGrammarEdit(
      entry,
      {
        replacement: "H",
        deleteBackwards: 1,
        deleteForwards: 0,
        sourceRuleId: "capitalizeSentenceStart",
      },
      {
        snapshot: {
          beforeCursor: "h",
          afterCursor: "ello world",
          cursorOffset: 1,
        },
        contentEditableContext: {
          beforeCursor: "h",
          afterCursor: "ello world",
          useFullTextOffsets: false,
        },
      },
    );

    expect(result).toEqual({ applied: true, didDispatchInput: false });
    expect(applyCalls).toBe(1);
    expect(editable.textContent).toBe("Hello world");
  });

  test("grammar edit via host session sets correct pendingExtensionEdit for undo", () => {
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    editable.textContent = "hello world";
    document.body.appendChild(editable);
    setContentEditableCursor(editable, 1);

    let blockText = "hello world";
    let beforeCursor = "h";
    let afterCursor = "ello world";
    const pageBridge: HostEditorPageBridge = {
      getBlockContextAtSelection() {
        return { beforeCursor, afterCursor, blockText };
      },
      applyBlockReplacement(_elem, args) {
        blockText = `${blockText.slice(0, args.replaceStart)}${args.replacementText}${blockText.slice(args.replaceEnd)}`;
        beforeCursor = blockText.slice(0, args.cursorAfter);
        afterCursor = blockText.slice(args.cursorAfter);
        editable.textContent = blockText;
        setContentEditableCursor(editable, args.cursorAfter);
        return { applied: true, didDispatchInput: false };
      },
    };

    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
      hostEditorAdapterResolver: new HostEditorAdapterResolver(pageBridge),
    });
    const entry = createSuggestionEntry({ elem: editable });

    service.applyGrammarEdit(
      entry,
      {
        replacement: "H",
        deleteBackwards: 1,
        deleteForwards: 0,
        sourceRuleId: "capitalizeSentenceStart",
      },
      {
        snapshot: {
          beforeCursor: "h",
          afterCursor: "ello world",
          cursorOffset: 1,
        },
        contentEditableContext: {
          beforeCursor: "h",
          afterCursor: "ello world",
          useFullTextOffsets: false,
        },
      },
    );

    expect(entry.pendingExtensionEdit).not.toBeNull();
    expect(entry.pendingExtensionEdit?.source).toBe("grammar");
    expect(entry.pendingExtensionEdit?.originalText).toBe("h");
    expect(entry.pendingExtensionEdit?.replacementText).toBe("H");
    expect(entry.pendingExtensionEdit?.replaceStart).toBe(0);
  });

  test("routes grammar edit through host when block text matches but cursor split is stale", () => {
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    editable.textContent = "dThe";
    document.body.appendChild(editable);
    setContentEditableCursor(editable, 1);

    let blockText = "dThe";
    let beforeCursor = "";
    let afterCursor = "dThe";
    let applyCalls = 0;
    const pageBridge: HostEditorPageBridge = {
      getBlockContextAtSelection() {
        return { beforeCursor, afterCursor, blockText };
      },
      applyBlockReplacement(_elem, args) {
        applyCalls += 1;
        blockText = `${blockText.slice(0, args.replaceStart)}${args.replacementText}${blockText.slice(args.replaceEnd)}`;
        beforeCursor = blockText.slice(0, args.cursorAfter);
        afterCursor = blockText.slice(args.cursorAfter);
        editable.textContent = blockText;
        setContentEditableCursor(editable, args.cursorAfter);
        return { applied: true, didDispatchInput: false };
      },
    };

    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
      hostEditorAdapterResolver: new HostEditorAdapterResolver(pageBridge),
    });
    const entry = createSuggestionEntry({ elem: editable });

    const result = service.applyGrammarEdit(
      entry,
      {
        replacement: "D",
        deleteBackwards: 1,
        deleteForwards: 0,
        sourceRuleId: "capitalizeFirstLetter",
      },
      {
        snapshot: {
          beforeCursor: "d",
          afterCursor: "The",
          cursorOffset: 1,
        },
        contentEditableContext: {
          beforeCursor: "d",
          afterCursor: "The",
          useFullTextOffsets: false,
        },
      },
    );

    expect(result).toEqual({ applied: true, didDispatchInput: false });
    expect(applyCalls).toBe(1);
    expect(editable.textContent).toBe("DThe");
  });

  test("routes leading-char grammar edit through host when the typed DOM char has not reached the host model yet", () => {
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    editable.textContent = "dThe";
    document.body.appendChild(editable);
    setContentEditableCursor(editable, 1);

    let blockText = "The";
    let beforeCursor = "T";
    let afterCursor = "he";
    let applyCalls = 0;
    let lastApplyArgs: {
      replaceStart: number;
      replaceEnd: number;
      replacementText: string;
      cursorAfter: number;
    } | null = null;
    const pageBridge: HostEditorPageBridge = {
      getBlockContextAtSelection() {
        return { beforeCursor, afterCursor, blockText };
      },
      applyBlockReplacement(_elem, args) {
        applyCalls += 1;
        lastApplyArgs = { ...args };
        blockText = `${blockText.slice(0, args.replaceStart)}${args.replacementText}${blockText.slice(args.replaceEnd)}`;
        beforeCursor = blockText.slice(0, args.cursorAfter);
        afterCursor = blockText.slice(args.cursorAfter);
        editable.textContent = blockText;
        setContentEditableCursor(editable, args.cursorAfter);
        return { applied: true, didDispatchInput: false };
      },
    };

    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
      hostEditorAdapterResolver: new HostEditorAdapterResolver(pageBridge),
    });
    const entry = createSuggestionEntry({ elem: editable });

    const result = service.applyGrammarEdit(
      entry,
      {
        replacement: "D",
        deleteBackwards: 1,
        deleteForwards: 0,
        sourceRuleId: "capitalizeFirstLetter",
      },
      {
        snapshot: {
          beforeCursor: "d",
          afterCursor: "The",
          cursorOffset: 1,
        },
        contentEditableContext: {
          beforeCursor: "d",
          afterCursor: "The",
          useFullTextOffsets: false,
        },
      },
    );

    expect(result).toEqual({ applied: true, didDispatchInput: false });
    expect(applyCalls).toBe(1);
    expect(lastApplyArgs).toEqual({
      replaceStart: 0,
      replaceEnd: 0,
      replacementText: "D",
      cursorAfter: 1,
      expectedBlockText: "The",
    });
    expect(editable.textContent).toBe("DThe");
  });

  test("does not reapply deferred grammar correction for plain contenteditable after further user input", () => {
    jest.useFakeTimers();
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    (
      globalThis as typeof globalThis & {
        requestAnimationFrame?: typeof requestAnimationFrame;
      }
    ).requestAnimationFrame = undefined;

    try {
      const service = new SuggestionTextEditService({
        findMentionToken,
        isSeparator: (value) => /\s/.test(value),
      });

      const editable = document.createElement("div");
      editable.setAttribute("contenteditable", "true");
      Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
      editable.textContent = "dThe";
      document.body.appendChild(editable);
      setContentEditableCursor(editable, 1);
      const entry = createSuggestionEntry({ elem: editable });

      const result = service.applyGrammarEdit(
        entry,
        {
          replacement: "D",
          deleteBackwards: 1,
          deleteForwards: 0,
          sourceRuleId: "capitalizeFirstLetter",
        },
        {
          snapshot: {
            beforeCursor: "d",
            afterCursor: "The",
            cursorOffset: 1,
          },
          contentEditableContext: {
            beforeCursor: "d",
            afterCursor: "The",
            useFullTextOffsets: false,
          },
        },
      );

      expect(result).toEqual({ applied: true, didDispatchInput: true });
      expect(editable.textContent).toBe("DThe");

      editable.textContent = "DThex";
      setContentEditableCursor(editable, 5);
      jest.advanceTimersByTime(31);

      expect(editable.textContent).toBe("DThex");
    } finally {
      (
        globalThis as typeof globalThis & {
          requestAnimationFrame?: typeof requestAnimationFrame;
        }
      ).requestAnimationFrame = originalRequestAnimationFrame;
      jest.useRealTimers();
    }
  });

  test("reapplies deferred grammar correction for host editor after late DOM echo", () => {
    jest.useFakeTimers();
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    (
      globalThis as typeof globalThis & {
        requestAnimationFrame?: typeof requestAnimationFrame;
      }
    ).requestAnimationFrame = undefined;

    try {
      const editable = document.createElement("div");
      editable.setAttribute("contenteditable", "true");
      Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
      editable.textContent = "dThe";
      document.body.appendChild(editable);
      setContentEditableCursor(editable, 1);

      let blockText = "dThe";
      let beforeCursor = "d";
      let afterCursor = "The";
      const pageBridge: HostEditorPageBridge = {
        getBlockContextAtSelection() {
          return { beforeCursor, afterCursor, blockText };
        },
        applyBlockReplacement(_elem, args) {
          blockText = `${blockText.slice(0, args.replaceStart)}${args.replacementText}${blockText.slice(args.replaceEnd)}`;
          beforeCursor = blockText.slice(0, args.cursorAfter);
          afterCursor = blockText.slice(args.cursorAfter);
          editable.textContent = blockText;
          setContentEditableCursor(editable, args.cursorAfter);
          return { applied: true, didDispatchInput: false };
        },
      };

      const service = new SuggestionTextEditService({
        findMentionToken,
        isSeparator: (value) => /\s/.test(value),
        hostEditorAdapterResolver: new HostEditorAdapterResolver(pageBridge),
      });
      const entry = createSuggestionEntry({ elem: editable });

      const result = service.applyGrammarEdit(
        entry,
        {
          replacement: "D",
          deleteBackwards: 1,
          deleteForwards: 0,
          sourceRuleId: "capitalizeFirstLetter",
        },
        {
          snapshot: {
            beforeCursor: "d",
            afterCursor: "The",
            cursorOffset: 1,
          },
          contentEditableContext: {
            beforeCursor: "d",
            afterCursor: "The",
            useFullTextOffsets: false,
          },
        },
      );

      expect(result).toEqual({ applied: true, didDispatchInput: false });
      expect(editable.textContent).toBe("DThe");

      setTimeout(() => {
        editable.textContent = "DdThe";
        setContentEditableCursor(editable, 2);
      }, 75);
      jest.advanceTimersByTime(130);

      expect(editable.textContent).toBe("DThe");
    } finally {
      (
        globalThis as typeof globalThis & {
          requestAnimationFrame?: typeof requestAnimationFrame;
        }
      ).requestAnimationFrame = originalRequestAnimationFrame;
      jest.useRealTimers();
    }
  });

  test("falls back to replaceTextByOffsets for grammar edit when host session is not available", () => {
    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
    });

    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    editable.textContent = "teh ";
    document.body.appendChild(editable);
    setContentEditableCursor(editable, 4);
    const entry = createSuggestionEntry({ elem: editable });

    const result = service.applyGrammarEdit(
      entry,
      {
        replacement: "the ",
        deleteBackwards: 4,
        deleteForwards: 0,
        sourceRuleId: "typoFix",
      },
      {
        snapshot: {
          beforeCursor: "teh ",
          afterCursor: "",
          cursorOffset: 4,
        },
        contentEditableContext: {
          beforeCursor: "teh ",
          afterCursor: "",
          useFullTextOffsets: false,
        },
      },
    );

    expect(result).toEqual({ applied: true, didDispatchInput: true });
    expect(editable.textContent).toBe("the ");
  });

  test("translates BR-separated line offsets to full-block offsets for host grammar edit", () => {
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    // Simulate a block with text before and after a <br>
    editable.textContent = "First line. second line. a";
    document.body.appendChild(editable);
    setContentEditableCursor(editable, 26);

    // The host editor sees the FULL block text
    let fullBlockText = "First line. second line. a";
    let hostBeforeCursor = "First line. second line. a";
    let hostAfterCursor = "";
    let applyCalls = 0;
    let lastApplyArgs: {
      replaceStart: number;
      replaceEnd: number;
      replacementText: string;
      cursorAfter: number;
    } | null = null;
    const pageBridge: HostEditorPageBridge = {
      getBlockContextAtSelection() {
        return {
          beforeCursor: hostBeforeCursor,
          afterCursor: hostAfterCursor,
          blockText: fullBlockText,
        };
      },
      applyBlockReplacement(_elem, args) {
        applyCalls += 1;
        lastApplyArgs = {
          replaceStart: args.replaceStart,
          replaceEnd: args.replaceEnd,
          replacementText: args.replacementText,
          cursorAfter: args.cursorAfter,
        };
        fullBlockText = `${fullBlockText.slice(0, args.replaceStart)}${args.replacementText}${fullBlockText.slice(args.replaceEnd)}`;
        hostBeforeCursor = fullBlockText.slice(0, args.cursorAfter);
        hostAfterCursor = fullBlockText.slice(args.cursorAfter);
        editable.textContent = fullBlockText;
        setContentEditableCursor(editable, args.cursorAfter);
        return { applied: true, didDispatchInput: false };
      },
    };

    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
      hostEditorAdapterResolver: new HostEditorAdapterResolver(pageBridge),
    });
    const entry = createSuggestionEntry({ elem: editable });

    // FluentTyper sees the BR-separated line context: "second line. a"
    // Grammar wants to capitalize 'a' -> 'A' (deleteBackwards: 1, replacement: "A")
    const result = service.applyGrammarEdit(
      entry,
      {
        replacement: "A",
        deleteBackwards: 1,
        deleteForwards: 0,
        sourceRuleId: "capitalizeSentenceStart",
      },
      {
        snapshot: {
          beforeCursor: "First line. second line. a",
          afterCursor: "",
          cursorOffset: 26,
        },
        contentEditableContext: {
          // BR-separated line context (text after the BR)
          beforeCursor: "second line. a",
          afterCursor: "",
          useFullTextOffsets: false,
        },
      },
    );

    expect(result).toEqual({ applied: true, didDispatchInput: false });
    expect(applyCalls).toBe(1);
    // The replacement should happen at offset 25 in the full block (not offset 13)
    expect(lastApplyArgs?.replaceStart).toBe(25);
    expect(lastApplyArgs?.replaceEnd).toBe(26);
    expect(lastApplyArgs?.replacementText).toBe("A");
    expect(lastApplyArgs?.cursorAfter).toBe(26);
    expect(editable.textContent).toBe("First line. second line. A");
  });

  test("routes suggestion acceptance through host with full-block offset translation for BR-separated lines", () => {
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
    // Build DOM with a <br> to trigger BR-separated line context
    editable.appendChild(document.createTextNode("First line."));
    editable.appendChild(document.createElement("br"));
    editable.appendChild(document.createTextNode("tes"));
    document.body.appendChild(editable);
    // Place cursor at end of "tes" (the text node after <br>)
    const textAfterBr = editable.childNodes[2] as Text;
    const range = document.createRange();
    range.setStart(textAfterBr, 3);
    range.collapse(true);
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }

    // Host editor sees full block text (no BR separation)
    let fullBlockText = "First line.tes";
    let hostBeforeCursor = "First line.tes";
    let hostAfterCursor = "";
    let applyCalls = 0;
    let lastApplyArgs: {
      replaceStart: number;
      replaceEnd: number;
      replacementText: string;
      cursorAfter: number;
    } | null = null;
    const pageBridge: HostEditorPageBridge = {
      getBlockContextAtSelection() {
        return {
          beforeCursor: hostBeforeCursor,
          afterCursor: hostAfterCursor,
          blockText: fullBlockText,
        };
      },
      applyBlockReplacement(_elem, args) {
        applyCalls += 1;
        lastApplyArgs = {
          replaceStart: args.replaceStart,
          replaceEnd: args.replaceEnd,
          replacementText: args.replacementText,
          cursorAfter: args.cursorAfter,
        };
        fullBlockText = `${fullBlockText.slice(0, args.replaceStart)}${args.replacementText}${fullBlockText.slice(args.replaceEnd)}`;
        hostBeforeCursor = fullBlockText.slice(0, args.cursorAfter);
        hostAfterCursor = fullBlockText.slice(args.cursorAfter);
        editable.textContent = fullBlockText;
        setContentEditableCursor(editable, args.cursorAfter);
        return { applied: true, didDispatchInput: false };
      },
    };

    const service = new SuggestionTextEditService({
      findMentionToken,
      isSeparator: (value) => /\s/.test(value),
      hostEditorAdapterResolver: new HostEditorAdapterResolver(pageBridge),
    });
    const entry = createSuggestionEntry({
      elem: editable,
      latestMentionText: "tes",
      latestMentionStart: -1,
    });

    const accepted = service.acceptSuggestion(entry, "test ");

    expect(accepted).not.toBeNull();
    expect(applyCalls).toBe(1);
    // The replacement should happen at offset 11 in the full block
    expect(lastApplyArgs?.replaceStart).toBe(11);
    expect((editable.textContent ?? "").replace(/\u00a0/g, " ")).toBe("First line.test ");
  });
});
