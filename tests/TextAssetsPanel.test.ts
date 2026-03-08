import "./setup";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Settings } from "luxon";
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
  private readonly handlers: Record<string, Array<(value: unknown) => void>> = {};
  private value: unknown;
  private readonly onSet: (value: unknown) => void;

  constructor(value: unknown, onSet: (value: unknown) => void) {
    this.value = value;
    this.onSet = onSet;
  }

  addEvent(type: string, fn: (value: unknown) => void): void {
    this.handlers[type] = [...(this.handlers[type] || []), fn];
  }

  get(): unknown {
    return this.value;
  }

  set(value: unknown, silent = false): this {
    this.value = value;
    this.onSet(value);
    (this.handlers.change || []).forEach((handler) => handler(value));
    if (!silent) {
      (this.handlers.action || []).forEach((handler) => handler(value));
    }
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
    Settings.now = () => Date.now();
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
    expect(shortcutInput.value).toBe("brb");
    expect(bodyInput.value).toBe("be right there");
  });

  test("keeps multiple unsaved snippet drafts independently editable", async () => {
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
    let shortcutInput = root.querySelector(".text-assets-editor input") as HTMLInputElement;
    let bodyInput = root.querySelector(".text-assets-editor textarea") as HTMLTextAreaElement;
    shortcutInput.value = "sig";
    shortcutInput.dispatchEvent(new Event("input", { bubbles: true }));
    bodyInput.value = "first draft";
    bodyInput.dispatchEvent(new Event("input", { bubbles: true }));

    findButtonByText(root, i18n.get("text_assets_new_snippet")).click();
    shortcutInput = root.querySelector(".text-assets-editor input") as HTMLInputElement;
    bodyInput = root.querySelector(".text-assets-editor textarea") as HTMLTextAreaElement;
    shortcutInput.value = "ty";
    shortcutInput.dispatchEvent(new Event("input", { bubbles: true }));
    bodyInput.value = "second draft";
    bodyInput.dispatchEvent(new Event("input", { bubbles: true }));

    let snippetRows = root.querySelectorAll<HTMLButtonElement>(".text-assets-list-item");
    snippetRows[1].click();

    shortcutInput = root.querySelector(".text-assets-editor input") as HTMLInputElement;
    bodyInput = root.querySelector(".text-assets-editor textarea") as HTMLTextAreaElement;
    expect(shortcutInput.value).toBe("sig");
    expect(bodyInput.value).toBe("first draft");

    snippetRows = root.querySelectorAll<HTMLButtonElement>(".text-assets-list-item");
    snippetRows[0].click();
    shortcutInput = root.querySelector(".text-assets-editor input") as HTMLInputElement;
    bodyInput = root.querySelector(".text-assets-editor textarea") as HTMLTextAreaElement;
    expect(shortcutInput.value).toBe("ty");
    expect(bodyInput.value).toBe("second draft");
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

  test("dynamic variables help links to Luxon docs and shows format examples", async () => {
    const values: SettingsMap = {
      [KEY_TEXT_EXPANSIONS]: [],
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

    const disclosure = Array.from(root.querySelectorAll("details")).find((entry) =>
      entry.textContent?.includes(i18n.get("dynamic_variables")),
    ) as HTMLDetailsElement;
    disclosure.open = true;

    expect(root.textContent).toContain(
      "Use dynamic variables inside snippets to insert dates, times, utility values, and page details.",
    );
    expect(root.textContent).toContain("Date & time: ${time}, ${date}, ${date:+1d}, ${datetime}");
    expect(root.textContent).toContain("Utility values: ${uuid}, ${random:A|B|C}");
    expect(root.textContent).toContain("Page details: ${page_url}, ${page_title}, ${page_domain}");
    expect(root.textContent).toContain("These format fields use Luxon tokens.");
    expect(root.textContent).toContain("Date example: dd LLL yyyy -> 08 Mar 2026");
    expect(root.textContent).toContain("Time example: HH:mm -> 14:05");

    const docsLink = Array.from(root.querySelectorAll<HTMLAnchorElement>("a")).find((entry) =>
      entry.textContent?.includes("Open Luxon token reference"),
    );
    expect(docsLink?.href).toBe("https://moment.github.io/luxon/#/formatting?id=table-of-tokens");
  });

  test("snippet preview updates live when custom date and time formats change", async () => {
    Settings.now = () => new Date("2026-03-08T14:05:06.000Z").getTime();
    const values: SettingsMap = {
      [KEY_TEXT_EXPANSIONS]: [],
      [KEY_USER_DICTIONARY_LIST]: [],
      [KEY_DATE_FORMAT]: "dd LLL yyyy",
      [KEY_TIME_FORMAT]: "HH:mm",
    };
    const store = createStore(values);
    const registry = createRegistry(values);
    const root = document.createElement("div");
    document.body.appendChild(root);

    new TextAssetsPanel(root, registry, store);
    await flushAsyncWork();

    findButtonByText(root, i18n.get("text_assets_new_snippet")).click();

    const bodyInput = root.querySelector(".text-assets-editor textarea") as HTMLTextAreaElement;
    bodyInput.value = "${date} ${time}";
    bodyInput.dispatchEvent(new Event("input", { bubbles: true }));

    const previewBefore = root.querySelector(".snippet-preview") as HTMLElement;
    expect(previewBefore.textContent).toContain("08 Mar 2026");
    expect(previewBefore.textContent).toContain("14:05");

    const dateFormatInput = root.querySelector<HTMLInputElement>(
      `input[placeholder="${i18n.get("custom_date_format_label")}"]`,
    );
    const timeFormatInput = root.querySelector<HTMLInputElement>(
      `input[placeholder="${i18n.get("custom_time_format_label")}"]`,
    );
    dateFormatInput!.value = "yyyy/MM/dd";
    dateFormatInput!.dispatchEvent(new Event("input", { bubbles: true }));
    timeFormatInput!.value = "HH:mm:ss";
    timeFormatInput!.dispatchEvent(new Event("input", { bubbles: true }));

    const previewAfter = root.querySelector(".snippet-preview") as HTMLElement;
    expect(previewAfter.textContent).toContain("2026/03/08");
    expect(previewAfter.textContent).toContain("14:05:06");
  });

  test("snippet preview uses saved custom date and time formats on initial render", async () => {
    Settings.now = () => new Date("2026-03-08T14:05:06.000Z").getTime();
    const values: SettingsMap = {
      [KEY_TEXT_EXPANSIONS]: [["stamp", "${date} ${time}"]],
      [KEY_USER_DICTIONARY_LIST]: [],
      [KEY_DATE_FORMAT]: "yyyy/MM/dd",
      [KEY_TIME_FORMAT]: "HH:mm:ss",
    };
    const store = createStore(values);
    const registry = createRegistry({
      ...values,
      [KEY_DATE_FORMAT]: "",
      [KEY_TIME_FORMAT]: "",
    });
    const root = document.createElement("div");
    document.body.appendChild(root);

    new TextAssetsPanel(root, registry, store);
    await flushAsyncWork();

    const preview = root.querySelector(".snippet-preview") as HTMLElement;
    expect(preview.textContent).toContain("2026/03/08");
    expect(preview.textContent).toContain("14:05:06");
  });
});
