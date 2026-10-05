/**
 * A Notion-like page for the e2e tests. It contains no Notion code. It copies
 * only the DOM shape and the behavior that a live probe of app.notion.com saw
 * (docs/editor-capabilities.md, "Notion"):
 *
 * - One root contenteditable holds the page. Each text block has its own nested
 *   contenteditable leaf. Thus focus stays on the root.
 * - The page keeps its own model. On "input" it reads the DOM of the changed
 *   leaf into the model, with one undo step for each input. It does Undo and
 *   Redo itself.
 * - Its own selection model follows "selectionchange" and focus. A key or an
 *   input while that model is not in the leaf that changes is dropped, and the
 *   DOM change is reverted a moment later.
 * - Escape selects the block (Notion's published shortcut): the next keys are
 *   dropped until a click.
 */
import { container, EXTRA_PARAGRAPH, fail, LINK, publish } from "./shared";

export const NOTION_THIRD_BLOCK = "Third block here.";
const SEED_BLOCKS = [
  `We saw <span data-bold="true" style="font-weight:600">teh</span> cat and <a href="${LINK}">teh</a> dog.`,
  EXTRA_PARAGRAPH,
  NOTION_THIRD_BLOCK,
];
/** Notion reverted an unsettled write "within 1 s". */
const REVERT_DELAY_MS = 200;

interface Block {
  id: string;
  leaf: HTMLElement;
  /** The model: what the page keeps and renders again on Undo. */
  html: string;
}

interface NotionStats {
  droppedKeys: number;
  reverted: number;
  undoDepth: number;
}

declare global {
  interface Window {
    __testNotion?: { stats: NotionStats; selectedBlock(): string | null };
  }
}

try {
  const root = document.createElement("div");
  root.className = "whenContentEditable";
  root.contentEditable = "true";
  root.setAttribute("role", "group");
  root.setAttribute("data-content-editable-root", "true");
  root.style.cssText = "outline:none;padding:4px;min-height:120px;border:1px solid #ccc";
  const content = document.createElement("div");
  content.className = "notion-page-content";
  root.append(content);

  const blocks: Block[] = SEED_BLOCKS.map((html, index) => {
    const id = `block-${index + 1}`;
    const block = document.createElement("div");
    block.className = "notion-selectable notion-text-block";
    block.dataset.blockId = id;
    // A handle without text, as Notion's non-editable block controls.
    const handle = document.createElement("div");
    handle.contentEditable = "false";
    handle.setAttribute("aria-label", "Drag");
    handle.style.cssText = "display:inline-block;width:8px";
    const leaf = document.createElement("div");
    leaf.contentEditable = "true";
    leaf.setAttribute("data-content-editable-leaf", "true");
    leaf.setAttribute("role", "textbox");
    leaf.className = "notranslate";
    leaf.style.cssText = "display:inline-block;min-width:200px;white-space:pre-wrap";
    leaf.innerHTML = html;
    const wrapper = document.createElement("div");
    wrapper.append(leaf);
    block.append(handle, wrapper);
    content.append(block);
    return { id, leaf, html };
  });
  // Notion has a second element with the same block id outside the page content.
  const outline = document.createElement("div");
  outline.dataset.blockId = blocks[0].id;
  outline.textContent = "Outline";

  const stats: NotionStats = { droppedKeys: 0, reverted: 0, undoDepth: 0 };
  const undo: { block: Block; before: string; after: string }[] = [];
  const redo: typeof undo = [];
  let selected: Block | null = null;

  const blockOf = (node: Node | null) =>
    blocks.find((block) => !!node && block.leaf.contains(node)) ?? null;
  const syncSelection = () => {
    const selection = document.getSelection();
    const anchor = blockOf(selection?.anchorNode ?? null);
    selected =
      document.activeElement === root && anchor && anchor === blockOf(selection!.focusNode)
        ? anchor
        : null;
  };
  document.addEventListener("selectionchange", syncSelection);
  // The page takes the selection of a focus one task later.
  root.addEventListener("focus", () => setTimeout(syncSelection));
  root.addEventListener("blur", () => {
    selected = null;
  });

  const render = (block: Block, html: string) => {
    block.leaf.innerHTML = html;
    block.html = html;
    const caret = document.createRange();
    caret.selectNodeContents(block.leaf);
    caret.collapse(false);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(caret);
  };
  const history = (from: typeof undo, to: typeof undo, side: "before" | "after") => {
    const step = from.pop();
    if (!step) return;
    to.push(step);
    render(step.block, step[side]);
    stats.undoDepth = undo.length;
  };

  root.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.isComposing) return;
    if (["Shift", "Meta", "Control", "Alt", "CapsLock"].includes(event.key)) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) history(redo, undo, "after");
      else history(undo, redo, "before");
      return;
    }
    // Notion splits blocks on Enter and indents on Tab; this page does neither.
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      return;
    }
    // Notion's Escape selects the current block (its published shortcut). Then
    // there is no text caret, and keys do not edit text until a click.
    if (event.key === "Escape") {
      event.preventDefault();
      document.getSelection()?.removeAllRanges();
      selected = null;
      return;
    }
    if (!selected) {
      event.preventDefault();
      stats.droppedKeys += 1;
    }
  });

  root.addEventListener("input", () => {
    const changed = blocks.filter((block) => block.leaf.innerHTML !== block.html);
    if (changed.length === 1 && changed[0] === selected) {
      const block = changed[0];
      undo.push({ block, before: block.html, after: block.leaf.innerHTML });
      redo.length = 0;
      block.html = block.leaf.innerHTML;
      stats.undoDepth = undo.length;
      return;
    }
    // An input outside the page's own selection: the page renders its model again.
    stats.reverted += 1;
    setTimeout(() => {
      for (const block of changed) block.leaf.innerHTML = block.html;
    }, REVERT_DELAY_MS);
  });

  container().append(root, outline);
  window.__testNotion = { stats, selectedBlock: () => selected?.id ?? null };
  const model = () => blocks.map((block) => block.html);
  const texts = (selector: string) =>
    blocks.flatMap((block) =>
      Array.from(block.leaf.querySelectorAll(selector), (element) => element.textContent ?? ""),
    );
  publish({
    frame: null,
    // FluentTyper attaches to each block leaf, not to the page root.
    editable: '.notion-page-content [data-block-id="block-1"] [data-content-editable-leaf]',
    // The model text, not the DOM: a reverted DOM change never reaches it.
    text: () =>
      model()
        .map((html) => {
          const element = document.createElement("div");
          element.innerHTML = html;
          return element.textContent ?? "";
        })
        .join("\n"),
    runs: () => ({ bold: texts("[data-bold]"), links: texts(`a[href="${LINK}"]`) }),
  });
} catch (error) {
  fail(error);
}
