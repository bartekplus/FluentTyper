"use strict";

const LANGS = ["en"];
const presage = {};
let presage_config_cache = {};
const lastPrediction = {};

let config = {
  minWordLenghtToPredict: 1,
  predictNextWordAfterWhiteSpace: true,
  numSuggestions: "5",
};

function getLastWordLenght(str) {
  const wordArray = str.split(" ");
  if (wordArray.length) {
    return wordArray[wordArray.length - 1].length;
  }

  return 0;
}

function isLetter(character) {
  return RegExp(/^\p{L}/, "u").test(character);
}

function checkInput(predictionInput) {
  const isLastCharWhitespace = predictionInput !== predictionInput.trimEnd();
  const lastWordLenght = getLastWordLenght(predictionInput);
  const isLastCharLetter = isLetter(
    predictionInput[predictionInput.length - 1]
  );

  if (config.predictNextWordAfterWhiteSpace && isLastCharWhitespace) {
    return true;
  }
  if (isLastCharLetter && lastWordLenght >= config.minWordLenghtToPredict) {
    return true;
  }

  return false;
}

const presageCallback = {
  pastStream: "",

  get_past_stream: function () {
    return this.pastStream;
  },

  get_future_stream: function () {
    return "";
  },
};
/* eslint-disable no-var */

var Module = {
  onRuntimeInitialized: function () {
    const pcObject = Module.PresageCallback.implement(presageCallback);
    LANGS.forEach((lang) => {
      presage[lang] = new Module.Presage(
        pcObject,
        "resources_js/presage_" + lang + ".xml"
      );
      presage[lang].config(
        "Presage.Selector.SUGGESTIONS",
        config["numSuggestions"].toString()
      );
      lastPrediction[lang] = { pastStream: null, predictions: null };
    });
  },
};
/* eslint-enable no-var */

function convertString(s) {
  let str = null;
  if (typeof s === "string" || s instanceof String) {
    // replace &#160; with space
    str = s.replace(/\xA0/g, " ");
    // Check if string end with whitespace
    const endWithSpace = str !== str.trimEnd();
    // Get 3 last words and filter empty
    const wordArray = str
      .split(/\s+/) // Split ony any whitespace
      .filter(function (e) {
        return e.trim(); // filter empty elemeents
      })
      .splice(-3); // Get last 3 words
    str = wordArray.join(" ");
    if (endWithSpace) {
      str += " ";
    }

    if (checkInput(str)) return str;
  }

  return null;
}
let predictionTimeouts = {};

function runPrediction(event) {
  const command = event.data.command;
  const context = event.data.context;
  switch (command) {
    case "backgroundPagePredictReq": {
      const pastStream = convertString(event.data.context.text);
      const message = { command: "sandBoxPredictResp", context: context };
      if (!pastStream || !presage[context.lang]) {
        // Invalid input or presage predition module not ready yet - reply with empty predictions
        message.context.predictions = [];
        event.source.postMessage(message, event.origin);
      } else if (pastStream === lastPrediction[context.lang].pastStream) {
        message.context.predictions = lastPrediction[context.lang].predictions;
        event.source.postMessage(message, event.origin);
      } else {
        const predictions = [];
        presageCallback.pastStream = pastStream;
        for (let i = 0; i < 0; i++) {
          let predictionsNative2 = presage[context.lang].predict();
          predictionsNative2 = predictionsNative2;
        }
        const predictionsNative = presage[context.lang].predict();
        if (predictionsNative.size()) {
          for (let i = 0; i < predictionsNative.size(); i++) {
            predictions.push(predictionsNative.get(i));
          }
        }
        message.context.predictions = predictions;
        event.source.postMessage(message, event.origin);
        lastPrediction[context.lang].pastStream = pastStream;
        lastPrediction[context.lang].predictions = predictions;
      }
      break;
    }
    case "backgroundPageSetConfig": {
      config = context;
      if (presage[context.lang]) {
        presage[context.lang].config(
          "Presage.Selector.SUGGESTIONS",
          config["numSuggestions"].toString()
        );
      }
      break;
    }
    default:
      console.log("Unknown message:");
      console.log(event);
  }
  predictionTimeouts[event.data.context.tabId][event.data.context.frameId] =
    null;
}

window.addEventListener("message", function (event) {
  const tabId = event.data.context.tabId;
  const frameId = event.data.context.frameId;
  if (!predictionTimeouts[tabId]) {
    predictionTimeouts[tabId] = {};
  } else if (predictionTimeouts[tabId][frameId]) {
    this.clearTimeout(predictionTimeouts[tabId][frameId]);
  }
  predictionTimeouts[tabId][frameId] = this.setTimeout(
    runPrediction.bind(null, event),
    0
  );
});
