import { describe, expect, test } from "bun:test";
import {
  HostEditorAdapterResolver,
  type HostEditorSession,
} from "../src/adapters/chrome/content-script/suggestions/HostEditorAdapterResolver";
import type { HostEditorPageBridge } from "../src/adapters/chrome/content-script/suggestions/HostEditorPageBridge";

function setContentEditableCursor(target: HTMLElement, offset: number): void {
  const textNode =
    (target.firstChild as Text | null) ?? target.appendChild(document.createTextNode(""));
  const range = document.createRange();
  range.setStart(textNode, Math.max(0, Math.min(textNode.textContent?.length ?? 0, offset)));
  range.collapse(true);
  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

function createLineEditorHarness({ text, cursor }: { text: string; cursor: number }): {
  editable: HTMLElement;
  session: HostEditorSession | null;
  replaceRangeCalls: number;
} {
  const resolver = new HostEditorAdapterResolver();
  const editable = document.createElement("div");
  editable.setAttribute("contenteditable", "true");
  Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
  editable.textContent = text;
  document.body.appendChild(editable);
  setContentEditableCursor(editable, cursor);

  let line = text;
  let ch = cursor;
  let replaceRangeCalls = 0;
  (editable as HTMLElement & { editorController?: unknown }).editorController = {
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
    getLine(requestedLine: number) {
      return requestedLine === 0 ? line : "";
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
    session: resolver.resolve(editable),
    get replaceRangeCalls() {
      return replaceRangeCalls;
    },
  };
}

function createDeepAncestorLineEditorHarness({
  text,
  cursor,
  ancestorDepth,
}: {
  text: string;
  cursor: number;
  ancestorDepth: number;
}): {
  editable: HTMLElement;
  session: HostEditorSession | null;
} {
  const resolver = new HostEditorAdapterResolver();
  const root = document.createElement("div");
  document.body.appendChild(root);

  let current = root;
  for (let index = 0; index < ancestorDepth; index += 1) {
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
  (root as HTMLElement & { distantController?: unknown }).distantController = {
    replaceRange(
      replacementText: string,
      from: { line: number; ch: number },
      to?: { line: number; ch: number },
    ) {
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
    getLine(requestedLine: number) {
      return requestedLine === 0 ? line : "";
    },
    posFromIndex(index: number) {
      return { line: 0, ch: index };
    },
    indexFromPos(position: { line: number; ch: number }) {
      return position.ch;
    },
  };

  return {
    editable,
    session: resolver.resolve(editable),
  };
}

function createCodeMirrorLikeHarness({ text, cursor }: { text: string; cursor: number }): {
  editable: HTMLElement;
  backing: HTMLTextAreaElement;
  session: HostEditorSession | null;
} {
  const resolver = new HostEditorAdapterResolver();
  const root = document.createElement("div");
  const backing = document.createElement("textarea");
  backing.value = text;
  root.appendChild(backing);

  const codeMirror = document.createElement("div");
  codeMirror.className = "CodeMirror";
  root.appendChild(codeMirror);

  const editable = document.createElement("div");
  editable.setAttribute("contenteditable", "true");
  Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });
  editable.textContent = text;
  codeMirror.appendChild(editable);
  document.body.appendChild(root);
  setContentEditableCursor(editable, cursor);

  let line = text;
  let ch = cursor;
  (codeMirror as HTMLElement & { cmController?: unknown }).cmController = {
    replaceRange(
      replacementText: string,
      from: { line: number; ch: number },
      to?: { line: number; ch: number },
    ) {
      line = `${line.slice(0, from.ch)}${replacementText}${line.slice(to?.ch ?? from.ch)}`;
      editable.textContent = line;
      backing.value = line;
    },
    setCursor(position: { line: number; ch: number }) {
      ch = position.ch;
      setContentEditableCursor(editable, ch);
    },
    getCursor() {
      return { line: 0, ch };
    },
    getLine(requestedLine: number) {
      return requestedLine === 0 ? line : "";
    },
    posFromIndex(index: number) {
      return { line: 0, ch: index };
    },
    indexFromPos(position: { line: number; ch: number }) {
      return position.ch;
    },
  };

  return {
    editable,
    backing,
    session: resolver.resolve(editable),
  };
}

describe("HostEditorAdapterResolver", () => {
  test("returns null for plain contenteditable without a host controller", () => {
    const resolver = new HostEditorAdapterResolver();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    Object.defineProperty(editable, "isContentEditable", { value: true, configurable: true });

    expect(resolver.resolve(editable)).toBeNull();
  });

  test("resolves a host editor session by controller capability, not property name", () => {
    const harness = createLineEditorHarness({ text: "What is the bes", cursor: 15 });

    expect(harness.session).not.toBeNull();
    expect(harness.session?.getBlockContextAtSelection()).toEqual({
      beforeCursor: "What is the bes",
      afterCursor: "",
      blockText: "What is the bes",
    });
  });

  test("resolves a host editor session when the controller lives several ancestors above the editable", () => {
    const harness = createDeepAncestorLineEditorHarness({
      text: "What is the bes",
      cursor: 15,
      ancestorDepth: 7,
    });

    expect(harness.session).not.toBeNull();
    expect(harness.session?.getBlockContextAtSelection()).toEqual({
      beforeCursor: "What is the bes",
      afterCursor: "",
      blockText: "What is the bes",
    });
  });

  test("falls back to the page bridge when the controller is not directly visible in the content-script world", () => {
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
        setContentEditableCursor(editable, args.cursorAfter);
        return { applied: true, didDispatchInput: false };
      },
    };

    const resolver = new HostEditorAdapterResolver(pageBridge);
    const session = resolver.resolve(editable);

    expect(session).not.toBeNull();
    expect(session?.getBlockContextAtSelection()).toEqual({
      beforeCursor: "What is the bes",
      afterCursor: "",
      blockText: "What is the bes",
    });
    expect(
      session?.applyBlockReplacement({
        replaceStart: 12,
        replaceEnd: 15,
        replacementText: "best ",
        cursorAfter: 17,
      }),
    ).toEqual({ applied: true, didDispatchInput: false });
    expect(editable.textContent).toBe("What is the best ");
    expect(session?.createPostEditFingerprint()).toEqual({
      fullText: "What is the best ",
      cursorOffset: 17,
      selectionCollapsed: true,
    });
  });

  test("applies replacement and exposes post-edit fingerprint from the host session", () => {
    const harness = createLineEditorHarness({ text: "What is the bes", cursor: 15 });
    const session = harness.session;
    if (!session) {
      throw new Error("Expected host session");
    }

    const result = session.applyBlockReplacement({
      replaceStart: 12,
      replaceEnd: 15,
      replacementText: "best ",
      cursorAfter: 17,
    });

    expect(result).toEqual({ applied: true, didDispatchInput: false });
    expect(harness.replaceRangeCalls).toBe(1);
    expect(harness.editable.textContent).toBe("What is the best ");
    expect(session.getBlockContextAtSelection()).toEqual({
      beforeCursor: "What is the best ",
      afterCursor: "",
      blockText: "What is the best ",
    });
    expect(session.createPostEditFingerprint()).toEqual({
      fullText: "What is the best ",
      cursorOffset: 17,
      selectionCollapsed: true,
    });
  });

  test("syncs the backing text target selection to the host cursor when one is present", () => {
    const harness = createCodeMirrorLikeHarness({ text: "What is the bes", cursor: 15 });
    const session = harness.session;
    if (!session) {
      throw new Error("Expected host session");
    }

    session.applyBlockReplacement({
      replaceStart: 12,
      replaceEnd: 15,
      replacementText: "best ",
      cursorAfter: 17,
    });

    expect(harness.backing.selectionStart).toBe(17);
    expect(harness.backing.selectionEnd).toBe(17);
    expect(session.createPostEditFingerprint()).toEqual({
      fullText: "What is the best ",
      cursorOffset: 17,
      selectionCollapsed: true,
    });
  });
});
