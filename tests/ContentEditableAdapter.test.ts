import { beforeEach, describe, expect, test } from "bun:test";
import { ContentEditableAdapter } from "../src/adapters/chrome/content-script/suggestions/ContentEditableAdapter";
import { createEditor, setCaret } from "./codeContextTestUtils";
import { editorCapabilities } from "../src/adapters/chrome/content-script/suggestions/EditorCapabilities";
import {
  HOST_EDITOR_REQUEST_ATTR,
  HOST_EDITOR_REQUEST_EVENT,
} from "../src/adapters/chrome/content-script/suggestions/HostEditorBridgeProtocol";

function ensureNodeFilterApi(): void {
  if (typeof (globalThis as { NodeFilter?: unknown }).NodeFilter !== "undefined") {
    return;
  }
  (globalThis as { NodeFilter: { SHOW_TEXT: number } }).NodeFilter = {
    SHOW_TEXT: 4,
  };
}

const LEXICAL_WRAPPER_HTML =
  '<div><p class="first" dir="auto"><span data-lexical-text="true">Wa</span></p><p class="second" dir="auto"><span data-lexical-text="true">S</span></p></div>';

const blockContextCases: [string, string, (root: HTMLElement) => Node, number, string, string][] = [
  [
    "ignores nested signature br elements",
    'asap<div><span class="gmail_signature_prefix">-- </span><br><div class="gmail_signature">Signature</div></div>',
    (root) => root.firstChild!,
    4,
    "asap",
    "",
  ],
  [
    "resolves to the active line when the caret is at a root boundary",
    "<h1>Quill Rich Text Editor</h1><p>word</p>",
    (root) => root,
    1,
    "",
    "word",
  ],
  [
    "maps a wrapper boundary between paragraphs to the second paragraph (Lexical/Reddit)",
    LEXICAL_WRAPPER_HTML,
    (root) => root.querySelector("div")!,
    1,
    "",
    "S",
  ],
  [
    "stays block-local after the text of the second wrapped paragraph (Lexical/Reddit)",
    LEXICAL_WRAPPER_HTML,
    (root) => root.querySelector("p.second span")!.firstChild!,
    1,
    "S",
    "",
  ],
  [
    "maps a root-level caret before the second sibling block into that block",
    "<p>one</p><p>two</p>",
    (root) => root,
    1,
    "",
    "two",
  ],
  [
    "maps a root-level caret after the last sibling block into that block",
    "<p>one</p><p>two</p>",
    (root) => root,
    2,
    "two",
    "",
  ],
  [
    "uses the innermost block through deeper nested wrappers",
    '<div class="outer"><div class="inner"><p class="target" dir="auto"><span data-lexical-text="true">Deep</span></p></div></div>',
    (root) => root.querySelector("p.target span")!.firstChild!,
    2,
    "De",
    "ep",
  ],
  [
    "uses the leaf block when a root boundary points at a single wrapper child",
    '<div class="wrapper"><div class="first"><span>Wan</span></div><div class="second"><span>t</span></div></div>',
    (root) => root,
    1,
    "t",
    "",
  ],
  [
    "scopes to the current br-separated line inside one paragraph",
    '<p class="target" dir="auto"><span data-lexical-text="true">Wan</span><br><span data-lexical-text="true">t</span></p>',
    (root) => root.querySelectorAll("span")[1]!.firstChild!,
    1,
    "t",
    "",
  ],
  [
    "scopes to the first line before a br separator",
    '<p class="target" dir="auto"><span data-lexical-text="true">Hello</span><br><span data-lexical-text="true">World</span></p>',
    (root) => root.querySelector("span")!.firstChild!,
    3,
    "Hel",
    "lo",
  ],
  [
    "scopes to the middle line across multiple br separators",
    "<p>line1<br>line2<br>line3</p>",
    (root) => root.querySelector("p")!.childNodes[2]!,
    2,
    "li",
    "ne2",
  ],
  [
    "treats a trailing br as an empty line placeholder after text",
    '<p class="target" dir="auto"><span data-lexical-text="true">text</span><br></p>',
    (root) => root.querySelector("span")!.firstChild!,
    4,
    "text",
    "",
  ],
  [
    "returns an empty current line between consecutive br separators",
    "<p>above<br><br>below</p>",
    (root) => root.querySelector("p")!,
    2,
    "",
    "",
  ],
];

const previousBlockTextCases: [string, string, (root: HTMLElement) => Node, string | null][] = [
  [
    "returns previous paragraph text when cursor is in second paragraph",
    "<p>First</p><p>Second</p>",
    (root) => root.querySelectorAll("p")[1]!.firstChild!,
    "First",
  ],
  [
    "skips empty previous blocks",
    "<p>First</p><p></p><p>Third</p>",
    (root) => root.querySelectorAll("p")[2]!.firstChild!,
    "First",
  ],
  [
    "returns null when there is no previous block",
    "<p>Only</p>",
    (root) => root.querySelector("p")!.firstChild!,
    null,
  ],
  [
    "returns null when selection resolves to the root block itself",
    "Only root text",
    (root) => root.firstChild!,
    null,
  ],
  [
    "returns only the trailing line from the previous block",
    "<p>First line\nTrailing line</p><p>Second</p>",
    (root) => root.querySelectorAll("p")[1]!.firstChild!,
    "Trailing line",
  ],
];

describe("ContentEditableAdapter", () => {
  beforeEach(() => {
    ensureNodeFilterApi();
  });

  test("replaces text by offsets without dropping surrounding formatting", () => {
    const adapter = new ContentEditableAdapter();
    const editable = createEditor("<b>rich</b> wrld");
    let inputEventCount = 0;
    editable.addEventListener("input", () => {
      inputEventCount += 1;
    });

    // "rich wrld" => replace "wrld" (offsets 5..9) with "world"
    const result = adapter.replaceTextByOffsets(editable, 5, 9, "world", 10);

    expect(editable.textContent).toBe("rich world");
    expect(editable.querySelector("b")?.textContent).toBe("rich");
    expect(inputEventCount).toBe(1);
    expect(result).toEqual({
      appliedBy: "fallback-dom",
      didMutateDom: true,
      didDispatchInput: false,
      nativeUndo: true,
    });
  });

  test("returns null block context when selection is outside the editable", () => {
    const adapter = new ContentEditableAdapter();
    const editable = createEditor("inside");
    const outside = document.createElement("div");
    outside.textContent = "outside";
    document.body.appendChild(outside);
    window.getSelection()!.setBaseAndExtent(outside.firstChild!, 0, outside.firstChild!, 7);

    const context = adapter.getBlockContext(editable);
    expect(context).toBeNull();
  });

  test("reports stable selection for collapsed caret inside one block", () => {
    const adapter = new ContentEditableAdapter();
    const editable = createEditor("<p>Alpha beta</p>");
    setCaret(editable.querySelector("p")!.firstChild!, 5);

    expect(adapter.hasUnstableSelection(editable)).toBe(false);
  });

  test("reports unstable selection when selection spans blocks", () => {
    const adapter = new ContentEditableAdapter();
    const editable = createEditor("<p>Alpha</p><p>Beta</p>");
    const paragraphs = editable.querySelectorAll("p");
    window
      .getSelection()!
      .setBaseAndExtent(paragraphs[0]!.firstChild!, 1, paragraphs[1]!.firstChild!, 2);

    expect(adapter.hasUnstableSelection(editable)).toBe(true);
  });

  test("dispatches only one semantic replacement event to avoid duplicate inserts", () => {
    const adapter = new ContentEditableAdapter();
    const editable = createEditor("fun");

    const applyFromSelection = (event: Event) => {
      const inputEvent = event as Event & { inputType?: string; data?: string };
      if (inputEvent.inputType !== "insertReplacementText") {
        return;
      }
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        return;
      }
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const textNode = document.createTextNode(inputEvent.data ?? "");
      range.insertNode(textNode);
      setCaret(textNode);
    };

    editable.addEventListener("beforeinput", applyFromSelection);
    editable.addEventListener("input", applyFromSelection);

    const result = adapter.replaceTextByOffsets(editable, 0, 3, "function", 8);

    expect(editable.textContent).toBe("function");
    expect(result.appliedBy).toBe("host-beforeinput");
    expect(result.didDispatchInput).toBe(false);
  });

  test("respects canceled beforeinput and skips fallback DOM mutation", () => {
    const adapter = new ContentEditableAdapter();
    const editable = createEditor("fun");

    editable.addEventListener("beforeinput", (event) => {
      const inputEvent = event as Event & { inputType?: string };
      if (inputEvent.inputType === "insertReplacementText") {
        event.preventDefault();
      }
    });

    let inputEventCount = 0;
    editable.addEventListener("input", () => {
      inputEventCount += 1;
    });

    const result = adapter.replaceTextByOffsets(editable, 0, 3, "function", 8);

    expect(editable.textContent).toBe("fun");
    expect(inputEventCount).toBe(0);
    expect(result).toEqual({
      appliedBy: "host-beforeinput",
      didMutateDom: false,
      didDispatchInput: false,
      nativeUndo: true,
    });
  });

  test("uses host-handled synchronous beforeinput mutation without fallback", () => {
    const adapter = new ContentEditableAdapter();
    const editable = createEditor("fun");

    editable.addEventListener("beforeinput", (event) => {
      const inputEvent = event as Event & { inputType?: string; data?: string };
      if (inputEvent.inputType !== "insertReplacementText") {
        return;
      }

      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        return;
      }
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const replacementNode = document.createTextNode(inputEvent.data ?? "");
      range.insertNode(replacementNode);
      setCaret(replacementNode);
    });

    let inputEventCount = 0;
    editable.addEventListener("input", () => {
      inputEventCount += 1;
    });

    const result = adapter.replaceTextByOffsets(editable, 0, 3, "function", 8);

    expect(editable.textContent).toBe("function");
    expect(inputEventCount).toBe(0);
    expect(result).toEqual({
      appliedBy: "host-beforeinput",
      didMutateDom: true,
      didDispatchInput: false,
      nativeUndo: true,
    });
  });

  test("uses native insertText after an unhandled beforeinput", () => {
    const adapter = new ContentEditableAdapter();
    const editable = createEditor("fun");

    const originalExecCommand = document.execCommand;
    document.execCommand = ((commandId: string, _showUi?: boolean, value?: string) => {
      if (commandId !== "insertText") {
        return false;
      }
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        return false;
      }
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const replacementNode = document.createTextNode(value ?? "");
      range.insertNode(replacementNode);
      setCaret(replacementNode);
      return true;
    }) as typeof document.execCommand;

    try {
      let inputEventCount = 0;
      editable.addEventListener("input", () => {
        inputEventCount += 1;
      });

      const result = adapter.replaceTextByOffsets(editable, 0, 3, "function", 8);

      expect(editable.textContent).toBe("function");
      expect(inputEventCount).toBe(0);
      expect(result).toEqual({
        appliedBy: "fallback-dom",
        didMutateDom: true,
        didDispatchInput: false,
        nativeUndo: true,
      });
    } finally {
      document.execCommand = originalExecCommand;
    }
  });

  test("FT-INV-5 scoped block replacements use native editing without changing a sibling", () => {
    const adapter = new ContentEditableAdapter();
    const editable = createEditor("<pre>hello wrld</pre><pre>later line</pre>");
    const activeBlock = editable.querySelector("pre")!;
    setCaret(activeBlock.firstChild!, 10);

    const originalExecCommand = document.execCommand;
    let execCommandCallCount = 0;
    document.execCommand = ((commandId: string, _showUi?: boolean, value?: string) => {
      if (commandId !== "insertText") {
        return false;
      }
      execCommandCallCount += 1;
      const currentSelection = window.getSelection();
      if (!currentSelection || currentSelection.rangeCount === 0) {
        return false;
      }
      const currentRange = currentSelection.getRangeAt(0);
      currentRange.deleteContents();
      const replacementNode = document.createTextNode(value ?? "");
      currentRange.insertNode(replacementNode);
      return true;
    }) as typeof document.execCommand;

    try {
      const result = adapter.replaceTextByOffsets(editable, 6, 10, "world", 11, {
        scopeRoot: activeBlock,
      });

      expect(execCommandCallCount).toBe(1);
      expect(result).toEqual({
        appliedBy: "fallback-dom",
        didMutateDom: true,
        didDispatchInput: false,
        nativeUndo: true,
      });
      expect(activeBlock.textContent).toBe("hello world");
      expect(editable.querySelectorAll("pre")[1]?.textContent).toBe("later line");
    } finally {
      document.execCommand = originalExecCommand;
    }
  });

  test("maps offset zero to structural boundary before leading empty block text", () => {
    const adapter = new ContentEditableAdapter();
    const editable = createEditor("<p><br></p><p>next</p>");

    const result = adapter.replaceTextByOffsets(editable, 0, 0, "hello", 5);

    const paragraphs = editable.querySelectorAll("p");
    expect(paragraphs.length).toBe(2);
    expect(paragraphs[0]?.textContent ?? "").toContain("hello");
    expect(paragraphs[1]?.textContent ?? "").toBe("next");
    expect(result.didMutateDom).toBe(true);
  });

  test("uses zero-offset boundary fast path without full boundary scan", () => {
    const adapter = new ContentEditableAdapter();
    const editable = createEditor("<p><br></p><p><br></p>");

    const adapterInternals = adapter as unknown as {
      measureBoundaryTextOffset: (
        root: HTMLElement,
        container: Node,
        offset: number,
        probeRange: Range,
      ) => number | null;
    };
    const originalMeasureBoundaryTextOffset =
      adapterInternals.measureBoundaryTextOffset.bind(adapter);
    let boundaryMeasureCallCount = 0;
    adapterInternals.measureBoundaryTextOffset = (
      root: HTMLElement,
      container: Node,
      offset: number,
      probeRange: Range,
    ) => {
      boundaryMeasureCallCount += 1;
      return originalMeasureBoundaryTextOffset(root, container, offset, probeRange);
    };

    try {
      const result = adapter.replaceTextByOffsets(editable, 0, 0, "hello", 5);
      const paragraphs = editable.querySelectorAll("p");

      expect(boundaryMeasureCallCount).toBe(0);
      expect(paragraphs[0]?.textContent ?? "").toContain("hello");
      expect(result.didMutateDom).toBe(true);
    } finally {
      adapterInternals.measureBoundaryTextOffset = originalMeasureBoundaryTextOffset;
    }
  });

  test("keeps insertion anchored at active caret when offset equals paragraph boundary", () => {
    const adapter = new ContentEditableAdapter();
    const editable = createEditor("<p>hello</p><p>next</p>");
    setCaret(editable.querySelectorAll("p")[1]!, 0);

    const result = adapter.replaceTextByOffsets(editable, 5, 5, "X", 6);

    const paragraphs = editable.querySelectorAll("p");
    expect(paragraphs[0]?.textContent).toBe("hello");
    expect(paragraphs[1]?.textContent ?? "").toContain("X");
    expect(result.didMutateDom).toBe(true);
  });

  test("preserves a root boundary insertion before a non-empty block", () => {
    const adapter = new ContentEditableAdapter();
    const editable = createEditor(
      'asap<div><span class="gmail_signature_prefix">-- </span><br><div class="gmail_signature">Pozdrawiam Bartek</div></div>',
    );
    setCaret(editable, 1);

    const result = adapter.replaceTextByOffsets(editable, 0, 4, "As soon as possible\u00A0", 20);

    expect(result.didMutateDom).toBe(true);
    expect(editable.innerHTML).toContain("As soon as possible&nbsp;<div");
    expect(editable.querySelector(".gmail_signature_prefix")?.textContent).toBe("-- ");
  });

  test.each(blockContextCases)(
    "block context: %s",
    (_name, html, locate, offset, beforeCursor, afterCursor) => {
      const editable = createEditor(html);
      setCaret(locate(editable), offset);

      expect(new ContentEditableAdapter().getBlockContext(editable)).toEqual({
        beforeCursor,
        afterCursor,
      });
    },
  );

  test.each(previousBlockTextCases)("previous block text: %s", (_name, html, locate, expected) => {
    const editable = createEditor(html);
    setCaret(locate(editable));

    expect(new ContentEditableAdapter().getPreviousBlockTextBySelection(editable)).toBe(expected);
  });

  test("collects leaf block elements in document order for nested blocks", () => {
    const adapter = new ContentEditableAdapter();
    const editable = createEditor(
      '<div class="wrapper"><div class="inner"><p>A</p><p>B</p></div><p>C</p></div>',
    );

    const leafBlocks = (
      adapter as unknown as {
        collectLeafBlockElements: (root: HTMLElement) => HTMLElement[];
      }
    ).collectLeafBlockElements(editable);

    expect(leafBlocks.map((block) => block.textContent)).toEqual(["A", "B", "C"]);
  });

  test("walking fallback maps ancestor boundary endpoints into resolved block", () => {
    const adapter = new ContentEditableAdapter();
    const editable = createEditor(LEXICAL_WRAPPER_HTML);
    setCaret(editable.querySelector("div")!, 1);

    const originalResolvePointWithinBlock = (
      adapter as unknown as {
        resolvePointWithinBlock: (
          container: Node,
          offset: number,
          block: HTMLElement,
          root: HTMLElement,
        ) => unknown;
      }
    ).resolvePointWithinBlock;

    (
      adapter as unknown as {
        resolvePointWithinBlock: (
          container: Node,
          offset: number,
          block: HTMLElement,
          root: HTMLElement,
        ) => null;
      }
    ).resolvePointWithinBlock = () => null;

    try {
      const context = adapter.getBlockContext(editable);
      expect(context).not.toBeNull();
      expect(context?.beforeCursor).toBe("");
      expect(context?.afterCursor).toBe("S");
    } finally {
      (
        adapter as unknown as {
          resolvePointWithinBlock: typeof originalResolvePointWithinBlock;
        }
      ).resolvePointWithinBlock = originalResolvePointWithinBlock;
    }
  });
});

test("FT-INV-1 focus-time DOM replacement cannot redirect an insertion", () => {
  const root = document.createElement("div");
  root.contentEditable = "true";
  root.tabIndex = 0;
  root.textContent = "teh";
  document.body.append(root);
  root.addEventListener("focus", () =>
    root.replaceChildren(document.createTextNode("new host draft")),
  );
  const result = new ContentEditableAdapter().replaceTextByOffsets(root, 0, 3, "the", 3);
  expect(result.appliedBy).toBe("refused");
  expect(root.textContent).toBe("new host draft");
});

test("FT-INV-5 a refused native contenteditable write never falls through to DOM", () => {
  const editable = createEditor("teh 😀");
  setCaret(editable);
  const original = document.execCommand;
  document.execCommand = () => false;
  try {
    const result = new ContentEditableAdapter().replaceTextByOffsets(editable, 0, 3, "the", 3);
    expect(result.didMutateDom).toBe(false);
    expect(editable.textContent).toBe("teh 😀");
    expect(window.getSelection()!.isCollapsed).toBe(true);
    expect(window.getSelection()!.anchorNode).toBe(editable);
    expect(window.getSelection()!.anchorOffset).toBe(1);
  } finally {
    document.execCommand = original;
  }
});

test("FT-INV-1 beforeinput rerender cannot move a live range to another occurrence", () => {
  const root = createEditor("He go home. He go home.");
  root.addEventListener("beforeinput", () => {
    root.innerHTML = "<span>He go home. He go home.</span>";
  });
  const original = document.execCommand;
  let writes = 0;
  document.execCommand = () => {
    writes++;
    return true;
  };
  try {
    const result = new ContentEditableAdapter().replaceTextByOffsets(root, 15, 17, "goes", 19);
    expect(result.didMutateDom).toBe(false);
    expect(writes).toBe(0);
    expect(root.textContent).toBe("He go home. He go home.");
  } finally {
    document.execCommand = original;
  }
});

for (const event of ["focus", "beforeinput"] as const) {
  test(`FT-INV-1 ${event} redistributing text in existing nodes invalidates offsets`, () => {
    const root = createEditor("<span>Hello </span><span>wrld</span>");
    root.tabIndex = 0;
    const first = root.firstChild!.firstChild as Text;
    const second = root.lastChild!.firstChild as Text;
    root.addEventListener(event, () => {
      first.data = "Hell";
      second.data = "o wrld";
    });
    const original = document.execCommand;
    let writes = 0;
    document.execCommand = () => {
      writes++;
      return true;
    };
    try {
      const result = new ContentEditableAdapter().replaceTextByOffsets(root, 6, 10, "world", 11);
      expect(result.didMutateDom).toBe(false);
      expect(writes).toBe(0);
      expect(root.textContent).toBe("Hello wrld");
    } finally {
      document.execCommand = original;
    }
  });
}

test("refuses a rich-text edit when native editing is unavailable", () => {
  const editor = createEditor("<b>teh</b> <a href='/'>link</a>");
  editor.focus();
  const before = editor.innerHTML;
  const original = document.execCommand;
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    writable: true,
    value: undefined,
  });
  try {
    const result = new ContentEditableAdapter().replaceTextByOffsets(editor, 0, 3, "the", 3);
    expect(result.didMutateDom).toBe(false);
    expect(editor.innerHTML).toBe(before);
  } finally {
    document.execCommand = original;
  }
});

// A typing-path fingerprint permits only an attempt. Without its editor, the write is refused.
for (const fingerprint of [
  ".ProseMirror",
  "[data-slate-editor]",
  "[data-lexical-editor]",
  ".ck-editor__editable",
  "trix-editor",
  ".DraftEditor-root .public-DraftEditor-content",
  ".mce-content-body",
  ".cke_editable",
  ".fr-element",
  ".note-editable",
]) {
  test(`a ${fingerprint} fingerprint without its editor never gets a generic DOM write`, () => {
    const host = createEditor("");
    let editable: HTMLElement = host;
    for (const part of fingerprint.split(" ")) {
      const next = part === "trix-editor" ? document.createElement("trix-editor") : editable;
      if (part.startsWith(".")) next.classList.add(part.slice(1));
      else if (part.startsWith("[")) next.setAttribute(part.slice(1, -1), "true");
      if (next !== editable) editable.append(next);
      editable = next;
      if (part === ".DraftEditor-root") {
        editable.removeAttribute("contenteditable");
        editable = editable.appendChild(document.createElement("div"));
      }
    }
    editable.setAttribute("contenteditable", "true");
    Object.defineProperty(editable, "isContentEditable", { configurable: true, value: true });
    editable.textContent = "teh cat";
    editable.focus();
    setCaret(editable.firstChild!, 3);
    expect(editorCapabilities(editable).displaySuggestions).toBe(true);
    const original = document.execCommand;
    let writes = 0;
    document.execCommand = () => {
      writes++;
      return true;
    };
    try {
      const result = new ContentEditableAdapter().replaceTextByOffsets(editable, 0, 3, "the", 3);
      expect(result).toMatchObject({ appliedBy: "refused", didMutateDom: false });
      expect(writes).toBe(0);
      expect(editable.textContent).toBe("teh cat");
    } finally {
      document.execCommand = original;
    }
  });
}

/** Records the order of focus, the replacement events, native writes and bridge requests. */
function recordWriteSteps(editable: HTMLElement, handleBeforeInput: boolean) {
  const steps: string[] = [];
  const onRequest = (event: Event) => {
    const source = event.composedPath()[0] as HTMLElement;
    steps.push(JSON.parse(source.getAttribute(HOST_EDITOR_REQUEST_ATTR)!).action);
  };
  document.addEventListener(HOST_EDITOR_REQUEST_EVENT, onRequest, true);
  editable.addEventListener("focus", () => steps.push("focus"));
  editable.addEventListener("beforeinput", (event) => {
    steps.push("beforeinput");
    if (!handleBeforeInput) return;
    // Quill 2 applies the replacement to its model and cancels the event.
    window.getSelection()!.getRangeAt(0).deleteContents();
    editable.firstChild!.textContent = "the cat";
    event.preventDefault();
  });
  const original = document.execCommand;
  document.execCommand = ((command: string, _ui?: boolean, value?: string) => {
    steps.push("execCommand");
    const range = window.getSelection()!.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(value ?? ""));
    return command === "insertText";
  }) as typeof document.execCommand;
  return {
    steps,
    restore() {
      document.removeEventListener(HOST_EDITOR_REQUEST_EVENT, onRequest, true);
      document.execCommand = original;
    },
  };
}

// Quill's history merges changes of the last second. Boundaries keep an accepted
// word apart from the typed prefix and from later typing.
for (const [name, handled, expected] of [
  ["Quill 2 takes the beforeinput", true, ["beforeinput", "quillHistoryBoundary"]],
  [
    "Quill 1 ignores the beforeinput",
    false,
    ["beforeinput", "execCommand", "quillHistoryBoundary"],
  ],
] as const) {
  test(`a Quill write is its own undo step when ${name}`, () => {
    const editable = createEditor("teh cat");
    editable.classList.add("ql-editor");
    editable.tabIndex = 0;
    const record = recordWriteSteps(editable, handled);
    try {
      const result = new ContentEditableAdapter().replaceTextByOffsets(editable, 0, 3, "the", 3);
      expect(result.appliedBy).toBe(handled ? "host-beforeinput" : "fallback-dom");
      expect(editable.textContent).toBe("the cat");
      expect(record.steps).toEqual(["quillHistoryBoundary", "focus", ...expected]);
    } finally {
      record.restore();
      editable.remove();
    }
  });
}

test("a contenteditable write outside Quill sends no Quill history boundary", () => {
  const editable = createEditor("teh cat");
  editable.tabIndex = 0;
  const record = recordWriteSteps(editable, false);
  try {
    new ContentEditableAdapter().replaceTextByOffsets(editable, 0, 3, "the", 3);
    expect(editable.textContent).toBe("the cat");
    expect(record.steps).toEqual(["focus", "beforeinput", "execCommand"]);
  } finally {
    record.restore();
    editable.remove();
  }
});
