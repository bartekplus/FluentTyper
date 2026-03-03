import { afterEach, describe, expect, jest, test } from "bun:test";
import { InlineSuggestionPresenter } from "../src/adapters/chrome/content-script/suggestions/InlineSuggestionPresenter";
import { InlineSuggestionView } from "../src/adapters/chrome/content-script/suggestions/InlineSuggestionView";
import { SuggestionPositioningService } from "../src/adapters/chrome/content-script/suggestions/SuggestionPositioningService";
import { createRect, createSuggestionEntry } from "./suggestionTestUtils";

describe("InlineSuggestionPresenter", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    document.body.innerHTML = "";
  });

  test("renders inline suffix for matching suggestion", () => {
    const renderSpy = jest.spyOn(InlineSuggestionView, "render").mockImplementation(() => undefined);
    const removeAllSpy = jest
      .spyOn(InlineSuggestionView, "removeAll")
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
    expect(removeAllSpy).not.toHaveBeenCalled();
  });

  test("clears inline UI when suggestion does not match mention prefix", () => {
    const renderSpy = jest.spyOn(InlineSuggestionView, "render").mockImplementation(() => undefined);
    const removeAllSpy = jest
      .spyOn(InlineSuggestionView, "removeAll")
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
    expect(removeAllSpy).toHaveBeenCalled();
  });
});
