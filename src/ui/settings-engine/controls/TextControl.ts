import type { TextConfig } from "../types.js";
import type { Store } from "@core/application/storage/Store.js";
import { BaseControl } from "./FieldControl.js";

export class TextControl extends BaseControl<string> {
  private hexLabel?: HTMLSpanElement;

  constructor(params: TextConfig, store: Store) {
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

    const input = document.createElement("input");
    input.type = "text";
    input.className = params.colorPicker ? "color" : "input";

    if (params.text) {
      input.placeholder = params.text;
    }
    if (params.masked) {
      input.type = "password";
    }
    if (params.subtype) {
      input.type = params.subtype;
    }
    if (params.pattern) {
      input.pattern = params.pattern;
    }
    if (params.required) {
      input.required = true;
    }

    // Color picker UX: live hex label
    if (params.subtype === "color") {
      const wrapper = document.createElement("div");
      wrapper.className = "color-input-wrapper";
      wrapper.appendChild(input);

      this.hexLabel = document.createElement("span");
      this.hexLabel.className = "color-hex-label";
      wrapper.appendChild(this.hexLabel);
      control.appendChild(wrapper);
    } else {
      control.appendChild(input);
    }

    root.appendChild(control);

    // Error message element (hidden by default)
    const errorEl = document.createElement("p");
    errorEl.className = "help is-danger field-error-msg";
    errorEl.style.display = "none";
    root.appendChild(errorEl);

    const handleChange = (): void => {
      const valid = input.checkValidity();
      input.classList.toggle("is-success", valid);
      input.classList.toggle("is-danger", !valid);

      if (!valid) {
        errorEl.textContent = input.validationMessage || "Invalid value";
        errorEl.style.display = "";
      } else {
        errorEl.style.display = "none";
      }

      if (params.store !== false) {
        this.persistToStorage(this.get());
      }

      if (this.hexLabel) {
        this.hexLabel.textContent = input.value.toUpperCase();
      }

      this.emitter.fireEvent("action", this.get());
    };

    input.addEventListener("change", handleChange);
    input.addEventListener("keyup", handleChange);

    this._element = input;

    void this.loadFromStorage();
  }

  get(): string {
    return (this._element as HTMLInputElement).value;
  }

  set(value: string, silent?: boolean): this {
    (this._element as HTMLInputElement).value = String(value ?? "");
    if (this.hexLabel) {
      this.hexLabel.textContent = String(value ?? "").toUpperCase();
    }
    if (!silent) {
      this._element.dispatchEvent(new Event("change"));
    }
    return this;
  }
}
