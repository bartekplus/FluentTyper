import type { RadioConfig } from "../types.js";
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

export class RadioControl extends BaseControl<string> {
  private readonly radios: HTMLInputElement[] = [];

  constructor(params: RadioConfig, store: Store) {
    super(params, store);

    const root = createFieldRoot();
    this._rootElement = root;

    const control = createControlContainer();
    root.appendChild(control);

    const groupId = getUniqueID();

    appendLabel(control, params.label);

    for (const [value, text] of params.options ?? []) {
      const optionId = getUniqueID();
      const radioLabel = document.createElement("label");
      radioLabel.className = "radio";

      const radio = createInputElement("radio");
      radio.id = optionId;
      radio.name = groupId;
      radio.value = value;
      radio.setAttribute("aria-label", text);

      const span = document.createElement("span");
      span.textContent = ` ${text} `;

      radioLabel.appendChild(radio);
      radioLabel.appendChild(span);
      control.appendChild(radioLabel);
      this.radios.push(radio);
    }

    // Use event delegation on the control container
    control.addEventListener("change", () => {
      if (params.name !== undefined) {
        this.persistToStorage(this.get());
      }
      this.emitter.fireEvent("action", this.get());
    });

    // element is the container (no single input for radio groups)
    this._element = control;

    void this.loadFromStorage();
  }

  get(): string {
    return this.radios.find((r) => r.checked)?.value ?? "";
  }

  set(value: string, silent?: boolean): this {
    const target = this.radios.find((r) => r.value === value);
    if (target) {
      target.checked = true;
    }
    if (!silent) {
      dispatchControlEvent(this._element, "change");
    }
    return this;
  }
}
