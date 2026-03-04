import { checkLastError } from "@core/application/transport-utils";
import { createLogger } from "@core/application/logging/Logger";
import {
  CMD_BACKGROUND_PAGE_PREDICT_RESP,
  CMD_BACKGROUND_PAGE_SET_CONFIG,
  CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG,
  CMD_CONTENT_SCRIPT_PREDICT_REQ,
  CMD_GET_HOSTNAME,
  CMD_POPUP_PAGE_DISABLE,
  CMD_POPUP_PAGE_ENABLE,
  CMD_STATUS_COMMAND,
  CMD_TOGGLE_FT_ACTIVE_TAB,
  CMD_TRIGGER_FT_ACTIVE_TAB,
} from "@core/domain/constants";
import type {
  ContentScriptPredictRequestContext,
  ContentScriptPredictRequestMessage,
  Message,
  PopupPageStatusMessage,
  PredictResponseContext,
  SetConfigContext,
} from "@core/domain/messageTypes";

type RuntimeInboundMessage =
  | Message
  | {
      command: string;
      context?: unknown;
    };

const logger = createLogger("ContentMessageHandler");

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function generatePredictionTraceId(): string {
  const randomPart =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
  return `pred-${randomPart}`;
}

export type ContentMessageHandlerDependencies = {
  getEnabled: () => boolean;
  setEnabled: (value: boolean) => void;
  toggleEnabled: () => void;
  setConfig: (config: SetConfigContext) => void;
  updateLanguage: (lang: string) => void;
  triggerActiveSuggestion: () => void;
  fulfillPrediction: (context: PredictResponseContext) => void;
  getLanguage: () => string;
  getPredictionGeneration: () => number;
};

export class ContentMessageHandler {
  private pendingReq: ContentScriptPredictRequestMessage | null = null;

  constructor(private readonly dependencies: ContentMessageHandlerDependencies) {}

  handleGetPrediction(context: ContentScriptPredictRequestContext): void {
    const runtimeGeneration =
      typeof context.runtimeGeneration === "number" && Number.isFinite(context.runtimeGeneration)
        ? context.runtimeGeneration
        : this.dependencies.getPredictionGeneration();
    const traceId = isNonEmptyString(context.traceId)
      ? context.traceId.trim()
      : generatePredictionTraceId();
    const traceStartedAtMs =
      typeof context.traceStartedAtMs === "number" && Number.isFinite(context.traceStartedAtMs)
        ? context.traceStartedAtMs
        : Date.now();

    logger.debug("Preparing prediction request", {
      traceId,
      requestId: context.requestId,
      suggestionId: context.suggestionId,
      runtimeGeneration,
      nextChar: context.nextChar,
      lang: this.dependencies.getLanguage(),
    });
    const message: ContentScriptPredictRequestMessage = {
      command: CMD_CONTENT_SCRIPT_PREDICT_REQ,
      context: {
        text: context.text,
        nextChar: context.nextChar,
        inputAction: context.inputAction,
        suggestionId: context.suggestionId,
        requestId: context.requestId,
        runtimeGeneration,
        lang: this.dependencies.getLanguage(),
        traceId,
        traceStartedAtMs,
      },
    };
    this.pendingReq = message;
    chrome.runtime.sendMessage(message);
  }

  handleMessage(
    message: RuntimeInboundMessage | null,
    sender?: chrome.runtime.MessageSender,
    sendResponse?: (response: unknown) => void,
  ): void {
    void sender;
    checkLastError();
    let sendStatusMsg = false;
    if (!message) {
      logger.error("Received empty runtime message");
      return;
    }

    logger.debug("Handling runtime message", {
      command: message.command,
    });

    switch (message.command) {
      case CMD_BACKGROUND_PAGE_PREDICT_RESP: {
        const context = (message as { context: PredictResponseContext }).context;
        const traceIdMatches =
          !isNonEmptyString(this.pendingReq?.context.traceId) ||
          !isNonEmptyString(context.traceId) ||
          this.pendingReq?.context.traceId === context.traceId;
        const isMatchingPending =
          this.pendingReq &&
          this.pendingReq.context.suggestionId === context.suggestionId &&
          this.pendingReq.context.requestId === context.requestId &&
          this.pendingReq.context.runtimeGeneration === context.runtimeGeneration &&
          traceIdMatches;

        if (isMatchingPending) {
          // Clear before fulfillment so synchronous follow-up requests created
          // by text edits are not wiped out after the callback returns.
          this.pendingReq = null;
          logger.debug("Fulfilling prediction response", {
            traceId: context.traceId,
            requestId: context.requestId,
            suggestionId: context.suggestionId,
            runtimeGeneration: context.runtimeGeneration,
            predictionCount: context.predictions.length,
          });
        } else {
          logger.debug(
            "Forwarding non-matching prediction response for manager-level stale filtering",
            {
              traceId: context.traceId,
              requestId: context.requestId,
              suggestionId: context.suggestionId,
              runtimeGeneration: context.runtimeGeneration,
              pendingRequestId: this.pendingReq?.context.requestId,
              pendingSuggestionId: this.pendingReq?.context.suggestionId,
              pendingGeneration: this.pendingReq?.context.runtimeGeneration,
            },
          );
        }
        this.dependencies.fulfillPrediction(context);
        break;
      }
      case CMD_BACKGROUND_PAGE_SET_CONFIG:
        this.dependencies.setConfig((message as { context: SetConfigContext }).context);
        sendStatusMsg = true;
        break;
      case CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG:
        this.dependencies.updateLanguage((message as { context: { lang: string } }).context.lang);
        sendStatusMsg = true;
        break;
      case CMD_POPUP_PAGE_DISABLE:
        this.dependencies.setEnabled(false);
        sendStatusMsg = true;
        break;
      case CMD_POPUP_PAGE_ENABLE:
        this.dependencies.setEnabled(true);
        sendStatusMsg = true;
        break;
      case CMD_TOGGLE_FT_ACTIVE_TAB:
        this.dependencies.toggleEnabled();
        sendStatusMsg = true;
        break;
      case CMD_TRIGGER_FT_ACTIVE_TAB:
        this.dependencies.triggerActiveSuggestion();
        sendStatusMsg = true;
        break;
      case CMD_GET_HOSTNAME:
        if (sendResponse) {
          sendResponse({ hostname: window.location.hostname });
        }
        break;
      default:
        logger.debug("Unknown message command", { command: message.command });
        break;
    }

    if (sendStatusMsg) {
      const statusMsg: PopupPageStatusMessage = {
        command: CMD_STATUS_COMMAND,
        context: { enabled: this.dependencies.getEnabled() },
      };
      if (sendResponse) {
        sendResponse(statusMsg);
      }
    }
  }
}
