import type { SettingsRegistry } from "@ui/settings-engine/SettingsEngine.js";
import { i18n } from "./fluenttyperI18n.js";
import { createWorkspaceShell } from "./workspacePanelUtils.js";
import {
  createWorkspaceCard,
  moveControlToBody,
  pruneEmptySettingsGroups,
} from "./workspacePanelUtils.js";

export class DataDiagnosticsPanel {
  private readonly root: HTMLElement;
  private readonly registry: SettingsRegistry;

  constructor(root: HTMLElement, registry: SettingsRegistry) {
    this.root = root;
    this.registry = registry;
    this.render();
  }

  render(): void {
    const shell = createWorkspaceShell();

    const productivity = createWorkspaceCard(
      i18n.get("productivity_dashboard_group"),
      i18n.get("productivity_insights_subtitle"),
    );
    moveControlToBody(this.registry, "productivityStatsPanel", productivity.body);
    moveControlToBody(this.registry, "resetProductivityStatsButton", productivity.body);
    shell.appendChild(productivity.card);

    const config = createWorkspaceCard(
      i18n.get("config_data"),
      i18n.get("data_panel_transfer_copy"),
    );
    moveControlToBody(this.registry, "importSettingButton", config.body);
    moveControlToBody(this.registry, "exportSettingButton", config.body);
    moveControlToBody(this.registry, "clearPersonalizationButton", config.body);
    shell.appendChild(config.card);

    this.root.replaceChildren(shell);
    pruneEmptySettingsGroups(this.root);
  }
}
