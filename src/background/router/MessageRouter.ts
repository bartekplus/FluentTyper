import {
  CMD_BACKGROUND_PAGE_PREDICT_REQ,
  CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG,
  CMD_CONTENT_SCRIPT_GET_CONFIG,
  CMD_CONTENT_SCRIPT_PREDICT_REQ,
  CMD_CONTENT_SCRIPT_USAGE_EVENT,
  CMD_OPTIONS_CLEAR_PREDICTOR_DEBUG_TRACE,
  CMD_OPTIONS_GET_PREDICTOR_DEBUG_SNAPSHOT,
  CMD_OPTIONS_PAGE_CONFIG_CHANGE,
  CMD_OPTIONS_RESET_PRODUCTIVITY_STATS,
  CMD_POPUP_ACK_DONATION_MILESTONE,
  CMD_POPUP_ACK_WEEKLY_RECAP,
  CMD_POPUP_GET_PRODUCTIVITY_STATS,
} from "../../shared/constants";
import { createLogger } from "../../shared/logging/Logger";
import type {
  ContentScriptGetConfigMessage,
  ContentScriptPredictRequestMessage,
  ContentScriptUsageEventMessage,
  Message,
  OptionsClearPredictorDebugTraceMessage,
  OptionsGetPredictorDebugSnapshotMessage,
  OptionsPageConfigChangeMessage,
  OptionsResetProductivityStatsMessage,
  PopupAckDonationMilestoneMessage,
  PopupAckWeeklyRecapMessage,
  PopupGetProductivityStatsMessage,
  PredictRequestMessage,
  UpdateLangConfigMessage,
} from "../../shared/messageTypes";
import { checkLastError, getDomain, isEnabledForDomain } from "../../shared/utils";
import { logError } from "../../shared/error";
import { resolveDomainRuntimeSettings } from "../config/runtimeSettings";
import { BackgroundServiceWorker } from "../BackgroundServiceWorker";

const logger = createLogger("MessageRouter");

type MessageHandler = (
  request: Message,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
  worker: BackgroundServiceWorker,
) => Promise<void>;

export class MessageRouter {
  private readonly getWorker: () => BackgroundServiceWorker;
  private readonly handlers: Partial<Record<Message["command"], MessageHandler>>;

  constructor(getWorker: () => BackgroundServiceWorker) {
    this.getWorker = getWorker;
    this.handlers = {
      [CMD_CONTENT_SCRIPT_PREDICT_REQ]: (request, sender, sendResponse, worker) =>
        this.handleContentScriptPredictReq(
          request as ContentScriptPredictRequestMessage,
          sender,
          sendResponse,
          worker,
        ),
      [CMD_OPTIONS_PAGE_CONFIG_CHANGE]: (request, sender, sendResponse, worker) =>
        this.handleOptionsPageConfigChange(
          request as OptionsPageConfigChangeMessage,
          sender,
          sendResponse,
          worker,
        ),
      [CMD_CONTENT_SCRIPT_GET_CONFIG]: (request, sender, sendResponse, worker) =>
        this.handleContentScriptGetConfig(
          request as ContentScriptGetConfigMessage,
          sender,
          sendResponse,
          worker,
        ),
      [CMD_CONTENT_SCRIPT_USAGE_EVENT]: (request, sender, sendResponse, worker) =>
        this.handleContentScriptUsageEvent(
          request as ContentScriptUsageEventMessage,
          sender,
          sendResponse,
          worker,
        ),
      [CMD_POPUP_GET_PRODUCTIVITY_STATS]: (request, sender, sendResponse, worker) =>
        this.handlePopupGetProductivityStats(
          request as PopupGetProductivityStatsMessage,
          sender,
          sendResponse,
          worker,
        ),
      [CMD_POPUP_ACK_WEEKLY_RECAP]: (request, sender, sendResponse, worker) =>
        this.handlePopupAckWeeklyRecap(
          request as PopupAckWeeklyRecapMessage,
          sender,
          sendResponse,
          worker,
        ),
      [CMD_POPUP_ACK_DONATION_MILESTONE]: (request, sender, sendResponse, worker) =>
        this.handlePopupAckDonationMilestone(
          request as PopupAckDonationMilestoneMessage,
          sender,
          sendResponse,
          worker,
        ),
      [CMD_OPTIONS_RESET_PRODUCTIVITY_STATS]: (
        request,
        sender,
        sendResponse,
        worker,
      ) =>
        this.handleOptionsResetProductivityStats(
          request as OptionsResetProductivityStatsMessage,
          sender,
          sendResponse,
          worker,
        ),
      [CMD_OPTIONS_GET_PREDICTOR_DEBUG_SNAPSHOT]: (
        request,
        sender,
        sendResponse,
        worker,
      ) =>
        this.handleOptionsGetPredictorDebugSnapshot(
          request as OptionsGetPredictorDebugSnapshotMessage,
          sender,
          sendResponse,
          worker,
        ),
      [CMD_OPTIONS_CLEAR_PREDICTOR_DEBUG_TRACE]: (
        request,
        sender,
        sendResponse,
        worker,
      ) =>
        this.handleOptionsClearPredictorDebugTrace(
          request as OptionsClearPredictorDebugTraceMessage,
          sender,
          sendResponse,
          worker,
        ),
    };
  }

  handle(
    request: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): boolean {
    checkLastError();
    if (!request || typeof request !== "object") {
      logger.warn("Ignored non-runtime message payload");
      return false;
    }
    const maybeRequest = request as { command?: unknown };
    if (typeof maybeRequest.command !== "string") {
      logger.warn("Ignored message without command");
      return false;
    }
    const runtimeMessage = request as Message;

    const worker = this.getWorker();
    const handler = this.handlers[runtimeMessage.command];
    if (!handler) {
      logError("onMessage", `Unknown command: ${runtimeMessage.command}`);
      return false;
    }

    void handler
      .call(this, runtimeMessage, sender, sendResponse, worker)
      .catch((error) => {
        logError("MessageRouter.handle", error);
        sendResponse({ ok: false });
      });

    return runtimeMessage.command !== CMD_CONTENT_SCRIPT_PREDICT_REQ;
  }

  private async handleContentScriptPredictReq(
    request: ContentScriptPredictRequestMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
    worker: BackgroundServiceWorker,
  ): Promise<void> {
    try {
      const domainURL = getDomain(sender.tab?.url || "");
      const domainSettings = await resolveDomainRuntimeSettings(
        worker.settingsManager,
        domainURL,
      );
      let language = domainSettings.language;
      worker.language = language;

      if (language === "auto_detect" && sender.tab?.id) {
        language = await worker.detectLanguage(
          request.context.text,
          sender.tab.id,
          domainSettings.enabledLanguages,
        );
      }

      if (request.context.lang !== language) {
        const updateLangConfigMessage: UpdateLangConfigMessage = {
          command: CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG,
          context: {
            lang: language,
          },
        };
        worker.sendCommandToActiveTabContentScript(updateLangConfigMessage);
      }

      const predictRequestMessage: PredictRequestMessage = {
        command: CMD_BACKGROUND_PAGE_PREDICT_REQ,
        context: {
          text: request.context.text,
          nextChar: request.context.nextChar,
          lang: language,
          tabId: sender.tab!.id!,
          frameId: sender.frameId!,
          tributeId: request.context.tributeId,
          requestId: request.context.requestId,
        },
      };

      await worker.runPrediction(
        predictRequestMessage,
        domainSettings.hasNumSuggestionsOverride
          ? { numSuggestions: domainSettings.numSuggestions }
          : undefined,
      );
      sendResponse({ ok: true });
    } catch (error) {
      logError("MessageRouter.handleContentScriptPredictReq", error);
      sendResponse({ ok: false });
    }
  }

  private async handleOptionsPageConfigChange(
    request: OptionsPageConfigChangeMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
    worker: BackgroundServiceWorker,
  ): Promise<void> {
    try {
      await worker.updatePresageConfig();
      sendResponse({ ok: true });
    } catch (error) {
      logError("handleOptionsPageConfigChange", error);
      sendResponse({ ok: false });
    }
  }

  private async handleContentScriptGetConfig(
    request: ContentScriptGetConfigMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
    worker: BackgroundServiceWorker,
  ): Promise<void> {
    try {
      const domain = getDomain(sender.tab?.url || "") || "";
      const isEnabled = await isEnabledForDomain(worker.settingsManager, domain);
      const message = await worker.getBackgroundPageSetConfigMsg(domain);
      message.context.enabled = isEnabled;
      sendResponse(message);
    } catch (error) {
      logError("MessageRouter.handleContentScriptGetConfig", error);
      sendResponse({ ok: false });
    }
  }

  private async handleContentScriptUsageEvent(
    request: ContentScriptUsageEventMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
    worker: BackgroundServiceWorker,
  ): Promise<void> {
    try {
      await worker.productivityStatsManager.recordUsageEvent(request.context);
      sendResponse({ ok: true });
    } catch (error) {
      logError("MessageRouter.handleContentScriptUsageEvent", error);
      sendResponse({ ok: false });
    }
  }

  private async handlePopupGetProductivityStats(
    request: PopupGetProductivityStatsMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
    worker: BackgroundServiceWorker,
  ): Promise<void> {
    try {
      const stats = await worker.productivityStatsManager.getDashboardStats();
      sendResponse(stats);
    } catch (error) {
      logError("MessageRouter.handlePopupGetProductivityStats", error);
      sendResponse({ ok: false });
    }
  }

  private async handlePopupAckWeeklyRecap(
    request: PopupAckWeeklyRecapMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
    worker: BackgroundServiceWorker,
  ): Promise<void> {
    try {
      await worker.productivityStatsManager.acknowledgeWeeklyRecap(
        request.context.weekKey,
      );
      sendResponse({ ok: true });
    } catch (error) {
      logError("MessageRouter.handlePopupAckWeeklyRecap", error);
      sendResponse({ ok: false });
    }
  }

  private async handlePopupAckDonationMilestone(
    request: PopupAckDonationMilestoneMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
    worker: BackgroundServiceWorker,
  ): Promise<void> {
    try {
      await worker.productivityStatsManager.handleDonationPromptAction(
        request.context.promptId,
        request.context.action,
        request.context.milestoneHours,
      );
      sendResponse({ ok: true });
    } catch (error) {
      logError("MessageRouter.handlePopupAckDonationMilestone", error);
      sendResponse({ ok: false });
    }
  }

  private async handleOptionsResetProductivityStats(
    request: OptionsResetProductivityStatsMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
    worker: BackgroundServiceWorker,
  ): Promise<void> {
    try {
      await worker.productivityStatsManager.resetStats();
      sendResponse({ ok: true });
    } catch (error) {
      logError("MessageRouter.handleOptionsResetProductivityStats", error);
      sendResponse({ ok: false });
    }
  }

  private async handleOptionsGetPredictorDebugSnapshot(
    request: OptionsGetPredictorDebugSnapshotMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
    worker: BackgroundServiceWorker,
  ): Promise<void> {
    try {
      await worker.predictionManager.initialize();
      sendResponse(worker.predictionManager.getPredictorDebugSnapshot());
    } catch (error) {
      logError("MessageRouter.handleOptionsGetPredictorDebugSnapshot", error);
      sendResponse({ ok: false });
    }
  }

  private async handleOptionsClearPredictorDebugTrace(
    request: OptionsClearPredictorDebugTraceMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
    worker: BackgroundServiceWorker,
  ): Promise<void> {
    try {
      worker.predictionManager.clearPredictorDebugTrace();
      sendResponse({ ok: true });
    } catch (error) {
      logError("MessageRouter.handleOptionsClearPredictorDebugTrace", error);
      sendResponse({ ok: false });
    }
  }
}
