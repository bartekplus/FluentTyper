import type { ValueOnlyConfig } from "../types.js";
import type { Store } from "@core/application/storage/Store.js";
import { BaseControl, createFieldRoot, createInputElement } from "./FieldControl.js";

/**
 * Invisible control — stores a value in chrome.storage with no UI widget.
 * The rootElement is a visible empty <div> (can serve as a render container).
 * The element is a <input type="hidden"> inside it.
 */
export class ValueOnlyControl extends BaseControl<unknown> {
  private _value: unknown;

  constructor(params: ValueOnlyConfig, store: Store) {
    super(params, store);

    const root = createFieldRoot("");
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
    this.emitter.fireEvent("change", value);
    if (!silent) {
      this.persistToStorage(value);
      this.emitter.fireEvent("action", value);
    }
    return this;
  }
}
