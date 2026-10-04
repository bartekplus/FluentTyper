import type { SettingsRegistry } from "../../src/ui/settings-engine/SettingsEngine.js";

export type SettingsMap = Record<string, unknown>;

export class FakeControl {
  readonly rootElement = document.createElement("div");
  readonly element = this.rootElement;
  readonly calls: Array<{ value: unknown; silent: boolean }> = [];
  private readonly handlers: Record<string, Array<(value: unknown) => void>> = {};

  constructor(
    private readonly values: SettingsMap,
    private readonly key: string,
    label = "",
  ) {
    this.rootElement.className = "field";
    this.rootElement.textContent = label;
  }

  addEvent(type: string, fn: (value: unknown) => void): void {
    (this.handlers[type] ??= []).push(fn);
  }

  get(): unknown {
    return this.values[this.key];
  }

  set(value: unknown, silent = false): this {
    this.values[this.key] = value;
    this.calls.push({ value, silent });
    this.handlers.change?.forEach((handler) => handler(value));
    if (!silent) {
      this.handlers.action?.forEach((handler) => handler(value));
    }
    return this;
  }

  setDisabled(): void {}

  destroy(): void {}
}

/** Makes one control for each key in values or labels. A control reads and writes values[key]. */
export function fakeRegistry(
  values: SettingsMap,
  labels: Record<string, string> = {},
): SettingsRegistry & Record<string, FakeControl> {
  const keys = new Set([...Object.keys(values), ...Object.keys(labels)]);
  return Object.fromEntries(
    [...keys].map((key) => [key, new FakeControl(values, key, labels[key])]),
  ) as unknown as SettingsRegistry & Record<string, FakeControl>;
}

export async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

export function findButtonByText(root: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(root.querySelectorAll("button")).find((entry) =>
    entry.textContent?.includes(text),
  );
  if (!button) {
    throw new Error(`Button with text "${text}" not found`);
  }
  return button;
}
