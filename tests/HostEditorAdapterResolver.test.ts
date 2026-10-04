import { describe, expect, test } from "bun:test";
import {
  HostEditorAdapterResolver,
  type HostEditorSession,
} from "../src/adapters/chrome/content-script/suggestions/HostEditorAdapterResolver";
import type { HostEditorPageBridge } from "../src/adapters/chrome/content-script/suggestions/HostEditorPageBridge";
import { createEditor, setCaretAtTextOffset } from "./codeContextTestUtils";
import {
  createLineEditorController,
  enableHostEditorBridge,
  fakePageBridge,
} from "./suggestionTestUtils";

function createLineEditorHarness({ text, cursor }: { text: string; cursor: number }) {
  enableHostEditorBridge();
  const editable = createEditor(text);
  setCaretAtTextOffset(editable, cursor);
  const controller = createLineEditorController(editable, text, cursor, { withOperation: true });
  Object.assign(editable, { editorController: controller });
  return { editable, controller, session: new HostEditorAdapterResolver().resolve(editable) };
}

function createDeepAncestorLineEditorHarness({
  text,
  cursor,
  ancestorDepth,
}: {
  text: string;
  cursor: number;
  ancestorDepth: number;
}): HostEditorSession | null {
  enableHostEditorBridge();
  const root = document.body.appendChild(document.createElement("div"));
  let parent: HTMLElement = root;
  for (let index = 0; index < ancestorDepth; index += 1) {
    parent = parent.appendChild(document.createElement("div"));
  }
  const editable = parent.appendChild(createEditor(text));
  setCaretAtTextOffset(editable, cursor);
  Object.assign(root, { distantController: createLineEditorController(editable, text, cursor) });
  return new HostEditorAdapterResolver().resolve(editable);
}

function createCodeMirrorLikeHarness({ text, cursor }: { text: string; cursor: number }) {
  enableHostEditorBridge();
  const root = document.body.appendChild(document.createElement("div"));
  const backing = root.appendChild(document.createElement("textarea"));
  backing.value = text;
  const codeMirror = root.appendChild(document.createElement("div"));
  codeMirror.className = "CodeMirror";
  const editable = codeMirror.appendChild(createEditor(text));
  setCaretAtTextOffset(editable, cursor);
  const controller = createLineEditorController(editable, text, cursor, {
    onReplace: (line) => {
      backing.value = line;
    },
  });
  Object.assign(codeMirror, { cmController: controller });
  return { backing, session: new HostEditorAdapterResolver().resolve(editable) };
}

describe("HostEditorAdapterResolver", () => {
  test("returns null for plain contenteditable without a host controller", () => {
    expect(new HostEditorAdapterResolver().resolve(createEditor(""))).toBeNull();
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
    const session = createDeepAncestorLineEditorHarness({
      text: "What is the bes",
      cursor: 15,
      ancestorDepth: 7,
    });

    expect(session).not.toBeNull();
    expect(session?.getBlockContextAtSelection()).toEqual({
      beforeCursor: "What is the bes",
      afterCursor: "",
      blockText: "What is the bes",
    });
  });

  test("falls back to the page bridge when the controller is not directly visible in the content-script world", () => {
    const editable = createEditor("What is the bes");
    setCaretAtTextOffset(editable, 15);
    const pageBridge = fakePageBridge(editable, "What is the bes", 15);

    const session = new HostEditorAdapterResolver(pageBridge).resolve(editable);

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
    const session = harness.session!;

    const result = session.applyBlockReplacement({
      replaceStart: 12,
      replaceEnd: 15,
      replacementText: "best ",
      cursorAfter: 17,
    });

    expect(result).toEqual({ applied: true, didDispatchInput: false });
    expect(harness.controller.replaceRangeCalls).toBe(1);
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
    const session = harness.session!;

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
  test("looks up the backing text target after the page bridge answers", () => {
    const root = document.body.appendChild(document.createElement("div"));
    root.className = "CodeMirror";
    const editable = root.appendChild(createEditor("abc"));
    const backing = document.createElement("textarea");
    backing.value = "backing text";
    const pageBridge: HostEditorPageBridge = {
      getBlockContextAtSelection() {
        // Host code creates the backing textarea while answering.
        root.before(backing);
        return { beforeCursor: "abc", afterCursor: "", blockText: "abc" };
      },
      applyBlockReplacement() {
        return { applied: false, didDispatchInput: false };
      },
    };

    const session = new HostEditorAdapterResolver(pageBridge).resolve(editable);

    expect(session?.createPostEditFingerprint().fullText).toBe("backing text");
  });
});

test("FT-INV-1 a captured line session refuses text changed by an intervening host transaction", () => {
  const harness = createLineEditorHarness({ text: "teh cat", cursor: 3 });
  const old = harness.session!;
  expect(
    old.applyBlockReplacement({
      replaceStart: 0,
      replaceEnd: 3,
      replacementText: "the",
      cursorAfter: 3,
    }),
  ).toMatchObject({ applied: true });
  expect(
    old.applyBlockReplacement({
      replaceStart: 0,
      replaceEnd: 3,
      replacementText: "XXX",
      cursorAfter: 3,
    }),
  ).toMatchObject({ applied: false });
  expect(harness.editable.textContent).toBe("the cat");
  expect(harness.controller.replaceRangeCalls).toBe(1);
});
