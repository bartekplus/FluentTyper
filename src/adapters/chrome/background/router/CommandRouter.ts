import {
  CMD_TOGGLE_FT_ACTIVE_LANG,
  CMD_TOGGLE_FT_ACTIVE_TAB,
  CMD_TRIGGER_FT_ACTIVE_TAB,
} from "@core/domain/constants";
import { createLogger } from "@core/application/logging/Logger";
import { logError } from "@core/domain/error";
import { BackgroundServiceWorker } from "../BackgroundServiceWorker";
import {
  createErrorMappingMiddleware,
  createLoggingMiddleware,
  createValidationMiddleware,
  HandlerRegistry,
} from "./HandlerRegistry";
import {
  RuntimeCommandHandler,
  ToggleActiveLangCommandHandler,
  ToggleActiveTabCommandHandler,
  TriggerActiveTabCommandHandler,
} from "./commands/RuntimeCommandHandlers";

const logger = createLogger("CommandRouter");

const SUPPORTED_RUNTIME_COMMANDS = [
  CMD_TOGGLE_FT_ACTIVE_TAB,
  CMD_TRIGGER_FT_ACTIVE_TAB,
  CMD_TOGGLE_FT_ACTIVE_LANG,
] as const;

type RuntimeCommand = (typeof SUPPORTED_RUNTIME_COMMANDS)[number];

const RUNTIME_COMMAND_SET = new Set<string>(SUPPORTED_RUNTIME_COMMANDS);

function isRuntimeCommand(command: string): command is RuntimeCommand {
  return RUNTIME_COMMAND_SET.has(command);
}

export class CommandRouter {
  private readonly registry: HandlerRegistry<RuntimeCommand, void, void>;

  constructor(getWorker: () => BackgroundServiceWorker) {
    const handlers: Record<RuntimeCommand, RuntimeCommandHandler> = {
      [CMD_TOGGLE_FT_ACTIVE_TAB]: new ToggleActiveTabCommandHandler(
        getWorker,
      ),
      [CMD_TRIGGER_FT_ACTIVE_TAB]: new TriggerActiveTabCommandHandler(
        getWorker,
      ),
      [CMD_TOGGLE_FT_ACTIVE_LANG]: new ToggleActiveLangCommandHandler(
        getWorker,
      ),
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
      .register(CMD_TOGGLE_FT_ACTIVE_TAB, () =>
        handlers[CMD_TOGGLE_FT_ACTIVE_TAB].handle(),
      )
      .register(CMD_TRIGGER_FT_ACTIVE_TAB, () =>
        handlers[CMD_TRIGGER_FT_ACTIVE_TAB].handle(),
      )
      .register(CMD_TOGGLE_FT_ACTIVE_LANG, () =>
        handlers[CMD_TOGGLE_FT_ACTIVE_LANG].handle(),
      );
  }

  async handle(command: string): Promise<void> {
    if (!this.registry.has(command)) {
      logError("onCommand", `Unknown command: ${command}`);
      return;
    }
    await this.registry.dispatch(command, undefined);
  }
}
