import type { ValueOnlyConfig } from "../types.js";
import type { Store } from "@core/application/storage/Store.js";
import { createElement } from "../dom/createElement.js";
import { BaseControl } from "./FieldControl.js";

export class ValueOnlyControl extends BaseControl<unknown> {
  private _value: unknown;

  constructor(params: ValueOnlyConfig, store: Store) {
    super(params, store);

    this._rootElement = createElement("div");
    this._element = this._rootElement;

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
