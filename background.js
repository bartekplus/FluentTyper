/*jslint browser:true */
/*global Store,chrome*/

// Check whether new version is installed
chrome.runtime.onInstalled.addListener(function(details) {
    if (details.reason == "install") {
        chrome.tabs.create({
            url: "options/index.html"
        });
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
    if (settings.get("showPlaceHolders") === undefined) {
        settings.set("showPlaceHolders", true);
    }
    if (settings.get("placeHolderColor") === undefined) {
        settings.set("placeHolderColor", "999999");
    }
    if (settings.get("placeHolderOpacity") === undefined) {
        settings.set("placeHolderOpacity", 0.9);
    }
    if (settings.get("placeHolderColorHover") === undefined) {
        settings.set("placeHolderColorHover", "444444");
    }
    if (settings.get("placeHolderOpacityHover") === undefined) {
        settings.set("placeHolderOpacityHover", 0.9);
    }
    if (settings.get("placeHolderIcon") === undefined) {
        settings.set("placeHolderIcon", true);
    }
    if (settings.get("showIcon") === undefined) {
        settings.set("showIcon", true);
    }
    if (settings.get("placeHolderIconUrl") === undefined) {
        settings.set("placeHolderIconUrl", "");
    }
    if (settings.get("unBlockActiveTabs") === undefined) {
        settings.set("unBlockActiveTabs", false);
    }
}


function sendMsgToSandbox(message) {
    var iframe = document.getElementById('sandboxFrame');
    iframe.contentWindow.postMessage(message, '*');
}

// Called when a message is passed.  We assume that the content script
// wants to show the page action.
function onRequest(request, sender, sendResponse) {
    "use strict";
    // Show the page action for the tab that the sender (content script)
    // was on.
    if (chrome.runtime.lastError) {
        console.log(chrome.runtime.lastError.message);
    }
    console.log("SENDERRRRR");
    console.log(sender);

    request.context.tabId = sender.tab.id;
    request.context.frameId = sender.frameId;

    switch (request.command) {
        case 'predictReq':
            sendMsgToSandbox(request);
            break;

            // case 'somethingElse':
            //   ...
    }

    sendResponse({});
    // Return nothing to let the connection be cleaned up.
}

// Listen for the content script to send a message to the background page.
chrome.runtime.onMessage.addListener(onRequest);

function updateTabActiveStatus(tabArray) {
    "use strict";
    for (var i = 0; i < tabArray.length; i++) {
        //   chrome.tabs.sendMessage(tabArray[i].id, {
        //       message: "active",
        //       value: tabArray[i].active
        //   }, function (response) {
        //       response = response;
        //   });
    }
}

function onTabActivated(info) {
    "use strict";
    /* AntiWarning */
    info = info;
    chrome.tabs.query({}, updateTabActiveStatus);

}

chrome.tabs.onActivated.addListener(onTabActivated);

setDefault(settings);

function receiveMessage(event) {
    console.log("Got callback from sandbox " + event)
    console.log(event)

    predictions = event.data.context.predictions;
    console.log(predictions)

    for (var i = 0; i < predictions.length; i++) {
        console.log("predictions : ", predictions[i]);
    }

    chrome.tabs.sendMessage(event.data.context.tabId, event.data, {
        frameId: event.data.context.frameId
    });
}


window.addEventListener("message", receiveMessage, false);