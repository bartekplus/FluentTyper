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
import {
  isMessageCommand,
  parseRuntimeMessage,
} from "@core/domain/contracts/messages";
import { err, ok, type Result } from "@core/domain/result";
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
type RoutedMessage = Extract<Message, { command: RoutedMessageCommand }>;
type RoutedMessageByCommand = {
  [TCommand in RoutedMessageCommand]: Extract<RoutedMessage, { command: TCommand }>;
};

const ROUTED_MESSAGE_COMMAND_SET = new Set<string>(ROUTED_MESSAGE_COMMANDS);

function isRoutedMessageCommand(command: string): command is RoutedMessageCommand {
  return isMessageCommand(command) && ROUTED_MESSAGE_COMMAND_SET.has(command);
}

function isRoutedMessage(message: Message): message is RoutedMessage {
  return isRoutedMessageCommand(message.command);
}

interface MessageDispatchPayload {
  request: RoutedMessage;
  sender: chrome.runtime.MessageSender;
  sendResponse: (response?: unknown) => void;
  worker: BackgroundServiceWorker;
}

interface SenderRoutingContext {
  tabId: number;
  frameId: number;
}

type SenderRoutingContextError = { kind: "missing_tab_id" };

function resolveSenderRoutingContext(
  sender: chrome.runtime.MessageSender,
): Result<SenderRoutingContext, SenderRoutingContextError> {
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number") {
    return err({ kind: "missing_tab_id" });
  }
  return ok({
    tabId,
    frameId: typeof sender.frameId === "number" ? sender.frameId : 0,
  });
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
          const label = isRoutedMessageCommand(context.command)
            ? MESSAGE_ERROR_LABELS[context.command]
            : "MessageRouter.handle";
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
      .register(
        CMD_CONTENT_SCRIPT_PREDICT_REQ,
        this.createCommandHandler(
          CMD_CONTENT_SCRIPT_PREDICT_REQ,
          this.handleContentScriptPredictReq.bind(this),
        ),
      )
      .register(
        CMD_OPTIONS_PAGE_CONFIG_CHANGE,
        this.createCommandHandler(
          CMD_OPTIONS_PAGE_CONFIG_CHANGE,
          this.handleOptionsPageConfigChange.bind(this),
        ),
      )
      .register(
        CMD_CONTENT_SCRIPT_GET_CONFIG,
        this.createCommandHandler(
          CMD_CONTENT_SCRIPT_GET_CONFIG,
          this.handleContentScriptGetConfig.bind(this),
        ),
      )
      .register(
        CMD_CONTENT_SCRIPT_USAGE_EVENT,
        this.createCommandHandler(
          CMD_CONTENT_SCRIPT_USAGE_EVENT,
          this.handleContentScriptUsageEvent.bind(this),
        ),
      )
      .register(
        CMD_POPUP_GET_PRODUCTIVITY_STATS,
        this.createCommandHandler(
          CMD_POPUP_GET_PRODUCTIVITY_STATS,
          this.handlePopupGetProductivityStats.bind(this),
        ),
      )
      .register(
        CMD_POPUP_ACK_WEEKLY_RECAP,
        this.createCommandHandler(
          CMD_POPUP_ACK_WEEKLY_RECAP,
          this.handlePopupAckWeeklyRecap.bind(this),
        ),
      )
      .register(
        CMD_POPUP_ACK_DONATION_MILESTONE,
        this.createCommandHandler(
          CMD_POPUP_ACK_DONATION_MILESTONE,
          this.handlePopupAckDonationMilestone.bind(this),
        ),
      )
      .register(
        CMD_OPTIONS_RESET_PRODUCTIVITY_STATS,
        this.createCommandHandler(
          CMD_OPTIONS_RESET_PRODUCTIVITY_STATS,
          this.handleOptionsResetProductivityStats.bind(this),
        ),
      )
      .register(
        CMD_OPTIONS_GET_PREDICTOR_DEBUG_SNAPSHOT,
        this.createCommandHandler(
          CMD_OPTIONS_GET_PREDICTOR_DEBUG_SNAPSHOT,
          this.handleOptionsGetPredictorDebugSnapshot.bind(this),
        ),
      )
      .register(
        CMD_OPTIONS_CLEAR_PREDICTOR_DEBUG_TRACE,
        this.createCommandHandler(
          CMD_OPTIONS_CLEAR_PREDICTOR_DEBUG_TRACE,
          this.handleOptionsClearPredictorDebugTrace.bind(this),
        ),
      );
  }

  handle(
    request: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): boolean {
    checkLastError();
    const parsedRequest = parseRuntimeMessage(request);
    if (!parsedRequest.ok) {
      if (parsedRequest.error.kind === "invalid_payload") {
        logger.warn("Ignored non-runtime message payload");
        return false;
      }
      if (parsedRequest.error.kind === "invalid_command") {
        logger.warn("Ignored message without command");
        return false;
      }
      logError("onMessage", `Unknown command: ${parsedRequest.error.command}`);
      return false;
    }
    const runtimeMessage = parsedRequest.value;

    if (!isRoutedMessage(runtimeMessage)) {
      logError("onMessage", `Unknown command: ${runtimeMessage.command}`);
      return false;
    }
    const worker = this.getWorker();

    void this.registry.dispatch(runtimeMessage.command, {
      request: runtimeMessage,
      sender,
      sendResponse,
      worker,
    });

    return runtimeMessage.command !== CMD_CONTENT_SCRIPT_PREDICT_REQ;
  }

  private createCommandHandler<TCommand extends RoutedMessageCommand>(
    command: TCommand,
    handler: (
      request: RoutedMessageByCommand[TCommand],
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
      worker: BackgroundServiceWorker,
    ) => Promise<void>,
  ): (payload: MessageDispatchPayload) => Promise<void> {
    return async (payload) => {
      if (payload.request.command !== command) {
        throw new Error(
          `Command/payload mismatch: expected ${command}, received ${payload.request.command}`,
        );
      }
      const typedRequest = payload.request as RoutedMessageByCommand[TCommand];
      await handler(
        typedRequest,
        payload.sender,
        payload.sendResponse,
        payload.worker,
      );
    };
  }

  private async handleContentScriptPredictReq(
    request: ContentScriptPredictRequestMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
    worker: BackgroundServiceWorker,
  ): Promise<void> {
    const senderContext = resolveSenderRoutingContext(sender);
    if (!senderContext.ok) {
      logError(
        "MessageRouter.handleContentScriptPredictReq",
        "Missing sender tab id for prediction request",
      );
      sendResponse({ ok: false });
      return;
    }

    const { tabId, frameId } = senderContext.value;
    const domainURL = getDomain(sender.tab?.url || "");
    const domainSettings = await resolveDomainRuntimeSettings(
      worker.settingsManager,
      domainURL,
    );
    let language = domainSettings.language;
    worker.language = language;

    if (language === "auto_detect") {
      language = await worker.detectLanguage(
        request.context.text,
        tabId,
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
        tabId,
        frameId,
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
