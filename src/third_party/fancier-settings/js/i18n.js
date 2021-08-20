//
// Copyright (c) 2021 Bartosz Tomczyk
// Copyright (c) 2011 Frank Kohlhepp
// License: LGPL v2.1
//

class I18n {
  constructor() {
    this.lang = navigator.language.split("-")[0];
  }

  get(value) {
    if (value === "lang") {
      return this.lang;
    }

    if (I18n.prototype.hasOwnProperty.call(this, value)) {
      value = this[value];
      if (I18n.prototype.hasOwnProperty.call(this.lang)) {
        return value[this.lang];
      } else if (I18n.prototype.hasOwnProperty.call("en")) {
        return value.en;
      } else {
        return Object.values(value)[0];
      }
    } else {
      return value;
    }
  }
}

export { I18n };
