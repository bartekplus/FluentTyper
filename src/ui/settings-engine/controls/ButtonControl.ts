import type { ButtonConfig } from "../types.js";
import type { Store } from "@core/application/storage/Store.js";
import { BaseControl } from "./FieldControl.js";

export class ButtonControl extends BaseControl<string> {
  constructor(params: ButtonConfig, store: Store) {
    super(params, store);

    const root = document.createElement("div");
    root.className = "field";
    this._rootElement = root;

    const control = document.createElement("div");
    control.className = "control";

    if (params.label) {
      const label = document.createElement("label");
      label.className = "label";
      label.innerHTML = params.label;
      control.appendChild(label);
    }

    const btn = document.createElement("input");
    btn.type = "button";
    btn.className = "button is-primary";
    if (params.text) {
      btn.value = params.text;
    }

    btn.addEventListener("click", () => {
      this.emitter.fireEvent("action", this.get());
    });

    control.appendChild(btn);
    root.appendChild(control);
    this._element = btn;
  }

  get(): string {
    return (this._element as HTMLInputElement).value;
  }

  set(value: string): this {
    (this._element as HTMLInputElement).value = value;
    return this;
  }
}
