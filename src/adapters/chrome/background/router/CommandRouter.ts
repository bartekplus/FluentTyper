import {
  CMD_TOGGLE_FT_ACTIVE_LANG,
  CMD_TOGGLE_FT_ACTIVE_TAB,
  CMD_TRIGGER_FT_ACTIVE_TAB,
} from "@core/domain/constants";
import { logError } from "@core/domain/error";
import { BackgroundServiceWorker } from "../BackgroundServiceWorker";
import {
  RuntimeCommandHandler,
  ToggleActiveLangCommandHandler,
  ToggleActiveTabCommandHandler,
  TriggerActiveTabCommandHandler,
} from "./commands/RuntimeCommandHandlers";

export class CommandRouter {
  private readonly getWorker: () => BackgroundServiceWorker;
  private readonly handlers: Partial<Record<string, RuntimeCommandHandler>>;

  constructor(getWorker: () => BackgroundServiceWorker) {
    this.getWorker = getWorker;
    this.handlers = {
      [CMD_TOGGLE_FT_ACTIVE_TAB]: new ToggleActiveTabCommandHandler(
        this.getWorker,
      ),
      [CMD_TRIGGER_FT_ACTIVE_TAB]: new TriggerActiveTabCommandHandler(
        this.getWorker,
      ),
      [CMD_TOGGLE_FT_ACTIVE_LANG]: new ToggleActiveLangCommandHandler(
        this.getWorker,
      ),
    };
  }

  async handle(command: string): Promise<void> {
    const handler = this.handlers[command];
    if (!handler) {
      logError("onCommand", `Unknown command: ${command}`);
      return;
    }
    try {
      await handler.handle();
    } catch (error) {
      logError("CommandRouter.handle", error);
    }
  }
}
