import type { SettingsManager } from "./settingsManager";
import { getErrorMessage } from "@core/domain/error";
import { normalizeDomainHost } from "@core/domain/siteProfiles";
import { getSettingStorageKey } from "@core/domain/contracts/settings";

export const SETTINGS_DOMAIN_BLACKLIST = getSettingStorageKey("domainList");
const SETTINGS_ENABLED = getSettingStorageKey("enabled");
const SETTINGS_DOMAIN_LIST_MODE = getSettingStorageKey("domainListMode");

export const DOMAIN_LIST_MODE = {
  blackList: "Blacklist - enabled on all websites, disabled on specific sites",
  whiteList: "Whitelist - disabled on all websites, enabled on specific sites",
};

async function getDomainList(settings: SettingsManager): Promise<string[]> {
  const domainList = await settings.get(SETTINGS_DOMAIN_BLACKLIST);
  return Array.isArray(domainList) ? domainList.map((entry) => String(entry)) : [];
}

async function getDomainListMode(settings: SettingsManager): Promise<"blackList" | "whiteList"> {
  const mode = await settings.get(SETTINGS_DOMAIN_LIST_MODE);
  return mode === "whiteList" ? "whiteList" : "blackList";
}

async function isEnabledGlobally(settings: SettingsManager): Promise<boolean> {
  return Boolean(await settings.get(SETTINGS_ENABLED));
}

export function getDomain(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

export async function isDomainOnList(
  settings: SettingsManager,
  domainURL: string,
): Promise<boolean> {
  const normalizedDomain = normalizeDomainHost(domainURL);
  if (!normalizedDomain) {
    return false;
  }
  try {
    const domainList = await getDomainList(settings);
    for (let i = 0; i < domainList.length; i++) {
      const listDomain = normalizeDomainHost(String(domainList[i]));
      if (listDomain && normalizedDomain === listDomain) {
        return true;
      }
    }
    return false;
  } catch (error: unknown) {
    console.error(`Error checking domain list: ${getErrorMessage(error)}`);
    return false;
  }
}

export async function addDomainToList(settings: SettingsManager, domainURL: string): Promise<void> {
  const normalizedDomain = normalizeDomainHost(domainURL);
  if (!normalizedDomain) {
    return;
  }
  try {
    const domainList = await getDomainList(settings);
    domainList.push(normalizedDomain);
    await settings.set(SETTINGS_DOMAIN_BLACKLIST, domainList);
  } catch (error: unknown) {
    console.error(`Error adding domain to list: ${getErrorMessage(error)}`);
  }
}

export async function removeDomainFromList(
  settings: SettingsManager,
  domainURL: string,
): Promise<void> {
  const normalizedDomain = normalizeDomainHost(domainURL);
  if (!normalizedDomain) {
    return;
  }
  try {
    const domainList = await getDomainList(settings);
    for (let i = 0; i < domainList.length; i++) {
      const listDomain = normalizeDomainHost(String(domainList[i]));
      if (listDomain && normalizedDomain === listDomain) {
        domainList.splice(i, 1);
        await settings.set(SETTINGS_DOMAIN_BLACKLIST, domainList);
        break;
      }
    }
  } catch (error: unknown) {
    console.error(`Error removing domain from list: ${getErrorMessage(error)}`);
  }
}

export async function isEnabledForDomain(
  settings: SettingsManager,
  domainURL: string,
): Promise<boolean> {
  const [enabled, domainListMode, isDomainOnBWList] = await Promise.all([
    isEnabledGlobally(settings),
    getDomainListMode(settings),
    isDomainOnList(settings, domainURL),
  ]);
  let enabledForDomain = enabled;
  if (enabledForDomain) {
    enabledForDomain =
      (domainListMode === "blackList" && !isDomainOnBWList) ||
      (domainListMode === "whiteList" && isDomainOnBWList);
  }
  return enabledForDomain;
}

export async function blockUnBlockDomain(
  settings: SettingsManager,
  domainURL: string,
  block = false,
): Promise<void> {
  const domainListMode = await getDomainListMode(settings);
  if ((block && domainListMode === "blackList") || (!block && domainListMode === "whiteList")) {
    await addDomainToList(settings, domainURL);
  } else {
    await removeDomainFromList(settings, domainURL);
  }
}

export function isWhiteSpace(character: string, matchNewLine: boolean = true): boolean {
  const whiteSpaceRegex = /\s+/;
  const whiteSpaceRegexExcludeNewLine = /[^\S\r\n]+/;
  if (matchNewLine) {
    return whiteSpaceRegex.test(character);
  } else {
    return whiteSpaceRegexExcludeNewLine.test(character);
  }
}

export function isLetter(character: string): boolean {
  const letterRegex = /^\p{L}/u;
  return letterRegex.test(character);
}

function countDigits(str: string): number {
  return str.replace(/[^0-9]/g, "").length;
}

export function isNumber(str: string): boolean {
  return (!isNaN(Number(str)) && !isNaN(parseFloat(str))) || countDigits(str) > 1;
}
