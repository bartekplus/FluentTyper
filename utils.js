"use strict";

function getDomain(url) {
  url = url.replace(/(https?:\/\/)?(www.)?/i, "");

  if (url.indexOf("/") !== -1) {
    return url.split("/")[0];
  }

  return url;
}

function isDomainOnList(settings, domainURL) {
  var ret = false;
  var domainList = [];
  domainURL = getDomain(domainURL);

  var domainListAsStr = settings.get("domainList");
  if (domainListAsStr) {
    domainList = domainListAsStr.split("|@|");
  }

  for (var i = 0; i < domainList.length; i++) {
    if (domainURL.match(domainList[i])) {
      ret = true;
      break;
    }
  }
  return ret;
}

function addDomainToList(settings, domainURL) {
  var domainListAsStr = settings.get("domainList");
  if (domainListAsStr) {
    domainListAsStr = domainListAsStr.split("|@|");
  } else {
    domainListAsStr = [];
  }
  domainListAsStr.push(domainURL);

  settings.set("domainList", domainListAsStr.join("|@|"));
}

function removeDomainFromList(settings, domainURL) {
  var domainList = [];
  var domainListAsStr = settings.get("domainList");

  domainURL = getDomain(domainURL);
  if (domainListAsStr) {
    domainList = domainListAsStr.split("|@|");
  }

  for (var i = 0; i < domainList.length; i++) {
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
