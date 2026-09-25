/** Only semantic markup and verified editing-DOM markers belong here. */
const CODE_CONTEXT =
  "code, pre, kbd, samp, .ql-code-block, .ql-code-block-container, " +
  ".monaco-editor, .CodeMirror, .cm-editor, .ace_editor";
const NON_PROSE_CONTEXT = '[contenteditable="false"], [aria-readonly="true"], [role="spinbutton"]';

export type CodeContext = "prose" | "code" | "protected" | "unknown";

type SelectionRange = Pick<Range, "startContainer" | "startOffset" | "endContainer" | "endOffset">;
type ScopedSelectionRoot = ShadowRoot & { getSelection?: () => Selection | null };
type ComposedSelection = Selection & {
  getComposedRanges?: (options: { shadowRoots: ShadowRoot[] }) => SelectionRange[];
};

function parentAcrossShadowRoot(node: Node): Node | null {
  if (node.parentNode) return node.parentNode;
  return node.nodeType === 11 && "host" in node ? (node as ShadowRoot).host : null;
}

/** No page globals, computed styles, text heuristics, or document-wide queries. */
function ancestorContext(node: Node): CodeContext | null {
  let code = false;
  for (let current: Node | null = node; current; current = parentAcrossShadowRoot(current)) {
    if (current.nodeType !== 1) continue;
    const element = current as Element;
    if (element.matches(NON_PROSE_CONTEXT)) return "protected";
    if (element.matches(CODE_CONTEXT)) code = true;
  }
  return code ? "code" : null;
}

function readSelectionRange(element: HTMLElement): SelectionRange | null {
  const docSelection: ComposedSelection | null = element.ownerDocument.getSelection();
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

  const selection =
    (roots[0] as ScopedSelectionRoot | undefined)?.getSelection?.() ?? docSelection;
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
