// Handles messaging to tabs/content scripts for FluentTyper
import { SettingsManager } from "../shared/settingsManager";
import { getDomain, isEnabledForDomain, checkLastError } from "../shared/utils";
import { Message, ConfigMessage } from "../shared/messageTypes";

export class TabMessenger {
  sendToActiveTab(message: Message): void {
    chrome.tabs.query(
      { active: true, currentWindow: true },
      async function (tabs) {
        checkLastError();
        if (tabs.length === 1) {
          const currentTab = tabs[0];
          if (typeof currentTab.id === "number") {
            await chrome.tabs.sendMessage(currentTab.id, message);
          }
        }
      },
    );
  }

  async sendToAllTabs(
    message: ConfigMessage,
    settings: SettingsManager,
  ): Promise<void> {
    chrome.tabs.query({}, async function (tabs) {
      checkLastError();
      for (const tab of tabs) {
        if (!tab.url || typeof tab.id !== "number") continue;
        const domain = await getDomain(tab.url);
        const enabled = await isEnabledForDomain(settings, domain as string);
        message.context.enabled = enabled;
        try {
          await chrome.tabs.sendMessage(tab.id, message);
        } catch (error) {
          console.log(error);
        }
      }
    });
  }
}
