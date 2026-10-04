import type { SelectConfig } from "../types.js";
import type { Store } from "@core/application/storage/Store.js";
import { createElement } from "../dom/createElement.js";
import { BaseControl, appendLabel } from "./FieldControl.js";

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

    const root = createElement("div", { className: "field" });
    this._rootElement = root;

    appendLabel(root, params.label);

    const control = createElement("div", { className: "control" });

    const wrapper = createElement("div", { className: "select" });

    const select = document.createElement("select");
    select.setAttribute("aria-label", toAriaLabel(params.label));

    for (const [value, text] of params.options ?? []) {
      select.add(new window.Option(text, value));
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
