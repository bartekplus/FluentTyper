function getDomain(url) {

    url = url.replace(/(https?:\/\/)?(www.)?/i, '');

    if (url.indexOf('/') !== -1) {
        return url.split('/')[0];
    }

    return url;

}

function isDomainOnList(settings, domainURL) {
    ret = false;
    domainURL = getDomain(domainURL);

    var domainList = [];
    domainListAsStr = settings.get("domainList");
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


function isDomainOnList(settings, domainURL) {
    ret = false;

    var domainList = [];
    domainListAsStr = settings.get("domainList");
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
    domainListAsStr = settings.get("domainList");
    if (domainListAsStr) {
        domainListAsStr = domainListAsStr.split("|@|");
    } else {
        domainListAsStr = [];
    }
    domainListAsStr.push(domainURL);

    settings.set("domainList", domainListAsStr.join("|@|"));
}

function removeDomainFromList(settings, domainURL) {

    domainURL = getDomain(domainURL);
    var domainList = [];
    domainListAsStr = settings.get("domainList");
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