import type { SettingsRegistry } from "@ui/settings-engine/SettingsEngine.js";
import type { Store } from "@core/application/storage/Store.js";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import {
  KEY_DATE_FORMAT,
  KEY_TEXT_EXPANSIONS,
  KEY_TIME_FORMAT,
  KEY_USER_DICTIONARY_LIST,
} from "@core/domain/constants";
import { resolveDynamicVariable } from "@core/domain/variables";
import { formatTranslation, i18n } from "./fluenttyperI18n.js";
import { createElement } from "@ui/settings-engine/dom/createElement.js";
import {
  createButton,
  createDisclosure,
  createHelpList,
  createInlineCard,
  createRemovableList,
  createSearchInput,
  createStackField,
  downloadBlob,
  formatLooseText,
  replaceChildrenKeepingDisclosures,
} from "./workspacePanelUtils.js";

type TextExpansionEntry = [string, string];
type SnippetRow = {
  id: string;
  shortcut: string;
  text: string;
  savedShortcut: string;
  savedText: string;
  persisted: boolean;
};

const VARIABLE_SNIPPETS = [
  "${time}",
  "${date}",
  "${date:+1d}",
  "${datetime}",
  "${uuid}",
  "${random:A|B|C}",
  "${page_url}",
  "${page_title}",
  "${page_domain}",
];

const PAGE_VARIABLE_PREVIEWS = new Map([
  ["page_url", "https://example.com/path"],
  ["page_title", "Example page"],
  ["page_domain", "example.com"],
]);

/** Builds a ghost-button label with a hidden file input that reads the chosen file as text. */
function createFileImport(
  labelKey: string,
  accept: string,
  onText: (text: string) => void,
): HTMLLabelElement {
  const label = createElement("label", {
    className: "settings-ghost-button",
    textContent: i18n.get(labelKey),
  });
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.hidden = true;
  input.addEventListener("input", () => {
    const file = input.files?.[0];
    input.value = "";
    void file?.text().then(onText);
  });
  label.appendChild(input);
  return label;
}

export class TextAssetsPanel {
  private readonly root: HTMLElement;
  private readonly registry: SettingsRegistry;
  private readonly store: Store;
  private searchQuery = "";
  private dictionaryQuery = "";
  private snippetRows: SnippetRow[] = [];
  private selectedSnippetId: string | null = null;
  private snippetRowSeq = 0;
  private dictionary: string[] = [];
  private snippetStatusText = "";
  private snippetStatusIsError = false;
  private dictionaryStatusText = "";
  private dictionaryStatusIsError = false;
  private clearDictionaryArmed = false;
  private snippetDeleteArmed = false;
  private bulkDictionaryValue = "";
  private activeSnippetBody: HTMLTextAreaElement | null = null;
  private activeSnippetPreview: HTMLElement | null = null;
  private liveFormats: Record<string, string> = {};
  private readonly formatInputs = new Map<string, HTMLInputElement>();

  constructor(root: HTMLElement, registry: SettingsRegistry, store: Store) {
    this.root = root;
    this.registry = registry;
    this.store = store;

    for (const key of [KEY_TEXT_EXPANSIONS, KEY_USER_DICTIONARY_LIST]) {
      this.registry[key]?.addEvent("action", () => void this.load());
    }
    for (const key of [KEY_DATE_FORMAT, KEY_TIME_FORMAT]) {
      this.registry[key]?.addEvent("change", () => {
        const value = formatLooseText(this.registry[key].get());
        this.liveFormats[key] = value;
        // Do not render, so that the open disclosure and the focused field stay as they are.
        const input = this.formatInputs.get(key);
        if (input && input.value !== value) {
          input.value = value;
        }
        this.refreshActiveSnippetPreview();
      });
    }

    void this.load();
  }

  private async load(): Promise<void> {
    const [rawExpansions, rawDictionary, rawDateFormat, rawTimeFormat] = await Promise.all([
      this.store.get(KEY_TEXT_EXPANSIONS),
      this.store.get(KEY_USER_DICTIONARY_LIST),
      this.store.get(KEY_DATE_FORMAT),
      this.store.get(KEY_TIME_FORMAT),
    ]);
    const expansions = Array.isArray(rawExpansions)
      ? rawExpansions.filter(
          (entry): entry is [string, string] =>
            Array.isArray(entry) &&
            entry.length === 2 &&
            typeof entry[0] === "string" &&
            typeof entry[1] === "string",
        )
      : [];
    this.syncPersistedRows(expansions);
    this.dictionary = Array.isArray(rawDictionary)
      ? rawDictionary.map((entry) => formatLooseText(entry)).filter(Boolean)
      : [];
    this.liveFormats = {
      [KEY_DATE_FORMAT]: typeof rawDateFormat === "string" ? rawDateFormat : "",
      [KEY_TIME_FORMAT]: typeof rawTimeFormat === "string" ? rawTimeFormat : "",
    };
    this.render();
  }

  render(): void {
    const lowerGrid = createElement("div", { className: "workspace-main-grid" });
    lowerGrid.append(this.createDictionaryWorkspace(), this.createVariableWorkspace());
    const snippets = createInlineCard(
      i18n.get("text_expander"),
      i18n.get("options_panel_text_assets_desc"),
    );
    const workspace = this.createSnippetWorkspace();
    snippets.append(this.createToolbar(workspace.filter), workspace.shell);
    const shell = createElement("div", { className: "workspace-panel-stack" });
    shell.append(snippets, lowerGrid);
    replaceChildrenKeepingDisclosures(this.root, () => shell);
  }

  private createToolbar(onQuery: () => void): HTMLElement {
    const actions = createElement("div", { className: "text-assets-actions" });
    actions.append(
      createButton(i18n.get("text_assets_new_snippet"), "button", () => {
        const row = this.createSnippetRow({ shortcut: "", text: "", persisted: false });
        this.snippetRows = [row, ...this.snippetRows];
        this.selectedSnippetId = row.id;
        this.snippetDeleteArmed = false;
        this.setSnippetStatus("");
        this.render();
      }),
      createButton(i18n.get("text_expander_export_csv_btn"), "button", () => {
        const csv = stringify(this.getPersistedExpansions());
        downloadBlob(new Blob([csv], { type: "text/csv" }), "FluentTyperTextExpanderDataBase.csv");
      }),
      createFileImport("text_expander_import_csv_btn", ".csv", (csvText) => {
        const parsed = parse(csvText, {
          skip_records_with_error: true,
          relax_column_count: true,
          columns: false,
          skip_empty_lines: true,
        }) as unknown[][];
        const imported = parsed
          .filter((row) => row.length === 2)
          .map((row) => [formatLooseText(row[0]), formatLooseText(row[1])] as TextExpansionEntry);
        this.syncPersistedRows(this.mergeExpansions(this.getPersistedExpansions(), imported));
        this.snippetDeleteArmed = false;
        this.setSnippetStatus(i18n.get("settings_status_saved"));
        this.persistSnippetRows();
      }),
    );

    const toolbar = createElement("div", { className: "text-assets-toolbar" });
    toolbar.append(
      createSearchInput(i18n.get("text_assets_search_placeholder"), this.searchQuery, (query) => {
        this.searchQuery = query;
        onQuery();
      }),
      actions,
    );
    return toolbar;
  }

  private createSnippetWorkspace(): { shell: HTMLElement; filter: () => void } {
    const shell = createElement("section", { className: "text-assets-shell" });

    const list = createElement("div", { className: "text-assets-list" });
    // Rebuild only the list, so that the search input keeps its focus while the user types.
    // Return true when the list selects a snippet, because then the editor must change too.
    const fillList = (): boolean => {
      const filtered = this.snippetRows.filter(({ shortcut, text }) =>
        [shortcut, text].join(" ").toLowerCase().includes(this.searchQuery),
      );
      if (!filtered.length) {
        list.replaceChildren(
          createElement("p", {
            className: "settings-inline-help",
            textContent: i18n.get(
              this.searchQuery ? "text_assets_no_snippets" : "text_assets_empty",
            ),
          }),
        );
      } else {
        list.replaceChildren(...filtered.map((row) => this.createSnippetListItem(row)));
      }

      if (!this.selectedSnippetId && filtered.length > 0) {
        this.selectedSnippetId = filtered[0].id;
        return true;
      }
      return false;
    };
    fillList();

    let editor = this.createSnippetEditor();
    shell.appendChild(list);
    shell.appendChild(editor);
    const filter = () => {
      if (fillList()) {
        const nextEditor = this.createSnippetEditor();
        editor.replaceWith(nextEditor);
        editor = nextEditor;
      }
    };
    return { shell, filter };
  }

  private createSnippetListItem({ id, shortcut, text }: SnippetRow): HTMLButtonElement {
    const item = createButton("", "text-assets-list-item", () => {
      this.selectedSnippetId = id;
      this.snippetDeleteArmed = false;
      this.setSnippetStatus("");
      this.render();
    });
    if (id === this.selectedSnippetId) {
      item.classList.add("is-active");
    }
    item.append(
      createElement("strong", {
        textContent: shortcut || i18n.get("text_assets_untitled_shortcut"),
      }),
      createElement("span", {
        textContent: text.slice(0, 80) || i18n.get("text_assets_add_expansion_text"),
      }),
    );
    return item;
  }

  private createSnippetEditor(): HTMLElement {
    const editor = createElement("div", { className: "text-assets-editor" });

    const currentRow = this.getSelectedSnippet();
    // An edit cancels a delete that waits for its confirmation click.
    const disarmDelete = () => {
      if (!this.snippetDeleteArmed) {
        return;
      }
      this.snippetDeleteArmed = false;
      deleteButton.textContent = i18n.get("text_assets_delete_snippet");
      updateSnippetStatus("");
    };

    const shortcut = createElement("input", { className: "input" });
    shortcut.placeholder = i18n.get("text_expander_shortcut_placeholder");
    shortcut.value = currentRow?.shortcut ?? "";
    shortcut.addEventListener("input", () => {
      disarmDelete();
      if (currentRow) {
        currentRow.shortcut = shortcut.value;
      }
    });

    const body = createElement("textarea", { className: "textarea" });
    body.rows = 8;
    body.placeholder = i18n.get("text_expander_shortcut_text_placeholder");
    body.value = currentRow?.text ?? "";
    body.addEventListener("input", () => {
      disarmDelete();
      if (currentRow) {
        currentRow.text = body.value;
      }
      this.updateSnippetPreview(preview, body.value);
    });

    const variables = createElement("div", { className: "variable-chip-row" });
    VARIABLE_SNIPPETS.forEach((token) => {
      variables.appendChild(
        createButton(token, "variable-chip", () => {
          body.value += body.value ? ` ${token}` : token;
          body.dispatchEvent(new Event("input"));
        }),
      );
    });

    const preview = createElement("div", { className: "snippet-preview" });
    this.updateSnippetPreview(preview, body.value);
    this.activeSnippetBody = body;
    this.activeSnippetPreview = preview;

    const status = createElement("p", { className: "settings-inline-help" });
    const updateSnippetStatus = (text: string, isError = false) => {
      this.setSnippetStatus(text, isError);
      status.textContent = text || i18n.get("text_assets_snippet_helper_text");
      status.classList.toggle("has-text-danger", isError);
    };
    updateSnippetStatus(this.snippetStatusText, this.snippetStatusIsError);

    const actions = createElement("div", { className: "text-assets-actions" });
    actions.appendChild(
      createButton(i18n.get("text_assets_save_snippet"), "button", () => {
        const nextEntry: TextExpansionEntry = [shortcut.value.trim(), body.value];
        if (!nextEntry[0]) {
          return;
        }
        let targetRow = this.getSelectedSnippet();
        if (!targetRow) {
          targetRow = this.createSnippetRow({
            shortcut: shortcut.value,
            text: body.value,
            persisted: false,
          });
          this.snippetRows = [targetRow, ...this.snippetRows];
          this.selectedSnippetId = targetRow.id;
        }
        targetRow.shortcut = nextEntry[0];
        targetRow.text = nextEntry[1];
        targetRow.savedShortcut = nextEntry[0];
        targetRow.savedText = nextEntry[1];
        targetRow.persisted = true;
        this.selectedSnippetId = targetRow.id;
        this.snippetDeleteArmed = false;
        updateSnippetStatus(i18n.get("settings_status_saved"));
        this.persistSnippetRows();
      }),
    );
    actions.appendChild(
      createButton(i18n.get("site_profiles_cancel_btn"), "button is-light", () => {
        this.snippetDeleteArmed = false;
        updateSnippetStatus("");
        const selectedRow = this.getSelectedSnippet();
        if (selectedRow?.persisted) {
          selectedRow.shortcut = selectedRow.savedShortcut;
          selectedRow.text = selectedRow.savedText;
        } else if (selectedRow && this.snippetRows.length > 1) {
          this.selectedSnippetId =
            this.snippetRows.find((row) => row.id !== selectedRow.id)?.id ?? selectedRow.id;
        }
        this.render();
      }),
    );
    const deleteButton = createButton(
      this.snippetDeleteArmed
        ? i18n.get("text_assets_delete_snippet_confirm")
        : i18n.get("text_assets_delete_snippet"),
      "button is-danger",
      () => {
        const selectedRow = this.getSelectedSnippet();
        if (!selectedRow) {
          return;
        }
        if (!this.snippetDeleteArmed) {
          this.snippetDeleteArmed = true;
          updateSnippetStatus(i18n.get("text_assets_delete_snippet_confirm"), true);
          this.render();
          return;
        }
        const removedIndex = this.snippetRows.findIndex((row) => row.id === selectedRow.id);
        this.snippetRows = this.snippetRows.filter((row) => row.id !== selectedRow.id);
        this.selectedSnippetId =
          this.snippetRows[removedIndex]?.id ??
          this.snippetRows[removedIndex - 1]?.id ??
          this.snippetRows[0]?.id ??
          null;
        this.snippetDeleteArmed = false;
        updateSnippetStatus(i18n.get("text_assets_snippet_deleted"));
        if (selectedRow.persisted) {
          this.persistSnippetRows();
          return;
        }
        this.render();
      },
    );
    actions.appendChild(deleteButton);

    editor.append(
      createStackField(i18n.get("text_expander_shortcut_placeholder"), shortcut),
      createStackField(i18n.get("text_assets_expansion_label"), body),
      variables,
      createStackField(i18n.get("text_assets_preview_label"), preview),
      actions,
      status,
    );
    return editor;
  }

  private createDictionaryWorkspace(): HTMLElement {
    const shell = createInlineCard(i18n.get("custom_words"));
    const { toolbar, list } = createRemovableList({
      searchPlaceholder: i18n.get("text_assets_dictionary_search"),
      query: this.dictionaryQuery,
      onQuery: (query) => {
        this.dictionaryQuery = query;
      },
      addPlaceholder: i18n.get("text_assets_add_custom_word_placeholder"),
      addLabel: i18n.get("add"),
      onAdd: (input) => {
        const value = input.value.trim();
        if (!value || this.dictionary.includes(value)) {
          return;
        }
        this.dictionary = [...this.dictionary, value];
        this.persistDictionary();
      },
      items: this.dictionary,
      onRemove: (word) => {
        this.dictionary = this.dictionary.filter((entry) => entry !== word);
        this.persistDictionary();
      },
      emptyText: i18n.get("text_assets_no_dictionary_matches"),
    });
    shell.append(toolbar, list);

    const bulk = createDisclosure(i18n.get("text_assets_bulk_add_import"));

    const bulkTextarea = createElement("textarea", { className: "textarea" });
    bulkTextarea.rows = 4;
    bulkTextarea.placeholder = i18n.get("text_assets_paste_word_per_line");
    bulkTextarea.value = this.bulkDictionaryValue;
    const bulkPreview = createElement("p", { className: "settings-inline-help" });
    const bulkAddButton = createButton(i18n.get("text_assets_add_words"), "button", () => {
      const nextWords = this.extractNewDictionaryWords(bulkTextarea.value);
      if (nextWords.length === 0) {
        return;
      }
      this.dictionary = [...this.dictionary, ...nextWords];
      this.bulkDictionaryValue = "";
      this.persistDictionary();
    });
    // An edit cancels a clear that waits for its confirmation click.
    const disarmClear = () => {
      if (!this.clearDictionaryArmed) {
        return;
      }
      this.clearDictionaryArmed = false;
      clearButton.textContent = i18n.get("clear_dict_btn");
      this.setDictionaryStatus("");
      status.textContent = i18n.get("text_assets_bulk_helper_text");
      status.classList.remove("has-text-danger");
    };
    bulkTextarea.addEventListener("input", () => {
      this.bulkDictionaryValue = bulkTextarea.value;
      disarmClear();
      this.updateBulkPreview(bulkPreview, bulkAddButton, bulkTextarea.value);
    });
    this.updateBulkPreview(bulkPreview, bulkAddButton, bulkTextarea.value);
    const clearButton = createButton(
      this.clearDictionaryArmed
        ? i18n.get("text_assets_clear_words_confirm")
        : i18n.get("clear_dict_btn"),
      "button is-danger",
      () => {
        if (!this.clearDictionaryArmed) {
          this.clearDictionaryArmed = true;
          this.setDictionaryStatus(i18n.get("text_assets_clear_words_confirm"), true);
          this.render();
          return;
        }
        this.dictionary = [];
        this.persistDictionary();
      },
    );
    bulk.append(
      bulkTextarea,
      bulkPreview,
      bulkAddButton,
      createFileImport("import_dict_btn", ".txt", (text) => {
        this.dictionary = [...this.dictionary, ...this.extractNewDictionaryWords(text)];
        this.persistDictionary();
      }),
      clearButton,
    );

    const status = createElement("p", {
      className: "settings-inline-help",
      textContent: this.dictionaryStatusText || i18n.get("text_assets_bulk_helper_text"),
    });
    status.classList.toggle("has-text-danger", this.dictionaryStatusIsError);
    shell.appendChild(status);
    shell.appendChild(bulk);
    return shell;
  }

  private createVariableWorkspace(): HTMLElement {
    const shell = createDisclosure(i18n.get("dynamic_variables"));

    const createFormatField = (
      key: typeof KEY_DATE_FORMAT | typeof KEY_TIME_FORMAT,
      labelKey: string,
    ) => {
      const input = createElement("input", { className: "input" });
      input.value = formatLooseText(this.registry[key].get());
      input.placeholder = i18n.get(labelKey);
      this.formatInputs.set(key, input);
      input.addEventListener("input", () => {
        this.liveFormats[key] = input.value;
        this.refreshActiveSnippetPreview();
      });
      input.addEventListener("change", () => {
        this.liveFormats[key] = input.value;
        this.registry[key].set(input.value);
      });
      return createStackField(i18n.get(labelKey), input);
    };

    const docsLink = document.createElement("a");
    docsLink.href = "https://moment.github.io/luxon/#/formatting?id=table-of-tokens";
    docsLink.target = "_blank";
    docsLink.rel = "noreferrer";
    docsLink.textContent = i18n.get("text_assets_luxon_link_label");

    const docs = createInlineCard(undefined, i18n.get("text_assets_advanced_variables_docs"));
    docs.append(
      createHelpList([
        i18n.get("text_assets_variable_group_datetime"),
        i18n.get("text_assets_variable_group_utility"),
        i18n.get("text_assets_variable_group_page"),
      ]),
      createElement("p", {
        className: "settings-inline-help",
        textContent: i18n.get("text_assets_luxon_intro"),
      }),
      docsLink,
      createHelpList([
        i18n.get("text_assets_luxon_example_date_short"),
        i18n.get("text_assets_luxon_example_date_long"),
        i18n.get("text_assets_luxon_example_time_short"),
        i18n.get("text_assets_luxon_example_time_long"),
      ]),
    );

    shell.append(
      createFormatField(KEY_DATE_FORMAT, "custom_date_format_label"),
      createFormatField(KEY_TIME_FORMAT, "custom_time_format_label"),
      docs,
    );
    return shell;
  }

  private persistSnippetRows(): void {
    this.registry[KEY_TEXT_EXPANSIONS].set(this.getPersistedExpansions());
  }

  private persistDictionary(): void {
    this.clearDictionaryArmed = false;
    this.setDictionaryStatus(i18n.get("settings_status_saved"));
    this.dictionary = Array.from(new Set(this.dictionary)).sort((a, b) => a.localeCompare(b));
    this.registry[KEY_USER_DICTIONARY_LIST].set(this.dictionary);
  }

  private mergeExpansions(
    existing: TextExpansionEntry[],
    imported: TextExpansionEntry[],
  ): TextExpansionEntry[] {
    const seen = new Set<string>();
    return [...existing, ...imported].flatMap(([shortcut, text]) => {
      const normalizedShortcut = shortcut.trim();
      if (!normalizedShortcut) {
        return [];
      }
      const signature = JSON.stringify([normalizedShortcut, text]);
      if (seen.has(signature)) {
        return [];
      }
      seen.add(signature);
      return [[normalizedShortcut, text]] as TextExpansionEntry[];
    });
  }

  private getSelectedSnippet(): SnippetRow | null {
    return this.snippetRows.find((row) => row.id === this.selectedSnippetId) ?? null;
  }

  private getPersistedExpansions(): TextExpansionEntry[] {
    return this.snippetRows
      .filter((row) => row.persisted && row.savedShortcut.trim().length > 0)
      .map((row) => [row.savedShortcut.trim(), row.savedText]);
  }

  private createSnippetRow({
    shortcut,
    text,
    persisted,
    id,
  }: {
    shortcut: string;
    text: string;
    persisted: boolean;
    id?: string;
  }): SnippetRow {
    return {
      id: id ?? `snippet-row-${++this.snippetRowSeq}`,
      shortcut,
      text,
      savedShortcut: shortcut,
      savedText: text,
      persisted,
    };
  }

  private syncPersistedRows(expansions: TextExpansionEntry[]): void {
    const drafts = this.snippetRows.filter((row) => !row.persisted);
    const existingIdsBySignature = new Map<string, string[]>();
    this.snippetRows
      .filter((row) => row.persisted)
      .forEach((row) => {
        const signature = `${row.savedShortcut}\u0000${row.savedText}`;
        existingIdsBySignature.set(signature, [
          ...(existingIdsBySignature.get(signature) || []),
          row.id,
        ]);
      });

    const persistedRows = expansions.map(([shortcut, text]) => {
      const signature = `${shortcut}\u0000${text}`;
      const nextId = existingIdsBySignature.get(signature)?.shift();
      return this.createSnippetRow({
        shortcut,
        text,
        persisted: true,
        id: nextId,
      });
    });

    this.snippetRows = [...drafts, ...persistedRows];
    if (!this.selectedSnippetId || !this.getSelectedSnippet()) {
      this.selectedSnippetId = this.snippetRows[0]?.id ?? null;
    }
  }

  private updateSnippetPreview(target: HTMLElement, rawValue: string): void {
    const preview = rawValue.replace(
      /\$\{([^}:]+)(?::([^}]+))?\}/g,
      (_match, varName, arg) =>
        PAGE_VARIABLE_PREVIEWS.get(String(varName)) ??
        (resolveDynamicVariable(
          String(varName),
          arg ? String(arg) : undefined,
          "en_US",
          this.liveFormats[KEY_TIME_FORMAT],
          this.liveFormats[KEY_DATE_FORMAT],
        ) ||
          `\${${String(varName)}}`),
    );
    target.textContent = preview || i18n.get("text_assets_preview_placeholder");
  }

  private refreshActiveSnippetPreview(): void {
    if (!this.activeSnippetBody || !this.activeSnippetPreview) {
      return;
    }
    this.updateSnippetPreview(this.activeSnippetPreview, this.activeSnippetBody.value);
  }

  private extractNewDictionaryWords(rawValue: string): string[] {
    const existing = new Set(this.dictionary);
    return Array.from(
      new Set(
        rawValue
          .split(/\r?\n/)
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0 && !existing.has(entry)),
      ),
    );
  }

  private updateBulkPreview(
    preview: HTMLElement,
    addButton: HTMLButtonElement,
    rawValue: string,
  ): void {
    const words = this.extractNewDictionaryWords(rawValue);
    preview.textContent = formatTranslation("text_assets_bulk_add_preview", {
      count: words.length,
    });
    addButton.textContent = `${i18n.get("text_assets_add_words")} (${words.length})`;
  }

  private setSnippetStatus(text: string, isError = false): void {
    this.snippetStatusText = text;
    this.snippetStatusIsError = isError;
  }

  private setDictionaryStatus(text: string, isError = false): void {
    this.dictionaryStatusText = text;
    this.dictionaryStatusIsError = isError;
  }
}
