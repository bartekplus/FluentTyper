/*jslint browser:true */
/*global Store,chrome*/

var settings = new Store("settings");


function init() {
    "use strict";
    chrome.tabs.query({ active: true }, function(tabs) {
        var currentTab = tabs[0];
        var whiteList = [];
        var bcgPage = chrome.extension.getBackgroundPage();
        var urlNode = document.getElementById("checkboxDomainLabel");
        var checkboxNode = document.getElementById("checkboxDomainInput");
        var checkboxEnableNode = document.getElementById("checkboxEnableInput");

        var domainURL = getDomain(currentTab.url);
        var opMode = settings.get("operatingMode");
        urlNode.innerText = "Enable enable autocomplete on: " + domainURL;

        if (isDomainOnList(settings, domainURL)) {
            checkboxNode.checked = opMode === "blacklist" ? false : true;
        } else {
            checkboxNode.checked = opMode === "blacklist" ? true : false;
        }

        checkboxEnableNode.checked = settings.get("enable");
        document.getElementById("runOptions").href = chrome.extension.getURL("options.html");

    });
}

function addRemoveDomain() {
    chrome.tabs.query({ active: true }, function(tabs) {
        var currentTab = tabs[0];
        var whiteList = [];
        var bcgPage = chrome.extension.getBackgroundPage();
        var urlNode = document.getElementById("dupa");
        var domainURL = getDomain(currentTab.url);
        var idx;
        var opMode = settings.get("operatingMode");

        if (isDomainOnList(settings, domainURL)) {
            removeDomainFromList(settings, domainURL);
        } else {
            addDomainToList(settings, domainURL);
        }
    });
}

function toggleOnOff() {
    settings.set("enable", !settings.get("enable"));
}


init();

window.document.addEventListener("DOMContentLoaded", function() {
    "use strict";
    window.document.getElementById("checkboxDomainInput").addEventListener("click", addRemoveDomain);
    window.document.getElementById("checkboxEnableInput").addEventListener("click", toggleOnOff);
});