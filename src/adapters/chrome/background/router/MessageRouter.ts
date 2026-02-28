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
} from "@core/domain/constants";
import { createLogger } from "@core/application/logging/Logger";
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
} from "@core/domain/messageTypes";
import { isMessageCommand } from "@core/domain/contracts/messages";
import {
  checkLastError,
  getDomain,
  isEnabledForDomain,
} from "@core/application/utils";
import { logError } from "@core/domain/error";
import { resolveDomainRuntimeSettings } from "../config/runtimeSettings";
import { BackgroundServiceWorker } from "../BackgroundServiceWorker";
import {
  createErrorMappingMiddleware,
  createLoggingMiddleware,
  createValidationMiddleware,
  HandlerRegistry,
} from "./HandlerRegistry";

const logger = createLogger("MessageRouter");

const ROUTED_MESSAGE_COMMANDS = [
  CMD_CONTENT_SCRIPT_PREDICT_REQ,
  CMD_OPTIONS_PAGE_CONFIG_CHANGE,
  CMD_CONTENT_SCRIPT_GET_CONFIG,
  CMD_CONTENT_SCRIPT_USAGE_EVENT,
  CMD_POPUP_GET_PRODUCTIVITY_STATS,
  CMD_POPUP_ACK_WEEKLY_RECAP,
  CMD_POPUP_ACK_DONATION_MILESTONE,
  CMD_OPTIONS_RESET_PRODUCTIVITY_STATS,
  CMD_OPTIONS_GET_PREDICTOR_DEBUG_SNAPSHOT,
  CMD_OPTIONS_CLEAR_PREDICTOR_DEBUG_TRACE,
] as const;

type RoutedMessageCommand = (typeof ROUTED_MESSAGE_COMMANDS)[number];

const ROUTED_MESSAGE_COMMAND_SET = new Set<string>(ROUTED_MESSAGE_COMMANDS);

function isRoutedMessageCommand(command: string): command is RoutedMessageCommand {
  return isMessageCommand(command) && ROUTED_MESSAGE_COMMAND_SET.has(command);
}

interface MessageDispatchPayload {
  request: unknown;
  sender: chrome.runtime.MessageSender;
  sendResponse: (response?: unknown) => void;
  worker: BackgroundServiceWorker;
}

const MESSAGE_ERROR_LABELS: Record<RoutedMessageCommand, string> = {
  [CMD_CONTENT_SCRIPT_PREDICT_REQ]: "MessageRouter.handleContentScriptPredictReq",
  [CMD_OPTIONS_PAGE_CONFIG_CHANGE]: "handleOptionsPageConfigChange",
  [CMD_CONTENT_SCRIPT_GET_CONFIG]: "MessageRouter.handleContentScriptGetConfig",
  [CMD_CONTENT_SCRIPT_USAGE_EVENT]: "MessageRouter.handleContentScriptUsageEvent",
  [CMD_POPUP_GET_PRODUCTIVITY_STATS]: "MessageRouter.handlePopupGetProductivityStats",
  [CMD_POPUP_ACK_WEEKLY_RECAP]: "MessageRouter.handlePopupAckWeeklyRecap",
  [CMD_POPUP_ACK_DONATION_MILESTONE]:
    "MessageRouter.handlePopupAckDonationMilestone",
  [CMD_OPTIONS_RESET_PRODUCTIVITY_STATS]:
    "MessageRouter.handleOptionsResetProductivityStats",
  [CMD_OPTIONS_GET_PREDICTOR_DEBUG_SNAPSHOT]:
    "MessageRouter.handleOptionsGetPredictorDebugSnapshot",
  [CMD_OPTIONS_CLEAR_PREDICTOR_DEBUG_TRACE]:
    "MessageRouter.handleOptionsClearPredictorDebugTrace",
};

export class MessageRouter {
  private readonly getWorker: () => BackgroundServiceWorker;
  private readonly registry: HandlerRegistry<
    RoutedMessageCommand,
    MessageDispatchPayload,
    void
  >;

  constructor(getWorker: () => BackgroundServiceWorker) {
    this.getWorker = getWorker;
    this.registry = new HandlerRegistry<
      RoutedMessageCommand,
      MessageDispatchPayload,
      void
    >([
      createErrorMappingMiddleware<MessageDispatchPayload, void>({
        mapUnknownCommand: (command) => {
          logError("onMessage", `Unknown command: ${command}`);
        },
        mapError: (error, context) => {
          const label = MESSAGE_ERROR_LABELS[context.command as RoutedMessageCommand];
          logError(label, error);
          context.payload.sendResponse({ ok: false });
        },
      }),
      createLoggingMiddleware(logger),
      createValidationMiddleware<
        MessageDispatchPayload,
        void,
        RoutedMessageCommand
      >(isRoutedMessageCommand),
    ]);

    this.registry
      .register(CMD_CONTENT_SCRIPT_PREDICT_REQ, (payload) =>
        this.handleContentScriptPredictReq(
          payload.request as ContentScriptPredictRequestMessage,
          payload.sender,
          payload.sendResponse,
          payload.worker,
        ),
      )
      .register(CMD_OPTIONS_PAGE_CONFIG_CHANGE, (payload) =>
        this.handleOptionsPageConfigChange(
          payload.request as OptionsPageConfigChangeMessage,
          payload.sender,
          payload.sendResponse,
          payload.worker,
        ),
      )
      .register(CMD_CONTENT_SCRIPT_GET_CONFIG, (payload) =>
        this.handleContentScriptGetConfig(
          payload.request as ContentScriptGetConfigMessage,
          payload.sender,
          payload.sendResponse,
          payload.worker,
        ),
      )
      .register(CMD_CONTENT_SCRIPT_USAGE_EVENT, (payload) =>
        this.handleContentScriptUsageEvent(
          payload.request as ContentScriptUsageEventMessage,
          payload.sender,
          payload.sendResponse,
          payload.worker,
        ),
      )
      .register(CMD_POPUP_GET_PRODUCTIVITY_STATS, (payload) =>
        this.handlePopupGetProductivityStats(
          payload.request as PopupGetProductivityStatsMessage,
          payload.sender,
          payload.sendResponse,
          payload.worker,
        ),
      )
      .register(CMD_POPUP_ACK_WEEKLY_RECAP, (payload) =>
        this.handlePopupAckWeeklyRecap(
          payload.request as PopupAckWeeklyRecapMessage,
          payload.sender,
          payload.sendResponse,
          payload.worker,
        ),
      )
      .register(CMD_POPUP_ACK_DONATION_MILESTONE, (payload) =>
        this.handlePopupAckDonationMilestone(
          payload.request as PopupAckDonationMilestoneMessage,
          payload.sender,
          payload.sendResponse,
          payload.worker,
        ),
      )
      .register(CMD_OPTIONS_RESET_PRODUCTIVITY_STATS, (payload) =>
        this.handleOptionsResetProductivityStats(
          payload.request as OptionsResetProductivityStatsMessage,
          payload.sender,
          payload.sendResponse,
          payload.worker,
        ),
      )
      .register(CMD_OPTIONS_GET_PREDICTOR_DEBUG_SNAPSHOT, (payload) =>
        this.handleOptionsGetPredictorDebugSnapshot(
          payload.request as OptionsGetPredictorDebugSnapshotMessage,
          payload.sender,
          payload.sendResponse,
          payload.worker,
        ),
      )
      .register(CMD_OPTIONS_CLEAR_PREDICTOR_DEBUG_TRACE, (payload) =>
        this.handleOptionsClearPredictorDebugTrace(
          payload.request as OptionsClearPredictorDebugTraceMessage,
          payload.sender,
          payload.sendResponse,
          payload.worker,
        ),
      );
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

    const worker = this.getWorker();
    const isHandledCommand = this.registry.has(maybeRequest.command);

    if (!isHandledCommand) {
      logError("onMessage", `Unknown command: ${maybeRequest.command}`);
      return false;
    }

    void this.registry.dispatch(maybeRequest.command, {
      request: request as Message,
      sender,
      sendResponse,
      worker,
    });

    return maybeRequest.command !== CMD_CONTENT_SCRIPT_PREDICT_REQ;
  }

  private async handleContentScriptPredictReq(
    request: ContentScriptPredictRequestMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
    worker: BackgroundServiceWorker,
  ): Promise<void> {
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
  }

  private async handleOptionsPageConfigChange(
    request: OptionsPageConfigChangeMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
    worker: BackgroundServiceWorker,
  ): Promise<void> {
    await worker.updatePresageConfig();
    sendResponse({ ok: true });
  }

  private async handleContentScriptGetConfig(
    request: ContentScriptGetConfigMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
    worker: BackgroundServiceWorker,
  ): Promise<void> {
    const domain = getDomain(sender.tab?.url || "") || "";
    const isEnabled = await isEnabledForDomain(worker.settingsManager, domain);
    const message = await worker.getBackgroundPageSetConfigMsg(domain);
    message.context.enabled = isEnabled;
    sendResponse(message);
  }

  private async handleContentScriptUsageEvent(
    request: ContentScriptUsageEventMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
    worker: BackgroundServiceWorker,
  ): Promise<void> {
    await worker.productivityStatsManager.recordUsageEvent(request.context);
    sendResponse({ ok: true });
  }

  private async handlePopupGetProductivityStats(
    request: PopupGetProductivityStatsMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
    worker: BackgroundServiceWorker,
  ): Promise<void> {
    const stats = await worker.productivityStatsManager.getDashboardStats();
    sendResponse(stats);
  }

  private async handlePopupAckWeeklyRecap(
    request: PopupAckWeeklyRecapMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
    worker: BackgroundServiceWorker,
  ): Promise<void> {
    await worker.productivityStatsManager.acknowledgeWeeklyRecap(
      request.context.weekKey,
    );
    sendResponse({ ok: true });
  }

  private async handlePopupAckDonationMilestone(
    request: PopupAckDonationMilestoneMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
    worker: BackgroundServiceWorker,
  ): Promise<void> {
    await worker.productivityStatsManager.handleDonationPromptAction(
      request.context.promptId,
      request.context.action,
      request.context.milestoneHours,
    );
    sendResponse({ ok: true });
  }

  private async handleOptionsResetProductivityStats(
    request: OptionsResetProductivityStatsMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
    worker: BackgroundServiceWorker,
  ): Promise<void> {
    await worker.productivityStatsManager.resetStats();
    sendResponse({ ok: true });
  }

  private async handleOptionsGetPredictorDebugSnapshot(
    request: OptionsGetPredictorDebugSnapshotMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
    worker: BackgroundServiceWorker,
  ): Promise<void> {
    await worker.predictionManager.initialize();
    sendResponse(worker.predictionManager.getPredictorDebugSnapshot());
  }

  private async handleOptionsClearPredictorDebugTrace(
    request: OptionsClearPredictorDebugTraceMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
    worker: BackgroundServiceWorker,
  ): Promise<void> {
    worker.predictionManager.clearPredictorDebugTrace();
    sendResponse({ ok: true });
  }
}
