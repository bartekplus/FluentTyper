//
// Copyright (c) 2021 Bartosz Tomczyk
// License: LGPL v2.1
// https://github.com/bartekplus/fancier-settings
//

// based on mootools
class Events {
  constructor() {
    this.events = {};
  }

  addEvent(type, fn) {
    type = this.removeOn(type);

    if (!(type in this.events)) this.events[type] = [];
    if (this.events[type].indexOf(fn) === -1) this.events[type].push(fn);
    return this;
  }

  addEvents(events) {
    for (const type in events) this.addEvent(type, events[type]);
    return this;
  }

  fireEvent(type, args) {
    type = this.removeOn(type);
    const events = this.events[type];
    if (!events) return this;
    args = Array(args);
    events.forEach((fn) => {
      fn.apply(this, args);
    });
    return this;
  }

  removeEvent(type, fn) {
    type = this.removeOn(type);
    const events = this.events[type];
    if (events) {
      const index = events.indexOf(fn);
      if (index !== -1) delete events[index];
    }
    return this;
  }

  removeEvents(events) {
    let type;
    if (typeof events === "object") {
      for (type in events) this.removeEvent(type, events[type]);
      return this;
    }
    if (events) events = this.removeOn(events);
    for (type in this.events) {
      if (events && events !== type) continue;
      const fns = this.events[type];
      for (let i = fns.length; i--; ) {
        if (i in fns) {
          this.removeEvent(type, fns[i]);
        }
      }
    }
    return this;
  }

  removeOn(string) {
    return string.replace(/^on([A-Z])/, function (full, first) {
      return first.toLowerCase();
    });
  }
}

class ElementWrapper extends Events {
  constructor(tag, props = {}) {
    super();

    this.propertySetters = {
      type: "type",
      value: "value",
      defaultValue: "defaultValue",
      accessKey: "accessKey",
      cellPadding: "cellPadding",
      cellSpacing: "cellSpacing",
      colSpan: "colSpan",
      frameBorder: "frameBorder",
      rowSpan: "rowSpan",
      tabIndex: "tabIndex",
      useMap: "useMap",
      html: "innerHTML",
      innerHTML: "innerHTML",
      text: "textContent",
      innerText: "innerText",
      checked: "checked",
    };

    if (tag instanceof HTMLElement) this.element = tag;
    else this.element = document.createElement(tag);

    for (const [key, value] of Object.entries(props)) {
      this.set(key, value);
    }
  }

  inject(parent) {
    if (parent instanceof ElementWrapper)
      parent.element.appendChild(this.element);
    else parent.appendChild(this.element);

    return this;
  }

  getSelected() {
    const selected = Array.from(this.element.options)
      .filter((o) => o.selected)
      .map((o) => new ElementWrapper(o));
    return selected;
  }

  dispose() {
    if (this.element.parentNode)
      this.element.parentNode.removeChild(this.element);
  }

  get(prop) {
    return this.element[prop];
  }

  set(key, value) {
    if (key in this.propertySetters)
      this.element[this.propertySetters[key]] = value;
    else this.element.setAttribute(key, value);
  }
  addEvent(type, fn) {
    super.addEvent(type, fn);
    this.element.addEventListener(type, fn);
  }
  removeEvent(type, fn) {
    super.removeEvent(type, fn);
    this.element.removeEventListener(type, fn);
  }
}

function getUniqueID() {
  if (!getUniqueID.UID) {
    getUniqueID.UID = Date.now();
  }

  return (getUniqueID.UID++).toString(36);
}

export { Events, ElementWrapper, getUniqueID };
