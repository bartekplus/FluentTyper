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

    this.element = new ElementWrapper("div", {
      class: "description-body",
    });
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
      class: "button is-primary",
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
      class: "button is-primary",
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

    if (this.params.required === true) {
      this.element.set("required", true);
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
  // Dynamically set options for the select element
  setOptions(options, selectedValue) {
    this.params.options = options;
    // Remove all options from the select element
    const selectElem = this.element && this.element.element ? this.element.element : null;
    if (selectElem && selectElem.tagName === "SELECT") {
      while (selectElem.options.length > 0) {
        selectElem.remove(0);
      }
      // Add new options
      options.forEach(option => {
        if (Array.isArray(option)) {
          option = {
            value: option[0],
            text: option[1] || option[0],
          };
        }
        let value, text;
        if (typeof option === "object" && option.value !== undefined) {
          value = option.value;
          text = option.text || option.value;
        } else {
          value = option;
          text = option;
        }
        const opt = document.createElement("option");
        opt.value = value;
        opt.text = text;
        if (selectedValue !== undefined && value === selectedValue) {
          opt.selected = true;
        }
        selectElem.add(opt);
      });
    }
  }
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

  add(item, store=true) {
    if (this.params.options.indexOf(item) === -1) {
      this.params.options.push(item);
      const elem = new ElementWrapper("option", {
        value: item,
        text: item,
      });
      elem.inject(this.element);
      if (store) {
        this.store();
      }
    }
  }

  store() {
    settings.set(this.params.name, this.params.options);
    this.fireEvent("action", this.get());
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
      this.fireEvent("action", this.get());
    }
  }

  removeAll() {
    this.params.options = [];
    settings.set(this.params.name, this.params.options);
    while (this.element.element.firstChild) {
      this.element.element.removeChild(this.element.element.firstChild);
    }
    this.fireEvent("action", this.get());
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

  setupDOM(inject=true) {
    super.setupDOM();
    this.selected = null;
    this.params.options = [];
    if(!inject) {
      return;
    }
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

class ListBoxMultiselect extends ListBox {
  addEvents() {
    const change = function () {
      if (this.params.name !== undefined) {
        settings.set(this.params.name, this.get());
      }
      this.fireEvent("action", this.get());
    }.bind(this);

    this.element.addEvent("change", change);
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

  get() {
    return Array.from(this.element.element.options)
      .filter((option) => option.selected)
      .map((option) => option.value);
  }

  set(values, noChangeEvent) {
    const selectedValues = Array.isArray(values)
      ? values.map((value) => value.toString())
      : [];
    const selectedSet = new Set(selectedValues);
    const options = this.element.element.options;
    for (let i = 0; i < options.length; i++) {
      options[i].selected = selectedSet.has(options[i].value);
    }

    if (noChangeEvent !== true) {
      this.element.fireEvent("change");
    }
    return this;
  }
}

class RuleToggleCards extends Bundle {
  normalizeOption(option) {
    if (Array.isArray(option)) {
      return {
        value: option[0]?.toString?.() || "",
        text: option[1] !== undefined ? option[1].toString() : option[0]?.toString?.() || "",
        recommended: false,
        safetyTier: "safe",
        languageScope: "all",
      };
    }
    if (option && typeof option === "object") {
      const value = option.value !== undefined ? option.value.toString() : "";
      return {
        value,
        text: option.text !== undefined ? option.text.toString() : value,
        description:
          option.description !== undefined
            ? option.description.toString()
            : undefined,
        example: option.example !== undefined ? option.example.toString() : undefined,
        badge: option.badge !== undefined ? option.badge.toString() : undefined,
        recommended: option.recommended === true,
        safetyTier: option.safetyTier === "advanced" ? "advanced" : "safe",
        languageScope: option.languageScope === "en_US" ? "en_US" : "all",
      };
    }
    const value = option !== undefined ? option.toString() : "";
    return {
      value,
      text: value,
      recommended: false,
      safetyTier: "safe",
      languageScope: "all",
    };
  }

  createSection(title, sectionType) {
    const section = new ElementWrapper("section", {
      class: `grammar-rule-section grammar-rule-section-${sectionType}`,
    });
    const heading = new ElementWrapper("h4", {
      class: "grammar-rule-section-title",
      innerText: title,
    });
    const list = new ElementWrapper("div", {
      class: "grammar-rule-selector-list",
    });
    heading.inject(section);
    list.inject(section);
    return {
      section,
      list,
    };
  }

  updateFilterButtons() {
    if (!Array.isArray(this.filterButtons)) {
      return;
    }

    this.filterButtons.forEach((filterButton) => {
      const isActive = filterButton.key === this.activeFilter;
      filterButton.button.element.classList.toggle("is-selected", isActive);
    });
  }

  matchesSearch(rule) {
    if (!this.searchQuery) {
      return true;
    }
    const haystack = [rule.text, rule.description, rule.example]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(this.searchQuery);
  }

  matchesFilter(control, isChecked) {
    switch (this.activeFilter) {
      case "safe":
        return control.rule.safetyTier === "safe";
      case "advanced":
        return control.rule.safetyTier === "advanced";
      case "recommended":
        return control.rule.recommended === true;
      case "english":
        return control.rule.languageScope === "en_US";
      case "enabled":
        return isChecked;
      case "all":
      default:
        return true;
    }
  }

  createDOM() {
    this.bundle = new ElementWrapper("div", {
      class: "field grammar-rule-selector-field",
    });

    this.container = new ElementWrapper("div", {
      class: "control grammar-rule-selector",
    });

    this.label = new ElementWrapper("label", { class: "label" });
    this.help = new ElementWrapper("p", { class: "grammar-rule-selector-help" });
    this.toolbar = new ElementWrapper("div", {
      class: "grammar-rule-selector-toolbar",
    });
    this.searchRow = new ElementWrapper("div", {
      class: "grammar-rule-selector-search-row",
    });
    this.searchField = new ElementWrapper("div", {
      class: "grammar-rule-selector-search",
    });
    this.searchInput = new ElementWrapper("input", {
      class: "input is-small grammar-rule-search-input",
      type: "search",
      placeholder: (this.params.searchPlaceholder || "Search grammar rules...").toString(),
    });
    this.filters = new ElementWrapper("div", {
      class: "buttons has-addons grammar-rule-selector-filters",
    });
    this.summary = new ElementWrapper("p", {
      class: "grammar-rule-selector-summary",
    });
    this.actions = new ElementWrapper("div", {
      class: "buttons has-addons grammar-rule-selector-actions",
    });
    this.noResults = new ElementWrapper("p", {
      class: "grammar-rule-selector-no-results is-hidden",
      innerText: (this.params.noMatchesText || "No grammar rules match your search.").toString(),
    });
    this.ruleList = new ElementWrapper("div", {
      class: "grammar-rule-sections",
    });

    this.safeSection = this.createSection(
      (this.params.sectionSafeLabel || "Safe defaults").toString(),
      "safe",
    );
    this.advancedSection = this.createSection(
      (this.params.sectionAdvancedLabel || "Advanced (optional)").toString(),
      "advanced",
    );
    this.safeSection.section.inject(this.ruleList);
    this.advancedSection.section.inject(this.ruleList);

    this.activeFilter = "all";
    this.searchQuery = "";
    this.filterButtons = [];
    const filters = [
      {
        key: "all",
        label: (this.params.filterAllLabel || "All").toString(),
      },
      {
        key: "safe",
        label: (this.params.filterSafeLabel || "Safe").toString(),
      },
      {
        key: "advanced",
        label: (this.params.filterAdvancedLabel || "Advanced").toString(),
      },
      {
        key: "recommended",
        label: (this.params.filterRecommendedLabel || "Recommended").toString(),
      },
      {
        key: "english",
        label: (this.params.filterEnglishOnlyLabel || "English only").toString(),
      },
      {
        key: "enabled",
        label: (this.params.filterEnabledOnlyLabel || "Enabled only").toString(),
      },
    ];
    filters.forEach((filter) => {
      const button = new ElementWrapper("button", {
        type: "button",
        class: "button is-small is-light grammar-rule-filter-button",
        innerText: filter.label,
      });
      button.set("data-filter", filter.key);
      button.inject(this.filters);
      this.filterButtons.push({
        key: filter.key,
        button,
      });
    });

    const sourceOptions = Array.isArray(this.params.options)
      ? this.params.options
      : Array.isArray(this.params.options?.values)
        ? this.params.options.values
        : [];
    this.ruleOptions = sourceOptions
      .map((option) => this.normalizeOption(option))
      .filter((option) => option.value.length > 0);
    this.ruleControls = [];

    this.ruleOptions.forEach((rule) => {
      const section = rule.safetyTier === "advanced" ? this.advancedSection : this.safeSection;
      const card = new ElementWrapper("label", {
        class: "grammar-rule-card",
      });
      const input = new ElementWrapper("input", {
        type: "checkbox",
        value: rule.value,
        class: "grammar-rule-card-toggle",
      });
      const body = new ElementWrapper("div", {
        class: "grammar-rule-card-body",
      });
      const titleRow = new ElementWrapper("div", {
        class: "grammar-rule-card-title-row",
      });
      const title = new ElementWrapper("span", {
        class: "grammar-rule-card-title",
        innerText: rule.text,
      });

      title.inject(titleRow);
      if (rule.badge) {
        new ElementWrapper("span", {
          class: "grammar-rule-card-badge",
          innerText: rule.badge,
        }).inject(titleRow);
      }

      titleRow.inject(body);
      if (rule.description) {
        new ElementWrapper("p", {
          class: "grammar-rule-card-description",
          innerText: rule.description,
        }).inject(body);
      }
      if (rule.example) {
        new ElementWrapper("p", {
          class: "grammar-rule-card-example",
          innerText: rule.example,
        }).inject(body);
      }

      input.inject(card);
      body.inject(card);
      card.inject(section.list);

      this.ruleControls.push({
        value: rule.value,
        input,
        card,
        rule,
        sectionType: rule.safetyTier,
      });
    });

    this.actionButtons = [];
    const sourceActions = Array.isArray(this.params.actions) ? this.params.actions : [];
    sourceActions.forEach((action) => {
      if (
        !action ||
        typeof action !== "object" ||
        action.text === undefined ||
        !Array.isArray(action.values)
      ) {
        return;
      }

      const button = new ElementWrapper("button", {
        type: "button",
        class: "button is-small is-light",
        innerText: action.text.toString(),
      });
      button.inject(this.actions);
      this.actionButtons.push({
        values: action.values.map((value) => value.toString()),
        button,
      });
    });
  }

  setupDOM() {
    if (this.params.label !== undefined) {
      this.label.set("innerHTML", this.params.label);
      this.label.inject(this.bundle);
    }

    if (this.params.helpText) {
      this.help.set("innerText", this.params.helpText.toString());
      this.help.inject(this.bundle);
    }

    this.searchInput.inject(this.searchField);
    this.searchField.inject(this.searchRow);
    this.filters.inject(this.searchRow);
    this.searchRow.inject(this.container);

    this.summary.inject(this.toolbar);
    if (this.actionButtons.length > 0) {
      this.actions.inject(this.toolbar);
    }
    this.toolbar.inject(this.container);

    this.noResults.inject(this.container);
    this.ruleList.inject(this.container);
    this.container.inject(this.bundle);
    this.updateFilterButtons();
    this.updateStateUI();
  }

  addEvents() {
    this.ruleControls.forEach((control) => {
      control.input.addEvent(
        "change",
        function () {
          this.updateStateUI();
          if (this.params.name !== undefined) {
            settings.set(this.params.name, this.get());
          }
          this.fireEvent("action", this.get());
        }.bind(this),
      );
    });

    this.actionButtons.forEach((actionButton) => {
      actionButton.button.addEvent(
        "click",
        function (event) {
          event.preventDefault();
          this.set(actionButton.values);
        }.bind(this),
      );
    });

    this.searchInput.addEvent(
      "input",
      function () {
        this.searchQuery = (this.searchInput.get("value") || "").toString().trim().toLowerCase();
        this.updateStateUI();
      }.bind(this),
    );

    this.filterButtons.forEach((filterButton) => {
      filterButton.button.addEvent(
        "click",
        function (event) {
          event.preventDefault();
          this.activeFilter = filterButton.key;
          this.updateFilterButtons();
          this.updateStateUI();
        }.bind(this),
      );
    });
  }

  get() {
    return this.ruleControls
      .filter((control) => control.input.get("checked") === true)
      .map((control) => control.value);
  }

  set(values, noChangeEvent) {
    const normalizedValues = Array.isArray(values)
      ? values.map((value) => value.toString())
      : [];
    const selectedSet = new Set(normalizedValues);

    this.ruleControls.forEach((control) => {
      control.input.set("checked", selectedSet.has(control.value));
    });

    this.updateStateUI();
    if (noChangeEvent !== true) {
      if (this.params.name !== undefined) {
        settings.set(this.params.name, this.get());
      }
      this.fireEvent("action", this.get());
    }
    return this;
  }

  updateStateUI() {
    let activeCount = 0;
    let visibleCount = 0;
    let safeVisibleCount = 0;
    let advancedVisibleCount = 0;

    this.ruleControls.forEach((control) => {
      const isChecked = control.input.get("checked") === true;
      control.card.element.classList.toggle("is-active", isChecked);
      if (isChecked) {
        activeCount += 1;
      }

      const shouldBeVisible = this.matchesSearch(control.rule) && this.matchesFilter(control, isChecked);
      control.card.element.classList.toggle("is-hidden", !shouldBeVisible);
      if (shouldBeVisible) {
        visibleCount += 1;
        if (control.sectionType === "advanced") {
          advancedVisibleCount += 1;
        } else {
          safeVisibleCount += 1;
        }
      }
    });

    this.safeSection.section.element.classList.toggle("is-hidden", safeVisibleCount === 0);
    this.advancedSection.section.element.classList.toggle("is-hidden", advancedVisibleCount === 0);
    this.noResults.element.classList.toggle("is-hidden", visibleCount > 0);

    if (activeCount === 0) {
      this.summary.set(
        "innerText",
        (this.params.emptyStateText || "No grammar rules enabled.").toString(),
      );
      this.summary.element.classList.add("is-empty");
      return;
    }

    const summaryLabel = (this.params.summaryLabel || "Active rules").toString();
    this.summary.set(
      "innerText",
      `${summaryLabel}: ${activeCount}/${this.ruleControls.length}`,
    );
    this.summary.element.classList.remove("is-empty");
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
      listBoxMultiselect: ListBoxMultiselect,
      ruleToggleCards: RuleToggleCards,
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
