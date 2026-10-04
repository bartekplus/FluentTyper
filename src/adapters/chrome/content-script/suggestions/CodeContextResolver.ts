import { composedParent } from "@core/application/dom-utils";
import { isGutenbergField } from "./GutenbergEnvironment";

/** Only semantic markup and verified editing-DOM markers belong here. */
const CODE_CONTEXT =
  "code, pre, kbd, samp, .ql-code-block, .ql-code-block-container, " +
  ".monaco-editor, .CodeMirror, .cm-editor, .ace_editor";
// Word's floating formatting group has no toolbar role.
const NON_WRITING_CONTROL =
  '[role="toolbar"], [role="menubar"], [role="menu"], [role="spinbutton"], #FontFormattingGroup';
const NON_PROSE_CONTEXT = `[contenteditable="false"], [aria-readonly="true"], ${NON_WRITING_CONTROL}`;

export type CodeContext = "prose" | "code" | "protected" | "unknown";

type SelectionRange = Pick<Range, "startContainer" | "startOffset" | "endContainer" | "endOffset">;
type ScopedSelectionRoot = ShadowRoot & { getSelection?: () => Selection | null };

/** Formatting controls are never writing fields, including inside shadow roots. */
export function isNonWritingControl(element: HTMLElement): boolean {
  for (let node: Node | null = element; node; node = composedParent(node)) {
    if (node.nodeType === 1 && (node as Element).matches(NON_WRITING_CONTROL)) return true;
  }
  return false;
}

/** Word's event/clipboard proxies do not contain its document text. */
export function isWordInputProxy(element: HTMLElement): boolean {
  return (
    /^WACViewPanel_(?:FootnoteEndnoteEditControl_)?(?:EditingElement|ClipboardElement)$/.test(
      element.id,
    ) && !!element.closest("#WACViewPanel, #WACViewPanel_FootnoteEndnoteEditControl")
  );
}

/**
 * The code/protected context a node sits in, or null for prose ancestors.
 * No page globals, computed styles, text heuristics, or document-wide queries.
 * Exported for range-aware review, which classifies every text node it reads.
 */
export function ancestorContext(node: Node, stopAt?: Node): CodeContext | null {
  let code = false;
  let nativeField = false;
  for (
    let current: Node | null = node;
    current && current !== stopAt;
    current = composedParent(current)
  ) {
    if (current.nodeType !== 1) continue;
    const element = current as Element;
    if (
      element.matches(NON_PROSE_CONTEXT) &&
      !(
        nativeField &&
        element.matches('[contenteditable="false"]') &&
        !element.matches(`[aria-readonly="true"], ${NON_WRITING_CONTROL}`)
      )
    )
      return "protected";
    if (
      isGutenbergField(element as HTMLElement) &&
      element.getAttribute("contenteditable") === "true"
    )
      nativeField = true;
    if (
      element.matches(CODE_CONTEXT) &&
      !element.matches(
        'pre.block-editor-rich-text__editable[data-type="core/verse"][data-wp-block-attribute-key="content"][contenteditable="true"]',
      )
    )
      code = true;
  }
  return code ? "code" : null;
}

function readSelectionRange(element: HTMLElement): SelectionRange | null {
  const docSelection = element.ownerDocument.getSelection();
  if (!docSelection) return null;

  const roots: ShadowRoot[] = [];
  let root = element.getRootNode();
  while (root.nodeType === 11 && "host" in root) {
    const shadowRoot = root as ShadowRoot;
    roots.push(shadowRoot);
    root = shadowRoot.host.getRootNode();
  }

  if (roots.length > 0 && typeof docSelection.getComposedRanges === "function") {
    const ranges = docSelection.getComposedRanges({ shadowRoots: roots });
    return ranges.length === 1 ? ranges[0] : null;
  }

  const selection = (roots[0] as ScopedSelectionRoot | undefined)?.getSelection?.() ?? docSelection;
  return selection.rangeCount === 1 ? selection.getRangeAt(0) : null;
}

function boundaryContext(node: Node | undefined, atEnd: boolean): CodeContext | null {
  if (!node) return null;
  // Inspect only the adjacent boundary, not every descendant of a paragraph.
  let edge = node;
  while (atEnd ? edge.lastChild : edge.firstChild) {
    edge = (atEnd ? edge.lastChild : edge.firstChild) as Node;
  }
  return ancestorContext(edge);
}

/**
 * Resolve the insertion context on demand. Do not persist this as a site setting:
 * one editing host may contain both prose and code, and formatting can change
 * without changing its text or emitting an input event.
 *
 * "code" also covers literal/preformatted content whose whitespace must survive.
 * An unresolved selection is not evidence of prose. Callers must retain their
 * normal eligibility checks (passwords, readonly controls, composition, etc.).
 */
export function resolveCodeContext(element: HTMLElement): CodeContext {
  const hostContext = ancestorContext(element);
  if (hostContext) return hostContext;
  if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") return "prose";
  if (!element.isContentEditable) return "unknown";

  try {
    const range = readSelectionRange(element);
    if (
      !range ||
      range.startContainer !== range.endContainer ||
      range.startOffset !== range.endOffset ||
      !element.contains(range.startContainer)
    ) {
      return "unknown";
    }

    const context = ancestorContext(range.startContainer);
    if (context) return context;

    if (range.startContainer.nodeType === 1) {
      const children = range.startContainer.childNodes;
      // A parent/child-offset caret adjacent to code has ambiguous formatting
      // affinity. Do not guess which sibling the editor will insert into.
      if (
        boundaryContext(children[range.startOffset - 1], true) ||
        boundaryContext(children[range.startOffset], false)
      ) {
        return "unknown";
      }
    }
    return "prose";
  } catch {
    // Selection APIs can be unavailable or invalid while an editor rebuilds DOM.
    return "unknown";
  }
}
