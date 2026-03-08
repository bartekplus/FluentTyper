import type { RuleToggleCardsConfig } from "../types.js";
import type { Store } from "@core/application/storage/Store.js";
import { BaseControl } from "./FieldControl.js";

interface NormalizedRule {
  value: string;
  text: string;
  description?: string;
  example?: string;
  badge?: string;
  safetyTier: "safe" | "advanced";
  languageScope: "all" | "en_US";
}

interface RuleControl {
  value: string;
  input: HTMLInputElement;
  card: HTMLLabelElement;
  rule: NormalizedRule;
  sectionType: "safe" | "advanced";
}

interface FilterButton {
  key: string;
  button: HTMLButtonElement;
}

interface ActionButton {
  values: string[];
  button: HTMLButtonElement;
}

interface SectionBundle {
  section: HTMLElement;
  list: HTMLElement;
  details?: HTMLDetailsElement;
}

function normalizeRule(option: unknown): NormalizedRule {
  if (Array.isArray(option)) {
    const [v, t] = option as [unknown, unknown];
    return {
      value: String(v ?? ""),
      text: t !== undefined ? String(t) : String(v ?? ""),
      safetyTier: "safe",
      languageScope: "all",
    };
  }
  if (option && typeof option === "object") {
    const o = option as Record<string, unknown>;
    const value = o["value"] !== undefined ? String(o["value"]) : "";
    return {
      value,
      text: o["text"] !== undefined ? String(o["text"]) : value,
      description: o["description"] !== undefined ? String(o["description"]) : undefined,
      example: o["example"] !== undefined ? String(o["example"]) : undefined,
      badge: o["badge"] !== undefined ? String(o["badge"]) : undefined,
      safetyTier: o["safetyTier"] === "advanced" ? "advanced" : "safe",
      languageScope: o["languageScope"] === "en_US" ? "en_US" : "all",
    };
  }
  const sv = String(option ?? "");
  return { value: sv, text: sv, safetyTier: "safe", languageScope: "all" };
}

export class RuleToggleCardsControl extends BaseControl<string[]> {
  private readonly ruleControls: RuleControl[] = [];
  private readonly filterButtons: FilterButton[] = [];
  private readonly actionButtons: ActionButton[] = [];
  private readonly safeSection: SectionBundle;
  private readonly advancedSection: SectionBundle;
  private readonly summary: HTMLElement;
  private readonly noResults: HTMLElement;
  private readonly searchInput: HTMLInputElement;
  private activeFilter = "all";
  private searchQuery = "";
  private rovingIndex = 0;
  private readonly summaryLabel: string;
  private readonly emptyStateText: string;

  constructor(params: RuleToggleCardsConfig, store: Store) {
    super(params, store);
    this.summaryLabel = params.summaryLabel ?? "Active rules";
    this.emptyStateText = params.emptyStateText ?? "No grammar rules enabled.";

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
    searchInput.placeholder = params.searchPlaceholder ?? "Search grammar rules...";
    searchInput.setAttribute("aria-label", "Search grammar rules");
    this.searchInput = searchInput;

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
      { key: "all", label: params.filterAllLabel ?? "All" },
      { key: "safe", label: params.filterSafeLabel ?? "Safe" },
      { key: "advanced", label: params.filterAdvancedLabel ?? "Advanced" },
      { key: "english", label: params.filterEnglishOnlyLabel ?? "English only" },
      { key: "enabled", label: params.filterEnabledOnlyLabel ?? "Enabled only" },
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

    if (Array.isArray(params.actions) && params.actions.length > 0) {
      const actionsEl = document.createElement("div");
      actionsEl.className = "buttons has-addons grammar-rule-selector-actions";

      for (const action of params.actions) {
        if (!action || !Array.isArray(action.values) || !action.text) {
          continue;
        }

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "button is-small is-light";
        btn.textContent = String(action.text);
        if (action.actionKey?.trim()) {
          btn.dataset["action"] = action.actionKey.trim();
        }

        const values = action.values.map(String);
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          this.set(values);
        });
        actionsEl.appendChild(btn);
        this.actionButtons.push({ values, button: btn });
      }

      toolbar.appendChild(actionsEl);
    }

    container.appendChild(toolbar);

    // --- No-results indicator ---
    const noResults = document.createElement("p");
    noResults.className = "grammar-rule-selector-no-results is-hidden";
    noResults.textContent = params.noMatchesText ?? "No grammar rules match your search.";
    this.noResults = noResults;
    container.appendChild(noResults);

    // --- Rule sections ---
    const ruleList = document.createElement("div");
    ruleList.className = "grammar-rule-sections";

    this.safeSection = this.createSection(params.sectionSafeLabel ?? "Safe rules", "safe");
    this.advancedSection = this.createSection(
      params.sectionAdvancedLabel ?? "Advanced (optional)",
      "advanced",
    );
    ruleList.appendChild(this.safeSection.section);
    ruleList.appendChild(this.advancedSection.section);
    container.appendChild(ruleList);
    root.appendChild(container);

    // --- Build rule cards ---
    let rawOptions: unknown[] = [];
    if (Array.isArray(params.options)) {
      rawOptions = params.options;
    } else if (params.options && Array.isArray((params.options as { values?: unknown[] }).values)) {
      rawOptions = (params.options as { values: unknown[] }).values;
    }

    const rules = rawOptions.map(normalizeRule).filter((r) => r.value.length > 0);

    for (const rule of rules) {
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

    void this.loadFromStorage();
  }

  private createSection(title: string, sectionType: "safe" | "advanced"): SectionBundle {
    if (sectionType === "advanced") {
      const details = document.createElement("details");
      details.className = `grammar-rule-section grammar-rule-section-${sectionType}`;

      const summary = document.createElement("summary");
      summary.className = "grammar-rule-section-title";
      summary.innerText = title;
      details.appendChild(summary);

      const list = document.createElement("div");
      list.className = "grammar-rule-selector-list";
      list.setAttribute("role", "group");
      list.setAttribute("aria-label", title);
      details.appendChild(list);

      return { section: details, list, details };
    }

    const section = document.createElement("section");
    section.className = `grammar-rule-section grammar-rule-section-${sectionType}`;

    const heading = document.createElement("h4");
    heading.className = "grammar-rule-section-title";
    heading.innerText = title;
    section.appendChild(heading);

    const list = document.createElement("div");
    list.className = "grammar-rule-selector-list";
    list.setAttribute("role", "group");
    list.setAttribute("aria-label", title);
    section.appendChild(list);

    return { section, list };
  }

  private createCard(rule: NormalizedRule, container: HTMLElement): RuleControl {
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
      this.persistToStorage(value);
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

    return { value: rule.value, input, card, rule, sectionType: rule.safetyTier };
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
    if (nextIndex === -1 && document.activeElement instanceof HTMLElement) {
      nextIndex = visible.findIndex((ctrl) => ctrl.card === document.activeElement);
    }
    if (nextIndex === -1) {
      nextIndex = Math.min(this.rovingIndex, visible.length - 1);
    }
    if (nextIndex < 0) {
      nextIndex = 0;
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
    let next = currentIdx + direction;
    if (currentIdx === -1) {
      next = direction === 1 ? 0 : visible.length - 1;
    }
    if (next < 0) {
      next = visible.length - 1;
    }
    if (next >= visible.length) {
      next = 0;
    }
    this.syncRovingTabIndex(visible[next].card);
    visible[next].card.focus();
  }

  private updateFilterButtons(): void {
    for (const { key, button } of this.filterButtons) {
      button.classList.toggle("is-selected", key === this.activeFilter);
      button.setAttribute("aria-pressed", String(key === this.activeFilter));
    }
  }

  private matchesSearch(rule: NormalizedRule): boolean {
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

  override destroy(): void {
    super.destroy();
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
      this.persistToStorage(value);
      this.emitter.fireEvent("action", value);
    }
    return this;
  }
}
