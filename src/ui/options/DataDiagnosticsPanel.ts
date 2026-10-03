import type { SettingsRegistry } from "@ui/settings-engine/SettingsEngine.js";
import { i18n } from "./fluenttyperI18n.js";
import { createElement } from "@ui/settings-engine/dom/createElement.js";
import {
  createWorkspaceCard,
  moveControlToBody,
  pruneEmptySettingsGroups,
} from "./workspacePanelUtils.js";

export function renderDataDiagnosticsPanel(root: HTMLElement, registry: SettingsRegistry): void {
  const shell = createElement("div", { className: "workspace-panel-stack" });

  const config = createWorkspaceCard(i18n.get("config_data"), i18n.get("data_panel_transfer_copy"));
  moveControlToBody(registry, "exportSettingButton", config.body);
  moveControlToBody(registry, "importSettingButton", config.body);
  moveControlToBody(registry, "clearPersonalizationButton", config.body);
  shell.appendChild(config.card);

  const productivity = createWorkspaceCard(
    i18n.get("productivity_dashboard_group"),
    i18n.get("productivity_insights_subtitle"),
  );
  moveControlToBody(registry, "productivityStatsPanel", productivity.body);
  moveControlToBody(registry, "resetProductivityStatsButton", productivity.body);
  shell.appendChild(productivity.card);

  root.replaceChildren(shell);
  pruneEmptySettingsGroups(root);
}
