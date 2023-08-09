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
  }

  getTextExpansions() {
    const promise = this.store.get(this.textExpansionsStoreKey);
    promise
      .then((value) => {
        this.textExpansions = value || [];
        this.render();
      })
      .catch(function (e) {
        console.error(e);
      });
  }
  saveTextExpansions() {
    this.store.set(this.textExpansionsStoreKey, this.textExpansions);
    this.callbackFn();
  }

  clearRender() {
    const node =
      this.settingsWithManifest.manifest.textExpansions.bundle.element;
    const clonedNode = node.cloneNode(false);
    node.parentNode.replaceChild(clonedNode, node);
    this.settingsWithManifest.manifest.textExpansions.bundle.element =
      clonedNode;
  }

  renderNode(key, val, shortcutIndex) {
    const dividerElem = new ElementWrapper("hr", {});
    const columnElem = new ElementWrapper("div", {
      class: "columns is-expanded",
    });
    const columnsElems = [];
    for (let index = 0; index < 3; index++) {
      let columnClass = "column";
      switch (index) {
        case 0:
          columnClass += " is-5";
          break;
        case 1:
          columnClass += " is-6";
          break;
        case 2:
          columnClass += " has-text-centered ";
          break;

        default:
          break;
      }
      columnsElems[index] = new ElementWrapper("div", { class: columnClass });
      columnsElems[index].inject(columnElem);
    }

    const newNode = shortcutIndex === null;
    [
      {
        type: "input",
        id: newNode ? this.addNewShortcutIDs[0] : getUniqueID(),
        class: "input",
        pattern: "(?:[A-Za-z])*(?:[0-9])?(?:[A-Za-z])*(?:[0-9])?(?:[A-Za-z])*",
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
    ].forEach((input, idx) => {
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
      fieldElem.inject(columnsElems[idx]);
      inputElem.inject(controlElem);
      controlElem.inject(fieldElem);
      errMsgNode.inject(fieldElem);
    });

    const button = new ElementWrapper("a", {
      class: "button is-fullwidth" + (newNode ? " is-success" : " is-danger"),
      text: newNode ? "Add" : "Remove",
    });
    button.inject(columnsElems[2]);
    if (newNode) button.addEvent("click", this.addNewShortcut.bind(this));
    else button.addEvent("click", this.delShortcut.bind(this, shortcutIndex));
    columnElem.inject(this.settingsWithManifest.manifest.textExpansions.bundle);
    dividerElem.inject(
      this.settingsWithManifest.manifest.textExpansions.bundle
    );
  }

  shortcutInputChange() {
    let isValid = true;
    [
      document.getElementById(this.addNewShortcutIDs[0]),
      document.getElementById(this.addNewShortcutIDs[1]),
    ].forEach((element, index) => {
      const errMsgNode = document.getElementById(element.id + "ErrMsg");
      let errMsgStr = "";
      if (!element.checkValidity()) {
        isValid = false;
        errMsgStr =
          index === 0
            ? "Please use only letters and numbers (two or less digits), no white space or special characters are allowed, between 1-32 characters."
            : "Shortcut text cannot be empty.";
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
    const shortcatElem = document.getElementById(this.addNewShortcutIDs[0]);
    const shortcatTextElem = document.getElementById(this.addNewShortcutIDs[1]);
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
