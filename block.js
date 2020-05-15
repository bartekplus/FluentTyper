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

        selectors = ['textarea', 'input', '[contentEditable="true"]'];

        for (var selectorId = 0; selectorId < selectors.length; selectorId++) {

            elems = document.querySelectorAll(selectors[selectorId]);
            console.log(selectors[selectorId]);
            console.log(elems);
            for (var i = 0; i < elems.length; i++) {
                elem = elems[i];
                if (isHorseyAttached(elem)) {
                    continue;
                }
                if (elem.getAttribute("type") === "password") {
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

                    readInput: function(el) {
                        console.log("MYT TEXT INPUT \n");
                        console.log("input.selectionStart " + el.selectionStart);
                        console.log("input.selectionEnd " + el.selectionEnd);
                        inputStr = ""

                        if (el.selectionStart == el.selectionEnd) {
                            if (el.tagName === "DIV") {
                                attrib = "textContent";
                            } else {
                                attrib = "value"
                            }

                            inputStr = el[attrib].slice(0, el.selectionStart);
                            console.log(el[attrib]);
                            console.log(inputStr);

                        }

                        return inputStr;
                        return (textInput ? el.value : el.innerHTML).trim();
                    },

                    filter(query, suggestion) {
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

                            inputStrToSelection = _elem[attrib].slice(0, _elem.selectionStart);
                            inputStrFromSelection = _elem[attrib].slice(_elem.selectionStart);


                            new_value = inputStrToSelection.split(' ');
                            new_value.pop(); // Remove last elem
                            new_value.push(value + " "); // Add suggestion and space after it.
                            new_value = new_value.join(' ');
                            _elem[attrib] = new_value + inputStrFromSelection; // Concat it with rest of the input
                            // Update current position
                            _elem.selectionStart = new_value.length;
                            _elem.selectionEnd = new_value.length;
                        }
                    })(),
                    setAppends: true
                })
                horseyArr[horseyArrId].horsey = horseyObj;
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

        switch (message.command) {
            case "predictResp":
                horseyArr[message.context.horseyId].done(null, [{
                    list: message.context.predictions
                }]);
                break;
            default:
                console.log("Unknown message");
                console.log(message);
                break;
        }
    })
})();