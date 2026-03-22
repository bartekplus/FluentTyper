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

  private async queryTabs(queryInfo: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[] | undefined> {
    try {
      return await chrome.tabs.query(queryInfo);
    } catch {
      return undefined;
    }
  }

  private getTabIdFromTabs(tabs: chrome.tabs.Tab[] | undefined): number | undefined {
    const tabId = tabs?.[0]?.id;
    return typeof tabId === "number" ? tabId : undefined;
  }

  private async getActiveTabId(): Promise<number | undefined> {
    checkLastError();
    const tabs = await this.queryTabs({ active: true, currentWindow: true });
    const firstTabUrl = tabs?.[0]?.url ?? "";
    const isExtensionPage =
      firstTabUrl.startsWith("chrome-extension://") || firstTabUrl.startsWith("moz-extension://");
    const fallbackTabs =
      !tabs || tabs.length === 0 || isExtensionPage
        ? await this.queryTabs({ active: true, lastFocusedWindow: true })
        : undefined;
    const activeTabId = this.getTabIdFromTabs(fallbackTabs ?? tabs);
    if (activeTabId !== undefined) {
      return activeTabId;
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
    void this.getActiveTabId().then((tabId) => {
      if (tabId !== undefined) {
        void chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
      }
    });
  }

  sendToTab(tabId: number, frameId: number, message: Message): void {
    void chrome.tabs.sendMessage(tabId, message, { frameId });
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
    const currentWindowTabs = await this.queryTabs({ active: true, currentWindow: true });
    const currentContext = this.toWebsiteTabContext(currentWindowTabs?.[0]);
    if (currentContext) {
      return currentContext;
    }

    const lastFocusedTabs = await this.queryTabs({ active: true, lastFocusedWindow: true });
    const lastFocusedContext = this.toWebsiteTabContext(lastFocusedTabs?.[0]);
    if (lastFocusedContext) {
      return lastFocusedContext;
    }

    const allTabs = await this.queryTabs({});
    const recentWebsiteTab = [...(allTabs ?? [])]
      .filter((tab) => this.isWebsiteUrl(tab.url))
      .sort((left, right) => (right.lastAccessed || 0) - (left.lastAccessed || 0))[0];
    const recentContext = this.toWebsiteTabContext(recentWebsiteTab);
    if (recentContext) {
      return recentContext;
    }

    if (typeof this.lastActiveTabId === "number") {
      try {
        return this.toWebsiteTabContext(await chrome.tabs.get(this.lastActiveTabId));
      } catch {
        return undefined;
      }
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
          void chrome.tabs.sendMessage(tab.id, messageForTab, { frameId: 0 });
        } catch (error) {
          console.warn(`sendToAllTabs failed: ${getErrorMessage(error)}`);
        }
      }),
    );
  }
}
