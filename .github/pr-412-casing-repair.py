from pathlib import Path
import json
import sys

ROOT = Path('.')
BG = 'src/adapters/chrome/background/'
CS = 'src/adapters/chrome/content-script/'

def replace(path, old, new):
    file = ROOT / path
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected one patch anchor, found {count}: {old[:100]!r}')
    file.write_text(text.replace(old, new))

UNIT = r'''import { afterEach, describe, expect, jest, test } from "bun:test";
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

function caret(node: Node): void {
  const range = document.createRange();
  range.setStart(node, node.textContent?.length ?? 0);
  range.collapse(true);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
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
      "what . wa", "en_US", 3, false, "s", true,
    );
    expect(result.predictionInput).toBe("was");
    expect(result.doCapitalize).toBe(Capitalization.None);
  });

  test("prose still respects disabled capitalization and strict boolean suppression", () => {
    const disabled = new PredictionInputProcessor(1, false);
    expect(disabled.processInput("what . wa", "en_US", 3, false).doCapitalize).toBe(Capitalization.None);
    const enabled = new PredictionInputProcessor(1, true);
    for (const value of [undefined, false, "true", 1]) {
      expect(enabled.processInput("what . wa", "en_US", 3, false, "", value as boolean | undefined).doCapitalize).toBe(Capitalization.FirstLetter);
    }
  });

  test("code preserves snippet text and metadata rather than lowercasing the result", () => {
    const { handler } = backend();
    const context = handler.preparePredictionContext("what . wa", "", "en_US", 3, undefined, "", true);
    const result = handler.finalizePrediction([
      { text: "camelCaseCall()", snippetShortcut: ";wa" },
    ], context);
    expect(result.predictions).toEqual(["camelCaseCall()"]);
    expect(result.snippetShortcuts).toEqual([";wa"]);
  });

  test("the live caret supplies suppression for code and restores prose in the same host", () => {
    const root = document.createElement("div");
    root.setAttribute("contenteditable", "true");
    Object.defineProperty(root, "isContentEditable", { value: true });
    root.innerHTML = '<p>what . wa</p><div class="ql-code-block">what . wa</div>';
    document.body.append(root);
    const getPrediction = jest.fn();
    const coordinator = new SuggestionPredictionCoordinator({
      debounceByAction: { insert: 0, delete: 0, other: 0 },
      getPrediction,
      lang: "en_US",
      minWordLengthToPredict: 1,
      separatorRegex: /\s/,
    });
    const entry = { id: 1, requestId: 0, latestMentionText: "", latestMentionStart: 0, pendingRequestTimer: null, elem: root };
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
      clearSuggestions: () => {}, beforeCursorOverride: "what . wa", afterCursorOverride: "",
    });
    expect(getPrediction.mock.calls.at(-1)?.[0].suppressAutoCapitalize).toBe(true);
  });

  test("content messaging forwards the code flag without persisting it", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "chrome");
    const sendMessage = jest.fn(() => Promise.resolve());
    Object.defineProperty(globalThis, "chrome", { configurable: true, value: { runtime: { sendMessage } } });
    try {
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
      const request = { text: "what . wa", nextChar: "", suggestionId: 1, requestId: 1, lang: "en_US" };
      handler.handleGetPrediction({ ...request, suppressAutoCapitalize: true });
      expect(sendMessage.mock.calls.at(-1)?.[0].context.suppressAutoCapitalize).toBe(true);
      handler.handleGetPrediction(request);
      expect(sendMessage.mock.calls.at(-1)?.[0].context.suppressAutoCapitalize).toBeUndefined();
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "chrome", descriptor);
      else Reflect.deleteProperty(globalThis, "chrome");
    }
  });
});
'''

RUNTIME = r'''  test("Quill code prediction stays lowercase through Tab acceptance", async () => {
    const { PresageHandler } = await import("../src/adapters/chrome/background/PresageHandler");
    const { PredictionOrchestrator } = await import("../src/adapters/chrome/background/PredictionOrchestrator");
    const { mod } = await import("./fakeLibPresage.js");
    const original = mod.PresageCallback.predictions;
    try {
      mod.PresageCallback.predictions = ["was"];
      const handler = new PresageHandler(mod);
      handler.setConfig({ numSuggestions: 1, minWordLengthToPredict: 1, insertSpaceAfterAutocomplete: true, autoCapitalize: true, textExpansions: [], prefixOnlyMode: false });
      const backend = new PredictionOrchestrator(handler);
      const { manager, getPrediction } = await createManager({ enabledGrammarRules: ["capitalizeSentenceStart"] });
      const root = document.createElement("div");
      root.setAttribute("contenteditable", "true");
      Object.defineProperty(root, "isContentEditable", { value: true });
      root.innerHTML = '<div class="ql-code-block">what . wa</div>';
      document.body.append(root);
      manager.queryAndAttachHelper();
      root.focus();
      setContentEditableCursor(root, "what . wa".length);
      dispatchInput(root, { inputType: "insertText" });
      const request = await waitForNextCall(getPrediction);
      const result = await backend.runPrediction(request.text, request.nextChar, request.lang, { suppressAutoCapitalize: request.suppressAutoCapitalize }, request.afterCursorTokenSuffix);
      manager.fulfillPrediction(buildResponse(request, result));
      expect(querySuggestionMenuItems()[0]?.textContent?.trim()).toBe("was");
      dispatchKeydown(root, "Tab");
      expect(root.querySelector(".ql-code-block")?.textContent?.trimEnd()).toBe("what . was");
    } finally {
      mod.PresageCallback.predictions = original;
    }
  });

'''

E2E = r'''  test(
    "Quill code predictions keep lowercase through Tab and restore prose casing",
    async () => {
      try {
        await setGrammarRulesAndWait(worker!, ["capitalizeSentenceStart"]);
        await setSettingAndWait(worker!, KEY_LANGUAGE, "en_US");
        await setSettingAndWait(worker!, KEY_ENABLED_LANGUAGES, SUPPORTED_PREDICTION_LANGUAGE_KEYS);
        await setSettingAndWait(worker!, KEY_MIN_WORD_LENGTH_TO_PREDICT, 1);
        await setSettingAndWait(worker!, KEY_INLINE_SUGGESTION, false);
        await setSettingAndWait(worker!, KEY_AUTOCOMPLETE_ON_TAB, true);
        await applyConfigChange(browser, worker!);
        await gotoTestPage(page, { enableQuill: true });
        await page.bringToFront();
        await waitForInputReady(page, QUILL_SELECTOR);
        await page.focus(QUILL_SELECTOR);
        await page.evaluate(() => {
          const quill = (window as typeof window & { __testQuill?: {
            setText: (text: string, source?: string) => void;
            formatLine: (index: number, length: number, name: string, value: boolean, source?: string) => void;
            setSelection: (index: number, length: number, source?: string) => void;
          } }).__testQuill;
          if (!quill) throw new Error("Quill test instance not found");
          quill.setText("what . \nwhat . \n", "silent");
          quill.formatLine(0, 1, "code-block", true, "api");
          quill.setSelection("what . ".length, 0, "api");
          if (!document.querySelector(".ql-editor .ql-code-block")) throw new Error("Missing actual Quill code block");
        });
        for (const expected of ["was", "Was"]) {
          if (expected === "Was") {
            await page.keyboard.press("Escape");
            await page.evaluate(() => {
              const quill = (window as typeof window & { __testQuill?: {
                getText: () => string;
                setSelection: (index: number, length: number, source?: string) => void;
              } }).__testQuill;
              if (!quill) throw new Error("Quill test instance not found");
              quill.setSelection(quill.getText().indexOf("\n") + 1 + "what . ".length, 0, "api");
            });
          }
          await page.keyboard.type("wa");
          const index = await waitUntil(
            `Quill offers ${expected} with context-correct casing`,
            async () => {
              const suggestions = await waitForVisibleSuggestionTexts(page);
              const found = suggestions.findIndex((text) => text.trim() === expected);
              return found >= 0 ? { value: found } : false;
            },
            { timeoutMs: browserTimeout(5000, 10000), intervalMs: 50 },
          );
          for (let i = 0; i < index.value; i += 1) await page.keyboard.press("ArrowDown");
          await page.keyboard.press("Tab");
          await waitUntil(
            `Quill inserts ${expected} without changing code casing`,
            async () => page.evaluate((inProse) => {
              const quill = (window as typeof window & { __testQuill?: { getText: () => string } }).__testQuill;
              const lines = quill?.getText().replace(/\u00a0/g, " ").split("\n");
              const code = document.querySelector(".ql-editor .ql-code-block")?.textContent?.trimEnd();
              return code === "what . was" && lines?.[0]?.trimEnd() === "what . was" &&
                lines?.[1]?.trimEnd() === (inProse ? "what . Was" : "what .");
            }, expected === "Was"),
            { timeoutMs: browserTimeout(5000, 10000), intervalMs: 50 },
          );
        }
      } finally {
        await setGrammarRulesAndWait(worker!, []);
        await applyConfigChange(browser, worker!);
      }
    },
    browserTimeout(45000, 70000),
  );

'''

if sys.argv[1] == 'tests':
    target = ROOT / 'tests/CodePredictionCapitalization.test.ts'
    if target.exists():
        raise RuntimeError('Regression test already exists')
    target.write_text(UNIT)
    marker = '  test("capitalizes an accepted suggestion the way typing the word would", async () => {'
    replace('tests/SuggestionManager.test.ts', marker, RUNTIME + marker)
    marker = '  test(\n    "Quill preserves block structure and caret-correct insertion on Tab acceptance",'
    replace('tests/e2e/full.e2e.test.ts', marker, E2E + marker)
    behavior = {
        'id': 'grammar_code_prediction_casing',
        'description': 'Code context suppresses automatic sentence casing before suggestions are rendered and accepted, preserving authored capitals and restoring prose behavior per request.',
        'coverage': [
            {'layer': 'unit', 'file': 'tests/CodePredictionCapitalization.test.ts', 'test': 'code suppression is request-local and does not force lowercase'},
            {'layer': 'unit', 'file': 'tests/CodePredictionCapitalization.test.ts', 'test': 'overlapping code and prose requests cannot share casing state'},
            {'layer': 'unit', 'file': 'tests/SuggestionManager.test.ts', 'test': 'Quill code prediction stays lowercase through Tab acceptance'},
            {'layer': 'e2e-full', 'file': 'tests/e2e/full.e2e.test.ts', 'test': 'Quill code predictions keep lowercase through Tab and restore prose casing'},
        ],
    }
    for path, key, value in [
        ('tests/e2e/coverage-matrix.json', 'behaviors', behavior),
        ('tests/e2e/coverage-baseline-ids.json', 'baselineBehaviorIds', behavior['id']),
    ]:
        file = ROOT / path
        data = json.loads(file.read_text())
        data[key].append(value)
        file.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
elif sys.argv[1] == 'code':
    replace('src/core/domain/messageTypes.d.ts',
        'export interface ContentScriptPredictRequestContext {\n  text: string;',
        'export interface ContentScriptPredictRequestContext {\n  /** Per-request code/literal context; suppress sentence casing, not authored capitals. */\n  suppressAutoCapitalize?: boolean;\n  text: string;')
    replace(CS + 'suggestions/SuggestionPredictionCoordinator.ts',
        'import { TextTargetAdapter } from "./TextTargetAdapter";',
        'import { TextTargetAdapter } from "./TextTargetAdapter";\nimport { resolveCodeContext } from "./CodeContextResolver";')
    replace(CS + 'suggestions/SuggestionPredictionCoordinator.ts',
        '    this.getPrediction({\n      text: beforeCursor,',
        '    this.getPrediction({\n      ...(entry.elem && resolveCodeContext(entry.elem) !== "prose"\n        ? { suppressAutoCapitalize: true }\n        : {}),\n      text: beforeCursor,')
    replace(CS + 'ContentMessageHandler.ts',
        '        afterCursorTokenSuffix: context.afterCursorTokenSuffix,',
        '        afterCursorTokenSuffix: context.afterCursorTokenSuffix,\n        ...(context.suppressAutoCapitalize === true ? { suppressAutoCapitalize: true } : {}),')
    replace(BG + 'PredictionTypes.d.ts',
        'export interface PredictionRunConfig {\n  numSuggestions?: number;\n  tabId?: number;',
        'export interface PredictionConfigOverride {\n  numSuggestions?: number;\n  /** Disable automatic sentence casing for this request without changing shared config. */\n  suppressAutoCapitalize?: boolean;\n}\n\nexport interface PredictionRunConfig extends PredictionConfigOverride {\n  tabId?: number;')
    replace(BG + 'router/MessageRouter.ts',
        '          domainSettings.hasNumSuggestionsOverride\n            ? { numSuggestions: domainSettings.numSuggestions }\n            : undefined,',
        '          domainSettings.hasNumSuggestionsOverride || request.context.suppressAutoCapitalize === true\n            ? {\n                ...(domainSettings.hasNumSuggestionsOverride\n                  ? { numSuggestions: domainSettings.numSuggestions }\n                  : {}),\n                ...(request.context.suppressAutoCapitalize === true\n                  ? { suppressAutoCapitalize: true }\n                  : {}),\n              }\n            : undefined,')
    replace(BG + 'BackgroundServiceWorker.ts',
        'import { PredictionManager } from "./PredictionManager";',
        'import { PredictionManager } from "./PredictionManager";\nimport type { PredictionConfigOverride } from "./PredictionTypes";')
    replace(BG + 'BackgroundServiceWorker.ts',
        '    configOverride?: { numSuggestions?: number },',
        '    configOverride?: PredictionConfigOverride,')
    replace(BG + 'PredictionManager.ts',
        '  PredictionRunConfig,',
        '  PredictionRunConfig,\n  PredictionConfigOverride,')
    replace(BG + 'PredictionManager.ts',
        '    configOverride?: { numSuggestions?: number },',
        '    configOverride?: PredictionConfigOverride,')
    replace(BG + 'PredictionManager.ts',
        '      numSuggestions: configOverride?.numSuggestions,',
        '      numSuggestions: configOverride?.numSuggestions,\n      ...(configOverride?.suppressAutoCapitalize === true ? { suppressAutoCapitalize: true } : {}),')
    replace(BG + 'PredictionOrchestrator.ts',
        '      configOverride?.tabId,\n      afterCursorTokenSuffix,',
        '      configOverride?.tabId,\n      afterCursorTokenSuffix,\n      configOverride?.suppressAutoCapitalize,')
    replace(BG + 'PresageHandler.ts',
        '    afterCursorTokenSuffix?: string,\n  ): PresagePredictionContext {',
        '    afterCursorTokenSuffix?: string,\n    suppressAutoCapitalize = false,\n  ): PresagePredictionContext {')
    replace(BG + 'PresageHandler.ts',
        '        this.predictNextWordAfterSeparatorChar,\n        afterCursorTokenSuffix,',
        '        this.predictNextWordAfterSeparatorChar,\n        afterCursorTokenSuffix,\n        suppressAutoCapitalize,')
    replace(BG + 'PredictionInputProcessor.ts',
        '    afterCursorTokenSuffix?: string,\n  ): {',
        '    afterCursorTokenSuffix?: string,\n    suppressAutoCapitalize = false,\n  ): {')
    replace(BG + 'PredictionInputProcessor.ts',
        '      autoCapitalize: this.autoCapitalize,',
        '      autoCapitalize: this.autoCapitalize && suppressAutoCapitalize !== true,')
    path = ROOT / 'docs/automatic-code-context.md'
    with path.open('a') as file:
        file.write('\n## Prediction sentence casing\n\nThe current editing context also suppresses automatic sentence capitalization in prediction results. The content script sends a per-request boolean through the existing runtime message and prediction configuration override; it does not change saved settings or the shared predictor configuration. Thus `what . wa` can offer and insert `was` in code while prose still offers `Was`. Explicitly typed capitals and original candidate/snippet casing are retained; results are not blindly lowercased. Google Docs virtual prediction sessions without an element retain their existing behavior.\n\nThe regression covers request-local and overlapping code/prose predictions, mid-word suffixes, preserved candidate/snippet casing, content-message forwarding, and actual Tab acceptance. The full Chrome/Firefox suite additionally tests the built extension in a real Quill code block and then in prose in the same composer. This is an automated Quill fixture, not a claim of live Slack validation.\n')
else:
    raise RuntimeError('Expected tests or code')
