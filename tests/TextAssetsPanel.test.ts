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

/** Chooses a file that holds text in the file input that accepts accept. */
async function importFile(root: HTMLElement, accept: string, text: string): Promise<void> {
  const input = root.querySelector<HTMLInputElement>(`input[type="file"][accept="${accept}"]`)!;
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new File([text], `import${accept}`)],
  });
  input.dispatchEvent(new Event("input"));
  await flushAsyncWork();
}

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

  test("search boxes keep their input and filter only their list", async () => {
    const { root } = await mount({
      [KEY_TEXT_EXPANSIONS]: [
        ["brb", "be right back"],
        ["omw", "on my way"],
      ],
      [KEY_USER_DICTIONARY_LIST]: ["alpha", "beta"],
    });
    const [snippetSearch, wordSearch] =
      root.querySelectorAll<HTMLInputElement>('input[type="search"]');

    snippetSearch.value = "om";
    snippetSearch.dispatchEvent(new Event("input"));
    wordSearch.value = "be";
    wordSearch.dispatchEvent(new Event("input"));

    expect(snippetSearch.isConnected && wordSearch.isConnected).toBe(true);
    const names = (selector: string) =>
      Array.from(root.querySelectorAll(selector), (element) => element.textContent);
    expect(names(".text-assets-list-item strong")).toEqual(["omw"]);
    expect(names(".domain-table-name")).toEqual(["beta"]);
  });

  test("an empty list and a search with no match show different text", async () => {
    const message = (root: HTMLElement) => root.querySelector(".text-assets-list p")?.textContent;
    const empty = await mount();
    expect(message(empty.root)).toBe(i18n.get("text_assets_empty"));

    const { root } = await mount({ [KEY_TEXT_EXPANSIONS]: [["brb", "be right back"]] });
    const search = root.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = "zzz";
    search.dispatchEvent(new Event("input"));
    expect(message(root)).toBe(i18n.get("text_assets_no_snippets"));
  });

  test.each([
    ["the first Clear words click", "clear_dict_btn"],
    ["Add words", "text_assets_add_words"],
  ])("%s keeps the open bulk disclosure open", async (_label, buttonKey) => {
    const { root } = await mount({ [KEY_USER_DICTIONARY_LIST]: ["alpha"] });
    const bulk = () => root.querySelectorAll("details")[0];
    bulk().open = true;
    const textarea = bulk().querySelector("textarea")!;
    textarea.value = "beta";
    textarea.dispatchEvent(new Event("input"));

    findButtonByText(root, i18n.get(buttonKey)).click();
    await flushAsyncWork();

    expect(bulk().open).toBe(true);
  });

  test("a date format change keeps Dynamic variables open and keeps the input", async () => {
    const { root, values } = await mount();
    const variables = () => root.querySelectorAll("details")[1];
    variables().open = true;
    const input = root.querySelector<HTMLInputElement>(
      `input[placeholder="${i18n.get("custom_date_format_label")}"]`,
    )!;

    input.value = "yyyy";
    input.dispatchEvent(new Event("change"));

    expect(values[KEY_DATE_FORMAT]).toBe("yyyy");
    expect(variables().open).toBe(true);
    expect(input.isConnected).toBe(true);
  });

  test.each<[string, string, string, (root: HTMLElement) => Promise<void> | void]>([
    [
      "typing a shortcut",
      "text_assets_delete_snippet",
      "text_assets_delete_snippet_confirm",
      (root) => {
        const shortcut = root.querySelector<HTMLInputElement>(".text-assets-editor input")!;
        shortcut.value = "brb2";
        shortcut.dispatchEvent(new Event("input"));
      },
    ],
    [
      "a variable chip click",
      "text_assets_delete_snippet",
      "text_assets_delete_snippet_confirm",
      (root) => root.querySelector<HTMLButtonElement>(".variable-chip")!.click(),
    ],
    [
      "a CSV import",
      "text_assets_delete_snippet",
      "text_assets_delete_snippet_confirm",
      (root) => importFile(root, ".csv", "sig,signature"),
    ],
    [
      "typing bulk words",
      "clear_dict_btn",
      "text_assets_clear_words_confirm",
      (root) => {
        const textarea = root.querySelector<HTMLTextAreaElement>("details textarea")!;
        textarea.value = "x";
        textarea.dispatchEvent(new Event("input"));
      },
    ],
  ])("%s after the first click cancels the armed action", async (_label, arm, confirm, edit) => {
    const { root, values } = await mount({
      [KEY_TEXT_EXPANSIONS]: [["brb", "be right back"]],
      [KEY_USER_DICTIONARY_LIST]: ["alpha"],
    });
    findButtonByText(root, i18n.get(arm)).click();
    expect(root.textContent).toContain(i18n.get(confirm));

    await edit(root);
    await flushAsyncWork();

    expect(root.textContent).not.toContain(i18n.get(confirm));
    // The next click only arms the action again.
    findButtonByText(root, i18n.get(arm)).click();
    expect(values[KEY_TEXT_EXPANSIONS]).not.toEqual([]);
    expect(values[KEY_USER_DICTIONARY_LIST]).toEqual(["alpha"]);
  });

  test("Save with an empty shortcut adds no hidden row", async () => {
    const { root, values } = await mount();

    findButtonByText(root, i18n.get("text_assets_save_snippet")).click();
    findButtonByText(root, i18n.get("site_profiles_cancel_btn")).click();
    await flushAsyncWork();

    expect(root.querySelectorAll(".text-assets-list-item")).toHaveLength(0);
    expect(values[KEY_TEXT_EXPANSIONS]).toEqual([]);
  });

  test("Save with an empty body shows an error and saves nothing", async () => {
    const { root, values } = await mount();

    findButtonByText(root, i18n.get("text_assets_new_snippet")).click();
    const shortcutInput = root.querySelector(".text-assets-editor input") as HTMLInputElement;
    const bodyInput = root.querySelector(".text-assets-editor textarea") as HTMLTextAreaElement;
    shortcutInput.value = "aa";
    shortcutInput.dispatchEvent(new Event("input", { bubbles: true }));
    bodyInput.value = "  \n";
    bodyInput.dispatchEvent(new Event("input", { bubbles: true }));
    findButtonByText(root, i18n.get("text_assets_save_snippet")).click();
    await flushAsyncWork();

    expect(values[KEY_TEXT_EXPANSIONS]).toEqual([]);
    const status = root.querySelector(".text-assets-editor .has-text-danger");
    expect(status?.textContent).toBe(i18n.get("text_assets_snippet_body_required"));
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
    const csv = "brb,be right back\nsig,first import\nsig,first import\nsig,second import";
    await importFile(root, ".csv", csv);
    await importFile(root, ".csv", csv);

    expect(values[KEY_TEXT_EXPANSIONS]).toEqual([
      ["brb", "be right back"],
      ["sig", "first import"],
      ["sig", "second import"],
    ]);
  });

  test("csv import skips imported empty bodies and keeps saved snippets", async () => {
    const { root, values } = await mount({ [KEY_TEXT_EXPANSIONS]: [["old", ""]] });
    await importFile(root, ".csv", 'aa,A.A.\nempty,\nblank," "');

    expect(values[KEY_TEXT_EXPANSIONS]).toEqual([
      ["old", ""],
      ["aa", "A.A."],
    ]);
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

  test("Enter in the add input adds a dictionary word", async () => {
    const { root, values } = await mount({ [KEY_USER_DICTIONARY_LIST]: [] });
    const input = root.querySelector<HTMLInputElement>(
      `input[placeholder="${i18n.get("text_assets_add_custom_word_placeholder")}"]`,
    )!;
    input.value = "alpha";

    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
    await flushAsyncWork();

    expect(values[KEY_USER_DICTIONARY_LIST]).toEqual(["alpha"]);
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
