/**
 * Undo integration for editors whose document model is the DOM: TinyMCE,
 * CKEditor 4, Froala and Summernote. Runs in the MAIN world, where the editor
 * instances are visible. Review writes these editors with its own verified
 * native edits; `begin` and `end` enclose them in one host undo step. A caller
 * that ran `begin` always runs `end`.
 */
export type ReviewTransactionPhase = "probe" | "begin" | "end";

interface Transaction {
  /** Records pending typing as its own undo step, so the edit does not merge into it. */
  begin(): void;
  /** Records the edit as one undo step and tells the editor that its content changed. */
  end(): void;
}

/** The element's window and its parent: a classic editor edits in a same-origin iframe. */
function editorWindows(elem: HTMLElement): Window[] {
  const win = elem.ownerDocument.defaultView;
  if (!win) return [];
  const windows: Window[] = [win];
  try {
    if (win.parent !== win && win.parent.document) windows.push(win.parent);
  } catch {
    // A cross-origin parent cannot own this editor.
  }
  return windows;
}

export interface TinyMCEEditor {
  getBody(): HTMLElement;
  mode?: { isReadOnly?(): boolean };
  undoManager: { transact(callback: () => void): void; add(): unknown };
  nodeChanged(): void;
}

export function findTinyMCE(elem: HTMLElement): TinyMCEEditor | null {
  type TinyWindow = Window & { tinymce?: { get?(): TinyMCEEditor[] } };
  return (
    editorWindows(elem)
      .flatMap((view) => (view as TinyWindow).tinymce?.get?.() ?? [])
      .find((candidate) => candidate.getBody() === elem) ?? null
  );
}

function tinymce(elem: HTMLElement): Transaction | null {
  const editor = findTinyMCE(elem);
  if (!editor || editor.mode?.isReadOnly?.()) return null;
  return {
    // add() records a level only when the content differs from the last one.
    begin: () => editor.undoManager.add(),
    end() {
      editor.undoManager.add();
      editor.nodeChanged();
    },
  };
}

function ckeditor4(elem: HTMLElement): Transaction | null {
  interface Editor {
    readOnly: boolean;
    mode: string;
    editable(): { $: HTMLElement } | null;
    fire(event: string): unknown;
  }
  type CKWindow = Window & { CKEDITOR?: { instances?: Record<string, Editor> } };
  const editor = editorWindows(elem)
    .flatMap((view) => Object.values((view as CKWindow).CKEDITOR?.instances ?? {}))
    .find((candidate) => candidate.editable?.()?.$ === elem);
  if (!editor || editor.readOnly || editor.mode !== "wysiwyg") return null;
  // A snapshot records a step only when the content changed; it fires "change".
  return { begin: () => editor.fire("saveSnapshot"), end: () => editor.fire("saveSnapshot") };
}

function froala(elem: HTMLElement): Transaction | null {
  interface Editor {
    el: HTMLElement;
    edit?: { isDisabled?(): boolean };
    undo: { saveStep(): void };
    /** Froala's own flag: saveStep() does nothing while it is set. */
    undoing?: boolean;
    events: { trigger(name: string): unknown };
  }
  const box = elem.closest(".fr-box") as (Element & { "data-froala.editor"?: Editor }) | null;
  const editor = box?.["data-froala.editor"];
  if (editor?.el !== elem || editor.edit?.isDisabled?.()) return null;
  return {
    // Froala saves a step on each input event; a batch of native edits is one step.
    begin() {
      editor.undo.saveStep();
      editor.undoing = true;
    },
    end() {
      editor.undoing = false;
      editor.undo.saveStep();
      editor.events.trigger("contentChanged");
    },
  };
}

function summernote(elem: HTMLElement): Transaction | null {
  interface Editor {
    $editable: ArrayLike<HTMLElement> & { html(): string };
    history: { stack: { contents: string }[]; stackOffset: number; recordUndo(): void };
    afterCommand(): void;
  }
  interface Context {
    isDisabled?(): boolean;
    modules?: { editor?: Editor };
  }
  // The context is jQuery data of the original element, which sits before the editor.
  const origin = elem.closest(".note-editor")?.previousElementSibling as
    (Element & Record<string, { summernote?: Context } | undefined>) | null;
  const key =
    origin &&
    Object.keys(origin).find((name) => /^jQuery\d+$/.test(name) && origin[name]?.summernote);
  const context = key ? origin[key]?.summernote : undefined;
  const editor = context?.modules?.editor;
  if (!editor || editor.$editable[0] !== elem || context.isDisabled?.()) return null;
  const unrecorded = () =>
    editor.history.stack[editor.history.stackOffset]?.contents !== editor.$editable.html();
  return {
    begin() {
      if (unrecorded()) editor.history.recordUndo();
    },
    end() {
      // Normalizes the text nodes, records the step and fires "change".
      if (unrecorded()) editor.afterCommand();
    },
  };
}

/** Editable elements of the DOM-model editors that have Review undo integration. */
export const REVIEW_DOM_EDITORS: [
  selector: string,
  find: (elem: HTMLElement) => Transaction | null,
][] = [
  [".mce-content-body", tinymce],
  [".cke_editable", ckeditor4],
  [".fr-element", froala],
  [".note-editable", summernote],
];

/** True when the editor exists and accepts writes, and the phase ran. */
export function reviewTransaction(elem: HTMLElement, phase: ReviewTransactionPhase): boolean {
  try {
    const find = REVIEW_DOM_EDITORS.find(([selector]) => elem.matches(selector))?.[1];
    const transaction = find?.(elem);
    if (!transaction) return false;
    if (phase === "begin") transaction.begin();
    else if (phase === "end") transaction.end();
    return true;
  } catch {
    return false;
  }
}
