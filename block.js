(function() {

    horseyArr = []

    function isHorseyAttached(elem) {
        for (var i = 0; i < horseyArr.length; i++) {
            if (elem == horseyArr[i].elem) {
                return true;
            }
        }
        return false;
    }

    function MutationCallback(mutationsList, observer) {
        var nodesAdded = false;
        for (let mutation of mutationsList) {
            if (mutation.type === 'childList') {
                for (let node of mutation.addedNodes) {
                    //console.log('A child node has been added');
                    //console.log(node);
                    nodesAdded = true;
                }
                for (let node of mutation.removedNodes) {}

            } else if (mutation.type === 'attributes') {
                //console.log('The ' + mutation.attributeName + ' attribute was modified.');
            }
        }
        if (nodesAdded) {
            attachHorsey();
        }
    };


    function attachHorsey() {

        selectors = ['textarea', 'input']

        for (var selectorId = 0; selectorId < selectors.length; selectorId++) {

            elems = document.querySelectorAll(selectors[selectorId]);
            console.log(selectors[selectorId]);
            console.log(elems);
            for (var i = 0; i < elems.length; i++) {
                elem = elems[i];
                if (isHorseyAttached(elem)) {
                    continue;
                }
                console.log("attaching to " + elem);
                console.log(elem);

                horseyArrId = horseyArr.length;
                horseyArr.push({
                    horsey: null,
                    done: null,
                    elem: elem
                });
                console.log(horseyArr);
                horseyObj = horsey(elem, {

                    source: (function(data, done) {
                        var localId = horseyArrId;
                        return function(data, done) {
                            console.log("XXX");
                            console.log(data);
                            console.log(localId);
                            console.log(i);
                            console.log(horseyArr);
                            horseyArr[localId].done = done;
                            var message = {
                                command: 'predictReq',
                                context: {
                                    text: data.input,
                                    horseyId: localId
                                }
                            };
                            chrome.runtime.sendMessage(message, function(response) {
                                console.log("GOT RESPONSE : " + response);
                            });
                        }
                    })(),


                    filter(query, suggestion) {
                        console.log(query);
                        console.log(suggestion);
                        return suggestion;
                    },
                    set: (function(value) {
                        var _elem = elem;
                        return function(value) {
                            attrib = "";
                            if (_elem.tagName === "DIV") {
                                attrib = "textContent";
                            } else {
                                attrib = "value"
                            }

                            new_value = _elem[attrib].split(' ');
                            new_value.pop(); // Remove last elem
                            new_value.push(value);
                            _elem[attrib] = new_value.join(' ');
                        }
                    })(),
                    setAppends: true
                })
                horseyArr[i].horsey = horseyObj;
            }

        }


    }

    window.addEventListener("load", function(evt) {

        attachHorsey();

        var observerOptions = {
            childList: true,
            attributes: false,
            subtree: true
        }
        var observer = new MutationObserver(MutationCallback);
        observer.observe(document.body, observerOptions);

    }, false);

    chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
        console.log(message);
        console.log("OOOOOO");
        console.log(horseyArr);
        horseyArr[message.context.horseyId].done(null, [{
            list: message.context.predictions
        }]);
        horseyArr[message.context.horseyId].horsey.show();
    })


})();