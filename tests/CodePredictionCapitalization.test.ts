import { afterEach, describe, expect, jest, test } from "bun:test";
import type { ContentScriptPredictRequestContext } from "../src/core/domain/messageTypes";
import { createEditor, setCaret as caret, withProperty } from "./codeContextTestUtils";
import { Capitalization } from "../src/adapters/chrome/background/CapitalizationHelper";
import { PredictionInputProcessor } from "../src/adapters/chrome/background/PredictionInputProcessor";
import { PresageHandler } from "../src/adapters/chrome/background/PresageHandler";
import { PredictionOrchestrator } from "../src/adapters/chrome/background/PredictionOrchestrator";
import { SuggestionPredictionCoordinator } from "../src/adapters/chrome/content-script/suggestions/SuggestionPredictionCoordinator";
import { ContentMessageHandler } from "../src/adapters/chrome/content-script/ContentMessageHandler";
import { mod } from "./fakeLibPresage.js";

const originalPredictions = mod.PresageCallback.predictions;
afterEach(() => {
  mod.PresageCallback.predictions = originalPredictions;
  jest.restoreAllMocks();
});

function backend(autoCapitalize = true) {
  const handler = new PresageHandler(mod);
  handler.setConfig({
    numSuggestions: 3,
    minWordLengthToPredict: 0,
    insertSpaceAfterAutocomplete: false,
    autoCapitalize,
    textExpansions: [],
    prefixOnlyMode: false,
    userDictionaryList: [],
  });
  return { handler, orchestrator: new PredictionOrchestrator(handler) };
}

describe("code prediction capitalization", () => {
  test("code suppression is request-local and does not force lowercase", async () => {
    mod.PresageCallback.predictions = ["was", "WasmAPI", "camelCase"];
    const { orchestrator } = backend();
    const code = await orchestrator.runPrediction("what . wa", "", "en_US", {
      suppressAutoCapitalize: true,
    });
    expect(code.predictions).toEqual(["was", "WasmAPI", "camelCase"]);
    const prose = await orchestrator.runPrediction("what . wa", "", "en_US");
    expect(prose.predictions[0]).toBe("Was");
    const codeAgain = await orchestrator.runPrediction("what . wa", "", "en_US", {
      suppressAutoCapitalize: true,
    });
    expect(codeAgain.predictions).toEqual(code.predictions);
  });

  test("overlapping code and prose requests cannot share casing state", async () => {
    mod.PresageCallback.predictions = ["was"];
    const { orchestrator } = backend();
    const [code, prose] = await Promise.all([
      orchestrator.runPrediction("what . wa", "", "en_US", { suppressAutoCapitalize: true }),
      orchestrator.runPrediction("what . wa", "", "en_US"),
    ]);
    expect(code.predictions).toEqual(["was"]);
    expect(prose.predictions).toEqual(["Was"]);
  });

  for (const [text, expected] of [
    ["wa", Capitalization.None],
    ["what . wa", Capitalization.None],
    ["what ! wa", Capitalization.None],
    ["what ? wa", Capitalization.None],
    ["what . ", Capitalization.None],
    ["what . Wa", Capitalization.FirstLetter],
    ["what . WA", Capitalization.WholeWord],
  ] as const) {
    test(`code keeps authored casing for ${JSON.stringify(text)}`, () => {
      const processor = new PredictionInputProcessor(0, true);
      expect(processor.processInput(text, "en_US", 3, true, "", true).doCapitalize).toBe(expected);
    });
  }

  test("mid-word completion suppresses sentence casing without dropping the suffix", () => {
    const result = new PredictionInputProcessor(1, true).processInput(
      "what . wa",
      "en_US",
      3,
      false,
      "s",
      true,
    );
    expect(result.predictionInput).toBe("was");
    expect(result.doCapitalize).toBe(Capitalization.None);
  });

  test("prose still respects disabled capitalization and strict boolean suppression", () => {
    const disabled = new PredictionInputProcessor(1, false);
    expect(disabled.processInput("what . wa", "en_US", 3, false).doCapitalize).toBe(
      Capitalization.None,
    );
    const enabled = new PredictionInputProcessor(1, true);
    for (const value of [undefined, false, "true", 1]) {
      expect(
        enabled.processInput("what . wa", "en_US", 3, false, "", value as boolean | undefined)
          .doCapitalize,
      ).toBe(Capitalization.FirstLetter);
    }
  });

  test("code preserves snippet text and metadata rather than lowercasing the result", () => {
    const { handler } = backend();
    const context = handler.preparePredictionContext(
      "what . wa",
      "",
      "en_US",
      3,
      undefined,
      "",
      true,
    );
    const result = handler.finalizePrediction(
      [{ text: "camelCaseCall()", snippetShortcut: ";wa" }],
      context,
    );
    expect(result.predictions).toEqual(["camelCaseCall()"]);
    expect(result.snippetShortcuts).toEqual([";wa"]);
  });

  test("the live caret supplies suppression for code and restores prose in the same host", () => {
    const root = createEditor('<p>what . wa</p><div class="ql-code-block">what . wa</div>');
    const getPrediction = jest.fn<(context: ContentScriptPredictRequestContext) => void>();
    const coordinator = new SuggestionPredictionCoordinator({
      debounceByAction: { insert: 0, delete: 0, other: 0 },
      getPrediction,
      lang: "en_US",
      minWordLengthToPredict: 1,
      separatorRegex: /\s/,
    });
    const entry = {
      id: 1,
      requestId: 0,
      latestMentionText: "",
      latestMentionStart: 0,
      pendingRequestTimer: null,
      elem: root,
    };
    for (const [block, expected] of [
      [root.firstElementChild!, undefined],
      [root.lastElementChild!, true],
      [root.firstElementChild!, undefined],
    ] as const) {
      caret(block.firstChild!);
      coordinator.schedule(entry, {
        force: true,
        clearSuggestions: () => {},
        beforeCursorOverride: "what . wa",
        afterCursorOverride: "",
      });
      expect(getPrediction.mock.calls.at(-1)?.[0].suppressAutoCapitalize).toBe(expected);
    }
    root.firstElementChild!.classList.add("ql-code-block");
    coordinator.reconcile(entry, {
      clearSuggestions: () => {},
      beforeCursorOverride: "what . wa",
      afterCursorOverride: "",
    });
    expect(getPrediction.mock.calls.at(-1)?.[0].suppressAutoCapitalize).toBe(true);
  });

  test("content messaging forwards the code flag without persisting it", () => {
    const sendMessage = jest.fn((message: { context: { suppressAutoCapitalize?: boolean } }) =>
      Promise.resolve(message),
    );
    withProperty(globalThis, "chrome", { runtime: { sendMessage } }, () => {
      const handler = new ContentMessageHandler({
        getEnabled: () => true,
        setEnabled: () => {},
        toggleEnabled: () => {},
        setConfig: () => {},
        updateLanguage: () => {},
        triggerActiveSuggestion: () => {},
        fulfillPrediction: () => {},
        getLanguage: () => "en_US",
        getPredictionGeneration: () => 1,
      });
      const request = {
        text: "what . wa",
        nextChar: "",
        suggestionId: 1,
        requestId: 1,
        lang: "en_US",
      };
      handler.handleGetPrediction({ ...request, suppressAutoCapitalize: true });
      expect(sendMessage.mock.calls.at(-1)?.[0].context.suppressAutoCapitalize).toBe(true);
      handler.handleGetPrediction(request);
      expect(sendMessage.mock.calls.at(-1)?.[0].context.suppressAutoCapitalize).toBeUndefined();
    });
  });
});
