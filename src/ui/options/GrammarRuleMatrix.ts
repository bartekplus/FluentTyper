import type { SettingsRegistry } from "@ui/settings-engine/SettingsEngine.js";
import { KEY_ENABLED_GRAMMAR_RULES, KEY_REVIEW_RULE_OVERRIDES } from "@core/domain/constants";
import { GRAMMAR_RULE_CATALOG, TYPING_RULE_IDS } from "@core/domain/grammar/ruleCatalog";
import {
  REVIEW_RULE_METADATA,
  REVIEW_SUPPORTED_RULE_IDS,
  normalizeReviewRuleOverrides,
  reviewRuleIds,
  ruleOnlyLanguage,
} from "@core/domain/grammar/review/reviewCatalog";
import { reviewText } from "@core/domain/grammar/review/reviewMessages";
import { REVIEW_CATEGORIES } from "@core/domain/grammar/review/types";
import {
  grammarRuleSelectionToOverrides,
  isGrammarRuleOverrides,
  migrateLegacyGrammarRuleSelection,
  resolveGrammarRuleSelection,
} from "@core/domain/grammar/GrammarRuleSettings";
import { htmlLang, i18n } from "./fluenttyperI18n.js";
import { GRAMMAR_RULE_EXAMPLES, type RuleExample } from "./grammarRuleCopy.js";
import { createInputElement, getUniqueID } from "@ui/settings-engine/controls/FieldControl.js";
import { createElement } from "@ui/settings-engine/dom/createElement.js";
import { createButton, createSearchInput, createWorkspaceCard } from "./workspacePanelUtils.js";

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
    ruleIds: new Set(REVIEW_SUPPORTED_RULE_IDS),
    enabled: (value) => new Set(reviewRuleIds({ codeMode: false, overrides: value })),
    toggle: (value, rule, on) => ({ ...normalizeReviewRuleOverrides(value), [rule]: on }),
  },
];

const languageNames = new Intl.DisplayNames([htmlLang(i18n.lang)], { type: "language" });

const RULES = GRAMMAR_RULE_CATALOG.filter((rule) =>
  COLUMNS.some((column) => column.ruleIds.has(rule.id)),
).map((rule) => {
  const only = ruleOnlyLanguage(rule.id);
  const language = only && (languageNames.of(only.slice(0, 2)) ?? only);
  return {
    id: rule.id,
    title: i18n.get(rule.titleI18nKey),
    description: i18n.get(rule.descriptionI18nKey),
    example: GRAMMAR_RULE_EXAMPLES[rule.id],
    section: REVIEW_RULE_METADATA[rule.id].category,
    language: language && language[0].toLocaleUpperCase() + language.slice(1),
  };
});

const WORD = /[\p{L}\p{M}\p{N}'’]/u;
const isWord = (char: string | undefined) => !!char && WORD.test(char);

/** Text as the example shows it: a line break as ↵, and a changed space as ␣. */
const shown = (text: string, changed = false) =>
  changed ? text.replaceAll(" ", "␣").replaceAll("\n", "↵") : text.replaceAll("\n", " ↵ ");

/** One side of an example, its changed part marked. bdi keeps right-to-left text in order. */
function exampleSide(text: string, start: number, end: number, className: string): HTMLElement {
  const side = document.createElement("bdi");
  side.append(
    shown(text.slice(0, start)),
    createElement("mark", { className, textContent: shown(text.slice(start, end), true) }),
    shown(text.slice(end).trimEnd()),
  );
  return side;
}

/** "before → after" with the changed words marked; a warning shows the text alone. */
function exampleLine({ text: [before, after], lang }: RuleExample): HTMLElement {
  const line = createElement("p", { className: "rule-matrix-example" });
  line.lang = htmlLang(lang.slice(0, 2));
  if (after === null) {
    line.append(createElement("bdi", { textContent: shown(before) }));
    return line;
  }
  let start = 0;
  while (start < before.length && before[start] === after[start]) start++;
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  )
    end++;
  // Mark whole words: "Their" → "There", not "ir" → "re".
  if (isWord(before[start]) || isWord(after[start]))
    while (start > 0 && isWord(before[start - 1])) start--;
  const tail = (text: string) => text[text.length - end];
  if (isWord(before[before.length - end - 1]) || isWord(after[after.length - end - 1]))
    while (end > 0 && isWord(tail(before))) end--;
  line.append(
    exampleSide(before, start, before.length - end, "is-before"),
    " → ",
    exampleSide(after, start, after.length - end, "is-after"),
  );
  return line;
}

/** One list of every correction rule, with a switch per place it can run. */
export function mountGrammarRuleMatrix(root: HTMLElement, registry: SettingsRegistry): void {
  const controls = COLUMNS.map((column) => registry[column.key]);
  if (controls.some((control) => !control)) return;

  const { card, body } = createWorkspaceCard(
    i18n.get("grammar_matrix_title"),
    i18n.get("grammar_matrix_help"),
  );
  card.classList.add("rule-matrix");

  const toolbar = createElement("div", { className: "rule-matrix-toolbar" });
  const search = createSearchInput(i18n.get("grammar_rules_search_placeholder"), "", (query) => {
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
  search.setAttribute("aria-label", i18n.get("grammar_rules_search_placeholder"));
  const restore = createButton(i18n.get("grammar_matrix_restore"), "button", () =>
    controls.forEach((control) => control.set({})),
  );
  restore.dataset.action = "restore-defaults";
  toolbar.append(search, restore);

  const head = createElement("div", { className: "rule-matrix-row rule-matrix-head" });
  head.append(document.createElement("span"));
  const counts = COLUMNS.map((column) => {
    const cell = createElement("span", { className: "rule-matrix-cell" });
    const count = document.createElement("small");
    cell.append(createElement("span", { textContent: column.label }), count);
    head.append(cell);
    return count;
  });

  const noMatches = createElement("p", {
    className: "settings-inline-help is-hidden",
    textContent: i18n.get("grammar_rules_no_matches"),
  });

  const switches: Array<{ column: number; rule: string; input: HTMLInputElement }> = [];
  const rows: Array<{ row: HTMLElement; text: string; section: HTMLDetailsElement }> = [];
  const sections = REVIEW_CATEGORIES.flatMap((category) => {
    const rules = RULES.filter((rule) => rule.section === category);
    if (rules.length === 0) return [];
    const section = createElement("details", { className: "rule-matrix-section" });
    const summary = createElement("summary", { className: "rule-matrix-row" });
    const name = createElement("span", {
      textContent: reviewText(`review_cat_${category}`, i18n.lang),
    });
    summary.append(name);
    const sectionCounts = COLUMNS.map(() => {
      const cell = createElement("small", { className: "rule-matrix-cell" });
      summary.append(cell);
      return cell;
    });
    section.append(summary);

    for (const rule of rules) {
      const row = createElement("div", { className: "rule-matrix-row" });
      row.dataset.rule = rule.id;
      const copy = createElement("div", { className: "rule-matrix-copy" });
      const heading = createElement("div", { className: "rule-matrix-heading" });
      heading.append(
        createElement("span", { className: "rule-matrix-title", textContent: rule.title }),
      );
      if (rule.language)
        heading.append(
          createElement("span", { className: "rule-matrix-tag", textContent: rule.language }),
        );
      // The description shows on hover and on keyboard focus; a click keeps it open
      // until focus leaves the button.
      const description = createElement("p", {
        className: "rule-matrix-description",
        id: `rule-matrix-${getUniqueID()}`,
        textContent: rule.description,
        attributes: { role: "tooltip" },
      });
      const info = createElement("button", {
        className: "rule-matrix-info",
        textContent: "i",
        attributes: {
          type: "button",
          "aria-label": `${i18n.get("grammar_matrix_details")}: ${rule.title}`,
          "aria-expanded": "false",
          "aria-describedby": description.id,
        },
      });
      info.addEventListener("click", () =>
        info.setAttribute("aria-expanded", String(info.getAttribute("aria-expanded") !== "true")),
      );
      info.addEventListener("keydown", (event) => {
        if (event.key === "Escape") info.setAttribute("aria-expanded", "false");
      });
      info.addEventListener("blur", () => info.setAttribute("aria-expanded", "false"));
      heading.append(info);
      copy.append(heading, exampleLine(rule.example), description);
      row.append(copy);

      COLUMNS.forEach((column, index) => {
        const cell = createElement("span", { className: "rule-matrix-cell" });
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
        const input = createInputElement("checkbox", "switch is-rounded is-small");
        input.id = `rule-matrix-${getUniqueID()}`;
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
        text: [rule.title, rule.language, rule.description, ...rule.example.text]
          .join(" ")
          .toLowerCase(),
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

  body.append(toolbar, head, ...sections.map(({ section }) => section), noMatches);
  root.append(card);
  controls.forEach((control) => control?.addEvent("change", render));
  render();
}
