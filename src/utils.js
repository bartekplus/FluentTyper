"use strict";

function getDomain(url) {
  try {
    return new URL(url).origin;
  } catch (error) {
    return undefined;
  }
}

function isDomainOnList(settings, domainURL) {
  let ret = false;
  let domainList = settings.get("domainList");
  domainURL = getDomain(domainURL);

  for (let i = 0; i < domainList.length; i++) {
    if (domainURL.match(domainList[i])) {
      ret = true;
      break;
    }
  }
  return ret;
}

function addDomainToList(settings, domainURL) {
  let domainList = settings.get("domainList");

  domainList.push(domainURL);

  settings.set("domainList", domainList);
}

function removeDomainFromList(settings, domainURL) {
  let domainList = settings.get("domainList");

  domainURL = getDomain(domainURL);

  for (let i = 0; i < domainList.length; i++) {
    if (domainURL.match(domainList[i])) {
      domainList.splice(i, 1);
      settings.set("domainList", domainList);
      break;
    }
  }
}

function checkLastError() {
  try {
    if (chrome.runtime.lastError) {
      console.log(chrome.runtime.lastError.message);
    }
  } catch (e) {}
}

export {
  checkLastError,
  removeDomainFromList,
  addDomainToList,
  isDomainOnList,
  getDomain,
};
