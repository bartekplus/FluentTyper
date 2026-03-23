import { afterEach, describe, expect, jest, test } from "bun:test";
import { InlineSuggestionPresenter } from "../src/adapters/chrome/content-script/suggestions/InlineSuggestionPresenter";
import { InlineSuggestionView } from "../src/adapters/chrome/content-script/suggestions/InlineSuggestionView";
import type { SuggestionPositioningService } from "../src/adapters/chrome/content-script/suggestions/SuggestionPositioningService";
import { createRect, createSuggestionEntry } from "./suggestionTestUtils";

describe("InlineSuggestionPresenter", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    InlineSuggestionView.removeAll(document);
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

  test("clears inline UI when suggestion does not match mention prefix", () => {
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
      inlineSuggestion: "hello",
      latestMentionText: "fun",
    });

    presenter.renderForEntry({
      enabled: true,
      entry,
      resolveMentionToken: () => ({ token: "fun", start: 0 }),
    });

    expect(renderSpy).not.toHaveBeenCalled();
    expect(removeForEntrySpy).toHaveBeenCalled();
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

  test("clearAll removes all ghost elements globally", () => {
    const removeAllSpy = jest
      .spyOn(InlineSuggestionView, "removeAll")
      .mockImplementation(() => undefined);
    const positioning = {
      getCaretRect: jest.fn(() => createRect()),
    } as unknown as SuggestionPositioningService;
    const presenter = new InlineSuggestionPresenter({ positioningService: positioning });

    presenter.clearAll();

    expect(removeAllSpy).toHaveBeenCalledTimes(1);
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
});
