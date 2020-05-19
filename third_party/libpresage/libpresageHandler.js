'use strict'

var presage = null

var lastPrediction = {
  past_stream: null,
  predictions: null
}

var presageCallback = {
  past_stream: '',

  get_past_stream: function () {
    return this.past_stream
  },

  get_future_stream: function () {
    return ''
  }
}
var Module = {
  onRuntimeInitialized: function () {
    var pcObject = Module.PresageCallback.implement(presageCallback)
    presage = new Module.Presage(pcObject, 'resources_js/presage.xml')
  }
}

function convertString (s) {
  var str = ''
  if (typeof (s) === 'string' || s instanceof String) {
    if (s.endsWith(' ')) {
      str = s.trim() + ' '
    } else {
      str = s.trim()
    }
  }
  return str
}

window.addEventListener('message', function (event) {
  var command = event.data.command
  switch (command) {
    case 'predictReq':
      var context = event.data.context
      var pastStream = convertString(event.data.context.text)
      var message = {
        command: 'predictResp',
        context: context
      }
      if (!pastStream || !presage) {
        // Nothing to do here
      } else if (pastStream === lastPrediction.pastStream) {
        message.context.predictions = lastPrediction.predictions

        event.source.postMessage(message, event.origin)
      } else {
        var predictions = []
        presageCallback.pastStream = pastStream
        var predictionsNative = presage.predict()
        if (predictionsNative.size()) {
          for (var i = 0; i < predictionsNative.size(); i++) {
            predictions.push(predictionsNative.get(i))
          }
          message.context.predictions = predictions
          event.source.postMessage(message, event.origin)
          lastPrediction.pastStream = pastStream
          lastPrediction.predictions = predictions
        }
      }
      break

            // case 'somethingElse':
            //   ...
  }
})
