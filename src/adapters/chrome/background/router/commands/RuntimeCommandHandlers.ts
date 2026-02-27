import {
  CMD_BACKGROUND_PAGE_UPDATE_LANG_CONFIG,
  CMD_TOGGLE_FT_ACTIVE_TAB,
  CMD_TRIGGER_FT_ACTIVE_TAB,
} from "@core/domain/constants";
import type {
  ToggleActiveTabMessage,
  TriggerActiveTabMessage,
  UpdateLangConfigMessage,
} from "@core/domain/messageTypes";
import { rotateLanguageForDomain } from "../../config/runtimeSettings";
import { BackgroundServiceWorker } from "../../BackgroundServiceWorker";

export interface RuntimeCommandHandler {
  handle(): Promise<void>;
}

export class ToggleActiveTabCommandHandler implements RuntimeCommandHandler {
  private readonly getWorker: () => BackgroundServiceWorker;

  constructor(getWorker: () => BackgroundServiceWorker) {
    this.getWorker = getWorker;
  }

  async handle(): Promise<void> {
    const message: ToggleActiveTabMessage = {
      command: CMD_TOGGLE_FT_ACTIVE_TAB,
    };
    this.getWorker().sendCommandToActiveTabContentScript(message);
  }
}

export class TriggerActiveTabCommandHandler implements RuntimeCommandHandler {
  private readonly getWorker: () => BackgroundServiceWorker;

  constructor(getWorker: () => BackgroundServiceWorker) {
    this.getWorker = getWorker;
  }

  async handle(): Promise<void> {
    const message: TriggerActiveTabMessage = {
      command: CMD_TRIGGER_FT_ACTIVE_TAB,
    };
    this.getWorker().sendCommandToActiveTabContentScript(message);
  }
}

export class ToggleActiveLangCommandHandler implements RuntimeCommandHandler {
  private readonly getWorker: () => BackgroundServiceWorker;

  constructor(getWorker: () => BackgroundServiceWorker) {
    this.getWorker = getWorker;
  }

  async handle(): Promise<void> {
    const worker = this.getWorker();
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
  }
}
