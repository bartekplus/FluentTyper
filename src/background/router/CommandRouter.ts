import {
  CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG,
  CMD_TOGGLE_FT_ACTIVE_LANG,
  CMD_TOGGLE_FT_ACTIVE_TAB,
  CMD_TRIGGER_FT_ACTIVE_TAB,
} from "../../shared/constants";
import { logError } from "../../shared/error";
import type {
  ToggleActiveTabMessage,
  TriggerActiveTabMessage,
  UpdateLangConfigMessage,
} from "../../shared/messageTypes";
import { rotateLanguageForDomain } from "../config/runtimeSettings";
import { BackgroundServiceWorker } from "../BackgroundServiceWorker";

export class CommandRouter {
  private readonly getWorker: () => BackgroundServiceWorker;

  constructor(getWorker: () => BackgroundServiceWorker) {
    this.getWorker = getWorker;
  }

  async handle(command: string): Promise<void> {
    const worker = this.getWorker();

    switch (command) {
      case CMD_TOGGLE_FT_ACTIVE_TAB: {
        const message: ToggleActiveTabMessage = {
          command: CMD_TOGGLE_FT_ACTIVE_TAB,
        };
        worker.sendCommandToActiveTabContentScript(message);
        break;
      }
      case CMD_TRIGGER_FT_ACTIVE_TAB: {
        const message: TriggerActiveTabMessage = {
          command: CMD_TRIGGER_FT_ACTIVE_TAB,
        };
        worker.sendCommandToActiveTabContentScript(message);
        break;
      }
      case CMD_TOGGLE_FT_ACTIVE_LANG: {
        await this.handleToggleActiveLang(worker);
        break;
      }
      default:
        logError("onCommand", `Unknown command: ${command}`);
        break;
    }
  }

  private async handleToggleActiveLang(
    worker: BackgroundServiceWorker,
  ): Promise<void> {
    try {
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
    } catch (error) {
      logError("CommandRouter.handleToggleActiveLang", error);
    }
  }
}
