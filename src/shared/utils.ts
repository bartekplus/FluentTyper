import { getErrorMessage } from "./error";  
const SETTINGS_DOMAIN_BLACKLIST = "domainBlackList";
const DOMAIN_LIST_MODE = {
  blackList: "Blacklist - enabled on all websites, disabled on specific sites",
  whiteList: "Whitelist - disabled on all websites, enabled on specific sites",
};

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export interface Settings {
  get: (key: string) => Promise<JsonValue>;
  set?: (key: string, value: JsonValue) => Promise<void>;
}

/**
 * Extracts the domain from a URL.
 *
 * @param url The URL to extract the domain from.
 * @returns The domain extracted from the URL, or undefined if the URL is invalid.
 */
function getDomain(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

/**
 * Checks if a given domain URL is on the domain blacklist/whitelist.
 */
async function isDomainOnList(settings: Settings, domainURL: string): Promise<boolean> {
  if (!domainURL) {
    return false;
  }
  try {
    const domainList = await settings.get(SETTINGS_DOMAIN_BLACKLIST);
    if (!Array.isArray(domainList)) {
      throw new Error("The domain list is not an array.");
    }
    for (let i = 0; i < domainList.length; i++) {
      if (domainURL.match(domainList[i] as string)) {
        return true;
      }
    }
    return false;
  } catch (error: unknown) {
    console.error(`Error checking domain list: ${getErrorMessage(error)}`);
    return false;
  }
}

/**
 * Adds a domain URL to the domain blacklist/whitelist.
 */
async function addDomainToList(settings: Settings, domainURL: string): Promise<void> {
  try {
    const domainList = await settings.get(SETTINGS_DOMAIN_BLACKLIST);
    if (!Array.isArray(domainList)) {
      throw new Error("The domain list is not an array.");
    }
    domainList.push(domainURL);
    if (settings.set) {
      await settings.set(SETTINGS_DOMAIN_BLACKLIST, domainList);
    }
  } catch (error: unknown) {
    console.error(`Error adding domain to list: ${getErrorMessage(error)}`);
  }
}

/**
 * Removes a domain URL from the domain blacklist/whitelist.
 */
async function removeDomainFromList(settings: Settings, domainURL: string): Promise<void> {
  try {
    const domainList = await settings.get(SETTINGS_DOMAIN_BLACKLIST);
    if (!Array.isArray(domainList)) {
      throw new Error("The domain list is not an array.");
    }
    for (let i = 0; i < domainList.length; i++) {
      if (domainURL.match(domainList[i] as string)) {
        domainList.splice(i, 1);
        if (settings.set) {
          await settings.set(SETTINGS_DOMAIN_BLACKLIST, domainList);
        }
        break;
      }
    }
  } catch (error: unknown) {
    console.error(`Error removing domain from list: ${getErrorMessage(error)}`);
  }
}

/**
 * Checks if the extension is enabled for the given domain URL.
 */
async function isEnabledForDomain(settings: Settings, domainURL: string): Promise<boolean> {
  let enabledForDomain = Boolean(await settings.get("enable"));
  if (enabledForDomain) {
    const domainListMode = await settings.get("domainListMode");
    const isDomainOnBWList = await isDomainOnList(settings, domainURL);
    enabledForDomain =
      (domainListMode === "blackList" && !isDomainOnBWList) ||
      (domainListMode === "whiteList" && isDomainOnBWList);
  }
  return enabledForDomain;
}

/**
 * Checks for errors in the last runtime operation and logs them to the console.
 */
function checkLastError(): void {
  try {
    if (chrome.runtime.lastError) {
      console.log("Runtime error:", chrome.runtime.lastError.message);
    }
  } catch (error: unknown) {
    console.error(`Error while checking runtime error: ${getErrorMessage(error)}`);
  }
}

/**
 * Toggles the blocked/unblocked status of a domain based on the current domain list mode.
 */
async function blockUnBlockDomain(settings: Settings, domainURL: string, block = false): Promise<void> {
  const domainListMode = await settings.get("domainListMode");
  if (
    (block && domainListMode === "blackList") ||
    (!block && domainListMode === "whiteList")
  ) {
    await addDomainToList(settings, domainURL);
  } else {
    await removeDomainFromList(settings, domainURL);
  }
}

/**
 * Debounce function to limit the rate of function calls.
 * @param func Function to be debounced
 * @param wait Time to wait before calling the function
 * @param options Options object with leading and trailing options
 */
export function debounce(
  func: (...args: undefined[]) => void,
  wait: number,
  options: { leading?: boolean; trailing?: boolean } = { leading: true, trailing: true }
): (...args: undefined[]) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return (...args: undefined[]) => {
    const timerExpired = (callFunc: boolean) => {
      timer = null;
      if (callFunc) func(...args);
    };

    const callNow = !!options.leading && timer === null;
    const timeoutFn = () => timerExpired(!callNow && !!options.trailing);
    if (timer) clearTimeout(timer);
    timer = setTimeout(timeoutFn, wait);
    if (callNow) func(...args);
  };
}

export {
  SETTINGS_DOMAIN_BLACKLIST,
  DOMAIN_LIST_MODE,
  isEnabledForDomain,
  checkLastError,
  isDomainOnList,
  getDomain,
  blockUnBlockDomain,
};
