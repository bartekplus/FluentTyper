import type { SettingsRegistry } from "@ui/settings-engine/SettingsEngine.js";
import { KEY_ENABLED_GRAMMAR_RULES } from "@core/domain/constants";
import { createWorkspaceShell, pruneEmptySettingsGroups } from "./workspacePanelUtils.js";

export function renderGrammarWorkspacePanel(root: HTMLElement, registry: SettingsRegistry): void {
  const control = registry[KEY_ENABLED_GRAMMAR_RULES];
  if (!control?.rootElement) {
    return;
  }
  const shell = createWorkspaceShell();

  const card = document.createElement("section");
  card.className = "settings-inline-card";
  card.appendChild(control.rootElement);

  shell.appendChild(card);
  root.replaceChildren(shell);
  pruneEmptySettingsGroups(root);
}
