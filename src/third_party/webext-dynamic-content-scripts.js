(function () {
	'use strict';

	function NestedProxy(target) {
		return new Proxy(target, {
			get(target, prop) {
				if (typeof target[prop] !== 'function') {
					return new NestedProxy(target[prop]);
				}
				return (...arguments_) =>
					new Promise((resolve, reject) => {
						target[prop](...arguments_, result => {
							if (chrome.runtime.lastError) {
								reject(new Error(chrome.runtime.lastError.message));
							} else {
								resolve(result);
							}
						});
					});
			}
		});
	}
	const chromeP = globalThis.window?.chrome && new NestedProxy(window.chrome);

	const patternValidationRegex = /^(https?|wss?|file|ftp|\*):\/\/(\*|\*\.[^*/]+|[^*/]+)\/.*$|^file:\/\/\/.*$|^resource:\/\/(\*|\*\.[^*/]+|[^*/]+)\/.*$|^about:/;
	const isFirefox = typeof navigator === 'object' && navigator.userAgent.includes('Firefox/');
	const allStarsRegex = isFirefox ? /^(https?|wss?):[/][/][^/]+([/].*)?$/ : /^https?:[/][/][^/]+([/].*)?$/;
	const allUrlsRegex = /^(https?|file|ftp):[/]+/;
	function getRawRegex(matchPattern) {
	    if (!patternValidationRegex.test(matchPattern)) {
	        return [];
	        throw new Error(matchPattern + ' is an invalid pattern, it must match ' + String(patternValidationRegex));
	    }
	    let [, protocol, host, pathname] = matchPattern.split(/(^[^:]+:[/][/])([^/]+)?/);
	    protocol = protocol
	        .replace('*', isFirefox ? '(https?|wss?)' : 'https?')
	        .replace(/[/]/g, '[/]');
	    host = (host !== null && host !== void 0 ? host : '')
	        .replace(/^[*][.]/, '([^/]+.)*')
	        .replace(/^[*]$/, '[^/]+')
	        .replace(/[.]/g, '[.]')
	        .replace(/[*]$/g, '[^.]+');
	    pathname = pathname
	        .replace(/[/]/g, '[/]')
	        .replace(/[.]/g, '[.]')
	        .replace(/[*]/g, '.*');
	    return '^' + protocol + host + '(' + pathname + ')?$';
	}
	function patternToRegex(...matchPatterns) {
	    if (matchPatterns.length === 0) {
	        return /$./;
	    }
	    if (matchPatterns.includes('<all_urls>')) {
	        return allUrlsRegex;
	    }
	    if (matchPatterns.includes('*://*/*')) {
	        return allStarsRegex;
	    }
	    return new RegExp(matchPatterns.flatMap(x => getRawRegex(x)).join('|'));
	}

	const gotNavigation = typeof chrome === 'object' && 'webNavigation' in chrome;
	async function isOriginPermitted(url) {
	    return chromeP.permissions.contains({
	        origins: [new URL(url).origin + '/*']
	    });
	}
	async function wasPreviouslyLoaded(tabId, frameId, args) {
	    const loadCheck = (key) => {
	        const wasLoaded = document[key];
	        document[key] = true;
	        return wasLoaded;
	    };
	    const result = await chromeP.tabs.executeScript(tabId, {
	        frameId,
	        code: `(${loadCheck.toString()})(${JSON.stringify(args)})`
	    });
	    return result === null || result === void 0 ? void 0 : result[0];
	}
	async function registerContentScript$1(contentScriptOptions, callback) {
	    const { js = [], css = [], matchAboutBlank, matches, runAt } = contentScriptOptions;
	    let { allFrames } = contentScriptOptions;
	    if (gotNavigation) {
	        allFrames = false;
	    }
	    else if (allFrames) {
	        console.warn('`allFrames: true` requires the `webNavigation` permission to work correctly: https://github.com/fregante/content-scripts-register-polyfill#permissions');
	    }
	    const matchesRegex = patternToRegex(...matches);
	    const inject = async (url, tabId, frameId) => {
	        if (!matchesRegex.test(url) ||
	            !await isOriginPermitted(url) ||
	            await wasPreviouslyLoaded(tabId, frameId, { js, css })
	        ) {
	            return;
	        }
	        for (const file of css) {
	            void chrome.tabs.insertCSS(tabId, {
	                ...file,
	                matchAboutBlank,
	                allFrames,
	                frameId,
	                runAt: runAt !== null && runAt !== void 0 ? runAt : 'document_start'
	            });
	        }
	        for (const file of js) {
	            void chrome.tabs.executeScript(tabId, {
	                ...file,
	                matchAboutBlank,
	                allFrames,
	                frameId,
	                runAt
	            });
	        }
	    };
	    const tabListener = async (tabId, { status }, { url }) => {
	        if (status && url) {
	            void inject(url, tabId);
	        }
	    };
	    const navListener = async ({ tabId, frameId, url }) => {
	        void inject(url, tabId, frameId);
	    };
	    if (gotNavigation) {
	        chrome.webNavigation.onCommitted.addListener(navListener);
	    }
	    else {
	        chrome.tabs.onUpdated.addListener(tabListener);
	    }
	    const registeredContentScript = {
	        async unregister() {
	            if (gotNavigation) {
	                chrome.webNavigation.onCommitted.removeListener(navListener);
	            }
	            return Promise.resolve(registeredContentScript);
	        }
	    };
	    if (typeof callback === 'function') {
	        callback(registeredContentScript);
	    }
	    return registeredContentScript;
	}

	function getManifestPermissionsSync() {
	    return _getManifestPermissionsSync(chrome.runtime.getManifest());
	}
	function _getManifestPermissionsSync(manifest) {
	    var _a, _b, _c;
	    const manifestPermissions = {
	        origins: [],
	        permissions: [],
	    };
	    const list = new Set([
	        ...((_a = manifest.permissions) !== null && _a !== void 0 ? _a : []),
	        ...((_b = manifest.content_scripts) !== null && _b !== void 0 ? _b : []).flatMap(config => { var _a; return (_a = config.matches) !== null && _a !== void 0 ? _a : []; }),
	    ]);
	    if (manifest.devtools_page
	        && !((_c = manifest.optional_permissions) === null || _c === void 0 ? void 0 : _c.includes('devtools'))) {
	        list.add('devtools');
	    }
	    for (const permission of list) {
	        if (permission.includes('://')) {
	            manifestPermissions.origins.push(permission);
	        }
	        else {
	            manifestPermissions.permissions.push(permission);
	        }
	    }
	    return manifestPermissions;
	}
	const hostRegex = /:[/][/][*.]*([^/]+)/;
	function parseDomain(origin) {
	    return origin.split(hostRegex)[1];
	}
	async function getAdditionalPermissions(options) {
	    return new Promise(resolve => {
	        chrome.permissions.getAll(currentPermissions => {
	            const manifestPermissions = getManifestPermissionsSync();
	            resolve(_getAdditionalPermissions(manifestPermissions, currentPermissions, options));
	        });
	    });
	}
	function _getAdditionalPermissions(manifestPermissions, currentPermissions, { strictOrigins = true } = {}) {
	    var _a, _b;
	    const additionalPermissions = {
	        origins: [],
	        permissions: [],
	    };
	    for (const origin of (_a = currentPermissions.origins) !== null && _a !== void 0 ? _a : []) {
	        if (manifestPermissions.origins.includes(origin)) {
	            continue;
	        }
	        if (!strictOrigins) {
	            const domain = parseDomain(origin);
	            const isDomainInManifest = manifestPermissions.origins
	                .some(manifestOrigin => parseDomain(manifestOrigin) === domain);
	            if (isDomainInManifest) {
	                continue;
	            }
	        }
	        additionalPermissions.origins.push(origin);
	    }
	    for (const permission of (_b = currentPermissions.permissions) !== null && _b !== void 0 ? _b : []) {
	        if (!manifestPermissions.permissions.includes(permission)) {
	            additionalPermissions.permissions.push(permission);
	        }
	    }
	    return additionalPermissions;
	}

	var _a, _b, _c;
	const registeredScripts = new Map();
	const registerContentScript = (_c = (_b = (_a = globalThis === null || globalThis === void 0 ? void 0 : globalThis.browser) === null || _a === void 0 ? void 0 : _a.contentScripts) === null || _b === void 0 ? void 0 : _b.register) !== null && _c !== void 0 ? _c : registerContentScript$1;
	function convertPath(file) {
	    const url = new URL(file, location.origin);
	    return { file: url.pathname };
	}
	function injectIntoTab(tabId, scripts) {
	    for (const script of scripts) {
	        for (const file of script.css || []) {
	            void chrome.tabs.insertCSS(tabId, {
	                file,
	                allFrames: script.all_frames
	            });
	        }
	        for (const file of script.js || []) {
	            void chrome.tabs.executeScript(tabId, {
	                file,
	                allFrames: script.all_frames
	            });
	        }
	    }
	}
	function injectOnExistingTabs(origins, scripts) {
	    chrome.tabs.query({
	        url: origins
	    }, tabs => {
	        for (const tab of tabs) {
	            if (tab.id) {
	                injectIntoTab(tab.id, scripts);
	            }
	        }
	    });
	}
	async function registerOnOrigins({ origins: newOrigins }) {
	    const manifest = chrome.runtime.getManifest().content_scripts;
	    if (!manifest) {
	        // throw new Error('webext-dynamic-content-scripts tried to register scripts on th new host permissions, but no content scripts were found in the manifest.');
	    }
	    for (const origin of newOrigins || []) {
	        // for (const config of manifest) {
	            const registeredScript = chrome.contentScripts.register({
	                js: (["third_party/tribute/tribute.js", "cs.js"]).map(file => convertPath(file)),
	                css: ( ["third_party/tribute/tribute.css"]).map(file => convertPath(file)),
	                allFrames: true,
	                matches: [origin],
	                matchAboutBlank: true,
	                runAt: "document_idle"
	            });
	            registeredScripts.set(origin, registeredScript);
	        //}
	    }
	    injectOnExistingTabs(newOrigins || [], manifest);
	}
	(async () => {
	    void registerOnOrigins(await getAdditionalPermissions({
	        strictOrigins: false
	    }));
	})();
	chrome.permissions.onAdded.addListener(permissions => {
	    if (permissions.origins && permissions.origins.length > 0) {
	        void registerOnOrigins(permissions);
	    }
	});
	chrome.permissions.onRemoved.addListener(async ({ origins }) => {
	    if (!origins || origins.length === 0) {
	        return;
	    }
	    for (const [origin, script] of registeredScripts) {
	        if (origins.includes(origin)) {
	            void (await script).unregister();
	        }
	    }
	});

}());
