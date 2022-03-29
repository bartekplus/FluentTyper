const SETTINGS_DOMAIN_BLACKLIST = "domainBlackList";

function getDomain(url) {
  try {
    return new URL(url).origin;
  } catch (error) {
    return undefined;
  }
}

async function isDomainOnBlackList(settings, domainURL) {
  let ret = false;
  const domainBlackList = await settings.get(SETTINGS_DOMAIN_BLACKLIST);
  domainURL = getDomain(domainURL);

  for (let i = 0; i < domainBlackList.length; i++) {
    if (domainURL.match(domainBlackList[i])) {
      ret = true;
      break;
    }
  }
  return ret;
}

async function addDomainToBlackList(settings, domainURL) {
  const domainBlackList = await settings.get(SETTINGS_DOMAIN_BLACKLIST);

  domainBlackList.push(domainURL);

  settings.set(SETTINGS_DOMAIN_BLACKLIST, domainBlackList);
}

function removeDomainFromBlackList(settings, domainURL) {
  const promise = settings.get(SETTINGS_DOMAIN_BLACKLIST);
  promise
    .then(function (domainBlackList) {
      domainURL = getDomain(domainURL);
      for (let i = 0; i < domainBlackList.length; i++) {
        if (domainURL.match(domainBlackList[i])) {
          domainBlackList.splice(i, 1);
          settings.set(SETTINGS_DOMAIN_BLACKLIST, domainBlackList);
          break;
        }
      }
    })
    .catch(function (e) {
      console.error(e);
    });
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

export {
  SETTINGS_DOMAIN_BLACKLIST,
  checkLastError,
  removeDomainFromBlackList,
  addDomainToBlackList,
  isDomainOnBlackList,
  getDomain,
};
