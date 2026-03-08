import type { SettingsRegistry } from "@ui/settings-engine/SettingsEngine.js";
import { KEY_ENABLED_GRAMMAR_RULES } from "@core/domain/constants";
import { pruneEmptySettingsGroups } from "./workspacePanelUtils.js";

export class GrammarWorkspacePanel {
  private readonly root: HTMLElement;
  private readonly registry: SettingsRegistry;

  constructor(root: HTMLElement, registry: SettingsRegistry) {
    this.root = root;
    this.registry = registry;
    this.render();
  }

  render(): void {
    const control = this.registry[KEY_ENABLED_GRAMMAR_RULES];
    if (!control?.rootElement) {
      return;
    }
    const shell = document.createElement("div");
    shell.className = "workspace-panel-stack";

    const card = document.createElement("section");
    card.className = "settings-inline-card";
    card.appendChild(control.rootElement);

    shell.appendChild(card);
    this.root.replaceChildren(shell);
    pruneEmptySettingsGroups(this.root);
  }
}
