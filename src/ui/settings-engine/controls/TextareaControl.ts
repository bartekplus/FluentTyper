import type { TextareaConfig } from "../types.js";
import type { Store } from "../store/Store.js";
import { BaseControl } from "./FieldControl.js";

export class TextareaControl extends BaseControl<string> {
  constructor(params: TextareaConfig, store: Store) {
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

    const textarea = document.createElement("textarea");
    textarea.className = "textarea";
    if (params.text) {
      textarea.placeholder = params.text;
    }

    const handleChange = (): void => {
      this.persistToStorage(this.get());
      this.emitter.fireEvent("action", this.get());
    };

    textarea.addEventListener("change", handleChange);
    textarea.addEventListener("keyup", handleChange);

    control.appendChild(textarea);
    root.appendChild(control);
    this._element = textarea;

    void this.loadFromStorage();
  }

  get(): string {
    return (this._element as HTMLTextAreaElement).value;
  }

  set(value: string, silent?: boolean): this {
    (this._element as HTMLTextAreaElement).value = String(value ?? "");
    if (!silent) {
      this._element.dispatchEvent(new Event("change"));
    }
    return this;
  }
}
