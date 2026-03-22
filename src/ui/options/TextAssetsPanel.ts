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
import {
  bindControlEvents,
  createStackField,
  createWorkspaceGrid,
  createWorkspaceShell,
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

function toTextValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return "";
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
  private liveDateFormat = "";
  private liveTimeFormat = "";

  constructor(root: HTMLElement, registry: SettingsRegistry, store: Store) {
    this.root = root;
    this.registry = registry;
    this.store = store;

    bindControlEvents(this.registry[KEY_TEXT_EXPANSIONS], [["action", () => void this.load()]]);
    bindControlEvents(this.registry[KEY_USER_DICTIONARY_LIST], [
      ["action", () => void this.load()],
    ]);
    bindControlEvents(this.registry[KEY_DATE_FORMAT], [["action", () => void this.render()]]);
    bindControlEvents(this.registry[KEY_TIME_FORMAT], [["action", () => void this.render()]]);
    bindControlEvents(this.registry[KEY_DATE_FORMAT], [
      [
        "change",
        () => {
          this.liveDateFormat = toTextValue(this.registry[KEY_DATE_FORMAT].get());
          this.refreshActiveSnippetPreview();
          void this.render();
        },
      ],
    ]);
    bindControlEvents(this.registry[KEY_TIME_FORMAT], [
      [
        "change",
        () => {
          this.liveTimeFormat = toTextValue(this.registry[KEY_TIME_FORMAT].get());
          this.refreshActiveSnippetPreview();
          void this.render();
        },
      ],
    ]);

    this.liveDateFormat = toTextValue(this.registry[KEY_DATE_FORMAT]?.get());
    this.liveTimeFormat = toTextValue(this.registry[KEY_TIME_FORMAT]?.get());
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
    this.reconcileSnippetRows(expansions);
    this.dictionary = Array.isArray(rawDictionary)
      ? rawDictionary.map((entry) => toTextValue(entry)).filter(Boolean)
      : [];
    this.liveDateFormat = typeof rawDateFormat === "string" ? rawDateFormat : "";
    this.liveTimeFormat = typeof rawTimeFormat === "string" ? rawTimeFormat : "";
    this.render();
  }

  render(): void {
    const shell = createWorkspaceShell();
    const lowerGrid = createWorkspaceGrid("workspace-main-grid");
    lowerGrid.append(this.createDictionaryWorkspace(), this.createVariableWorkspace());
    shell.append(this.createSnippetWorkspaceCard(), lowerGrid);
    this.root.replaceChildren(shell);
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
      const row = this.createSnippetRow({ shortcut: "", text: "", persisted: false });
      this.snippetRows = [row, ...this.snippetRows];
      this.selectedSnippetId = row.id;
      this.snippetDeleteArmed = false;
      this.setSnippetStatus("");
      this.render();
    });
    actions.appendChild(addButton);

    const exportButton = this.createButton(i18n.get("text_expander_export_csv_btn"), () => {
      const csv = stringify(this.getPersistedExpansions());
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
        const csvText = typeof reader.result === "string" ? reader.result : "";
        const parsed = parse(csvText, {
          skip_records_with_error: true,
          relax_column_count: true,
          columns: false,
          skip_empty_lines: true,
        }) as unknown[][];
        const imported = parsed
          .filter((row) => row.length === 2)
          .map((row) => [toTextValue(row[0]), toTextValue(row[1])] as TextExpansionEntry);
        this.syncPersistedRows(this.mergeExpansions(this.getPersistedExpansions(), imported));
        this.setSnippetStatus(i18n.get("settings_status_saved"));
        this.persistSnippetRows();
      });
      reader.readAsText(file);
      importInput.value = "";
    });
    importLabel.appendChild(importInput);
    actions.appendChild(importLabel);

    toolbar.appendChild(actions);
    return toolbar;
  }

  private createSnippetWorkspaceCard(): HTMLElement {
    const shell = document.createElement("section");
    shell.className = "settings-inline-card";

    const title = document.createElement("h4");
    title.textContent = i18n.get("text_expander");
    shell.appendChild(title);

    const helper = document.createElement("p");
    helper.className = "settings-inline-help";
    helper.textContent = i18n.get("options_panel_text_assets_desc");
    shell.appendChild(helper);

    shell.append(this.createToolbar(), this.createSnippetWorkspace());
    return shell;
  }

  private createSnippetWorkspace(): HTMLElement {
    const shell = document.createElement("section");
    shell.className = "text-assets-shell";

    const list = document.createElement("div");
    list.className = "text-assets-list";
    const filtered = this.snippetRows.filter(({ shortcut, text }) =>
      [shortcut, text].join(" ").toLowerCase().includes(this.searchQuery),
    );
    if (!filtered.length && !this.searchQuery && !this.snippetRows.length) {
      const empty = document.createElement("p");
      empty.className = "settings-inline-help";
      empty.textContent = i18n.get("text_assets_no_snippets");
      list.appendChild(empty);
    } else if (!filtered.length) {
      const empty = document.createElement("p");
      empty.className = "settings-inline-help";
      empty.textContent = i18n.get("nothing-found");
      list.appendChild(empty);
    } else {
      filtered.forEach(({ id, shortcut, text }) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "text-assets-list-item";
        item.dataset.snippetRowId = id;
        if (id === this.selectedSnippetId) {
          item.classList.add("is-active");
        }
        const title = document.createElement("strong");
        title.textContent = shortcut || i18n.get("text_assets_untitled_shortcut");
        item.appendChild(title);
        const excerpt = document.createElement("span");
        excerpt.textContent = text.slice(0, 80) || i18n.get("text_assets_add_expansion_text");
        item.appendChild(excerpt);
        item.addEventListener("click", () => {
          this.selectedSnippetId = id;
          this.snippetDeleteArmed = false;
          this.setSnippetStatus("");
          this.render();
        });
        list.appendChild(item);
      });
    }

    if (!this.selectedSnippetId && filtered.length > 0) {
      this.selectedSnippetId = filtered[0].id;
    }

    const editor = this.createSnippetEditor();
    shell.appendChild(list);
    shell.appendChild(editor);
    return shell;
  }

  private createSnippetEditor(): HTMLElement {
    const editor = document.createElement("div");
    editor.className = "text-assets-editor";

    const currentRow = this.getSelectedSnippet();
    const currentEntry: TextExpansionEntry = currentRow
      ? [currentRow.shortcut, currentRow.text]
      : ["", ""];

    const shortcut = document.createElement("input");
    shortcut.className = "input";
    shortcut.placeholder = i18n.get("text_expander_shortcut_placeholder");
    shortcut.value = currentEntry[0];
    shortcut.addEventListener("input", () => {
      shortcut.setCustomValidity("");
      this.snippetDeleteArmed = false;
      if (currentRow) {
        currentRow.shortcut = shortcut.value;
      }
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
      if (currentRow) {
        currentRow.text = body.value;
      }
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
        if (currentRow) {
          currentRow.text = body.value;
        }
        this.updateSnippetPreview(preview, body.value);
      });
      variables.appendChild(chip);
    });

    const preview = document.createElement("div");
    preview.className = "snippet-preview";
    this.updateSnippetPreview(preview, body.value);
    this.activeSnippetBody = body;
    this.activeSnippetPreview = preview;
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
        const targetRow =
          this.getSelectedSnippet() || this.createDetachedSnippetDraft(shortcut.value, body.value);
        const nextEntry: TextExpansionEntry = [shortcut.value.trim(), body.value];
        if (!nextEntry[0]) {
          return;
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
      this.createButton(
        i18n.get("site_profiles_cancel_btn"),
        () => {
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
        "is-danger",
      ),
    );

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
        const words = toTextValue(reader.result)
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
    dateInput.value = toTextValue(this.registry[KEY_DATE_FORMAT].get());
    dateInput.placeholder = i18n.get("custom_date_format_label");
    dateInput.addEventListener("input", () => {
      this.liveDateFormat = dateInput.value;
      this.refreshActiveSnippetPreview();
    });
    dateInput.addEventListener("change", () => {
      this.liveDateFormat = dateInput.value;
      this.registry[KEY_DATE_FORMAT].set(dateInput.value);
    });

    const timeInput = document.createElement("input");
    timeInput.className = "input";
    timeInput.value = toTextValue(this.registry[KEY_TIME_FORMAT].get());
    timeInput.placeholder = i18n.get("custom_time_format_label");
    timeInput.addEventListener("input", () => {
      this.liveTimeFormat = timeInput.value;
      this.refreshActiveSnippetPreview();
    });
    timeInput.addEventListener("change", () => {
      this.liveTimeFormat = timeInput.value;
      this.registry[KEY_TIME_FORMAT].set(timeInput.value);
    });

    const docs = document.createElement("div");
    docs.className = "settings-inline-card";

    const docsIntro = document.createElement("p");
    docsIntro.className = "settings-inline-help";
    docsIntro.textContent = i18n.get("text_assets_advanced_variables_docs");
    docs.appendChild(docsIntro);

    const variableGroups = document.createElement("ul");
    variableGroups.className = "settings-inline-help";
    [
      i18n.get("text_assets_variable_group_datetime"),
      i18n.get("text_assets_variable_group_utility"),
      i18n.get("text_assets_variable_group_page"),
    ].forEach((groupText) => {
      const item = document.createElement("li");
      item.textContent = groupText;
      variableGroups.appendChild(item);
    });
    docs.appendChild(variableGroups);

    const formatHelp = document.createElement("p");
    formatHelp.className = "settings-inline-help";
    formatHelp.textContent = i18n.get("text_assets_luxon_intro");
    docs.appendChild(formatHelp);

    const docsLink = document.createElement("a");
    docsLink.href = "https://moment.github.io/luxon/#/formatting?id=table-of-tokens";
    docsLink.target = "_blank";
    docsLink.rel = "noreferrer";
    docsLink.textContent = i18n.get("text_assets_luxon_link_label");
    docs.appendChild(docsLink);

    const exampleList = document.createElement("ul");
    exampleList.className = "settings-inline-help";
    [
      i18n.get("text_assets_luxon_example_date_short"),
      i18n.get("text_assets_luxon_example_date_long"),
      i18n.get("text_assets_luxon_example_time_short"),
      i18n.get("text_assets_luxon_example_time_long"),
    ].forEach((example) => {
      const item = document.createElement("li");
      item.textContent = example;
      exampleList.appendChild(item);
    });
    docs.appendChild(exampleList);

    shell.append(
      createStackField(i18n.get("custom_date_format_label"), dateInput),
      createStackField(i18n.get("custom_time_format_label"), timeInput),
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

  private persistSnippetRows(): void {
    this.registry[KEY_TEXT_EXPANSIONS].set(this.getPersistedExpansions());
  }

  private persistDictionary(): void {
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
    if (!this.selectedSnippetId) {
      return null;
    }
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
      id: id ?? this.nextSnippetRowId(),
      shortcut,
      text,
      savedShortcut: shortcut,
      savedText: text,
      persisted,
    };
  }

  private createDetachedSnippetDraft(shortcut: string, text: string): SnippetRow {
    const row = this.createSnippetRow({ shortcut, text, persisted: false });
    this.snippetRows = [row, ...this.snippetRows];
    this.selectedSnippetId = row.id;
    return row;
  }

  private nextSnippetRowId(): string {
    this.snippetRowSeq += 1;
    return `snippet-row-${this.snippetRowSeq}`;
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

  private reconcileSnippetRows(expansions: TextExpansionEntry[]): void {
    this.syncPersistedRows(expansions);
  }

  private updateSnippetPreview(target: HTMLElement, rawValue: string): void {
    const dateFormat = this.liveDateFormat;
    const timeFormat = this.liveTimeFormat;
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
