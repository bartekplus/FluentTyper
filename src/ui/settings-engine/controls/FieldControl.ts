import type { Store } from "@core/application/storage/Store.js";

let _uid = Date.now();
export function getUniqueID(): string {
  return (_uid++).toString(36);
}

type ValueEventHandler<TValue> = (value: TValue) => void;
type EventHandler<TValue = unknown> = ValueEventHandler<TValue> | (() => void);

export class TypedEventEmitter {
  private readonly events: Record<string, EventHandler[]> = {};

  addEvent(type: string, fn: EventHandler): this {
    if (!(type in this.events)) {
      this.events[type] = [];
    }
    if (!this.events[type].includes(fn)) {
      this.events[type].push(fn);
    }
    return this;
  }

  fireEvent(type: string, arg?: unknown): this {
    const handlers = this.events[type];
    if (!handlers) {
      return this;
    }
    for (const fn of [...handlers]) {
      fn.call(this, arg);
    }
    return this;
  }
}

export interface FieldControl<TValue = unknown> {
  /** Inner widget element (<input>, <select>, <div>, etc.) */
  readonly element: HTMLElement;
  /** Outer wrapper <div class="field"> */
  readonly rootElement: HTMLElement;

  get(): TValue;
  set(value: TValue, silent?: boolean): this;
  setDisabled(disabled: boolean): void;
  addEvent(type: "action" | "change", fn: ValueEventHandler<TValue>): void;
  addEvent(type: string, fn: EventHandler<TValue>): void;
  destroy(): void;
}

export type SettingsSaveStatusState = "saving" | "saved" | "error";

export function dispatchSettingsSaveStatus(
  state: SettingsSaveStatusState,
  detail?: { message?: string },
): void {
  window.dispatchEvent(
    new CustomEvent("fluenttyper:settings-save-status", {
      detail: {
        state,
        message: detail?.message,
      },
    }),
  );
}

export function createFieldRoot(className = "field"): HTMLDivElement {
  const root = document.createElement("div");
  root.className = className;
  return root;
}

export function createControlContainer(className = "control"): HTMLDivElement {
  const control = document.createElement("div");
  control.className = className;
  return control;
}

export function appendLabel(
  parent: HTMLElement,
  label?: string,
  className = "label",
): HTMLLabelElement | undefined {
  if (!label) {
    return undefined;
  }

  const element = document.createElement("label");
  element.className = className;
  element.innerHTML = label;
  parent.appendChild(element);
  return element;
}

export function createInputElement(type: string, className?: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = type;
  if (className) {
    input.className = className;
  }
  return input;
}

export function createButtonInput(text?: string): HTMLInputElement {
  const input = createInputElement("button", "button is-primary");
  if (text) {
    input.value = text;
  }
  return input;
}

export function createOptionElement(value: string, text = value): HTMLOptionElement {
  const option = document.createElement("option");
  option.value = value;
  option.text = text;
  return option;
}

export function dispatchControlEvent(target: EventTarget, type: string): void {
  target.dispatchEvent(new Event(type));
}

export abstract class BaseControl<TValue> implements FieldControl<TValue> {
  protected readonly emitter = new TypedEventEmitter();
  protected readonly storage: Store;
  protected readonly name: string | undefined;

  protected _rootElement!: HTMLElement;
  protected _element!: HTMLElement;

  constructor(params: { name?: string; [key: string]: unknown }, store: Store) {
    this.storage = store;
    this.name = params.name;
  }

  get element(): HTMLElement {
    return this._element;
  }

  get rootElement(): HTMLElement {
    return this._rootElement;
  }

  abstract get(): TValue;
  abstract set(value: TValue, silent?: boolean): this;

  addEvent(type: "action" | "change", fn: ValueEventHandler<TValue>): void;
  addEvent(type: string, fn: EventHandler<TValue>): void;
  addEvent(type: string, fn: EventHandler<TValue>): void {
    this.emitter.addEvent(type, fn as (...args: unknown[]) => void);
  }

  setDisabled(disabled: boolean): void {
    if ("disabled" in this._element) {
      (this._element as HTMLInputElement).disabled = disabled;
    }
    this._rootElement?.classList.toggle("is-disabled", disabled);
  }

  destroy(): void {
    this._rootElement?.remove();
  }

  protected async loadFromStorage(): Promise<void> {
    if (this.name === undefined) {
      return;
    }
    try {
      const value = await this.storage.get(this.name);
      if (value !== undefined) {
        this.set(value as TValue, true);
      }
    } catch (e) {
      console.error(e);
    }
  }

  protected persistToStorage(value: TValue): void {
    if (this.name === undefined) {
      return;
    }
    dispatchSettingsSaveStatus("saving");
    void this.storage
      .set(this.name, value)
      .then(() => {
        dispatchSettingsSaveStatus("saved");
      })
      .catch((error) => {
        console.error(error);
        dispatchSettingsSaveStatus("error", { message: "Unable to save settings." });
      });
  }
}
