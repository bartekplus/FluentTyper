import type { ListBoxConfig } from "../types.js";
import type { Store } from "@core/application/storage/Store.js";
import type { ListBoxFieldControl } from "./FieldControl.js";
import {
  BaseControl,
  appendLabel,
  createControlContainer,
  createFieldRoot,
  createOptionElement,
} from "./FieldControl.js";

export class ListBoxControl extends BaseControl<string[]> implements ListBoxFieldControl {
  private readonly selectEl: HTMLSelectElement;
  private options: string[] = [];
  private selected: HTMLOptionElement[] = [];

  constructor(params: ListBoxConfig, store: Store) {
    super(params, store);

    const root = createFieldRoot();
    this._rootElement = root;

    appendLabel(root, params.label);

    const control = createControlContainer();

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
    this.selectEl.appendChild(createOptionElement(value));
  }

  private persistOptions(): void {
    if (this.name !== undefined) {
      void this.storage.set(this.name, this.options);
    }
    this.emitter.fireEvent("action", this.get());
  }

  add(value: string, storeValue = true): void {
    if (!this.options.includes(value)) {
      this.options.push(value);
      this.appendOption(value);
      if (storeValue) {
        this.persistOptions();
      }
    }
  }

  persist(): void {
    this.persistOptions();
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
    this.persistOptions();
  }

  removeAll(): void {
    this.options = [];
    this.selectEl.replaceChildren();
    this.selected = [];
    this.persistOptions();
  }

  get(): string[] {
    return [...this.options];
  }

  set(): this {
    // ListBox manages items imperatively via add/remove
    return this;
  }
}
