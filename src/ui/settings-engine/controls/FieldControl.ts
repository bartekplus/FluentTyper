import type { Store } from "../store/Store.js";

// --- Unique ID generator ---
let _uid = Date.now();
export function getUniqueID(): string {
  return (_uid++).toString(36);
}

// --- Typed event emitter ---
type EventHandler = (...args: unknown[]) => void;

export class TypedEventEmitter {
  private readonly events: Record<string, EventHandler[]> = {};

  private normalizeType(type: string): string {
    return type.replace(/^on([A-Z])/, (_, first: string) => first.toLowerCase());
  }

  addEvent(type: string, fn: EventHandler): this {
    const t = this.normalizeType(type);
    if (!(t in this.events)) {
      this.events[t] = [];
    }
    if (!this.events[t].includes(fn)) {
      this.events[t].push(fn);
    }
    return this;
  }

  removeEvent(type: string, fn: EventHandler): this {
    const t = this.normalizeType(type);
    const handlers = this.events[t];
    if (handlers) {
      const idx = handlers.indexOf(fn);
      if (idx !== -1) {
        handlers.splice(idx, 1);
      }
    }
    return this;
  }

  fireEvent(type: string, arg?: unknown): this {
    const t = this.normalizeType(type);
    const handlers = this.events[t];
    if (!handlers) {
      return this;
    }
    for (const fn of [...handlers]) {
      fn.call(this, arg);
    }
    return this;
  }
}

// --- Core interfaces ---

export interface FieldControl<TValue = unknown> {
  /** Inner widget element (<input>, <select>, <div>, etc.) */
  readonly element: HTMLElement;
  /** Outer wrapper <div class="field"> */
  readonly rootElement: HTMLElement;

  get(): TValue;
  set(value: TValue, silent?: boolean): this;
  addEvent(type: "action", fn: (value: TValue) => void): void;
  addEvent(type: "change", fn: (value: TValue) => void): void;
  addEvent(type: "modal_done", fn: () => void): void;
  addEvent(type: string, fn: EventHandler): void;
  destroy(): void;
}

export interface SelectFieldControl extends FieldControl<string> {
  setOptions(
    options: Array<[string, string] | { value: string; text: string }>,
    selectedValue?: string,
  ): void;
}

export interface ListBoxFieldControl extends FieldControl<string[]> {
  add(value: string, storeValue?: boolean): void;
  remove(): void;
  removeAll(): void;
  store(): void;
}

// --- Saved indicator helper ---

function showSavedIndicator(rootEl: HTMLElement): void {
  let indicator = rootEl.querySelector<HTMLElement>(".field-saved-indicator");
  if (!indicator) {
    indicator = document.createElement("span");
    indicator.className = "field-saved-indicator";
    indicator.textContent = "Saved ✓";
    rootEl.appendChild(indicator);
  }
  indicator.classList.remove("field-saved-indicator--hidden");
  indicator.classList.add("field-saved-indicator--visible");
  const handle = window.setTimeout(() => {
    if (indicator) {
      indicator.classList.remove("field-saved-indicator--visible");
      indicator.classList.add("field-saved-indicator--hidden");
    }
  }, 1500);
  // Store handle so duplicate calls can be debounced
  (indicator as HTMLElement & { _clearHandle?: ReturnType<typeof setTimeout> })._clearHandle =
    handle;
}

// --- Abstract base control ---

export abstract class BaseControl<TValue> implements FieldControl<TValue> {
  protected readonly emitter = new TypedEventEmitter();
  protected readonly store: Store;
  protected readonly name: string | undefined;

  protected _rootElement!: HTMLElement;
  protected _element!: HTMLElement;

  constructor(params: { name?: string; [key: string]: unknown }, store: Store) {
    this.store = store;
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

  addEvent(type: string, fn: EventHandler): void {
    this.emitter.addEvent(type, fn);
  }

  destroy(): void {
    this._rootElement?.remove();
  }

  protected async loadFromStorage(): Promise<void> {
    if (this.name === undefined) {
      return;
    }
    try {
      const value = await this.store.get(this.name);
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
    void this.store
      .set(this.name, value)
      .then(() => {
        showSavedIndicator(this._rootElement);
      })
      .catch(console.error);
  }
}
