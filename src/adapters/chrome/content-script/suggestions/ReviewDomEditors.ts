import { isComposingIn } from "./HostEditorControllerUtils";

/**
 * Undo integration for editors whose document model is the DOM: TinyMCE,
 * CKEditor 4, Froala, Summernote and RoosterJS. Runs in the MAIN world, where
 * the editor instances are visible. Review writes these editors with its own
 * verified native edits; `begin` and `end` enclose them in one host undo step.
 * A caller that ran `begin` always runs `end`.
 * "identify" is true when the element belongs to an editor of this list, also
 * when no writable instance is found: then the element gets no generic write.
 */
export type ReviewTransactionPhase = "probe" | "begin" | "end" | "identify";

interface Transaction {
  /** Records pending typing as its own undo step, so the edit does not merge into it. False refuses the edit. */
  begin(): boolean | void;
  /** Records the edit as one undo step and tells the editor that its content changed. False: Undo cannot revert it. */
  end(): boolean | void;
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

interface TinyMCEEditor {
  getBody(): HTMLElement;
  mode?: { isReadOnly?(): boolean };
  undoManager: { transact(callback: () => void): void; add(): unknown };
  nodeChanged(): void;
}

function findTinyMCE(elem: HTMLElement): TinyMCEEditor | null {
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
    begin: () => void editor.undoManager.add(),
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
  return {
    begin: () => void editor.fire("saveSnapshot"),
    end: () => void editor.fire("saveSnapshot"),
  };
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

interface RoosterEditor {
  isDisposed(): boolean;
  getDOMHelper(): { isNodeInEditor(node: Node, excludingRoot?: boolean): boolean };
  hasFocus(): boolean;
  isInShadowEdit(): boolean;
  /** Outlook's editor has it; the open-source 9.x editor keeps the state in its core. */
  isInIME?(): boolean;
  core?: { domEvent?: { isInIME?: boolean } } | null;
  getDOMSelection(): { type: string } | null;
  takeSnapshot(): unknown;
  triggerEvent(type: "contentChanged", data: { source: string }): unknown;
  getSnapshotsManager(): { canMove(step: number): boolean };
}

/**
 * The RoosterJS editor whose content div is `elem`. roosterjs 9.59 and later add
 * each editor to this list for developer tools. It is the only handle: the
 * editor puts no reference on its DOM.
 */
function findRooster(elem: HTMLElement): RoosterEditor | null {
  type RoosterWindow = Window & { __ROOSTERJS_DEVTOOLS_EDITORS__?: unknown };
  const editors = (elem.ownerDocument.defaultView as RoosterWindow | null)
    ?.__ROOSTERJS_DEVTOOLS_EDITORS__;
  if (!Array.isArray(editors)) return null;
  return (
    (editors as RoosterEditor[]).find((editor) => {
      if (editor.isDisposed()) return false;
      const helper = editor.getDOMHelper();
      return helper.isNodeInEditor(elem) && !helper.isNodeInEditor(elem, true);
    }) ?? null
  );
}

/**
 * A RoosterJS content div also without the list: Rooster's DOM index marks the
 * text nodes that it rendered from its model.
 * ponytail: reads the first 50 text nodes; text typed into an empty editor has no mark yet.
 */
function isRooster(elem: HTMLElement): boolean {
  if (findRooster(elem)) return true;
  const walker = elem.ownerDocument.createTreeWalker(elem, NodeFilter.SHOW_TEXT);
  for (let count = 0, node = walker.nextNode(); node && count < 50; count++) {
    if (Object.hasOwn(node, "__roosterjsContentModel")) return true;
    node = walker.nextNode();
  }
  return false;
}

function rooster(elem: HTMLElement): Transaction | null {
  const editor = findRooster(elem);
  if (!editor) return null;
  return {
    // Rooster's undo restores HTML snapshots and takes one only for its own
    // input. Its find-and-replace uses the same steps.
    begin() {
      if (
        editor.isDisposed() ||
        !editor.hasFocus() ||
        editor.isInShadowEdit() ||
        (editor.isInIME?.() ?? editor.core?.domEvent?.isInIME) ||
        isComposingIn(elem) ||
        editor.getDOMSelection()?.type !== "range"
      )
        return false;
      editor.takeSnapshot();
    },
    end() {
      if (editor.isDisposed()) return false;
      editor.takeSnapshot();
      editor.triggerEvent("contentChanged", { source: "Replace" });
      return editor.getSnapshotsManager().canMove(-1);
    },
  };
}

/** Editable elements of the DOM-model editors that have Review undo integration. */
export const REVIEW_DOM_EDITORS: [
  selector: string,
  find: (elem: HTMLElement) => Transaction | null,
  /** Without it, the selector identifies the editor. */
  identify?: (elem: HTMLElement) => boolean,
][] = [
  [".mce-content-body", tinymce],
  [".cke_editable", ckeditor4],
  [".fr-element", froala],
  [".note-editable", summernote],
  // Outlook on the web marks its compose body so. Other pages can use the
  // attribute too: only an identified RoosterJS editor loses the generic write.
  ['[contenteditable="true"][data-ms-editor="true"]', rooster, isRooster],
];

/** DOM-model editors that FluentTyper writes with a native edit in one host undo step. */
export const DOM_EDITOR_SELECTOR = REVIEW_DOM_EDITORS.map(([selector]) => selector).join(", ");

/** True when the editor exists and accepts writes, and the phase ran and did not refuse. */
export function reviewTransaction(elem: HTMLElement, phase: ReviewTransactionPhase): boolean {
  try {
    const entry = REVIEW_DOM_EDITORS.find(([selector]) => elem.matches(selector));
    if (phase === "identify") return !!entry && (entry[2]?.(elem) ?? true);
    const transaction = entry?.[1](elem);
    if (!transaction) return false;
    if (phase === "begin") return transaction.begin() !== false;
    if (phase === "end") return transaction.end() !== false;
    return true;
  } catch {
    return false;
  }
}
