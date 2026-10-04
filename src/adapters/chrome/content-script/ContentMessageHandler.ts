import { checkLastError } from "@core/application/transport-utils";
import { frameHostname } from "./frameHostname";
import { createLogger } from "@core/application/logging/Logger";
import {
  CMD_BACKGROUND_PAGE_PREDICT_RESP,
  CMD_BACKGROUND_PAGE_SET_CONFIG,
  CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG,
  CMD_CONTENT_SCRIPT_PREDICT_REQ,
  CMD_CONTENT_SCRIPT_REPORT_RUNTIME_STATUS,
  CMD_GET_HOSTNAME,
  CMD_POPUP_PAGE_DISABLE,
  CMD_POPUP_PAGE_ENABLE,
  CMD_STATUS_COMMAND,
  CMD_TOGGLE_FT_ACTIVE_TAB,
  CMD_TRIGGER_FT_ACTIVE_TAB,
  CMD_REVIEW_FT_ACTIVE_TAB,
} from "@core/domain/constants";
import type {
  ContentScriptPredictRequestContext,
  ContentScriptPredictRequestMessage,
  ContentScriptRuntimeStatusMessage,
  Message,
  PopupPageStatusMessage,
  PredictResponseContext,
  SetConfigContext,
} from "@core/domain/messageTypes";
import { resolveTraceAgeMs } from "./predictionTrace";

const logger = createLogger("ContentMessageHandler");

export type ContentMessageHandlerDependencies = {
  getEnabled: () => boolean;
  setEnabled: (value: boolean) => void;
  toggleEnabled: () => void;
  setConfig: (config: SetConfigContext) => void;
  updateLanguage: (lang: string) => void;
  triggerActiveSuggestion: () => void;
  reviewActiveEditor: (source: "command" | "popup") => void;
  fulfillPrediction: (context: PredictResponseContext) => void;
  getLanguage: () => string;
};

export class ContentMessageHandler {
  private lastRuntimeStatusSignature: string | null = null;
  private lastRuntimeStatusAt = 0;

  constructor(private readonly dependencies: ContentMessageHandlerDependencies) {}

  /** The runtime adds the generation and the coordinator the trace fields. */
  handleGetPrediction(context: ContentScriptPredictRequestContext): void {
    const { runtimeGeneration, traceId, traceStartedAtMs } = context;
    const lang = this.dependencies.getLanguage();

    logger.debug("Preparing prediction request", {
      traceId,
      requestId: context.requestId,
      suggestionId: context.suggestionId,
      runtimeGeneration,
      nextChar: context.nextChar,
      lang,
      requestAgeMs: resolveTraceAgeMs(traceStartedAtMs),
    });
    const message: ContentScriptPredictRequestMessage = {
      command: CMD_CONTENT_SCRIPT_PREDICT_REQ,
      context: {
        text: context.text,
        nextChar: context.nextChar,
        afterCursorTokenSuffix: context.afterCursorTokenSuffix,
        ...(context.suppressAutoCapitalize === true ? { suppressAutoCapitalize: true } : {}),
        inputAction: context.inputAction,
        suggestionId: context.suggestionId,
        requestId: context.requestId,
        runtimeGeneration,
        lang,
        documentLang: document.documentElement.lang || undefined,
        traceId,
        traceStartedAtMs,
      },
    };
    void chrome.runtime.sendMessage(message);
  }

  reportRuntimeStatus(runtimeGeneration: number): void {
    const domainURL = frameHostname() || undefined;
    const signature = `${runtimeGeneration}:${domainURL || ""}`;
    const now = Date.now();
    if (this.lastRuntimeStatusSignature === signature && now - this.lastRuntimeStatusAt < 250) {
      return;
    }
    this.lastRuntimeStatusSignature = signature;
    this.lastRuntimeStatusAt = now;
    const message: ContentScriptRuntimeStatusMessage = {
      command: CMD_CONTENT_SCRIPT_REPORT_RUNTIME_STATUS,
      context: {
        runtimeGeneration,
        domainURL,
      },
    };
    void chrome.runtime.sendMessage(message);
  }

  handleMessage(message: Message | null, sendResponse?: (response: unknown) => void): void {
    checkLastError();
    if (!message) {
      logger.error("Received empty runtime message");
      return;
    }

    logger.debug("Handling runtime message", {
      command: message.command,
    });

    switch (message.command) {
      case CMD_BACKGROUND_PAGE_PREDICT_RESP:
        this.handlePredictionResponse(message.context);
        return;
      case CMD_BACKGROUND_PAGE_SET_CONFIG:
        this.dependencies.setConfig(message.context);
        break;
      case CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG:
        this.dependencies.updateLanguage(message.context.lang);
        break;
      case CMD_POPUP_PAGE_DISABLE:
        this.dependencies.setEnabled(false);
        break;
      case CMD_POPUP_PAGE_ENABLE:
        this.dependencies.setEnabled(true);
        break;
      case CMD_TOGGLE_FT_ACTIVE_TAB:
        this.dependencies.toggleEnabled();
        break;
      case CMD_TRIGGER_FT_ACTIVE_TAB:
        this.dependencies.triggerActiveSuggestion();
        break;
      case CMD_REVIEW_FT_ACTIVE_TAB:
        this.dependencies.reviewActiveEditor(
          message.context?.source === "popup" ? "popup" : "command",
        );
        break;
      case CMD_GET_HOSTNAME:
        sendResponse?.({ hostname: frameHostname() });
        return;
      default:
        logger.debug("Unknown message command", { command: message.command });
        return;
    }
    this.sendRuntimeStatus(sendResponse);
  }

  private handlePredictionResponse(context: PredictResponseContext): void {
    logger.debug("Fulfilling prediction response", {
      traceId: context.traceId,
      requestId: context.requestId,
      suggestionId: context.suggestionId,
      runtimeGeneration: context.runtimeGeneration,
      predictionCount: context.predictions.length,
      responseAgeMs: resolveTraceAgeMs(context.traceStartedAtMs),
    });
    this.dependencies.fulfillPrediction(context);
  }

  private sendRuntimeStatus(sendResponse?: (response: unknown) => void): void {
    const statusMsg: PopupPageStatusMessage = {
      command: CMD_STATUS_COMMAND,
      context: { enabled: this.dependencies.getEnabled() },
    };
    sendResponse?.(statusMsg);
  }
}
