import type { ButtonConfig } from "../types.js";
import type { Store } from "@core/application/storage/Store.js";
import {
  BaseControl,
  appendLabel,
  createControlContainer,
  createFieldRoot,
  createInputElement,
} from "./FieldControl.js";

export class ButtonControl extends BaseControl<string> {
  constructor(params: ButtonConfig, store: Store) {
    super(params, store);

    const root = createFieldRoot();
    this._rootElement = root;

    const control = createControlContainer();
    appendLabel(control, params.label);

    const btn = createInputElement("button", "button is-primary");
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
