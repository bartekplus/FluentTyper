import type { RuleOption, RuleToggleCardsConfig, RuleToggleStorageAdapter } from "../types.js";
import type { Store } from "@core/application/storage/Store.js";
import { BaseControl } from "./FieldControl.js";

interface RuleControl {
  value: string;
  input: HTMLInputElement;
  card: HTMLLabelElement;
  rule: RuleOption;
}

interface FilterButton {
  key: string;
  button: HTMLButtonElement;
}

interface SectionBundle {
  section: HTMLElement;
  list: HTMLElement;
  details?: HTMLDetailsElement;
}

export class RuleToggleCardsControl extends BaseControl<string[]> {
  private readonly ruleControls: RuleControl[] = [];
  private readonly filterButtons: FilterButton[] = [];
  private readonly safeSection: SectionBundle;
  private readonly advancedSection: SectionBundle;
  private readonly summary: HTMLElement;
  private readonly noResults: HTMLElement;
  private activeFilter = "all";
  private searchQuery = "";
  private rovingIndex = 0;
  private readonly summaryLabel: string;
  private readonly emptyStateText: string;
  private readonly storageAdapter: RuleToggleStorageAdapter;
  private storedValue: unknown;

  constructor(params: RuleToggleCardsConfig, store: Store) {
    super(params, store);
    this.summaryLabel = params.summaryLabel;
    this.emptyStateText = params.emptyStateText;
    this.storageAdapter = params.storageAdapter;

    const root = document.createElement("div");
    root.className = "field grammar-rule-selector-field";
    this._rootElement = root;

    const container = document.createElement("div");
    container.className = "control grammar-rule-selector";
    this._element = container;

    if (params.label) {
      const label = document.createElement("label");
      label.className = "label";
      label.innerHTML = params.label;
      root.appendChild(label);
    }

    if (params.helpText) {
      const help = document.createElement("p");
      help.className = "grammar-rule-selector-help";
      help.innerText = params.helpText;
      root.appendChild(help);
    }

    // --- Search row ---
    const searchRow = document.createElement("div");
    searchRow.className = "grammar-rule-selector-search-row";

    const searchField = document.createElement("div");
    searchField.className = "grammar-rule-selector-search";

    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.className = "input is-small grammar-rule-search-input";
    searchInput.placeholder = params.searchPlaceholder;
    searchInput.setAttribute("aria-label", "Search grammar rules");

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "grammar-rule-search-clear";
    clearBtn.textContent = "×";
    clearBtn.setAttribute("aria-label", "Clear search");
    clearBtn.style.display = "none";

    searchField.appendChild(searchInput);
    searchField.appendChild(clearBtn);

    // Filter buttons
    const filtersEl = document.createElement("div");
    filtersEl.className = "buttons has-addons grammar-rule-selector-filters";

    const filterDefs = [
      { key: "all", label: params.filterAllLabel },
      { key: "safe", label: params.filterSafeLabel },
      { key: "advanced", label: params.filterAdvancedLabel },
      { key: "english", label: params.filterEnglishOnlyLabel },
      { key: "enabled", label: params.filterEnabledOnlyLabel },
    ];

    for (const { key, label } of filterDefs) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "button is-small is-light grammar-rule-filter-button";
      btn.textContent = label;
      btn.dataset["filter"] = key;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        this.activeFilter = key;
        this.updateFilterButtons();
        this.updateStateUI();
      });
      filtersEl.appendChild(btn);
      this.filterButtons.push({ key, button: btn });
    }

    searchRow.appendChild(searchField);
    searchRow.appendChild(filtersEl);
    container.appendChild(searchRow);

    // --- Toolbar (summary + actions) ---
    const toolbar = document.createElement("div");
    toolbar.className = "grammar-rule-selector-toolbar";

    const summary = document.createElement("p");
    summary.className = "grammar-rule-selector-summary";
    this.summary = summary;
    toolbar.appendChild(summary);

    if (params.actions.length > 0) {
      const actionsEl = document.createElement("div");
      actionsEl.className = "buttons has-addons grammar-rule-selector-actions";

      for (const action of params.actions) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "button is-small is-light";
        btn.textContent = action.text;
        if (action.actionKey?.trim()) {
          btn.dataset["action"] = action.actionKey.trim();
        }

        btn.addEventListener("click", (e) => {
          e.preventDefault();
          this.set(action.values);
        });
        actionsEl.appendChild(btn);
      }

      toolbar.appendChild(actionsEl);
    }

    container.appendChild(toolbar);

    // --- No-results indicator ---
    const noResults = document.createElement("p");
    noResults.className = "grammar-rule-selector-no-results is-hidden";
    noResults.textContent = params.noMatchesText;
    this.noResults = noResults;
    container.appendChild(noResults);

    // --- Rule sections ---
    const ruleList = document.createElement("div");
    ruleList.className = "grammar-rule-sections";

    this.safeSection = this.createSection(params.sectionSafeLabel, "safe");
    this.advancedSection = this.createSection(params.sectionAdvancedLabel, "advanced");
    ruleList.appendChild(this.safeSection.section);
    ruleList.appendChild(this.advancedSection.section);
    container.appendChild(ruleList);
    root.appendChild(container);

    // --- Build rule cards ---
    for (const rule of params.options) {
      const section = rule.safetyTier === "advanced" ? this.advancedSection : this.safeSection;
      const ruleControl = this.createCard(rule, section.list);
      this.ruleControls.push(ruleControl);
    }

    // --- Events ---
    searchInput.addEventListener("input", () => {
      clearBtn.style.display = searchInput.value ? "" : "none";
      this.applySearchQuery(searchInput.value);
    });

    clearBtn.addEventListener("click", () => {
      searchInput.value = "";
      clearBtn.style.display = "none";
      this.applySearchQuery("");
      searchInput.focus();
    });

    this.updateFilterButtons();
    this.updateStateUI();

    void this.loadSelectionFromStorage();
  }

  private createSection(title: string, sectionType: "safe" | "advanced"): SectionBundle {
    // Advanced rules live in a collapsible <details>; safe rules are always visible.
    const isAdvanced = sectionType === "advanced";
    const section = document.createElement(isAdvanced ? "details" : "section");
    section.className = `grammar-rule-section grammar-rule-section-${sectionType}`;

    const heading = document.createElement(isAdvanced ? "summary" : "h4");
    heading.className = "grammar-rule-section-title";
    heading.innerText = title;
    section.appendChild(heading);

    const list = document.createElement("div");
    list.className = "grammar-rule-selector-list";
    list.setAttribute("role", "group");
    list.setAttribute("aria-label", title);
    section.appendChild(list);

    return isAdvanced
      ? { section, list, details: section as HTMLDetailsElement }
      : { section, list };
  }

  private createCard(rule: RuleOption, container: HTMLElement): RuleControl {
    const card = document.createElement("label");
    card.className = "grammar-rule-card";
    card.setAttribute("role", "checkbox");
    card.setAttribute("aria-label", rule.text);
    card.setAttribute("aria-checked", "false");

    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = rule.value;
    input.className = "grammar-rule-card-toggle";
    input.tabIndex = -1;
    input.setAttribute("tabindex", "-1");
    input.setAttribute("role", "checkbox");
    input.setAttribute("aria-label", rule.text);
    input.setAttribute("aria-checked", "false");

    const body = document.createElement("div");
    body.className = "grammar-rule-card-body";

    const titleRow = document.createElement("div");
    titleRow.className = "grammar-rule-card-title-row";

    const titleEl = document.createElement("span");
    titleEl.className = "grammar-rule-card-title";
    titleEl.innerText = rule.text;
    titleRow.appendChild(titleEl);

    if (rule.badge) {
      const badge = document.createElement("span");
      badge.className = "grammar-rule-card-badge";
      badge.innerText = rule.badge;
      titleRow.appendChild(badge);
    }

    body.appendChild(titleRow);

    if (rule.description) {
      const desc = document.createElement("p");
      desc.className = "grammar-rule-card-description";
      desc.innerText = rule.description;
      body.appendChild(desc);
    }

    if (rule.example) {
      const ex = document.createElement("p");
      ex.className = "grammar-rule-card-example";
      ex.innerText = rule.example;
      body.appendChild(ex);
    }

    card.appendChild(input);
    card.appendChild(body);
    container.appendChild(card);

    input.addEventListener("change", () => {
      this.updateStateUI();
      const value = this.get();
      this.persistValue(this.storageAdapter.setChoice(this.storedValue, rule.value, input.checked));
      this.emitter.fireEvent("action", value);
    });

    this.setTabIndex(card, -1);
    card.addEventListener("focus", () => {
      this.syncRovingTabIndex(card);
    });
    card.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === " ") {
        e.preventDefault();
        input.checked = !input.checked;
        input.dispatchEvent(new Event("change"));
      }
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        this.moveRovingFocus(1);
      }
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        this.moveRovingFocus(-1);
      }
    });

    return { value: rule.value, input, card, rule };
  }

  private getVisibleRuleControls(): RuleControl[] {
    return this.ruleControls
      .filter((rc) => !rc.card.classList.contains("is-hidden"))
      .sort((left, right) => {
        if (left.card === right.card) {
          return 0;
        }
        return left.card.compareDocumentPosition(right.card) & Node.DOCUMENT_POSITION_FOLLOWING
          ? -1
          : 1;
      });
  }

  private applySearchQuery(query: string): void {
    this.searchQuery = query.trim().toLowerCase();
    this.updateStateUI();
  }

  private setTabIndex(element: HTMLElement, value: number): void {
    element.tabIndex = value;
    element.setAttribute("tabindex", String(value));
  }

  private syncRovingTabIndex(preferredCard?: HTMLLabelElement): void {
    const visible = this.getVisibleRuleControls();
    if (visible.length === 0) {
      this.rovingIndex = 0;
      for (const ctrl of this.ruleControls) {
        this.setTabIndex(ctrl.card, -1);
      }
      return;
    }

    let nextIndex = -1;
    if (preferredCard) {
      nextIndex = visible.findIndex((ctrl) => ctrl.card === preferredCard);
    }
    if (nextIndex === -1) {
      nextIndex = visible.findIndex((ctrl) => ctrl.card === document.activeElement);
    }
    if (nextIndex === -1) {
      nextIndex = Math.min(this.rovingIndex, visible.length - 1);
    }

    this.rovingIndex = nextIndex;
    const activeCard = visible[nextIndex]?.card;
    for (const ctrl of this.ruleControls) {
      this.setTabIndex(ctrl.card, ctrl.card === activeCard ? 0 : -1);
    }
  }

  private moveRovingFocus(direction: 1 | -1): void {
    const visible = this.getVisibleRuleControls();
    if (visible.length === 0) {
      return;
    }

    const currentIdx = visible.findIndex(
      (rc) => rc.card === document.activeElement || rc.card.tabIndex === 0,
    );
    const next =
      currentIdx === -1
        ? direction === 1
          ? 0
          : visible.length - 1
        : (currentIdx + direction + visible.length) % visible.length;
    this.syncRovingTabIndex(visible[next].card);
    visible[next].card.focus();
  }

  private updateFilterButtons(): void {
    for (const { key, button } of this.filterButtons) {
      button.classList.toggle("is-selected", key === this.activeFilter);
      button.setAttribute("aria-pressed", String(key === this.activeFilter));
    }
  }

  private matchesSearch(rule: RuleOption): boolean {
    if (!this.searchQuery) {
      return true;
    }
    const haystack = [rule.text, rule.description, rule.example]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(this.searchQuery);
  }

  private matchesFilter(control: RuleControl, isChecked: boolean): boolean {
    switch (this.activeFilter) {
      case "safe":
        return control.rule.safetyTier === "safe";
      case "advanced":
        return control.rule.safetyTier === "advanced";
      case "english":
        return control.rule.languageScope === "en_US";
      case "enabled":
        return isChecked;
      default:
        return true;
    }
  }

  private updateStateUI(): void {
    let activeCount = 0;
    let visibleCount = 0;
    let safeVisible = 0;
    let advancedVisible = 0;

    for (const ctrl of this.ruleControls) {
      const isChecked = ctrl.input.checked;
      ctrl.input.setAttribute("aria-checked", String(isChecked));
      ctrl.card.setAttribute("aria-checked", String(isChecked));
      ctrl.card.classList.toggle("is-active", isChecked);
      if (isChecked) {
        activeCount++;
      }

      const visible = this.matchesSearch(ctrl.rule) && this.matchesFilter(ctrl, isChecked);
      ctrl.card.classList.toggle("is-hidden", !visible);
      ctrl.card.setAttribute("aria-hidden", String(!visible));
      if (visible) {
        visibleCount++;
        if (ctrl.rule.safetyTier === "advanced") {
          advancedVisible++;
        } else {
          safeVisible++;
        }
      }
    }

    this.safeSection.section.classList.toggle("is-hidden", safeVisible === 0);
    this.advancedSection.section.classList.toggle("is-hidden", advancedVisible === 0);
    if (this.advancedSection.details) {
      this.advancedSection.details.open =
        advancedVisible > 0 &&
        (this.searchQuery.length > 0 ||
          this.activeFilter === "advanced" ||
          this.activeFilter === "enabled" ||
          this.ruleControls.some(
            (ctrl) => ctrl.rule.safetyTier === "advanced" && ctrl.input.checked,
          ));
    }
    this.noResults.classList.toggle("is-hidden", visibleCount > 0);
    this.syncRovingTabIndex();

    if (activeCount === 0) {
      this.summary.innerText = this.emptyStateText;
      this.summary.classList.add("is-empty");
    } else {
      this.summary.innerText = `${this.summaryLabel}: ${activeCount}/${this.ruleControls.length}`;
      this.summary.classList.remove("is-empty");
    }
  }

  get(): string[] {
    return this.ruleControls.filter((rc) => rc.input.checked).map((rc) => rc.value);
  }

  set(values: string[], silent?: boolean): this {
    const selected = new Set(Array.isArray(values) ? values.map(String) : []);
    for (const rc of this.ruleControls) {
      rc.input.checked = selected.has(rc.value);
    }
    this.updateStateUI();
    if (!silent) {
      const value = this.get();
      this.persistValue(this.storageAdapter.setSelection(value));
      this.emitter.fireEvent("action", value);
    }
    return this;
  }

  private async loadSelectionFromStorage(): Promise<void> {
    if (this.name === undefined) return;
    try {
      this.storedValue = await this.storage.get(this.name);
      this.set(this.storageAdapter.getSelection(this.storedValue), true);
    } catch (error) {
      console.error(error);
    }
  }

  private persistValue(value: unknown): void {
    this.storedValue = value;
    this.persistToStorage(value);
  }
}
