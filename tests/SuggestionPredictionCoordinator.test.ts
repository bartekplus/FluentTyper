import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { SuggestionPredictionCoordinator } from "../src/adapters/chrome/content-script/suggestions/SuggestionPredictionCoordinator";
import { createSuggestionEntry } from "./suggestionTestUtils";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const FIXED_DEBOUNCE_BY_ACTION = {
  insert: 120,
  delete: 60,
  other: 120,
};

const ZERO_DEBOUNCE_BY_ACTION = {
  insert: 0,
  delete: 0,
  other: 0,
};

describe("SuggestionPredictionCoordinator", () => {
  test("force scheduling sends prediction request immediately", () => {
    const getPrediction = jest.fn();
    const coordinator = new SuggestionPredictionCoordinator({
      debounceByAction: FIXED_DEBOUNCE_BY_ACTION,
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
    expect(getPrediction).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "hello",
        nextChar: "",
        suggestionId: 9,
        requestId: 1,
        lang: "en_US",
        traceId: expect.any(String),
        traceStartedAtMs: expect.any(Number),
      }),
    );
    expect(entry.latestMentionText).toBe("hello");
  });

  test("non-force schedule clears suggestions when input is too short", async () => {
    const getPrediction = jest.fn();
    const clearSuggestions = jest.fn();
    const coordinator = new SuggestionPredictionCoordinator({
      debounceByAction: ZERO_DEBOUNCE_BY_ACTION,
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
    expect(entry.requestId).toBe(1);
  });

  test("passes inputAction in prediction request when provided", async () => {
    const getPrediction = jest.fn();
    const coordinator = new SuggestionPredictionCoordinator({
      debounceByAction: ZERO_DEBOUNCE_BY_ACTION,
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

    expect(getPrediction).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Hello.",
        nextChar: "",
        suggestionId: 2,
        requestId: 1,
        lang: "en_US",
        inputAction: "delete",
        traceId: expect.any(String),
        traceStartedAtMs: expect.any(Number),
      }),
    );
  });

  test("clears suggestions without requesting predictions when disabled by threshold", async () => {
    const getPrediction = jest.fn();
    const clearSuggestions = jest.fn();
    const coordinator = new SuggestionPredictionCoordinator({
      debounceByAction: ZERO_DEBOUNCE_BY_ACTION,
      getPrediction,
      lang: "en_US",
      minWordLengthToPredict: -1,
      separatorRegex: /\s+/,
    });

    const input = document.createElement("input");
    input.value = "Hello.";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    const entry = createSuggestionEntry({ id: 3, elem: input });

    coordinator.schedule(entry, { force: false, clearSuggestions });
    await wait(5);

    expect(clearSuggestions).toHaveBeenCalledTimes(1);
    expect(getPrediction).not.toHaveBeenCalled();
  });

  test("does not request predictions when disabled by threshold", async () => {
    const getPrediction = jest.fn();
    const clearSuggestions = jest.fn();
    const coordinator = new SuggestionPredictionCoordinator({
      debounceByAction: ZERO_DEBOUNCE_BY_ACTION,
      getPrediction,
      lang: "en_US",
      minWordLengthToPredict: -1,
      separatorRegex: /\s+/,
    });

    const input = document.createElement("input");
    input.value = "Hello.";
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    const entry = createSuggestionEntry({ id: 4, elem: input });

    coordinator.schedule(entry, { force: false, clearSuggestions });
    await wait(5);

    expect(clearSuggestions).toHaveBeenCalledTimes(1);
    expect(getPrediction).not.toHaveBeenCalled();
  });

  describe("isSeparator", () => {
    function makeCoordinator(separatorRegex: RegExp) {
      return new SuggestionPredictionCoordinator({
        debounceByAction: ZERO_DEBOUNCE_BY_ACTION,
        getPrediction: jest.fn(),
        lang: "en_US",
        minWordLengthToPredict: 1,
        separatorRegex,
      });
    }

    test("returns true for characters matching the separator regex", () => {
      const coordinator = makeCoordinator(/\s/);
      expect(coordinator.isSeparator(" ")).toBe(true);
      expect(coordinator.isSeparator("\t")).toBe(true);
      expect(coordinator.isSeparator("\n")).toBe(true);
    });

    test("returns false for non-separator characters", () => {
      const coordinator = makeCoordinator(/\s/);
      expect(coordinator.isSeparator("a")).toBe(false);
      expect(coordinator.isSeparator("!")).toBe(false);
      expect(coordinator.isSeparator("1")).toBe(false);
    });

    test("resets lastIndex for global regex so results are consistent across calls", () => {
      const coordinator = makeCoordinator(/\s/g);
      // Without lastIndex reset, alternating calls on a global regex
      // would flip between truthy and falsy for the same input
      expect(coordinator.isSeparator(" ")).toBe(true);
      expect(coordinator.isSeparator(" ")).toBe(true);
      expect(coordinator.isSeparator("a")).toBe(false);
      expect(coordinator.isSeparator("a")).toBe(false);
    });

    test("resets lastIndex for sticky regex so results are consistent across calls", () => {
      const coordinator = makeCoordinator(/\s/y);
      expect(coordinator.isSeparator(" ")).toBe(true);
      expect(coordinator.isSeparator(" ")).toBe(true);
      expect(coordinator.isSeparator("a")).toBe(false);
      expect(coordinator.isSeparator("a")).toBe(false);
    });

    test("non-global non-sticky regex works correctly without needing lastIndex reset", () => {
      const coordinator = makeCoordinator(/\s/);
      for (let i = 0; i < 5; i++) {
        expect(coordinator.isSeparator(" ")).toBe(true);
        expect(coordinator.isSeparator("a")).toBe(false);
      }
    });
  });

  describe("findMentionToken", () => {
    function makeCoordinator(separatorRegex: RegExp = /\s/) {
      return new SuggestionPredictionCoordinator({
        debounceByAction: ZERO_DEBOUNCE_BY_ACTION,
        getPrediction: jest.fn(),
        lang: "en_US",
        minWordLengthToPredict: 1,
        separatorRegex,
      });
    }

    test("returns entire string when no separator is present", () => {
      const result = makeCoordinator().findMentionToken("hello");
      expect(result.token).toBe("hello");
      expect(result.start).toBe(0);
    });

    test("returns the last word after the final separator", () => {
      const result = makeCoordinator().findMentionToken("hello world");
      expect(result.token).toBe("world");
      expect(result.start).toBe(6);
    });

    test("returns empty token when string ends with a separator", () => {
      const result = makeCoordinator().findMentionToken("hello ");
      expect(result.token).toBe("");
      expect(result.start).toBe(6);
    });

    test("returns empty token and start 0 for empty input", () => {
      const result = makeCoordinator().findMentionToken("");
      expect(result.token).toBe("");
      expect(result.start).toBe(0);
    });

    test("handles multiple separators in a row", () => {
      const result = makeCoordinator().findMentionToken("one   two");
      expect(result.token).toBe("two");
      expect(result.start).toBe(6);
    });

    test("respects a multi-character-class separator regex", () => {
      const result = makeCoordinator(/[\s,!]/).findMentionToken("hello, world!");
      expect(result.token).toBe("");
      expect(result.start).toBe(13);
    });

    test("returns last token in a three-word string", () => {
      const result = makeCoordinator().findMentionToken("one two three");
      expect(result.token).toBe("three");
      expect(result.start).toBe(8);
    });
  });

  describe("updateLang", () => {
    test("changes isSeparator behavior when separator regex is updated", () => {
      const coordinator = new SuggestionPredictionCoordinator({
        debounceByAction: ZERO_DEBOUNCE_BY_ACTION,
        getPrediction: jest.fn(),
        lang: "en_US",
        minWordLengthToPredict: 1,
        separatorRegex: /\s/,
      });

      expect(coordinator.isSeparator(",")).toBe(false);
      coordinator.updateLang("fr_FR", /[\s,]/);
      expect(coordinator.isSeparator(",")).toBe(true);
    });

    test("correctly tracks lastIndex reset need when switching to a global regex", () => {
      const coordinator = new SuggestionPredictionCoordinator({
        debounceByAction: ZERO_DEBOUNCE_BY_ACTION,
        getPrediction: jest.fn(),
        lang: "en_US",
        minWordLengthToPredict: 1,
        separatorRegex: /\s/, // non-global — no reset needed
      });

      coordinator.updateLang("en_US", /\s/g); // now global — must reset lastIndex
      expect(coordinator.isSeparator(" ")).toBe(true);
      expect(coordinator.isSeparator(" ")).toBe(true); // would be false if reset was skipped
    });

    test("affects findMentionToken token boundary after separator change", () => {
      const coordinator = new SuggestionPredictionCoordinator({
        debounceByAction: ZERO_DEBOUNCE_BY_ACTION,
        getPrediction: jest.fn(),
        lang: "en_US",
        minWordLengthToPredict: 1,
        separatorRegex: /\s/,
      });

      // Before update: comma is part of the token
      expect(coordinator.findMentionToken("hello,world").token).toBe("hello,world");

      // After update: comma splits the token
      coordinator.updateLang("en_US", /[\s,]/);
      expect(coordinator.findMentionToken("hello,world").token).toBe("world");
    });
  });

  describe("action-aware debounce timing", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.clearAllTimers();
      jest.useRealTimers();
    });

    test("schedules delete requests faster than insert and other actions", () => {
      const getPrediction = jest.fn();
      const coordinator = new SuggestionPredictionCoordinator({
        debounceByAction: FIXED_DEBOUNCE_BY_ACTION,
        getPrediction,
        lang: "en_US",
        minWordLengthToPredict: 1,
        separatorRegex: /\s+/,
      });

      const deleteInput = document.createElement("input");
      deleteInput.value = "hello";
      deleteInput.selectionStart = deleteInput.value.length;
      deleteInput.selectionEnd = deleteInput.value.length;
      const deleteEntry = createSuggestionEntry({ id: 10, elem: deleteInput });

      const insertInput = document.createElement("input");
      insertInput.value = "hello";
      insertInput.selectionStart = insertInput.value.length;
      insertInput.selectionEnd = insertInput.value.length;
      const insertEntry = createSuggestionEntry({ id: 11, elem: insertInput });

      const otherInput = document.createElement("input");
      otherInput.value = "hello";
      otherInput.selectionStart = otherInput.value.length;
      otherInput.selectionEnd = otherInput.value.length;
      const otherEntry = createSuggestionEntry({ id: 12, elem: otherInput });

      coordinator.schedule(deleteEntry, {
        force: false,
        clearSuggestions: jest.fn(),
        inputAction: "delete",
      });
      coordinator.schedule(insertEntry, {
        force: false,
        clearSuggestions: jest.fn(),
        inputAction: "insert",
      });
      coordinator.schedule(otherEntry, {
        force: false,
        clearSuggestions: jest.fn(),
      });

      jest.advanceTimersByTime(59);
      expect(getPrediction).toHaveBeenCalledTimes(0);

      jest.advanceTimersByTime(1);
      expect(getPrediction).toHaveBeenCalledTimes(1);
      expect(getPrediction).toHaveBeenLastCalledWith(
        expect.objectContaining({
          suggestionId: 10,
          inputAction: "delete",
        }),
      );

      jest.advanceTimersByTime(59);
      expect(getPrediction).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(1);
      expect(getPrediction).toHaveBeenCalledTimes(3);
      expect(getPrediction).toHaveBeenCalledWith(
        expect.objectContaining({
          suggestionId: 11,
          inputAction: "insert",
          traceId: expect.any(String),
          traceStartedAtMs: expect.any(Number),
        }),
      );
      expect(getPrediction).toHaveBeenCalledWith(
        expect.objectContaining({
          suggestionId: 12,
          traceId: expect.any(String),
          traceStartedAtMs: expect.any(Number),
        }),
      );
    });

    test("caps first-character insert debounce for snappier new-word popups", () => {
      const getPrediction = jest.fn();
      const coordinator = new SuggestionPredictionCoordinator({
        debounceByAction: FIXED_DEBOUNCE_BY_ACTION,
        getPrediction,
        lang: "en_US",
        minWordLengthToPredict: 1,
        separatorRegex: /\s+/,
      });

      const input = document.createElement("input");
      input.value = "h";
      input.selectionStart = input.value.length;
      input.selectionEnd = input.value.length;
      const entry = createSuggestionEntry({ id: 17, elem: input });

      coordinator.schedule(entry, {
        force: false,
        clearSuggestions: jest.fn(),
        inputAction: "insert",
      });

      jest.advanceTimersByTime(23);
      expect(getPrediction).toHaveBeenCalledTimes(0);

      jest.advanceTimersByTime(1);
      expect(getPrediction).toHaveBeenCalledTimes(1);
      expect(getPrediction).toHaveBeenLastCalledWith(
        expect.objectContaining({
          suggestionId: 17,
          inputAction: "insert",
          traceId: expect.any(String),
          traceStartedAtMs: expect.any(Number),
        }),
      );
    });

    test("replaces pending insert timer with faster delete timer", () => {
      const getPrediction = jest.fn();
      const coordinator = new SuggestionPredictionCoordinator({
        debounceByAction: FIXED_DEBOUNCE_BY_ACTION,
        getPrediction,
        lang: "en_US",
        minWordLengthToPredict: 1,
        separatorRegex: /\s+/,
      });

      const input = document.createElement("input");
      input.value = "hello";
      input.selectionStart = input.value.length;
      input.selectionEnd = input.value.length;
      const entry = createSuggestionEntry({ id: 13, elem: input });

      coordinator.schedule(entry, {
        force: false,
        clearSuggestions: jest.fn(),
        inputAction: "insert",
      });
      jest.advanceTimersByTime(40);

      coordinator.schedule(entry, {
        force: false,
        clearSuggestions: jest.fn(),
        inputAction: "delete",
      });

      jest.advanceTimersByTime(59);
      expect(getPrediction).toHaveBeenCalledTimes(0);

      jest.advanceTimersByTime(1);
      expect(getPrediction).toHaveBeenCalledTimes(1);
      expect(getPrediction).toHaveBeenLastCalledWith(
        expect.objectContaining({
          suggestionId: 13,
          inputAction: "delete",
          traceId: expect.any(String),
          traceStartedAtMs: expect.any(Number),
        }),
      );

      jest.advanceTimersByTime(100);
      expect(getPrediction).toHaveBeenCalledTimes(1);
    });

    test("delete path clears below-threshold input faster while preserving min-length behavior", () => {
      const getPrediction = jest.fn();
      const clearDelete = jest.fn();
      const clearInsert = jest.fn();
      const coordinator = new SuggestionPredictionCoordinator({
        debounceByAction: FIXED_DEBOUNCE_BY_ACTION,
        getPrediction,
        lang: "en_US",
        minWordLengthToPredict: 3,
        separatorRegex: /\s+/,
      });

      const deleteInput = document.createElement("input");
      deleteInput.value = "hi";
      deleteInput.selectionStart = deleteInput.value.length;
      deleteInput.selectionEnd = deleteInput.value.length;
      const deleteEntry = createSuggestionEntry({ id: 14, elem: deleteInput });

      const insertInput = document.createElement("input");
      insertInput.value = "hi";
      insertInput.selectionStart = insertInput.value.length;
      insertInput.selectionEnd = insertInput.value.length;
      const insertEntry = createSuggestionEntry({ id: 15, elem: insertInput });

      coordinator.schedule(deleteEntry, {
        force: false,
        clearSuggestions: clearDelete,
        inputAction: "delete",
      });
      coordinator.schedule(insertEntry, {
        force: false,
        clearSuggestions: clearInsert,
        inputAction: "insert",
      });

      jest.advanceTimersByTime(59);
      expect(clearDelete).toHaveBeenCalledTimes(0);
      expect(clearInsert).toHaveBeenCalledTimes(0);
      expect(getPrediction).toHaveBeenCalledTimes(0);

      jest.advanceTimersByTime(1);
      expect(clearDelete).toHaveBeenCalledTimes(1);
      expect(clearInsert).toHaveBeenCalledTimes(0);
      expect(deleteEntry.requestId).toBe(1);
      expect(getPrediction).toHaveBeenCalledTimes(0);

      jest.advanceTimersByTime(59);
      expect(clearInsert).toHaveBeenCalledTimes(0);

      jest.advanceTimersByTime(1);
      expect(clearInsert).toHaveBeenCalledTimes(1);
      expect(insertEntry.requestId).toBe(1);
      expect(getPrediction).toHaveBeenCalledTimes(0);
    });

    test("reconcile requests prediction immediately", () => {
      const getPrediction = jest.fn();
      const coordinator = new SuggestionPredictionCoordinator({
        debounceByAction: FIXED_DEBOUNCE_BY_ACTION,
        getPrediction,
        lang: "en_US",
        minWordLengthToPredict: 1,
        separatorRegex: /\s+/,
      });

      const input = document.createElement("input");
      input.value = "hello";
      input.selectionStart = input.value.length;
      input.selectionEnd = input.value.length;
      const entry = createSuggestionEntry({ id: 16, elem: input });

      coordinator.reconcile(entry, {
        clearSuggestions: jest.fn(),
        inputAction: "delete",
      });

      expect(getPrediction).toHaveBeenCalledTimes(1);
      expect(getPrediction).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "hello",
          nextChar: "",
          suggestionId: 16,
          requestId: 1,
          lang: "en_US",
          inputAction: "delete",
          traceId: expect.any(String),
          traceStartedAtMs: expect.any(Number),
        }),
      );
    });
  });
});
