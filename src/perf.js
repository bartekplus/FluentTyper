"use strict";

import { Store } from "./third_party/fancy-settings/lib/store.js";

const settings = new Store("settings");

let t0 = 0;
let t1 = 0;
let total_time = 0;
function sendMsgToSandbox(message) {
  const iframe = document.getElementById("sandboxFrame");
  iframe.contentWindow.postMessage(message, "*");
}

function receiveMessage(event) {
  switch (event.data.command) {
    case "sandBoxPredictResp":
      t1 = performance.now();
      // console.log("Call to doSomething took " + (t1 - t0) + " milliseconds.");
      // console.log(event.data.context.predictions);
      start_test();
      break;

    case "config":
      break;
  }
}

window.addEventListener("message", receiveMessage, false);

function updatePresageConfig() {
  sendMsgToSandbox({
    command: "config",
    context: {
      lang: settings.get("language"),
      key: "Presage.Selector.SUGGESTIONS",
      value: settings.get("numSuggestions"),
    },
  });
}

let message = {
  command: "backgroundPagePredictReq",
  context: {
    text: "",
    lang: settings.get("language"),
    tributeId: 0,
    requestId: 0,
  },
};

let test_count = 0;
let id = 0;
let reps = 100;
const PRED = [
  "measured co",
  "programming languag",
  "expected later t",
  "game develope",
  "several proprietary graphi",
  "can be initialized only thro",
  "subvert some of these restrict",
  "generics is similar to the typical implemen",
  "features a large number of compo",
  "It is possible to exte",
];

function start_test() {
  if (t0 && t1) {
    total_time += t1 - t0;
  }
  if (id < PRED.length) {
    test_count += 1;
    message.context.text = PRED[id];
    message.context.lang = settings.get("language");
    id += 1;
    t0 = performance.now();
    sendMsgToSandbox(message);
  } else {
    if (reps) {
      reps -= 1;
      id = 0;
      start_test();
    }
    console.log("Total time: " + total_time);
    console.log("Avg time: " + total_time / test_count);
  }
}

window.addEventListener("DOMContentLoaded", (event) => {
  const iframe = document.getElementById("sandboxFrame");
  if (navigator.userAgent.indexOf("Chrome") !== -1) {
    setTimeout(start_test, 4500);
  } else {
    iframe.addEventListener("load", function () {
      setTimeout(start_test, 3000);
    });
  }
});
