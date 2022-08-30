//
// Copyright (c) 2021 Bartosz Tomczyk
// Copyright (c) 2011 Frank Kohlhepp
// https://github.com/bartekplus/fancier-settings
// License: LGPL v2.1
//

import { Store } from "../../lib/store.js";
import { Events, ElementWrapper, getUniqueID } from "./utils.js";

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
    this.bundle = new ElementWrapper("div", {});

    this.createDOM();
    this.setupDOM();
    this.addEvents();

    if (this.params.name !== undefined) {
      const promise = settings.get(this.params.name);
      promise
        .then((value) => {
          if (value !== undefined) this.set(value, true);
        })
        .catch(function (e) {
          console.error(e);
        });
    }
  }
  createDOM() {}
  setupDOM() {}

  addEvents() {
    if (this.element) {
      this.element.addEvent(
        "change",
        function () {
          if (this.params.name !== undefined) {
            settings.set(this.params.name, this.get());
          }

          this.fireEvent("action", this.get());
        }.bind(this)
      );
    }
  }

  get() {
    return this.element.get("value");
  }

  set(value, noChangeEvent) {
    if (this.element) {
      this.element.set("value", value);

      if (noChangeEvent !== true) {
        this.element.fireEvent("change");
      }
    }

    return this;
  }
}

class Description extends Bundle {
  // text

  constructor(params) {
    super(params);
    this.params = params;

    this.createDOM();
    this.setupDOM();
  }

  createDOM() {
    this.bundle = new ElementWrapper("div", {});

    this.container = new ElementWrapper("div", {});

    this.element = new ElementWrapper("p", {});
  }

  setupDOM() {
    if (this.params.text !== undefined) {
      this.element.set("innerHTML", this.params.text);
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

    this.createDOM();
    this.setupDOM();
    this.addEvents();
  }

  createDOM() {
    this.bundle = new ElementWrapper("div", {
      class: "field",
    });

    this.container = new ElementWrapper("div", {
      class: "control",
    });

    this.element = new ElementWrapper("input", {
      class: "button is-primary is-outlined",
      type: "button",
    });

    this.label = new ElementWrapper("label", {
      class: "label",
    });
  }

  setupDOM() {
    if (this.params.label !== undefined) {
      this.label.set("innerHTML", this.params.label);
      this.label.inject(this.container);
    }

    if (this.params.text !== undefined) {
      this.element.set("value", this.params.text);
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

class ModalButton extends Button {
  // label, text
  // action -> click

  constructor(params) {
    super(params);
    this.params = params;

    this.createDOM();
    this.setupDOM();
    this.addEvents();
  }

  createDOM() {
    super.createDOM();

    //-- add modal specific DOM creation
    this.modalBackdrop = new ElementWrapper("div", {
      class: "container is-hidden",
    });

    this.modalContainer = new ElementWrapper("div", {
      class: "field",
    });

    this.modalTitle = new ElementWrapper("h2", {
      class: "subtitle",
    });

    this.modalDone = new ElementWrapper("input", {
      class: "button is-primary is-outlined",
    });
  }

  setupDOM() {
    //-- add modal specific DOM setup
    super.setupDOM();
    if (this.params.modal.title !== undefined) {
      this.modalTitle.set("html", this.params.modal.title);
      this.modalTitle.inject(this.modalContainer);
    }

    this.modalContainer.inject(this.modalBackdrop);
    this.modalBackdrop.inject(this.container);

    this.params.modal.contents.forEach(
      function (item) {
        new Setting(this.modalContainer).create(item);
      }.bind(this)
    );

    this.modalDone.set("value", "Done");
    this.modalDone.inject(this.modalContainer);
  }

  addEvents() {
    //-- add model specific events
    if (this.element) {
      this.element.addEvent(
        "click",
        function () {
          this.modalBackdrop.element.classList.remove("is-hidden");
        }.bind(this)
      );

      this.modalDone.addEvent(
        "click",
        function () {
          this.modalBackdrop.element.classList.add("is-hidden");
          this.fireEvent("modal_done");
        }.bind(this)
      );
    }
  }
}

class Text extends Bundle {
  // label, text, masked
  // action -> change & keyup

  createDOM() {
    this.bundle = new ElementWrapper("div", {
      class: "field",
    });

    this.container = new ElementWrapper("div", {
      class: "control",
    });

    if (this.params.colorPicker === true) {
      this.element = new ElementWrapper("input", {
        class: "color",
        type: "text",
      });
    } else {
      this.element = new ElementWrapper("input", {
        class: "input",
        type: "text",
      });
    }

    this.label = new ElementWrapper("label", {
      class: "label",
    });
  }

  setupDOM() {
    if (this.params.label !== undefined) {
      this.label.set("innerHTML", this.params.label);
      this.label.inject(this.container);
    }

    if (this.params.text !== undefined) {
      this.element.set("placeholder", this.params.text);
    }

    if (this.params.masked === true) {
      this.element.set("type", "password");
    }

    if (this.params.subtype !== undefined) {
      this.element.set("type", this.params.subtype);
    }

    if (this.params.pattern !== undefined) {
      this.element.set("pattern", this.params.pattern);
    }

    this.element.inject(this.container);
    this.container.inject(this.bundle);
  }

  addEvents() {
    const change = function () {
      if (this.element.element.checkValidity()) {
        this.element.element.classList.add("is-success");
        this.element.element.classList.remove("is-danger");
      } else {
        this.element.element.classList.remove("is-success");
        this.element.element.classList.add("is-danger");
      }

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

class Textarea extends Bundle {
  // label, text, value
  // action -> change & keyup

  createDOM() {
    this.bundle = new ElementWrapper("div", {
      class: "field",
    });

    this.container = new ElementWrapper("div", {
      class: "control",
    });

    this.element = new ElementWrapper("textarea", {
      class: "textarea",
    });

    this.label = new ElementWrapper("label", {
      class: "label",
    });
  }

  setupDOM() {
    if (this.params.label !== undefined) {
      this.label.set("html", this.params.label);
      this.label.inject(this.container);
    }

    if (this.params.text !== undefined) {
      this.element.set("placeholder", this.params.text);
    }

    if (this.params.value !== undefined) {
      this.element.appendText(this.params.text);
    }

    this.element.inject(this.container);
    this.container.inject(this.bundle);
  }

  addEvents() {
    const change = function () {
      if (this.params.name !== undefined) {
        settings.set(this.params.name, this.get());
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
    this.bundle = new ElementWrapper("div", { class: "field" });

    this.container = new ElementWrapper("div", {
      class: "control",
    });

    const id = getUniqueID();
    this.element = new ElementWrapper("input", {
      id: id,
      name: id,
      class: "switch",
      type: "checkbox",
      value: "true",
    });

    this.label = new ElementWrapper("label", {
      for: this.element.get("id"),
    });
  }

  setupDOM() {
    this.element.inject(this.container);
    this.container.inject(this.bundle);

    if (this.params.label !== undefined) {
      this.label.set("innerHTML", this.params.label);
      this.label.inject(this.container);
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

    this.createDOM();
    this.setupDOM();
    this.addEvents();

    if (this.params.name !== undefined) {
      const promise = settings.get(this.params.name);
      promise
        .then((value) => {
          this.set(value || 0, true);
        })
        .catch(function (e) {
          console.error(e);
        });
    } else {
      this.set(0, true);
    }
  }

  createDOM() {
    this.bundle = new ElementWrapper("div", {
      class: "field",
    });

    this.container = new ElementWrapper("div", {
      class: "control",
    });

    this.element = new ElementWrapper("input", {
      name: getUniqueID(),
      class:
        "slider is-fullwidth" +
        (this.params.display === true ? " has-output" : ""),
      type: "range",
    });

    this.label = new ElementWrapper("label", {});

    this.display = new ElementWrapper("output", {
      for: this.element.get("name"),
    });
  }

  setupDOM() {
    if (this.params.label !== undefined) {
      this.label.set("innerHTML", this.params.label);
      this.label.inject(this.container);
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
        this.display.set("innerText", this.params.displayModifier(0));
      } else {
        this.display.set("innerText", 0);
      }
      this.display.inject(this.container);
    }
    this.container.inject(this.bundle);
  }

  addEvents() {
    this.element.addEvent(
      "input",
      function () {
        if (this.params.name !== undefined) {
          settings.set(this.params.name, this.get());
        }

        if (this.params.displayModifier !== undefined) {
          this.display.set(
            "innerText",
            this.params.displayModifier(this.get())
          );
        } else {
          this.display.set("innerText", this.get());
        }
        this.fireEvent("action", this.get());
      }.bind(this)
    );
  }

  get() {
    return Number(this.element.get("value"));
  }

  set(value, noChangeEvent) {
    this.element.set("value", value);

    if (noChangeEvent !== true) {
      this.element.fireEvent("change");
    } else {
      if (this.params.displayModifier !== undefined) {
        this.display.set(
          "innerText",
          this.params.displayModifier(Number(value))
        );
      } else {
        this.display.set("innerText", Number(value));
      }
    }

    return this;
  }
}

class PopupButton extends Bundle {
  // label, options[{value, text}]
  // action -> change

  createDOM() {
    this.bundle = new ElementWrapper("div", {
      class: "field",
    });

    this.control = new ElementWrapper("div", {
      class: "control",
    });
    this.container = new ElementWrapper("div", {
      class: "select",
    });

    this.element = new ElementWrapper("select", {});

    this.label = new ElementWrapper("label", { class: "label" });

    if (this.params.options === undefined) {
      return;
    }

    // convert array syntax into object syntax for options
    function arrayToObject(option) {
      if (Array.isArray(option)) {
        option = {
          value: option[0],
          text: option[1] || option[0],
        };
      }
      return option;
    }

    // convert arrays
    if (Array.isArray(this.params.options)) {
      const values = [];
      this.params.options.forEach((option) => {
        values.push(arrayToObject(option));
      });
      this.params.options = {
        values: values,
      };
    }

    let groups;
    if (this.params.options.groups !== undefined) {
      groups = {};
      this.params.options.groups.forEach(
        function (groups, group) {
          groups[group] = new ElementWrapper("optgroup", {
            label: group,
          }).inject(this.element);
        }.bind(this, groups)
      );
    }

    if (this.params.options.values !== undefined) {
      this.params.options.values.forEach((option) => {
        option = arrayToObject(option);

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

        new ElementWrapper("option", {
          value: option.value,
          text: option.text || option.value,
        }).inject(parent);
      });
    }
  }

  setupDOM() {
    if (this.params.label !== undefined) {
      this.label.set("innerHTML", this.params.label);
      this.label.inject(this.bundle);
    }

    this.element.inject(this.container);
    this.container.inject(this.control);
    this.control.inject(this.bundle);
  }
}

class ListBox extends PopupButton {
  // label, options[{value, text}]
  // action -> change

  add(item) {
    if (this.params.options.indexOf(item) === -1) {
      this.params.options.push(item);
      const elem = new ElementWrapper("option", {
        value: item,
        text: item,
      });
      elem.inject(this.element);
      settings.set(this.params.name, this.params.options);
    }
  }

  remove() {
    if (this.selected) {
      this.selected.forEach((element) => {
        const idx = this.params.options.indexOf(
          element.get("value").toString()
        );
        if (idx !== -1) {
          this.params.options.splice(idx, 1);
          settings.set(this.params.name, this.params.options);
          element.dispose();
          element = null;
        }
      });
    }
  }

  addEvents() {
    const change = function () {
      if (this.params.name !== undefined) {
        this.selected = this.element.getSelected();
        // settings.set(this.params.names, this.get());
      }
      // this.fireEvent("action", this.get());
    }.bind(this);

    this.element.addEvent("change", change);
  }

  setupDOM() {
    super.setupDOM();
    this.selected = null;
    this.params.options = [];

    const promise = settings.get(this.params.name);
    promise
      .then((initParams) => {
        if (initParams) {
          this.params.options = initParams;
        }
        try {
          this.params.options.forEach(
            function (option) {
              if (option) {
                new ElementWrapper("option", {
                  value: option,
                  text: option,
                }).inject(this.element);
              }
              return true;
            }.bind(this)
          );
        } catch (e) {
          console.error(e);
        }

        this.element.inject(this.container);
        this.container.inject(this.control);
        this.control.inject(this.bundle);
      })
      .catch(function (e) {
        console.error(e);
      });
  }

  createDOM() {
    super.createDOM();
    this.bundle = new ElementWrapper("div", {
      class: "field",
    });

    this.control = new ElementWrapper("div", {
      class: "control",
    });
    this.container = new ElementWrapper("div", {
      class: "select is-multiple is-fullwidth",
    });

    this.element = new ElementWrapper("select", {
      multiple: true,
      size: "10",
    });

    this.label = new ElementWrapper("label", {
      class: "label",
    });
    if (this.params.options === undefined) {
      return;
    }
    this.params.options.values.forEach(
      function (option) {
        new ElementWrapper("option", {
          value: option.value,
          text: option.text,
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
    const settingID = getUniqueID();

    this.bundle = new ElementWrapper("div", {
      class: "field",
    });
    this.control = new ElementWrapper("div", {
      class: "control",
    });
    this.label = new ElementWrapper("label", {
      class: "label",
    });

    this.label.inject(this.control);

    this.elements = [];

    if (this.params.options === undefined) {
      return;
    }
    this.params.options.forEach(
      function (option) {
        const optionID = getUniqueID();
        const radioLabel = new ElementWrapper("label", {
          class: "radio",
        });
        const radio = new ElementWrapper("input", {
          id: optionID,
          name: settingID,
          type: "radio",
          value: option[0],
        });
        const labelText = new ElementWrapper("span", {
          text: " " + option[0] + " ",
        });

        this.elements.push(radio);

        radio.inject(radioLabel);
        labelText.inject(radioLabel);
        radioLabel.inject(this.control);
      }.bind(this)
    );
  }

  setupDOM() {
    if (this.params.label !== undefined) {
      this.label.set("innerHTML", this.params.label);
    }
    this.control.inject(this.bundle);
  }

  addEvents() {
    this.bundle.addEvent(
      "change",
      function () {
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
      textarea: Textarea,
      checkbox: Checkbox,
      slider: Slider,
      popupButton: PopupButton,
      listBox: ListBox,
      radioButtons: RadioButtons,
      valueOnly: Bundle,
      modalButton: ModalButton,
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
