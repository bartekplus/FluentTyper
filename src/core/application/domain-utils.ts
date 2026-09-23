import type { SettingsManager } from "./settingsManager";
import { getErrorMessage } from "@core/domain/error";
import { normalizeDomainHost } from "@core/domain/siteProfiles";
import { getSettingStorageKey } from "@core/domain/contracts/settings";

export const SETTINGS_DOMAIN_BLACKLIST = getSettingStorageKey("domainList");
const SETTINGS_ENABLED = getSettingStorageKey("enabled");
const SETTINGS_DOMAIN_LIST_MODE = getSettingStorageKey("domainListMode");
const WHITESPACE_REGEX = /\s+/;
const DIGITS_ONLY_REGEX = /\P{Nd}/gu;

export function toStoredString(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return null;
}

function isDomainAllowedByMode(
  mode: "blackList" | "whiteList",
  isDomainOnBWList: boolean,
): boolean {
  return (mode === "blackList" && !isDomainOnBWList) || (mode === "whiteList" && isDomainOnBWList);
}

async function getDomainList(settings: SettingsManager): Promise<string[]> {
  const domainList = await settings.get(SETTINGS_DOMAIN_BLACKLIST);
  return Array.isArray(domainList)
    ? domainList
        .map((entry) => toStoredString(entry))
        .filter((entry): entry is string => typeof entry === "string")
    : [];
}

async function getDomainListMode(settings: SettingsManager): Promise<"blackList" | "whiteList"> {
  const mode = await settings.get(SETTINGS_DOMAIN_LIST_MODE);
  return mode === "whiteList" ? "whiteList" : "blackList";
}

async function isEnabledGlobally(settings: SettingsManager): Promise<boolean> {
  const enabled = await settings.get(SETTINGS_ENABLED);
  return typeof enabled === "boolean" ? enabled : true;
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
    return domainList.some((entry) => normalizeDomainHost(entry) === normalizedDomain);
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
    const index = domainList.findIndex((entry) => normalizeDomainHost(entry) === normalizedDomain);
    if (index !== -1) {
      domainList.splice(index, 1);
      await settings.set(SETTINGS_DOMAIN_BLACKLIST, domainList);
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
  return enabled && isDomainAllowedByMode(domainListMode, isDomainOnBWList);
}

export async function isDomainAllowedByPreference(
  settings: SettingsManager,
  domainURL: string,
): Promise<boolean> {
  const [domainListMode, isDomainOnBWList] = await Promise.all([
    getDomainListMode(settings),
    isDomainOnList(settings, domainURL),
  ]);

  return isDomainAllowedByMode(domainListMode, isDomainOnBWList);
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

export function isWhiteSpace(character: string): boolean {
  return WHITESPACE_REGEX.test(character);
}

export function isNumber(str: string): boolean {
  return (
    (!isNaN(Number(str)) && !isNaN(parseFloat(str))) ||
    str.replace(DIGITS_ONLY_REGEX, "").length > 1
  );
}
