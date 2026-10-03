import { longSentenceThreshold } from "@core/domain/grammar/review/reviewCatalog";
import { mountPreferredTerminology } from "./PreferredTerminologyPanel";
import type { SettingsRegistry } from "@ui/settings-engine/SettingsEngine.js";
import {
  KEY_SHOW_REVIEW_BUTTON,
  KEY_LIVE_GRAMMAR_PROPOSALS,
  KEY_REVIEW_LONG_SENTENCE_WORDS,
} from "@core/domain/constants";
import { createInputElement } from "@ui/settings-engine/controls/FieldControl.js";
import { i18n } from "./fluenttyperI18n.js";
import { mountGrammarRuleMatrix } from "./GrammarRuleMatrix.js";
import { mountLocalAiSettings } from "./LocalAiSettingsPanel.js";
import { createElement } from "@ui/settings-engine/dom/createElement.js";
import {
  bindControlEvents,
  createStackField,
  createWorkspaceCard,
  moveControlToBody,
  pruneEmptySettingsGroups,
} from "./workspacePanelUtils.js";

export function renderGrammarWorkspacePanel(root: HTMLElement, registry: SettingsRegistry): void {
  const shell = createElement("div", { className: "workspace-panel-stack" });

  // Review has its own preferences, separate from typing autocorrection.
  const review = createWorkspaceCard(i18n.get("popup_review_text"));
  moveControlToBody(registry, KEY_SHOW_REVIEW_BUTTON, review.body);
  moveControlToBody(registry, KEY_LIVE_GRAMMAR_PROPOSALS, review.body);
  const threshold = registry[KEY_REVIEW_LONG_SENTENCE_WORDS];
  if (threshold) {
    const input = createInputElement("number", "input");
    input.id = "review-long-sentence-words";
    input.min = "10";
    input.max = "200";
    input.step = "1";
    input.required = true;
    const help = createElement("p", {
      className: "help",
      id: "review-long-sentence-help",
      textContent: i18n.get("review_long_sentence_help"),
    });
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

  shell.append(review.card);
  root.replaceChildren(shell);
  // Mounted after the shell is attached so it can observe its own visibility.
  mountLocalAiSettings(review.card, registry);
  mountGrammarRuleMatrix(shell, registry);
  mountPreferredTerminology(shell, registry);
  pruneEmptySettingsGroups(root);
}
