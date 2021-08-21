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
    let node = this.settingsWithManifest.manifest.TextExpander.bundle.element;
    let clonedNode = node.cloneNode(false);
    node.parentNode.replaceChild(clonedNode, node);
    this.settingsWithManifest.manifest.TextExpander.bundle.element = clonedNode;
  }

  renderNode(key, val, shortcatIndex) {
    const newNode = shortcatIndex === null;
    let field = new ElementWrapper("div", { class: "field is-horizontal" });
    field.inject(this.settingsWithManifest.manifest.TextExpander.bundle);
    let fieldBody = new ElementWrapper("div", { class: "field-body" });
    fieldBody.inject(field);
    [key, val].forEach((value, index) => {
      let fielInput = new ElementWrapper("div", { class: "field" });
      fielInput.inject(fieldBody);

      let control = new ElementWrapper("p", {
        class: "control is-expanded",
      });
      control.inject(fielInput);
      const id = newNode ? this.addNewShortcutIDs[index] : getUniqueID();
      const idErrMsg = id + "ErrMsg";
      let input = new ElementWrapper("input", {
        id: id,
        idErrMsg: idErrMsg,
        class: "input",
        type: "text",
        contentEditable: false,
        required: true,
        pattern: index == 0 ? "[A-Za-z0-9]{1,32}" : "(.*?)+",
      });
      if (!newNode) {
        input.set("readonly", true);
        input.set("disabled", true);
      }
      input.set(newNode ? "placeholder" : "value", value);
      input.inject(control);
      if (newNode) input.addEvent("input", this.shortcutInputChange.bind(this));

      //Error msg:
      let errMsgNode = new ElementWrapper("p", {
        id: idErrMsg,
        class: "help is-danger is-hidden",
        text: "",
      });
      errMsgNode.inject(fielInput);
    });

    let button = new ElementWrapper("a", {
      class: "button " + (newNode ? " is-success" : " is-danger"),
      //TODO: Use proper column width and remove "hardspace" workaround
      text: newNode ? "\xa0\xa0\xa0Add\xa0\xa0\xa0" : "Remove",
    });
    button.inject(fieldBody);
    if (newNode) button.addEvent("click", this.addNewShortcut.bind(this));
    else button.addEvent("click", this.delShortcut.bind(this, shortcatIndex));
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
