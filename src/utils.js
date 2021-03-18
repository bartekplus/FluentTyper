"use strict";

function getDomain(url) {
  return new URL(url).origin;
}

function isDomainOnList(settings, domainURL) {
  let ret = false;
  let domainList = [];
  domainURL = getDomain(domainURL);

  const domainListAsStr = settings.get("domainList");
  if (domainListAsStr) {
    domainList = domainListAsStr.split("|@|");
  }

  for (let i = 0; i < domainList.length; i++) {
    if (domainURL.match(domainList[i])) {
      ret = true;
      break;
    }
  }
  return ret;
}

function addDomainToList(settings, domainURL) {
  let domainListAsStr = settings.get("domainList");
  if (domainListAsStr) {
    domainListAsStr = domainListAsStr.split("|@|");
  } else {
    domainListAsStr = [];
  }
  domainListAsStr.push(domainURL);

  settings.set("domainList", domainListAsStr.join("|@|"));
}

function removeDomainFromList(settings, domainURL) {
  let domainList = [];
  const domainListAsStr = settings.get("domainList");

  domainURL = getDomain(domainURL);
  if (domainListAsStr) {
    domainList = domainListAsStr.split("|@|");
  }

  for (let i = 0; i < domainList.length; i++) {
    if (domainURL.match(domainList[i])) {
      domainList.splice(i, 1);
      settings.set("domainList", domainList.join("|@|"));
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
