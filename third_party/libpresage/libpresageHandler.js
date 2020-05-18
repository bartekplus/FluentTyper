presage = null;

var lastPrediction = {
    past_stream: null,
    predictions: null
}

var presageCallback = {
    past_stream: "",

    get_past_stream: function() {
        return this.past_stream;
    },

    get_future_stream: function() {
        return "";
    }
};
var Module = {
    onRuntimeInitialized: function() {
        var pcObject = Module.PresageCallback.implement(presageCallback);
        presage = new Module.Presage(pcObject, "resources_js/presage.xml");
    }
};

function convertString(s) {
    str = ""
    if (typeof(s) === 'string' || s instanceof String) {
        if (s.endsWith(' ')) {
            str = s.trim() + ' ';
        } else {
            str = s.trim();
        }
    }
    return str;
}

window.addEventListener('message', function(event) {
    var command = event.data.command;
    switch (command) {
        case 'predictReq':
            past_stream = convertString(event.data.context.text);
            if (!past_stream || !presage) {
                // Nothing to do here
            } else if (past_stream == lastPrediction.past_stream) {
                context.predictions = lastPrediction.predictions;
                var message = {
                    command: 'predictResp',
                    context: context
                };
                event.source.postMessage(message, event.origin);

            } else {
                presageCallback.past_stream = past_stream
                context = event.data.context;
                predictions = [];
                predictionsNative = presage.predict();
                if (predictionsNative.size()) {

                    for (var i = 0; i < predictionsNative.size(); i++) {
                        predictions.push(predictionsNative.get(i));
                    }
                    context.predictions = predictions;
                    var message = {
                        command: 'predictResp',
                        context: context
                    };
                    event.source.postMessage(message, event.origin);
                    lastPrediction.past_stream = past_stream;
                    lastPrediction.predictions = predictions;
                }
            }
            break;

            // case 'somethingElse':
            //   ...
    }

});