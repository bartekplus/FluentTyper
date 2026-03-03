//
// Copyright (c) 2021 Bartosz Tomczyk
// Copyright (c) 2011 Frank Kohlhepp
// https://github.com/bartekplus/fancier-settings
// License: MIT-license
//

import { manifest } from "../manifest.js";
import { getAliasesForCanonicalSettingKey } from "@core/domain/contracts/settings";

class chromeStorageBackend {
  constructor(useLocalBackend) {
    this.backend = useLocalBackend ? chrome.storage.local : chrome.storage.sync;
  }

  async get(key) {
    return new Promise((resolve, reject) => {
      try {
        this.backend.get(key, function (value) {
          resolve(value[key]);
        });
      } catch (ex) {
        reject(ex);
      }
    });
  }

  async set(key, value) {
    return new Promise((resolve, reject) => {
      try {
        this.backend.set({ [key]: value }, function () {
          const lastError = chrome.runtime?.lastError;
          if (lastError) {
            reject(lastError);
            return;
          }
          resolve();
        });
      } catch (ex) {
        reject(ex);
      }
    });
  }

  async remove(key) {
    return new Promise((resolve, reject) => {
      try {
        this.backend.remove(key, function () {
          resolve();
        });
      } catch (ex) {
        reject(ex);
      }
    });
  }

  async getAll(prefix) {
    return new Promise((resolve, reject) => {
      try {
        this.backend.get(null, function (values) {
          const result = {};
          for (const [key, value] of Object.entries(values)) {
            result[key.substring(prefix.length)] = value;
          }
          resolve(result);
        });
      } catch (ex) {
        reject(ex);
      }
    });
  }
}

class localStorageBackend {
  async get(key) {
    return new Promise((resolve, reject) => {
      try {
        const value = localStorage.getItem(key);
        resolve(value === null ? undefined : value);
      } catch (ex) {
        reject(ex);
      }
    });
  }

  async set(key, value) {
    return new Promise((resolve, reject) => {
      try {
        localStorage.setItem(key, value);
        resolve();
      } catch (ex) {
        reject(ex);
      }
    });
  }
  async remove(key) {
    return new Promise((resolve, reject) => {
      try {
        localStorage.removeItem(key);
        resolve();
      } catch (ex) {
        reject(ex);
      }
    });
  }
  async getAll(prefix) {
    return new Promise((resolve, reject) => {
      try {
        const values = {};
        for (let i = localStorage.length - 1; i >= 0; i--) {
          if (localStorage.key(i).substring(0, prefix.length) === prefix) {
            const key = localStorage.key(i);
            const value = localStorage.getItem(key);
            if (value !== undefined) {
              values[key.substring(prefix.length)] = value;
            }
          }
        }
        resolve(values);
      } catch (ex) {
        reject(ex);
      }
    });
  }
}

class Store {
  constructor(storageName, defaults, useLocalBackend = true) {
    this.storageName = storageName;
    this.storageBackend = chrome.storage
      ? new chromeStorageBackend(useLocalBackend)
      : new localStorageBackend();
    this.initializationPromise = this.initializeDefaults(defaults);
  }

  buildKey(name) {
    return "store." + this.storageName + "." + name;
  }

  static serializeValue(value) {
    if (typeof value === "function") {
      return null;
    }
    try {
      return JSON.stringify(value);
    } catch (e) {
      return null;
    }
  }

  async getStoredValue(name) {
    const value = await this.storageBackend.get(this.buildKey(name));
    if (value !== undefined) {
      try {
        return JSON.parse(value);
      } catch (e) {
        return undefined;
      }
    }
    return undefined;
  }

  async setStoredValue(name, value) {
    const serializedValue = Store.serializeValue(value);
    await this.storageBackend.set(this.buildKey(name), serializedValue);
  }

  async initializeDefaults(defaults) {
    const defaultEntries = [];
    if (defaults !== undefined) {
      defaultEntries.push(...Object.entries(defaults));
    } else if (manifest && Array.isArray(manifest.settings)) {
      for (const setting of manifest.settings) {
        if (Object.prototype.hasOwnProperty.call(setting, "default")) {
          defaultEntries.push([setting.name, setting.default]);
        }
      }
    }

    if (defaultEntries.length === 0) {
      return;
    }

    const storedValues = await this.storageBackend.getAll(this.buildKey(""));
    const writes = [];
    for (const [key, value] of defaultEntries) {
      const rawStoredValue = storedValues[key];
      if (rawStoredValue === undefined) {
        const aliases = getAliasesForCanonicalSettingKey(key);
        let hasValidAliasValue = false;
        for (const aliasKey of aliases) {
          const rawAliasValue = storedValues[aliasKey];
          if (rawAliasValue === undefined) {
            continue;
          }
          try {
            JSON.parse(rawAliasValue);
            hasValidAliasValue = true;
            break;
          } catch (e) {
            // Ignore invalid alias payload and continue fallback checks.
          }
        }
        if (hasValidAliasValue) {
          continue;
        }
        writes.push(this.setStoredValue(key, value));
        continue;
      }
      try {
        JSON.parse(rawStoredValue);
      } catch (e) {
        writes.push(this.setStoredValue(key, value));
      }
    }
    await Promise.all(writes);
  }

  async get(name) {
    await this.initializationPromise;
    return this.getStoredValue(name);
  }

  async set(name, value) {
    await this.initializationPromise;
    if (value === undefined) {
      await this.remove(name);
      return;
    }
    await this.setStoredValue(name, value);
  }

  async remove(name) {
    await this.initializationPromise;
    await this.storageBackend.remove(this.buildKey(name));
  }

  async getAll() {
    await this.initializationPromise;
    return this.storageBackend.getAll(this.buildKey(""));
  }
}

export { Store };
