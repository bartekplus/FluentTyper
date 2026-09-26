import type { SettingsRegistry } from "@ui/settings-engine/SettingsEngine.js";
import { KEY_ENABLED_GRAMMAR_RULES, KEY_SHOW_REVIEW_BUTTON } from "@core/domain/constants";
import { i18n } from "./fluenttyperI18n.js";
import {
  createWorkspaceCard,
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

  // Review uses these rules too; its in-field button is switched here.
  const review = createWorkspaceCard(i18n.get("popup_review_text"));
  moveControlToBody(registry, KEY_SHOW_REVIEW_BUTTON, review.body);

  shell.append(review.card, card);
  root.replaceChildren(shell);
  pruneEmptySettingsGroups(root);
}
