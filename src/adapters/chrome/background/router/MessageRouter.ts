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
  Message,
  PredictRequestMessage,
  UpdateLangConfigMessage,
} from "@core/domain/messageTypes";
import {
  isMessageCommand,
  parseRuntimeMessage,
} from "@core/domain/contracts/messages";
import {
  getDomain,
  isEnabledForDomain,
} from "@core/application/domain-utils";
import { checkLastError } from "@core/application/transport-utils";
import {
  ConfigError,
  PredictorError,
  TransportError,
  isFluentTyperError,
  logError,
} from "@core/domain/error";
import { resolveDomainRuntimeSettings } from "../config/runtimeSettings";
import { BackgroundServiceWorker } from "../BackgroundServiceWorker";
import {
  createErrorMappingMiddleware,
  createLoggingMiddleware,
  createValidationMiddleware,
  HandlerRegistry,
} from "./HandlerRegistry";
import { mapRuntimeError } from "./RuntimeErrorMapper";

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

type CommandPayload<TCommand extends RoutedMessageCommand = RoutedMessageCommand> =
  Omit<MessageDispatchPayload, "request"> & {
    request: RoutedMessageByCommand[TCommand];
  };

interface SenderRoutingContext {
  tabId: number;
  frameId: number;
}

function resolveSenderRoutingContext(
  sender: chrome.runtime.MessageSender,
): SenderRoutingContext | null {
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number") {
    return null;
  }
  return {
    tabId,
    frameId: typeof sender.frameId === "number" ? sender.frameId : 0,
  };
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
          const mappedError = mapRuntimeError(error);
          logError(
            `${label}.${mappedError.category}.${mappedError.code}`,
            error,
          );
          context.payload.sendResponse(mappedError.response);
        },
      }),
      createLoggingMiddleware(logger),
      createValidationMiddleware<
        MessageDispatchPayload,
        void,
        RoutedMessageCommand
      >(isRoutedMessageCommand),
    ]);

    const register = <TCommand extends RoutedMessageCommand>(
      command: TCommand,
      handler: (payload: CommandPayload<TCommand>) => Promise<void>,
    ): void => {
      this.registry.register(command, this.createCommandHandler(command, handler));
    };

    register(
      CMD_CONTENT_SCRIPT_PREDICT_REQ,
      this.handleContentScriptPredictReq.bind(this),
    );
    register(
      CMD_OPTIONS_PAGE_CONFIG_CHANGE,
      this.handleOptionsPageConfigChange.bind(this),
    );
    register(
      CMD_CONTENT_SCRIPT_GET_CONFIG,
      this.handleContentScriptGetConfig.bind(this),
    );
    register(
      CMD_CONTENT_SCRIPT_USAGE_EVENT,
      this.handleContentScriptUsageEvent.bind(this),
    );
    register(
      CMD_POPUP_GET_PRODUCTIVITY_STATS,
      this.handlePopupGetProductivityStats.bind(this),
    );
    register(
      CMD_POPUP_ACK_WEEKLY_RECAP,
      this.handlePopupAckWeeklyRecap.bind(this),
    );
    register(
      CMD_POPUP_ACK_DONATION_MILESTONE,
      this.handlePopupAckDonationMilestone.bind(this),
    );
    register(
      CMD_OPTIONS_RESET_PRODUCTIVITY_STATS,
      this.handleOptionsResetProductivityStats.bind(this),
    );
    register(
      CMD_OPTIONS_GET_PREDICTOR_DEBUG_SNAPSHOT,
      this.handleOptionsGetPredictorDebugSnapshot.bind(this),
    );
    register(
      CMD_OPTIONS_CLEAR_PREDICTOR_DEBUG_TRACE,
      this.handleOptionsClearPredictorDebugTrace.bind(this),
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

    void this.registry.dispatch(runtimeMessage.command, {
      request: runtimeMessage,
      sender,
      sendResponse,
      worker: this.getWorker(),
    });

    return runtimeMessage.command !== CMD_CONTENT_SCRIPT_PREDICT_REQ;
  }

  private createCommandHandler<TCommand extends RoutedMessageCommand>(
    command: TCommand,
    handler: (payload: CommandPayload<TCommand>) => Promise<void>,
  ): (payload: MessageDispatchPayload) => Promise<void> {
    return async (payload) => {
      if (payload.request.command !== command) {
        throw new TransportError(
          `Command/payload mismatch: expected ${command}, received ${payload.request.command}`,
          {
            code: "message_command_payload_mismatch",
          },
        );
      }
      await handler({
        ...payload,
        request: payload.request as RoutedMessageByCommand[TCommand],
      });
    };
  }

  private async handleContentScriptPredictReq(
    payload: CommandPayload<typeof CMD_CONTENT_SCRIPT_PREDICT_REQ>,
  ): Promise<void> {
    const { request, sender, sendResponse, worker } = payload;
    const senderContext = resolveSenderRoutingContext(sender);
    if (!senderContext) {
      throw new TransportError("Missing sender tab id for prediction request", {
        code: "message_missing_sender_tab_id",
      });
    }

    const { tabId, frameId } = senderContext;
    const domainURL = getDomain(sender.tab?.url || "");

    let domainSettings: Awaited<ReturnType<typeof resolveDomainRuntimeSettings>>;
    try {
      domainSettings = await resolveDomainRuntimeSettings(
        worker.settingsManager,
        domainURL,
      );
    } catch (error) {
      if (isFluentTyperError(error)) {
        throw error;
      }
      throw new ConfigError("Failed to resolve domain runtime settings", {
        code: "message_resolve_domain_runtime_settings_failed",
        cause: error,
      });
    }

    let language = domainSettings.language;
    worker.language = language;

    if (language === "auto_detect") {
      try {
        language = await worker.detectLanguage(
          request.context.text,
          tabId,
          domainSettings.enabledLanguages,
        );
      } catch (error) {
        if (isFluentTyperError(error)) {
          throw error;
        }
        throw new PredictorError("Failed to auto-detect language", {
          code: "message_detect_language_failed",
          cause: error,
        });
      }
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
        traceId: request.context.traceId,
        traceStartedAtMs: request.context.traceStartedAtMs,
      },
    };

    try {
      await worker.runPrediction(
        predictRequestMessage,
        domainSettings.hasNumSuggestionsOverride
          ? { numSuggestions: domainSettings.numSuggestions }
          : undefined,
      );
    } catch (error) {
      if (isFluentTyperError(error)) {
        throw error;
      }
      throw new PredictorError("Failed to run prediction", {
        code: "message_run_prediction_failed",
        cause: error,
      });
    }

    sendResponse({ ok: true });
  }

  private async handleOptionsPageConfigChange(
    payload: CommandPayload<typeof CMD_OPTIONS_PAGE_CONFIG_CHANGE>,
  ): Promise<void> {
    const { sendResponse, worker } = payload;
    try {
      await worker.updatePresageConfig();
    } catch (error) {
      if (isFluentTyperError(error)) {
        throw error;
      }
      throw new ConfigError("Failed to update prediction runtime config", {
        code: "message_update_runtime_config_failed",
        cause: error,
      });
    }
    sendResponse({ ok: true });
  }

  private async handleContentScriptGetConfig(
    payload: CommandPayload<typeof CMD_CONTENT_SCRIPT_GET_CONFIG>,
  ): Promise<void> {
    const { sender, sendResponse, worker } = payload;
    const domain = getDomain(sender.tab?.url || "") || "";

    let isEnabled: boolean;
    let message: Awaited<
      ReturnType<BackgroundServiceWorker["getBackgroundPageSetConfigMsg"]>
    >;
    try {
      [isEnabled, message] = await Promise.all([
        isEnabledForDomain(worker.settingsManager, domain),
        worker.getBackgroundPageSetConfigMsg(domain),
      ]);
    } catch (error) {
      if (isFluentTyperError(error)) {
        throw error;
      }
      throw new ConfigError("Failed to resolve content script config", {
        code: "message_get_content_script_config_failed",
        cause: error,
      });
    }

    message.context.enabled = isEnabled;
    sendResponse(message);
  }

  private async handleContentScriptUsageEvent(
    payload: CommandPayload<typeof CMD_CONTENT_SCRIPT_USAGE_EVENT>,
  ): Promise<void> {
    const { request, sendResponse, worker } = payload;
    await worker.productivityStatsManager.recordUsageEvent(request.context);
    sendResponse({ ok: true });
  }

  private async handlePopupGetProductivityStats(
    payload: CommandPayload<typeof CMD_POPUP_GET_PRODUCTIVITY_STATS>,
  ): Promise<void> {
    const { sendResponse, worker } = payload;
    sendResponse(await worker.productivityStatsManager.getDashboardStats());
  }

  private async handlePopupAckWeeklyRecap(
    payload: CommandPayload<typeof CMD_POPUP_ACK_WEEKLY_RECAP>,
  ): Promise<void> {
    const { request, sendResponse, worker } = payload;
    await worker.productivityStatsManager.acknowledgeWeeklyRecap(
      request.context.weekKey,
    );
    sendResponse({ ok: true });
  }

  private async handlePopupAckDonationMilestone(
    payload: CommandPayload<typeof CMD_POPUP_ACK_DONATION_MILESTONE>,
  ): Promise<void> {
    const { request, sendResponse, worker } = payload;
    await worker.productivityStatsManager.handleDonationPromptAction(
      request.context.promptId,
      request.context.action,
      request.context.milestoneHours,
    );
    sendResponse({ ok: true });
  }

  private async handleOptionsResetProductivityStats(
    payload: CommandPayload<typeof CMD_OPTIONS_RESET_PRODUCTIVITY_STATS>,
  ): Promise<void> {
    const { sendResponse, worker } = payload;
    await worker.productivityStatsManager.resetStats();
    sendResponse({ ok: true });
  }

  private async handleOptionsGetPredictorDebugSnapshot(
    payload: CommandPayload<typeof CMD_OPTIONS_GET_PREDICTOR_DEBUG_SNAPSHOT>,
  ): Promise<void> {
    const { sendResponse, worker } = payload;
    await worker.predictionManager.initialize();
    sendResponse(worker.predictionManager.getPredictorDebugSnapshot());
  }

  private async handleOptionsClearPredictorDebugTrace(
    payload: CommandPayload<typeof CMD_OPTIONS_CLEAR_PREDICTOR_DEBUG_TRACE>,
  ): Promise<void> {
    const { sendResponse, worker } = payload;
    worker.predictionManager.clearPredictorDebugTrace();
    sendResponse({ ok: true });
  }
}
