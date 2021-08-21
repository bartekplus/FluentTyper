import { Store } from "./lib/store.js";
import { ElementWrapper, getUniqueID } from "./js/classes/utils.js";

class TextExpander {
  constructor(settings, callbackFn) {
    this.callbackFn = callbackFn;
    this.textExpansionsStoreKey = "textExpansions";
    this.addNewShortcutIDs = ["newShortcut", "newShortcatText"];
    this.store = new Store("settings");
    this.settingsWithManifest = settings;
    this.getTextExpansions();
    this.render();
  }

  getTextExpansions() {
    this.textExpansions = this.store.get(this.textExpansionsStoreKey) || [];
  }
  saveTextExpansions() {
    this.store.set(this.textExpansionsStoreKey, this.textExpansions);
    this.callbackFn();
  }

  clearRender() {
    let node = this.settingsWithManifest.manifest.textExpansions.bundle.element;
    let clonedNode = node.cloneNode(false);
    node.parentNode.replaceChild(clonedNode, node);
    this.settingsWithManifest.manifest.textExpansions.bundle.element =
      clonedNode;
  }

  renderNode(key, val, shortcutIndex) {
    const newNode = shortcutIndex === null;
    const fieldElem = new ElementWrapper("div", {
      class: "field is-horizontal",
    });
    const fieldBody = new ElementWrapper("div", { class: "field-body" });
    fieldElem.inject(this.settingsWithManifest.manifest.textExpansions.bundle);
    fieldBody.inject(fieldElem);

    [
      {
        type: "input",
        id: newNode ? this.addNewShortcutIDs[0] : getUniqueID(),
        class: "input",
        pattern: "[A-Za-z0-9]{1,32}",
        maxLength: 32,
        value: key,
        rows: "",
      },
      {
        type: "textarea",
        id: newNode ? this.addNewShortcutIDs[1] : getUniqueID(),
        class: "textarea",
        pattern: "(.*?)+",
        maxLength: 1024,
        value: val,
        rows: 2,
      },
    ].forEach((input) => {
      const idErrMsg = input.id + "ErrMsg";
      const fieldElem = new ElementWrapper("div", { class: "field" });
      const controlElem = new ElementWrapper("p", {
        class: "control is-expanded",
      });
      const inputElem = new ElementWrapper(input.type, {
        id: input.id,
        idErrMsg: idErrMsg,
        class: input.class,
        contentEditable: false,
        required: true,
        pattern: input.pattern,
        maxlength: input.maxLength,
        rows: input.rows,
      });
      const errMsgNode = new ElementWrapper("p", {
        id: idErrMsg,
        class: "help is-danger is-hidden",
      });

      if (newNode) {
        inputElem.set("placeholder", input.value);
        inputElem.addEvent("input", this.shortcutInputChange.bind(this));
      } else {
        inputElem.set("value", input.value);
        inputElem.set("readonly", true);
        inputElem.set("disabled", true);
      }
      inputElem.inject(controlElem);
      fieldElem.inject(fieldBody);
      controlElem.inject(fieldElem);
      errMsgNode.inject(fieldElem);
    });

    let button = new ElementWrapper("a", {
      class: "button " + (newNode ? " is-success" : " is-danger"),
      //TODO: Use proper column width and remove "hardspace" workaround
      text: newNode ? "\xa0\xa0\xa0Add\xa0\xa0\xa0" : "Remove",
    });
    button.inject(fieldBody);
    if (newNode) button.addEvent("click", this.addNewShortcut.bind(this));
    else button.addEvent("click", this.delShortcut.bind(this, shortcutIndex));
  }

  shortcutInputChange() {
    let isValid = true;
    [
      document.getElementById(this.addNewShortcutIDs[0]),
      document.getElementById(this.addNewShortcutIDs[1]),
    ].forEach((element, index) => {
      let errMsgNode = document.getElementById(element.id + "ErrMsg");
      let errMsgStr = "";
      if (!element.checkValidity()) {
        isValid = false;
        errMsgStr =
          index == 0
            ? "Please use only letters and numbers no white space are allowed, between 1-32 characters."
            : "Shortcut text cannot be empty.";
      } // Validate if there is no key duplicate
      else if (index == 0) {
        this.textExpansions.forEach((textExpansion) => {
          if (textExpansion[0] === element.value) {
            isValid = false;
            errMsgStr = "Shortcut name is already used.";
          }
        });
      }

      errMsgNode.textContent = errMsgStr;
      if (isValid) {
        element.classList.remove("is-danger");
        errMsgNode.classList.remove("is-active");
        errMsgNode.classList.add("is-hidden");
      } else {
        element.classList.add("is-danger");
        errMsgNode.classList.add("is-active");
        errMsgNode.classList.remove("is-hidden");
      }
    });
    return isValid;
  }

  delShortcut(index) {
    this.textExpansions.splice(index, 1);
    this.saveTextExpansions();
    this.render();
  }

  addNewShortcut() {
    let shortcatElem = document.getElementById(this.addNewShortcutIDs[0]);
    let shortcatTextElem = document.getElementById(this.addNewShortcutIDs[1]);
    this.shortcutInputChange();
    if (this.shortcutInputChange()) {
      this.textExpansions.unshift([shortcatElem.value, shortcatTextElem.value]);
      this.saveTextExpansions();
      this.render();
    }
  }

  render() {
    this.clearRender();

    this.renderNode("Shortcut", "Shortcut text", null);

    this.textExpansions.forEach((element, index) => {
      this.renderNode(element[0], element[1], index);
    });
  }
}

export { TextExpander };
