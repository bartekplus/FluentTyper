const SETTINGS_DOMAIN_BLACKLIST = "domainBlackList";
const DOMAIN_LIST_MODE = {
  blackList: "Blacklist - enabled on all websites, disabled on specific sites",
  whiteList: "Whitelist - disabled on all websites, enabled on specific sites",
};

/**
 * Extracts the domain from a URL.
 *
 * @param {string} url The URL to extract the domain from.
 * @returns {string|undefined} The domain extracted from the URL, or undefined if the URL is invalid.
 */
function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch (error) {
    return undefined;
  }
}

/**
 * Checks if a given domain URL is on the domain blacklist/whitelist.
 *
 * @param {Object} settings The settings object to retrieve the domain blacklist from.
 * @param {string} domainURL The domain URL to check.
 * @returns {Promise<boolean>} A Promise that resolves to true if the domain is on the blacklist/whitelist, false otherwise.
 */
async function isDomainOnList(settings, domainURL) {
  if (!domainURL) {
    return false;
  }

  try {
    const domainList = await settings.get(SETTINGS_DOMAIN_BLACKLIST);

    if (!Array.isArray(domainList)) {
      throw new Error("The domain list is not an array.");
    }

    for (let i = 0; i < domainList.length; i++) {
      if (domainURL.match(domainList[i])) {
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error(`Error checking domain list: ${error.message}`);
    return false;
  }
}

/**
 * Adds a domain URL to the domain blacklist/whitelist.
 *
 * @param {Object} settings The settings object to set the domain blacklist to.
 * @param {string} domainURL The domain URL to add.
 * @returns {Promise<void>} A Promise that resolves when the domain is added to the blacklist/whitelist.
 */
async function addDomainToList(settings, domainURL) {
  try {
    const domainList = await settings.get(SETTINGS_DOMAIN_BLACKLIST);

    if (!Array.isArray(domainList)) {
      throw new Error("The domain list is not an array.");
    }

    domainList.push(domainURL);

    await settings.set(SETTINGS_DOMAIN_BLACKLIST, domainList);
  } catch (error) {
    console.error(`Error adding domain to list: ${error.message}`);
  }
}

/**
 * Removes a domain URL from the domain blacklist/whitelist.
 *
 * @param {Object} settings The settings object to set the domain blacklist to.
 * @param {string} domainURL The domain URL to remove.
 * @returns {Promise<void>} A Promise that resolves when the domain is removed from the blacklist/whitelist.
 */
async function removeDomainFromList(settings, domainURL) {
  try {
    const domainList = await settings.get(SETTINGS_DOMAIN_BLACKLIST);

    if (!Array.isArray(domainList)) {
      throw new Error("The domain list is not an array.");
    }

    for (let i = 0; i < domainList.length; i++) {
      if (domainURL.match(domainList[i])) {
        domainList.splice(i, 1);
        await settings.set(SETTINGS_DOMAIN_BLACKLIST, domainList);
        break;
      }
    }
  } catch (error) {
    console.error(`Error removing domain from list: ${error.message}`);
  }
}

/**
 * Checks if the extension is enabled for the given domain URL.
 * @param {object} settings - The browser settings object.
 * @param {string} domainURL - The domain URL to check.
 * @returns {Promise<boolean>} A Promise that resolves to true if the extension is enabled for the domain, false otherwise.
 */
async function isEnabledForDomain(settings, domainURL) {
  let enabledForDomain = await settings.get("enable");
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
function checkLastError() {
  try {
    if (chrome.runtime.lastError) {
      console.log("Runtime error:", chrome.runtime.lastError.message);
    }
  } catch (error) {
    console.error("Error while checking runtime error:", error);
  }
}

/**
 * Toggles the blocked/unblocked status of a domain based on the current domain list mode.
 * If the domain list mode is "blackList" and the block parameter is true, the domain is added to the blacklist.
 * If the domain list mode is "whiteList" and the block parameter is false, the domain is added to the blacklist.
 * If the domain list mode is "blackList" and the block parameter is false, the domain is removed from the blacklist.
 * If the domain list mode is "whiteList" and the block parameter is true, the domain is removed from the blacklist.
 *
 * @param {Object} settings - The settings object.
 * @param {string} domainURL - The domain URL.
 * @param {boolean} [block=false] - A boolean indicating whether to block or unblock the domain. Defaults to false.
 * @returns {void}
 */
async function blockUnBlockDomain(settings, domainURL, block = false) {
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

export {
  SETTINGS_DOMAIN_BLACKLIST,
  DOMAIN_LIST_MODE,
  isEnabledForDomain,
  checkLastError,
  isDomainOnList,
  getDomain,
  blockUnBlockDomain,
};
