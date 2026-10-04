import { describe, expect, test } from "bun:test";
import { ContentEditableAdapter } from "../src/adapters/chrome/content-script/suggestions/ContentEditableAdapter";
import { HostEditorAdapterResolver } from "../src/adapters/chrome/content-script/suggestions/HostEditorAdapterResolver";
import { createEditor, setCaret, setCaretAtTextOffset } from "./codeContextTestUtils";
import {
  createLineEditorController,
  createPendingEdit,
  createSuggestionEntry,
  createTextEditService,
  enableHostEditorBridge,
  fakePageBridge,
} from "./suggestionTestUtils";

const hostResult = (didMutateDom: boolean) => ({
  appliedBy: "host-beforeinput" as const,
  didMutateDom,
  didDispatchInput: false,
});

class FullTextContentEditableAdapter extends ContentEditableAdapter {
  public override getBlockContext(elem: HTMLElement) {
    return { beforeCursor: elem.textContent ?? "", afterCursor: "" };
  }
}

class HostOwnedContentEditableAdapter extends FullTextContentEditableAdapter {
  constructor(private readonly didMutateDom: boolean) {
    super();
  }

  public override replaceTextByOffsets() {
    return hostResult(this.didMutateDom);
  }
}

class EmptyBlockContextContentEditableAdapter extends ContentEditableAdapter {
  public override getBlockContext() {
    return { beforeCursor: "", afterCursor: "" };
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
    setCaretAtTextOffset(elem, cursorAfter);
    return {
      appliedBy: "fallback-dom" as const,
      didMutateDom: true,
      didDispatchInput: true,
    };
  }
}

class LearningMismatchContentEditableAdapter extends FullTextContentEditableAdapter {
  public calls = 0;

  /** The host writes the replacement one character too late. */
  public override replaceTextByOffsets(
    elem: HTMLElement,
    replaceStart: number,
    _replaceEnd: number,
    replacementText: string,
  ) {
    this.calls += 1;
    const text = elem.textContent ?? "";
    const insertionPoint = Math.min(text.length, replaceStart + 1);
    elem.textContent = `${text.slice(0, insertionPoint)}${replacementText}${text.slice(insertionPoint)}`;
    return hostResult(true);
  }
}

class RecordingAcceptContentEditableAdapter extends ContentEditableAdapter {
  public lastScopeRoot: HTMLElement | null = null;
  public lastReplaceStart: number | null = null;
  public lastReplaceEnd: number | null = null;

  public override replaceTextByOffsets(
    ...args: Parameters<ContentEditableAdapter["replaceTextByOffsets"]>
  ) {
    this.lastReplaceStart = args[1];
    this.lastReplaceEnd = args[2];
    this.lastScopeRoot = args[5]?.scopeRoot ?? null;
    return super.replaceTextByOffsets(...args);
  }
}

function createHostModelEditable(text: string, cursor: number, controllerAncestorDepth = 0) {
  enableHostEditorBridge();
  const controllerRoot = document.body.appendChild(document.createElement("div"));
  let parent: HTMLElement = controllerRoot;
  for (let index = 0; index < controllerAncestorDepth; index += 1) {
    parent = parent.appendChild(document.createElement("div"));
  }
  const editable = parent.appendChild(createEditor(text));
  setCaretAtTextOffset(editable, cursor);
  const controller = createLineEditorController(editable, text, cursor, { withOperation: true });
  Object.assign(controllerRoot, { genericEditorController: controller });
  return { editable, controller };
}

describe("SuggestionTextEditService", () => {
  test("accepts suggestion and replaces current token in input", () => {
    const service = createTextEditService();

    const input = document.createElement("input");
    document.body.append(input);
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

  test("refuses unverified ProseMirror suggestions without recording an accepted edit", () => {
    const service = createTextEditService();
    const editable = createEditor("<p><strong>fun</strong></p>");
    editable.className = "ProseMirror";
    setCaretAtTextOffset(editable, 3);
    const original = editable.innerHTML;
    let events = 0;
    for (const type of ["beforeinput", "input"]) editable.addEventListener(type, () => events++);
    const entry = createSuggestionEntry({
      elem: editable,
      latestMentionText: "fun",
      latestMentionStart: 0,
    });

    expect(service.acceptSuggestion(entry, "function")).toBeNull();
    expect(entry.pendingExtensionEdit).toBeNull();
    expect(editable.innerHTML).toBe(original);
    expect(events).toBe(0);
    expect(window.getSelection()?.anchorOffset).toBe(3);
  });

  test("dispatches one input event for input/textarea replacement paths", () => {
    const service = createTextEditService();

    const input = document.createElement("input");
    document.body.append(input);
    input.value = "teh ";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    const entry = createSuggestionEntry({ elem: input });

    let inputEventCount = 0;
    input.addEventListener("input", () => {
      inputEventCount += 1;
    });

    service.applyGrammarEdit(entry, {
      replacement: "the ",
      deleteBackwards: 4,
      deleteForwards: 0,
    });

    expect(input.value).toBe("the ");
    expect(inputEventCount).toBe(1);
  });

  test("dispatches a bubbling input event for text-value grammar edits", () => {
    const service = createTextEditService();

    const input = document.createElement("input");
    document.body.append(input);
    input.value = "teh ";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    const entry = createSuggestionEntry({ elem: input });

    let receivedBubblingInput = false;
    input.addEventListener("input", (event) => {
      receivedBubblingInput = event.bubbles;
    });

    const result = service.applyGrammarEdit(entry, {
      replacement: "the ",
      deleteBackwards: 4,
      deleteForwards: 0,
    });

    expect(result).toEqual({ applied: true, didDispatchInput: false });
    expect(receivedBubblingInput).toBe(true);
  });

  test("supports forward-delete grammar edits from the live caret", () => {
    const service = createTextEditService();

    const input = document.createElement("input");
    document.body.append(input);
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

    expect(result).toEqual({ applied: true, didDispatchInput: false });
    expect(input.value).toBe("Asap");
    expect(input.selectionStart).toBe(1);
    expect(input.selectionEnd).toBe(1);
  });

  test("treats no-op input textEdit as not applied and does not dispatch input", () => {
    const service = createTextEditService();

    const input = document.createElement("input");
    document.body.append(input);
    input.value = "the ";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    const entry = createSuggestionEntry({ elem: input });

    let inputEventCount = 0;
    input.addEventListener("input", () => {
      inputEventCount += 1;
    });

    const result = service.applyGrammarEdit(entry, {
      replacement: "the ",
      deleteBackwards: 4,
      deleteForwards: 0,
    });

    expect(result).toEqual({ applied: false, didDispatchInput: false });
    expect(entry.pendingExtensionEdit).toBeNull();
    expect(input.value).toBe("the ");
    expect(inputEventCount).toBe(0);
  });

  test("applies live punctuation spacing edits at the caret", () => {
    const service = createTextEditService();

    const input = document.createElement("input");
    document.body.append(input);
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

    expect(result).toEqual({ applied: true, didDispatchInput: false });
    expect(input.value).toBe("Hello. ");
  });

  test("applies duplicate punctuation cleanup at the live caret", () => {
    const service = createTextEditService();

    const input = document.createElement("input");
    document.body.append(input);
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

    expect(result).toEqual({ applied: true, didDispatchInput: false });
    expect(input.value).toBe("Hello, ");
  });

  test("does not dispatch duplicate input event when contenteditable edit is host-owned", () => {
    const service = createTextEditService({
      contentEditableAdapter: new HostOwnedContentEditableAdapter(true),
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
      replacement: "the ",
      deleteBackwards: 4,
      deleteForwards: 0,
    });

    expect(inputEventCount).toBe(0);
  });

  test("treats host-canceled no-mutation contenteditable textEdit as no-op", () => {
    const service = createTextEditService({
      contentEditableAdapter: new HostOwnedContentEditableAdapter(false),
    });

    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.textContent = "teh ";
    document.body.appendChild(editable);
    const entry = createSuggestionEntry({ elem: editable });

    const result = service.applyGrammarEdit(entry, {
      replacement: "the ",
      deleteBackwards: 4,
      deleteForwards: 0,
    });

    expect(result).toEqual({ applied: false, didDispatchInput: false });
    expect(entry.pendingExtensionEdit).toBeNull();
    expect(editable.textContent).toBe("teh ");
  });

  test("applies contenteditable textEdit against active block offsets in multi-line content", () => {
    const service = createTextEditService();

    const editable = createEditor("<p>Title</p><p>fixed .</p>");

    const secondTextNode = editable.querySelectorAll("p")[1]!.firstChild as Text;
    setCaret(secondTextNode);

    const entry = createSuggestionEntry({ elem: editable });
    service.applyGrammarEdit(entry, {
      replacement: ". ",
      deleteBackwards: 2,
      deleteForwards: 0,
    });

    const paragraphs = editable.querySelectorAll("p");
    expect(paragraphs[0]?.textContent).toBe("Title");
    expect((paragraphs[1]?.textContent ?? "").replace(/\u00a0/g, " ")).toBe("fixed. ");
  });

  test("applies contenteditable textEdit from provided block context when live selection drifts", () => {
    const service = createTextEditService();

    const editable = createEditor("<p>Title</p><p>fixed .</p>");

    const secondTextNode = editable.querySelectorAll("p")[1]!.firstChild as Text;

    // Simulate a rich editor where the live selection has already drifted back
    // before the punctuation by the time the grammar edit is applied.
    setCaret(secondTextNode, secondTextNode.length - 1);

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

    expect(result).toEqual({ applied: true, didDispatchInput: false });
    const paragraphs = editable.querySelectorAll("p");
    expect(paragraphs[0]?.textContent).toBe("Title");
    expect((paragraphs[1]?.textContent ?? "").replace(/\u00a0/g, " ")).toBe("fixed. ");
  });

  test("FT-INV-5 reports a host mismatch without a second repair write", () => {
    const adapter = new LearningMismatchContentEditableAdapter();
    const service = createTextEditService({ contentEditableAdapter: adapter });

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

    expect(firstResult).toEqual({ applied: false, didDispatchInput: false, unverified: true });
    expect(editable.textContent).toBe("fixed . .");
    expect(adapter.calls).toBe(1);
    expect(entry.pendingExtensionEdit).toBeNull();
  });

  test("normalizes duplicate punctuation before NBSP in contenteditable", () => {
    const service = createTextEditService();

    const editable = createEditor("This is awseome,,\u00A0");
    setCaretAtTextOffset(editable, (editable.textContent ?? "").length);

    const entry = createSuggestionEntry({ elem: editable });
    const result = service.applyGrammarEdit(entry, {
      replacement: ", ",
      deleteBackwards: 3,
      deleteForwards: 0,
      sourceRuleId: "duplicatePunctuationCollapse",
    });

    expect(result).toEqual({ applied: true, didDispatchInput: false });
    expect((editable.textContent ?? "").replace(/\u00a0/g, " ")).toBe("This is awseome, ");
  });

  test("avoids introducing double space when accepted suggestion ends with space", () => {
    const service = createTextEditService();

    const input = document.createElement("input");
    document.body.append(input);
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
    const service = createTextEditService({
      contentEditableAdapter: new EmptyBlockContextContentEditableAdapter(),
    });

    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.textContent = "first second";
    document.body.appendChild(editable);
    setCaretAtTextOffset(editable, "first second".length);

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
    const service = createTextEditService();

    const editable = createEditor(
      'asap<div><span class="gmail_signature_prefix">-- </span><br><div class="gmail_signature">Pozdrawiam Bartek</div></div>',
    );

    setCaret(editable, 1);

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

  // Regression: an empty token must not step back over the separator ("hello |" gave "hellothere ").
  test.each([
    ["hello ", "hello there\u00A0"],
    ["hello world", "hello there\u00A0"],
  ])("accepts a next-word suggestion after %p with the caret after the space", (text, expected) => {
    const editable = createEditor(`<p>${text}</p>`);
    setCaret(editable.querySelector("p")!.firstChild!, 6);
    const entry = createSuggestionEntry({ elem: editable, latestMentionStart: -1 });

    createTextEditService().acceptSuggestion(entry, "there ");

    expect(editable.textContent).toBe(expected);
  });

  test("accepts contenteditable suggestion using active block offsets", () => {
    const adapter = new RecordingAcceptContentEditableAdapter();
    const service = createTextEditService({ contentEditableAdapter: adapter });

    const editable = createEditor("<p>Intro line</p><p>What is the bes</p>");

    const secondParagraph = editable.querySelectorAll("p")[1] as HTMLElement;
    const secondText = secondParagraph.firstChild as Text;
    setCaret(secondText);

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
    const service = createTextEditService({
      hostEditorAdapterResolver: new HostEditorAdapterResolver(),
    });
    const hostModel = createHostModelEditable("What is the bes", 15);

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
    expect(hostModel.controller.replaceRangeCalls).toBe(1);
    expect(hostModel.editable.textContent).toBe("What is the best ");
    expect(entry.pendingExtensionEdit?.postEditFingerprint.fullText).toBe("What is the best ");
    expect(entry.pendingExtensionEdit?.postEditFingerprint.cursorOffset).toBe(17);
  });

  test("uses a host editor session when the controller is mounted above the editable subtree", () => {
    const service = createTextEditService({
      hostEditorAdapterResolver: new HostEditorAdapterResolver(),
    });
    const hostModel = createHostModelEditable("What is the bes", 15, 7);

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
    expect(hostModel.controller.replaceRangeCalls).toBe(1);
    expect(hostModel.editable.textContent).toBe("What is the best ");
  });

  test("uses the page-bridge host editor path when the page-owned controller is not directly visible", () => {
    const editable = createEditor("What is the bes");
    setCaretAtTextOffset(editable, 15);

    const pageBridge = fakePageBridge(editable, "What is the bes", 15);

    const service = createTextEditService({
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
    expect(pageBridge.calls).toHaveLength(1);
    expect(editable.textContent).toBe("What is the best ");
    expect(entry.pendingExtensionEdit?.postEditFingerprint.fullText).toBe("What is the best ");
    expect(entry.pendingExtensionEdit?.postEditFingerprint.cursorOffset).toBe(17);
    expect(entry.pendingExtensionEdit?.awaitingHostInputEcho ?? false).toBe(false);
  });

  test("restores the visible block caret after host-owned acceptance when the host model does not update DOM selection itself", () => {
    const editable = createEditor("What is the bes");
    setCaretAtTextOffset(editable, 15);

    const pageBridge = fakePageBridge(editable, "What is the bes", 15, { movesCaret: false });

    const service = createTextEditService({
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
    const editable = createEditor("What is the txxxxypos thing");
    setCaretAtTextOffset(editable, 17);

    const pageBridge = fakePageBridge(editable, "What is the txxxxypos thing", 17);

    const service = createTextEditService({
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

  test("FT-INV-5 refuses acceptance when host block parity does not match", () => {
    const service = createTextEditService({
      hostEditorAdapterResolver: new HostEditorAdapterResolver(),
    });
    const hostModel = createHostModelEditable("What is the bes", 15);
    hostModel.controller.setLine("Mismatched text");

    const entry = createSuggestionEntry({
      elem: hostModel.editable,
      latestMentionText: "bes",
      latestMentionStart: -1,
    });

    const accepted = service.acceptSuggestion(entry, "best ");

    expect(accepted).toBeNull();
    expect(entry.pendingExtensionEdit).toBeNull();
    expect(hostModel.controller.replaceRangeCalls).toBe(0);
    expect(hostModel.editable.textContent).toBe("What is the bes");
  });

  test("FT-INV-1 refuses acceptance when host cursor context drifts on identical line text", () => {
    const editable = createEditor("repeat line");
    setCaretAtTextOffset(editable, 10);

    // The host caret is one character before the DOM caret.
    const pageBridge = fakePageBridge(editable, "repeat line", 9);

    const service = createTextEditService({
      hostEditorAdapterResolver: new HostEditorAdapterResolver(pageBridge),
    });
    const entry = createSuggestionEntry({
      elem: editable,
      latestMentionText: "lin",
      latestMentionStart: -1,
    });

    const accepted = service.acceptSuggestion(entry, "line ");

    expect(accepted).toBeNull();
    expect(entry.pendingExtensionEdit).toBeNull();
    expect(pageBridge.calls).toHaveLength(0);
    expect(editable.textContent).toBe("repeat line");
  });

  test("arms pending contenteditable suggestion edit before synthetic input dispatch", () => {
    const service = createTextEditService();

    const editable = createEditor("<p>What is the bes</p>");

    setCaret(editable.querySelector("p")!.firstChild!);

    const entry = createSuggestionEntry({
      elem: editable,
      latestMentionText: "bes",
      latestMentionStart: -1,
    });

    const captured: { pendingEditDuringInput: typeof entry.pendingExtensionEdit } = {
      pendingEditDuringInput: null,
    };
    editable.addEventListener("input", () => {
      captured.pendingEditDuringInput = entry.pendingExtensionEdit
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
    expect(captured.pendingEditDuringInput?.blockScoped).toBe(true);
    expect(captured.pendingEditDuringInput?.replacementText).toBe("best\u00A0");
    expect(captured.pendingEditDuringInput?.postEditBlockText).toBe("What is the best\u00A0");
  });

  test("treats deferred host-owned contenteditable acceptance as successful", () => {
    const service = createTextEditService({
      contentEditableAdapter: new HostOwnedContentEditableAdapter(false),
    });

    const editable = createEditor("<p><span>Wh</span></p>");

    setCaret(editable.querySelector("span")!.firstChild!);

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
      unverified: true,
    });
    expect(entry.pendingExtensionEdit?.blockScoped).toBe(true);
    expect(entry.pendingExtensionEdit?.replacementText).toBe("What\u00A0");
    expect(entry.pendingExtensionEdit?.postEditBlockText).toBe("What\u00A0");
    expect(entry.pendingExtensionEdit?.awaitingHostInputEcho).toBe(true);
    expect(editable.textContent).toBe("Wh");
  });

  test("keeps generic contenteditable acceptance deferred when beforeinput is canceled without immediate DOM mutation", () => {
    const service = createTextEditService({
      contentEditableAdapter: new HostOwnedContentEditableAdapter(false),
    });

    const editable = createEditor("<p><span>Wh</span></p>");

    setCaret(editable.querySelector("span")!.firstChild!);

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
      unverified: true,
    });
    expect(editable.textContent).toBe("Wh");
    expect(entry.pendingExtensionEdit?.awaitingHostInputEcho).toBe(true);
  });

  test("does nothing when delayed post-accept spacing is not armed", () => {
    const service = createTextEditService();

    const input = document.createElement("input");
    document.body.append(input);
    input.type = "text";
    input.value = "Crab";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;

    const entry = createSuggestionEntry({
      elem: input,
      missingTrailingSpace: false,
      expectedCursorPos: input.value.length,
    });

    let consumed = false;
    const keyboardEvent = new window.KeyboardEvent("keydown", {
      key: "s",
      bubbles: true,
      cancelable: true,
    });

    service.handleMissingSpaceAfterAccept(entry, keyboardEvent, () => {
      consumed = true;
    });

    expect(consumed).toBe(false);
    expect(input.value).toBe("Crab");
    expect(entry.missingTrailingSpace).toBe(false);
  });

  test("inserts delayed post-accept spacing for the next typed character", () => {
    const service = createTextEditService();

    const input = document.createElement("input");
    document.body.append(input);
    input.type = "text";
    input.value = "Crab";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;

    const entry = createSuggestionEntry({
      elem: input,
      missingTrailingSpace: true,
      expectedCursorPos: input.value.length,
      suppressNextSuggestionInputPrediction: true,
      pendingExtensionEdit: createPendingEdit({
        originalText: "Wa",
        replacementText: "Was",
        cursorBefore: 2,
        cursorAfter: 3,
        postEditFingerprint: { fullText: "Was", cursorOffset: 3, selectionCollapsed: true },
        awaitingHostInputEcho: true,
      }),
    });

    let consumed = false;
    const keyboardEvent = new window.KeyboardEvent("keydown", {
      key: "s",
      bubbles: true,
      cancelable: true,
    });

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
    const service = createTextEditService();

    const input = document.createElement("input");
    document.body.append(input);
    input.type = "text";
    input.value = "Was";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;

    const entry = createSuggestionEntry({
      elem: input,
      missingTrailingSpace: true,
      expectedCursorPos: input.value.length,
      suppressNextSuggestionInputPrediction: true,
      pendingExtensionEdit: createPendingEdit({
        originalText: "Wa",
        replacementText: "Was",
        cursorBefore: 2,
        cursorAfter: 3,
        postEditFingerprint: { fullText: "Was", cursorOffset: 3, selectionCollapsed: true },
        awaitingHostInputEcho: true,
      }),
    });

    let consumed = false;
    const keyboardEvent = new window.KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
      cancelable: true,
    });

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
    const service = createTextEditService();

    const editable = createEditor("Was");
    setCaretAtTextOffset(editable, 3);

    const entry = createSuggestionEntry({
      elem: editable,
      missingTrailingSpace: true,
      expectedCursorPos: 3,
      expectedCursorPosIsBlockLocal: true,
      expectedCursorPosBlockElement: editable,
      expectedCursorPosBlockText: "Was",
      suppressNextSuggestionInputPrediction: true,
      pendingExtensionEdit: createPendingEdit({
        originalText: "Wa",
        replacementText: "Was",
        cursorBefore: 2,
        cursorAfter: 3,
        postEditFingerprint: { fullText: "", cursorOffset: 3, selectionCollapsed: true },
        awaitingHostInputEcho: true,
        blockScoped: true,
        blockElement: editable,
        postEditBlockText: "Was",
      }),
    });

    let consumed = false;
    const keyboardEvent = new window.KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
      cancelable: true,
    });

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

  test.each([false, true])(
    "delayed spacing preserves the typed key when ProseMirror refuses (bridge available: %s)",
    (available) => {
      const editable = createEditor("<p><strong>cat</strong></p>");
      editable.className = "ProseMirror";
      setCaretAtTextOffset(editable, 3);
      const block = editable.querySelector("p")!;
      const service = createTextEditService({
        hostEditorAdapterResolver: new HostEditorAdapterResolver({
          getBlockContextAtSelection: () =>
            available ? { beforeCursor: "cat", afterCursor: "", blockText: "cat" } : null,
          applyBlockReplacement: () => ({ applied: false, didDispatchInput: false }),
        }),
      });
      const entry = createSuggestionEntry({
        elem: editable,
        missingTrailingSpace: true,
        expectedCursorPos: 3,
        expectedCursorPosIsBlockLocal: true,
        expectedCursorPosBlockElement: block,
        expectedCursorPosBlockText: "cat",
      });
      const keyboard = new window.KeyboardEvent("keydown", { key: "x", cancelable: true });
      service.handleMissingSpaceAfterAccept(entry, keyboard, (event) => event.preventDefault());

      expect(keyboard.defaultPrevented).toBe(false);
      expect(editable.innerHTML).toBe("<p><strong>cat</strong></p>");
      expect(entry.missingTrailingSpace).toBe(false);
      expect(window.getSelection()?.anchorOffset).toBe(3);
    },
  );

  test("uses the host editor path for delayed post-accept spacing in host-owned contenteditables", () => {
    const hostModel = createHostModelEditable("What is the best", 16);
    const service = createTextEditService();
    const entry = createSuggestionEntry({
      elem: hostModel.editable,
      missingTrailingSpace: true,
      expectedCursorPos: 16,
      expectedCursorPosIsBlockLocal: true,
      expectedCursorPosBlockElement: hostModel.editable,
      expectedCursorPosBlockText: "What is the best",
    });

    let consumed = false;
    const keyboardEvent = new window.KeyboardEvent("keydown", {
      key: "s",
      bubbles: true,
      cancelable: true,
    });

    service.handleMissingSpaceAfterAccept(entry, keyboardEvent, () => {
      consumed = true;
      keyboardEvent.preventDefault();
    });

    expect(consumed).toBe(true);
    expect(hostModel.controller.replaceRangeCalls).toBe(1);
    expect(hostModel.editable.textContent).toBe("What is the best s");
    expect(entry.missingTrailingSpace).toBe(false);
  });

  test("clears delayed post-accept space state when caret moves to a different paragraph at the same local offset", () => {
    const service = createTextEditService();

    const editable = createEditor("<p>Alpha bes</p><p>Gamma line</p>");

    const firstParagraph = editable.querySelectorAll("p")[0] as HTMLElement;
    const secondParagraph = editable.querySelectorAll("p")[1] as HTMLElement;
    setCaret(firstParagraph.firstChild!);

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

    setCaret(secondParagraph.firstChild!);

    let consumed = false;
    const keyboardEvent = new window.KeyboardEvent("keydown", {
      key: "x",
      bubbles: true,
      cancelable: true,
    });

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
    const service = createTextEditService();

    const editable = createEditor("<p>Alpha bes</p><p>Gamma line</p>");

    const firstParagraph = editable.querySelectorAll("p")[0] as HTMLElement;
    const secondParagraph = editable.querySelectorAll("p")[1] as HTMLElement;
    setCaret(firstParagraph.firstChild!);

    const entry = createSuggestionEntry({
      elem: editable,
      latestMentionText: "bes",
      latestMentionStart: -1,
    });

    service.acceptSuggestion(entry, "best");
    expect(firstParagraph.textContent).toBe("Alpha best");
    expect(entry.pendingExtensionEdit?.blockScoped).toBe(true);

    setCaret(secondParagraph.firstChild!);

    let consumed = false;
    const keyboardEvent = new window.KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    const handled = service.tryUndoLastExtensionEdit(entry, keyboardEvent, {
      consumeEvent: () => {
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
    const service = createTextEditService({
      contentEditableAdapter: new EmptyBlockContextContentEditableAdapter(),
    });

    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.textContent = "first second third";
    document.body.appendChild(editable);
    setCaretAtTextOffset(editable, "first second ".length);

    const entry = createSuggestionEntry({
      elem: editable,
      latestMentionText: "first",
      latestMentionStart: 0,
    });

    const accepted = service.acceptSuggestion(entry, "FIRST");

    expect(accepted).toBeNull();
    expect(editable.textContent).toBe("first second third");
  });

  test("leaves native suggestion Undo to the browser", () => {
    const service = createTextEditService();

    const input = document.createElement("input");
    document.body.append(input);
    input.value = "h";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    const entry = createSuggestionEntry({
      elem: input,
      latestMentionText: "h",
      latestMentionStart: 0,
    });

    service.acceptSuggestion(entry, "hi ");
    if (entry.pendingExtensionEdit) {
      entry.pendingExtensionEdit.personalizationEventId = "accept-fixed";
    }
    expect(input.value).toBe("hi ");

    const keyboardEvent = new window.KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    const consumeEvent = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    const onSuccessfulUndo = jest.fn();

    const handled = service.tryUndoLastExtensionEdit(entry, keyboardEvent, {
      consumeEvent,
      clearSuggestions: () => undefined,
      onSuccessfulUndo,
    });

    expect(handled).toBe(false);
    expect(keyboardEvent.defaultPrevented).toBe(false);
    expect(input.value).toBe("hi ");
    expect(input.selectionStart).toBe(3);
    expect(entry.pendingExtensionEdit).toBeNull();
    expect(entry.manualAutoFixSuppression).toBeNull();
    expect(onSuccessfulUndo).not.toHaveBeenCalled();
  });

  test("leaves native grammar Undo to the browser", () => {
    const service = createTextEditService();

    const input = document.createElement("input");
    document.body.append(input);
    input.value = "teh ";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    const entry = createSuggestionEntry({ elem: input });

    service.applyGrammarEdit(entry, {
      replacement: "the ",
      deleteBackwards: 4,
      deleteForwards: 0,
    });
    expect(input.value).toBe("the ");

    const keyboardEvent = new window.KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    const handled = service.tryUndoLastExtensionEdit(entry, keyboardEvent, {
      consumeEvent: () => undefined,
      clearSuggestions: () => undefined,
    });

    expect(handled).toBe(false);
    expect(input.value).toBe("the ");
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
    const service = createTextEditService();

    const input = document.createElement("input");
    document.body.append(input);
    input.value = "alot";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    const entry = createSuggestionEntry({ elem: input });

    service.applyGrammarEdit(entry, {
      replacement: "a lot",
      deleteBackwards: 4,
      deleteForwards: 0,
      sourceRuleId: "englishAlotCorrection",
    });
    expect(input.value).toBe("a lot");

    const keyboardEvent = new window.KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    const reverted = service.tryUndoLastExtensionEdit(entry, keyboardEvent, {
      consumeEvent: () => undefined,
      clearSuggestions: () => undefined,
    });
    expect(reverted).toBe(false);
    // Simulate the browser's historyUndo input. Browser history is tested in E2E.
    input.value = "alot";
    input.setSelectionRange(4, 4);
    input.dispatchEvent(
      new window.InputEvent("input", { inputType: "historyUndo", bubbles: true }),
    );
    expect(input.value).toBe("alot");

    const reapplyResult = service.applyGrammarEdit(entry, {
      replacement: "a lot",
      deleteBackwards: 4,
      deleteForwards: 0,
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
    const service = createTextEditService();

    const input = document.createElement("input");
    document.body.append(input);
    input.value = "alot";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    const entry = createSuggestionEntry({ elem: input });

    service.applyGrammarEdit(entry, {
      replacement: "a lot",
      deleteBackwards: 4,
      deleteForwards: 0,
      sourceRuleId: "englishAlotCorrection",
    });

    const keyboardEvent = new window.KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    service.tryUndoLastExtensionEdit(entry, keyboardEvent, {
      consumeEvent: () => undefined,
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
      replacement: "a lot",
      deleteBackwards: 4,
      deleteForwards: 0,
      sourceRuleId: "englishAlotCorrection",
    });
    expect(applyResult.applied).toBe(true);
    expect(input.value).toBe("a lot x");
  });

  test("does not undo grammar auto-fix after user modifies text", () => {
    const service = createTextEditService();

    const input = document.createElement("input");
    document.body.append(input);
    input.value = "teh ";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    const entry = createSuggestionEntry({ elem: input });

    service.applyGrammarEdit(entry, {
      replacement: "the ",
      deleteBackwards: 4,
      deleteForwards: 0,
    });

    input.value = "the x";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;

    const keyboardEvent = new window.KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    const firstHandled = service.tryUndoLastExtensionEdit(entry, keyboardEvent, {
      consumeEvent: () => undefined,
      clearSuggestions: () => undefined,
    });

    expect(firstHandled).toBe(false);
    expect(input.value).toBe("the x");
    expect(entry.pendingExtensionEdit).toBeNull();

    // A later undo attempt must not resurrect the original typo once the snapshot is invalidated.
    input.value = "the ";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    const secondUndo = new window.KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    const secondHandled = service.tryUndoLastExtensionEdit(entry, secondUndo, {
      consumeEvent: () => undefined,
      clearSuggestions: () => undefined,
    });
    expect(secondHandled).toBe(false);
    expect(input.value).toBe("the ");
  });

  test("does not undo after same-length edit outside the replaced span", () => {
    const service = createTextEditService();

    const input = document.createElement("input");
    document.body.append(input);
    input.value = "abc teh ";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    const entry = createSuggestionEntry({ elem: input });

    service.applyGrammarEdit(entry, {
      replacement: "the ",
      deleteBackwards: 4,
      deleteForwards: 0,
    });
    expect(input.value).toBe("abc the ");

    input.value = "Abc the ";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;

    const keyboardEvent = new window.KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    const handled = service.tryUndoLastExtensionEdit(entry, keyboardEvent, {
      consumeEvent: () => undefined,
      clearSuggestions: () => undefined,
    });

    expect(handled).toBe(false);
    expect(input.value).toBe("Abc the ");
    expect(entry.pendingExtensionEdit).toBeNull();
  });

  test("clears pending undo when caret no longer matches post-edit cursor", () => {
    const service = createTextEditService();

    const input = document.createElement("input");
    document.body.append(input);
    input.value = "teh ";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    const entry = createSuggestionEntry({ elem: input });

    service.applyGrammarEdit(entry, {
      replacement: "the ",
      deleteBackwards: 4,
      deleteForwards: 0,
    });

    // User moved caret before pressing undo; snapshot must be invalidated.
    input.selectionStart = input.value.length - 1;
    input.selectionEnd = input.value.length - 1;

    const keyboardEvent = new window.KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    const handled = service.tryUndoLastExtensionEdit(entry, keyboardEvent, {
      consumeEvent: () => undefined,
      clearSuggestions: () => undefined,
    });

    expect(handled).toBe(false);
    expect(entry.pendingExtensionEdit).toBeNull();
    expect(input.value).toBe("the ");
  });

  test("clears pending undo when edited text can no longer contain replacement span", () => {
    const service = createTextEditService();

    const input = document.createElement("input");
    document.body.append(input);
    input.value = "teh ";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    const entry = createSuggestionEntry({ elem: input });

    service.applyGrammarEdit(entry, {
      replacement: "the ",
      deleteBackwards: 4,
      deleteForwards: 0,
    });

    // User deleted content; stored replacement span is no longer valid.
    input.value = "t";
    input.selectionStart = 1;
    input.selectionEnd = 1;

    const keyboardEvent = new window.KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    const handled = service.tryUndoLastExtensionEdit(entry, keyboardEvent, {
      consumeEvent: () => undefined,
      clearSuggestions: () => undefined,
    });

    expect(handled).toBe(false);
    expect(entry.pendingExtensionEdit).toBeNull();
    expect(input.value).toBe("t");
  });

  test("routes block-scoped grammar edit through host editor session when available", () => {
    const editable = createEditor("hello world");
    setCaretAtTextOffset(editable, 1);

    const pageBridge = fakePageBridge(editable, "hello world", 1);

    const service = createTextEditService({
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
    expect(pageBridge.calls).toHaveLength(1);
    expect(editable.textContent).toBe("Hello world");
  });

  test("grammar edit via host session sets correct pendingExtensionEdit for undo", () => {
    const editable = createEditor("hello world");
    setCaretAtTextOffset(editable, 1);

    const pageBridge = fakePageBridge(editable, "hello world", 1);

    const service = createTextEditService({
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
    const editable = createEditor("dThe");
    setCaretAtTextOffset(editable, 1);

    const pageBridge = fakePageBridge(editable, "dThe", 0);

    const service = createTextEditService({
      hostEditorAdapterResolver: new HostEditorAdapterResolver(pageBridge),
    });
    const entry = createSuggestionEntry({ elem: editable });

    const result = service.applyGrammarEdit(
      entry,
      {
        replacement: "D",
        deleteBackwards: 1,
        deleteForwards: 0,
        sourceRuleId: "capitalizeSentenceStart",
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
    expect(pageBridge.calls).toHaveLength(1);
    expect(editable.textContent).toBe("DThe");
  });

  test("FT-INV-5 refuses grammar edits while host model and DOM disagree", () => {
    const editable = createEditor("dThe");
    setCaretAtTextOffset(editable, 1);

    // The host reports stale state: "The" instead of the DOM's "dThe".
    const pageBridge = fakePageBridge(editable, "The", 0);

    const service = createTextEditService({
      hostEditorAdapterResolver: new HostEditorAdapterResolver(pageBridge),
    });
    const entry = createSuggestionEntry({ elem: editable });

    const result = service.applyGrammarEdit(
      entry,
      {
        replacement: "D",
        deleteBackwards: 1,
        deleteForwards: 0,
        sourceRuleId: "capitalizeSentenceStart",
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

    expect(result.applied).toBe(false);
    expect(pageBridge.calls).toHaveLength(0);
    expect(editable.textContent).toBe("dThe");
    expect(pageBridge.blockText).toBe("The");
  });

  test("falls back to replaceTextByOffsets for grammar edit when host session is not available", () => {
    const service = createTextEditService();

    const editable = createEditor("teh ");
    setCaretAtTextOffset(editable, 4);
    const entry = createSuggestionEntry({ elem: editable });

    const result = service.applyGrammarEdit(
      entry,
      {
        replacement: "the ",
        deleteBackwards: 4,
        deleteForwards: 0,
        sourceRuleId: "englishTypoWhitelistCorrection",
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

    expect(result).toEqual({ applied: true, didDispatchInput: false });
    expect(editable.textContent).toBe("the ");
  });

  test("translates BR-separated line offsets to full-block offsets for host grammar edit", () => {
    const editable = createEditor("First line. second line. a");
    setCaretAtTextOffset(editable, 26);
    // The host editor sees the full block text.
    const pageBridge = fakePageBridge(editable, "First line. second line. a", 26);

    const service = createTextEditService({
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
    // The replacement should happen at offset 25 in the full block (not offset 13)
    expect(pageBridge.calls).toMatchObject([
      { replaceStart: 25, replaceEnd: 26, replacementText: "A", cursorAfter: 26 },
    ]);
    expect(editable.textContent).toBe("First line. second line. A");
  });

  test("routes suggestion acceptance through host with full-block offset translation for BR-separated lines", () => {
    // A <br> gives a BR-separated line context. The caret is at the end of "tes".
    const editable = createEditor("First line.<br>tes");
    setCaret(editable.childNodes[2]!);
    // The host editor sees the full block text (no BR separation).
    const pageBridge = fakePageBridge(editable, "First line.tes", 14);

    const service = createTextEditService({
      hostEditorAdapterResolver: new HostEditorAdapterResolver(pageBridge),
    });
    const entry = createSuggestionEntry({
      elem: editable,
      latestMentionText: "tes",
      latestMentionStart: -1,
    });

    const accepted = service.acceptSuggestion(entry, "test ");

    expect(accepted).not.toBeNull();
    expect(pageBridge.calls).toHaveLength(1);
    // The replacement should happen at offset 11 in the full block
    expect(pageBridge.calls[0]?.replaceStart).toBe(11);
    expect((editable.textContent ?? "").replace(/\u00a0/g, " ")).toBe("First line.test ");
  });
});

describe("FT-INV-1 typing transaction anchors", () => {
  test("refuses a stale grammar snapshot even when the original substring repeats", () => {
    const field = document.createElement("textarea");
    document.body.append(field);
    field.value = "Yesterday, teh cat and teh cat.";
    field.setSelectionRange(14, 14);
    const service = createTextEditService();
    const result = service.applyGrammarEdit(
      createSuggestionEntry({ elem: field }),
      { replacement: "the", deleteBackwards: 3, deleteForwards: 0 },
      { snapshot: { beforeCursor: "teh", afterCursor: " cat and teh cat.", cursorOffset: 3 } },
    );
    expect(result.applied).toBe(false);
    expect(field.value).toBe("Yesterday, teh cat and teh cat.");
  });

  test("refuses a focus-time host rewrite and preserves every host character", () => {
    const field = document.createElement("input");
    document.body.append(field);
    field.value = "teh";
    field.setSelectionRange(3, 3);
    field.addEventListener("focus", () => {
      field.value = "host saved a newer draft";
    });
    const service = createTextEditService();
    expect(service.acceptSuggestion(createSuggestionEntry({ elem: field }), "the")).toBeNull();
    expect(field.value).toBe("host saved a newer draft");
  });
});

test("FT-INV-5 deferred beforeinput commits use host undo without a synthetic inverse", async () => {
  const root = createEditor("<p>Wh</p>");
  root.setAttribute("data-lexical-editor", "true");
  const paragraph = root.firstElementChild as HTMLElement;
  setCaretAtTextOffset(root, 2);
  let hostState = "Wh";
  root.addEventListener(
    "beforeinput",
    (event) => {
      event.preventDefault();
      const replacement = (event as InputEvent).data!;
      queueMicrotask(() => {
        hostState = replacement;
        paragraph.textContent = hostState;
        setCaretAtTextOffset(root, hostState.length);
        root.dispatchEvent(new window.InputEvent("input", { bubbles: true }));
      });
    },
    { once: true },
  );
  const entry = createSuggestionEntry({
    elem: root,
    latestMentionText: "Wh",
    latestMentionStart: -1,
  });
  const service = createTextEditService();
  service.acceptSuggestion(entry, "What ");
  expect(root.textContent).toBe("Wh");
  expect(entry.pendingExtensionEdit?.nativeUndo).toBe(true);
  await Promise.resolve();
  expect(root.textContent).toBe("What\u00a0");
  expect(hostState).toBe(root.textContent!);
  const event = new window.KeyboardEvent("keydown", { key: "z", ctrlKey: true, cancelable: true });
  const consumed = service.tryUndoLastExtensionEdit(entry, event, {
    consumeEvent: (value) => value.preventDefault(),
    clearSuggestions: () => undefined,
  });
  expect(consumed).toBe(false);
  expect(event.defaultPrevented).toBe(false);
  expect(root.textContent).toBe(hostState);
  // The host history handles the unconsumed chord and remains the source of truth.
  hostState = "Wh";
  paragraph.textContent = hostState;
  root.dispatchEvent(new window.InputEvent("input", { bubbles: true, inputType: "historyUndo" }));
  expect(root.textContent).toBe(hostState);
});

test("refuses expansion when native editing is unavailable", () => {
  const field = document.createElement("textarea");
  field.value = "brb";
  document.body.append(field);
  field.focus();
  field.setSelectionRange(3, 3);
  const original = document.execCommand;
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    writable: true,
    value: undefined,
  });
  try {
    const service = createTextEditService();
    const entry = createSuggestionEntry({ elem: field });
    expect(service.acceptSuggestion(entry, "be right back")).toBeNull();
    expect(field.value).toBe("brb");
    expect(field.selectionStart).toBe(3);
    expect(entry.pendingExtensionEdit).toBeNull();
  } finally {
    document.execCommand = original;
  }
});

test.each(["input", "textarea"])("refuses capitalization without a native writer in %s", (tag) => {
  const field = document.createElement(tag) as HTMLInputElement | HTMLTextAreaElement;
  field.value = "hello";
  document.body.append(field);
  field.focus();
  field.setSelectionRange(1, 1);
  const original = document.execCommand;
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    writable: true,
    value: undefined,
  });
  try {
    const service = createTextEditService();
    const result = service.applyGrammarEdit(createSuggestionEntry({ elem: field }), {
      replacement: "H",
      deleteBackwards: 1,
      deleteForwards: 0,
      sourceRuleId: "capitalizeSentenceStart",
    });
    expect(result.applied).toBe(false);
    expect(field.value).toBe("hello");
    expect(field.selectionStart).toBe(1);
  } finally {
    document.execCommand = original;
  }
});
