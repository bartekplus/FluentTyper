/**
 * Review and typing writes into the real TinyMCE, CKEditor 4, Froala,
 * Summernote and RoosterJS libraries that the e2e fixtures use (tests/e2e/fixtures/review-editors).
 * Each editor runs in its iframe-less mode on the shared JSDOM document. The
 * polyfills below add only browser features that JSDOM does not have; the
 * editor libraries are not changed.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { TinyMCE } from "tinymce";
import type FroalaEditorClass from "froala-editor";
import {
  HOST_EDITOR_ENABLED_ATTR,
  HOST_EDITOR_ENABLED_EVENT,
} from "../src/adapters/chrome/content-script/suggestions/HostEditorBridgeProtocol";
import { InjectedHostEditorPageBridge } from "../src/adapters/chrome/content-script/suggestions/HostEditorPageBridge";
import { isComposingIn } from "../src/adapters/chrome/content-script/suggestions/HostEditorControllerUtils";
import { reviewTransaction } from "../src/adapters/chrome/content-script/suggestions/ReviewDomEditors";
import { ContentEditableReviewTarget } from "../src/adapters/chrome/content-script/review/ReviewTargets";
import { ContentEditableAdapter } from "../src/adapters/chrome/content-script/suggestions/ContentEditableAdapter";
// Installs the MAIN-world bridge on this document; Review and typing reach it through events.
import "../src/adapters/chrome/content-script/suggestions/HostEditorMainWorldBridge";

// ── Browser features that JSDOM does not implement ──────────────────
const win = window as unknown as Record<string, unknown> & typeof window;
// TinyMCE detects the device type with media queries.
win.matchMedia = (media: string) =>
  ({
    matches: false,
    media,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
  }) as unknown as MediaQueryList;
// Froala reads the cookie domain of the page.
Object.defineProperty(document, "domain", { configurable: true, value: "localhost" });
// Editing hosts: the editors set and read contentEditable and isContentEditable.
Object.defineProperties(window.HTMLElement.prototype, {
  contentEditable: {
    configurable: true,
    get(this: HTMLElement) {
      return this.getAttribute("contenteditable") ?? "inherit";
    },
    set(this: HTMLElement, value: string) {
      if (value === "inherit") this.removeAttribute("contenteditable");
      else this.setAttribute("contenteditable", value);
    },
  },
  isContentEditable: {
    configurable: true,
    get(this: HTMLElement) {
      const host = this.closest("[contenteditable]");
      return !!host && host.getAttribute("contenteditable") !== "false";
    },
  },
});
// TinyMCE measures caret positions.
window.Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
window.Range.prototype.getBoundingClientRect = () => new DOMRect();
// Summernote measures installed fonts on a 2D canvas when it loads.
window.HTMLCanvasElement.prototype.getContext = (() => ({
  clearRect: () => undefined,
  fillText: () => undefined,
  getImageData: () => ({ data: [] }),
})) as unknown as typeof HTMLCanvasElement.prototype.getContext;
// The libraries use browser globals by their bare names (DOMParser, Range, getSelection...).
const globals = globalThis as Record<string, unknown>;
for (const key of Object.getOwnPropertyNames(window)) {
  if (key in globals) continue;
  const value = win[key];
  globals[key] = typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value;
}

// ── The real libraries ──────────────────────────────────────────────
await import("tinymce/tinymce");
const tinymce = win.tinymce as TinyMCE;
// The TinyMCE plugin files register on the bare global `tinymce`.
globals.tinymce = tinymce;
// These parts of TinyMCE have no type declarations; they only register themselves.
for (const part of ["tinymce/icons/default", "tinymce/themes/silver", "tinymce/models/dom"])
  await import(part);
const { default: FroalaEditor } = await import("froala-editor");
const { default: jQuery } = await import("jquery");
await import("summernote/dist/summernote-lite.js");
const Rooster = await import("roosterjs");

interface CKEditor4 {
  editable(): { $: HTMLElement };
  on(event: string, listener: () => void): void;
  resetUndo(): void;
  execCommand(command: string): boolean;
  destroy(): void;
}
interface CKEditor4Global {
  disableAutoInline: boolean;
  config: Record<string, unknown>;
  inline(element: HTMLElement, config: Record<string, unknown>): CKEditor4;
}
// CKEditor 4 ships as a script for a page, not as a module: run it with the
// window as its global scope. Its language and style files are run first, so
// the editor does not load them with <script> tags, which JSDOM does not run.
const ckeditorBase = dirname(Bun.resolveSync("ckeditor4/ckeditor.js", import.meta.dir));
win.CKEDITOR_BASEPATH = `${ckeditorBase}/`;
for (const file of ["ckeditor.js", "lang/en.js", "styles.js"]) {
  const source = readFileSync(`${ckeditorBase}/${file}`, "utf8");
  new Function("window", `with (window) {${source}\n}`)(window);
}
const CKEDITOR = win.CKEDITOR as CKEditor4Global;
CKEDITOR.disableAutoInline = true;
CKEDITOR.config.versionCheck = false;

interface SummernoteElement {
  html(html: string): SummernoteElement;
  summernote(options: Record<string, unknown>): SummernoteElement;
  summernote(command: "undo" | "destroy"): unknown;
}

// ── One mounted editor ──────────────────────────────────────────────
const SEED_HTML = "<p>We saw <b>teh</b> cat.</p>";

interface Mounted {
  editable: HTMLElement;
  /** The host's own undo command, run once. */
  undo(): void;
  /** How many times the host reported a content change. */
  changes(): number;
  destroy(): void;
}

interface EditorCase {
  name: string;
  /** The class of the editable that the writer matches. */
  fingerprint: string;
  mount(): Promise<Mounted>;
}

function seedTarget(): HTMLDivElement {
  const target = document.body.appendChild(document.createElement("div"));
  target.innerHTML = SEED_HTML;
  return target;
}

const EDITORS: EditorCase[] = [
  {
    name: "TinyMCE",
    fingerprint: "mce-content-body",
    async mount() {
      const [editor] = await tinymce.init({
        target: seedTarget(),
        inline: true,
        license_key: "gpl",
        skin: false,
        content_css: false,
        menubar: false,
        toolbar: false,
        statusbar: false,
        promotion: false,
      });
      // As the e2e fixture: the seed content is the first undo level.
      editor.undoManager.clear();
      editor.undoManager.add();
      let changes = 0;
      editor.on("change", () => changes++);
      return {
        editable: editor.getBody(),
        undo: () => void editor.undoManager.undo(),
        changes: () => changes,
        destroy: () => editor.remove(),
      };
    },
  },
  {
    name: "CKEditor 4",
    fingerprint: "cke_editable",
    async mount() {
      const target = seedTarget();
      target.setAttribute("contenteditable", "true");
      const editor = CKEDITOR.inline(target, { customConfig: "" });
      await new Promise<void>((resolve) => editor.on("instanceReady", resolve));
      editor.resetUndo();
      let changes = 0;
      editor.on("change", () => changes++);
      return {
        editable: editor.editable().$,
        undo: () => void editor.execCommand("undo"),
        changes: () => changes,
        destroy: () => editor.destroy(),
      };
    },
  },
  {
    name: "Froala",
    fingerprint: "fr-element",
    async mount() {
      const target = seedTarget();
      let changes = 0;
      const editor = await new Promise<FroalaEditorClass>((resolve) => {
        new FroalaEditor(target, {
          events: {
            initialized(this: FroalaEditorClass) {
              resolve(this);
            },
            contentChanged: () => changes++,
          },
        });
      });
      // As TinyMCE: the seed content is the first undo step.
      editor.undo.saveStep();
      return {
        editable: editor.el as HTMLElement,
        undo: () => editor.undo.run(),
        changes: () => changes,
        destroy: () => void editor.destroy(),
      };
    },
  },
  {
    name: "Summernote",
    fingerprint: "note-editable",
    async mount() {
      const target = seedTarget();
      const $target = jQuery(target) as unknown as SummernoteElement;
      let changes = 0;
      await new Promise<void>((resolve) => {
        $target.html(SEED_HTML).summernote({
          toolbar: [],
          callbacks: { onInit: resolve, onChange: () => changes++ },
        });
      });
      return {
        editable: target.nextElementSibling!.querySelector<HTMLElement>(".note-editable")!,
        undo: () => void $target.summernote("undo"),
        changes: () => changes,
        destroy: () => void $target.summernote("destroy"),
      };
    },
  },
];

/** The Outlook compose body: RoosterJS has no fingerprint of its own. */
function roosterTarget(): HTMLDivElement {
  const target = document.body.appendChild(document.createElement("div"));
  target.setAttribute("contenteditable", "true");
  target.setAttribute("data-ms-editor", "true");
  return target;
}

type RoosterEditor = InstanceType<typeof Rooster.Editor>;
type RoosterWindow = typeof window & { __ROOSTERJS_DEVTOOLS_EDITORS__?: RoosterEditor[] };

const ROOSTER: EditorCase = {
  name: "RoosterJS",
  fingerprint: "",
  async mount() {
    let changes = 0;
    const target = roosterTarget();
    const editor = new Rooster.Editor(target, {
      plugins: [
        {
          getName: () => "TestChanges",
          initialize: () => undefined,
          dispose: () => undefined,
          onPluginEvent(event) {
            if (event.eventType === "contentChanged") changes++;
          },
        },
      ],
      initialModel: Rooster.createModelFromHtml(SEED_HTML),
    });
    return {
      editable: target,
      undo: () => Rooster.undo(editor),
      changes: () => changes,
      destroy: () => editor.dispose(),
    };
  },
};

// ── Helpers ─────────────────────────────────────────────────────────
let mounted: Mounted | null = null;

/** JSDOM focuses only elements with a tab index; a browser focuses every editing host. */
function asBrowserEditable(editable: HTMLElement): HTMLElement {
  if (editable.tabIndex < 0) editable.tabIndex = 0;
  return editable;
}

async function mount(editor: EditorCase): Promise<HTMLElement> {
  mounted = await editor.mount();
  return asBrowserEditable(mounted.editable);
}

function textNodeOf(editable: HTMLElement, text: string): Text {
  const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    if (node.textContent?.includes(text)) return node as Text;
  throw new Error(`No text node holds "${text}"`);
}

/** The caret as a character offset in the editable's text. */
function caretOffset(editable: HTMLElement): number {
  const range = document.getSelection()!.getRangeAt(0);
  const prefix = document.createRange();
  prefix.selectNodeContents(editable);
  prefix.setEnd(range.startContainer, range.startOffset);
  return prefix.toString().length;
}

function putCaretAtEnd(editable: HTMLElement): void {
  const last = textNodeOf(editable, "cat.");
  document.getSelection()!.collapse(last, last.length);
}

/** A Review read, then one "teh" -> "the" edit with that read's text and signature. */
function reviewEdit(target: ContentEditableReviewTarget) {
  const read = target.read();
  if (!read.ok) throw new Error(`unreadable: ${read.reason}`);
  const start = read.text.indexOf("teh");
  return {
    edits: [{ start, end: start + 3, original: "teh", replacement: "the" }],
    before: read.text,
    after: `${read.text.slice(0, start)}the${read.text.slice(start + 3)}`,
    signature: read.signature,
  };
}

/** The typing path: selects "teh" and asks the MAIN-world bridge to replace it. */
function typeReplacement(editable: HTMLElement, before = editable.textContent ?? "") {
  editable.focus();
  const node = textNodeOf(editable, "teh");
  const range = document.createRange();
  range.setStart(node, node.data.indexOf("teh"));
  range.setEnd(node, node.data.indexOf("teh") + 3);
  document.getSelection()!.removeAllRanges();
  document.getSelection()!.addRange(range);
  return new InjectedHostEditorPageBridge(document).applyDomEditor(editable, {
    before,
    prefix: before.slice(0, before.indexOf("teh")),
    selected: "teh",
    replacement: "the",
  });
}

/** CKEditor 4 puts a caret filler of zero-width spaces where its Undo restores the caret. */
const visibleText = (editable: HTMLElement) => (editable.textContent ?? "").replace(/\u200b/g, "");

const boldText = (editable: HTMLElement) =>
  [...editable.querySelectorAll("b, strong")].map((node) => node.textContent);

beforeEach(() => {
  document.documentElement.setAttribute(HOST_EDITOR_ENABLED_ATTR, "true");
  document.dispatchEvent(new Event(HOST_EDITOR_ENABLED_EVENT));
  document.documentElement.removeAttribute(HOST_EDITOR_ENABLED_ATTR);
});

afterEach(() => {
  try {
    mounted?.destroy();
  } catch {
    // The shared JSDOM reset can remove the editor's DOM before its own teardown.
  }
  mounted = null;
});

// ── The tests ───────────────────────────────────────────────────────
describe.each(EDITORS)("$name Review writer (real library)", (editor) => {
  test("finds the host editor from its editable root and refuses a bare fingerprint", async () => {
    const editable = await mount(editor);
    expect(editable.classList.contains(editor.fingerprint)).toBe(true);
    expect(reviewTransaction(editable, "probe")).toBe(true);
    const target = new ContentEditableReviewTarget(editable);
    expect(target.kind).toBe("host-dom");
    expect(target.capabilities).toEqual({ apply: true, bulk: true });

    // The same fingerprint without an editor instance has no writer.
    const bare = asBrowserEditable(document.body.appendChild(document.createElement("div")));
    bare.className = editor.fingerprint;
    bare.setAttribute("contenteditable", "true");
    bare.innerHTML = SEED_HTML;
    expect(reviewTransaction(bare, "probe")).toBe(false);
    const bareTarget = new ContentEditableReviewTarget(bare);
    expect(bareTarget.kind).toBe("model-editor");
    expect(bareTarget.capabilities.apply).toBe(false);
    expect(typeReplacement(bare).applied).toBe(false);
    expect(bare.innerHTML).toBe(SEED_HTML);
  });
});

describe.each([...EDITORS, ROOSTER])("$name Review and typing writer (real library)", (editor) => {
  test("one Review edit keeps the formatting wrapper and the caret", async () => {
    const editable = await mount(editor);
    putCaretAtEnd(editable);
    const caret = caretOffset(editable);
    const target = new ContentEditableReviewTarget(editable);
    const request = reviewEdit(target);

    expect(await target.apply(request)).toEqual({ status: "applied" });
    expect(editable.textContent).toBe("We saw the cat.");
    expect(boldText(editable)).toEqual(["the"]);
    expect(caretOffset(editable)).toBe(caret);
    expect(mounted!.changes()).toBeGreaterThan(0);
  });

  test("a Review batch across two text nodes is one host undo step", async () => {
    const editable = await mount(editor);
    putCaretAtEnd(editable);
    const target = new ContentEditableReviewTarget(editable);
    const read = target.read();
    if (!read.ok) throw new Error(`unreadable: ${read.reason}`);
    const teh = read.text.indexOf("teh");
    const cat = read.text.indexOf("cat");
    expect(
      await target.apply({
        edits: [
          { start: teh, end: teh + 3, original: "teh", replacement: "the" },
          { start: cat, end: cat + 3, original: "cat", replacement: "cats" },
        ],
        before: read.text,
        after: read.text.replace("teh", "the").replace("cat", "cats"),
        signature: read.signature,
      }),
    ).toEqual({ status: "applied" });
    expect(editable.textContent).toBe("We saw the cats.");
    expect(boldText(editable)).toEqual(["the"]);

    mounted!.undo();
    expect(visibleText(editable)).toBe("We saw teh cat.");
  });

  test("one host Undo removes only the Review edit, not unrecorded typing before it", async () => {
    const editable = await mount(editor);
    // Typing that the host has not recorded as an undo step yet.
    textNodeOf(editable, "cat.").appendData(" Hi");
    putCaretAtEnd(editable);
    const target = new ContentEditableReviewTarget(editable);
    expect(await target.apply(reviewEdit(target))).toEqual({ status: "applied" });
    expect(editable.textContent).toBe("We saw the cat. Hi");

    mounted!.undo();
    expect(visibleText(editable)).toBe("We saw teh cat. Hi");
    expect(boldText(editable)).toEqual(["teh"]);
    // The typing became its own, earlier step.
    mounted!.undo();
    expect(visibleText(editable)).toBe("We saw teh cat.");
  });

  test("refuses a Review edit and a typing edit when the text changed after the read", async () => {
    const editable = await mount(editor);
    const target = new ContentEditableReviewTarget(editable);
    const request = reviewEdit(target);
    const typingBefore = editable.textContent ?? "";
    // The host changes its DOM model after the read.
    const cat = textNodeOf(editable, "cat.");
    cat.replaceData(cat.data.indexOf("cat"), 3, "dog");

    expect(await target.apply(request)).toEqual({ status: "stale" });
    expect(typeReplacement(editable, typingBefore).applied).toBe(false);
    expect(editable.textContent).toBe("We saw teh dog.");
  });

  test("refuses Review and typing edits during an IME composition, then writes after it", async () => {
    const editable = await mount(editor);
    putCaretAtEnd(editable);
    const target = new ContentEditableReviewTarget(editable);
    const request = reviewEdit(target);

    editable.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    // As ReviewController: a composition can run already when Review opens.
    target.composing = isComposingIn(editable);
    expect(await target.apply(request)).toEqual({ status: "rejected", reason: "composing" });
    expect(typeReplacement(editable).applied).toBe(false);
    expect(editable.textContent).toBe("We saw teh cat.");

    editable.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    target.composing = isComposingIn(editable);
    expect(typeReplacement(editable)).toEqual({ applied: true, didDispatchInput: false });
    expect(editable.textContent).toBe("We saw the cat.");
    expect(boldText(editable)).toEqual(["the"]);
    // The typing write is one host undo step too.
    mounted!.undo();
    expect(visibleText(editable)).toBe("We saw teh cat.");
  });
});

describe("RoosterJS writer (Outlook on the web)", () => {
  const editors = () => (window as RoosterWindow).__ROOSTERJS_DEVTOOLS_EDITORS__;
  const editorOf = (editable: HTMLElement) =>
    editors()!.find((editor) => editor.getDOMHelper().isNodeInEditor(editable))!;

  /** The generic typing path of FluentTyper: the adapter, not the bridge. */
  function typeThroughAdapter(editable: HTMLElement) {
    editable.focus();
    const start = (editable.textContent ?? "").indexOf("teh");
    return new ContentEditableAdapter().replaceTextByOffsets(
      editable,
      start,
      start + 3,
      "the",
      start + 3,
    );
  }

  test("finds the editor in the developer tools list; only an identified editor loses the generic write", async () => {
    const editable = await mount(ROOSTER);
    expect(editors()).toContain(editorOf(editable));
    expect(reviewTransaction(editable, "probe")).toBe(true);
    expect(new ContentEditableReviewTarget(editable).kind).toBe("host-dom");

    // Without the list (roosterjs before 9.59), Rooster's DOM index still identifies it.
    const list = editors();
    (window as RoosterWindow).__ROOSTERJS_DEVTOOLS_EDITORS__ = undefined;
    try {
      expect(reviewTransaction(editable, "probe")).toBe(false);
      expect(reviewTransaction(editable, "identify")).toBe(true);
      const target = new ContentEditableReviewTarget(editable);
      expect(target.kind).toBe("model-editor");
      expect(target.capabilities.apply).toBe(false);
      expect(typeThroughAdapter(editable).appliedBy).toBe("refused");
      expect(editable.textContent).toBe("We saw teh cat.");
    } finally {
      (window as RoosterWindow).__ROOSTERJS_DEVTOOLS_EDITORS__ = list;
    }

    // The same markup without RoosterJS (another page, or Microsoft Editor) keeps the generic path.
    const plain = asBrowserEditable(roosterTarget());
    plain.innerHTML = SEED_HTML;
    expect(reviewTransaction(plain, "identify")).toBe(false);
    const plainTarget = new ContentEditableReviewTarget(plain);
    expect(plainTarget.kind).toBe("contenteditable");
    expect(plainTarget.capabilities.apply).toBe(true);
    expect(typeThroughAdapter(plain).appliedBy).toBe("fallback-dom");
    expect(plain.textContent).toBe("We saw the cat.");
  });

  test("an edit after a Rooster snapshot (a click) is one Undo step, and Redo restores it", async () => {
    const editable = await mount(ROOSTER);
    const editor = editorOf(editable);
    // Rooster takes this snapshot on a mouse click; then it sees no new content.
    editor.takeSnapshot();
    expect(typeReplacement(editable)).toEqual({ applied: true, didDispatchInput: false });
    expect(editable.textContent).toBe("We saw the cat.");
    Rooster.undo(editor);
    expect(editable.textContent).toBe("We saw teh cat.");
    Rooster.redo(editor);
    expect(editable.textContent).toBe("We saw the cat.");
    expect(boldText(editable)).toEqual(["the"]);
  });

  test("refuses Review and typing edits while Rooster reports an IME composition", async () => {
    const editable = await mount(ROOSTER);
    putCaretAtEnd(editable);
    const target = new ContentEditableReviewTarget(editable);
    const request = reviewEdit(target);
    // Outlook's editor has isInIME(); no DOM composition event reached the bridge.
    const editor = editorOf(editable) as RoosterEditor & { isInIME?: () => boolean };
    editor.isInIME = () => true;

    expect(await target.apply(request)).toEqual({ status: "rejected", reason: "unsupported" });
    expect(typeReplacement(editable).applied).toBe(false);
    expect(editable.textContent).toBe("We saw teh cat.");

    editor.isInIME = () => false;
    expect(typeReplacement(editable).applied).toBe(true);
    expect(editable.textContent).toBe("We saw the cat.");
  });
});
