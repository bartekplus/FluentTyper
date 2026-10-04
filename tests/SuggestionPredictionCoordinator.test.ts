import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { SuggestionPredictionCoordinator } from "../src/adapters/chrome/content-script/suggestions/SuggestionPredictionCoordinator";
import { createSuggestionEntry } from "./suggestionTestUtils";

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

function makeCoordinator(
  overrides: Partial<ConstructorParameters<typeof SuggestionPredictionCoordinator>[0]> = {},
) {
  return new SuggestionPredictionCoordinator({
    debounceByAction: ZERO_DEBOUNCE_BY_ACTION,
    getPrediction: jest.fn(),
    lang: "en_US",
    minWordLengthToPredict: 1,
    ...overrides,
  });
}

function inputEntry(id: number, value: string, caret = value.length) {
  const input = document.createElement("input");
  input.value = value;
  input.setSelectionRange(caret, caret);
  return createSuggestionEntry({ id, elem: input });
}

describe("SuggestionPredictionCoordinator", () => {
  test("force scheduling sends prediction request immediately", () => {
    const getPrediction = jest.fn();
    const coordinator = makeCoordinator({
      debounceByAction: FIXED_DEBOUNCE_BY_ACTION,
      getPrediction,
      minWordLengthToPredict: 2,
    });

    const entry = inputEntry(9, "hello");

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
    const coordinator = makeCoordinator({ getPrediction, minWordLengthToPredict: 3 });

    const entry = inputEntry(1, "hi");

    coordinator.schedule(entry, { force: false, clearSuggestions });
    await Bun.sleep(5);

    expect(getPrediction).not.toHaveBeenCalled();
    expect(clearSuggestions).toHaveBeenCalledTimes(1);
    expect(entry.requestId).toBe(1);
  });

  test("passes inputAction in prediction request when provided", async () => {
    const getPrediction = jest.fn();
    const coordinator = makeCoordinator({ getPrediction });

    const entry = inputEntry(2, "Hello");

    coordinator.schedule(entry, {
      force: false,
      clearSuggestions: jest.fn(),
      inputAction: "delete",
    });
    await Bun.sleep(5);

    expect(getPrediction).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Hello",
        nextChar: "",
        afterCursorTokenSuffix: "",
        suggestionId: 2,
        requestId: 1,
        lang: "en_US",
        inputAction: "delete",
        traceId: expect.any(String),
        traceStartedAtMs: expect.any(Number),
      }),
    );
  });

  test("includes only the current token suffix for mid-word edits", () => {
    const getPrediction = jest.fn();
    const coordinator = makeCoordinator({
      debounceByAction: FIXED_DEBOUNCE_BY_ACTION,
      getPrediction,
    });

    const entry = inputEntry(11, "Whbtsoever now", 3);

    coordinator.schedule(entry, { force: true, clearSuggestions: jest.fn() });

    expect(getPrediction).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Whb",
        nextChar: "t",
        afterCursorTokenSuffix: "tsoever",
        suggestionId: 11,
      }),
    );
  });

  test("retains keep-pred punctuation in the bounded suffix", () => {
    const getPrediction = jest.fn();
    const coordinator = makeCoordinator({
      debounceByAction: FIXED_DEBOUNCE_BY_ACTION,
      getPrediction,
    });

    const entry = inputEntry(12, "co-op later", 2);

    coordinator.schedule(entry, { force: true, clearSuggestions: jest.fn() });

    expect(getPrediction).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "co",
        nextChar: "-",
        afterCursorTokenSuffix: "-op",
        suggestionId: 12,
      }),
    );
  });

  test("clears suggestions without requesting predictions when disabled by threshold", async () => {
    const getPrediction = jest.fn();
    const clearSuggestions = jest.fn();
    const coordinator = makeCoordinator({ getPrediction, minWordLengthToPredict: -1 });

    const entry = inputEntry(3, "Hello.");

    coordinator.schedule(entry, { force: false, clearSuggestions });
    await Bun.sleep(5);

    expect(clearSuggestions).toHaveBeenCalledTimes(1);
    expect(getPrediction).not.toHaveBeenCalled();
  });

  test("does not request predictions when disabled by threshold", async () => {
    const getPrediction = jest.fn();
    const clearSuggestions = jest.fn();
    const coordinator = makeCoordinator({ getPrediction, minWordLengthToPredict: -1 });

    const entry = inputEntry(4, "Hello.");

    coordinator.schedule(entry, { force: false, clearSuggestions });
    await Bun.sleep(5);

    expect(clearSuggestions).toHaveBeenCalledTimes(1);
    expect(getPrediction).not.toHaveBeenCalled();
  });

  describe("isSeparator", () => {
    test("returns true for characters matching the separator regex", () => {
      const coordinator = makeCoordinator();
      expect(coordinator.isSeparator(" ")).toBe(true);
      expect(coordinator.isSeparator("\t")).toBe(true);
      expect(coordinator.isSeparator("\n")).toBe(true);
    });

    test("returns false for non-separator characters", () => {
      const coordinator = makeCoordinator();
      expect(coordinator.isSeparator("a")).toBe(false);
      expect(coordinator.isSeparator("'")).toBe(false);
      expect(coordinator.isSeparator("1")).toBe(false);
    });
  });

  describe("findMentionToken", () => {
    test.each([
      ["hello", "hello", 0],
      ["hello world", "world", 6],
      ["hello ", "", 6],
      ["", "", 0],
      ["one   two", "two", 6],
      ["one two three", "three", 8],
      ["hello, world!", "", 13],
      ["(ad", "ad", 1],
      ["[ad", "ad", 1],
      ['"ad', "ad", 1],
      ["/ad", "ad", 1],
    ])("%p gives token %p at %p", (text, token, start) => {
      expect(makeCoordinator().findMentionToken(text)).toEqual({ token, start });
    });
  });

  describe("updateLang", () => {
    test("uses the separators of the new language", () => {
      const coordinator = makeCoordinator();

      // French also splits at an apostrophe.
      expect(coordinator.findMentionToken("l'ami").token).toBe("l'ami");
      coordinator.updateLang("fr_FR");
      expect(coordinator.isSeparator("'")).toBe(true);
      expect(coordinator.findMentionToken("l'ami").token).toBe("ami");
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
      const coordinator = makeCoordinator({
        debounceByAction: FIXED_DEBOUNCE_BY_ACTION,
        getPrediction,
      });

      const deleteEntry = inputEntry(10, "hello");

      const insertEntry = inputEntry(11, "hello");

      const otherEntry = inputEntry(12, "hello");

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
      const coordinator = makeCoordinator({
        debounceByAction: FIXED_DEBOUNCE_BY_ACTION,
        getPrediction,
      });

      const entry = inputEntry(17, "h");

      coordinator.schedule(entry, {
        force: false,
        clearSuggestions: jest.fn(),
        inputAction: "insert",
      });

      jest.advanceTimersByTime(11);
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
      const coordinator = makeCoordinator({
        debounceByAction: FIXED_DEBOUNCE_BY_ACTION,
        getPrediction,
      });

      const entry = inputEntry(13, "hello");

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
      const coordinator = makeCoordinator({
        debounceByAction: FIXED_DEBOUNCE_BY_ACTION,
        getPrediction,
        minWordLengthToPredict: 3,
      });

      const deleteEntry = inputEntry(14, "hi");

      const insertEntry = inputEntry(15, "hi");

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
      const coordinator = makeCoordinator({
        debounceByAction: FIXED_DEBOUNCE_BY_ACTION,
        getPrediction,
      });

      const entry = inputEntry(16, "hello");

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
