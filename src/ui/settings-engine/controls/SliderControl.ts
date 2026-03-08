import type { SliderConfig } from "../types.js";
import type { Store } from "../store/Store.js";
import { BaseControl, getUniqueID } from "./FieldControl.js";

export class SliderControl extends BaseControl<number> {
  private display?: HTMLOutputElement;
  private tooltip?: HTMLDivElement;
  private readonly displayModifier?: (v: number) => string;

  constructor(params: SliderConfig, store: Store) {
    super(params, store);
    this.displayModifier = params.displayModifier;

    const root = document.createElement("div");
    root.className = "field";
    this._rootElement = root;

    const control = document.createElement("div");
    control.className = "control";

    if (params.label) {
      const label = document.createElement("label");
      label.innerHTML = params.label;
      control.appendChild(label);
    }

    const name = getUniqueID();
    const input = document.createElement("input");
    input.type = "range";
    input.name = name;
    input.className = `slider is-fullwidth${params.display ? " has-output" : ""}`;
    if (params.min !== undefined) {
      input.min = String(params.min);
    }
    if (params.max !== undefined) {
      input.max = String(params.max);
    }
    if (params.step !== undefined) {
      input.step = String(params.step);
    }

    // Floating tooltip (UX improvement)
    const tooltip = document.createElement("div");
    tooltip.className = "slider-tooltip";
    this.tooltip = tooltip;

    const sliderWrapper = document.createElement("div");
    sliderWrapper.className = "slider-wrapper";
    sliderWrapper.appendChild(input);
    sliderWrapper.appendChild(tooltip);
    control.appendChild(sliderWrapper);

    if (params.display) {
      const output = document.createElement("output");
      output.htmlFor = name;
      output.className = "slider-output";
      control.appendChild(output);
      this.display = output;
    }

    root.appendChild(control);
    this._element = input;

    input.addEventListener("input", () => {
      const value = this.get();
      this.updateDisplay(value, input);
      this.persistToStorage(value);
      this.emitter.fireEvent("action", value);
    });

    input.addEventListener("mouseup", () => {
      this.tooltip?.classList.remove("slider-tooltip--visible");
    });
    input.addEventListener("touchend", () => {
      this.tooltip?.classList.remove("slider-tooltip--visible");
    });

    // Load initial value, fallback to 0
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

  private formatValue(value: number): string {
    return this.displayModifier ? this.displayModifier(value) : String(value);
  }

  private updateDisplay(value: number, input: HTMLInputElement): void {
    const formatted = this.formatValue(value);
    if (this.display) {
      this.display.innerText = formatted;
    }
    if (this.tooltip) {
      this.tooltip.textContent = formatted;
      const min = parseFloat(input.min) || 0;
      const max = parseFloat(input.max) || 100;
      const pct = ((value - min) / (max - min)) * 100;
      this.tooltip.style.left = `${pct}%`;
      this.tooltip.classList.add("slider-tooltip--visible");
    }
  }

  get(): number {
    return Number((this._element as HTMLInputElement).value);
  }

  set(value: number, silent?: boolean): this {
    (this._element as HTMLInputElement).value = String(value);

    const formatted = this.formatValue(value);
    if (this.display) {
      this.display.innerText = formatted;
    }

    if (!silent) {
      this._element.dispatchEvent(new Event("change"));
    }

    return this;
  }
}
