import { longSentenceThreshold } from "@core/domain/grammar/review/reviewCatalog";
import { mountPreferredTerminology } from "./PreferredTerminologyPanel";
import type { SettingsRegistry } from "@ui/settings-engine/SettingsEngine.js";
import {
  KEY_ENABLED_GRAMMAR_RULES,
  KEY_SHOW_REVIEW_BUTTON,
  KEY_LIVE_GRAMMAR_PROPOSALS,
  KEY_REVIEW_RULE_OVERRIDES,
  KEY_REVIEW_LONG_SENTENCE_WORDS,
} from "@core/domain/constants";
import { i18n } from "./fluenttyperI18n.js";
import { mountLocalAiSettings } from "./LocalAiSettingsPanel.js";
import {
  createWorkspaceCard,
  createStackField,
  bindControlEvents,
  createWorkspaceShell,
  moveControlToBody,
  pruneEmptySettingsGroups,
} from "./workspacePanelUtils.js";

export function renderGrammarWorkspacePanel(root: HTMLElement, registry: SettingsRegistry): void {
  const control = registry[KEY_ENABLED_GRAMMAR_RULES];
  if (!control?.rootElement) {
    return;
  }
  const shell = createWorkspaceShell();

  const card = document.createElement("section");
  card.className = "settings-inline-card";
  card.appendChild(control.rootElement);

  // Review has its own preferences, separate from typing autocorrection.
  const review = createWorkspaceCard(i18n.get("popup_review_text"));
  moveControlToBody(registry, KEY_SHOW_REVIEW_BUTTON, review.body);
  moveControlToBody(registry, KEY_LIVE_GRAMMAR_PROPOSALS, review.body);
  moveControlToBody(registry, KEY_REVIEW_RULE_OVERRIDES, review.body);
  const threshold = registry[KEY_REVIEW_LONG_SENTENCE_WORDS];
  if (threshold) {
    const input = document.createElement("input");
    input.type = "number";
    input.id = "review-long-sentence-words";
    input.className = "input";
    input.min = "10";
    input.max = "200";
    input.step = "1";
    input.required = true;
    const help = document.createElement("p");
    help.id = "review-long-sentence-help";
    help.className = "help";
    help.textContent = i18n.get("review_long_sentence_help");
    input.setAttribute("aria-describedby", help.id);
    const render = () => {
      input.value = String(longSentenceThreshold(threshold.get()));
    };
    input.addEventListener("change", () => {
      if (input.checkValidity()) threshold.set(input.valueAsNumber);
      else input.reportValidity();
    });
    bindControlEvents(threshold, [["change", render]]);
    review.body.append(createStackField(i18n.get("review_long_sentence_label"), input), help);
    render();
  }

  shell.append(review.card, card);
  root.replaceChildren(shell);
  // Mounted after the shell is attached so it can observe its own visibility.
  mountLocalAiSettings(review.card, registry);
  mountPreferredTerminology(shell, registry);
  pruneEmptySettingsGroups(root);
}
