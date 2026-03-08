import type { CheckboxConfig } from "../types.js";
import type { Store } from "../store/Store.js";
import { BaseControl, getUniqueID } from "./FieldControl.js";

export class CheckboxControl extends BaseControl<boolean> {
  constructor(params: CheckboxConfig, store: Store) {
    super(params, store);

    const root = document.createElement("div");
    root.className = "field";
    this._rootElement = root;

    const control = document.createElement("div");
    control.className = "control";

    const id = getUniqueID();

    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "switch";
    input.id = id;
    input.name = id;
    input.value = "true";
    input.setAttribute("role", "switch");

    const label = document.createElement("label");
    label.htmlFor = id;

    if (params.label) {
      label.innerHTML = params.label;
    }

    input.addEventListener("change", () => {
      const value = this.get();
      if (params.name !== undefined) {
        this.persistToStorage(value);
      }
      this.emitter.fireEvent("action", value);
    });

    control.appendChild(input);
    if (params.label) {
      control.appendChild(label);
    }
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
