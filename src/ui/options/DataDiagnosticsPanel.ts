import type { SettingsRegistry } from "@ui/settings-engine/SettingsEngine.js";
import { i18n } from "./fluenttyperI18n.js";
import {
  createWorkspaceCard,
  createWorkspaceShell,
  moveControlToBody,
  pruneEmptySettingsGroups,
} from "./workspacePanelUtils.js";

export function renderDataDiagnosticsPanel(root: HTMLElement, registry: SettingsRegistry): void {
  const shell = createWorkspaceShell();

  const productivity = createWorkspaceCard(
    i18n.get("productivity_dashboard_group"),
    i18n.get("productivity_insights_subtitle"),
  );
  moveControlToBody(registry, "productivityStatsPanel", productivity.body);
  moveControlToBody(registry, "resetProductivityStatsButton", productivity.body);
  shell.appendChild(productivity.card);

  const config = createWorkspaceCard(i18n.get("config_data"), i18n.get("data_panel_transfer_copy"));
  moveControlToBody(registry, "importSettingButton", config.body);
  moveControlToBody(registry, "exportSettingButton", config.body);
  moveControlToBody(registry, "clearPersonalizationButton", config.body);
  shell.appendChild(config.card);

  root.replaceChildren(shell);
  pruneEmptySettingsGroups(root);
}
