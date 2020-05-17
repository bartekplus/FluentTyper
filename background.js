/*jslint browser:true */
/*global Store,chrome*/

// Check whether new version is installed
chrome.runtime.onInstalled.addListener(function(details) {
    if (details.reason == "install") {
        //chrome.tabs.create({
        //    url: "options/index.html"
        //});
    } else if (details.reason == "update") {
        var thisVersion = chrome.runtime.getManifest().version;
        console.log("Updated from " + details.previousVersion + " to " + thisVersion + "!");
        //chrome.tabs.create({url: "options/index.html"});
    }
});

var settings = new Store("settings");
//setDefault Values
function setDefault(settings) {
    "use strict";
    //First Run - no value stored
    if (settings.get("enable") === undefined) {
        settings.set("enable", true);
    }
    if (settings.get("operatingMode") === undefined) {
        settings.set("operatingMode", "blacklist");
    }
}

function sendMsgToSandbox(message) {
    var iframe = document.getElementById('sandboxFrame');
    iframe.contentWindow.postMessage(message, '*');
}


function isEnabledForDomain(domainURL) {
    var enabledForDomain = settings.get("enable");
    if (enabledForDomain) {
        opMode = settings.get("operatingMode");
        enabledForDomain = (opMode === "blacklist") ? true : false;

        if (isDomainOnList(settings, domainURL)) {
            if (opMode === "blacklist") {
                enabledForDomain = false;
            } else {
                enabledForDomain = true;
            }
        }
    }
    return enabledForDomain;
}


// Called when a message is passed.  We assume that the content script
// wants to show the page action.
function onRequest(request, sender, sendResponse) {
    "use strict";
    var respMsg = {};

    if (chrome.runtime.lastError) {
        console.log(chrome.runtime.lastError.message);
    }

    request.context.tabId = sender.tab.id;
    request.context.frameId = sender.frameId;


    switch (request.command) {
        case 'predictReq':
            sendMsgToSandbox(request);
            break;

        case 'getConfig':
            respMsg = {
                command: "getConfig",
                context: {
                    enabled: isEnabledForDomain(sender.tab.url),
                }
            };
    }

    // Return nothing to let the connection be cleaned up.
    sendResponse(respMsg);
}

// Listen for the content script to send a message to the background page.
chrome.runtime.onMessage.addListener(onRequest);

setDefault(settings);

function receiveMessage(event) {

    chrome.tabs.sendMessage(event.data.context.tabId, event.data, {
        frameId: event.data.context.frameId
    });
}

window.addEventListener("message", receiveMessage, false);
chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
    chrome.pageAction.show(tabId);
});