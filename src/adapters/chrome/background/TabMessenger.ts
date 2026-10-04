import type { SettingsManager } from "@core/application/settingsManager";
import { getDomain, isEnabledForDomain } from "@core/application/domain-utils";
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

  private async queryTabs(
    queryInfo: chrome.tabs.QueryInfo,
  ): Promise<chrome.tabs.Tab[] | undefined> {
    try {
      return await chrome.tabs.query(queryInfo);
    } catch {
      return undefined;
    }
  }

  private async getActiveTab(): Promise<{ id: number; url?: string } | undefined> {
    const tabs = await this.queryTabs({ active: true, currentWindow: true });
    const firstTabUrl = tabs?.[0]?.url ?? "";
    const isExtensionPage =
      firstTabUrl.startsWith("chrome-extension://") || firstTabUrl.startsWith("moz-extension://");
    const fallbackTabs =
      !tabs || tabs.length === 0 || isExtensionPage
        ? await this.queryTabs({ active: true, lastFocusedWindow: true })
        : undefined;
    const tab = (fallbackTabs ?? tabs)?.[0];
    if (tab?.id !== undefined) return { id: tab.id, url: tab.url };
    return this.lastActiveTabId === undefined ? undefined : { id: this.lastActiveTabId };
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
    const hostname = getDomain(tab.url ?? "") ?? "";
    if (!hostname) {
      return undefined;
    }
    return {
      tabId: tab.id,
      hostname,
    };
  }

  /** Sends to the top frame; `{}` sends to every frame of the active tab. */
  sendToActiveTab(message: Message, options: { frameId?: number } = { frameId: 0 }): void {
    void this.getActiveTab().then((tab) => {
      if (tab) {
        void chrome.tabs.sendMessage(tab.id, message, options)?.catch(() => undefined);
      }
    });
  }

  sendToTab(tabId: number, frameId: number, message: Message): void {
    void chrome.tabs.sendMessage(tabId, message, { frameId })?.catch(() => undefined);
  }

  async getActiveTabContext(): Promise<{ tabId: number; hostname: string } | undefined> {
    const tab = await this.getActiveTab();
    return tab && { tabId: tab.id, hostname: getDomain(tab.url ?? "") ?? "" };
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
    const recentWebsiteTab = (allTabs ?? [])
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
    await Promise.allSettled(
      tabs.map(async (tab) => {
        if (typeof tab.id !== "number") {
          return;
        }
        const tabId = tab.id;
        let domain: string;
        try {
          const response: { hostname?: string } | undefined = await chrome.tabs.sendMessage(
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
          // Settings apply to every injected frame, using the same tab-domain policy as GET_CONFIG.
          await chrome.tabs.sendMessage(tabId, messageForTab);
        } catch (error) {
          console.warn(`sendToAllTabs failed: ${getErrorMessage(error)}`);
        }
      }),
    );
  }
}
