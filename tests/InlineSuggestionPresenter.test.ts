import { afterEach, describe, expect, jest, test } from "bun:test";
import { InlineSuggestionPresenter } from "../src/adapters/chrome/content-script/suggestions/InlineSuggestionPresenter";
import { InlineSuggestionView } from "../src/adapters/chrome/content-script/suggestions/InlineSuggestionView";
import type { SuggestionPositioningService } from "../src/adapters/chrome/content-script/suggestions/SuggestionPositioningService";
import { createRect, createSuggestionEntry } from "./suggestionTestUtils";

function setupInputPresenter({
  value,
  suggestion,
  token = value,
  direction,
  getCaretRect = () => createRect(),
}: {
  value: string;
  suggestion: string;
  token?: string;
  direction?: "ltr" | "rtl";
  getCaretRect?: () => DOMRect | null;
}) {
  const positioning = {
    getCaretRect: jest.fn(getCaretRect),
  } as unknown as SuggestionPositioningService;
  const presenter = new InlineSuggestionPresenter({ positioningService: positioning });
  const input = document.createElement("input");
  if (direction) {
    input.style.direction = direction;
  }
  document.body.appendChild(input);
  input.value = value;
  input.selectionStart = value.length;
  input.selectionEnd = value.length;
  const entry = createSuggestionEntry({
    elem: input,
    inlineSuggestion: suggestion,
    latestMentionText: token,
  });
  const render = () =>
    presenter.renderForEntry({
      enabled: true,
      entry,
      resolveMentionToken: () => ({ token, start: value.length - token.length }),
    });
  return { entry, render, presenter };
}

describe("InlineSuggestionPresenter", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    InlineSuggestionView.removeAll(document);
    document.body.replaceChildren();
  });

  test("renders inline suffix for matching suggestion", () => {
    const renderSpy = jest
      .spyOn(InlineSuggestionView, "render")
      .mockImplementation(() => undefined);
    const removeForEntrySpy = jest
      .spyOn(InlineSuggestionView, "removeForEntry")
      .mockImplementation(() => undefined);
    const positioning = {
      getCaretRect: jest.fn(() => createRect()),
    } as unknown as SuggestionPositioningService;
    const presenter = new InlineSuggestionPresenter({ positioningService: positioning });

    const input = document.createElement("input");
    input.value = "fun";
    input.selectionStart = 3;
    input.selectionEnd = 3;
    const entry = createSuggestionEntry({
      elem: input,
      inlineSuggestion: "function",
      latestMentionText: "fun",
    });

    presenter.renderForEntry({
      enabled: true,
      entry,
      resolveMentionToken: () => ({ token: "fun", start: 0 }),
    });

    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(renderSpy.mock.calls[0]?.[0].text).toBe("ction");
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
    const container = document.createElement("div");
    container.contentEditable = "true";
    Object.defineProperty(container, "isContentEditable", { value: true, configurable: true });
    container.textContent = "ok brb";
    document.body.appendChild(container);
    const range = document.createRange();
    range.setStart(container.firstChild!, 6);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
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
    const container = document.createElement("div");
    container.contentEditable = "true";
    Object.defineProperty(container, "isContentEditable", { value: true, configurable: true });
    container.textContent = "brb later";
    document.body.appendChild(container);
    const range = document.createRange();
    range.setStart(container.firstChild!, 3);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
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

  test("drops the accept target when the caret cannot be measured", () => {
    const renderSpy = jest
      .spyOn(InlineSuggestionView, "render")
      .mockImplementation(() => undefined);
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
      .mockImplementation(() => undefined);
    const { entry, render } = setupInputPresenter({ value: "function", suggestion: "function" });

    render();

    expect(renderSpy).not.toHaveBeenCalled();
    expect(entry.inlineSuggestion).toBe("function");
    expect(entry.inlineRenderRejected).toBe(false);
  });

  test("clearForEntry only removes ghost for the specified entry", () => {
    const removeForEntrySpy = jest
      .spyOn(InlineSuggestionView, "removeForEntry")
      .mockImplementation(() => undefined);
    const removeAllSpy = jest
      .spyOn(InlineSuggestionView, "removeAll")
      .mockImplementation(() => undefined);
    const positioning = {
      getCaretRect: jest.fn(() => createRect()),
    } as unknown as SuggestionPositioningService;
    const presenter = new InlineSuggestionPresenter({ positioningService: positioning });

    presenter.clearForEntry(42);

    expect(removeForEntrySpy).toHaveBeenCalledWith(42, expect.anything());
    expect(removeAllSpy).not.toHaveBeenCalled();
  });

  test("uses renderMirrorPreview for input mid-text", () => {
    const renderSpy = jest
      .spyOn(InlineSuggestionView, "render")
      .mockImplementation(() => undefined);
    const mirrorPreviewSpy = jest
      .spyOn(InlineSuggestionView, "renderMirrorPreview")
      .mockImplementation(() => undefined);
    const positioning = {
      getCaretRect: jest.fn(() => createRect()),
    } as unknown as SuggestionPositioningService;
    const presenter = new InlineSuggestionPresenter({ positioningService: positioning });

    const input = document.createElement("input");
    input.value = "highest stand with Spell Checker";
    input.selectionStart = 14;
    input.selectionEnd = 14;
    const entry = createSuggestionEntry({
      elem: input,
      inlineSuggestion: "standards",
      latestMentionText: "stand",
    });

    presenter.renderForEntry({
      enabled: true,
      entry,
      resolveMentionToken: () => ({ token: "stand", start: 8 }),
    });

    expect(renderSpy).not.toHaveBeenCalled();
    expect(mirrorPreviewSpy).toHaveBeenCalledTimes(1);
    expect(mirrorPreviewSpy.mock.calls[0]?.[0].suffix).toBe("ards");
    expect(mirrorPreviewSpy.mock.calls[0]?.[0].cursorOffset).toBe(14);
  });

  test("uses renderContentEditableMirrorPreview for contenteditable mid-text", () => {
    const renderSpy = jest
      .spyOn(InlineSuggestionView, "render")
      .mockImplementation(() => undefined);
    const mirrorPreviewSpy = jest
      .spyOn(InlineSuggestionView, "renderMirrorPreview")
      .mockImplementation(() => undefined);
    const ceMirrorSpy = jest
      .spyOn(InlineSuggestionView, "renderContentEditableMirrorPreview")
      .mockImplementation(() => undefined);
    const positioning = {
      getCaretRect: jest.fn(() => createRect()),
    } as unknown as SuggestionPositioningService;
    const presenter = new InlineSuggestionPresenter({ positioningService: positioning });

    const container = document.createElement("div");
    container.contentEditable = "true";
    Object.defineProperty(container, "isContentEditable", { value: true, configurable: true });
    container.textContent = "highest stand with Spell Checker";
    document.body.appendChild(container);

    // Set up selection mid-text
    const textNode = container.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 14);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

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

    container.remove();
  });

  test("passes trailingTokenText from resolveTrailingToken into mid-text previews", () => {
    const mirrorPreviewSpy = jest
      .spyOn(InlineSuggestionView, "renderMirrorPreview")
      .mockImplementation(() => undefined);
    const ceMirrorSpy = jest
      .spyOn(InlineSuggestionView, "renderContentEditableMirrorPreview")
      .mockImplementation(() => undefined);
    const positioning = {
      getCaretRect: jest.fn(() => createRect()),
    } as unknown as SuggestionPositioningService;
    const presenter = new InlineSuggestionPresenter({ positioningService: positioning });

    // Input mid-text: cursor at "Thr|e dog…" — trailing token is "e".
    const input = document.createElement("input");
    input.value = "Thre dog walked the street";
    input.selectionStart = 3;
    input.selectionEnd = 3;
    const inputEntry = createSuggestionEntry({
      elem: input,
      inlineSuggestion: "Three",
      latestMentionText: "Thr",
    });

    presenter.renderForEntry({
      enabled: true,
      entry: inputEntry,
      resolveMentionToken: () => ({ token: "Thr", start: 0 }),
      resolveTrailingToken: (afterCursor) => {
        const match = afterCursor.match(/^\S+/);
        return match?.[0] ?? "";
      },
    });

    expect(mirrorPreviewSpy).toHaveBeenCalledTimes(1);
    expect(mirrorPreviewSpy.mock.calls[0]?.[0].suffix).toBe("ee");
    expect(mirrorPreviewSpy.mock.calls[0]?.[0].trailingTokenText).toBe("e");

    // Contenteditable mid-text: same expectation for the CE preview path.
    const container = document.createElement("div");
    container.contentEditable = "true";
    Object.defineProperty(container, "isContentEditable", { value: true, configurable: true });
    container.textContent = "Thre dog walked the street";
    document.body.appendChild(container);

    const textNode = container.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 3);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    const ceEntry = createSuggestionEntry({
      elem: container,
      inlineSuggestion: "Three",
      latestMentionText: "Thr",
    });

    presenter.renderForEntry({
      enabled: true,
      entry: ceEntry,
      resolveMentionToken: () => ({ token: "Thr", start: 0 }),
      resolveTrailingToken: (afterCursor) => {
        const match = afterCursor.match(/^\S+/);
        return match?.[0] ?? "";
      },
    });

    expect(ceMirrorSpy).toHaveBeenCalledTimes(1);
    expect(ceMirrorSpy.mock.calls[0]?.[0].suffix).toBe("ee");
    expect(ceMirrorSpy.mock.calls[0]?.[0].trailingTokenText).toBe("e");

    container.remove();
  });

  test("uses standard render when caret is at end of text", () => {
    const renderSpy = jest
      .spyOn(InlineSuggestionView, "render")
      .mockImplementation(() => undefined);
    const mirrorPreviewSpy = jest
      .spyOn(InlineSuggestionView, "renderMirrorPreview")
      .mockImplementation(() => undefined);
    const positioning = {
      getCaretRect: jest.fn(() => createRect()),
    } as unknown as SuggestionPositioningService;
    const presenter = new InlineSuggestionPresenter({ positioningService: positioning });

    const input = document.createElement("input");
    input.value = "fun";
    input.selectionStart = 3;
    input.selectionEnd = 3;
    const entry = createSuggestionEntry({
      elem: input,
      inlineSuggestion: "function",
      latestMentionText: "fun",
    });

    presenter.renderForEntry({
      enabled: true,
      entry,
      resolveMentionToken: () => ({ token: "fun", start: 0 }),
    });

    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(mirrorPreviewSpy).not.toHaveBeenCalled();
  });

  test("uses the mirror preview when an RTL completion ends an LTR input (floating ghost cannot place it)", () => {
    const renderSpy = jest
      .spyOn(InlineSuggestionView, "render")
      .mockImplementation(() => undefined);
    const mirrorPreviewSpy = jest
      .spyOn(InlineSuggestionView, "renderMirrorPreview")
      .mockImplementation(() => undefined);
    const { render } = setupInputPresenter({ value: "الي", suggestion: "اليوم" });

    render();

    expect(renderSpy).not.toHaveBeenCalled();
    expect(mirrorPreviewSpy).toHaveBeenCalledTimes(1);
    expect(mirrorPreviewSpy.mock.calls[0]?.[0].suffix).toBe("وم");
  });

  test("uses the floating ghost for an RTL completion in an RTL textarea", () => {
    const renderSpy = jest
      .spyOn(InlineSuggestionView, "render")
      .mockImplementation(() => undefined);
    const mirrorPreviewSpy = jest
      .spyOn(InlineSuggestionView, "renderMirrorPreview")
      .mockImplementation(() => undefined);
    const positioning = {
      getCaretRect: jest.fn(() => createRect()),
    } as unknown as SuggestionPositioningService;
    const presenter = new InlineSuggestionPresenter({ positioningService: positioning });

    const textarea = document.createElement("textarea");
    textarea.dir = "rtl";
    textarea.style.direction = "rtl";
    document.body.appendChild(textarea);
    textarea.value = "של";
    textarea.selectionStart = 2;
    textarea.selectionEnd = 2;
    const entry = createSuggestionEntry({
      elem: textarea,
      inlineSuggestion: "שלום",
      latestMentionText: "של",
    });

    presenter.renderForEntry({
      enabled: true,
      entry,
      resolveMentionToken: () => ({ token: "של", start: 0 }),
    });

    expect(mirrorPreviewSpy).not.toHaveBeenCalled();
    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(renderSpy.mock.calls[0]?.[0].text).toBe("ום");
    textarea.remove();
  });

  test("ignores Arabic tatweel in the typed word when matching the suggestion", () => {
    const renderSpy = jest
      .spyOn(InlineSuggestionView, "render")
      .mockImplementation(() => undefined);
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
    const positioning = {
      getCaretRect: jest.fn(() => createRect()),
    } as unknown as SuggestionPositioningService;
    const presenter = new InlineSuggestionPresenter({ positioningService: positioning });

    const input = document.createElement("input");
    input.value = "he";
    input.selectionStart = 2;
    input.selectionEnd = 2;
    const entry = createSuggestionEntry({
      elem: input,
      inlineSuggestion: "hello",
      latestMentionText: "he",
    });

    presenter.renderForEntry({
      enabled: true,
      entry,
      resolveMentionToken: () => ({ token: "he", start: 0 }),
    });

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
