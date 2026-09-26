import {
  CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG,
  CMD_REVIEW_FT_ACTIVE_TAB,
  CMD_TOGGLE_FT_ACTIVE_LANG,
  CMD_TOGGLE_FT_ACTIVE_TAB,
  CMD_TRIGGER_FT_ACTIVE_TAB,
} from "@core/domain/constants";
import { createLogger } from "@core/application/logging/Logger";
import { logError } from "@core/domain/error";
import type {
  ReviewActiveTabMessage,
  ToggleActiveTabMessage,
  TriggerActiveTabMessage,
  UpdateLangConfigMessage,
} from "@core/domain/messageTypes";
import type { BackgroundServiceWorker } from "../BackgroundServiceWorker";
import { HandlerRegistry } from "./HandlerRegistry";

const logger = createLogger("CommandRouter");

type RuntimeCommand =
  | typeof CMD_TOGGLE_FT_ACTIVE_TAB
  | typeof CMD_TRIGGER_FT_ACTIVE_TAB
  | typeof CMD_TOGGLE_FT_ACTIVE_LANG
  | typeof CMD_REVIEW_FT_ACTIVE_TAB;

export class CommandRouter {
  private readonly registry = new HandlerRegistry<RuntimeCommand, void>(logger, (error) => {
    logError("CommandRouter.handle", error);
  });

  constructor(getWorker: () => BackgroundServiceWorker) {
    const handlers: Record<RuntimeCommand, () => Promise<void> | void> = {
      [CMD_TOGGLE_FT_ACTIVE_TAB]: () => {
        const message: ToggleActiveTabMessage = {
          command: CMD_TOGGLE_FT_ACTIVE_TAB,
        };
        getWorker().tabMessenger.sendToActiveTab(message);
      },
      [CMD_TRIGGER_FT_ACTIVE_TAB]: () => {
        const message: TriggerActiveTabMessage = {
          command: CMD_TRIGGER_FT_ACTIVE_TAB,
        };
        getWorker().tabMessenger.sendToActiveTab(message);
      },
      [CMD_REVIEW_FT_ACTIVE_TAB]: () => {
        const message: ReviewActiveTabMessage = {
          command: CMD_REVIEW_FT_ACTIVE_TAB,
          context: { source: "command" },
        };
        // The focused editor may be in any frame; each frame checks its own focus.
        getWorker().tabMessenger.sendToActiveTabAllFrames(message);
      },
      [CMD_TOGGLE_FT_ACTIVE_LANG]: async () => {
        const worker = getWorker();
        const activeTab = await worker.tabMessenger.getActiveTabContext();
        const nextLanguage = await worker.handleActiveLanguageToggle({
          tabId: activeTab?.tabId ?? -1,
          domainURL: activeTab?.hostname || undefined,
        });
        worker.language = nextLanguage.language;

        const updateLangConfigMessage: UpdateLangConfigMessage = {
          command: CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG,
          context: {
            lang: nextLanguage.language,
          },
        };
        if (typeof nextLanguage.tabId === "number" && typeof nextLanguage.frameId === "number") {
          worker.sendCommandToTabContentScript(
            nextLanguage.tabId,
            nextLanguage.frameId,
            updateLangConfigMessage,
          );
        } else {
          worker.tabMessenger.sendToActiveTab(updateLangConfigMessage);
        }
      },
    };

    for (const [command, handler] of Object.entries(handlers)) {
      this.registry.register(command as RuntimeCommand, handler);
    }
  }

  async handle(command: string): Promise<void> {
    if (!this.registry.has(command)) {
      logError("onCommand", `Unknown command: ${command}`);
      return;
    }
    await this.registry.dispatch(command, undefined);
  }
}
