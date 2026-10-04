import { afterEach, describe, expect, test } from "bun:test";
import { InlineSuggestionView } from "../src/adapters/chrome/content-script/suggestions/InlineSuggestionView";
import { createEditor, setCaret, setCaretAtTextOffset } from "./codeContextTestUtils";

describe("InlineSuggestionView", () => {
  afterEach(() => {
    // The ghost can mount on <html>, outside body.
    InlineSuggestionView.removeAll(document);
  });

  test("mounts inline ghost outside a contenteditable body root", () => {
    document.body.setAttribute("contenteditable", "true");
    Object.defineProperty(document.body, "isContentEditable", {
      value: true,
      configurable: true,
    });
    document.body.textContent = "hello";

    const ghost = InlineSuggestionView.render({
      target: document.body,
      text: " world",
      caretRect: { left: 10, top: 20, width: 0, height: 16 } as DOMRect,
      doc: document,
    });

    expect(ghost).not.toBeNull();
    expect(ghost?.parentElement).toBe(document.documentElement);
    expect(document.body.querySelector(`.${InlineSuggestionView.CLASS_NAME}`)).toBeNull();
  });

  test("copies font from caret element inside contenteditable, not the container", () => {
    const container = createEditor(
      '<h1 style="font-family: Georgia, serif; font-size: 32px; font-weight: 700">Hello</h1>',
    );
    setCaretAtTextOffset(container, 5);

    const ghost = InlineSuggestionView.render({
      target: container,
      text: " world",
      caretRect: { left: 100, top: 50, width: 0, height: 37 } as DOMRect,
      doc: document,
    });

    expect(ghost).not.toBeNull();
    const style = ghost!.style;
    expect(style.fontFamily).toBe("Georgia, serif");
    expect(style.fontSize).toBe("32px");
    expect(style.fontWeight).toBe("700");
  });

  test("falls back to target element styles when caret is directly in container", () => {
    const container = createEditor("text");
    container.style.fontFamily = "Arial, sans-serif";
    container.style.fontSize = "16px";
    setCaretAtTextOffset(container, 4);

    const ghost = InlineSuggestionView.render({
      target: container,
      text: " more",
      caretRect: { left: 50, top: 20, width: 0, height: 16 } as DOMRect,
      doc: document,
    });

    expect(ghost).not.toBeNull();
    expect(ghost!.style.fontFamily).toBe("Arial, sans-serif");
    expect(ghost!.style.fontSize).toBe("16px");
  });

  test("shifts ghost top upward to compensate for leading when lineHeight exceeds caret height", () => {
    const container = createEditor('<h1 style="line-height: 44.8px">Title</h1>');
    setCaretAtTextOffset(container, 5);

    const caretTop = 50;
    const caretHeight = 37;
    const ghost = InlineSuggestionView.render({
      target: container,
      text: " suffix",
      caretRect: { left: 100, top: caretTop, width: 0, height: caretHeight } as DOMRect,
      doc: document,
    });

    expect(ghost).not.toBeNull();
    // lineHeight is preserved from the element (not clamped)
    expect(ghost!.style.lineHeight).toBe("44.8px");
    // height is NOT set — wrapping suggestions must not be truncated
    expect(ghost!.style.height).toBe("");
    expect(ghost!.style.overflow).toBe("");
    // top is shifted up by half the leading: (44.8 - 37) / 2 = 3.9
    const expectedTop = caretTop - (44.8 - caretHeight) / 2;
    expect(parseFloat(ghost!.style.top)).toBeCloseTo(expectedTop, 1);
  });

  test("does not shift ghost top when lineHeight is smaller than caret height", () => {
    const ghost = InlineSuggestionView.render({
      target: document.body,
      text: "test",
      caretRect: { left: 10, top: 20, width: 0, height: 16 } as DOMRect,
      doc: document,
    });

    expect(ghost).not.toBeNull();
    // No leading offset when lineHeight <= caretRect.height
    expect(ghost!.style.top).toBe("20px");
  });

  test("does not resolve caret element for non-contenteditable targets", () => {
    const input = document.createElement("input");
    input.value = "hello";
    document.body.appendChild(input);

    const ghost = InlineSuggestionView.render({
      target: input,
      text: " world",
      caretRect: { left: 50, top: 20, width: 0, height: 16 } as DOMRect,
      doc: document,
    });

    expect(ghost).not.toBeNull();
    // For non-contenteditable, styles come from the target itself
    expect(ghost!.style.fontSize).toBe(window.getComputedStyle(input).fontSize);
  });

  test("resolves block child at wrapper-boundary selection (Lexical/Reddit)", () => {
    // Lexical-style structure: root > wrapper div > p.first + p.second
    const container = createEditor(
      '<div><p class="first" style="font-family: Times, serif; font-size: 14px">Wa</p>' +
        '<p class="second" style="font-family: Georgia, serif; font-size: 18px">S</p></div>',
    );

    // Place caret at (wrapper, 1) — between the two <p>s.
    // This is the wrapper-boundary pattern where anchorNode is the wrapper div.
    setCaret(container.firstChild!, 1);

    const ghost = InlineSuggestionView.render({
      target: container,
      text: " completion",
      caretRect: { left: 50, top: 30, width: 0, height: 18 } as DOMRect,
      doc: document,
    });

    expect(ghost).not.toBeNull();
    // Should resolve to secondP (the block child at offset 1), not the wrapper div
    expect(ghost!.style.fontFamily).toBe("Georgia, serif");
    expect(ghost!.style.fontSize).toBe("18px");
  });

  test("anchors RTL ghost to the caret's right edge and grows leftward", () => {
    const container = createEditor("<p>مرحبا</p>");
    container.style.direction = "rtl";
    setCaretAtTextOffset(container, 5);

    // Anchor from the layout viewport (excludes the vertical scrollbar), not innerWidth.
    Object.defineProperty(document.documentElement, "clientWidth", {
      value: 1000,
      configurable: true,
    });
    // Caret at left=300, right=300 (zero-width).
    const ghost = InlineSuggestionView.render({
      target: container,
      text: " بالعالم",
      caretRect: { left: 300, right: 300, top: 20, width: 0, height: 16 } as DOMRect,
      doc: document,
    });

    expect(ghost).not.toBeNull();
    const style = ghost!.style;
    // RTL ghost is direction-aware and anchored on the right, not the left.
    expect(style.direction).toBe("rtl");
    expect(style.left).toBe("auto");
    expect(style.right).toBe("700px");
    // maxWidth is the space to the LEFT of the caret (caret.left - target.left).
    const targetLeft = container.getBoundingClientRect().left;
    expect(style.maxWidth).toBe(`${300 - targetLeft}px`);

    delete (document.documentElement as unknown as Record<string, unknown>).clientWidth;
  });

  // The first strong character of the suggestion sets the run direction.
  // A neutral suggestion uses the direction of the paragraph.
  test.each([
    ["", "hello", " world", 300, { direction: "ltr", left: "300px", right: "" }],
    // A Latin run in an RTL paragraph continues to the right.
    ["rtl", "مرحبا hel", "lo", 300, { direction: "ltr", left: "300px", right: "" }],
    [
      "rtl",
      "مرحبا",
      " ",
      300,
      { direction: "rtl", left: "auto", right: `${window.innerWidth - 300}px` },
    ],
    // In an LTR editor, the accepted Arabic text goes to the right of the caret.
    ["ltr", "الي", "وم", 108, { direction: "ltr", left: "108px", right: "" }],
    ["rtl", "مرحبا", "abc مرحبا", 300, { direction: "ltr", left: "300px", right: "" }],
  ])(
    "anchors the ghost for root direction %p, paragraph %p, suggestion %p at caret %p",
    (rootDirection, paragraph, suggestion, caretLeft, expected) => {
      const container = createEditor(`<p>${paragraph}</p>`);
      container.style.direction = rootDirection;
      setCaret(container.querySelector("p")!.firstChild!);

      const ghost = InlineSuggestionView.render({
        target: container,
        text: suggestion,
        caretRect: { left: caretLeft, right: caretLeft, top: 20, width: 0, height: 16 } as DOMRect,
        doc: document,
      });

      const { direction, left, right } = ghost!.style;
      expect({ direction, left, right }).toEqual(expected);
    },
  );

  test("runOpposesParagraph detects run/paragraph direction mismatch (Arabic, Hebrew, neutral suffix, Armenian)", () => {
    const ltr = document.createElement("input");
    const rtl = document.createElement("textarea");
    rtl.style.direction = "rtl";
    document.body.append(ltr, rtl);
    const opposes = (target: HTMLElement, token: string, suffix: string) =>
      InlineSuggestionView.runOpposesParagraph({ target, token, suffix, doc: document });

    expect(opposes(ltr, "الي", "وم")).toBe(true);
    expect(opposes(ltr, "של", "ום")).toBe(true);
    expect(opposes(rtl, "של", "ום")).toBe(false);
    expect(opposes(rtl, "الي", "وم")).toBe(false);
    // Neutral suffix follows the typed token's last strong character.
    expect(opposes(rtl, "mp", "3")).toBe(true);
    expect(opposes(ltr, "كتاب", "2")).toBe(true);
    expect(opposes(ltr, "mp", "3")).toBe(false);
    // Any non-RTL letter (Armenian, CJK...) is an LTR run.
    expect(opposes(rtl, "բա", "րև")).toBe(true);
    // Fully neutral text follows the paragraph.
    expect(opposes(rtl, "12", "3")).toBe(false);
  });

  test("does not cap ghost width when the caret sits at the target's start edge", () => {
    const container = createEditor("");
    container.style.direction = "rtl";
    container.style.fontSize = "16px";
    const targetLeft = container.getBoundingClientRect().left;

    const ghost = InlineSuggestionView.render({
      target: container,
      text: "بالعالم",
      caretRect: {
        left: targetLeft + 2,
        right: targetLeft + 2,
        top: 20,
        width: 0,
        height: 16,
      } as DOMRect,
      doc: document,
    });

    expect(ghost).not.toBeNull();
    expect(ghost!.style.maxWidth).toBe("");
  });

  test("renderMirrorPreview copies unicode-bidi from target", () => {
    const input = document.createElement("input");
    input.value = "hello";
    input.style.unicodeBidi = "plaintext";
    document.body.appendChild(input);

    const mirror = InlineSuggestionView.renderMirrorPreview({
      target: input,
      suffix: "!",
      cursorOffset: 5,
      doc: document,
    });

    expect(mirror!.style.unicodeBidi).toBe("plaintext");
  });

  test("renderMirrorPreview creates three spans: before (normal), suffix (ghost), after (normal)", () => {
    const input = document.createElement("input");
    input.value = "highest stand with Spell Checker";
    input.selectionStart = 14;
    input.selectionEnd = 14;
    document.body.appendChild(input);

    const mirror = InlineSuggestionView.renderMirrorPreview({
      target: input,
      suffix: "ards",
      cursorOffset: 14,
      doc: document,
    });

    expect(mirror).not.toBeNull();
    const spans = mirror!.querySelectorAll("span");
    expect(spans.length).toBe(3);
    // Before cursor — normal text colour (mirrors input)
    expect(spans[0]!.textContent).toBe("highest\u00A0stand\u00A0");
    expect(spans[0]!.style.color).not.toBe("transparent");
    expect(spans[0]!.style.opacity).toBe("");
    // Suffix — ghost-styled
    expect(spans[1]!.textContent).toBe("ards");
    expect(spans[1]!.style.opacity).toBe("0.5");
    expect(spans[1]!.style.color).not.toBe("transparent");
    // After cursor — normal text colour (shifted by suffix width)
    expect(spans[2]!.textContent).toBe("with\u00A0Spell\u00A0Checker");
    expect(spans[2]!.style.color).not.toBe("transparent");
    expect(spans[2]!.style.opacity).toBe("");
  });

  test("renderMirrorPreview copies box-model properties from target", () => {
    const input = document.createElement("input");
    input.value = "hello world";
    input.style.padding = "8px";
    input.style.fontSize = "18px";
    document.body.appendChild(input);

    const mirror = InlineSuggestionView.renderMirrorPreview({
      target: input,
      suffix: "!",
      cursorOffset: 5,
      doc: document,
    });

    expect(mirror).not.toBeNull();
    expect(mirror!.style.overflow).toBe("hidden");
    expect(mirror!.style.borderColor).toBe("transparent");
    expect(mirror!.style.position).toBe("fixed");
    expect(mirror!.style.pointerEvents).toBe("none");
  });

  test("renderMirrorPreview applies background color", () => {
    const input = document.createElement("input");
    input.value = "test";
    input.style.backgroundColor = "rgb(0, 128, 255)";
    document.body.appendChild(input);

    const mirror = InlineSuggestionView.renderMirrorPreview({
      target: input,
      suffix: "ing",
      cursorOffset: 4,
      doc: document,
    });

    expect(mirror).not.toBeNull();
    expect(mirror!.style.backgroundColor).toBe("rgb(0, 128, 255)");
  });

  test("renderMirrorPreview returns null when suffix is empty", () => {
    const input = document.createElement("input");
    input.value = "test";
    document.body.appendChild(input);

    const mirror = InlineSuggestionView.renderMirrorPreview({
      target: input,
      suffix: "",
      cursorOffset: 4,
      doc: document,
    });

    expect(mirror).toBeNull();
  });

  test("renderMirrorPreview uses pre-wrap for textarea and preserves real spaces", () => {
    const textarea = document.createElement("textarea");
    textarea.value = "hello world";
    document.body.appendChild(textarea);

    const mirror = InlineSuggestionView.renderMirrorPreview({
      target: textarea,
      suffix: "!",
      cursorOffset: 5,
      doc: document,
    });

    expect(mirror).not.toBeNull();
    expect(mirror!.style.whiteSpace).toBe("pre-wrap");
    expect(mirror!.style.wordWrap).toBe("break-word");
    // Textarea doesn't replace spaces with NBSP
    const spans = mirror!.querySelectorAll("span");
    expect(spans[0]!.textContent).toBe("hello");
    expect(spans[2]!.textContent).toBe(" world");
    // All spans use real text colour
    expect(spans[0]!.style.color).not.toBe("transparent");
    expect(spans[2]!.style.color).not.toBe("transparent");
  });

  test("renderMirrorPreview respects entryId", () => {
    const input = document.createElement("input");
    input.value = "test";
    document.body.appendChild(input);

    InlineSuggestionView.renderMirrorPreview({
      target: input,
      suffix: "ing",
      cursorOffset: 4,
      entryId: 1,
      doc: document,
    });
    InlineSuggestionView.renderMirrorPreview({
      target: input,
      suffix: "ed",
      cursorOffset: 4,
      entryId: 2,
      doc: document,
    });

    const all = document.querySelectorAll(`.${InlineSuggestionView.CLASS_NAME}`);
    expect(all.length).toBe(2);

    InlineSuggestionView.removeForEntry(1, document);
    const remaining = document.querySelectorAll(`.${InlineSuggestionView.CLASS_NAME}`);
    expect(remaining.length).toBe(1);
  });

  test("renderContentEditableMirrorPreview clones DOM content and inserts ghost suffix", () => {
    const container = createEditor("<p>highest stand with Spell Checker</p>");
    // Place cursor at offset 14 (after "highest stand ")
    setCaretAtTextOffset(container, 14);

    const mirror = InlineSuggestionView.renderContentEditableMirrorPreview({
      target: container,
      suffix: "ards",
      doc: document,
    });

    expect(mirror).not.toBeNull();
    // The suffix span is inserted at the cursor position
    const suffixSpan = mirror!.querySelector("span");
    expect(suffixSpan).not.toBeNull();
    expect(suffixSpan!.textContent).toBe("ards");
    expect(suffixSpan!.style.opacity).toBe("0.5");
    // Full text content includes the suffix (splitText at offset 14 = "highest stand " | "with…")
    expect(mirror!.textContent).toBe("highest stand ardswith Spell Checker");
  });

  test("renderContentEditableMirrorPreview preserves inline formatting", () => {
    const container = createEditor("<p>highest <strong>stand</strong> with Spell Checker</p>");
    // Place cursor at offset 5 inside the <strong> ("stand|")
    setCaret(container.querySelector("strong")!.firstChild!, 5);

    const mirror = InlineSuggestionView.renderContentEditableMirrorPreview({
      target: container,
      suffix: "ards",
      doc: document,
    });

    expect(mirror).not.toBeNull();
    // The <strong> tag is preserved in the clone
    const strongClone = mirror!.querySelector("strong");
    expect(strongClone).not.toBeNull();
    // Suffix span is inserted inside the strong (after the split text node)
    const suffixSpan = mirror!.querySelector("span");
    expect(suffixSpan).not.toBeNull();
    expect(suffixSpan!.textContent).toBe("ards");
    expect(suffixSpan!.style.opacity).toBe("0.5");
    // Full text includes both original content and suffix
    expect(mirror!.textContent).toContain("stand");
    expect(mirror!.textContent).toContain("ards");
  });

  test("renderContentEditableMirrorPreview returns null when suffix is empty", () => {
    const container = createEditor("test");
    setCaretAtTextOffset(container, 4);

    const mirror = InlineSuggestionView.renderContentEditableMirrorPreview({
      target: container,
      suffix: "",
      doc: document,
    });

    expect(mirror).toBeNull();
  });

  test("renderContentEditableMirrorPreview positions mirror over block element", () => {
    const container = createEditor("<p>hello world</p>");
    setCaretAtTextOffset(container, 5);

    const mirror = InlineSuggestionView.renderContentEditableMirrorPreview({
      target: container,
      suffix: "!",
      doc: document,
    });

    expect(mirror).not.toBeNull();
    expect(mirror!.style.position).toBe("fixed");
    expect(mirror!.style.pointerEvents).toBe("none");
    expect(mirror!.style.overflow).toBe("hidden");
  });

  test("renderContentEditableMirrorPreview handles element-node caret between inline children", () => {
    // Lexical/ProseMirror pattern: <p><strong>Hello</strong><em>world</em></p>
    const container = createEditor("<p><strong>Hello</strong><em>world</em></p>");
    // Caret on the element node <p> at offset 1 (between <strong> and <em>)
    setCaret(container.firstChild!, 1);

    const mirror = InlineSuggestionView.renderContentEditableMirrorPreview({
      target: container,
      suffix: " ",
      doc: document,
    });

    expect(mirror).not.toBeNull();
    // Suffix span should be between the cloned <strong> and <em>, not at the end.
    const children = Array.from(mirror!.childNodes);
    const suffixIndex = children.findIndex(
      (c) => c.nodeType === Node.ELEMENT_NODE && (c as HTMLElement).style.opacity === "0.5",
    );
    expect(suffixIndex).toBe(1); // index 0 = <strong>, 1 = suffix, 2 = <em>
    expect(children.length).toBe(3);
  });

  test("renderContentEditableMirrorPreview removes trailing token chars from cloned text when cursor is mid-word", () => {
    // Regression for CKEditor-5 inline preview bug: user types "r" inside
    // "the" (cursor at "Th|e") and the suggestion "Three" should show the
    // final text — not leave the stale "e" after the ghost suffix.
    const container = createEditor("<p>Thre dog walked the street</p>");
    setCaretAtTextOffset(container, 3); // cursor after "Thr"

    const mirror = InlineSuggestionView.renderContentEditableMirrorPreview({
      target: container,
      suffix: "ee",
      trailingTokenText: "e",
      doc: document,
    });

    expect(mirror).not.toBeNull();
    const suffixSpan = mirror!.querySelector("span");
    expect(suffixSpan).not.toBeNull();
    expect(suffixSpan!.textContent).toBe("ee");
    expect(suffixSpan!.style.opacity).toBe("0.5");
    // The stale trailing "e" must be gone so the preview reads "Three dog walked the street".
    expect(mirror!.textContent).toBe("Three dog walked the street");
  });

  test("renderContentEditableMirrorPreview leaves trailing text intact when trailingTokenText is empty", () => {
    // When cursor sits at a word boundary (end of word, before space),
    // no trailing chars should be consumed — this matches the acceptance
    // behaviour where trailingTokenText is empty and "with…" stays as-is.
    const container = createEditor("<p>highest stand with Spell Checker</p>");
    setCaretAtTextOffset(container, 14);

    const mirror = InlineSuggestionView.renderContentEditableMirrorPreview({
      target: container,
      suffix: "ards",
      trailingTokenText: "",
      doc: document,
    });

    expect(mirror).not.toBeNull();
    expect(mirror!.textContent).toBe("highest stand ardswith Spell Checker");
  });

  test("renderContentEditableMirrorPreview removes trailing token across inline element boundaries", () => {
    // Caret inside <strong>, with the rest of the word in a following
    // <em> sibling — the trailing-token removal must walk forward across
    // element boundaries so formatted words are handled correctly.
    const container = createEditor("<p><strong>Th</strong><em>re</em> more</p>");
    setCaret(container.querySelector("strong")!.firstChild!); // caret at end of "Th" inside <strong>

    const mirror = InlineSuggestionView.renderContentEditableMirrorPreview({
      target: container,
      suffix: "ree",
      trailingTokenText: "re",
      doc: document,
    });

    expect(mirror).not.toBeNull();
    // Expect the "re" that lived in <em> to be removed, leaving the preview
    // as "Th" + "ree" (ghost) + " more".
    expect(mirror!.textContent).toBe("Three more");
  });

  test("renderMirrorPreview removes trailing token chars from after-cursor text for input mid-word", () => {
    const input = document.createElement("input");
    input.value = "Thre dog walked the street";
    document.body.appendChild(input);

    const mirror = InlineSuggestionView.renderMirrorPreview({
      target: input,
      suffix: "ee",
      cursorOffset: 3,
      trailingTokenText: "e",
      doc: document,
    });

    expect(mirror).not.toBeNull();
    const spans = mirror!.querySelectorAll("span");
    expect(spans.length).toBe(3);
    expect(spans[0]!.textContent).toBe("Thr");
    expect(spans[1]!.textContent).toBe("ee");
    // The trailing "e" is gone; the after-span starts at the space.
    expect(spans[2]!.textContent).toBe("\u00A0dog\u00A0walked\u00A0the\u00A0street");
  });

  test("renderContentEditableMirrorPreview preserves pre whitespace for <pre> blocks", () => {
    const container = createEditor("<pre>line1\n  indented</pre>");
    setCaretAtTextOffset(container, 5);

    const mirror = InlineSuggestionView.renderContentEditableMirrorPreview({
      target: container,
      suffix: "!",
      doc: document,
    });

    expect(mirror).not.toBeNull();
    // whiteSpace should be copied from the <pre> computed style,
    // preserving preformatted spacing/newlines.
    expect(mirror!.style.whiteSpace).toBe("pre");
  });

  test("removeForEntry only removes ghost for the specified entry", () => {
    const caretRect = { left: 0, top: 0, width: 0, height: 16 } as DOMRect;

    InlineSuggestionView.render({
      target: document.body,
      text: "aaa",
      caretRect,
      entryId: 1,
      doc: document,
    });
    InlineSuggestionView.render({
      target: document.body,
      text: "bbb",
      caretRect,
      entryId: 2,
      doc: document,
    });

    const allBefore = document.querySelectorAll(`.${InlineSuggestionView.CLASS_NAME}`);
    // render() calls removeForEntry(entryId) which only removes same-entry ghosts,
    // so both entry 1 and entry 2 ghosts coexist
    expect(allBefore.length).toBe(2);

    InlineSuggestionView.removeForEntry(1, document);

    const remaining = document.querySelectorAll(`.${InlineSuggestionView.CLASS_NAME}`);
    expect(remaining.length).toBe(1);
    expect(remaining[0]!.textContent).toBe("bbb");
  });

  test("hasForEntry reports only a drawn preview for that entry", () => {
    const caretRect = { left: 0, top: 0, width: 0, height: 16 } as DOMRect;
    InlineSuggestionView.removeAll(document);
    expect(InlineSuggestionView.hasForEntry(1, document)).toBe(false);
    InlineSuggestionView.render({
      target: document.body,
      text: "aaa",
      caretRect,
      entryId: 1,
      doc: document,
    });
    expect(InlineSuggestionView.hasForEntry(1, document)).toBe(true);
    expect(InlineSuggestionView.hasForEntry(2, document)).toBe(false);
    InlineSuggestionView.removeForEntry(1, document);
    expect(InlineSuggestionView.hasForEntry(1, document)).toBe(false);
  });
});
