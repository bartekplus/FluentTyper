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
	const chromeP =
		typeof window === 'object' &&
		(window.browser || new NestedProxy(window.chrome));

	const patternValidationRegex = /^(https?|wss?|file|ftp|\*):\/\/(\*|\*\.[^*/]+|[^*/]+)\/.*$|^file:\/\/\/.*$|^resource:\/\/(\*|\*\.[^*/]+|[^*/]+)\/.*$|^about:/;
	const isFirefox = typeof navigator === 'object' && navigator.userAgent.includes('Firefox/');
	function getRawRegex(matchPattern) {
	    if (!patternValidationRegex.test(matchPattern)) {
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
	    if (matchPatterns.includes('<all_urls>')) {
	        return /^(https?|file|ftp):[/]+/;
	    }
	    return new RegExp(matchPatterns.map(getRawRegex).join('|'));
	}

	async function isOriginPermitted(url) {
	    return chromeP.permissions.contains({
	        origins: [new URL(url).origin + '/*']
	    });
	}
	async function wasPreviouslyLoaded(tabId,frameId, loadCheck) {
	    const result = await chromeP.tabs.executeScript(tabId, {
	        code: loadCheck,
            frameId : frameId,
	        runAt: 'document_start'
	    });
	    return result === null || result === void 0 ? void 0 : result[0];
	}
	if (typeof chrome === 'object' && !chrome.contentScripts) {
	    chrome.contentScripts = {
	        async register(contentScriptOptions, callback) {
	            const { js = [], css = [], allFrames, matchAboutBlank, matches, runAt } = contentScriptOptions;
	            const loadCheck = `document[${JSON.stringify(JSON.stringify({ js, css }))}]`;
	            const matchesRegex = patternToRegex(...matches);
	            const listener = async ({tabId, frameId,
	             url }) => {
                
	                if (!url ||
	                    !matchesRegex.test(url) ||
	                    !await isOriginPermitted(url) ||
	                    await wasPreviouslyLoaded(tabId,frameId, loadCheck)
	                ) {
	                    if (url == "about:blank" && !matchAboutBlank)
	                    {
	                        return;
	                    }
	                }
                    chrome.tabs.executeScript(tabId, {
                        code: `${loadCheck} = true`,
                        runAt: "document_start",
                        frameId
                      });

	                for (const file of css) {
	                    chrome.tabs.insertCSS(tabId, {
	                        ...file,
	                        matchAboutBlank,
	                        allFrames: false,
                            frameId,
	                        runAt: runAt !== null && runAt !== void 0 ? runAt : 'document_start'
	                    });
	                }
	                for (const file of js) {
	                    chrome.tabs.executeScript(tabId, {
	                        ...file,
	                        matchAboutBlank,
	                        allFrames: false,
                            frameId,
	                        runAt
	                    });
	                }
	            };
	            chrome.webNavigation.onDOMContentLoaded.addListener(listener);
	            const registeredContentScript = {
	                async unregister() {
	                    chromeP.webNavigation.onDOMContentLoaded.removeListener(listener);
	                }
	            };
	            if (typeof callback === 'function') {
	                callback(registeredContentScript);
	            }
	            return Promise.resolve(registeredContentScript);
	        }
	    };
	}

	function getManifestPermissionsSync() {
	    return _getManifestPermissionsSync(chrome.runtime.getManifest());
	}
	function _getManifestPermissionsSync(manifest) {
	    var _a, _b;
	    const manifestPermissions = {
	        origins: [],
	        permissions: []
	    };
	    const list = new Set([
	        ...((_a = manifest.permissions) !== null && _a !== void 0 ? _a : []),
	        ...((_b = manifest.content_scripts) !== null && _b !== void 0 ? _b : []).flatMap(config => { var _a; return (_a = config.matches) !== null && _a !== void 0 ? _a : []; })
	    ]);
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
	async function _getAdditionalPermissions(manifestPermissions, currentPermissions, { strictOrigins = true } = {}) {
	    var _a, _b;
	    const additionalPermissions = {
	        origins: [],
	        permissions: []
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

	const registeredScripts = new Map();
	function convertPath(file) {
	    const url = new URL(file, location.origin);
	    return { file: url.pathname };
	}
	async function registerOnOrigins({ origins: newOrigins }) {
	    const manifest = chrome.runtime.getManifest().content_scripts;
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
