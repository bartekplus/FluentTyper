import { describe, expect, jest, test } from "bun:test";
import { SuggestionPredictionCoordinator } from "../src/adapters/chrome/content-script/suggestions/SuggestionPredictionCoordinator";
import { createSuggestionEntry } from "./suggestionTestUtils";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("SuggestionPredictionCoordinator", () => {
  test("force scheduling sends prediction request immediately", () => {
    const getPrediction = jest.fn();
    const coordinator = new SuggestionPredictionCoordinator({
      debounceMs: 120,
      getPrediction,
      lang: "en_US",
      minWordLengthToPredict: 2,
      separatorRegex: /\s+/,
    });

    const input = document.createElement("input");
    input.value = "hello";
    input.selectionStart = 5;
    input.selectionEnd = 5;
    const entry = createSuggestionEntry({ id: 9, elem: input });

    coordinator.schedule(entry, { force: true, clearSuggestions: jest.fn() });

    expect(getPrediction).toHaveBeenCalledTimes(1);
    expect(getPrediction).toHaveBeenCalledWith({
      text: "hello",
      nextChar: "",
      suggestionId: 9,
      requestId: 1,
      lang: "en_US",
    });
    expect(entry.latestMentionText).toBe("hello");
  });

  test("non-force schedule clears suggestions when input is too short", async () => {
    const getPrediction = jest.fn();
    const clearSuggestions = jest.fn();
    const coordinator = new SuggestionPredictionCoordinator({
      debounceMs: 0,
      getPrediction,
      lang: "en_US",
      minWordLengthToPredict: 3,
      separatorRegex: /\s+/,
    });

    const input = document.createElement("input");
    input.value = "hi";
    input.selectionStart = 2;
    input.selectionEnd = 2;
    const entry = createSuggestionEntry({ id: 1, elem: input });

    coordinator.schedule(entry, { force: false, clearSuggestions });
    await wait(5);

    expect(getPrediction).not.toHaveBeenCalled();
    expect(clearSuggestions).toHaveBeenCalledTimes(1);
  });

  test("passes inputAction in prediction request when provided", async () => {
    const getPrediction = jest.fn();
    const coordinator = new SuggestionPredictionCoordinator({
      debounceMs: 0,
      getPrediction,
      lang: "en_US",
      minWordLengthToPredict: 1,
      separatorRegex: /\s+/,
    });

    const input = document.createElement("input");
    input.value = "Hello.";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    const entry = createSuggestionEntry({ id: 2, elem: input });

    coordinator.schedule(entry, {
      force: false,
      clearSuggestions: jest.fn(),
      inputAction: "delete",
    });
    await wait(5);

    expect(getPrediction).toHaveBeenCalledWith({
      text: "Hello.",
      nextChar: "",
      suggestionId: 2,
      requestId: 1,
      lang: "en_US",
      inputAction: "delete",
    });
  });
});
