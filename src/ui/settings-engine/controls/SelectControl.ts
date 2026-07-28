import type { SelectConfig } from "../types.js";
import type { Store } from "@core/application/storage/Store.js";
import type { SelectFieldControl } from "./FieldControl.js";
import {
  BaseControl,
  appendLabel,
  createControlContainer,
  createFieldRoot,
  createOptionElement,
  dispatchControlEvent,
} from "./FieldControl.js";

type RawOption = [string, string] | { value: string; text: string; group?: string };

function normalizeOption(opt: RawOption): { value: string; text: string; group?: string } {
  if (Array.isArray(opt)) {
    return { value: opt[0], text: opt[1] ?? opt[0] };
  }
  return opt;
}

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

export class SelectControl extends BaseControl<string> implements SelectFieldControl {
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

    if (params.options) {
      this.populateOptions(select, params.options);
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

  private populateOptions(select: HTMLSelectElement, options: SelectConfig["options"]): void {
    if (!options) {
      return;
    }

    // Array of [value, text] tuples or option objects
    if (Array.isArray(options)) {
      for (const opt of options as RawOption[]) {
        const { value, text } = normalizeOption(opt);
        select.appendChild(createOptionElement(value, text));
      }
      return;
    }

    // Object with optional groups and values
    const optObj = options;
    const groups: Record<string, HTMLOptGroupElement> = {};

    if (optObj.groups) {
      for (const groupLabel of optObj.groups) {
        const og = document.createElement("optgroup");
        og.label = groupLabel;
        groups[groupLabel] = og;
        select.appendChild(og);
      }
    }

    for (const opt of optObj.values ?? []) {
      const el = createOptionElement(opt.value, opt.text ?? opt.value);
      if (opt.group && opt.group in groups) {
        groups[opt.group].appendChild(el);
      } else {
        select.appendChild(el);
      }
    }
  }

  setOptions(
    options: Array<[string, string] | { value: string; text: string }>,
    selectedValue?: string,
  ): void {
    while (this.selectEl.options.length > 0) {
      this.selectEl.remove(0);
    }

    for (const opt of options) {
      const { value, text } = normalizeOption(opt);
      const el = createOptionElement(value, text);
      if (selectedValue !== undefined && value === selectedValue) {
        el.selected = true;
      }
      this.selectEl.appendChild(el);
    }
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
