import type { ListBoxConfig } from "../types.js";
import type { Store } from "../store/Store.js";
import type { ListBoxFieldControl } from "./FieldControl.js";
import { BaseControl } from "./FieldControl.js";

export class ListBoxControl extends BaseControl<string[]> implements ListBoxFieldControl {
  private readonly selectEl: HTMLSelectElement;
  private options: string[] = [];
  private selected: HTMLOptionElement[] = [];

  constructor(params: ListBoxConfig, store: Store) {
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
    select.setAttribute("aria-label", params.label ?? "list");

    select.addEventListener("change", () => {
      this.selected = Array.from(select.options).filter((o) => o.selected);
      this.emitter.fireEvent("action", this.get());
    });

    wrapper.appendChild(select);
    control.appendChild(wrapper);
    root.appendChild(control);

    this._element = select;
    this.selectEl = select;

    // Load items from storage asynchronously
    if (params.name !== undefined) {
      store
        .get(params.name)
        .then((initParams) => {
          if (Array.isArray(initParams)) {
            this.options = initParams as string[];
            for (const item of this.options) {
              if (item) {
                this.appendOption(item);
              }
            }
          }
        })
        .catch(console.error);
    }
  }

  private appendOption(value: string): void {
    const opt = document.createElement("option");
    opt.value = value;
    opt.text = value;
    this.selectEl.appendChild(opt);
  }

  add(value: string, storeValue = true): void {
    if (!this.options.includes(value)) {
      this.options.push(value);
      this.appendOption(value);
      if (storeValue) {
        this.store();
      }
    }
  }

  store(): void {
    if (this.name !== undefined) {
      void this.store.set(this.name, this.options);
    }
    this.emitter.fireEvent("action", this.get());
  }

  remove(): void {
    for (const opt of this.selected) {
      const idx = this.options.indexOf(opt.value);
      if (idx !== -1) {
        this.options.splice(idx, 1);
        opt.remove();
      }
    }
    this.selected = [];
    if (this.name !== undefined) {
      void this.store.set(this.name, this.options);
    }
    this.emitter.fireEvent("action", this.get());
  }

  removeAll(): void {
    this.options = [];
    while (this.selectEl.firstChild) {
      this.selectEl.removeChild(this.selectEl.firstChild);
    }
    this.selected = [];
    if (this.name !== undefined) {
      void this.store.set(this.name, this.options);
    }
    this.emitter.fireEvent("action", this.get());
  }

  get(): string[] {
    return [...this.options];
  }

  set(): this {
    // ListBox manages items imperatively via add/remove
    return this;
  }
}
