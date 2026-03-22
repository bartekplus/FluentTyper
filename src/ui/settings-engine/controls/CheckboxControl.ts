import type { CheckboxConfig } from "../types.js";
import type { Store } from "@core/application/storage/Store.js";
import {
  BaseControl,
  appendLabel,
  createControlContainer,
  createFieldRoot,
  createInputElement,
  dispatchControlEvent,
  getUniqueID,
} from "./FieldControl.js";

export class CheckboxControl extends BaseControl<boolean> {
  constructor(params: CheckboxConfig, store: Store) {
    super(params, store);

    const root = createFieldRoot();
    this._rootElement = root;

    const control = createControlContainer();

    const id = getUniqueID();

    const input = createInputElement("checkbox", "switch");
    input.id = id;
    input.name = id;
    input.value = "true";
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
      dispatchControlEvent(this._element, "change");
    }
    return this;
  }
}
