import type { SettingsRegistry } from "@ui/settings-engine/SettingsEngine.js";
import { KEY_ENABLED_GRAMMAR_RULES, KEY_REVIEW_RULE_OVERRIDES } from "@core/domain/constants";
import { GRAMMAR_RULE_CATALOG, TYPING_RULE_IDS } from "@core/domain/grammar/ruleCatalog";
import {
  REVIEW_RULE_METADATA,
  isReviewSupportedRule,
  normalizeReviewRuleOverrides,
  reviewLanguageScope,
  reviewRuleIds,
} from "@core/domain/grammar/review/reviewCatalog";
import { reviewExplanation } from "@core/domain/grammar/review/reviewExplanations";
import { reviewText } from "@core/domain/grammar/review/reviewMessages";
import { REVIEW_CATEGORIES, type ReviewMessageKey } from "@core/domain/grammar/review/types";
import {
  grammarRuleSelectionToOverrides,
  isGrammarRuleOverrides,
  migrateLegacyGrammarRuleSelection,
  resolveGrammarRuleSelection,
} from "@core/domain/grammar/GrammarRuleSettings";
import { i18n } from "./fluenttyperI18n.js";
import { bindControlEvents, createWorkspaceCard } from "./workspacePanelUtils.js";

interface Column {
  key: string;
  label: string;
  ruleIds: ReadonlySet<string>;
  enabled(value: unknown): ReadonlySet<string>;
  toggle(value: unknown, rule: string, on: boolean): unknown;
}

const TYPING_IDS: ReadonlySet<string> = new Set(TYPING_RULE_IDS);

const COLUMNS: Column[] = [
  {
    key: KEY_ENABLED_GRAMMAR_RULES,
    label: i18n.get("grammar_matrix_typing"),
    ruleIds: TYPING_IDS,
    enabled: (value) => new Set(resolveGrammarRuleSelection(value)),
    toggle(value, rule, on) {
      const overrides = isGrammarRuleOverrides(value)
        ? value
        : (migrateLegacyGrammarRuleSelection(value) ??
          (value === undefined ? {} : grammarRuleSelectionToOverrides([])));
      return { ...overrides, [rule]: on };
    },
  },
  {
    key: KEY_REVIEW_RULE_OVERRIDES,
    label: i18n.get("grammar_matrix_review"),
    ruleIds: new Set(GRAMMAR_RULE_CATALOG.map((rule) => rule.id).filter(isReviewSupportedRule)),
    enabled: (value) => new Set(reviewRuleIds({ codeMode: false, overrides: value })),
    toggle: (value, rule, on) => ({ ...normalizeReviewRuleOverrides(value), [rule]: on }),
  },
];

const RULES = GRAMMAR_RULE_CATALOG.filter((rule) =>
  COLUMNS.some((column) => column.ruleIds.has(rule.id)),
).map((rule) => {
  const typing = TYPING_IDS.has(rule.id);
  return {
    id: rule.id,
    title: typing
      ? i18n.get(rule.titleI18nKey)
      : reviewExplanation(rule.titleI18nKey as ReviewMessageKey, i18n.lang),
    description: typing ? i18n.get(rule.descriptionI18nKey) : "",
    example: typing && rule.exampleI18nKey ? i18n.get(rule.exampleI18nKey) : "",
    section: REVIEW_RULE_METADATA[rule.id].category,
    englishOnly:
      (isReviewSupportedRule(rule.id) ? reviewLanguageScope(rule.id) : rule.languageScope) ===
      "en_US",
  };
});

let uid = 0;

/** One list of every correction rule, with a switch per place it can run. */
export function mountGrammarRuleMatrix(root: HTMLElement, registry: SettingsRegistry): void {
  const controls = COLUMNS.map((column) => registry[column.key]);
  if (controls.some((control) => !control)) return;

  const { card, body } = createWorkspaceCard(
    i18n.get("grammar_matrix_title"),
    i18n.get("grammar_matrix_help"),
  );
  card.classList.add("rule-matrix");

  const toolbar = document.createElement("div");
  toolbar.className = "rule-matrix-toolbar";
  const search = document.createElement("input");
  search.type = "search";
  search.className = "input";
  search.placeholder = i18n.get("grammar_rules_search_placeholder");
  search.setAttribute("aria-label", i18n.get("grammar_rules_search_placeholder"));
  const restore = document.createElement("button");
  restore.type = "button";
  restore.className = "button";
  restore.dataset.action = "restore-defaults";
  restore.textContent = i18n.get("grammar_matrix_restore");
  restore.addEventListener("click", () => controls.forEach((control) => control.set({})));
  toolbar.append(search, restore);

  const head = document.createElement("div");
  head.className = "rule-matrix-row rule-matrix-head";
  head.append(document.createElement("span"));
  const counts = COLUMNS.map((column) => {
    const cell = document.createElement("span");
    cell.className = "rule-matrix-cell";
    const label = document.createElement("span");
    label.textContent = column.label;
    const count = document.createElement("small");
    cell.append(label, count);
    head.append(cell);
    return count;
  });

  const noMatches = document.createElement("p");
  noMatches.className = "settings-inline-help is-hidden";
  noMatches.textContent = i18n.get("grammar_rules_no_matches");

  const switches: Array<{ column: number; rule: string; input: HTMLInputElement }> = [];
  const rows: Array<{ row: HTMLElement; text: string; section: HTMLDetailsElement }> = [];
  const sections = REVIEW_CATEGORIES.flatMap((category) => {
    const rules = RULES.filter((rule) => rule.section === category);
    if (rules.length === 0) return [];
    const section = document.createElement("details");
    section.className = "rule-matrix-section";
    section.dataset.section = category;
    const summary = document.createElement("summary");
    summary.className = "rule-matrix-row";
    const name = document.createElement("span");
    name.textContent = reviewText(`review_cat_${category}`, i18n.lang);
    summary.append(name);
    const sectionCounts = COLUMNS.map(() => {
      const cell = document.createElement("small");
      cell.className = "rule-matrix-cell";
      summary.append(cell);
      return cell;
    });
    section.append(summary);

    for (const rule of rules) {
      const row = document.createElement("div");
      row.className = "rule-matrix-row";
      row.dataset.rule = rule.id;
      const copy = document.createElement("div");
      copy.className = "rule-matrix-copy";
      const title = document.createElement("span");
      title.className = "rule-matrix-title";
      title.textContent = rule.title;
      copy.append(title);
      if (rule.englishOnly) {
        const tag = document.createElement("span");
        tag.className = "rule-matrix-tag";
        tag.textContent = i18n.get("grammar_rule_scope_en_us_badge");
        copy.append(tag);
      }
      for (const [text, className] of [
        [rule.description, "rule-matrix-description"],
        [rule.example, "rule-matrix-example"],
      ]) {
        if (!text) continue;
        const line = document.createElement("p");
        line.className = className;
        line.textContent = text;
        copy.append(line);
      }
      row.append(copy);

      COLUMNS.forEach((column, index) => {
        const cell = document.createElement("span");
        cell.className = "rule-matrix-cell";
        if (!column.ruleIds.has(rule.id)) {
          cell.classList.add("is-unavailable");
          cell.title = i18n.get("grammar_matrix_unavailable");
          cell.setAttribute(
            "aria-label",
            `${column.label}: ${i18n.get("grammar_matrix_unavailable")}`,
          );
          row.append(cell);
          return;
        }
        const input = document.createElement("input");
        input.type = "checkbox";
        input.className = "switch is-rounded is-small";
        input.id = `rule-matrix-${uid++}`;
        input.value = rule.id;
        input.dataset.setting = column.key;
        input.setAttribute("role", "switch");
        input.setAttribute("aria-label", `${column.label}: ${rule.title}`);
        input.addEventListener("change", () => {
          const control = controls[index];
          control.set(column.toggle(control.get(), rule.id, input.checked));
        });
        const label = document.createElement("label");
        label.htmlFor = input.id;
        cell.append(input, label);
        row.append(cell);
        switches.push({ column: index, rule: rule.id, input });
      });

      section.append(row);
      rows.push({
        row,
        text: [rule.title, rule.description, rule.example].join(" ").toLowerCase(),
        section,
      });
    }

    return [{ section, rules, sectionCounts }];
  });

  const render = () => {
    const enabled = COLUMNS.map((column, index) => column.enabled(controls[index].get()));
    for (const { column, rule, input } of switches) input.checked = enabled[column].has(rule);
    COLUMNS.forEach((column, index) => {
      const on = [...column.ruleIds].filter((id) => enabled[index].has(id)).length;
      counts[index].textContent = `${on}/${column.ruleIds.size}`;
      for (const { rules, sectionCounts } of sections) {
        const available = rules.filter((rule) => column.ruleIds.has(rule.id));
        sectionCounts[index].textContent = available.length
          ? `${available.filter((rule) => enabled[index].has(rule.id)).length}/${available.length}`
          : "";
      }
    });
  };

  search.addEventListener("input", () => {
    const query = search.value.trim().toLowerCase();
    const visible = new Set<HTMLDetailsElement>();
    for (const { row, text, section } of rows) {
      const match = !query || text.includes(query);
      row.classList.toggle("is-hidden", !match);
      if (match) visible.add(section);
    }
    for (const { section } of sections) {
      section.classList.toggle("is-hidden", !visible.has(section));
      if (query) section.open = visible.has(section);
    }
    noMatches.classList.toggle("is-hidden", visible.size > 0);
  });

  body.append(toolbar, head, ...sections.map(({ section }) => section), noMatches);
  root.append(card);
  controls.forEach((control) => bindControlEvents(control, [["change", render]]));
  render();
}
