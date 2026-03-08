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

type TextExpansionEntry = [string, string];

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

export class TextAssetsPanel {
  private readonly root: HTMLElement;
  private readonly registry: SettingsRegistry;
  private readonly store: Store;
  private searchQuery = "";
  private dictionaryQuery = "";
  private editingIndex = -1;
  private expansions: TextExpansionEntry[] = [];
  private dictionary: string[] = [];
  private snippetStatusText = "";
  private snippetStatusIsError = false;
  private dictionaryStatusText = "";
  private dictionaryStatusIsError = false;
  private clearDictionaryArmed = false;
  private snippetDeleteArmed = false;
  private bulkDictionaryValue = "";

  constructor(root: HTMLElement, registry: SettingsRegistry, store: Store) {
    this.root = root;
    this.registry = registry;
    this.store = store;

    this.registry[KEY_TEXT_EXPANSIONS]?.addEvent("action", () => void this.load());
    this.registry[KEY_USER_DICTIONARY_LIST]?.addEvent("action", () => void this.load());
    this.registry[KEY_DATE_FORMAT]?.addEvent("action", () => void this.render());
    this.registry[KEY_TIME_FORMAT]?.addEvent("action", () => void this.render());

    void this.load();
  }

  private async load(): Promise<void> {
    const [rawExpansions, rawDictionary] = await Promise.all([
      this.store.get(KEY_TEXT_EXPANSIONS),
      this.store.get(KEY_USER_DICTIONARY_LIST),
    ]);
    this.expansions = Array.isArray(rawExpansions)
      ? rawExpansions.filter(
          (entry): entry is [string, string] =>
            Array.isArray(entry) &&
            entry.length === 2 &&
            typeof entry[0] === "string" &&
            typeof entry[1] === "string",
        )
      : [];
    this.dictionary = Array.isArray(rawDictionary)
      ? rawDictionary.map((entry) => String(entry)).filter(Boolean)
      : [];
    if (this.editingIndex >= this.expansions.length) {
      this.editingIndex = this.expansions.length > 0 ? 0 : -1;
    }
    this.render();
  }

  render(): void {
    this.root.replaceChildren(
      this.createToolbar(),
      this.createSnippetWorkspace(),
      this.createDictionaryWorkspace(),
      this.createVariableWorkspace(),
    );
  }

  private createToolbar(): HTMLElement {
    const toolbar = document.createElement("div");
    toolbar.className = "text-assets-toolbar";

    const search = document.createElement("input");
    search.type = "search";
    search.className = "input";
    search.placeholder = i18n.get("text_assets_search_placeholder");
    search.value = this.searchQuery;
    search.addEventListener("input", () => {
      this.searchQuery = search.value.trim().toLowerCase();
      this.render();
    });
    toolbar.appendChild(search);

    const actions = document.createElement("div");
    actions.className = "text-assets-actions";

    const addButton = this.createButton(i18n.get("text_assets_new_snippet"), () => {
      this.editingIndex = -1;
      this.snippetDeleteArmed = false;
      this.setSnippetStatus("");
      this.render();
    });
    actions.appendChild(addButton);

    const exportButton = this.createButton(i18n.get("text_expander_export_csv_btn"), () => {
      const csv = stringify(this.expansions);
      const blob = new Blob([csv], { type: "text/csv" });
      const link = document.createElement("a");
      link.href = window.URL.createObjectURL(blob);
      link.download = "FluentTyperTextExpanderDataBase.csv";
      link.click();
      window.setTimeout(() => window.URL.revokeObjectURL(link.href), 1200);
    });
    actions.appendChild(exportButton);

    const importLabel = document.createElement("label");
    importLabel.className = "settings-ghost-button";
    importLabel.textContent = i18n.get("text_expander_import_csv_btn");
    const importInput = document.createElement("input");
    importInput.type = "file";
    importInput.accept = ".csv";
    importInput.hidden = true;
    importInput.addEventListener("input", () => {
      const file = importInput.files?.[0];
      if (!file) {
        return;
      }
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        const parsed = parse(reader.result as string, {
          skip_records_with_error: true,
          relax_column_count: true,
          columns: false,
          skip_empty_lines: true,
        }) as unknown[][];
        const imported = parsed
          .filter((row) => row.length === 2)
          .map((row) => [String(row[0]), String(row[1])] as TextExpansionEntry);
        this.expansions = this.mergeExpansions(imported, this.expansions);
        this.persistExpansions();
      });
      reader.readAsText(file);
      importInput.value = "";
    });
    importLabel.appendChild(importInput);
    actions.appendChild(importLabel);

    toolbar.appendChild(actions);
    return toolbar;
  }

  private createSnippetWorkspace(): HTMLElement {
    const shell = document.createElement("section");
    shell.className = "text-assets-shell";

    const list = document.createElement("div");
    list.className = "text-assets-list";
    const filtered = this.expansions
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry: [shortcut, text] }) =>
        [shortcut, text].join(" ").toLowerCase().includes(this.searchQuery),
      );
    if (filtered.length === 0) {
      const empty = document.createElement("p");
      empty.className = "settings-inline-help";
      empty.textContent = i18n.get("text_assets_no_snippets");
      list.appendChild(empty);
    } else {
      filtered.forEach(({ entry: [shortcut, text], index }) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "text-assets-list-item";
        if (index === this.editingIndex) {
          item.classList.add("is-active");
        }
        const title = document.createElement("strong");
        title.textContent = shortcut || i18n.get("text_assets_untitled_shortcut");
        item.appendChild(title);
        const excerpt = document.createElement("span");
        excerpt.textContent = text.slice(0, 80) || i18n.get("text_assets_add_expansion_text");
        item.appendChild(excerpt);
        item.addEventListener("click", () => {
          this.editingIndex = index;
          this.snippetDeleteArmed = false;
          this.setSnippetStatus("");
          this.render();
        });
        list.appendChild(item);
      });
    }

    const editor = this.createSnippetEditor();
    shell.appendChild(list);
    shell.appendChild(editor);
    return shell;
  }

  private createSnippetEditor(): HTMLElement {
    const editor = document.createElement("div");
    editor.className = "text-assets-editor";

    const currentEntry =
      this.editingIndex >= 0
        ? this.expansions[this.editingIndex]
        : (["", ""] as TextExpansionEntry);

    const shortcut = document.createElement("input");
    shortcut.className = "input";
    shortcut.placeholder = i18n.get("text_expander_shortcut_placeholder");
    shortcut.value = currentEntry[0];
    shortcut.addEventListener("input", () => {
      shortcut.setCustomValidity("");
      this.snippetDeleteArmed = false;
      if (this.snippetStatusIsError) {
        this.setSnippetStatus("");
      }
    });

    const body = document.createElement("textarea");
    body.className = "textarea";
    body.rows = 8;
    body.placeholder = i18n.get("text_expander_shortcut_text_placeholder");
    body.value = currentEntry[1];
    body.addEventListener("input", () => {
      this.snippetDeleteArmed = false;
    });

    const variables = document.createElement("div");
    variables.className = "variable-chip-row";
    VARIABLE_SNIPPETS.forEach((token) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "variable-chip";
      chip.textContent = token;
      chip.addEventListener("click", () => {
        body.value += body.value ? ` ${token}` : token;
        this.updateSnippetPreview(preview, body.value);
      });
      variables.appendChild(chip);
    });

    const preview = document.createElement("div");
    preview.className = "snippet-preview";
    this.updateSnippetPreview(preview, body.value);
    body.addEventListener("input", () => {
      this.updateSnippetPreview(preview, body.value);
    });

    const status = document.createElement("p");
    status.className = "settings-inline-help";
    const updateSnippetStatus = (text: string, isError = false) => {
      this.setSnippetStatus(text, isError);
      status.textContent = text || i18n.get("text_assets_snippet_helper_text");
      status.classList.toggle("has-text-danger", isError);
    };
    updateSnippetStatus(this.snippetStatusText, this.snippetStatusIsError);

    const actions = document.createElement("div");
    actions.className = "text-assets-actions";
    actions.appendChild(
      this.createButton(i18n.get("text_assets_save_snippet"), () => {
        const nextEntry: TextExpansionEntry = [shortcut.value.trim(), body.value];
        if (!nextEntry[0]) {
          return;
        }
        const duplicateIndex = this.expansions.findIndex(
          ([existingShortcut], index) =>
            existingShortcut === nextEntry[0] && index !== this.editingIndex,
        );
        if (duplicateIndex !== -1) {
          shortcut.setCustomValidity(i18n.get("text_assets_duplicate_shortcut"));
          shortcut.reportValidity();
          updateSnippetStatus(i18n.get("text_assets_duplicate_shortcut"), true);
          return;
        }
        if (this.editingIndex === -1) {
          this.expansions = [nextEntry, ...this.expansions];
          this.editingIndex = 0;
        } else {
          this.expansions[this.editingIndex] = nextEntry;
        }
        this.snippetDeleteArmed = false;
        updateSnippetStatus(i18n.get("settings_status_saved"));
        this.persistExpansions();
      }),
    );
    actions.appendChild(
      this.createButton(
        i18n.get("site_profiles_cancel_btn"),
        () => {
          this.snippetDeleteArmed = false;
          updateSnippetStatus("");
          if (this.expansions.length > 0) {
            this.editingIndex = this.editingIndex === -1 ? 0 : this.editingIndex;
          }
          this.render();
        },
        "is-light",
      ),
    );
    actions.appendChild(
      this.createButton(
        this.snippetDeleteArmed
          ? i18n.get("text_assets_delete_snippet_confirm")
          : i18n.get("text_assets_delete_snippet"),
        () => {
          if (this.editingIndex < 0) {
            return;
          }
          if (!this.snippetDeleteArmed) {
            this.snippetDeleteArmed = true;
            updateSnippetStatus(i18n.get("text_assets_delete_snippet_confirm"), true);
            this.render();
            return;
          }
          this.expansions.splice(this.editingIndex, 1);
          this.editingIndex = this.expansions.length > 0 ? 0 : -1;
          this.snippetDeleteArmed = false;
          updateSnippetStatus(i18n.get("text_assets_snippet_deleted"));
          this.persistExpansions();
        },
        "is-danger",
      ),
    );

    editor.append(
      this.createLabeledField(i18n.get("text_expander_shortcut_placeholder"), shortcut),
      this.createLabeledField(i18n.get("text_assets_expansion_label"), body),
      variables,
      this.createLabeledField(i18n.get("text_assets_preview_label"), preview),
      actions,
      status,
    );
    return editor;
  }

  private createDictionaryWorkspace(): HTMLElement {
    const shell = document.createElement("section");
    shell.className = "settings-inline-card";

    const title = document.createElement("h4");
    title.textContent = i18n.get("custom_words");
    shell.appendChild(title);

    const toolbar = document.createElement("div");
    toolbar.className = "text-assets-toolbar";
    const search = document.createElement("input");
    search.type = "search";
    search.className = "input";
    search.placeholder = i18n.get("text_assets_dictionary_search");
    search.value = this.dictionaryQuery;
    search.addEventListener("input", () => {
      this.dictionaryQuery = search.value.trim().toLowerCase();
      this.render();
    });
    toolbar.appendChild(search);

    const addInput = document.createElement("input");
    addInput.className = "input";
    addInput.placeholder = i18n.get("text_assets_add_custom_word_placeholder");
    addInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addButton.click();
      }
    });
    toolbar.appendChild(addInput);

    const addButton = this.createButton(i18n.get("add"), () => {
      const value = addInput.value.trim();
      if (!value || this.dictionary.includes(value)) {
        return;
      }
      this.dictionary = [...this.dictionary, value].sort((a, b) => a.localeCompare(b));
      this.clearDictionaryArmed = false;
      this.setDictionaryStatus(i18n.get("settings_status_saved"));
      this.persistDictionary();
    });
    toolbar.appendChild(addButton);
    shell.appendChild(toolbar);

    const list = document.createElement("div");
    list.className = "domain-table";
    const filteredWords = this.dictionary.filter((word) =>
      word.toLowerCase().includes(this.dictionaryQuery),
    );
    filteredWords.forEach((word) => {
      const row = document.createElement("div");
      row.className = "domain-table-row";
      const label = document.createElement("div");
      label.className = "domain-table-name";
      label.textContent = word;
      row.appendChild(label);
      const removeButton = this.createButton(
        i18n.get("remove"),
        () => {
          this.dictionary = this.dictionary.filter((entry) => entry !== word);
          this.clearDictionaryArmed = false;
          this.setDictionaryStatus(i18n.get("settings_status_saved"));
          this.persistDictionary();
        },
        "is-light",
      );
      row.appendChild(removeButton);
      list.appendChild(row);
    });
    if (!filteredWords.length) {
      const empty = document.createElement("p");
      empty.className = "settings-inline-help";
      empty.textContent = i18n.get("text_assets_no_dictionary_matches");
      list.appendChild(empty);
    }
    shell.appendChild(list);

    const bulk = document.createElement("details");
    bulk.className = "settings-disclosure";
    const summary = document.createElement("summary");
    summary.textContent = i18n.get("text_assets_bulk_add_import");
    bulk.appendChild(summary);

    const bulkTextarea = document.createElement("textarea");
    bulkTextarea.className = "textarea";
    bulkTextarea.rows = 4;
    bulkTextarea.placeholder = i18n.get("text_assets_paste_word_per_line");
    bulkTextarea.value = this.bulkDictionaryValue;
    const bulkPreview = document.createElement("p");
    bulkPreview.className = "settings-inline-help";
    const bulkAddButton = this.createButton(i18n.get("text_assets_add_words"), () => {
      const nextWords = this.extractNewDictionaryWords(bulkTextarea.value);
      if (nextWords.length === 0) {
        return;
      }
      this.dictionary = Array.from(new Set([...this.dictionary, ...nextWords])).sort((a, b) =>
        a.localeCompare(b),
      );
      this.bulkDictionaryValue = "";
      bulkTextarea.value = "";
      this.updateBulkPreview(bulkPreview, bulkAddButton, bulkTextarea.value);
      this.clearDictionaryArmed = false;
      this.setDictionaryStatus(i18n.get("settings_status_saved"));
      this.persistDictionary();
    });
    bulkTextarea.addEventListener("input", () => {
      this.bulkDictionaryValue = bulkTextarea.value;
      this.clearDictionaryArmed = false;
      this.updateBulkPreview(bulkPreview, bulkAddButton, bulkTextarea.value);
    });
    bulk.appendChild(bulkTextarea);
    this.updateBulkPreview(bulkPreview, bulkAddButton, bulkTextarea.value);
    bulk.appendChild(bulkPreview);

    bulk.appendChild(bulkAddButton);

    const importLabel = document.createElement("label");
    importLabel.className = "settings-ghost-button";
    importLabel.textContent = i18n.get("import_dict_btn");
    const importInput = document.createElement("input");
    importInput.type = "file";
    importInput.accept = ".txt";
    importInput.hidden = true;
    importInput.addEventListener("input", () => {
      const file = importInput.files?.[0];
      if (!file) {
        return;
      }
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        const words = String(reader.result)
          .split(/\r?\n/)
          .map((entry) => entry.trim())
          .filter(Boolean);
        this.dictionary = Array.from(new Set([...this.dictionary, ...words])).sort((a, b) =>
          a.localeCompare(b),
        );
        this.clearDictionaryArmed = false;
        this.setDictionaryStatus(i18n.get("settings_status_saved"));
        this.persistDictionary();
      });
      reader.readAsText(file);
      importInput.value = "";
    });
    importLabel.appendChild(importInput);
    bulk.appendChild(importLabel);
    bulk.appendChild(
      this.createButton(
        this.clearDictionaryArmed
          ? i18n.get("text_assets_clear_words_confirm")
          : i18n.get("clear_dict_btn"),
        () => {
          if (!this.clearDictionaryArmed) {
            this.clearDictionaryArmed = true;
            this.setDictionaryStatus(i18n.get("text_assets_clear_words_confirm"), true);
            this.render();
            return;
          }
          this.dictionary = [];
          this.clearDictionaryArmed = false;
          this.setDictionaryStatus(i18n.get("settings_status_saved"));
          this.persistDictionary();
        },
        "is-danger",
      ),
    );

    const status = document.createElement("p");
    status.className = "settings-inline-help";
    status.textContent = this.dictionaryStatusText || i18n.get("text_assets_bulk_helper_text");
    status.classList.toggle("has-text-danger", this.dictionaryStatusIsError);
    shell.appendChild(status);
    shell.appendChild(bulk);
    return shell;
  }

  private createVariableWorkspace(): HTMLElement {
    const shell = document.createElement("details");
    shell.className = "settings-disclosure";

    const summary = document.createElement("summary");
    summary.textContent = i18n.get("dynamic_variables");
    shell.appendChild(summary);

    const dateInput = document.createElement("input");
    dateInput.className = "input";
    dateInput.value = String(this.registry[KEY_DATE_FORMAT].get() || "");
    dateInput.placeholder = i18n.get("custom_date_format_label");
    dateInput.addEventListener("change", () => {
      this.registry[KEY_DATE_FORMAT].set(dateInput.value);
    });

    const timeInput = document.createElement("input");
    timeInput.className = "input";
    timeInput.value = String(this.registry[KEY_TIME_FORMAT].get() || "");
    timeInput.placeholder = i18n.get("custom_time_format_label");
    timeInput.addEventListener("change", () => {
      this.registry[KEY_TIME_FORMAT].set(timeInput.value);
    });

    const docs = document.createElement("div");
    docs.className = "settings-inline-help";
    docs.textContent = i18n.get("text_assets_advanced_variables_docs");

    shell.append(
      this.createLabeledField(i18n.get("custom_date_format_label"), dateInput),
      this.createLabeledField(i18n.get("custom_time_format_label"), timeInput),
      docs,
    );
    return shell;
  }

  private createButton(label: string, onClick: () => void, tone = ""): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `button ${tone}`.trim();
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  private createLabeledField(labelText: string, field: HTMLElement): HTMLElement {
    const wrapper = document.createElement("label");
    wrapper.className = "settings-stack-field";
    const label = document.createElement("span");
    label.textContent = labelText;
    wrapper.appendChild(label);
    wrapper.appendChild(field);
    return wrapper;
  }

  private persistExpansions(): void {
    this.expansions = this.expansions
      .filter(([shortcut]) => shortcut.trim().length > 0)
      .map(([shortcut, text]) => [shortcut.trim(), text]);
    this.registry[KEY_TEXT_EXPANSIONS].set(this.expansions);
  }

  private persistDictionary(): void {
    this.dictionary = Array.from(new Set(this.dictionary)).sort((a, b) => a.localeCompare(b));
    this.registry[KEY_USER_DICTIONARY_LIST].set(this.dictionary);
  }

  private mergeExpansions(
    imported: TextExpansionEntry[],
    existing: TextExpansionEntry[],
  ): TextExpansionEntry[] {
    const merged = new Map<string, string>();
    [...existing, ...imported].forEach(([shortcut, text]) => {
      if (shortcut.trim()) {
        merged.set(shortcut.trim(), text);
      }
    });
    return Array.from(merged.entries());
  }

  private updateSnippetPreview(target: HTMLElement, rawValue: string): void {
    const dateFormat = String(this.registry[KEY_DATE_FORMAT].get() || "");
    const timeFormat = String(this.registry[KEY_TIME_FORMAT].get() || "");
    const preview = rawValue.replace(/\$\{([^}:]+)(?::([^}]+))?\}/g, (_match, varName, arg) => {
      if (varName === "page_url") {
        return "https://example.com/path";
      }
      if (varName === "page_title") {
        return "Example page";
      }
      if (varName === "page_domain") {
        return "example.com";
      }
      return (
        resolveDynamicVariable(
          String(varName),
          arg ? String(arg) : undefined,
          "en_US",
          timeFormat,
          dateFormat,
        ) || `\${${String(varName)}}`
      );
    });
    target.textContent = preview || i18n.get("text_assets_preview_placeholder");
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
