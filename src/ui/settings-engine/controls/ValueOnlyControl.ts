import type { ValueOnlyConfig } from "../types.js";
import type { Store } from "@core/application/storage/Store.js";
import { createElement } from "../dom/createElement.js";
import { BaseControl, createInputElement } from "./FieldControl.js";

export class ValueOnlyControl extends BaseControl<unknown> {
  private _value: unknown;

  constructor(params: ValueOnlyConfig, store: Store) {
    super(params, store);

    const root = createElement("div");
    this._rootElement = root;

    const input = createInputElement("hidden");
    root.appendChild(input);
    this._element = input;

    void this.loadFromStorage();
  }

  get(): unknown {
    return this._value;
  }

  set(value: unknown, silent?: boolean): this {
    this._value = value;
    // Start the write before "change", so that a listener that reads the store gets the new value.
    if (!silent) {
      this.persistToStorage(value);
    }
    this.emitter.fireEvent("change", value);
    if (!silent) {
      this.emitter.fireEvent("action", value);
    }
    return this;
  }
}
