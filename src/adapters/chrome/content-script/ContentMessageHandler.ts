import { checkLastError } from "@core/application/utils";
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
  private static readonly LOG_PREFIX = "ContentScript";

  private pendingReq: ContentScriptPredictRequestMessage | null = null;

  constructor(
    private readonly dependencies: ContentMessageHandlerDependencies,
  ) {}

  handleGetPrediction(context: ContentScriptPredictRequestContext): void {
    console.debug(
      "[%s:%s:%s] called with context:",
      ContentMessageHandler.LOG_PREFIX,
      this.constructor.name,
      this.handleGetPrediction.name,
      context,
    );
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
      console.error(
        "[%s:%s:%s] Received empty message in messageHandler",
        ContentMessageHandler.LOG_PREFIX,
        this.constructor.name,
        this.handleMessage.name,
      );
      return;
    }
    console.groupCollapsed(
      "[%s:%s:%s] Handling message %s:",
      ContentMessageHandler.LOG_PREFIX,
      this.constructor.name,
      this.handleMessage.name,
      message.command,
      message,
    );

    switch (message.command) {
      case CMD_BACKGROUND_PAGE_PREDICT_RESP: {
        const context = (message as { context: PredictResponseContext }).context;
        if (
          this.pendingReq &&
          this.pendingReq.context.tributeId === context.tributeId &&
          this.pendingReq.context.requestId === context.requestId
        ) {
          console.info(
            "[%s:%s:%s] Fulfilling prediction with context:",
            ContentMessageHandler.LOG_PREFIX,
            this.constructor.name,
            this.handleMessage.name,
            context,
          );
          this.dependencies.fulfillPrediction(context);
          this.pendingReq = null;
        } else {
          console.warn(
            "[%s:%s:%s] Prediction response ignored (mismatch or no pending request):",
            ContentMessageHandler.LOG_PREFIX,
            this.constructor.name,
            this.handleMessage.name,
            context,
          );
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
        console.trace(
          "[%s:%s:%s] Unknown message command: %s",
          ContentMessageHandler.LOG_PREFIX,
          this.constructor.name,
          this.handleMessage.name,
          message.command,
          message,
        );
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
    console.groupEnd();
  }
}
