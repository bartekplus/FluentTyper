//
// Copyright (c) 2011 Frank Kohlhepp
// https://github.com/frankkohlhepp/fancy-settings
// License: LGPL v2.1
//

// Defines in mootools-core.js
/* global Events, typeOf */

import { Store } from "../../lib/store.js";

const settings = new Store("settings");
class Bundle extends Events {
  // Attributes:
  // - tab
  // - group
  // - name
  // - type
  //
  // Methods:
  //  - constructor
  //  - createDOM
  //  - setupDOM
  //  - addEvents
  //  - get
  //  - set
  // Implements: Events;

  constructor(params) {
    super(params);
    this.params = params;
    this.params.searchString =
      "•" + this.params.tab + "•" + this.params.group + "•";

    this.createDOM();
    this.setupDOM();
    this.addEvents();

    if (this.params.name !== undefined) {
      this.set(settings.get(this.params.name), true);
    }

    this.params.searchString = this.params.searchString.toLowerCase();
  }

  addEvents() {
    this.element.addEvent(
      "change",
      function (event) {
        if (this.params.name !== undefined) {
          settings.set(this.params.name, this.get());
        }

        this.fireEvent("action", this.get());
      }.bind(this)
    );
  }

  get() {
    return this.element.get("value");
  }

  set(value, noChangeEvent) {
    this.element.set("value", value);

    if (noChangeEvent !== true) {
      this.element.fireEvent("change");
    }

    return this;
  }
}

class Description extends Bundle {
  // text

  constructor(params) {
    super(params);
    this.params = params;
    this.params.searchString = "";

    this.createDOM();
    this.setupDOM();
  }

  createDOM() {
    this.bundle = new Element("div", {
      class: "setting bundle description",
    });

    this.container = new Element("div", {
      class: "setting container description",
    });

    this.element = new Element("p", {
      class: "setting element description",
    });
  }

  setupDOM() {
    if (this.params.text !== undefined) {
      this.element.set("html", this.params.text);
    }

    this.element.inject(this.container);
    this.container.inject(this.bundle);
  }
}

class Button extends Bundle {
  // label, text
  // action -> click

  constructor(params) {
    super(params);
    this.params = params;
    this.params.searchString =
      "•" + this.params.tab + "•" + this.params.group + "•";

    this.createDOM();
    this.setupDOM();
    this.addEvents();

    this.params.searchString = this.params.searchString.toLowerCase();
  }

  createDOM() {
    this.bundle = new Element("div", {
      class: "setting bundle button",
    });

    this.container = new Element("div", {
      class: "setting container button",
    });

    this.element = new Element("input", {
      class: "setting element button",
      type: "button",
    });

    this.label = new Element("label", {
      class: "setting label button",
    });
  }

  setupDOM() {
    if (this.params.label !== undefined) {
      this.label.set("html", this.params.label);
      this.label.inject(this.container);
      this.params.searchString += this.params.label + "•";
    }

    if (this.params.text !== undefined) {
      this.element.set("value", this.params.text);
      this.params.searchString += this.params.text + "•";
    }

    this.element.inject(this.container);
    this.container.inject(this.bundle);
  }

  addEvents() {
    this.element.addEvent(
      "click",
      function () {
        this.fireEvent("action");
      }.bind(this)
    );
  }
}

class Text extends Bundle {
  // label, text, masked
  // action -> change & keyup

  createDOM() {
    this.bundle = new Element("div", {
      class: "setting bundle text",
    });

    this.container = new Element("div", {
      class: "setting container text",
    });

    if (this.params.colorPicker === true) {
      this.element = new Element("input", {
        class: "color",
        type: "text",
      });
    } else {
      this.element = new Element("input", {
        class: "setting element text",
        type: "text",
      });
    }

    this.label = new Element("label", {
      class: "setting label text",
    });
  }

  setupDOM() {
    if (this.params.label !== undefined) {
      this.label.set("html", this.params.label);
      this.label.inject(this.container);
      this.params.searchString += this.params.label + "•";
    }

    if (this.params.text !== undefined) {
      this.element.set("placeholder", this.params.text);
      this.params.searchString += this.params.text + "•";
    }

    if (this.params.masked === true) {
      this.element.set("type", "password");
      this.params.searchString += "password" + "•";
    }

    this.element.inject(this.container);
    this.container.inject(this.bundle);
  }

  addEvents() {
    const change = function (event) {
      if (this.params.name !== undefined) {
        if (this.params.store !== false) {
          settings.set(this.params.name, this.get());
        }
      }

      this.fireEvent("action", this.get());
    }.bind(this);

    this.element.addEvent("change", change);
    this.element.addEvent("keyup", change);
  }
}

class Checkbox extends Bundle {
  // label
  // action -> change

  createDOM() {
    this.bundle = new Element("div", {
      class: "setting bundle checkbox",
    });

    this.container = new Element("div", {
      class: "setting container checkbox",
    });

    this.element = new Element("input", {
      id: String.uniqueID(),
      class: "setting element checkbox",
      type: "checkbox",
      value: "true",
    });

    this.label = new Element("label", {
      class: "setting label checkbox",
      for: this.element.get("id"),
    });
  }

  setupDOM() {
    this.element.inject(this.container);
    this.container.inject(this.bundle);

    if (this.params.label !== undefined) {
      this.label.set("html", this.params.label);
      this.label.inject(this.container);
      this.params.searchString += this.params.label + "•";
    }
  }

  get() {
    return this.element.get("checked");
  }

  set(value, noChangeEvent) {
    this.element.set("checked", value);

    if (noChangeEvent !== true) {
      this.element.fireEvent("change");
    }

    return this;
  }
}

class Slider extends Bundle {
  // label, max, min, step, display, displayModifier
  // action -> change

  constructor(params) {
    super(params);
    this.params = params;
    this.params.searchString =
      "•" + this.params.tab + "•" + this.params.group + "•";

    this.createDOM();
    this.setupDOM();
    this.addEvents();

    if (this.params.name !== undefined) {
      this.set(settings.get(this.params.name) || 0, true);
    } else {
      this.set(0, true);
    }

    this.params.searchString = this.params.searchString.toLowerCase();
  }

  createDOM() {
    this.bundle = new Element("div", {
      class: "setting bundle slider",
    });

    this.container = new Element("div", {
      class: "setting container slider",
    });

    this.element = new Element("input", {
      class: "setting element slider",
      type: "range",
    });

    this.label = new Element("label", {
      class: "setting label slider",
    });

    this.display = new Element("span", {
      class: "setting display slider",
    });
  }

  setupDOM() {
    if (this.params.label !== undefined) {
      this.label.set("html", this.params.label);
      this.label.inject(this.container);
      this.params.searchString += this.params.label + "•";
    }

    if (this.params.max !== undefined) {
      this.element.set("max", this.params.max);
    }

    if (this.params.min !== undefined) {
      this.element.set("min", this.params.min);
    }

    if (this.params.step !== undefined) {
      this.element.set("step", this.params.step);
    }

    this.element.inject(this.container);
    if (this.params.display === true) {
      if (this.params.displayModifier !== undefined) {
        this.display.set("text", this.params.displayModifier(0));
      } else {
        this.display.set("text", 0);
      }
      this.display.inject(this.container);
    }
    this.container.inject(this.bundle);
  }

  addEvents() {
    this.element.addEvent(
      "input",
      function (event) {
        if (this.params.name !== undefined) {
          settings.set(this.params.name, this.get());
        }

        if (this.params.displayModifier !== undefined) {
          this.display.set("text", this.params.displayModifier(this.get()));
        } else {
          this.display.set("text", this.get());
        }
        this.fireEvent("action", this.get());
      }.bind(this)
    );
  }

  get() {
    return Number.from(this.element.get("value"));
  }

  set(value, noChangeEvent) {
    this.element.set("value", value);

    if (noChangeEvent !== true) {
      this.element.fireEvent("change");
    } else {
      if (this.params.displayModifier !== undefined) {
        this.display.set(
          "text",
          this.params.displayModifier(Number.from(value))
        );
      } else {
        this.display.set("text", Number.from(value));
      }
    }

    return this;
  }
}

class PopupButton extends Bundle {
  // label, options[{value, text}]
  // action -> change

  createDOM() {
    this.bundle = new Element("div", {
      class: "setting bundle popup-button",
    });

    this.container = new Element("div", {
      class: "setting container popup-button",
    });

    this.element = new Element("select", {
      class: "setting element popup-button",
    });

    this.label = new Element("label", {
      class: "setting label popup-button",
    });

    if (this.params.options === undefined) {
      return;
    }

    // convert array syntax into object syntax for options
    function arrayToObject(option) {
      if (typeOf(option) === "array") {
        option = {
          value: option[0],
          text: option[1] || option[0],
        };
      }
      return option;
    }

    // convert arrays
    if (typeOf(this.params.options) === "array") {
      const values = [];
      this.params.options.each(
        function (values, option) {
          values.push(arrayToObject(option));
        }.bind(this, values)
      );
      this.params.options = {
        values: values,
      };
    }

    let groups;
    if (this.params.options.groups !== undefined) {
      groups = {};
      this.params.options.groups.each(
        function (groups, group) {
          this.params.searchString += group + "•";
          groups[group] = new Element("optgroup", {
            label: group,
          }).inject(this.element);
        }.bind(this, groups)
      );
    }

    if (this.params.options.values !== undefined) {
      this.params.options.values.each(
        function (groups, option) {
          option = arrayToObject(option);
          this.params.searchString += (option.text || option.value) + "•";

          // find the parent of this option - either a group or the main element
          let parent;
          if (option.group && this.params.options.groups) {
            if (option.group - 1 in this.params.options.groups) {
              option.group = this.params.options.groups[option.group - 1];
            }
            if (option.group in groups) {
              parent = groups[option.group];
            } else {
              parent = this.element;
            }
          } else {
            parent = this.element;
          }

          new Element("option", {
            value: option.value,
            text: option.text || option.value,
          }).inject(parent);
        }.bind(this, groups)
      );
    }
  }

  setupDOM() {
    if (this.params.label !== undefined) {
      this.label.set("html", this.params.label);
      this.label.inject(this.container);
      this.params.searchString += this.params.label + "•";
    }

    this.element.inject(this.container);
    this.container.inject(this.bundle);
  }
}

class ListBox extends PopupButton {
  // label, options[{value, text}]
  // action -> change

  add(domainURL) {
    if (this.params.options.indexOf(domainURL) === -1) {
      this.params.options.push(domainURL);
      const elem = new Element("option", {
        value: domainURL,
        text: domainURL,
      });
      elem.inject(this.element);
      settings.set(this.params.name, this.params.options);
    }
  }

  remove() {
    if (this.selected) {
      const idx = this.params.options.indexOf(
        this.selected.get("value").toString()
      );
      if (idx !== -1) {
        this.params.options.splice(idx, 1);
        settings.set(this.params.name, this.params.options);
        this.selected.dispose();
        this.selected = null;
      }
    }
  }

  addEvents() {
    const change = function (event) {
      if (this.params.name !== undefined) {
        this.selected = this.element.getSelected();
        // settings.set(this.params.names, this.get());
      }
      // this.fireEvent("action", this.get());
    }.bind(this);

    this.element.addEvent("change", change);
  }

  setupDOM() {
    this.selected = null;
    this.params.options = [];

    let initParams = settings.get(this.params.name);
    if (initParams) {
      this.params.options = initParams;
    }
    try {
      this.params.options.every(
        function (option) {
          if (option) {
            // this.params.searchString += (option) + "•";

            new Element("option", {
              value: option,
              text: option,
            }).inject(this.element);
          }
          return true;
        }.bind(this)
      );
    } catch (e) {}

    this.element.inject(this.container);
    this.container.inject(this.bundle);
  }

  createDOM() {
    this.bundle = new Element("div", {
      class: "setting bundle list-box",
    });

    this.container = new Element("div", {
      class: "setting container list-box",
    });

    this.element = new Element("select", {
      class: "setting element list-box",
      size: "2",
    });

    this.label = new Element("label", {
      class: "setting label list-box",
    });
    if (this.params.options === undefined) {
      return;
    }
    this.params.options.every(
      function (option) {
        // this.params.searchString += (option) + "•";

        new Element("option", {
          value: option,
          text: option,
        }).inject(this.element);
        return true;
      }.bind(this)
    );
  }

  set() {
    // Do notohing for set - get selected elemenent on keydown event
    // settings.set(this.params.name, this.params.options.join("|@|"));
  }

  get() {
    return this.params.options;
    //            return (this.element.get("value") || undefined);
  }
}

class RadioButtons extends Bundle {
  // label, options[{value, text}]
  // action -> change

  createDOM() {
    const settingID = String.uniqueID();

    this.bundle = new Element("div", {
      class: "setting bundle radio-buttons",
    });

    this.label = new Element("label", {
      class: "setting label radio-buttons",
    });

    this.containers = [];
    this.elements = [];
    this.labels = [];

    if (this.params.options === undefined) {
      return;
    }
    this.params.options.each(
      function (option) {
        this.params.searchString += (option[1] || option[0]) + "•";

        const optionID = String.uniqueID();
        const container = new Element("div", {
          class: "setting container radio-buttons",
        }).inject(this.bundle);
        this.containers.push(container);

        this.elements.push(
          new Element("input", {
            id: optionID,
            name: settingID,
            class: "setting element radio-buttons",
            type: "radio",
            value: option[0],
          }).inject(container)
        );

        this.labels.push(
          new Element("label", {
            class: "setting element-label radio-buttons",
            for: optionID,
            text: option[1] || option[0],
          }).inject(container)
        );
      }.bind(this)
    );
  }

  setupDOM() {
    if (this.params.label !== undefined) {
      this.label.set("html", this.params.label);
      this.label.inject(this.bundle, "top");
      this.params.searchString += this.params.label + "•";
    }
  }

  addEvents() {
    this.bundle.addEvent(
      "change",
      function (event) {
        if (this.params.name !== undefined) {
          settings.set(this.params.name, this.get());
        }

        this.fireEvent("action", this.get());
      }.bind(this)
    );
  }

  get() {
    const checkedEl = this.elements.filter(function (el) {
      return el.get("checked");
    });
    return checkedEl[0] && checkedEl[0].get("value");
  }

  set(value, noChangeEvent) {
    const desiredEl = this.elements.filter(function (el) {
      return el.get("value") === value;
    });
    desiredEl[0] && desiredEl[0].set("checked", true);

    if (noChangeEvent !== true) {
      this.bundle.fireEvent("change");
    }

    return this;
  }
}

class Setting {
  constructor(container) {
    this.container = container;
  }

  create(params) {
    // Available types
    const types = {
      description: Description,
      button: Button,
      text: Text,
      checkbox: Checkbox,
      slider: Slider,
      popupButton: PopupButton,
      listBox: ListBox,
      radioButtons: RadioButtons,
    };

    if (Object.prototype.hasOwnProperty.call(types, params.type)) {
      const bundle = new types[params.type](params);
      bundle.bundleContainer = this.container;
      bundle.bundle.inject(this.container);
      return bundle;
    } else {
      throw new Error("invalidType");
    }
  }
}

export { Setting };
