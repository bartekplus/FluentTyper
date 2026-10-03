import { afterEach, describe, expect, test } from "bun:test";
import * as richText from "@wordpress/rich-text";
import {
  readGutenberg,
  applyGutenberg,
  gutenbergBlockContext,
  replaceGutenbergBlock,
  setGutenbergComposing,
} from "../src/adapters/chrome/content-script/suggestions/GutenbergEditor";
import { applyEdits } from "../src/core/domain/grammar/review/textRanges";
import { ContentEditableAdapter } from "../src/adapters/chrome/content-script/suggestions/ContentEditableAdapter";
import { isGutenbergContainer } from "../src/adapters/chrome/content-script/suggestions/GutenbergEnvironment";
import { editorCapabilities } from "../src/adapters/chrome/content-script/suggestions/EditorCapabilities";
import type { ReviewEdit } from "../src/core/domain/grammar/review/types";

type Block = { clientId: string; name: string; attributes: Record<string, unknown> };
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
function fixture(
  definitions: { id: string; path?: string; html: string; attributes?: Record<string, unknown> }[],
) {
  const root = document.body.appendChild(document.createElement("div"));
  root.className = "block-editor-block-list__layout is-root-container";
  cleanups.push(() => root.remove());
  const blocks = new Map<string, Block>();
  const elements = definitions.map(({ id, path = "content", html, attributes }) => {
    const wrapper = root.appendChild(document.createElement("div"));
    wrapper.setAttribute("data-block", id);
    const element = wrapper.appendChild(document.createElement("p"));
    element.className = "block-editor-rich-text__editable";
    element.setAttribute("data-wp-block-attribute-key", path);
    element.setAttribute("contenteditable", "true");
    Object.defineProperty(element, "isContentEditable", { value: true, configurable: true });
    element.style.whiteSpace = "pre-wrap";
    element.innerHTML = html;
    blocks.set(id, {
      clientId: id,
      name: "core/paragraph",
      attributes: attributes ?? { content: html },
    });
    return element;
  });
  const commits: unknown[] = [];
  const actions = {
    __unstableMarkLastChangeAsPersistent() {},
    selectionChange(point: unknown) {
      commits.push(point);
    },
    updateBlockAttributes(ids: string[], attributes: Record<string, Record<string, unknown>>) {
      commits.push(attributes);
      for (const id of ids) blocks.get(id)!.attributes = attributes[id];
      render();
    },
  };
  function value(element: HTMLElement): unknown {
    let value: unknown = blocks.get(element.parentElement!.getAttribute("data-block")!)!.attributes;
    for (const part of element.getAttribute("data-wp-block-attribute-key")!.split("."))
      value = (value as Record<string, unknown>)[part];
    return value;
  }
  function render() {
    for (const element of elements) element.innerHTML = String(value(element));
  }
  const selectors = {
    getBlock: (id: string) => blocks.get(id),
    canEditBlock: () => true,
    getBlockEditingMode: () => "default",
  };
  const data = {
    select: () => selectors,
    dispatch: () => actions,
    batch: (callback: () => void) => callback(),
  };
  const win = window as unknown as { wp?: unknown };
  const previous = win.wp;
  win.wp = { data, richText };
  cleanups.push(() => {
    win.wp = previous;
  });
  const source = elements[0];
  source.focus();
  const selection = document.getSelection()!;
  selection.selectAllChildren(source);
  selection.collapseToEnd();
  return { root, blocks, elements, source, commits, selectors, render, data };
}
const edit = (start: number, original: string, replacement: string): ReviewEdit => ({
  start,
  end: start + original.length,
  original,
  replacement,
});
function apply(source: HTMLElement, edits: ReviewEdit[]) {
  const before = readGutenberg(source)!;
  expect(before).not.toBeNull();
  return applyGutenberg(source, {
    edits,
    before: before.text,
    after: applyEdits(before.text, edits)!,
    signature: before.signature,
  });
}

describe("Gutenberg native transactions", () => {
  test("reads the document and targets duplicate text by block identity", () => {
    const { source, blocks } = fixture([
      { id: "a", html: "teh cat" },
      { id: "b", html: "teh cat" },
    ]);
    expect(readGutenberg(source)?.text).toBe("teh cat\nteh cat");
    expect(apply(source, [edit(8, "teh", "the")]).status).toBe("applied");
    expect(blocks.get("a")!.attributes.content).toBe("teh cat");
    expect(blocks.get("b")!.attributes.content).toBe("the cat");
  });
  test("merges edits to separate cells in the same native table attribute", () => {
    const attributes = {
      body: [{ cells: [{ content: "teh" }, { content: "teh" }] }],
      className: "keep",
    };
    const { source, blocks, commits } = fixture([
      { id: "table", path: "body.0.cells.0.content", html: "teh", attributes },
      { id: "table", path: "body.0.cells.1.content", html: "teh", attributes },
    ]);
    expect(apply(source, [edit(0, "teh", "the"), edit(4, "teh", "the")]).status).toBe("applied");
    expect(blocks.get("table")!.attributes).toEqual({
      body: [{ cells: [{ content: "the" }, { content: "the" }] }],
      className: "keep",
    });
    expect(commits).toHaveLength(1);
  });
  test("preserves marks and escapes plain replacement text", () => {
    const { source, blocks } = fixture([
      { id: "a", html: '<strong>teh</strong> <a href="https://example.com">cat</a>' },
    ]);
    expect(apply(source, [edit(0, "teh", "the")]).status).toBe("applied");
    expect(blocks.get("a")!.attributes.content).toBe(
      '<strong>the</strong> <a href="https://example.com">cat</a>',
    );
    expect(apply(source, [edit(4, "cat", "<dog>")]).status).toBe("applied");
    expect(source.textContent).toBe("the <dog>");
    expect(source.querySelector("dog")).toBeNull();
  });
  test("refuses a batch across field separators before its first write", () => {
    const { source, commits } = fixture([
      { id: "a", html: "teh" },
      { id: "b", html: "cat" },
    ]);
    expect(apply(source, [edit(2, "h\nc", "hello")]).status).toBe("rejected");
    expect(commits).toHaveLength(0);
  });
  test("rejects stale native attributes even when rendered text stays unchanged", () => {
    const { source, blocks, commits } = fixture([{ id: "a", html: "teh" }]);
    const before = readGutenberg(source)!;
    blocks.get("a")!.attributes.className = "changed";
    expect(
      applyGutenberg(source, {
        edits: [edit(0, "teh", "the")],
        before: before.text,
        after: "the",
        signature: before.signature,
      }).status,
    ).toBe("stale");
    expect(commits).toHaveLength(0);
  });
  test("reads selected text across two fields without matching text search", () => {
    const { source, elements } = fixture([
      { id: "a", html: "one cat" },
      { id: "b", html: "two cats" },
    ]);
    const range = document.createRange();
    range.setStart(source.firstChild!, 4);
    range.setEnd(elements[1].firstChild!, 3);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    expect(readGutenberg(source, true)?.scope).toEqual({ start: 4, end: 11 });
  });
  test("refuses composition, read-only transitions and protected code", () => {
    const { source, commits } = fixture([{ id: "a", html: "<code>teh</code> cat" }]);
    expect(apply(source, [edit(0, "teh", "the")]).status).toBe("rejected");
    setGutenbergComposing(source, true);
    expect(readGutenberg(source)).toBeNull();
    setGutenbergComposing(source, false);
    source.setAttribute("aria-readonly", "true");
    expect(readGutenberg(source)).toBeNull();
    expect(commits).toHaveLength(0);
  });
  test("maps selected container blocks to their nested prose fields", () => {
    const { source, selectors } = fixture([
      { id: "a", html: "First" },
      { id: "b", html: "Nested" },
      { id: "c", html: "Last" },
    ]);
    Object.assign(selectors, {
      getMultiSelectedBlockClientIds: () => ["group"],
      getBlockParents: (id: string) => (id === "b" ? ["group"] : []),
    });
    expect(readGutenberg(source, true)?.scope).toEqual({ start: 6, end: 12 });
  });
  test("invalidates a snapshot when an unrepresented native block changes", () => {
    const { source, selectors, blocks, commits } = fixture([{ id: "a", html: "teh" }]);
    blocks.set("group", { clientId: "group", name: "core/group", attributes: {} });
    Object.assign(selectors, { getClientIdsWithDescendants: () => ["group", "a"] });
    const before = readGutenberg(source)!;
    blocks.get("group")!.attributes = { templateLock: "contentOnly" };
    expect(
      applyGutenberg(source, {
        before: before.text,
        after: "the",
        signature: before.signature,
        edits: [edit(0, "teh", "the")],
      }).status,
    ).toBe("stale");
    expect(commits).toHaveLength(0);
  });
  test("uses the owning provider registry instead of an identical global block", () => {
    const { source, data, blocks } = fixture([{ id: "a", html: "teh" }]);
    Object.assign(source, { __reactFiber$test: { memoizedProps: { value: data } } });
    (window as unknown as { wp: { data: unknown } }).wp.data = {
      ...data,
      select: () => ({
        getBlock: () => ({
          clientId: "a",
          name: "core/paragraph",
          attributes: { content: "wrong" },
        }),
      }),
    };
    expect(apply(source, [edit(0, "teh", "the")]).status).toBe("applied");
    expect(blocks.get("a")!.attributes.content).toBe("the");
  });
  test("supports native RichTextData attributes", () => {
    const content = richText.RichTextData.fromHTMLString("<strong>teh</strong>");
    const { source, blocks } = fixture([
      { id: "a", html: content.toHTMLString(), attributes: { content } },
    ]);
    expect(apply(source, [edit(0, "teh", "the")]).status).toBe("applied");
    expect(blocks.get("a")!.attributes.content).toBeInstanceOf(richText.RichTextData);
    expect(String(blocks.get("a")!.attributes.content)).toBe("<strong>the</strong>");
  });
  test("routes block replacements through native data and refuses DOM fallback", () => {
    const { source, blocks } = fixture([{ id: "a", html: "hel" }]);
    expect(gutenbergBlockContext(source)?.beforeCursor).toBe("hel");
    expect(
      replaceGutenbergBlock(source, {
        replaceStart: 0,
        replaceEnd: 3,
        replacementText: "hello\nworld",
        cursorAfter: 11,
        expectedBlockText: "hel",
      }).applied,
    ).toBe(true);
    expect(String(blocks.get("a")!.attributes.content)).toContain("hello");
    expect(
      new ContentEditableAdapter().replaceTextByOffsets(source, 0, 5, "oops", 4).appliedBy,
    ).toBe("refused");
  });
  test("handles the empty RichText filler without treating it as document text", () => {
    const { source, blocks } = fixture([{ id: "empty", html: "", attributes: { content: "" } }]);
    source.textContent = "\uFEFF";
    expect(readGutenberg(source)?.text).toBe("");
    expect(
      replaceGutenbergBlock(source, {
        replaceStart: 0,
        replaceEnd: 0,
        replacementText: "Hello",
        cursorAfter: 5,
        expectedBlockText: "",
      }).applied,
    ).toBe(true);
    expect(blocks.get("empty")!.attributes.content).toBe("Hello");
  });
  test("supports deletion to an empty native string", () => {
    const { source, blocks } = fixture([{ id: "a", html: "Hello" }]);
    expect(apply(source, [edit(0, "Hello", "")]).status).toBe("applied");
    expect(blocks.get("a")!.attributes.content).toBe("");
  });
  test("refuses UTF-16 edits inside a grapheme and preserves emoji", () => {
    const { source, commits } = fixture([{ id: "a", html: "👩‍💻 teh" }]);
    expect(apply(source, [edit(1, "\udc69", "x")]).status).toBe("rejected");
    expect(commits).toHaveLength(0);
    expect(apply(source, [edit(6, "teh", "the")]).status).toBe("applied");
    expect(source.textContent).toBe("👩‍💻 the");
  });
  test("invalidates a snapshot when a block moves without a text change", () => {
    const { source, root, elements, commits } = fixture([
      { id: "a", html: "teh" },
      { id: "b", html: "teh" },
    ]);
    const before = readGutenberg(source)!;
    root.prepend(elements[1].parentElement!);
    expect(
      applyGutenberg(source, {
        edits: [edit(0, "teh", "the")],
        before: before.text,
        after: "the\nteh",
        signature: before.signature,
      }).status,
    ).toBe("stale");
    expect(commits).toHaveLength(0);
  });
  test("reports custom editors without bindings and refuses generic writes", () => {
    const { source, root } = fixture([{ id: "a", html: "Hello" }]);
    const unknown = root.appendChild(document.createElement("div"));
    unknown.setAttribute("data-block", "custom");
    unknown.setAttribute("contenteditable", "true");
    Object.defineProperty(unknown, "isContentEditable", { value: true });
    unknown.textContent = "Unsupported prose";
    expect(readGutenberg(source)?.unread).toBe(17);
    expect(isGutenbergContainer(unknown)).toBe(true);
    expect(
      new ContentEditableAdapter().replaceTextByOffsets(unknown, 0, 11, "changed", 7).appliedBy,
    ).toBe("refused");
  });
  test("allows a native field inside WritingFlow while excluding the generic container", () => {
    const { source, root } = fixture([{ id: "a", html: "Hello" }]);
    root.setAttribute("contenteditable", "true");
    Object.defineProperty(root, "isContentEditable", { value: true });
    expect(editorCapabilities(root).inspectProse).toBe(false);
    expect(editorCapabilities(source).displaySuggestions).toBe(true);
    root.setAttribute("aria-readonly", "true");
    expect(editorCapabilities(source).inspectProse).toBe(false);
  });
  test("does not retry a dispatched transaction that throws", () => {
    const { source, data, commits } = fixture([{ id: "a", html: "teh" }]);
    const actions = data.dispatch();
    actions.updateBlockAttributes = () => {
      commits.push("dispatched");
      throw new Error("Native write failed.");
    };
    expect(apply(source, [edit(0, "teh", "the")]).status).toBe("unverified");
    expect(commits).toEqual(["dispatched"]);
    expect(source.textContent).toBe("teh");
  });
  test("refuses model writes when the native APIs are unavailable", () => {
    const { source } = fixture([{ id: "a", html: "teh" }]);
    (window as unknown as { wp: unknown }).wp = {};
    expect(readGutenberg(source)).toBeNull();
    expect(
      new ContentEditableAdapter().replaceTextByOffsets(source, 0, 3, "the", 3).appliedBy,
    ).toBe("refused");
  });
  test("commits a post-title block to its context entity instead of the current post", () => {
    const { source, blocks, data, selectors } = fixture([{ id: "title", html: "teh title" }]);
    blocks.get("title")!.name = "core/post-title";
    Object.assign(source, {
      __reactFiber$test: {
        memoizedProps: {},
        return: { memoizedProps: { value: { postType: "page", postId: 9 } } },
      },
    });
    let title = "teh title";
    const changes: unknown[] = [];
    const actions = data.dispatch();
    Object.assign(data, {
      select: (store: string) =>
        store === "core"
          ? { canUser: () => true, getEditedEntityRecord: () => ({ title: { raw: title } }) }
          : store === "core/editor"
            ? { getCurrentPostId: () => 42, getCurrentPostType: () => "post" }
            : selectors,
      dispatch: (store: string) =>
        store === "core"
          ? {
              editEntityRecord: (
                kind: string,
                name: string,
                id: number,
                edits: { title: string },
              ) => {
                changes.push([kind, name, id, edits]);
                title = edits.title;
                source.textContent = title;
              },
            }
          : actions,
    });
    expect(apply(source, [edit(0, "teh", "the")]).status).toBe("applied");
    expect(changes).toEqual([["postType", "page", 9, { title: "the title" }]]);
    expect(blocks.get("title")!.attributes.content).toBe("teh title");
    Object.assign(data, {
      select: (store: string) => (store === "core" ? { canUser: () => false } : selectors),
    });
    expect(readGutenberg(source)).toBeNull();
  });
  test("rejects unsafe attribute paths before any native mutation", () => {
    const { source, commits } = fixture([
      { id: "a", html: "teh", path: "constructor.prototype.content" },
    ]);
    expect(readGutenberg(source)).toBeNull();
    expect(commits).toHaveLength(0);
  });
  test("reports an edit as unverified when the host removes formatting", () => {
    const { source, data } = fixture([{ id: "a", html: "<strong>teh</strong>" }]);
    const actions = data.dispatch();
    const original = actions.updateBlockAttributes;
    actions.updateBlockAttributes = (ids, attributes) => {
      const stripped = Object.fromEntries(
        Object.entries(attributes).map(([id, value]) => [id, { ...value, content: "the" }]),
      );
      original(ids, stripped);
    };
    expect(apply(source, [edit(0, "teh", "the")]).status).toBe("unverified");
  });
  test.each(["core/site-title", "core/site-tagline"])(
    "writes %s through the loaded site entity",
    (name) => {
      const { source, blocks, data, selectors } = fixture([{ id: "site", html: "teh site" }]);
      blocks.get("site")!.name = name;
      source.removeAttribute("data-wp-block-attribute-key");
      const property = name === "core/site-title" ? "title" : "description";
      let value = "teh site";
      const writes: unknown[] = [];
      const actions = data.dispatch();
      Object.assign(data, {
        select: (store: string) =>
          store === "core"
            ? { canUser: () => true, getEditedEntityRecord: () => ({ [property]: value }) }
            : selectors,
        dispatch: (store: string) =>
          store === "core"
            ? {
                editEntityRecord: (
                  kind: string,
                  name: string,
                  id: undefined,
                  edits: Record<string, string>,
                ) => {
                  writes.push([kind, name, id, edits]);
                  value = edits[property];
                  source.innerHTML = value;
                },
              }
            : actions,
      });
      expect(apply(source, [edit(0, "teh", "the")]).status).toBe("applied");
      expect(writes).toEqual([["root", "site", undefined, { [property]: "the site" }]]);
    },
  );
  test("validates all registries before a batch and requires one shared Undo manager", () => {
    const { source, elements, data, selectors, commits } = fixture([
      { id: "a", html: "teh" },
      { id: "b", html: "teh" },
    ]);
    const firstManager = {};
    const actions = data.dispatch();
    Object.assign(data, {
      select: (store: string) =>
        store === "core" ? { getUndoManager: () => firstManager } : selectors,
    });
    let secondManager: object = {};
    const second = {
      select: (store: string) =>
        store === "core" ? { getUndoManager: () => secondManager } : selectors,
      dispatch: () => actions,
      batch: (callback: () => void) => callback(),
    };
    Object.assign(elements[1], { __reactFiber$test: { memoizedProps: { value: second } } });
    const edits = [edit(0, "teh", "the"), edit(4, "teh", "the")];
    expect(apply(source, edits).status).toBe("rejected");
    expect(commits).toHaveLength(0);
    secondManager = firstManager;
    expect(apply(source, edits).status).toBe("rejected");
    expect(commits).toHaveLength(0);
    Object.assign(actions, {
      __unstableMarkNextChangeAsNotPersistent() {},
      __unstableCreateUndoLevel() {},
      editEntityRecord() {},
    });
    const nativeCore = {
      getUndoManager: () => firstManager,
      getEditedEntityRecord: () => ({ blocks: [] }),
    };
    const nativePost = { getCurrentPostType: () => "post", getCurrentPostId: () => 42 };
    data.select = ((store: string) =>
      store === "core"
        ? nativeCore
        : store === "core/editor"
          ? nativePost
          : selectors) as typeof data.select;
    second.select = data.select;
    (window as unknown as { wp: { blocks?: unknown } }).wp.blocks = { serialize: () => "" };
    expect(apply(source, edits).status).toBe("applied");
    expect(source.textContent).toBe("the");
    expect(elements[1].textContent).toBe("the");
  });
  test("refuses a partial write to two fields that share one native binding", () => {
    const { source, commits } = fixture([
      { id: "a", html: "teh" },
      { id: "a", html: "teh" },
    ]);
    expect(apply(source, [edit(0, "teh", "the")]).status).toBe("rejected");
    expect(commits).toHaveLength(0);
  });
  test("includes an editable post title outside the block layout", () => {
    const { source, data, selectors } = fixture([{ id: "a", html: "Body" }]);
    const title = document.body.appendChild(document.createElement("h1"));
    title.className = "editor-post-title__input";
    title.textContent = "teh title";
    title.setAttribute("contenteditable", "true");
    Object.defineProperty(title, "isContentEditable", { value: true });
    cleanups.push(() => title.remove());
    let value = "teh title";
    const actions = data.dispatch();
    Object.assign(data, {
      select: (store: string) =>
        store === "core/editor"
          ? {
              getEditedPostAttribute: () => value,
              getCurrentPostId: () => 42,
              getCurrentPostType: () => "post",
            }
          : selectors,
      dispatch: (store: string) =>
        store === "core/editor"
          ? {
              editPost: (edits: { title: string }) => {
                value = edits.title;
                title.textContent = value;
              },
            }
          : actions,
    });
    expect(readGutenberg(source)?.text).toBe("teh title\nBody");
    expect(apply(source, [edit(0, "teh", "the")]).status).toBe("applied");
    expect(value).toBe("the title");
  });
});
