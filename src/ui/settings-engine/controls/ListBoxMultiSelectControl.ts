import type { ListBoxMultiselectConfig, OptionEntry } from "../types.js";
import type { Store } from "@core/application/storage/Store.js";
import {
  BaseControl,
  appendLabel,
  createControlContainer,
  createFieldRoot,
  createOptionElement,
} from "./FieldControl.js";

function appendOption(select: HTMLSelectElement, option: OptionEntry): void {
  select.appendChild(createOptionElement(option.value, option.text ?? option.value));
}

export class ListBoxMultiSelectControl extends BaseControl<string[]> {
  private readonly selectEl: HTMLSelectElement;

  constructor(params: ListBoxMultiselectConfig, store: Store) {
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
      for (const optionGroup of options) {
        for (const option of optionGroup) {
          appendOption(select, option);
        }
      }
      return;
    }

    const optObj = options;
    for (const opt of optObj.values ?? []) {
      appendOption(select, opt);
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
