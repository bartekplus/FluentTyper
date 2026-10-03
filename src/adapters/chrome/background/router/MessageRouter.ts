import { FieldPreferenceService } from "../FieldPreferenceService";
import { FieldPreferenceRepository } from "@core/application/repositories/FieldPreferenceRepository";
import {
  CMD_FIELD_PREFERENCES,
  CMD_BACKGROUND_PAGE_PREDICT_REQ,
  CMD_CONTENT_SCRIPT_ADD_TO_DICTIONARY,
  CMD_CONTENT_SCRIPT_DISABLE_REVIEW_RULE,
  CMD_CONTENT_SCRIPT_REVIEW_SPELLING,
  CMD_CONTENT_SCRIPT_REVIEW_ENGINE,
  CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG,
  CMD_CONTENT_SCRIPT_GET_CONFIG,
  CMD_CONTENT_SCRIPT_PREDICT_REQ,
  CMD_CONTENT_SCRIPT_REPORT_OBSERVABILITY_EVENT,
  CMD_CONTENT_SCRIPT_REPORT_OBSERVABILITY_MODULES,
  CMD_CONTENT_SCRIPT_REPORT_RUNTIME_STATUS,
  CMD_CONTENT_SCRIPT_USAGE_EVENT,
  CMD_CONTENT_SCRIPT_PERSONALIZATION_EVENT,
  CMD_GET_AUTO_LANGUAGE_STATUS,
  CMD_LOCAL_AI_CANCEL_INSTALL,
  CMD_LOCAL_AI_DELETE_MODEL,
  CMD_LOCAL_AI_DISMISS_SETUP_OFFER,
  CMD_LOCAL_AI_ENSURE_HOST,
  CMD_LOCAL_AI_GET_STATUS,
  CMD_LOCAL_AI_INSTALL,
  CMD_LOCAL_AI_OPEN_SETUP,
  CMD_OPTIONS_CLEAR_OBSERVABILITY_EVENTS,
  CMD_OPTIONS_GET_OBSERVABILITY_SNAPSHOT,
  CMD_OPTIONS_GET_PREDICTOR_DEBUG_SNAPSHOT,
  CMD_OPTIONS_REPORT_OBSERVABILITY_EVENT,
  CMD_OPTIONS_REPORT_OBSERVABILITY_MODULES,
  CMD_OPTIONS_PAGE_CONFIG_CHANGE,
  CMD_OPTIONS_RESET_PRODUCTIVITY_STATS,
  CMD_OPTIONS_CLEAR_PERSONALIZATION,
  CMD_POPUP_ACK_DONATION_MILESTONE,
  CMD_POPUP_ACK_WEEKLY_RECAP,
  CMD_POPUP_GET_PRODUCTIVITY_STATS,
} from "@core/domain/constants";
import { createLogger } from "@core/application/logging/Logger";
import type {
  Message,
  ReviewSpellingResponse,
  PredictRequestMessage,
  UpdateLangConfigMessage,
} from "@core/domain/messageTypes";
import { hasStringProperty, isObjectRecord } from "@core/domain/guards";
import { getDomain, isEnabledForDomain } from "@core/application/domain-utils";
import { checkLastError } from "@core/application/transport-utils";
import {
  ConfigError,
  PredictorError,
  TransportError,
  getErrorMessage,
  isFluentTyperError,
  logError,
} from "@core/domain/error";
import { CoreSettingsRepository } from "@core/application/repositories/CoreSettingsRepository";
import { parseSpellingRequest } from "@core/domain/grammar/review/reviewSpelling";
import type { BackgroundServiceWorker } from "../BackgroundServiceWorker";
import type { PredictionConfigOverride } from "../PredictionTypes";
import { REVIEW_SPELLING_BUDGET_MS } from "../PresageEngine";
import { ReviewEngineHost } from "../ReviewEngineHost";
import { mapRuntimeError } from "./RuntimeErrorMapper";

const logger = createLogger("MessageRouter");

const LOCAL_AI_COMMANDS = [
  CMD_LOCAL_AI_GET_STATUS,
  CMD_LOCAL_AI_ENSURE_HOST,
  CMD_LOCAL_AI_INSTALL,
  CMD_LOCAL_AI_CANCEL_INSTALL,
  CMD_LOCAL_AI_DELETE_MODEL,
  CMD_LOCAL_AI_OPEN_SETUP,
  CMD_LOCAL_AI_DISMISS_SETUP_OFFER,
] as const;

const ROUTED_MESSAGE_COMMANDS = [
  CMD_FIELD_PREFERENCES,
  CMD_CONTENT_SCRIPT_PREDICT_REQ,
  CMD_CONTENT_SCRIPT_ADD_TO_DICTIONARY,
  CMD_CONTENT_SCRIPT_DISABLE_REVIEW_RULE,
  CMD_CONTENT_SCRIPT_REVIEW_SPELLING,
  CMD_CONTENT_SCRIPT_REVIEW_ENGINE,
  CMD_OPTIONS_PAGE_CONFIG_CHANGE,
  CMD_CONTENT_SCRIPT_GET_CONFIG,
  CMD_CONTENT_SCRIPT_USAGE_EVENT,
  CMD_CONTENT_SCRIPT_PERSONALIZATION_EVENT,
  CMD_CONTENT_SCRIPT_REPORT_RUNTIME_STATUS,
  CMD_CONTENT_SCRIPT_REPORT_OBSERVABILITY_EVENT,
  CMD_CONTENT_SCRIPT_REPORT_OBSERVABILITY_MODULES,
  CMD_GET_AUTO_LANGUAGE_STATUS,
  CMD_POPUP_GET_PRODUCTIVITY_STATS,
  CMD_POPUP_ACK_WEEKLY_RECAP,
  CMD_POPUP_ACK_DONATION_MILESTONE,
  CMD_OPTIONS_RESET_PRODUCTIVITY_STATS,
  CMD_OPTIONS_CLEAR_PERSONALIZATION,
  CMD_OPTIONS_GET_PREDICTOR_DEBUG_SNAPSHOT,
  CMD_OPTIONS_GET_OBSERVABILITY_SNAPSHOT,
  CMD_OPTIONS_CLEAR_OBSERVABILITY_EVENTS,
  CMD_OPTIONS_REPORT_OBSERVABILITY_EVENT,
  CMD_OPTIONS_REPORT_OBSERVABILITY_MODULES,
  ...LOCAL_AI_COMMANDS,
] as const;

type RoutedMessageCommand = (typeof ROUTED_MESSAGE_COMMANDS)[number];
type RoutedMessage = Extract<Message, { command: RoutedMessageCommand }>;
type RoutedMessageByCommand = {
  [TCommand in RoutedMessageCommand]: Extract<RoutedMessage, { command: TCommand }>;
};

interface MessageDispatchPayload {
  request: RoutedMessage;
  sender: chrome.runtime.MessageSender;
  sendResponse: (response?: unknown) => void;
  worker: BackgroundServiceWorker;
}

type CommandPayload<TCommand extends RoutedMessageCommand = RoutedMessageCommand> = Omit<
  MessageDispatchPayload,
  "request"
> & {
  request: RoutedMessageByCommand[TCommand];
};

type CommandHandlers = {
  [TCommand in RoutedMessageCommand]: (payload: CommandPayload<TCommand>) => Promise<void> | void;
};

/** Runs `work`, passing FluentTyper errors through and wrapping anything else via `wrap`. */
async function rethrowAs<T>(work: () => Promise<T>, wrap: (cause: unknown) => Error): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isFluentTyperError(error)) {
      throw error;
    }
    throw wrap(error);
  }
}

interface SenderRoutingContext {
  tabId: number;
  frameId: number;
}

function requireSenderRoutingContext(
  sender: chrome.runtime.MessageSender,
  purpose: string,
): SenderRoutingContext {
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number") {
    throw new TransportError(`Missing sender tab id for ${purpose}`, {
      code: "message_missing_sender_tab_id",
    });
  }
  return {
    tabId,
    frameId: typeof sender.frameId === "number" ? sender.frameId : 0,
  };
}

export class MessageRouter {
  private readonly getWorker: () => BackgroundServiceWorker;
  private readonly fieldPreferences = new FieldPreferenceService();
  // Review detection answers without waiting for the prediction engine to start.
  private readonly reviewEngines = new ReviewEngineHost();
  private readonly handlers: CommandHandlers;

  constructor(getWorker: () => BackgroundServiceWorker) {
    this.getWorker = getWorker;
    // Local AI Review: authorization and effects live in the LocalAiController.
    const handleLocalAi = async ({
      request,
      sender,
      sendResponse,
      worker,
    }: CommandPayload<(typeof LOCAL_AI_COMMANDS)[number]>): Promise<void> => {
      sendResponse(await worker.localAiController.handleMessage(request, sender));
    };

    this.handlers = {
      [CMD_FIELD_PREFERENCES]: async ({ request, sender, sendResponse, worker }) => {
        sendResponse(
          await this.fieldPreferences.handle(
            request.context,
            sender,
            new FieldPreferenceRepository(worker.settingsManager),
            () => worker.updatePresageConfig(),
          ),
        );
      },
      [CMD_CONTENT_SCRIPT_PREDICT_REQ]: (payload) => this.handleContentScriptPredictReq(payload),
      [CMD_OPTIONS_PAGE_CONFIG_CHANGE]: async ({ sendResponse, worker }) => {
        await this.refreshConfig(worker);
        sendResponse({ ok: true });
      },
      [CMD_CONTENT_SCRIPT_ADD_TO_DICTIONARY]: (payload) =>
        this.handleContentScriptAddToDictionary(payload),
      [CMD_CONTENT_SCRIPT_DISABLE_REVIEW_RULE]: async ({ request, sendResponse, worker }) => {
        const ruleId = typeof request.context?.ruleId === "string" ? request.context.ruleId : "";
        const ok = await new CoreSettingsRepository(worker.settingsManager).disableReviewRule(
          ruleId,
        );
        if (ok) await this.refreshConfig(worker);
        sendResponse({ ok });
      },
      [CMD_CONTENT_SCRIPT_REVIEW_SPELLING]: (payload) =>
        this.handleContentScriptReviewSpelling(payload),
      // Review detection (scan, proof, typing-time proposals) for this sender's review sessions.
      [CMD_CONTENT_SCRIPT_REVIEW_ENGINE]: async ({ request, sender, sendResponse }) => {
        const routing = requireSenderRoutingContext(sender, "review engine request");
        sendResponse(await this.reviewEngines.handle(request.context, routing));
      },
      [CMD_CONTENT_SCRIPT_GET_CONFIG]: (payload) => this.handleContentScriptGetConfig(payload),
      [CMD_CONTENT_SCRIPT_USAGE_EVENT]: async ({ request, sendResponse, worker }) => {
        await worker.productivityStatsManager.recordUsageEvent(request.context);
        sendResponse({ ok: true });
      },
      [CMD_CONTENT_SCRIPT_PERSONALIZATION_EVENT]: async ({ request, sendResponse, worker }) => {
        await worker.personalizationService.handleEvent(request.context);
        sendResponse({ ok: true });
      },
      [CMD_CONTENT_SCRIPT_REPORT_RUNTIME_STATUS]: ({ request, sender, sendResponse, worker }) => {
        const { tabId, frameId } = requireSenderRoutingContext(sender, "runtime status request");
        const scope = {
          tabId,
          frameId,
          runtimeGeneration: request.context.runtimeGeneration,
          domainURL: request.context.domainURL,
        };
        worker.reportAutoLanguageRuntime(scope);
        worker.observabilityService.recordContentRuntimeStatus(scope);
        sendResponse({ ok: true });
      },
      [CMD_CONTENT_SCRIPT_REPORT_OBSERVABILITY_EVENT]: ({
        request,
        sender,
        sendResponse,
        worker,
      }) => {
        const senderContext = requireSenderRoutingContext(sender, "observability event");
        worker.observabilityService.recordEvent({
          ...request.context.event,
          source: "content_script",
          tabId: request.context.event.tabId ?? senderContext.tabId,
          frameId: request.context.event.frameId ?? senderContext.frameId,
        });
        sendResponse({ ok: true });
      },
      [CMD_CONTENT_SCRIPT_REPORT_OBSERVABILITY_MODULES]: ({ request, sendResponse, worker }) => {
        worker.observabilityService.registerRemoteModules(
          "content_script",
          request.context.modules,
        );
        sendResponse({ ok: true });
      },
      [CMD_GET_AUTO_LANGUAGE_STATUS]: (payload) => this.handleGetAutoLanguageStatus(payload),
      [CMD_POPUP_GET_PRODUCTIVITY_STATS]: async ({ sendResponse, worker }) => {
        sendResponse(await worker.productivityStatsManager.getDashboardStats());
      },
      [CMD_POPUP_ACK_WEEKLY_RECAP]: async ({ request, sendResponse, worker }) => {
        await worker.productivityStatsManager.acknowledgeWeeklyRecap(request.context.weekKey);
        sendResponse({ ok: true });
      },
      [CMD_POPUP_ACK_DONATION_MILESTONE]: async ({ request, sendResponse, worker }) => {
        await worker.productivityStatsManager.handleDonationPromptAction(
          request.context.promptId,
          request.context.action,
          request.context.milestoneHours,
        );
        sendResponse({ ok: true });
      },
      [CMD_OPTIONS_RESET_PRODUCTIVITY_STATS]: async ({ sendResponse, worker }) => {
        await worker.productivityStatsManager.resetStats();
        sendResponse({ ok: true });
      },
      [CMD_OPTIONS_CLEAR_PERSONALIZATION]: async ({ sendResponse, worker }) => {
        await worker.personalizationService.clear();
        sendResponse({ ok: true });
      },
      [CMD_OPTIONS_GET_PREDICTOR_DEBUG_SNAPSHOT]: async ({ sendResponse, worker }) => {
        await worker.predictionManager.initialize();
        sendResponse(worker.predictionManager.getPredictorDebugSnapshot());
      },
      [CMD_OPTIONS_GET_OBSERVABILITY_SNAPSHOT]: async ({ sendResponse, worker }) => {
        await worker.predictionManager.initialize();
        sendResponse(worker.observabilityService.getSnapshot());
      },
      [CMD_OPTIONS_CLEAR_OBSERVABILITY_EVENTS]: ({ sendResponse, worker }) => {
        worker.observabilityService.clearEvents();
        sendResponse({ ok: true });
      },
      [CMD_OPTIONS_REPORT_OBSERVABILITY_EVENT]: ({ request, sendResponse, worker }) => {
        worker.observabilityService.recordEvent({
          ...request.context.event,
          source: "options",
        });
        sendResponse({ ok: true });
      },
      [CMD_OPTIONS_REPORT_OBSERVABILITY_MODULES]: ({ request, sendResponse, worker }) => {
        worker.observabilityService.registerRemoteModules("options", request.context.modules);
        sendResponse({ ok: true });
      },
      [CMD_LOCAL_AI_GET_STATUS]: handleLocalAi,
      [CMD_LOCAL_AI_ENSURE_HOST]: handleLocalAi,
      [CMD_LOCAL_AI_INSTALL]: handleLocalAi,
      [CMD_LOCAL_AI_CANCEL_INSTALL]: handleLocalAi,
      [CMD_LOCAL_AI_DELETE_MODEL]: handleLocalAi,
      [CMD_LOCAL_AI_OPEN_SETUP]: handleLocalAi,
      [CMD_LOCAL_AI_DISMISS_SETUP_OFFER]: handleLocalAi,
    };
  }

  handle(
    request: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): boolean {
    checkLastError();
    if (!isObjectRecord(request)) {
      logger.warn("Ignored non-runtime message payload");
      return false;
    }
    if (!hasStringProperty(request, "command")) {
      logger.warn("Ignored message without command");
      return false;
    }

    const { command } = request;
    if (!Object.hasOwn(this.handlers, command)) {
      logError("onMessage", `Unknown command: ${command}`);
      return false;
    }

    void this.dispatch(command as RoutedMessageCommand, {
      request: request as RoutedMessage,
      sender,
      sendResponse,
      worker: this.getWorker(),
    });

    return command !== CMD_CONTENT_SCRIPT_PREDICT_REQ;
  }

  private async dispatch(
    command: RoutedMessageCommand,
    payload: MessageDispatchPayload,
  ): Promise<void> {
    try {
      const handler = this.handlers[command] as (
        payload: MessageDispatchPayload,
      ) => Promise<void> | void;
      await handler(payload);
    } catch (error) {
      logger.error("Command handler failed", {
        command,
        error: getErrorMessage(error),
      });
      const mappedError = mapRuntimeError(error);
      logError(`MessageRouter.${command}.${mappedError.category}.${mappedError.code}`, error);
      payload.sendResponse(mappedError.response);
    }
  }

  private async handleContentScriptPredictReq(
    payload: CommandPayload<typeof CMD_CONTENT_SCRIPT_PREDICT_REQ>,
  ): Promise<void> {
    const { request, sender, sendResponse, worker } = payload;
    const { tabId, frameId } = requireSenderRoutingContext(sender, "prediction request");
    const domainURL = getDomain(sender.tab?.url || "");

    const domainSettings = await rethrowAs(
      () => worker.domainSettingsCache.resolve(worker.settingsManager, domainURL),
      (cause) =>
        new ConfigError("Failed to resolve domain runtime settings", {
          code: "message_resolve_domain_runtime_settings_failed",
          cause,
        }),
    );

    let language = domainSettings.language;

    if (language === "auto_detect") {
      const resolution = await rethrowAs(
        () =>
          worker.languageDetector.resolveLanguage({
            ...request.context,
            tabId,
            frameId,
            domainURL,
            enabledLanguages: domainSettings.enabledLanguages,
          }),
        (cause) =>
          new PredictorError("Failed to auto-detect language", {
            code: "message_detect_language_failed",
            cause,
          }),
      );
      language = resolution.language;
    }

    if (request.context.lang !== language) {
      const updateLangConfigMessage: UpdateLangConfigMessage = {
        command: CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG,
        context: {
          lang: language,
        },
      };
      worker.sendCommandToTabContentScript(tabId, frameId, updateLangConfigMessage);
    }

    const predictRequestMessage: PredictRequestMessage = {
      command: CMD_BACKGROUND_PAGE_PREDICT_REQ,
      context: {
        text: request.context.text,
        nextChar: request.context.nextChar,
        afterCursorTokenSuffix: request.context.afterCursorTokenSuffix,
        inputAction: request.context.inputAction,
        lang: language,
        tabId,
        frameId,
        suggestionId: request.context.suggestionId,
        requestId: request.context.requestId,
        runtimeGeneration: request.context.runtimeGeneration,
        traceId: request.context.traceId,
        traceStartedAtMs: request.context.traceStartedAtMs,
      },
    };

    let configOverride: PredictionConfigOverride | undefined;
    if (domainSettings.hasNumSuggestionsOverride) {
      configOverride = { numSuggestions: domainSettings.numSuggestions };
    }
    if (request.context.suppressAutoCapitalize === true) {
      configOverride = { ...configOverride, suppressAutoCapitalize: true };
    }

    await rethrowAs(
      () => worker.runPrediction(predictRequestMessage, configOverride),
      (cause) =>
        new PredictorError("Failed to run prediction", {
          code: "message_run_prediction_failed",
          cause,
        }),
    );

    sendResponse({ ok: true });
  }

  /**
   * "Add to dictionary" from a review card: an explicit user action. Uses the
   * same stored list and the same config broadcast as the options page.
   */
  private async handleContentScriptAddToDictionary(
    payload: CommandPayload<typeof CMD_CONTENT_SCRIPT_ADD_TO_DICTIONARY>,
  ): Promise<void> {
    const { request, sendResponse, worker } = payload;
    const word = typeof request.context?.word === "string" ? request.context.word : "";
    const added = await rethrowAs(
      () => new CoreSettingsRepository(worker.settingsManager).addUserDictionaryWord(word),
      (cause) =>
        new ConfigError("Failed to add a user dictionary word", {
          code: "message_add_dictionary_word_failed",
          cause,
        }),
    );
    if (added) {
      await this.refreshConfig(worker);
    }
    sendResponse({ ok: added });
  }

  private async refreshConfig(worker: BackgroundServiceWorker): Promise<void> {
    await rethrowAs(
      () => worker.updatePresageConfig(),
      (cause) =>
        new ConfigError("Failed to update prediction runtime config", {
          code: "message_update_runtime_config_failed",
          cause,
        }),
    );
    // Settings changed — flush cached domain settings so the next prediction
    // request picks up the new values without waiting for the TTL to expire.
    worker.domainSettingsCache.invalidate();
  }

  /**
   * Review spelling: which words the language's dictionary knows, and Presage's
   * candidates for the rest. Read-only and ephemeral, unlike a typing
   * prediction: nothing is learned, stored, traced, counted or logged. Each
   * request is time-bounded, so typing predictions never wait long behind it:
   * the answer may cover only the first words, and the page asks again.
   */
  private async handleContentScriptReviewSpelling(
    payload: CommandPayload<typeof CMD_CONTENT_SCRIPT_REVIEW_SPELLING>,
  ): Promise<void> {
    const { request, sendResponse, worker } = payload;
    const parsed = parseSpellingRequest(request.context);
    let response: ReviewSpellingResponse;
    try {
      const results = parsed
        ? await worker.predictionManager.lookupSpelling(parsed.lang, parsed.words, {
            budgetMs: REVIEW_SPELLING_BUDGET_MS,
          })
        : null;
      response = results ? { ok: true, results } : { ok: false };
    } catch {
      response = { ok: false, error: "resource-failed" };
    }
    sendResponse(response);
  }

  private async handleContentScriptGetConfig(
    payload: CommandPayload<typeof CMD_CONTENT_SCRIPT_GET_CONFIG>,
  ): Promise<void> {
    const { sender, sendResponse, worker } = payload;
    const domain = getDomain(sender.tab?.url || "") || "";

    const [isEnabled, message] = await rethrowAs(
      () =>
        Promise.all([
          isEnabledForDomain(worker.settingsManager, domain),
          worker.getBackgroundPageSetConfigMsg(domain),
        ]),
      (cause) =>
        new ConfigError("Failed to resolve content script config", {
          code: "message_get_content_script_config_failed",
          cause,
        }),
    );

    message.context.enabled = isEnabled;
    sendResponse(message);
  }

  private async handleGetAutoLanguageStatus(
    payload: CommandPayload<typeof CMD_GET_AUTO_LANGUAGE_STATUS>,
  ): Promise<void> {
    const { request, sendResponse, worker } = payload;
    const fallbackTab =
      typeof request.context.tabId === "number"
        ? await worker.tabMessenger.getActiveTabContext()
        : await worker.tabMessenger.getLastActiveWebsiteTabContext();
    const tabId =
      typeof request.context.tabId === "number" && Number.isFinite(request.context.tabId)
        ? request.context.tabId
        : fallbackTab?.tabId;
    if (typeof tabId !== "number") {
      sendResponse({ status: null });
      return;
    }
    const domainURL = request.context.domainURL || fallbackTab?.hostname || undefined;
    sendResponse({
      status: await worker.languageDetector.getRecentSessionStatusForScope({
        tabId,
        frameId: request.context.frameId,
        runtimeGeneration: request.context.runtimeGeneration,
        domainURL,
      }),
    });
  }
}
