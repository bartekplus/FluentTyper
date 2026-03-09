import type { Store } from "@core/application/storage/Store.js";

// --- Unique ID generator ---
let _uid = Date.now();
export function getUniqueID(): string {
  return (_uid++).toString(36);
}

// --- Typed event emitter ---
type ValueEventHandler<TValue> = (value: TValue) => void;
type EventHandler<TValue = unknown> = ValueEventHandler<TValue> | (() => void);

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
  addEvent(type: "action", fn: ValueEventHandler<TValue>): void;
  addEvent(type: "change", fn: ValueEventHandler<TValue>): void;
  addEvent(type: "modal_done", fn: () => void): void;
  addEvent(type: string, fn: EventHandler<TValue>): void;
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
  persist(): void;
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

// --- Abstract base control ---

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

  addEvent(type: "action", fn: ValueEventHandler<TValue>): void;
  addEvent(type: "change", fn: ValueEventHandler<TValue>): void;
  addEvent(type: "modal_done", fn: () => void): void;
  addEvent(type: string, fn: EventHandler<TValue>): void;
  addEvent(type: string, fn: EventHandler<TValue>): void {
    this.emitter.addEvent(type, fn as (...args: unknown[]) => void);
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
