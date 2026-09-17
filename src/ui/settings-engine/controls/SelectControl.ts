import type { SelectConfig } from "../types.js";
import type { Store } from "@core/application/storage/Store.js";
import {
  BaseControl,
  appendLabel,
  createControlContainer,
  createFieldRoot,
  createOptionElement,
  dispatchControlEvent,
} from "./FieldControl.js";

function toAriaLabel(label?: string): string {
  if (!label) {
    return "";
  }
  return label
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export class SelectControl extends BaseControl<string> {
  private readonly selectEl: HTMLSelectElement;

  constructor(params: SelectConfig, store: Store) {
    super(params, store);

    const root = createFieldRoot();
    this._rootElement = root;

    appendLabel(root, params.label);

    const control = createControlContainer();

    const wrapper = document.createElement("div");
    wrapper.className = "select";

    const select = document.createElement("select");
    select.setAttribute("aria-label", toAriaLabel(params.label));

    for (const [value, text] of params.options ?? []) {
      select.appendChild(createOptionElement(value, text ?? value));
    }

    select.addEventListener("change", () => {
      this.persistToStorage(this.get());
      this.emitter.fireEvent("action", this.get());
    });

    wrapper.appendChild(select);
    control.appendChild(wrapper);
    root.appendChild(control);
    this._element = select;
    this.selectEl = select;

    void this.loadFromStorage();
  }

  get(): string {
    return this.selectEl.value;
  }

  set(value: string, silent?: boolean): this {
    this.selectEl.value = String(value ?? "");
    if (!silent) {
      dispatchControlEvent(this.selectEl, "change");
    }
    return this;
  }
}
