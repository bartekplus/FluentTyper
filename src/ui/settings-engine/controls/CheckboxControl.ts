import type { CheckboxConfig } from "../types.js";
import type { Store } from "@core/application/storage/Store.js";
import { createElement } from "../dom/createElement.js";
import { BaseControl, appendLabel, createInputElement, getUniqueID } from "./FieldControl.js";

export class CheckboxControl extends BaseControl<boolean> {
  constructor(params: CheckboxConfig, store: Store) {
    super(params, store);

    const root = createElement("div", { className: "field" });
    this._rootElement = root;

    const control = createElement("div", { className: "control" });

    const id = getUniqueID();

    const input = createInputElement("checkbox", "switch");
    input.id = id;
    input.setAttribute("role", "switch");

    control.appendChild(input);
    const label = appendLabel(control, params.label);
    if (label) {
      label.htmlFor = id;
    }

    input.addEventListener("change", () => {
      const value = this.get();
      this.persistToStorage(value);
      this.emitter.fireEvent("action", value);
    });

    root.appendChild(control);
    this._element = input;

    void this.loadFromStorage();
  }

  get(): boolean {
    return (this._element as HTMLInputElement).checked;
  }

  set(value: boolean, silent?: boolean): this {
    (this._element as HTMLInputElement).checked = Boolean(value);
    if (!silent) {
      this._element.dispatchEvent(new Event("change"));
    }
    return this;
  }
}
