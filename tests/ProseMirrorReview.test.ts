import { afterEach, describe, expect, test } from "bun:test";
import { Schema } from "prosemirror-model";
import { schema as basic } from "prosemirror-schema-basic";
import { EditorState, TextSelection, Plugin } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { history, undo, redo } from "prosemirror-history";
import { ContentEditableReviewTarget } from "../src/adapters/chrome/content-script/review/ReviewTargets";
import { HostEditorAdapterResolver } from "../src/adapters/chrome/content-script/suggestions/HostEditorAdapterResolver";
import { createSuggestionEntry } from "./suggestionTestUtils";
import { SuggestionTextEditService } from "../src/adapters/chrome/content-script/suggestions/SuggestionTextEditService";
import { ContentEditableAdapter } from "../src/adapters/chrome/content-script/suggestions/ContentEditableAdapter";
import { applyEdits } from "../src/core/domain/grammar/review/textRanges";
import type { ReviewEdit } from "../src/core/domain/grammar/review/types";
import "../src/adapters/chrome/content-script/suggestions/HostEditorMainWorldBridge";

const schema = new Schema({
  nodes: basic.spec.nodes.append({
    mention: {
      inline: true,
      group: "inline",
      atom: true,
      attrs: { id: {} },
      toDOM: (node) => [
        "span",
        { "data-mention": node.attrs.id, contenteditable: "false" },
        "@person",
      ],
    },
    table: { group: "block", content: "row+", toDOM: () => ["table", ["tbody", 0]] },
    row: { content: "cell+", toDOM: () => ["tr", 0] },
    cell: {
      content: "paragraph+",
      attrs: { colspan: { default: 1 } },
      toDOM: (node) => ["td", { colspan: node.attrs.colspan }, 0],
    },
    bullet_list: { group: "block", content: "list_item+", toDOM: () => ["ul", 0] },
    list_item: { content: "paragraph+", toDOM: () => ["li", 0] },
  }),
  marks: basic.spec.marks.append({
    color: {
      attrs: { color: {} },
      toDOM: (mark) => ["span", { style: `color:${mark.attrs.color}` }, 0],
    },
  }),
});
let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  view = undefined;
});

function editor(content: unknown[], plugins: Plugin[] = []) {
  const doc = schema.nodeFromJSON({ type: "doc", content });
  view = new EditorView(document.body.appendChild(document.createElement("div")), {
    handleScrollToSelection: () => true,
    state: EditorState.create({
      doc,
      selection: TextSelection.atEnd(doc),
      plugins: [history(), ...plugins],
    }),
  });
  Object.defineProperty(view.dom, "isContentEditable", { configurable: true, value: true });
  view.focus(); // Normal editor focus captures its view, without a test/global handle.
  return new ContentEditableReviewTarget(view.dom);
}
function paragraph(text: string, marks?: unknown[]) {
  return { type: "paragraph", content: [{ type: "text", text, ...(marks ? { marks } : {}) }] };
}
async function apply(target: ContentEditableReviewTarget, edits: ReviewEdit[]) {
  const before = target.read();
  if (!before.ok) throw new Error("unreadable");
  return target.apply({
    edits,
    before: before.text,
    after: applyEdits(before.text, edits)!,
    signature: before.signature,
  });
}
const edit = (start: number, original: string, replacement: string): ReviewEdit => ({
  start,
  end: start + original.length,
  original,
  replacement,
});

describe("real ProseMirror corrections", () => {
  test("Review batch preserves marks, links, tables, lists, protected atoms and one-step undo/redo", async () => {
    const marks = [
      { type: "strong" },
      { type: "link", attrs: { href: "https://example.com/", title: "keep" } },
      { type: "color", attrs: { color: "red" } },
    ];
    const target = editor([
      paragraph("teh cat", marks),
      {
        type: "table",
        content: [
          {
            type: "row",
            content: [
              {
                type: "cell",
                attrs: { colspan: 2 },
                content: [paragraph("teh dog", [{ type: "em" }])],
              },
            ],
          },
        ],
      },
      { type: "bullet_list", content: [{ type: "list_item", content: [paragraph("teh bird")] }] },
      {
        type: "paragraph",
        content: [
          { type: "mention", attrs: { id: "123" } },
          { type: "text", text: " untouched" },
        ],
      },
      { type: "code_block", content: [{ type: "text", text: "teh code" }] },
    ]);
    expect(target.kind).toBe("prosemirror");
    expect(target.capabilities).toEqual({
      inline: true,
      apply: true,
      bulk: true,
      undo: "single-step",
    });
    const original = view!.state.doc;
    const read = target.read();
    if (!read.ok) throw new Error("unreadable");
    const edits = [...read.text.matchAll(/teh (?=cat|dog|bird)/g)].map((match) =>
      edit(match.index!, "teh", "the"),
    );
    expect(await apply(target, edits)).toEqual({ status: "applied" });
    const expected = JSON.parse(
      JSON.stringify(original.toJSON())
        .replaceAll('"teh cat"', '"the cat"')
        .replaceAll('"teh dog"', '"the dog"')
        .replaceAll('"teh bird"', '"the bird"'),
    );
    expect(view!.state.doc.toJSON()).toEqual(expected);
    view!.updateState(view!.state.reconfigure({ plugins: view!.state.plugins }));
    expect(view!.state.doc.toJSON()).toEqual(expected);
    expect(undo(view!.state, view!.dispatch)).toBe(true);
    expect(view!.state.doc.eq(original)).toBe(true);
    expect(redo(view!.state, view!.dispatch)).toBe(true);
    expect(view!.state.doc.toJSON()).toEqual(expected);
  });

  test("split marks retain each character's formatting; ambiguous expansion refuses the entire batch", async () => {
    const target = editor([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "te", marks: [{ type: "strong" }] },
          { type: "text", text: "h", marks: [{ type: "em" }] },
        ],
      },
    ]);
    expect(await apply(target, [edit(0, "teh", "the")])).toEqual({ status: "applied" });
    expect(view!.state.doc.toJSON().content[0].content).toEqual([
      { type: "text", text: "th", marks: [{ type: "strong" }] },
      { type: "text", text: "e", marks: [{ type: "em" }] },
    ]);
    const original = view!.state.doc;
    expect(await apply(target, [edit(0, "the", "wonderful")])).toEqual({
      status: "rejected",
      reason: "host-refused",
    });
    expect(view!.state.doc.eq(original)).toBe(true);
  });

  test("same-text mark changes invalidate pending fixes", async () => {
    const target = editor([paragraph("teh")]);
    const before = target.read();
    if (!before.ok) throw new Error("unreadable");
    view!.dispatch(
      view!.state.tr.addMark(1, 4, schema.marks.link.create({ href: "https://example.com/new" })),
    );
    expect(
      await target.apply({
        edits: [edit(0, "teh", "the")],
        before: before.text,
        after: "the",
        signature: before.signature,
      }),
    ).toEqual({ status: "stale" });
    expect(view!.state.doc.textContent).toBe("teh");
  });

  test("host filters, composition, protected code, structural ranges and malformed edits never fall through", async () => {
    const target = editor(
      [paragraph("teh"), { type: "code_block", content: [{ type: "text", text: "teh" }] }],
      [new Plugin({ filterTransaction: (tr) => !tr.docChanged })],
    );
    const original = view!.state.doc;
    expect(await apply(target, [edit(0, "teh", "the")])).toEqual({
      status: "rejected",
      reason: "host-refused",
    });
    expect(await apply(target, [edit(4, "teh", "the")])).toEqual({
      status: "rejected",
      reason: "host-refused",
    });
    expect(await apply(target, [edit(0, "teh\nteh", "the")])).toEqual({
      status: "rejected",
      reason: "host-refused",
    });
    const before = target.read();
    if (!before.ok) throw new Error("unreadable");
    target.composing = true;
    expect(
      await target.apply({
        edits: [edit(0, "teh", "the")],
        before: before.text,
        after: "the\nteh",
        signature: before.signature,
      }),
    ).toEqual({ status: "rejected", reason: "composing" });
    expect(view!.state.doc.eq(original)).toBe(true);
    expect(
      new ContentEditableAdapter().replaceTextByOffsets(view!.dom, 0, 3, "the", 3).didMutateDom,
    ).toBe(false);
  });

  test("UTF-16 offsets preserve emoji and refuse edits inside a grapheme", async () => {
    const target = editor([paragraph("😀teh", [{ type: "strong" }])]);
    expect(await apply(target, [edit(2, "teh", "the")])).toEqual({ status: "applied" });
    expect(view!.state.doc.textContent).toBe("😀the");
    const original = view!.state.doc;
    expect(await apply(target, [edit(1, "\ude00", "x")])).toEqual({
      status: "rejected",
      reason: "host-refused",
    });
    expect(view!.state.doc.eq(original)).toBe(true);
  });

  test("Undo reaches host history and suppresses reapplying the same correction", async () => {
    editor([paragraph("teh ", [{ type: "strong" }])]);
    const service = new SuggestionTextEditService({
      findMentionToken: (before) => ({
        token: before.trimEnd().split(/\s+/).at(-1) ?? "",
        start: 0,
      }),
      isSeparator: (value) => /\s/.test(value),
    });
    const entry = createSuggestionEntry({ elem: view!.dom });
    const correction = {
      replacement: "the ",
      deleteBackwards: 4,
      expectedReplacedText: "teh ",
      sourceRuleId: "englishTypoWhitelistCorrection",
    };
    expect(service.applyGrammarEdit(entry, correction).applied).toBe(true);
    const keyboard = new window.KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      cancelable: true,
    });
    expect(
      service.tryUndoLastExtensionEdit(entry, keyboard, {
        consumeKeyboardEvent: (event) => event.preventDefault(),
        clearSuggestions: () => undefined,
      }),
    ).toBe(false);
    expect(keyboard.defaultPrevented).toBe(false);
    expect(undo(view!.state, view!.dispatch)).toBe(true);
    expect(view!.state.doc.textContent).toBe("teh ");
    expect(service.applyGrammarEdit(entry, correction)).toMatchObject({
      applied: false,
      suppressedByManualRevert: true,
    });
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  });

  test("typing uses the same host transaction in a later paragraph and preserves styled prefix and undo", () => {
    editor([paragraph("keep"), paragraph("teh", [{ type: "strong" }])]);
    const original = view!.state.doc;
    const session = new HostEditorAdapterResolver().resolve(view!.dom)!;
    expect(session.getBlockContextAtSelection()?.blockText).toBe("teh");
    expect(
      session.applyBlockReplacement({
        replaceStart: 0,
        replaceEnd: 3,
        replacementText: "the",
        cursorAfter: 3,
      }),
    ).toEqual({ applied: true, didDispatchInput: false });
    expect(view!.state.doc.child(1).toJSON()).toEqual(paragraph("the", [{ type: "strong" }]));
    expect(view!.state.selection.$head.parentOffset).toBe(3);
    expect(undo(view!.state, view!.dispatch)).toBe(true);
    expect(view!.state.doc.eq(original)).toBe(true);
  });
});
