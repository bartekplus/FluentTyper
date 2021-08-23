//
// Copyright (c) 2021 Bartosz Tomczyk
// Copyright (c) 2011 Frank Kohlhepp
// https://github.com/bartekplus/fancier-settings
// License: MIT-license
//

import { manifest } from "../manifest.js";

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
    new Promise((resolve, reject) => {
      try {
        this.backend.set({ [key]: value }, function () {
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
    new Promise((resolve, reject) => {
      try {
        resolve(localStorage.setItem(key, value));
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
  constructor(storageName, defaults, useLocalBackend = false) {
    this.storageName = storageName;
    this.storageBackend = chrome.storage
      ? new chromeStorageBackend(useLocalBackend)
      : new localStorageBackend();
    let key;

    if (defaults !== undefined) {
      for (key in defaults) {
        if (
          Object.prototype.hasOwnProperty.call(defaults, key) &&
          this.get(key) === undefined
        ) {
          this.set(key, defaults[key]);
        }
      }
    } else if (manifest) {
      for (let idx = 0; idx < manifest.settings.length; idx++) {
        const val = Object.prototype.hasOwnProperty.call(
          manifest.settings[idx],
          "default"
        );
        key = manifest.settings[idx].name;
        const promise = this.get(key);
        promise.then(
          function (key, storageVal) {
            if (val && storageVal === undefined) {
              this.set(key, manifest.settings[idx].default);
            }
          }.bind(this, key)
        );
      }
    }
  }

  buildKey(name) {
    return "store." + this.storageName + "." + name;
  }

  async get(name) {
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

  set(name, value) {
    if (value === undefined) {
      this.remove(name);
    } else {
      if (typeof value === "function") {
        value = null;
      } else {
        try {
          value = JSON.stringify(value);
        } catch (e) {
          value = null;
        }
      }
      this.storageBackend.set(this.buildKey(name), value);
    }

    return this;
  }

  remove(name) {
    this.storageBackend.remove(this.buildKey(name));
    return this;
  }

  async getAll() {
    return this.storageBackend.getAll(this.buildKey(""));
  }
}

export { Store };
