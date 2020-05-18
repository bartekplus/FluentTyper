(function() {

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

    function checkLastError() {
        try {
            if (chrome.runtime.lastError) {
                console.log(chrome.runtime.lastError.message);
            }
        } catch (e) {};
    }

    function MutationCallback(mutationsList, observer) {
        var nodesAdded = false;
        for (let mutation of mutationsList) {
            if (mutation.type === 'childList') {
                for (let node of mutation.addedNodes) {
                    //console.log(node);
                    nodesAdded = true;
                }
                for (let node of mutation.removedNodes) {
                    //console.log(node);
                }

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

                if (isHelperAttached(tributeArr, elem)) {
                    continue;
                }
                helperArrId = tributeArr.length;

                tributeArr.push({
                    tribute: null,
                    elem: elem,
                    done: null,
                    timeout: null
                });

                elem.addEventListener("tribute-replaced", function(e) {
                    var x = elem;
                    //setTimeout((function() {
                    // Triger predition after replacing text, without user interacction
                    //e.target.dispatchEvent(new KeyboardEvent('keydown', { 'key': ' ' }));
                    //e.target.dispatchEvent(new KeyboardEvent('keyup', { 'key': ' ' }));
                    // }), 10);
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
                        var localId = helperArrId;
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
                                checkLastError();
                                tributeArr[localId].timeout = setTimeout((function() { return done([]); }), 1000);
                            });
                        }
                    })(),

                    // specify whether a space is required before the trigger string
                    requireLeadingSpace: false,

                    // specify whether a space is allowed in the middle of mentions
                    allowSpaces: false,

                    // optionally specify a custom suffix for the replace text
                    // (defaults to empty space if undefined)
                    replaceTextSuffix: '',

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
                tributeArr[helperArrId].tribute = tribute;
                tribute.attach(elem);

            }

        }
    }


    function initializeFluentTyper() {

        window.addEventListener("DOMContentLoaded", function(evt) {
            initializeFluentTyper();
        }, false);

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
        checkLastError();

        switch (message.command) {
            case "predictResp":
                keyValPairs = [];
                for (var i = 0; i < message.context.predictions.length; i++) {
                    keyValPairs.push({
                        key: message.context.predictions[i],
                        value: message.context.predictions[i]
                    })
                }
                if (tributeArr[message.context.tributeId].timeout) {
                    clearTimeout(tributeArr[message.context.tributeId].timeout);
                    tributeArr[message.context.tributeId].timeout = null;
                }
                tributeArr[message.context.tributeId].done(keyValPairs);
                break;
            default:
                console.log("Unknown message");
                console.log(message);
                break;
        }
    })



    function getConfig() {
        var message = {
            command: 'getConfig',
            context: {}
        };

        chrome.runtime.sendMessage(message, function(response) {
            checkLastError();

            if (response.context.enabled) {
                initializeFluentTyper();
            }
        });

    }

    getConfig();
})();