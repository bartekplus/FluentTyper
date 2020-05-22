//
// Copyright (c) 2011 Frank Kohlhepp
// https://github.com/frankkohlhepp/store-js
// License: MIT-license
//

import { manifest } from "../manifest.js";

var Store = function (name, defaults) {
  var key;
  this.name = name;

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
    for (var idx = 0; idx < manifest.settings.length; idx++) {
      var val = Object.prototype.hasOwnProperty.call(
        manifest.settings[idx],
        "default"
      );
      key = manifest.settings[idx].name;

      if (val && this.get(key) === undefined) {
        this.set(key, manifest.settings[idx].default);
      }
    }
  }
};

Store.prototype.get = function (name) {
  name = "store." + this.name + "." + name;
  if (localStorage.getItem(name) === null) {
    return undefined;
  }
  try {
    return JSON.parse(localStorage.getItem(name));
  } catch (e) {
    return null;
  }
};

Store.prototype.set = function (name, value) {
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

    localStorage.setItem("store." + this.name + "." + name, value);
  }

  return this;
};

Store.prototype.remove = function (name) {
  localStorage.removeItem("store." + this.name + "." + name);
  return this;
};

Store.prototype.removeAll = function () {
  var name, i;

  name = "store." + this.name + ".";
  for (i = localStorage.length - 1; i >= 0; i--) {
    if (localStorage.key(i).substring(0, name.length) === name) {
      localStorage.removeItem(localStorage.key(i));
    }
  }

  return this;
};

Store.prototype.toObject = function () {
  var values, name, i, key, value;

  values = {};
  name = "store." + this.name + ".";
  for (i = localStorage.length - 1; i >= 0; i--) {
    if (localStorage.key(i).substring(0, name.length) === name) {
      key = localStorage.key(i).substring(name.length);
      value = this.get(key);
      if (value !== undefined) {
        values[key] = value;
      }
    }
  }

  return values;
};

Store.prototype.fromObject = function (values, merge) {
  if (merge !== true) {
    this.removeAll();
  }
  for (var key in values) {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      this.set(key, values[key]);
    }
  }

  return this;
};

export { Store };
