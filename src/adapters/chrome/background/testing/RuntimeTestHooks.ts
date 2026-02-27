import {
  CMD_TOGGLE_FT_ACTIVE_LANG,
  CMD_TOGGLE_FT_ACTIVE_TAB,
  CMD_TRIGGER_FT_ACTIVE_TAB,
} from "@core/domain/constants";
import { ENABLE_TEST_RUNTIME_HOOKS } from "../BackgroundServiceWorker";
import { CommandRouter } from "../router/CommandRouter";

interface WebLLMTestPredictionCall {
  lang: string;
  predictionInput: string;
  numSuggestions: number;
}

interface WebLLMTestOverrideState {
  predictions: string[];
  delayMs: number;
  calls: WebLLMTestPredictionCall[];
}

type WebLLMTestGlobals = typeof globalThis & {
  __fluentTyperWebLLMTestOverride__?: WebLLMTestOverrideState;
  triggerCommandForTesting?: (command: string) => Promise<void> | void;
};

const WEB_LLM_TEST_OVERRIDE_KEY = "__fluentTyperWebLLMTestOverride__";
const TEST_MSG_TRIGGER_COMMAND = "TEST_TRIGGER_COMMAND";
const TEST_MSG_SET_WEBLLM_PREDICTIONS = "TEST_SET_WEBLLM_PREDICTIONS";
const TEST_MSG_CLEAR_WEBLLM_PREDICTIONS = "TEST_CLEAR_WEBLLM_PREDICTIONS";
const TEST_MSG_GET_WEBLLM_PREDICTION_CALLS = "TEST_GET_WEBLLM_PREDICTION_CALLS";

function getWebLLMTestGlobals(): WebLLMTestGlobals {
  return globalThis as WebLLMTestGlobals;
}

function setWebLLMTestOverride(predictions: string[], delayMs: number): void {
  const normalizedPredictions = predictions
    .map((prediction) => prediction.trim())
    .filter((prediction) => prediction.length > 0);
  getWebLLMTestGlobals()[WEB_LLM_TEST_OVERRIDE_KEY] = {
    predictions: normalizedPredictions,
    delayMs,
    calls: [],
  };
}

function clearWebLLMTestOverride(): void {
  delete getWebLLMTestGlobals()[WEB_LLM_TEST_OVERRIDE_KEY];
}

function getWebLLMTestPredictionCalls(): WebLLMTestPredictionCall[] {
  const override = getWebLLMTestGlobals()[WEB_LLM_TEST_OVERRIDE_KEY];
  if (!override || !Array.isArray(override.calls)) {
    return [];
  }
  return override.calls.map((call) => ({
    lang: call.lang,
    predictionInput: call.predictionInput,
    numSuggestions: call.numSuggestions,
  }));
}

export function registerRuntimeTestHooks(commandRouter: CommandRouter): void {
  if (!ENABLE_TEST_RUNTIME_HOOKS) {
    return;
  }

  if (typeof globalThis !== "undefined") {
    getWebLLMTestGlobals().triggerCommandForTesting = async (command: string) => {
      await commandRouter.handle(command);
    };
  }

  const testTriggerCommandAllowList = new Set<string>([
    CMD_TOGGLE_FT_ACTIVE_TAB,
    CMD_TRIGGER_FT_ACTIVE_TAB,
    CMD_TOGGLE_FT_ACTIVE_LANG,
  ]);

  const isTrustedInternalSender = (
    sender: chrome.runtime.MessageSender,
  ): boolean => {
    if (
      typeof sender.url === "string" &&
      sender.url.startsWith(chrome.runtime.getURL(""))
    ) {
      return true;
    }
    return sender.id === chrome.runtime.id && typeof sender.tab === "undefined";
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (typeof message !== "object" || !message) {
      return false;
    }
    const type = (message as { type?: unknown }).type;
    if (
      type !== TEST_MSG_TRIGGER_COMMAND &&
      type !== TEST_MSG_SET_WEBLLM_PREDICTIONS &&
      type !== TEST_MSG_CLEAR_WEBLLM_PREDICTIONS &&
      type !== TEST_MSG_GET_WEBLLM_PREDICTION_CALLS
    ) {
      return false;
    }
    if (!isTrustedInternalSender(sender)) {
      sendResponse({ ok: false });
      return true;
    }

    switch (type) {
      case TEST_MSG_TRIGGER_COMMAND: {
        const command = (message as { command?: unknown }).command;
        if (
          typeof command !== "string" ||
          !testTriggerCommandAllowList.has(command)
        ) {
          sendResponse({ ok: false });
          return true;
        }
        void commandRouter.handle(command).then(() => {
          sendResponse({ ok: true });
        });
        return true;
      }
      case TEST_MSG_SET_WEBLLM_PREDICTIONS: {
        const predictionsRaw = (message as { predictions?: unknown }).predictions;
        const delayMsRaw = (message as { delayMs?: unknown }).delayMs;
        if (!Array.isArray(predictionsRaw)) {
          sendResponse({ ok: false });
          return true;
        }
        const predictions = predictionsRaw.filter(
          (prediction): prediction is string => typeof prediction === "string",
        );
        const delayMs =
          typeof delayMsRaw === "number" && Number.isFinite(delayMsRaw)
            ? Math.max(0, Math.round(delayMsRaw))
            : 0;
        setWebLLMTestOverride(predictions, delayMs);
        sendResponse({ ok: true });
        return true;
      }
      case TEST_MSG_CLEAR_WEBLLM_PREDICTIONS: {
        clearWebLLMTestOverride();
        sendResponse({ ok: true });
        return true;
      }
      case TEST_MSG_GET_WEBLLM_PREDICTION_CALLS: {
        sendResponse({ ok: true, calls: getWebLLMTestPredictionCalls() });
        return true;
      }
      default:
        return false;
    }
  });
}
