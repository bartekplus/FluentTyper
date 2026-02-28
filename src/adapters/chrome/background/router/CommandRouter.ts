import {
  CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG,
  CMD_TOGGLE_FT_ACTIVE_LANG,
  CMD_TOGGLE_FT_ACTIVE_TAB,
  CMD_TRIGGER_FT_ACTIVE_TAB,
} from "@core/domain/constants";
import { createLogger } from "@core/application/logging/Logger";
import { logError } from "@core/domain/error";
import type {
  ToggleActiveTabMessage,
  TriggerActiveTabMessage,
  UpdateLangConfigMessage,
} from "@core/domain/messageTypes";
import { BackgroundServiceWorker } from "../BackgroundServiceWorker";
import { rotateLanguageForDomain } from "../config/runtimeSettings";
import {
  createErrorMappingMiddleware,
  createLoggingMiddleware,
  createValidationMiddleware,
  HandlerRegistry,
} from "./HandlerRegistry";

const logger = createLogger("CommandRouter");

const SUPPORTED_RUNTIME_COMMANDS = [
  CMD_TOGGLE_FT_ACTIVE_TAB,
  CMD_TRIGGER_FT_ACTIVE_TAB,
  CMD_TOGGLE_FT_ACTIVE_LANG,
] as const;

type RuntimeCommand = (typeof SUPPORTED_RUNTIME_COMMANDS)[number];
type RuntimeCommandHandler = () => Promise<void>;

const RUNTIME_COMMAND_SET = new Set<string>(SUPPORTED_RUNTIME_COMMANDS);

function isRuntimeCommand(command: string): command is RuntimeCommand {
  return RUNTIME_COMMAND_SET.has(command);
}

export class CommandRouter {
  private readonly registry: HandlerRegistry<RuntimeCommand, void, void>;

  constructor(getWorker: () => BackgroundServiceWorker) {
    const handlers: Record<RuntimeCommand, RuntimeCommandHandler> = {
      [CMD_TOGGLE_FT_ACTIVE_TAB]: async () => {
        const message: ToggleActiveTabMessage = {
          command: CMD_TOGGLE_FT_ACTIVE_TAB,
        };
        getWorker().sendCommandToActiveTabContentScript(message);
      },
      [CMD_TRIGGER_FT_ACTIVE_TAB]: async () => {
        const message: TriggerActiveTabMessage = {
          command: CMD_TRIGGER_FT_ACTIVE_TAB,
        };
        getWorker().sendCommandToActiveTabContentScript(message);
      },
      [CMD_TOGGLE_FT_ACTIVE_LANG]: async () => {
        const worker = getWorker();
        const result = await worker.tabMessenger.getActiveTabHostname();
        const domainURL = result?.hostname || undefined;
        const nextLang = await rotateLanguageForDomain(
          worker.settingsManager,
          domainURL,
        );
        worker.language = nextLang;

        const updateLangConfigMessage: UpdateLangConfigMessage = {
          command: CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG,
          context: {
            lang: nextLang,
          },
        };
        worker.sendCommandToActiveTabContentScript(updateLangConfigMessage);
      },
    };

    this.registry = new HandlerRegistry<RuntimeCommand, void, void>([
      createErrorMappingMiddleware<void, void>({
        mapUnknownCommand: (command) => {
          logError("onCommand", `Unknown command: ${command}`);
        },
        mapError: (error) => {
          logError("CommandRouter.handle", error);
        },
      }),
      createLoggingMiddleware(logger),
      createValidationMiddleware<void, void, RuntimeCommand>(isRuntimeCommand),
    ]);

    this.registry
      .register(CMD_TOGGLE_FT_ACTIVE_TAB, handlers[CMD_TOGGLE_FT_ACTIVE_TAB])
      .register(CMD_TRIGGER_FT_ACTIVE_TAB, handlers[CMD_TRIGGER_FT_ACTIVE_TAB])
      .register(CMD_TOGGLE_FT_ACTIVE_LANG, handlers[CMD_TOGGLE_FT_ACTIVE_LANG]);
  }

  async handle(command: string): Promise<void> {
    if (!this.registry.has(command)) {
      logError("onCommand", `Unknown command: ${command}`);
      return;
    }
    await this.registry.dispatch(command, undefined);
  }
}
