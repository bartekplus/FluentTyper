import { Store } from "@third-party/fancier-settings/lib/store.js";
import { i18n } from "@third-party/fancier-settings/i18n.js";
import { ElementWrapper, getUniqueID } from "@third-party/fancier-settings/js/classes/utils.js";
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

interface ElementWrapperLike {
  element: HTMLElement;
  inject(parent: ElementWrapperLike | HTMLElement): ElementWrapperLike;
  addEvent(type: string, fn: (...args: unknown[]) => unknown): void;
  set(key: string, value: string | number | boolean): void;
}

function createElementWrapper(tag: string, props: Record<string, unknown>): ElementWrapperLike {
  return new ElementWrapper(tag, props) as unknown as ElementWrapperLike;
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
            .filter(
              (entry): entry is [string, string] =>
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

        const shortcutElem = document.getElementById(
          this.addNewShortcutIDs[0],
        ) as HTMLInputElement | null;
        const shortcutTextElem = document.getElementById(
          this.addNewShortcutIDs[1],
        ) as HTMLTextAreaElement | null;
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
    const fileElem = createElementWrapper("div", {
      class: "file block buttons",
    });
    const fileLabelElem = createElementWrapper("label", {
      class: "file-label",
    });
    const inputElem = createElementWrapper("input", {
      class: "file-input",
      type: "file",
      id: "csvFileInput",
      accept: ".csv",
    });
    const fileCTA = createElementWrapper("span", { class: "file-cta" });
    const fileLabelSpanElem = createElementWrapper("span", {
      class: "file-label",
      text: i18n.get("text_expander_import_csv_btn"),
    });
    const fileNameSpanElem = createElementWrapper("span", {
      class: "file-name",
      id: "fileNameSpanElemId",
      text: i18n.get("text_expander_import_csv_placeholder"),
    });
    const dividerElem = createElementWrapper("hr", {});

    inputElem.addEvent("input", this.fileInputChange.bind(this));
    fileLabelSpanElem.inject(fileCTA);
    inputElem.inject(fileLabelElem);
    fileCTA.inject(fileLabelElem);
    fileNameSpanElem.inject(fileLabelElem);
    fileLabelElem.inject(fileElem);
    fileElem.inject(this.settingsWithManifest.manifest.textExpansions.bundle.element);

    if (this.importedElemCount) {
      const block = createElementWrapper("div", { class: "block" });
      const notification = createElementWrapper("div", {
        class: "notification is-primary",
        text: `${i18n.get("text_expander_imported_records")}: ${this.importedElemCount}`,
      });
      this.importedElemCount = 0;
      notification.inject(block);
      block.inject(this.settingsWithManifest.manifest.textExpansions.bundle.element);
    }

    const button = createElementWrapper("a", {
      class: "button",
      href: window.URL.createObjectURL(this.getTextExpansionsAsCSVBlob()),
      text: i18n.get("text_expander_export_csv_btn"),
      download: "FluentTyperTextExpanderDataBase.csv",
    });
    button.inject(fileElem);

    const buttonRemoveAll = createElementWrapper("a", {
      class: "button is-danger",
      text: i18n.get("text_expander_remove_all_btn"),
    });
    buttonRemoveAll.inject(fileElem);
    buttonRemoveAll.addEvent("click", this.delAllShortcuts.bind(this));

    dividerElem.inject(this.settingsWithManifest.manifest.textExpansions.bundle.element);
  }

  private renderNode(key: string, val: string, shortcutIndex: number | null): void {
    const dividerElem = createElementWrapper("hr", {});
    const columnElem = createElementWrapper("div", {
      class: "columns is-expanded",
    });
    const columnsElems: ElementWrapperLike[] = [];

    for (let index = 0; index < 3; index += 1) {
      let columnClass = "column";
      if (index === 0) {
        columnClass += " is-5";
      }
      if (index === 1) {
        columnClass += " is-6";
      }
      if (index === 2) {
        columnClass += " has-text-centered ";
      }
      columnsElems[index] = createElementWrapper("div", {
        class: columnClass,
      });
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
      const fieldElem = createElementWrapper("div", { class: "field" });
      const controlElem = createElementWrapper("p", {
        class: "control is-expanded",
      });
      const inputElem = createElementWrapper(input.type, {
        id: input.id,
        idErrMsg,
        class: input.class,
        contentEditable: false,
        required: true,
        pattern: input.pattern,
        maxlength: input.maxLength,
        rows: input.rows,
      });
      const errMsgNode = createElementWrapper("p", {
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

    const button = createElementWrapper("a", {
      class: `button is-fullwidth${newNode ? " is-success" : " is-danger"}`,
      text: newNode ? i18n.get("add") : i18n.get("remove"),
    });
    button.inject(columnsElems[2]);
    if (newNode) {
      button.addEvent("click", () => {
        this.addNewShortcut();
      });
    } else {
      button.addEvent("click", () => {
        this.delShortcut(shortcutIndex as number);
      });
    }

    columnElem.inject(this.settingsWithManifest.manifest.textExpansions.bundle.element);
    dividerElem.inject(this.settingsWithManifest.manifest.textExpansions.bundle.element);
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
    const shortcutElem = document.getElementById(
      this.addNewShortcutIDs[0],
    ) as HTMLInputElement | null;
    const shortcutTextElem = document.getElementById(
      this.addNewShortcutIDs[1],
    ) as HTMLTextAreaElement | null;

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
