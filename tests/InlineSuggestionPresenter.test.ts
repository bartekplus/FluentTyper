import { afterEach, describe, expect, jest, test } from "bun:test";
import { InlineSuggestionPresenter } from "../src/adapters/chrome/content-script/suggestions/InlineSuggestionPresenter";
import { InlineSuggestionView } from "../src/adapters/chrome/content-script/suggestions/InlineSuggestionView";
import type { SuggestionPositioningService } from "../src/adapters/chrome/content-script/suggestions/SuggestionPositioningService";
import { createEditor, setCaret, setCaretAtTextOffset } from "./codeContextTestUtils";
import { createRect, createSuggestionEntry, findLastWord } from "./suggestionTestUtils";

function setupInputPresenter({
  value,
  suggestion,
  token = value,
  cursor = value.length,
  tag = "input",
  direction,
  getCaretRect = () => createRect(),
  resolveTrailingToken,
}: {
  value: string;
  suggestion: string;
  token?: string;
  cursor?: number;
  tag?: "input" | "textarea";
  direction?: "ltr" | "rtl";
  getCaretRect?: () => DOMRect | null;
  resolveTrailingToken?: (afterCursor: string) => string;
}) {
  const positioning = {
    getCaretRect: jest.fn(getCaretRect),
  } as unknown as SuggestionPositioningService;
  const presenter = new InlineSuggestionPresenter({ positioningService: positioning });
  const input = document.createElement(tag);
  if (direction) {
    input.style.direction = direction;
  }
  document.body.appendChild(input);
  input.value = value;
  input.setSelectionRange(cursor, cursor);
  const entry = createSuggestionEntry({
    elem: input,
    inlineSuggestion: suggestion,
    latestMentionText: token,
  });
  const render = () =>
    presenter.renderForEntry({
      enabled: true,
      entry,
      resolveMentionToken: () => ({ token, start: cursor - token.length }),
      resolveTrailingToken,
    });
  return { entry, render, presenter };
}

describe("InlineSuggestionPresenter", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    InlineSuggestionView.removeForEntry(undefined, document);
  });

  test("renders inline suffix for matching suggestion", () => {
    const renderSpy = jest
      .spyOn(InlineSuggestionView, "render")
      .mockImplementation(() => document.createElement("div"));
    const mirrorPreviewSpy = jest
      .spyOn(InlineSuggestionView, "renderMirrorPreview")
      .mockImplementation(() => document.createElement("div"));
    const removeForEntrySpy = jest
      .spyOn(InlineSuggestionView, "removeForEntry")
      .mockImplementation(() => undefined);
    const { render } = setupInputPresenter({ value: "fun", suggestion: "function" });

    render();

    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(renderSpy.mock.calls[0]?.[0].text).toBe("ction");
    expect(mirrorPreviewSpy).not.toHaveBeenCalled();
    expect(removeForEntrySpy).not.toHaveBeenCalled();
  });

  // Snippet expansions (#397) replace the typed shortcut instead of extending it.
  test("previews a text expansion after the typed shortcut", () => {
    const { entry, render, presenter } = setupInputPresenter({
      value: "fun brb",
      token: "brb",
      suggestion: "hello ",
    });
    entry.inlineSuggestionToken = "brb";

    render();

    const mirror = document.querySelector(".ft-suggestion-inline");
    // The typed shortcut stays visible; the expansion is annotated after it.
    expect(mirror?.textContent?.replace(/\u00a0/g, " ")).toBe("fun brb → hello");
    expect(entry.inlineSuggestion).toBe("hello ");
    expect(entry.inlineRenderRejected).toBe(false);
    // Stop the removal observer: later tests reuse the entry id.
    presenter.clearForEntry(entry.id);
  });

  test("renders a text expansion that extends the shortcut as a plain continuation", () => {
    const renderSpy = jest
      .spyOn(InlineSuggestionView, "render")
      .mockImplementation(() => document.createElement("div"));
    const { entry, render } = setupInputPresenter({ value: "sig", suggestion: "signature " });
    entry.inlineSuggestionToken = "sig";

    render();

    // No arrow: the expansion continues what was typed, nothing is replaced.
    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(renderSpy.mock.calls[0]?.[0].text).toBe("nature ");
    expect(entry.inlineSuggestion).toBe("signature ");
  });

  test("drops a non-extending suggestion predicted for a different token", () => {
    const renderSpy = jest.spyOn(InlineSuggestionView, "render");
    const mirrorSpy = jest.spyOn(InlineSuggestionView, "renderMirrorPreview");
    // "function" was predicted for "fun"; the user has since typed "fund".
    const { entry, render } = setupInputPresenter({ value: "fund", suggestion: "function" });
    entry.inlineSuggestionToken = "fun";

    render();

    expect(renderSpy).not.toHaveBeenCalled();
    expect(mirrorSpy).not.toHaveBeenCalled();
    // A hidden ghost must not stay armed for Tab acceptance.
    expect(entry.inlineSuggestion).toBeNull();
    expect(entry.inlineRenderRejected).toBe(true);
  });

  test("annotates a text expansion at the end of a contenteditable", () => {
    const renderSpy = jest
      .spyOn(InlineSuggestionView, "render")
      .mockImplementation(() => document.createElement("div"));
    const presenter = new InlineSuggestionPresenter({
      positioningService: {
        getCaretRect: () => createRect(),
      } as unknown as SuggestionPositioningService,
    });
    const container = createEditor("ok brb");
    setCaret(container.firstChild!);
    const entry = createSuggestionEntry({
      elem: container,
      inlineSuggestion: "be right back ",
      inlineSuggestionToken: "brb",
      latestMentionText: "brb",
    });

    presenter.renderForEntry({
      enabled: true,
      entry,
      resolveMentionToken: () => ({ token: "brb", start: 3 }),
    });

    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(renderSpy.mock.calls[0]?.[0].text).toBe(" → be right back");
    expect(entry.inlineSuggestion).toBe("be right back ");
  });

  test("does not arm a text expansion mid-text in a contenteditable", () => {
    const presenter = new InlineSuggestionPresenter({
      positioningService: {
        getCaretRect: () => createRect(),
      } as unknown as SuggestionPositioningService,
    });
    const container = createEditor("brb later");
    setCaret(container.firstChild!, 3);
    const entry = createSuggestionEntry({
      elem: container,
      inlineSuggestion: "be right back ",
      inlineSuggestionToken: "brb",
      latestMentionText: "brb",
    });

    presenter.renderForEntry({
      enabled: true,
      entry,
      resolveMentionToken: () => ({ token: "brb", start: 0 }),
    });

    expect(entry.inlineSuggestion).toBeNull();
    expect(entry.inlineRenderRejected).toBe(true);
  });

  // The preview must judge the caret's own block, like acceptance does, not the
  // whole editor (a signature below, or the text of the line above).
  function armInContentEditable(
    html: string,
    caretBlock: "first" | "last",
    caretOffset: number,
    suggestion: string,
    token: string,
  ) {
    jest
      .spyOn(InlineSuggestionView, "render")
      .mockImplementation(() => document.createElement("div"));
    const presenter = new InlineSuggestionPresenter({
      positioningService: {
        getCaretRect: () => createRect(),
      } as unknown as SuggestionPositioningService,
    });
    const container = createEditor(html);
    const block = caretBlock === "first" ? container.firstChild! : container.lastChild!;
    setCaret(block.firstChild!, caretOffset);
    const entry = createSuggestionEntry({
      elem: container,
      inlineSuggestion: suggestion,
      inlineSuggestionToken: token,
      latestMentionText: token,
    });
    presenter.renderForEntry({ enabled: true, entry, resolveMentionToken: findLastWord });
    return entry;
  }

  test("arms a text expansion at the end of a line followed by another block (signature)", () => {
    const entry = armInContentEditable(
      "<div>ok brb</div><div>-- Bart</div>",
      "first",
      6,
      "be right back ",
      "brb",
    );
    expect(entry.inlineSuggestion).toBe("be right back ");
  });

  test("arms a text expansion typed on the second line of a contenteditable", () => {
    const entry = armInContentEditable(
      "<div>Hi</div><div>brb</div>",
      "last",
      3,
      "be right back ",
      "brb",
    );
    expect(entry.inlineSuggestion).toBe("be right back ");
  });

  test("arms a completion typed on the second line of a contenteditable", () => {
    const entry = armInContentEditable("<div>Hi</div><div>fun</div>", "last", 3, "function", "fun");
    expect(entry.inlineSuggestion).toBe("function");
  });

  test("drops the accept target when the caret cannot be measured", () => {
    const renderSpy = jest
      .spyOn(InlineSuggestionView, "render")
      .mockImplementation(() => document.createElement("div"));
    const { entry, render } = setupInputPresenter({
      value: "fun",
      suggestion: "function",
      getCaretRect: () => null,
    });

    render();

    expect(renderSpy).not.toHaveBeenCalled();
    expect(entry.inlineSuggestion).toBeNull();
    expect(entry.inlineRenderRejected).toBe(true);
  });

  test("keeps an exact-match suggestion armed without rendering a ghost", () => {
    const renderSpy = jest
      .spyOn(InlineSuggestionView, "render")
      .mockImplementation(() => document.createElement("div"));
    const { entry, render } = setupInputPresenter({ value: "function", suggestion: "function" });

    render();

    expect(renderSpy).not.toHaveBeenCalled();
    expect(entry.inlineSuggestion).toBe("function");
    expect(entry.inlineRenderRejected).toBe(false);
  });

  test("keeps a suggestion armed without a ghost when only white space is left to preview", () => {
    const renderSpy = jest
      .spyOn(InlineSuggestionView, "render")
      .mockImplementation(() => document.createElement("div"));
    const { entry, render } = setupInputPresenter({ value: "function", suggestion: "function " });

    render();

    // An invisible ghost would make Escape look like it closes a suggestion.
    expect(renderSpy).not.toHaveBeenCalled();
    expect(entry.inlineSuggestion).toBe("function ");
    expect(entry.inlineRenderRejected).toBe(false);
  });

  test("clearForEntry only removes ghost for the specified entry", () => {
    const removeForEntrySpy = jest
      .spyOn(InlineSuggestionView, "removeForEntry")
      .mockImplementation(() => undefined);
    const positioning = {
      getCaretRect: jest.fn(() => createRect()),
    } as unknown as SuggestionPositioningService;
    const presenter = new InlineSuggestionPresenter({ positioningService: positioning });

    presenter.clearForEntry(42);

    expect(removeForEntrySpy).toHaveBeenCalledWith(42, expect.anything());
  });

  test("uses renderMirrorPreview for input mid-text", () => {
    const renderSpy = jest
      .spyOn(InlineSuggestionView, "render")
      .mockImplementation(() => document.createElement("div"));
    const mirrorPreviewSpy = jest
      .spyOn(InlineSuggestionView, "renderMirrorPreview")
      .mockImplementation(() => document.createElement("div"));
    const { render } = setupInputPresenter({
      value: "highest stand with Spell Checker",
      suggestion: "standards",
      token: "stand",
      cursor: 14,
    });

    render();

    expect(renderSpy).not.toHaveBeenCalled();
    expect(mirrorPreviewSpy).toHaveBeenCalledTimes(1);
    expect(mirrorPreviewSpy.mock.calls[0]?.[0].suffix).toBe("ards");
    expect(mirrorPreviewSpy.mock.calls[0]?.[0].cursorOffset).toBe(14);
  });

  test("uses renderContentEditableMirrorPreview for contenteditable mid-text", () => {
    const renderSpy = jest
      .spyOn(InlineSuggestionView, "render")
      .mockImplementation(() => document.createElement("div"));
    const mirrorPreviewSpy = jest
      .spyOn(InlineSuggestionView, "renderMirrorPreview")
      .mockImplementation(() => document.createElement("div"));
    const ceMirrorSpy = jest
      .spyOn(InlineSuggestionView, "renderContentEditableMirrorPreview")
      .mockImplementation(() => document.createElement("div"));
    const positioning = {
      getCaretRect: jest.fn(() => createRect()),
    } as unknown as SuggestionPositioningService;
    const presenter = new InlineSuggestionPresenter({ positioningService: positioning });

    const container = createEditor("highest stand with Spell Checker");
    setCaretAtTextOffset(container, 14);

    const entry = createSuggestionEntry({
      elem: container,
      inlineSuggestion: "standards",
      latestMentionText: "stand",
    });

    presenter.renderForEntry({
      enabled: true,
      entry,
      resolveMentionToken: () => ({ token: "stand", start: 8 }),
    });

    expect(renderSpy).not.toHaveBeenCalled();
    expect(mirrorPreviewSpy).not.toHaveBeenCalled();
    expect(ceMirrorSpy).toHaveBeenCalledTimes(1);
    expect(ceMirrorSpy.mock.calls[0]?.[0].suffix).toBe("ards");
  });

  test("passes trailingTokenText from resolveTrailingToken into mid-text previews", () => {
    const mirrorPreviewSpy = jest
      .spyOn(InlineSuggestionView, "renderMirrorPreview")
      .mockImplementation(() => document.createElement("div"));
    const ceMirrorSpy = jest
      .spyOn(InlineSuggestionView, "renderContentEditableMirrorPreview")
      .mockImplementation(() => document.createElement("div"));
    const resolveTrailingToken = (afterCursor: string) => afterCursor.match(/^\S+/)?.[0] ?? "";

    // Input mid-text: cursor at "Thr|e dog…" — trailing token is "e".
    const { render, presenter } = setupInputPresenter({
      value: "Thre dog walked the street",
      suggestion: "Three",
      token: "Thr",
      cursor: 3,
      resolveTrailingToken,
    });

    render();

    expect(mirrorPreviewSpy).toHaveBeenCalledTimes(1);
    expect(mirrorPreviewSpy.mock.calls[0]?.[0].suffix).toBe("ee");
    expect(mirrorPreviewSpy.mock.calls[0]?.[0].trailingTokenText).toBe("e");

    // Contenteditable mid-text: same expectation for the CE preview path.
    const container = createEditor("Thre dog walked the street");
    setCaretAtTextOffset(container, 3);

    const ceEntry = createSuggestionEntry({
      elem: container,
      inlineSuggestion: "Three",
      latestMentionText: "Thr",
    });

    presenter.renderForEntry({
      enabled: true,
      entry: ceEntry,
      resolveMentionToken: () => ({ token: "Thr", start: 0 }),
      resolveTrailingToken,
    });

    expect(ceMirrorSpy).toHaveBeenCalledTimes(1);
    expect(ceMirrorSpy.mock.calls[0]?.[0].suffix).toBe("ee");
    expect(ceMirrorSpy.mock.calls[0]?.[0].trailingTokenText).toBe("e");
  });

  test("uses the mirror preview when an RTL completion ends an LTR input (floating ghost cannot place it)", () => {
    const renderSpy = jest
      .spyOn(InlineSuggestionView, "render")
      .mockImplementation(() => document.createElement("div"));
    const mirrorPreviewSpy = jest
      .spyOn(InlineSuggestionView, "renderMirrorPreview")
      .mockImplementation(() => document.createElement("div"));
    const { render } = setupInputPresenter({ value: "الي", suggestion: "اليوم" });

    render();

    expect(renderSpy).not.toHaveBeenCalled();
    expect(mirrorPreviewSpy).toHaveBeenCalledTimes(1);
    expect(mirrorPreviewSpy.mock.calls[0]?.[0].suffix).toBe("وم");
  });

  test("uses the floating ghost for an RTL completion in an RTL textarea", () => {
    const renderSpy = jest
      .spyOn(InlineSuggestionView, "render")
      .mockImplementation(() => document.createElement("div"));
    const mirrorPreviewSpy = jest
      .spyOn(InlineSuggestionView, "renderMirrorPreview")
      .mockImplementation(() => document.createElement("div"));
    const { render } = setupInputPresenter({
      value: "של",
      suggestion: "שלום",
      tag: "textarea",
      direction: "rtl",
    });

    render();

    expect(mirrorPreviewSpy).not.toHaveBeenCalled();
    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(renderSpy.mock.calls[0]?.[0].text).toBe("ום");
  });

  test("ignores Arabic tatweel in the typed word when matching the suggestion", () => {
    const renderSpy = jest
      .spyOn(InlineSuggestionView, "render")
      .mockImplementation(() => document.createElement("div"));
    const { render } = setupInputPresenter({
      value: "كتـــا",
      suggestion: "كتاب",
      direction: "rtl",
    });

    render();

    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(renderSpy.mock.calls[0]?.[0].text).toBe("ب");
  });

  test("re-renders ghost when externally removed from DOM", async () => {
    const { render } = setupInputPresenter({ value: "he", suggestion: "hello" });

    render();

    const ghostsBefore = document.querySelectorAll(`.${InlineSuggestionView.CLASS_NAME}`);
    expect(ghostsBefore.length).toBe(1);

    // Simulate external removal (e.g. Google Translate DOM rebuild)
    ghostsBefore[0]!.remove();

    // MutationObserver fires asynchronously; wait for microtask + observer
    await new Promise((resolve) => setTimeout(resolve, 0));

    const ghostsAfter = document.querySelectorAll(`.${InlineSuggestionView.CLASS_NAME}`);
    expect(ghostsAfter.length).toBe(1);
  });

  test("records a rejected re-render after external ghost removal", async () => {
    let caret: DOMRect | null = createRect();
    const { entry, render } = setupInputPresenter({
      value: "he",
      suggestion: "hello",
      getCaretRect: () => caret,
    });

    render();
    expect(entry.inlineRenderRejected).toBe(false);

    caret = null;
    document.querySelector(`.${InlineSuggestionView.CLASS_NAME}`)!.remove();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(entry.inlineSuggestion).toBeNull();
    expect(entry.inlineRenderRejected).toBe(true);
  });
});
