import { Store } from "@core/application/storage/Store.js";
import { getUniqueID } from "@ui/settings-engine/controls/FieldControl.js";
import { i18n } from "./fluenttyperI18n.js";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

type TextExpansionEntry = [string, string];

interface ControlLike {
  rootElement: HTMLElement;
}

interface FancierSettingsLike {
  textExpansions: ControlLike;
}

interface ElementWrapperLike {
  element: HTMLElement;
  inject(parent: ElementWrapperLike | HTMLElement): ElementWrapperLike;
  addEvent(type: string, fn: (...args: unknown[]) => unknown): void;
  set(key: string, value: string | number | boolean): void;
}

interface AddShortcutInputs {
  shortcut: HTMLInputElement | null;
  shortcutText: HTMLTextAreaElement | null;
}

function toElementString(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return null;
}

function createElementWrapper(tag: string, props: Record<string, unknown>): ElementWrapperLike {
  const el = document.createElement(tag);
  const className = toElementString(props.class);
  if (className) {
    el.className = className;
  }
  const type = toElementString(props.type);
  if (type) {
    (el as HTMLInputElement).type = type;
  }
  const id = toElementString(props.id);
  if (id) {
    el.id = id;
  }
  const text = toElementString(props.text);
  if (text) {
    el.textContent = text;
  }
  const href = toElementString(props.href);
  if (href) {
    (el as HTMLAnchorElement).href = href;
  }
  const download = toElementString(props.download);
  if (download) {
    (el as HTMLAnchorElement).download = download;
  }
  if (props.required) {
    (el as HTMLInputElement).required = Boolean(props.required);
  }
  const pattern = toElementString(props.pattern);
  if (pattern) {
    (el as HTMLInputElement).pattern = pattern;
  }
  if (props.maxlength) {
    (el as HTMLInputElement).maxLength = Number(props.maxlength);
  }
  if (props.rows !== undefined && props.rows !== "") {
    (el as HTMLTextAreaElement).rows = Number(props.rows);
  }

  const wrapper: ElementWrapperLike = {
    element: el,
    inject(parent) {
      const parentEl = parent instanceof HTMLElement ? parent : parent.element;
      parentEl.appendChild(el);
      return this;
    },
    addEvent(type, fn) {
      el.addEventListener(type, fn);
    },
    set(key, value) {
      if (key === "placeholder") {
        (el as HTMLInputElement).placeholder = String(value);
      } else if (key === "value") {
        (el as HTMLInputElement).value = String(value);
      } else if (key === "readonly") {
        (el as HTMLInputElement).readOnly = Boolean(value);
      } else if (key === "disabled") {
        (el as HTMLInputElement).disabled = Boolean(value);
      } else {
        el.setAttribute(key, String(value));
      }
    },
  };
  return wrapper;
}

function getAddShortcutInputs(ids: [string, string]): AddShortcutInputs {
  return {
    shortcut: document.getElementById(ids[0]) as HTMLInputElement | null,
    shortcutText: document.getElementById(ids[1]) as HTMLTextAreaElement | null,
  };
}

export class TextExpander {
  private readonly callbackFn: () => void;
  private readonly textExpansionsStoreKey = "textExpansions";
  private readonly addNewShortcutIDs: [string, string] = ["newShortcut", "newShortcatText"];
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

  private get containerElement(): HTMLElement {
    return this.settingsWithManifest.textExpansions.rootElement;
  }

  private clearRender(): void {
    const node = this.containerElement;
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  private fileInputChange(): void {
    const fileInput = document.getElementById("csvFileInput") as HTMLInputElement | null;
    const fileNameSpanElem = document.getElementById("fileNameSpanElemId");
    const file = fileInput?.files?.[0];
    if (!fileInput || !fileNameSpanElem || !file) {
      return;
    }

    fileNameSpanElem.textContent = file.name;
    const reader = new FileReader();
    reader.addEventListener(
      "load",
      () => {
        const csvText = typeof reader.result === "string" ? reader.result : "";
        const parsedData = parse(csvText, {
          skip_records_with_error: true,
          relax_column_count: true,
          columns: false,
          skip_empty_lines: true,
        }) as unknown[][];

        const { shortcut: shortcutElem, shortcutText: shortcutTextElem } = getAddShortcutInputs(
          this.addNewShortcutIDs,
        );
        if (!shortcutElem || !shortcutTextElem) {
          return;
        }

        parsedData.forEach((element) => {
          if (element.length === 2) {
            shortcutElem.value = toElementString(element[0]) ?? "";
            shortcutTextElem.value = toElementString(element[1]) ?? "";
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
    const container = this.containerElement;
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
    fileElem.inject(container);

    if (this.importedElemCount) {
      const block = createElementWrapper("div", { class: "block" });
      const notification = createElementWrapper("div", {
        class: "notification is-primary",
        text: `${i18n.get("text_expander_imported_records")}: ${this.importedElemCount}`,
      });
      this.importedElemCount = 0;
      notification.inject(block);
      block.inject(container);
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

    dividerElem.inject(container);
  }

  private renderNode(key: string, val: string, shortcutIndex: number | null): void {
    const container = this.containerElement;
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
        this.delShortcut(shortcutIndex);
      });
    }

    columnElem.inject(container);
    dividerElem.inject(container);
  }

  private setInputState(
    element: HTMLInputElement | HTMLTextAreaElement,
    errMsgStr: string,
    isValid: boolean,
  ): void {
    const errMsgNode = document.getElementById(`${element.id}ErrMsg`);
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
    const { shortcut: shortcutElem, shortcutText: shortcutTextElem } = getAddShortcutInputs(
      this.addNewShortcutIDs,
    );
    [shortcutElem, shortcutTextElem].forEach((element, index) => {
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
    const { shortcut: shortcutElem, shortcutText: shortcutTextElem } = getAddShortcutInputs(
      this.addNewShortcutIDs,
    );

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
