(function() {

    const useHorsey = false;
    horseyArr = [];
    tributeArr = [];
    observer = null;

    function isHelperAttached(helperArr, elem) {
        for (var i = 0; i < helperArr.length; i++) {
            if (elem == helperArr[i].elem) {
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
            attachHelper();
        }
    };


    function attachHelper() {

        selectors = ['textarea', 'input', '[contentEditable="true"]'];

        for (var selectorId = 0; selectorId < selectors.length; selectorId++) {

            elems = document.querySelectorAll(selectors[selectorId]);
            for (var i = 0; i < elems.length; i++) {
                elem = elems[i];

                if (elem.getAttribute("type") === "password") {
                    continue;
                }

                if (useHorsey) {

                    if (isHelperAttached(horseyArr, elem)) {
                        continue;
                    }
                    horseyArrId = horseyArr.length;
                    horseyArr.push({
                        horsey: null,
                        done: null,
                        elem: elem
                    });
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
                            inputStr = ""

                            if (el.selectionStart == el.selectionEnd) {
                                if (el.tagName === "DIV") {
                                    attrib = "textContent";
                                } else {
                                    attrib = "value"
                                }

                                inputStr = el[attrib].slice(0, el.selectionStart);
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
                } else {
                    if (isHelperAttached(tributeArr, elem)) {
                        continue;
                    }
                    tributeArrId = tributeArr.length;
                    tributeArr.push({
                        tribute: null,
                        elem: elem,
                        done: null
                    });

                    var tribute = new Tribute({
                        // symbol or string that starts the lookup
                        trigger: "",

                        // element to target for @mentions
                        iframe: null,

                        // class added in the flyout menu for active item
                        selectClass: 'highlight',

                        // class added to the menu container
                        containerClass: 'tribute-container',

                        // class added to each list item
                        itemClass: '',

                        // function called on select that returns the content to insert
                        selectTemplate: function(item) {
                            return item.original.value;
                        },

                        // template for displaying item in menu
                        menuItemTemplate: function(item) {
                            return item.string;
                        },

                        // template for when no match is found (optional),
                        // If no template is provided, menu is hidden.
                        noMatchTemplate: "",

                        // specify an alternative parent container for the menu
                        // container must be a positioned element for the menu to appear correctly ie. `position: relative;`
                        // default container is the body
                        menuContainer: document.body,

                        // column to search against in the object (accepts function or string)
                        lookup: 'key',

                        // column that contains the content to insert by default
                        fillAttr: 'value',

                        // REQUIRED: array of objects to match
                        values: (function(data, done) {
                            var localId = tributeArrId;
                            return function(data, done) {
                                tributeArr[localId].done = done;
                                var message = {
                                    command: 'predictReq',
                                    context: {
                                        text: data,
                                        tributeId: localId
                                    }
                                };
                                chrome.runtime.sendMessage(message, function(response) {
                                    //console.log("GOT RESPONSE : " + response);
                                });
                            }
                        })(),

                        // specify whether a space is required before the trigger string
                        requireLeadingSpace: false,

                        // specify whether a space is allowed in the middle of mentions
                        allowSpaces: false,

                        // optionally specify a custom suffix for the replace text
                        // (defaults to empty space if undefined)
                        replaceTextSuffix: ' ',

                        // specify whether the menu should be positioned.  Set to false and use in conjuction with menuContainer to create an inline menu
                        // (defaults to true)
                        positionMenu: true,

                        // when the spacebar is hit, select the current match
                        spaceSelectsMatch: false,

                        // turn tribute into an autocomplete
                        autocompleteMode: true,

                        // Customize the elements used to wrap matched strings within the results list
                        // defaults to <span></span> if undefined
                        searchOpts: {
                            pre: '<span>',
                            post: '</span>',
                            skip: false // true will skip local search, useful if doing server-side search
                        },

                        // specify the minimum number of characters that must be typed before menu appears
                        menuShowMinLength: 0
                    });
                    tributeArr[tributeArrId].tribute = tribute;
                    tribute.attach(elem);
                }
            }

        }
    }


    function initializeFluentBoard() {

        attachHelper();
        if (!observer) {
            var observerOptions = {
                childList: true,
                attributes: false,
                subtree: true
            }
            observer = new MutationObserver(MutationCallback);
            observer.observe(document.body, observerOptions);
        }
    }



    chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
        switch (message.command) {
            case "predictResp":
                if (useHorsey) {
                    horseyArr[message.context.horseyId].done(null, [{
                        list: message.context.predictions
                    }]);
                } else {
                    x = [];
                    for (var i = 0; i < message.context.predictions.length; i++) {
                        x.push({
                            key: message.context.predictions[i],
                            value: message.context.predictions[i]
                        })
                    }

                    tributeArr[message.context.tributeId].done(x);
                }
                break;
            default:
                console.log("Unknown message");
                console.log(message);
                break;
        }
    })

    window.addEventListener("DOMContentLoaded", function(evt) {
        initializeFluentBoard();
    }, false);
    initializeFluentBoard();

})();