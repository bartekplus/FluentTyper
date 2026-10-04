import type { SelectConfig } from "../types.js";
import type { Store } from "@core/application/storage/Store.js";
import { createElement } from "../dom/createElement.js";
import { BaseControl, appendLabel, getUniqueID } from "./FieldControl.js";

export class SelectControl extends BaseControl<string> {
  private readonly selectEl: HTMLSelectElement;

  constructor(params: SelectConfig, store: Store) {
    super(params, store);

    const root = createElement("div", { className: "field" });
    this._rootElement = root;

    const label = appendLabel(root, params.label);

    const control = createElement("div", { className: "control" });

    const wrapper = createElement("div", { className: "select" });

    const select = document.createElement("select");
    select.id = getUniqueID();
    if (label) {
      label.htmlFor = select.id;
    }

    for (const [value, text] of params.options ?? []) {
      select.add(new Option(text, value));
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
      this.selectEl.dispatchEvent(new Event("change"));
    }
    return this;
  }
}
