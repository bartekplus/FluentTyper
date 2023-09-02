import { Store } from "./third_party/fancier-settings/lib/store.js";
import {
  ElementWrapper,
  getUniqueID,
} from "./third_party/fancier-settings/js/classes/utils.js";
import { parse } from "./third_party/csv-parse/sync.js";

class TextExpander {
  constructor(settings, callbackFn) {
    this.callbackFn = callbackFn;
    this.textExpansionsStoreKey = "textExpansions";
    this.addNewShortcutIDs = ["newShortcut", "newShortcatText"];
    this.store = new Store("settings");
    this.settingsWithManifest = settings;
    this.importedElemCount = 0;
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

  fileInputChange() {
    const fileInput = document.getElementById("csvFileInput");
    const fileNameSpanElem = document.getElementById("fileNameSpanElemId");

    fileNameSpanElem.value = "ble";
    fileNameSpanElem.textContent = fileInput.files[0].name;
    const reader = new FileReader();
    reader.addEventListener(
      "load",
      () => {
        // this will then display a text file
        const parsedData = parse(reader.result, {
          skip_records_with_error: true,
          relax_column_count: true,
          columns: false,
          skip_empty_lines: true,
        });
        const shortcutElem = document.getElementById(this.addNewShortcutIDs[0]);
        const shortcutTextElem = document.getElementById(
          this.addNewShortcutIDs[1]
        );
        parsedData.forEach((element) => {
          if (element.length === 2) {
            shortcutElem.value = element[0];
            shortcutTextElem.value = element[1];

            if (this.addNewShortcut(false)) {
              this.importedElemCount += 1;
            }
          }
        });
        this.render();
      },
      false
    );
    if (fileInput.files[0]) {
      reader.readAsText(fileInput.files[0]);
    }
  }

  getTextExpansionsAsCSVBlob() {
    let csvData = "";
    this.textExpansions.forEach((element) => {
      csvData += element[0] + "," + '"' + element[1] + '"' + "\n";
    });
    return new Blob([csvData], { type: "text/csv" });
  }

  renderImportExport() {
    const fileElem = new ElementWrapper("div", { class: "file block" });
    const fileLabelElem = new ElementWrapper("label", { class: "file-label" });
    const inputElem = new ElementWrapper("input", {
      class: "file-input",
      type: "file",
      id: "csvFileInput",
      accept: ".csv",
    });
    const fileCTA = new ElementWrapper("span", { class: "file-cta" });
    const fileLabelSpanElem = new ElementWrapper("span", {
      class: "file-label",
      text: "Import CSV",
    });
    const fileNameSpanElem = new ElementWrapper("span", {
      class: "file-name",
      id: "fileNameSpanElemId",
      text: "Select CSV file to import",
    });
    const dividerElem = new ElementWrapper("hr", {});

    inputElem.addEvent("input", this.fileInputChange.bind(this));
    fileLabelSpanElem.inject(fileCTA);
    inputElem.inject(fileLabelElem);
    fileCTA.inject(fileLabelElem);
    fileNameSpanElem.inject(fileLabelElem);
    fileLabelElem.inject(fileElem);
    fileElem.inject(this.settingsWithManifest.manifest.textExpansions.bundle);
    if (this.importedElemCount) {
      const block = new ElementWrapper("div", { class: "block" });
      const notification = new ElementWrapper("div", {
        class: "notification is-primary",
        text: "Imported records: " + this.importedElemCount,
      });

      this.importedElemCount = 0;
      notification.inject(block);
      block.inject(this.settingsWithManifest.manifest.textExpansions.bundle);
    }

    const button = new ElementWrapper("a", {
      class: "button",
      href: window.URL.createObjectURL(this.getTextExpansionsAsCSVBlob()),
      text: "Export Text Expander database as CSV",
      download: "FluentTyperTextExpanderDataBase.csv",
    });
    button.inject(this.settingsWithManifest.manifest.textExpansions.bundle);
    dividerElem.inject(
      this.settingsWithManifest.manifest.textExpansions.bundle
    );
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

  setInputState(element, errMsgStr, isValid) {
    const errMsgNode = document.getElementById(element.id + "ErrMsg");
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
  }

  shortcutInputChange() {
    let isValid = true;
    [
      document.getElementById(this.addNewShortcutIDs[0]),
      document.getElementById(this.addNewShortcutIDs[1]),
    ].forEach((element, index) => {
      let errMsgStr = "";
      if (!element.checkValidity()) {
        isValid = false;
        errMsgStr =
          index === 0
            ? "Please use only letters and numbers (two or less digits), no white space or special characters are allowed, between 1-32 characters."
            : "Shortcut text cannot be empty.";
      }
      this.setInputState(element, errMsgStr, isValid);
    });
    return isValid;
  }

  delShortcut(index) {
    this.textExpansions.splice(index, 1);
    this.saveTextExpansions();
    this.render();
  }

  addNewShortcut(render = true) {
    const shortcatElem = document.getElementById(this.addNewShortcutIDs[0]);
    const shortcatTextElem = document.getElementById(this.addNewShortcutIDs[1]);
    this.shortcutInputChange();
    if (this.shortcutInputChange()) {
      this.textExpansions.unshift([shortcatElem.value, shortcatTextElem.value]);
      this.saveTextExpansions();
      if (render) {
        this.render();
      }
      return true;
    }
    return false;
  }

  render() {
    this.clearRender();

    this.renderImportExport();
    this.renderNode("Shortcut", "Shortcut text", null);
    this.textExpansions.forEach((element, index) => {
      this.renderNode(element[0], element[1], index);
    });
  }
}

export { TextExpander };
