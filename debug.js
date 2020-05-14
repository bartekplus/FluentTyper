/*jslint browser:true */
/*jslint bitwise: true */

var DBG_L1 = 1;
var DBG_L2 = 2;
var DBG_L3 = 4;
var DBG_R = 8;
var DBG_S = 16;
var DBG_I = 32;
var DBG_E = 64;
var DBG_ALL = 65535;
var DBG_LEVEL = 0;
var TIME_START = null;
var pattern = /chrome-extension:\/\/[a-z.]+\//;


function getErrorObject() {
    try {
        throw Error('');
    } catch (err) {
        return err;
    }
}


function DBG1(args) {
    "use strict";
    if (DBG_LEVEL & DBG_L1) {
        var err = getErrorObject();
        var at = err.stack.split('\n')[4];
        at = at.replace(pattern, "");
        at = at.replace(/ /g, '');
        at = at.replace("at", "");
        //var caller = arguments.callee.caller.name.toString();
        console.log('' + at + ': ' + (args || ''));
    }
}

function DBG2(args) {
    "use strict";
    if (DBG_LEVEL & DBG_L2) {
        var err = getErrorObject();
        var at = err.stack.split('\n')[4];
        at = at.replace(pattern, "");
        at = at.replace(/ /g, '');
        at = at.replace("at", "");
        //var caller = arguments.callee.caller.name.toString();
        console.log('' + at + ': ' + (args || ''));
    }
}

function DBG3(args) {
    "use strict";
    if (DBG_LEVEL & DBG_L3) {
        var err = getErrorObject();
        var at = err.stack.split('\n')[4];
        at = at.replace(pattern, "");
        at = at.replace(/ /g, '');
        at = at.replace("at", "");
        //var caller = arguments.callee.caller.name.toString();
        console.log('>> ' + at + ': ' + (args || ''));
    }
}

function DBGS(args) {
    "use strict";
    if (DBG_LEVEL & DBG_S) {
        if (TIME_START) {
            console.log("DBS CALLED TWICE A ROW WITHOUT DBGR");
        }
        TIME_START = new Date();
        var err = getErrorObject();
        var at = err.stack.split('\n')[4];
        at = at.replace(pattern, "");
        at = at.replace(/ /g, '');
        at = at.replace("at", "");
        //var caller = arguments.callee.caller.name.toString();
        console.log('>> ' + at + ': ' + (args || ''));
    }
}

function DBGR(args) {
    "use strict";
    if (DBG_LEVEL & DBG_R) {
        var err = getErrorObject();
        var at = err.stack.split('\n')[4];
        at = at.replace(pattern, "");
        at = at.replace(/ /g, '');
        at = at.replace("at", "");
        //var caller = arguments.callee.caller.name.toString();
        var TIME_END = new Date();
        console.log('>> Time taken ' + (TIME_END - TIME_START) + 'ms ' + at + ': ' + (args || ''));
        TIME_START = null;
    }
}

function DBGI(args) {
    "use strict";
    if (DBG_LEVEL & DBG_I) {
        var err = getErrorObject();
        var at = err.stack.split('\n')[4];
        at = at.replace(pattern, "");
        at = at.replace(/ /g, '');
        at = at.replace("at", "");

        //var caller = arguments.callee.caller.name.toString();
        console.log('>> ' + at + ': ' + (args || ''));
    }
}

function DBGE(args) {
    "use strict";
    if (DBG_LEVEL & DBG_E) {
        var err = getErrorObject();
        var at = err.stack.split('\n')[4];
        at = at.replace(pattern, "");
        at = at.replace(/ /g, '');
        at = at.replace("at", "");
        //var caller = arguments.callee.caller.name.toString();
        console.log('>> ' + at + ': ' + (args || ''));
    }
}