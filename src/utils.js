function getDomain(url) {
  try {
    return new URL(url).origin;
  } catch (error) {
    return undefined;
  }
}

async function isDomainOnList(settings, domainURL) {
  let ret = false;
  const domainList = await settings.get("domainList");
  domainURL = getDomain(domainURL);

  for (let i = 0; i < domainList.length; i++) {
    if (domainURL.match(domainList[i])) {
      ret = true;
      break;
    }
  }
  return ret;
}

async function addDomainToList(settings, domainURL) {
  const domainList = await settings.get("domainList");

  domainList.push(domainURL);

  settings.set("domainList", domainList);
}

function removeDomainFromList(settings, domainURL) {
  const promise = settings.get("domainList");
  promise
    .then(function (domainList) {
      domainURL = getDomain(domainURL);
      for (let i = 0; i < domainList.length; i++) {
        if (domainURL.match(domainList[i])) {
          domainList.splice(i, 1);
          settings.set("domainList", domainList);
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
  checkLastError,
  removeDomainFromList,
  addDomainToList,
  isDomainOnList,
  getDomain,
};
