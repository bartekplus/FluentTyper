import type { SliderConfig } from "../types.js";
import type { Store } from "@core/application/storage/Store.js";
import { createElement } from "../dom/createElement.js";
import { BaseControl, appendLabel, createInputElement, getUniqueID } from "./FieldControl.js";

export class SliderControl extends BaseControl<number> {
  private readonly display: HTMLOutputElement;
  private readonly tooltip: HTMLDivElement;

  constructor(params: SliderConfig, store: Store) {
    super(params, store);

    const root = createElement("div", { className: "field" });
    this._rootElement = root;

    const control = createElement("div", { className: "control" });
    const label = appendLabel(control, params.label);

    const id = getUniqueID();
    const input = createInputElement("range", "slider is-fullwidth has-output");
    input.id = id;
    if (label) {
      label.htmlFor = id;
    }
    input.min = String(params.min);
    input.max = String(params.max);

    const tooltip = createElement("div", { className: "slider-tooltip" });
    this.tooltip = tooltip;

    const sliderWrapper = createElement("div", { className: "slider-wrapper" });
    sliderWrapper.append(input, tooltip);
    control.appendChild(sliderWrapper);

    const output = createElement("output", { className: "slider-output" });
    output.htmlFor = id;
    control.appendChild(output);
    this.display = output;

    root.appendChild(control);
    this._element = input;

    input.addEventListener("input", () => {
      const value = this.get();
      this.updateDisplay(value, input);
      this.persistToStorage(value);
      this.emitter.fireEvent("action", value);
    });

    if (params.name !== undefined) {
      store
        .get(params.name)
        .then((value) => {
          this.set((value as number) || 0, true);
        })
        .catch(console.error);
    } else {
      this.set(0, true);
    }
  }

  private updateDisplay(value: number, input: HTMLInputElement): void {
    const formatted = String(value);
    this.display.innerText = formatted;
    this.tooltip.textContent = formatted;
    const min = parseFloat(input.min) || 0;
    const max = parseFloat(input.max) || 100;
    const pct = ((value - min) / (max - min)) * 100;
    this.tooltip.style.left = `${pct}%`;
  }

  get(): number {
    return Number((this._element as HTMLInputElement).value);
  }

  set(value: number, silent?: boolean): this {
    (this._element as HTMLInputElement).value = String(value);
    this.display.innerText = String(value);

    if (!silent) {
      this._element.dispatchEvent(new Event("input"));
    }

    return this;
  }
}
