import { checkLastError } from "@core/application/utils";
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

export type ContentMessageHandlerDependencies = {
  getEnabled: () => boolean;
  setEnabled: (value: boolean) => void;
  toggleEnabled: () => void;
  setConfig: (config: SetConfigContext) => void;
  updateLanguage: (lang: string) => void;
  triggerActiveTribute: () => void;
  fulfillPrediction: (context: PredictResponseContext) => void;
  getLanguage: () => string;
};

export class ContentMessageHandler {
  private pendingReq: ContentScriptPredictRequestMessage | null = null;

  constructor(
    private readonly dependencies: ContentMessageHandlerDependencies,
  ) {}

  handleGetPrediction(context: ContentScriptPredictRequestContext): void {
    logger.debug("Preparing prediction request", {
      requestId: context.requestId,
      tributeId: context.tributeId,
      nextChar: context.nextChar,
      lang: this.dependencies.getLanguage(),
    });
    const message: ContentScriptPredictRequestMessage = {
      command: CMD_CONTENT_SCRIPT_PREDICT_REQ,
      context: {
        text: context.text,
        nextChar: context.nextChar,
        tributeId: context.tributeId,
        requestId: context.requestId,
        lang: this.dependencies.getLanguage(),
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
        if (
          this.pendingReq &&
          this.pendingReq.context.tributeId === context.tributeId &&
          this.pendingReq.context.requestId === context.requestId
        ) {
          logger.debug("Fulfilling prediction response", {
            requestId: context.requestId,
            tributeId: context.tributeId,
            predictionCount: context.predictions.length,
          });
          this.dependencies.fulfillPrediction(context);
          this.pendingReq = null;
        } else {
          logger.warn("Ignored prediction response due to mismatch", {
            requestId: context.requestId,
            tributeId: context.tributeId,
            hasPendingRequest: Boolean(this.pendingReq),
            pendingRequestId: this.pendingReq?.context.requestId,
            pendingTributeId: this.pendingReq?.context.tributeId,
          });
        }
        break;
      }
      case CMD_BACKGROUND_PAGE_SET_CONFIG:
        this.dependencies.setConfig(
          (message as { context: SetConfigContext }).context,
        );
        sendStatusMsg = true;
        break;
      case CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG:
        this.dependencies.updateLanguage(
          (message as { context: { lang: string } }).context.lang,
        );
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
        this.dependencies.triggerActiveTribute();
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
