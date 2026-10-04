import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Settings } from "luxon";
import { TextAssetsPanel } from "../src/ui/options/TextAssetsPanel.js";
import { i18n } from "../src/ui/options/fluenttyperI18n.js";
import {
  KEY_DATE_FORMAT,
  KEY_TEXT_EXPANSIONS,
  KEY_TIME_FORMAT,
  KEY_USER_DICTIONARY_LIST,
} from "../src/core/domain/constants";
import { memorySettings } from "./support/fakeSettings";
import {
  fakeRegistry,
  findButtonByText,
  flushAsyncWork,
  type SettingsMap,
} from "./support/settingsFakes";

type FileReaderCtor = typeof FileReader;

/** registryOverrides gives the registry its own copy of the values, so it differs from the store. */
async function mount(overrides: SettingsMap = {}, registryOverrides?: SettingsMap) {
  const store = memorySettings({
    [KEY_TEXT_EXPANSIONS]: [],
    [KEY_USER_DICTIONARY_LIST]: [],
    [KEY_DATE_FORMAT]: "",
    [KEY_TIME_FORMAT]: "",
    ...overrides,
  });
  const values = store.store;
  const root = document.createElement("div");
  document.body.appendChild(root);
  const registryValues = registryOverrides ? { ...values, ...registryOverrides } : values;
  new TextAssetsPanel(root, fakeRegistry(registryValues), store as never);
  await flushAsyncWork();
  return { root, values };
}

describe("TextAssetsPanel", () => {
  beforeEach(() => {
    i18n.lang = "en";
  });

  afterEach(() => {
    Settings.now = () => Date.now();
  });

  test("allows saving multiple snippets with the same shortcut", async () => {
    const { root, values } = await mount({ [KEY_TEXT_EXPANSIONS]: [["brb", "be right back"]] });

    findButtonByText(root, i18n.get("text_assets_new_snippet")).click();

    const shortcutInput = root.querySelector(".text-assets-editor input") as HTMLInputElement;
    const bodyInput = root.querySelector(".text-assets-editor textarea") as HTMLTextAreaElement;
    shortcutInput.value = "brb";
    shortcutInput.dispatchEvent(new Event("input", { bubbles: true }));
    bodyInput.value = "be right there";
    bodyInput.dispatchEvent(new Event("input", { bubbles: true }));

    findButtonByText(root, i18n.get("text_assets_save_snippet")).click();
    await flushAsyncWork();

    expect(values[KEY_TEXT_EXPANSIONS]).toEqual([
      ["brb", "be right there"],
      ["brb", "be right back"],
    ]);

    const snippetRows = root.querySelectorAll<HTMLButtonElement>(".text-assets-list-item");
    expect(snippetRows).toHaveLength(2);
    snippetRows[0].click();
    expect((root.querySelector(".text-assets-editor textarea") as HTMLTextAreaElement).value).toBe(
      "be right there",
    );
    snippetRows[1].click();
    expect((root.querySelector(".text-assets-editor textarea") as HTMLTextAreaElement).value).toBe(
      "be right back",
    );
  });

  test("csv import deduplicates exact snippet pairs while keeping same-shortcut variants", async () => {
    const { root, values } = await mount({ [KEY_TEXT_EXPANSIONS]: [["brb", "be right back"]] });
    const originalFileReader = globalThis.FileReader as FileReaderCtor;
    class MockFileReader {
      public result: string | ArrayBuffer | null = null;
      private readonly handlers: Record<string, Array<() => void>> = {};

      addEventListener(type: string, handler: () => void): void {
        this.handlers[type] = [...(this.handlers[type] || []), handler];
      }

      readAsText(): void {
        this.result = "brb,be right back\nsig,first import\nsig,first import\nsig,second import";
        for (const handler of this.handlers.load || []) {
          handler();
        }
      }
    }
    Object.assign(globalThis, {
      FileReader: MockFileReader as unknown as FileReaderCtor,
    });

    try {
      const importInput = root.querySelector<HTMLInputElement>('input[type="file"][accept=".csv"]');
      expect(importInput).not.toBeNull();
      Object.defineProperty(importInput!, "files", {
        configurable: true,
        value: [new File(["ignored"], "snippets.csv", { type: "text/csv" })],
      });

      importInput!.dispatchEvent(new Event("input", { bubbles: true }));
      await flushAsyncWork();
      importInput!.dispatchEvent(new Event("input", { bubbles: true }));
      await flushAsyncWork();

      expect(values[KEY_TEXT_EXPANSIONS]).toEqual([
        ["brb", "be right back"],
        ["sig", "first import"],
        ["sig", "second import"],
      ]);
    } finally {
      Object.assign(globalThis, {
        FileReader: originalFileReader,
      });
    }
  });

  test("keeps multiple unsaved snippet drafts independently editable", async () => {
    const { root } = await mount({ [KEY_TEXT_EXPANSIONS]: [["brb", "be right back"]] });

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
    const { root, values } = await mount({ [KEY_USER_DICTIONARY_LIST]: ["alpha"] });

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

  test("adding a single dictionary word keeps the list sorted and ignores duplicates", async () => {
    const { root, values } = await mount({ [KEY_USER_DICTIONARY_LIST]: ["zeta"] });

    const addWord = async (word: string) => {
      const input = root.querySelector<HTMLInputElement>(
        `input[placeholder="${i18n.get("text_assets_add_custom_word_placeholder")}"]`,
      );
      input!.value = word;
      findButtonByText(root, i18n.get("add")).click();
      await flushAsyncWork();
    };

    await addWord("alpha");
    expect(values[KEY_USER_DICTIONARY_LIST]).toEqual(["alpha", "zeta"]);
    await addWord("zeta");
    expect(values[KEY_USER_DICTIONARY_LIST]).toEqual(["alpha", "zeta"]);
  });

  test("snippet preview substitutes page variables with sample values", async () => {
    const { root } = await mount({
      [KEY_TEXT_EXPANSIONS]: [["pg", "${page_url} ${page_title} ${page_domain} ${unknown_var}"]],
    });

    expect(root.querySelector(".snippet-preview")?.textContent).toBe(
      "https://example.com/path Example page example.com ${unknown_var}",
    );
  });

  test("dynamic variables help links to Luxon docs and shows format examples", async () => {
    const { root } = await mount();

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
    const { root } = await mount({
      [KEY_DATE_FORMAT]: "dd LLL yyyy",
      [KEY_TIME_FORMAT]: "HH:mm",
    });

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
    const { root } = await mount(
      {
        [KEY_TEXT_EXPANSIONS]: [["stamp", "${date} ${time}"]],
        [KEY_DATE_FORMAT]: "yyyy/MM/dd",
        [KEY_TIME_FORMAT]: "HH:mm:ss",
      },
      { [KEY_DATE_FORMAT]: "", [KEY_TIME_FORMAT]: "" },
    );

    const preview = root.querySelector(".snippet-preview") as HTMLElement;
    expect(preview.textContent).toContain("2026/03/08");
    expect(preview.textContent).toContain("14:05:06");
  });
});
