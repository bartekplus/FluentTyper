// Handles messaging to tabs/content scripts for FluentTyper
import type { SettingsManager } from "@core/application/settingsManager";
import { isEnabledForDomain } from "@core/application/domain-utils";
import { checkLastError, promisifiedSendMessage } from "@core/application/transport-utils";
import type { Message, ConfigMessage } from "@core/domain/messageTypes";
import { getErrorMessage } from "@core/domain/error";
import { CMD_GET_HOSTNAME } from "@core/domain/constants";

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
      let tabs: chrome.tabs.Tab[] | undefined;
      try {
        tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      } catch {
        // Expected in Firefox during background shortcuts if no current window
      }
      const firstTabUrl = tabs?.[0]?.url ?? "";
      const isExtensionPage =
        firstTabUrl.startsWith("chrome-extension://") || firstTabUrl.startsWith("moz-extension://");
      // If no tabs found, or if the current window is an internal extension page, fallback to lastFocusedWindow
      if (!tabs || tabs.length === 0 || isExtensionPage) {
        const fallbackTabs = await chrome.tabs.query({
          active: true,
          lastFocusedWindow: true,
        });
        if (fallbackTabs && fallbackTabs.length > 0) {
          tabs = fallbackTabs;
        }
      }
      if (tabs && tabs.length >= 1 && typeof tabs[0].id === "number") {
        return tabs[0].id;
      }
    } catch (e) {
      console.warn("Failed to query active tab:", e);
    }
    return this.lastActiveTabId;
  }

  private extractHostname(url: string | undefined): string {
    if (typeof url !== "string" || url.length === 0) {
      return "";
    }
    try {
      return new URL(url).hostname || "";
    } catch {
      return "";
    }
  }

  private isWebsiteUrl(url: string | undefined): boolean {
    return typeof url === "string" && /^(https?):\/\//i.test(url);
  }

  private toWebsiteTabContext(
    tab: chrome.tabs.Tab | undefined,
  ): { tabId: number; hostname: string } | undefined {
    if (!tab || typeof tab.id !== "number" || !this.isWebsiteUrl(tab.url)) {
      return undefined;
    }
    const hostname = this.extractHostname(tab.url);
    if (!hostname) {
      return undefined;
    }
    return {
      tabId: tab.id,
      hostname,
    };
  }

  sendToActiveTab(message: Message): void {
    this.getActiveTabId().then((tabId) => {
      if (tabId !== undefined) {
        chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
      }
    });
  }

  sendToTab(tabId: number, frameId: number, message: Message): void {
    chrome.tabs.sendMessage(tabId, message, { frameId });
  }

  async getActiveTabContext(): Promise<{ tabId: number; hostname: string } | undefined> {
    const tabId = await this.getActiveTabId();
    if (tabId === undefined) {
      return undefined;
    }
    try {
      const tab = await chrome.tabs.query({ active: true, currentWindow: true });
      const activeTab = tab.find((entry) => entry.id === tabId) || tab[0];
      return { tabId, hostname: this.extractHostname(activeTab?.url) };
    } catch {
      return { tabId, hostname: "" };
    }
  }

  async getLastActiveWebsiteTabContext(): Promise<{ tabId: number; hostname: string } | undefined> {
    try {
      const currentWindowTabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const currentContext = this.toWebsiteTabContext(currentWindowTabs[0]);
      if (currentContext) {
        return currentContext;
      }

      const lastFocusedTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const lastFocusedContext = this.toWebsiteTabContext(lastFocusedTabs[0]);
      if (lastFocusedContext) {
        return lastFocusedContext;
      }

      const allTabs = await chrome.tabs.query({});
      const recentWebsiteTab = [...allTabs]
        .filter((tab) => this.isWebsiteUrl(tab.url))
        .sort((left, right) => (right.lastAccessed || 0) - (left.lastAccessed || 0))[0];
      const recentContext = this.toWebsiteTabContext(recentWebsiteTab);
      if (recentContext) {
        return recentContext;
      }

      if (typeof this.lastActiveTabId === "number") {
        const tab = await chrome.tabs.get(this.lastActiveTabId);
        return this.toWebsiteTabContext(tab);
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  async sendToAllTabs(
    message: ConfigMessage,
    settings: SettingsManager,
    resolveDomainContextOverride?: (domain: string) => Promise<Partial<ConfigMessage["context"]>>,
  ): Promise<void> {
    const tabs = await chrome.tabs.query({});
    checkLastError();
    await Promise.allSettled(
      tabs.map(async (tab) => {
        if (typeof tab.id !== "number") {
          return;
        }
        const tabId = tab.id;
        let domain: string;
        try {
          const response = await promisifiedSendMessage<{ hostname?: string }>(
            tabId,
            { command: CMD_GET_HOSTNAME },
            { frameId: 0 },
          );
          domain = response?.hostname || "";
        } catch {
          // Tab has no content script (e.g. chrome:// pages)
          return;
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
      }),
    );
  }
}
