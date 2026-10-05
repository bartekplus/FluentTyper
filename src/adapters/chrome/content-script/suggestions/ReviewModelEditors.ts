import type { ReviewApplyResult, ReviewTargetText } from "@core/application/review/ReviewSession";
import type { ReviewEdit, TextRange } from "@core/domain/grammar/review/types";
import { applyEdits, positionThroughEdits } from "@core/domain/grammar/review/textRanges";
import {
  buildContentEditableTextMap,
  offsetRangeToDomRange,
  type ContentEditableTextMap,
} from "../review/ContentEditableTextMap";
import { formattingPreservingEdits } from "../review/RichTextFormatting";
import { isHiddenField, isLockedField, isSensitiveField } from "./FieldEligibility";
import { hasOtherFocusedEditor } from "./TextTargetAdapter";
import type { HostEditorReviewApplyRequest } from "./HostEditorBridgeProtocol";

/**
 * Review writes for editors that keep their own document model: Lexical,
 * Draft.js, CKEditor 5 and Trix. Runs in the MAIN world, where the editor
 * instances are visible.
 *
 * Review reads the DOM text map. An adapter proves that each mapped DOM text
 * node holds the same text as its model location, and then writes every edit
 * of a batch as ONE model transaction, so the editor's own undo reverts it.
 */
interface ModelAdapter<Ref> {
  /**
   * The editor instance and its content version, never its selection: the
   * signature must survive the focus and selection changes of opening a card.
   */
  identity: unknown[];
  composing(): boolean;
  /** The model location of `range`, which lies inside one DOM text node, or null. */
  resolve(range: Range, offsets: TextRange): Ref | null;
  /** The model text at `ref`, or null when the model and the DOM differ there. */
  text(ref: Ref): string | null;
  /** Writes all edits, in document order, as one undoable transaction. */
  write(edits: { ref: Ref; edit: ReviewEdit }[]): void;
}
type AdapterFactory = (
  root: HTMLElement,
  map: ContentEditableTextMap,
) => ModelAdapter<never> | null;

// ── Lexical ─────────────────────────────────────────────────────────
// The editor is the root's `__lexicalEditor`; each text node's element holds
// its node key in `__lexicalKey_<editor key>`. Both are what Lexical itself uses.
interface LexicalTextNode {
  getTextContent(): string;
  spliceText(offset: number, deleteCount: number, text: string, moveSelection?: boolean): unknown;
}
interface LexicalState {
  _nodeMap?: Map<string, unknown>;
  read<T>(callback: () => T): T;
}
interface LexicalEditor {
  getKey(): string;
  getRootElement(): HTMLElement | null;
  isEditable(): boolean;
  isComposing(): boolean;
  getEditorState(): LexicalState;
  update(callback: () => void, options: { discrete: boolean; tag: string }): void;
}
interface LexicalRef {
  key: string;
  data: string;
  start: number;
  end: number;
}

const lexical: AdapterFactory = (root) => {
  const editor = (root as HTMLElement & { __lexicalEditor?: LexicalEditor }).__lexicalEditor;
  if (
    typeof editor?.getKey !== "function" ||
    typeof editor.update !== "function" ||
    editor.getRootElement() !== root ||
    !editor.isEditable()
  )
    return null;
  const property = `__lexicalKey_${editor.getKey()}`;
  const textNode = (key: string) => {
    const node = editor.getEditorState()._nodeMap?.get(key) as LexicalTextNode | undefined;
    return typeof node?.spliceText === "function" ? node : null;
  };
  const adapter: ModelAdapter<LexicalRef> = {
    // Each selection change makes a new editor state. The text check and the
    // DOM signature (which Lexical renders from the model) cover the content.
    identity: [editor],
    composing: () => editor.isComposing(),
    resolve(range) {
      for (let element = range.startContainer.parentElement; element && element !== root;) {
        const key = (element as unknown as Record<string, unknown>)[property];
        if (typeof key === "string") {
          const data = (range.startContainer as Text).data;
          return { key, data, start: range.startOffset, end: range.endOffset };
        }
        element = element.parentElement;
      }
      return null;
    },
    text: (ref) =>
      editor
        .getEditorState()
        .read(() =>
          textNode(ref.key)?.getTextContent() === ref.data
            ? ref.data.slice(ref.start, ref.end)
            : null,
        ),
    write(edits) {
      // "history-push" gives the batch its own undo step; discrete commits it now.
      editor.update(
        () => {
          for (const { ref, edit } of [...edits].reverse())
            textNode(ref.key)!.spliceText(ref.start, ref.end - ref.start, edit.replacement, false);
        },
        { discrete: true, tag: "history-push" },
      );
    },
  };
  return adapter as ModelAdapter<never>;
};

// ── Draft.js ────────────────────────────────────────────────────────
// The editor component is found through React's fiber of its contenteditable.
// Its EditorState class and Immutable records come from the page's own objects.
interface DraftList {
  get(index: number): unknown;
  splice(index: number, removed: number, ...values: unknown[]): DraftList;
}
interface DraftBlock {
  getText(): string;
  getCharacterList(): DraftList;
  merge(values: object): DraftBlock;
}
interface DraftContent {
  getBlockForKey(key: string): DraftBlock | undefined;
  getBlockMap(): { set(key: string, block: DraftBlock): unknown };
  merge(values: object): DraftContent;
}
interface DraftSelection {
  getAnchorKey(): string;
  getAnchorOffset(): number;
  getFocusKey(): string;
  getFocusOffset(): number;
  merge(values: object): DraftSelection;
}
interface DraftState {
  getCurrentContent(): DraftContent;
  getSelection(): DraftSelection;
  isInCompositionMode(): boolean;
  constructor: { push(state: DraftState, content: DraftContent, change: string): DraftState };
}
interface DraftComponent {
  editor?: unknown;
  props: { editorState?: DraftState; readOnly?: boolean; onChange?: (state: DraftState) => void };
  update?: (state: DraftState) => void;
}
interface DraftRef {
  key: string;
  data: string;
  /** Block offset of the DOM text node's first character. */
  base: number;
  start: number;
  end: number;
}

function draftComponent(root: HTMLElement): DraftComponent | null {
  const fiberKey = Object.keys(root).find((key) => key.startsWith("__reactFiber$"));
  type Fiber = { stateNode?: unknown; return?: Fiber | null };
  let fiber: Fiber | null | undefined = fiberKey
    ? (root as unknown as Record<string, Fiber>)[fiberKey]
    : null;
  for (let depth = 0; fiber && depth < 20; depth++, fiber = fiber.return) {
    const component = fiber.stateNode as DraftComponent | null | undefined;
    if (
      component?.editor === root &&
      typeof component.props?.onChange === "function" &&
      typeof component.props.editorState?.getCurrentContent === "function"
    )
      return component;
  }
  return null;
}

const draft: AdapterFactory = (root) => {
  const component = draftComponent(root);
  const state = component?.props.editorState;
  if (!component || !state || component.props.readOnly) return null;
  const content = state.getCurrentContent();
  const adapter: ModelAdapter<DraftRef> = {
    // A selection change keeps the ContentState object.
    identity: [component, content],
    composing: () => state.isInCompositionMode(),
    resolve(range) {
      const node = range.startContainer;
      const block = node.parentElement?.closest<HTMLElement>('[data-block="true"]');
      const key = /^(.+)-\d+-\d+$/.exec(block?.dataset.offsetKey ?? "")?.[1];
      if (
        !block ||
        !key ||
        !root.contains(block) ||
        !node.parentElement?.closest('[data-text="true"]')
      )
        return null;
      // The block offset of a text node: the text of the leaves before it.
      let base = 0;
      const walker = root.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      for (let text = walker.nextNode(); text && text !== node; text = walker.nextNode()) {
        if (text.parentElement?.closest('[data-text="true"]')) base += (text as Text).data.length;
      }
      const data = (node as Text).data;
      return { key, data, base, start: range.startOffset, end: range.endOffset };
    },
    text(ref) {
      const text = content.getBlockForKey(ref.key)?.getText();
      return text?.slice(ref.base, ref.base + ref.data.length) === ref.data
        ? ref.data.slice(ref.start, ref.end)
        : null;
    },
    write(edits) {
      let next = content;
      const byBlock = new Map<string, ReviewEdit[]>();
      for (const { ref, edit } of [...edits].reverse()) {
        const block = next.getBlockForKey(ref.key)!;
        const start = ref.base + ref.start;
        const end = ref.base + ref.end;
        const characters = block.getCharacterList();
        // Replaced text keeps the style and entity of its first character; an
        // insertion takes those of the character before it, as typing does.
        const style = characters.get(start < end || start === 0 ? start : start - 1);
        if (style === undefined) throw new Error("No character style to inherit");
        const text = block.getText();
        next = next.merge({
          blockMap: next.getBlockMap().set(
            ref.key,
            block.merge({
              text: text.slice(0, start) + edit.replacement + text.slice(end),
              characterList: characters.splice(
                start,
                end - start,
                ...Array.from(edit.replacement, () => style),
              ),
            }),
          ),
        });
        const blockEdits = byBlock.get(ref.key) ?? [];
        blockEdits.push({ ...edit, start, end });
        byBlock.set(ref.key, blockEdits);
      }
      const selection = state.getSelection();
      const remap = (key: string, offset: number) =>
        positionThroughEdits(offset, byBlock.get(key) ?? []);
      const after = selection.merge({
        anchorOffset: remap(selection.getAnchorKey(), selection.getAnchorOffset()),
        focusOffset: remap(selection.getFocusKey(), selection.getFocusOffset()),
      });
      next = next.merge({ selectionBefore: selection, selectionAfter: after });
      // "insert-fragment" is always its own undo step: it never merges with typing.
      // Not "spellcheck-change": Draft.js leaves its undo to the browser's native undo.
      const pushed = state.constructor.push(state, next, "insert-fragment");
      if (typeof component.update === "function") component.update(pushed);
      else component.props.onChange!(pushed);
    },
  };
  return adapter as ModelAdapter<never>;
};

// ── CKEditor 5 ──────────────────────────────────────────────────────
// Public API only: the editable's `ckeditorInstance`, the DOM converter and
// the mapper translate DOM ranges to model ranges; one model.change is one batch.
interface CKItem {
  data?: string;
  getAttributes?(): Iterable<[string, unknown]>;
}
interface CKPosition {
  textNode?: CKItem | null;
  nodeBefore?: CKItem | null;
}
interface CKRange {
  start: CKPosition;
  isCollapsed: boolean;
  getItems(): Iterable<CKItem>;
}
interface CKWriter {
  remove(range: CKRange): void;
  insertText(text: string, attributes: Record<string, unknown>, position: CKPosition): void;
}
interface CKEditor5 {
  isReadOnly: boolean;
  model: { document: { version: number }; change(callback: (writer: CKWriter) => void): void };
  editing: {
    mapper: { toModelRange(viewRange: unknown): CKRange | null };
    view: {
      document: { isComposing: boolean };
      domConverter: { domRangeToView(range: Range): unknown };
      _observers?: Map<unknown, { flush?: () => void; _mutationObserver?: unknown }>;
    };
  };
}

/**
 * Drains the DOM mutations that CKEditor 5's observer has queued but not yet
 * reconciled into the model (Firefox can lag by one typed character), so the
 * model agrees with the DOM before it is read or written.
 */
export function flushCKEditor5PendingMutations(editor: {
  editing?: { view?: { _observers?: CKEditor5["editing"]["view"]["_observers"] } };
}): void {
  const observers = editor.editing?.view?._observers;
  if (!observers || typeof observers.values !== "function") return;
  for (const observer of observers.values()) {
    if (observer?._mutationObserver && typeof observer.flush === "function") {
      try {
        observer.flush();
      } catch {
        // Best-effort: if flushing throws, proceed without it.
      }
      return;
    }
  }
}

const attributesOf = (item: CKItem | null | undefined) =>
  typeof item?.data === "string" && typeof item.getAttributes === "function"
    ? Object.fromEntries(item.getAttributes())
    : {};

const ckeditor5: AdapterFactory = (root) => {
  const editor = (root as HTMLElement & { ckeditorInstance?: CKEditor5 }).ckeditorInstance;
  if (typeof editor?.model?.change !== "function" || editor.isReadOnly) return null;
  flushCKEditor5PendingMutations(editor);
  const adapter: ModelAdapter<CKRange> = {
    identity: [editor, editor.model.document.version],
    composing: () => editor.editing.view.document.isComposing,
    resolve(range) {
      const view = editor.editing.view.domConverter.domRangeToView(range);
      return view ? editor.editing.mapper.toModelRange(view) : null;
    },
    text: (ref) =>
      Array.from(ref.getItems(), (item) => (typeof item.data === "string" ? item.data : "￼")).join(
        "",
      ),
    write(edits) {
      editor.model.change((writer) => {
        for (const { ref, edit } of [...edits].reverse()) {
          // Replaced text keeps its own attributes; an insertion those before it.
          const [first] = ref.getItems();
          const attributes = attributesOf(
            ref.isCollapsed ? (ref.start.textNode ?? ref.start.nodeBefore) : first,
          );
          if (!ref.isCollapsed) writer.remove(ref);
          if (edit.replacement) writer.insertText(edit.replacement, attributes, ref.start);
        }
      });
    },
  };
  return adapter as ModelAdapter<never>;
};

// ── Trix ────────────────────────────────────────────────────────────
// Public API of the `trix-editor` element. Trix positions are offsets in the
// document string, which equals the mapped text when the two agree.
interface TrixEditor {
  getDocument(): { toString(): string };
  getSelectedRange(): [number, number];
  setSelectedRange(range: [number, number]): void;
  insertString(text: string): void;
  deleteInDirection(direction: "forward" | "backward"): void;
  recordUndoEntry(description: string): void;
}

const trix: AdapterFactory = (root, map) => {
  const editor = (root as HTMLElement & { editor?: TrixEditor }).editor;
  if (typeof editor?.recordUndoEntry !== "function" || root.hasAttribute("disabled")) return null;
  const document = editor.getDocument();
  // The document string ends with the last block's newline, which is not shown.
  const text = document.toString().replace(/\n$/, "");
  if (text.replace(/ /g, " ") !== map.text.replace(/ /g, " ")) return null;
  const adapter: ModelAdapter<TextRange> = {
    identity: [editor, document],
    composing: () => false,
    resolve: (_range, offsets) => ({ start: offsets.start, end: offsets.end }),
    text: (ref) => map.text.slice(ref.start, ref.end),
    write(edits) {
      const [anchor, focus] = editor.getSelectedRange();
      const shifted = edits.map(({ ref, edit }) => ({ ...edit, start: ref.start, end: ref.end }));
      editor.recordUndoEntry("Review");
      for (const { ref, edit } of [...edits].reverse()) {
        editor.setSelectedRange([ref.start, ref.end]);
        if (edit.replacement) editor.insertString(edit.replacement);
        else editor.deleteInDirection("forward");
      }
      editor.setSelectedRange([
        positionThroughEdits(anchor, shifted),
        positionThroughEdits(focus, shifted),
      ]);
    },
  };
  return adapter as ModelAdapter<never>;
};

/** Editable elements of the model editors that have a Review writer. */
export const REVIEW_MODEL_EDITORS: [selector: string, factory: AdapterFactory][] = [
  ["[data-lexical-editor]", lexical],
  [".public-DraftEditor-content", draft],
  [".ck-editor__editable", ckeditor5],
  ["trix-editor", trix],
];

const identities = new WeakMap<object, number>();
let nextIdentity = 0;
function identityOf(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  let identity = identities.get(value);
  if (identity === undefined) identities.set(value, (identity = ++nextIdentity));
  return identity;
}

const sameText = (a: string, b: string) => a.replace(/ /g, " ") === b.replace(/ /g, " ");

function isEligible(root: HTMLElement): boolean {
  return (
    root.isConnected && !isLockedField(root) && !isSensitiveField(root) && !isHiddenField(root)
  );
}

function snapshot(root: HTMLElement) {
  if (!isEligible(root)) return null;
  const factory = REVIEW_MODEL_EDITORS.find(([selector]) => root.matches(selector))?.[1];
  const map = buildContentEditableTextMap(root);
  const adapter = factory?.(root, map) as ModelAdapter<unknown> | null | undefined;
  if (!adapter || adapter.composing()) return null;
  // Every mapped character must be the model's own text at the same place.
  for (const segment of map.segments) {
    const range = root.ownerDocument.createRange();
    range.setStart(segment.node, segment.nodeStart);
    range.setEnd(segment.node, segment.nodeStart + segment.end - segment.start);
    const ref = adapter.resolve(range, segment);
    const text = ref === null ? null : adapter.text(ref);
    if (text === null || !sameText(text, map.text.slice(segment.start, segment.end))) return null;
  }
  const text: ReviewTargetText = {
    text: map.text,
    protectedRanges: map.protectedRanges,
    signature: JSON.stringify([adapter.identity.map(identityOf), map.signature]),
  };
  return { map, adapter, text };
}

export function readReviewModel(root: HTMLElement): ReviewTargetText | null {
  try {
    return snapshot(root)?.text ?? null;
  } catch {
    return null;
  }
}

/**
 * Writes one batch. "applied" means only that the transaction ran: the caller
 * reads the model back (Draft.js renders asynchronously) before it reports success.
 */
export function applyReviewModel(
  root: HTMLElement,
  request: HostEditorReviewApplyRequest,
): ReviewApplyResult {
  if (!isEligible(root)) return { status: "rejected", reason: "ineligible" };
  if (hasOtherFocusedEditor(root)) return { status: "stale" };
  let current: ReturnType<typeof snapshot>;
  try {
    current = snapshot(root);
  } catch {
    current = null;
  }
  if (!current) return { status: "rejected", reason: "unsupported" };
  if (current.text.text !== request.before || current.text.signature !== request.signature)
    return { status: "stale" };
  if (!request.edits?.length || applyEdits(request.before, request.edits) !== request.after)
    return { status: "rejected", reason: "host-refused" };
  const planned = formattingPreservingEdits(current.map, request.edits);
  if (!planned) return { status: "rejected", reason: "host-refused" };
  const writes: { ref: unknown; edit: ReviewEdit }[] = [];
  for (const edit of planned.sort((a, b) => a.start - b.start)) {
    const range = offsetRangeToDomRange(current.map, edit, root.ownerDocument);
    // An edit inside one text node has one model location and one set of marks.
    if (
      !range ||
      range.startContainer !== range.endContainer ||
      range.startContainer.nodeType !== 3
    )
      return { status: "rejected", reason: "unsupported" };
    const ref = current.adapter.resolve(range, edit);
    const text = ref === null ? null : current.adapter.text(ref);
    if (text === null || !sameText(text, edit.original)) return { status: "stale" };
    writes.push({ ref, edit });
  }
  try {
    current.adapter.write(writes);
  } catch {
    // A host can throw after committing. The read-back, not the exception, decides.
  }
  return { status: "applied" };
}
