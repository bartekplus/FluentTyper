import { checkLastError } from "@core/application/transport-utils";
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
import {
  createPredictionTraceContext,
  resolveTraceAgeMs,
} from "./predictionTrace";

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
  private lastRuntimeStatusSignature: string | null = null;
  private lastRuntimeStatusAt = 0;

  constructor(private readonly dependencies: ContentMessageHandlerDependencies) {}

  handleGetPrediction(context: ContentScriptPredictRequestContext): void {
    const runtimeGeneration =
      typeof context.runtimeGeneration === "number" && Number.isFinite(context.runtimeGeneration)
        ? context.runtimeGeneration
        : this.dependencies.getPredictionGeneration();
    const traceStartedAtMs =
      typeof context.traceStartedAtMs === "number" && Number.isFinite(context.traceStartedAtMs)
        ? context.traceStartedAtMs
        : Date.now();
    const traceContext = createPredictionTraceContext(
      traceStartedAtMs,
      isNonEmptyString(context.traceId) ? context.traceId.trim() : undefined,
    );
    const lang = this.dependencies.getLanguage();

    logger.debug("Preparing prediction request", {
      traceId: traceContext.traceId,
      requestId: context.requestId,
      suggestionId: context.suggestionId,
      runtimeGeneration,
      nextChar: context.nextChar,
      lang,
      requestAgeMs: resolveTraceAgeMs(traceContext.traceStartedAtMs),
    });
    const message: ContentScriptPredictRequestMessage = {
      command: CMD_CONTENT_SCRIPT_PREDICT_REQ,
      context: {
        text: context.text,
        nextChar: context.nextChar,
        afterCursorTokenSuffix: context.afterCursorTokenSuffix,
        inputAction: context.inputAction,
        suggestionId: context.suggestionId,
        requestId: context.requestId,
        runtimeGeneration,
        lang,
        documentLang: document.documentElement.lang || undefined,
        traceId: traceContext.traceId,
        traceStartedAtMs: traceContext.traceStartedAtMs,
      },
    };
    this.pendingReq = message;
    void chrome.runtime.sendMessage(message);
  }

  reportRuntimeStatus(runtimeGeneration?: number): void {
    const resolvedRuntimeGeneration =
      typeof runtimeGeneration === "number" && Number.isFinite(runtimeGeneration)
        ? runtimeGeneration
        : this.dependencies.getPredictionGeneration();
    if (resolvedRuntimeGeneration <= 0) {
      return;
    }
    const domainURL = window.location.hostname || undefined;
    const signature = `${resolvedRuntimeGeneration}:${domainURL || ""}`;
    const now = Date.now();
    if (this.lastRuntimeStatusSignature === signature && now - this.lastRuntimeStatusAt < 250) {
      return;
    }
    this.lastRuntimeStatusSignature = signature;
    this.lastRuntimeStatusAt = now;
    const message: ContentScriptRuntimeStatusMessage = {
      command: CMD_CONTENT_SCRIPT_REPORT_RUNTIME_STATUS,
      context: {
        runtimeGeneration: resolvedRuntimeGeneration,
        domainURL,
      },
    };
    void chrome.runtime.sendMessage(message);
  }

  handleMessage(
    message: RuntimeInboundMessage | null,
    sender?: chrome.runtime.MessageSender,
    sendResponse?: (response: unknown) => void,
  ): void {
    void sender;
    checkLastError();
    if (!message) {
      logger.error("Received empty runtime message");
      return;
    }

    logger.debug("Handling runtime message", {
      command: message.command,
    });

    switch (message.command) {
      case CMD_BACKGROUND_PAGE_PREDICT_RESP: {
        this.handlePredictionResponse((message as { context: PredictResponseContext }).context);
        return;
      }
      case CMD_BACKGROUND_PAGE_SET_CONFIG:
        this.dependencies.setConfig((message as { context: SetConfigContext }).context);
        this.sendRuntimeStatus(sendResponse);
        return;
      case CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG:
        this.dependencies.updateLanguage((message as { context: { lang: string } }).context.lang);
        this.sendRuntimeStatus(sendResponse);
        return;
      case CMD_POPUP_PAGE_DISABLE:
        this.dependencies.setEnabled(false);
        this.sendRuntimeStatus(sendResponse);
        return;
      case CMD_POPUP_PAGE_ENABLE:
        this.dependencies.setEnabled(true);
        this.sendRuntimeStatus(sendResponse);
        return;
      case CMD_TOGGLE_FT_ACTIVE_TAB:
        this.dependencies.toggleEnabled();
        this.sendRuntimeStatus(sendResponse);
        return;
      case CMD_TRIGGER_FT_ACTIVE_TAB:
        this.dependencies.triggerActiveSuggestion();
        this.sendRuntimeStatus(sendResponse);
        return;
      case CMD_GET_HOSTNAME:
        sendResponse?.({ hostname: window.location.hostname });
        return;
      default:
        logger.debug("Unknown message command", { command: message.command });
        return;
    }
  }

  private handlePredictionResponse(context: PredictResponseContext): void {
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
        responseAgeMs: resolveTraceAgeMs(context.traceStartedAtMs),
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
  }

  private sendRuntimeStatus(sendResponse?: (response: unknown) => void): void {
    const statusMsg: PopupPageStatusMessage = {
      command: CMD_STATUS_COMMAND,
      context: { enabled: this.dependencies.getEnabled() },
    };
    sendResponse?.(statusMsg);
  }
}
