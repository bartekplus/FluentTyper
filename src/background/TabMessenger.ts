// Handles messaging to tabs/content scripts for FluentTyper
import { SettingsManager } from "../shared/settingsManager";
import { isEnabledForDomain, checkLastError } from "../shared/utils";
import { Message, ConfigMessage } from "../shared/messageTypes";
import { getErrorMessage } from "../shared/error";
import { CMD_GET_HOSTNAME } from "../shared/constants";

export class TabMessenger {
  private lastActiveTabId: number | undefined;

  constructor() {
    chrome.tabs.onActivated.addListener((activeInfo) => {
      this.lastActiveTabId = activeInfo.tabId;
    });
  }

  private async getActiveTabId(): Promise<number | undefined> {
    checkLastError();
    try {
      let tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabs || tabs.length === 0) {
        tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      }
      if (tabs && tabs.length >= 1 && typeof tabs[0].id === "number") {
        return tabs[0].id;
      }
    } catch (e) {
      console.warn("Failed to query active tab:", e);
    }
    return this.lastActiveTabId;
  }

  sendToActiveTab(message: Message): void {
    this.getActiveTabId().then((tabId) => {
      if (tabId !== undefined) {
        chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
      }
    });
  }

  async getActiveTabHostname(): Promise<{ tabId: number; hostname: string } | undefined> {
    const tabId = await this.getActiveTabId();
    if (tabId === undefined) return undefined;
    try {
      const response = await new Promise<{ hostname?: string } | undefined>((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, { command: CMD_GET_HOSTNAME }, { frameId: 0 }, (res) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(res);
          }
        });
      });
      return { tabId, hostname: response?.hostname || "" };
    } catch {
      return { tabId, hostname: "" };
    }
  }

  async sendToAllTabs(
    message: ConfigMessage,
    settings: SettingsManager,
    resolveDomainContextOverride?: (
      domain: string,
    ) => Promise<Partial<ConfigMessage["context"]>>,
  ): Promise<void> {
    chrome.tabs.query({}, async (tabs) => {
      checkLastError();
      for (const tab of tabs) {
        if (typeof tab.id !== "number") continue;
        const tabId = tab.id;
        let domain = "";
        try {
          const response = await new Promise<{ hostname?: string } | undefined>((resolve, reject) => {
            chrome.tabs.sendMessage(tabId, { command: CMD_GET_HOSTNAME }, { frameId: 0 }, (res: { hostname?: string } | undefined) => {
              if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
              } else {
                resolve(res);
              }
            });
          });
          domain = response?.hostname || "";
        } catch {
          // Tab has no content script (e.g. chrome:// pages)
          continue;
        }
        const enabled = await isEnabledForDomain(settings, domain);
        const domainOverride = resolveDomainContextOverride
          ? await resolveDomainContextOverride(domain)
          : {};
        const messageForTab: ConfigMessage = {
          command: message.command,
          context: {
            ...message.context,
            ...domainOverride,
            enabled,
          },
        };
        try {
          chrome.tabs.sendMessage(tab.id, messageForTab, { frameId: 0 });
        } catch (error) {
          console.warn(`sendToAllTabs failed: ${getErrorMessage(error)}`);
        }
      }
    });
  }
}
