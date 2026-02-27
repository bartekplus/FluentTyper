/* eslint-disable @typescript-eslint/no-explicit-any */
import { Store } from "@third-party/fancier-settings/lib/store.js";
import { i18n } from "@third-party/fancier-settings/i18n.js";
import {
  ElementWrapper,
  getUniqueID,
} from "@third-party/fancier-settings/js/classes/utils.js";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

type TextExpansionEntry = [string, string];

interface FancierBundleLike {
  element: HTMLElement;
}

interface FancierSettingsLike {
  manifest: {
    textExpansions: {
      bundle: FancierBundleLike;
    };
  };
}

export class TextExpander {
  private readonly callbackFn: () => void;
  private readonly textExpansionsStoreKey = "textExpansions";
  private readonly addNewShortcutIDs = ["newShortcut", "newShortcatText"];
  private readonly store: Store;
  private readonly settingsWithManifest: FancierSettingsLike;
  private importedElemCount = 0;
  private textExpansions: TextExpansionEntry[] = [];

  constructor(settings: FancierSettingsLike, callbackFn: () => void) {
    this.callbackFn = callbackFn;
    this.store = new Store("settings");
    this.settingsWithManifest = settings;
    void this.getTextExpansions();
  }

  private async getTextExpansions(): Promise<void> {
    try {
      const value = await this.store.get(this.textExpansionsStoreKey);
      this.textExpansions = Array.isArray(value)
        ? value
            .filter((entry): entry is [string, string] =>
              Array.isArray(entry) &&
              entry.length === 2 &&
              typeof entry[0] === "string" &&
              typeof entry[1] === "string",
            )
            .map(([shortcut, text]) => [shortcut, text])
        : [];
      this.render();
    } catch (error) {
      console.error(error);
    }
  }

  private saveTextExpansions(): void {
    void this.store.set(this.textExpansionsStoreKey, this.textExpansions);
    this.callbackFn();
  }

  private clearRender(): void {
    const node = this.settingsWithManifest.manifest.textExpansions.bundle.element;
    const clonedNode = node.cloneNode(false) as HTMLElement;
    node.parentNode?.replaceChild(clonedNode, node);
    this.settingsWithManifest.manifest.textExpansions.bundle.element = clonedNode;
  }

  private fileInputChange(): void {
    const fileInput = document.getElementById("csvFileInput") as HTMLInputElement | null;
    const fileNameSpanElem = document.getElementById("fileNameSpanElemId") as HTMLElement | null;
    const file = fileInput?.files?.[0];
    if (!fileInput || !fileNameSpanElem || !file) {
      return;
    }

    fileNameSpanElem.textContent = file.name;
    const reader = new FileReader();
    reader.addEventListener(
      "load",
      () => {
        const parsedData = parse(reader.result as string, {
          skip_records_with_error: true,
          relax_column_count: true,
          columns: false,
          skip_empty_lines: true,
        }) as unknown[][];

        const shortcutElem = document.getElementById(this.addNewShortcutIDs[0]) as HTMLInputElement | null;
        const shortcutTextElem = document.getElementById(this.addNewShortcutIDs[1]) as HTMLTextAreaElement | null;
        if (!shortcutElem || !shortcutTextElem) {
          return;
        }

        parsedData.forEach((element) => {
          if (element.length === 2) {
            shortcutElem.value = String(element[0]);
            shortcutTextElem.value = String(element[1]);
            if (this.addNewShortcut(false)) {
              this.importedElemCount += 1;
            }
          }
        });

        this.saveTextExpansions();
        this.render();
      },
      false,
    );

    reader.readAsText(file);
  }

  private getTextExpansionsAsCSVBlob(): Blob {
    const csvData = stringify(this.textExpansions);
    return new Blob([csvData], { type: "text/csv" });
  }

  private renderImportExport(): void {
    const fileElem = new ElementWrapper("div", { class: "file block buttons" }) as any;
    const fileLabelElem = new ElementWrapper("label", { class: "file-label" }) as any;
    const inputElem = new ElementWrapper("input", {
      class: "file-input",
      type: "file",
      id: "csvFileInput",
      accept: ".csv",
    }) as any;
    const fileCTA = new ElementWrapper("span", { class: "file-cta" }) as any;
    const fileLabelSpanElem = new ElementWrapper("span", {
      class: "file-label",
      text: i18n.get("text_expander_import_csv_btn"),
    }) as any;
    const fileNameSpanElem = new ElementWrapper("span", {
      class: "file-name",
      id: "fileNameSpanElemId",
      text: i18n.get("text_expander_import_csv_placeholder"),
    }) as any;
    const dividerElem = new ElementWrapper("hr", {}) as any;

    inputElem.addEvent("input", this.fileInputChange.bind(this));
    fileLabelSpanElem.inject(fileCTA);
    inputElem.inject(fileLabelElem);
    fileCTA.inject(fileLabelElem);
    fileNameSpanElem.inject(fileLabelElem);
    fileLabelElem.inject(fileElem);
    fileElem.inject(this.settingsWithManifest.manifest.textExpansions.bundle as any);

    if (this.importedElemCount) {
      const block = new ElementWrapper("div", { class: "block" }) as any;
      const notification = new ElementWrapper("div", {
        class: "notification is-primary",
        text: `${i18n.get("text_expander_imported_records")}: ${this.importedElemCount}`,
      }) as any;
      this.importedElemCount = 0;
      notification.inject(block);
      block.inject(this.settingsWithManifest.manifest.textExpansions.bundle as any);
    }

    const button = new ElementWrapper("a", {
      class: "button",
      href: window.URL.createObjectURL(this.getTextExpansionsAsCSVBlob()),
      text: i18n.get("text_expander_export_csv_btn"),
      download: "FluentTyperTextExpanderDataBase.csv",
    }) as any;
    button.inject(fileElem);

    const buttonRemoveAll = new ElementWrapper("a", {
      class: "button is-danger",
      text: i18n.get("text_expander_remove_all_btn"),
    }) as any;
    buttonRemoveAll.inject(fileElem);
    buttonRemoveAll.addEvent("click", this.delAllShortcuts.bind(this));

    dividerElem.inject(this.settingsWithManifest.manifest.textExpansions.bundle as any);
  }

  private renderNode(key: string, val: string, shortcutIndex: number | null): void {
    const dividerElem = new ElementWrapper("hr", {}) as any;
    const columnElem = new ElementWrapper("div", { class: "columns is-expanded" }) as any;
    const columnsElems: any[] = [];

    for (let index = 0; index < 3; index += 1) {
      let columnClass = "column";
      if (index === 0) columnClass += " is-5";
      if (index === 1) columnClass += " is-6";
      if (index === 2) columnClass += " has-text-centered ";
      columnsElems[index] = new ElementWrapper("div", { class: columnClass }) as any;
      columnsElems[index].inject(columnElem);
    }

    const newNode = shortcutIndex === null;
    [
      {
        type: "input",
        id: newNode ? this.addNewShortcutIDs[0] : getUniqueID(),
        class: "input",
        pattern: "[\\p{L}\\p{M}]*",
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
      const idErrMsg = `${input.id}ErrMsg`;
      const fieldElem = new ElementWrapper("div", { class: "field" }) as any;
      const controlElem = new ElementWrapper("p", { class: "control is-expanded" }) as any;
      const inputElem = new ElementWrapper(input.type, {
        id: input.id,
        idErrMsg,
        class: input.class,
        contentEditable: false,
        required: true,
        pattern: input.pattern,
        maxlength: input.maxLength,
        rows: input.rows,
      }) as any;
      const errMsgNode = new ElementWrapper("p", {
        id: idErrMsg,
        class: "help is-danger is-hidden",
      }) as any;

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
      class: `button is-fullwidth${newNode ? " is-success" : " is-danger"}`,
      text: newNode ? i18n.get("add") : i18n.get("remove"),
    }) as any;
    button.inject(columnsElems[2]);
    if (newNode) {
      button.addEvent("click", this.addNewShortcut.bind(this));
    } else {
      button.addEvent("click", this.delShortcut.bind(this, shortcutIndex));
    }

    columnElem.inject(this.settingsWithManifest.manifest.textExpansions.bundle as any);
    dividerElem.inject(this.settingsWithManifest.manifest.textExpansions.bundle as any);
  }

  private setInputState(
    element: HTMLInputElement | HTMLTextAreaElement,
    errMsgStr: string,
    isValid: boolean,
  ): void {
    const errMsgNode = document.getElementById(`${element.id}ErrMsg`) as HTMLElement | null;
    if (!errMsgNode) {
      return;
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
  }

  private shortcutInputChange(): boolean {
    let isValid = true;
    [
      document.getElementById(this.addNewShortcutIDs[0]) as HTMLInputElement | null,
      document.getElementById(this.addNewShortcutIDs[1]) as HTMLTextAreaElement | null,
    ].forEach((element, index) => {
      if (!element) {
        return;
      }
      let errMsgStr = "";
      if (!element.checkValidity()) {
        isValid = false;
        errMsgStr =
          index === 0
            ? i18n.get("text_expander_shortcut_validation_error")
            : i18n.get("text_expander_shortcut_text_validation_error");
      }
      this.setInputState(element, errMsgStr, isValid);
    });
    return isValid;
  }

  private delShortcut(index: number): void {
    this.textExpansions.splice(index, 1);
    this.saveTextExpansions();
    this.render();
  }

  private delAllShortcuts(): void {
    this.textExpansions = [];
    this.saveTextExpansions();
    this.render();
  }

  private addNewShortcut(renderAndSave = true): boolean {
    const shortcutElem = document.getElementById(this.addNewShortcutIDs[0]) as HTMLInputElement | null;
    const shortcutTextElem = document.getElementById(this.addNewShortcutIDs[1]) as HTMLTextAreaElement | null;

    if (!shortcutElem || !shortcutTextElem) {
      return false;
    }

    if (this.shortcutInputChange()) {
      this.textExpansions.unshift([shortcutElem.value, shortcutTextElem.value]);
      if (renderAndSave) {
        this.saveTextExpansions();
        this.render();
      }
      return true;
    }
    return false;
  }

  render(): void {
    this.clearRender();
    this.renderImportExport();
    this.renderNode(
      i18n.get("text_expander_shortcut_placeholder"),
      i18n.get("text_expander_shortcut_text_placeholder"),
      null,
    );
    this.textExpansions.forEach((element, index) => {
      this.renderNode(element[0], element[1], index);
    });
  }
}
