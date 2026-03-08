import type { ListBoxMultiselectConfig, OptionEntry } from "../types.js";
import type { Store } from "@core/application/storage/Store.js";
import { BaseControl } from "./FieldControl.js";

export class ListBoxMultiSelectControl extends BaseControl<string[]> {
  private readonly selectEl: HTMLSelectElement;

  constructor(params: ListBoxMultiselectConfig, store: Store) {
    super(params, store);

    const root = document.createElement("div");
    root.className = "field";
    this._rootElement = root;

    if (params.label) {
      const label = document.createElement("label");
      label.className = "label";
      label.innerHTML = params.label;
      root.appendChild(label);
    }

    const control = document.createElement("div");
    control.className = "control";

    const wrapper = document.createElement("div");
    wrapper.className = "select is-multiple is-fullwidth";

    const select = document.createElement("select");
    select.multiple = true;
    select.size = 10;
    select.setAttribute("aria-label", params.label ?? "multi-select list");

    if (params.options) {
      this.populateOptions(select, params.options);
    }

    select.addEventListener("change", () => {
      const value = this.get();
      this.persistToStorage(value);
      this.emitter.fireEvent("action", value);
    });

    wrapper.appendChild(select);
    control.appendChild(wrapper);
    root.appendChild(control);

    this._element = select;
    this.selectEl = select;

    void this.loadFromStorage();
  }

  private populateOptions(
    select: HTMLSelectElement,
    options: ListBoxMultiselectConfig["options"],
  ): void {
    if (!options) {
      return;
    }

    if (Array.isArray(options)) {
      for (const opt of options as [string, string][]) {
        const el = document.createElement("option");
        el.value = opt[0];
        el.text = opt[1] ?? opt[0];
        select.appendChild(el);
      }
      return;
    }

    const optObj = options as { groups?: string[]; values: OptionEntry[] };
    for (const opt of optObj.values ?? []) {
      const el = document.createElement("option");
      el.value = opt.value;
      el.text = opt.text ?? opt.value;
      select.appendChild(el);
    }
  }

  get(): string[] {
    return Array.from(this.selectEl.options)
      .filter((o) => o.selected)
      .map((o) => o.value);
  }

  set(values: string[], silent?: boolean): this {
    const selected = new Set(Array.isArray(values) ? values.map(String) : []);
    for (const opt of Array.from(this.selectEl.options)) {
      opt.selected = selected.has(opt.value);
    }
    if (!silent) {
      this.selectEl.dispatchEvent(new Event("change"));
    }
    return this;
  }
}
