import "./setup";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Store } from "../src/core/application/storage/Store.js";
import type { SettingsRegistry } from "../src/ui/settings-engine/SettingsEngine.js";
import { TextAssetsPanel } from "../src/ui/options/TextAssetsPanel.js";
import { i18n } from "../src/ui/options/fluenttyperI18n.js";
import {
  KEY_DATE_FORMAT,
  KEY_TEXT_EXPANSIONS,
  KEY_TIME_FORMAT,
  KEY_USER_DICTIONARY_LIST,
} from "../src/core/domain/constants";

type SettingsMap = Record<string, unknown>;

class MockControl {
  private readonly handlers: Array<(value: unknown) => void> = [];
  private value: unknown;
  private readonly onSet: (value: unknown) => void;

  constructor(value: unknown, onSet: (value: unknown) => void) {
    this.value = value;
    this.onSet = onSet;
  }

  addEvent(type: string, fn: (value: unknown) => void): void {
    if (type === "action") {
      this.handlers.push(fn);
    }
  }

  get(): unknown {
    return this.value;
  }

  set(value: unknown): this {
    this.value = value;
    this.onSet(value);
    this.handlers.forEach((handler) => handler(value));
    return this;
  }
}

function createStore(values: SettingsMap): Store {
  return {
    get(name: string) {
      return Promise.resolve(values[name]);
    },
    set(name: string, value: unknown) {
      values[name] = value;
      return Promise.resolve();
    },
  } as Store;
}

function createRegistry(initialValues: SettingsMap): SettingsRegistry {
  return {
    [KEY_TEXT_EXPANSIONS]: new MockControl(initialValues[KEY_TEXT_EXPANSIONS], (value) => {
      initialValues[KEY_TEXT_EXPANSIONS] = value;
    }),
    [KEY_USER_DICTIONARY_LIST]: new MockControl(
      initialValues[KEY_USER_DICTIONARY_LIST],
      (value) => {
        initialValues[KEY_USER_DICTIONARY_LIST] = value;
      },
    ),
    [KEY_DATE_FORMAT]: new MockControl(initialValues[KEY_DATE_FORMAT], (value) => {
      initialValues[KEY_DATE_FORMAT] = value;
    }),
    [KEY_TIME_FORMAT]: new MockControl(initialValues[KEY_TIME_FORMAT], (value) => {
      initialValues[KEY_TIME_FORMAT] = value;
    }),
  } as unknown as SettingsRegistry;
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function findButtonByText(root: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find((entry) =>
    entry.textContent?.includes(text),
  );
  if (!button) {
    throw new Error(`Button with text "${text}" not found`);
  }
  return button;
}

describe("TextAssetsPanel", () => {
  beforeEach(() => {
    i18n.lang = "en";
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  test("prevents duplicate snippet shortcuts and shows an inline warning", async () => {
    const values: SettingsMap = {
      [KEY_TEXT_EXPANSIONS]: [["brb", "be right back"]],
      [KEY_USER_DICTIONARY_LIST]: [],
      [KEY_DATE_FORMAT]: "",
      [KEY_TIME_FORMAT]: "",
    };
    const store = createStore(values);
    const registry = createRegistry(values);
    const root = document.createElement("div");
    document.body.appendChild(root);

    new TextAssetsPanel(root, registry, store);
    await flushAsyncWork();

    findButtonByText(root, i18n.get("text_assets_new_snippet")).click();

    const shortcutInput = root.querySelector(".text-assets-editor input") as HTMLInputElement;
    const bodyInput = root.querySelector(".text-assets-editor textarea") as HTMLTextAreaElement;
    shortcutInput.value = "brb";
    shortcutInput.dispatchEvent(new Event("input", { bubbles: true }));
    bodyInput.value = "be right there";
    bodyInput.dispatchEvent(new Event("input", { bubbles: true }));

    findButtonByText(root, i18n.get("text_assets_save_snippet")).click();

    expect(root.textContent).toContain(i18n.get("text_assets_duplicate_shortcut"));
    expect(values[KEY_TEXT_EXPANSIONS]).toEqual([["brb", "be right back"]]);
  });

  test("bulk add deduplicates dictionary words and clear-all requires confirmation", async () => {
    const values: SettingsMap = {
      [KEY_TEXT_EXPANSIONS]: [],
      [KEY_USER_DICTIONARY_LIST]: ["alpha"],
      [KEY_DATE_FORMAT]: "",
      [KEY_TIME_FORMAT]: "",
    };
    const store = createStore(values);
    const registry = createRegistry(values);
    const root = document.createElement("div");
    document.body.appendChild(root);

    new TextAssetsPanel(root, registry, store);
    await flushAsyncWork();

    const bulkTextarea = root.querySelectorAll("details textarea")[0] as HTMLTextAreaElement;
    bulkTextarea.value = "alpha\nbeta\nbeta\ngamma";
    bulkTextarea.dispatchEvent(new Event("input", { bubbles: true }));

    findButtonByText(root, `${i18n.get("text_assets_add_words")} (2)`).click();
    await flushAsyncWork();

    expect(values[KEY_USER_DICTIONARY_LIST]).toEqual(["alpha", "beta", "gamma"]);

    findButtonByText(root, i18n.get("clear_dict_btn")).click();
    expect(values[KEY_USER_DICTIONARY_LIST]).toEqual(["alpha", "beta", "gamma"]);
    expect(root.textContent).toContain(i18n.get("text_assets_clear_words_confirm"));

    findButtonByText(root, i18n.get("text_assets_clear_words_confirm")).click();
    await flushAsyncWork();

    expect(values[KEY_USER_DICTIONARY_LIST]).toEqual([]);
  });
});
