import {
  CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG,
  CMD_REVIEW_FT_ACTIVE_TAB,
  CMD_TOGGLE_FT_ACTIVE_LANG,
  CMD_TOGGLE_FT_ACTIVE_TAB,
  CMD_TRIGGER_FT_ACTIVE_TAB,
} from "@core/domain/constants";
import { createLogger } from "@core/application/logging/Logger";
import { getErrorMessage, logError } from "@core/domain/error";
import type { ReviewActiveTabMessage, UpdateLangConfigMessage } from "@core/domain/messageTypes";
import type { BackgroundServiceWorker } from "../BackgroundServiceWorker";

const logger = createLogger("CommandRouter");

type RuntimeCommand =
  | typeof CMD_TOGGLE_FT_ACTIVE_TAB
  | typeof CMD_TRIGGER_FT_ACTIVE_TAB
  | typeof CMD_TOGGLE_FT_ACTIVE_LANG
  | typeof CMD_REVIEW_FT_ACTIVE_TAB;

export class CommandRouter {
  private readonly handlers: Record<RuntimeCommand, () => Promise<void> | void>;

  constructor(getWorker: () => BackgroundServiceWorker) {
    this.handlers = {
      [CMD_TOGGLE_FT_ACTIVE_TAB]: () => {
        getWorker().tabMessenger.sendToActiveTab({ command: CMD_TOGGLE_FT_ACTIVE_TAB });
      },
      [CMD_TRIGGER_FT_ACTIVE_TAB]: () => {
        getWorker().tabMessenger.sendToActiveTab({ command: CMD_TRIGGER_FT_ACTIVE_TAB });
      },
      [CMD_REVIEW_FT_ACTIVE_TAB]: () => {
        const message: ReviewActiveTabMessage = {
          command: CMD_REVIEW_FT_ACTIVE_TAB,
          context: { source: "command" },
        };
        // The focused editor may be in any frame; each frame checks its own focus.
        getWorker().tabMessenger.sendToActiveTab(message, {});
      },
      [CMD_TOGGLE_FT_ACTIVE_LANG]: async () => {
        const worker = getWorker();
        const activeTab = await worker.tabMessenger.getActiveTabContext();
        const nextLanguage = await worker.handleActiveLanguageToggle({
          tabId: activeTab?.tabId ?? -1,
          domainURL: activeTab?.hostname || undefined,
        });
        const updateLangConfigMessage: UpdateLangConfigMessage = {
          command: CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG,
          context: {
            lang: nextLanguage.language,
          },
        };
        worker.tabMessenger.sendToTab(
          nextLanguage.tabId,
          nextLanguage.frameId,
          updateLangConfigMessage,
        );
      },
    };
  }

  async handle(command: string): Promise<void> {
    if (!Object.hasOwn(this.handlers, command)) {
      logError("onCommand", `Unknown command: ${command}`);
      return;
    }
    try {
      await this.handlers[command as RuntimeCommand]();
    } catch (error) {
      logger.error("Command handler failed", {
        command,
        error: getErrorMessage(error),
      });
      logError("CommandRouter.handle", error);
    }
  }
}
