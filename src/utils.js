const SETTINGS_DOMAIN_BLACKLIST = "domainBlackList";
const DOMAIN_LIST_MODE = {
  blackList: "Blacklist - enabled on all websites, disabled on specific sites",
  whiteList: "Whitelist - disabled on all websites, enabled on specific sites",
};

function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch (error) {
    return undefined;
  }
}

async function isDomainOnList(settings, domainURL) {
  let ret = false;
  const domainkList = await settings.get(SETTINGS_DOMAIN_BLACKLIST);

  for (let i = 0; i < domainkList.length; i++) {
    if (domainURL.match(domainkList[i])) {
      ret = true;
      break;
    }
  }
  return ret;
}

async function addDomainToList(settings, domainURL) {
  const domainkList = await settings.get(SETTINGS_DOMAIN_BLACKLIST);

  domainkList.push(domainURL);

  settings.set(SETTINGS_DOMAIN_BLACKLIST, domainkList);
}

async function removeDomainFromList(settings, domainURL) {
  const domainkList = await settings.get(SETTINGS_DOMAIN_BLACKLIST);

  for (let i = 0; i < domainkList.length; i++) {
    if (domainURL.match(domainkList[i])) {
      domainkList.splice(i, 1);
      settings.set(SETTINGS_DOMAIN_BLACKLIST, domainkList);
      break;
    }
  }
}

function checkLastError() {
  try {
    if (chrome.runtime.lastError) {
      console.log(chrome.runtime.lastError.message);
    }
  } catch (e) {
    console.error(e);
  }
}

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

async function blockUnBlockDomain(settings, domainURL, block = false) {
  const domainListMode = await settings.get("domainListMode");

  if (
    (block && domainListMode === "blackList") ||
    (!block && domainListMode !== "blackList")
  ) {
    addDomainToList(settings, domainURL);
  } else {
    removeDomainFromList(settings, domainURL);
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
