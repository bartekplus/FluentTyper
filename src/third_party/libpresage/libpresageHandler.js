"use strict";

let presage = null;

const lastPrediction = {
  pastStream: null,
  predictions: null,
};

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
    presage = new Module.Presage(pcObject, "resources_js/presage.xml");
  },
};
/* eslint-enable no-var */

function convertString(s) {
  let str = "";
  if (typeof s === "string" || s instanceof String) {
    if (s.endsWith(" ")) {
      str = s.trim() + " ";
    } else {
      str = s.trim();
    }
  }
  return str;
}

window.addEventListener("message", function (event) {
  const command = event.data.command;
  const context = event.data.context;
  const pastStream = convertString(event.data.context.text);
  const message = {
    command: "predictResp",
    context: context,
  };
  switch (command) {
    case "predictReq":
      if (!pastStream || !presage) {
        // Nothing to do here
      } else if (pastStream === lastPrediction.pastStream) {
        message.context.predictions = lastPrediction.predictions;

        event.source.postMessage(message, event.origin);
      } else {
        const predictions = [];
        presageCallback.pastStream = pastStream;
        const predictionsNative = presage.predict();
        if (predictionsNative.size()) {
          for (let i = 0; i < predictionsNative.size(); i++) {
            predictions.push(predictionsNative.get(i));
          }
          message.context.predictions = predictions;
          event.source.postMessage(message, event.origin);
          lastPrediction.pastStream = pastStream;
          lastPrediction.predictions = predictions;
        }
      }
      break;

    // case 'somethingElse':
    //   ...
  }
});
