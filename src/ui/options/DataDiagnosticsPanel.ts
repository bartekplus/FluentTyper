import type { SettingsRegistry } from "@ui/settings-engine/SettingsEngine.js";
import {
  KEY_AI_MODEL_ID,
  KEY_AI_PREDICTION_TIMEOUT_MS,
  KEY_DEBUG_AI_PREDICTOR_ENABLED,
  KEY_DEBUG_PRESAGE_PREDICTOR_ENABLED,
} from "@core/domain/constants";
import { i18n } from "./fluenttyperI18n.js";
import {
  createWorkspaceCard,
  moveControlToBody,
  pruneEmptySettingsGroups,
} from "./workspacePanelUtils.js";

export class DataDiagnosticsPanel {
  private readonly root: HTMLElement;
  private readonly registry: SettingsRegistry;
  private readonly isDevBuild: boolean;

  constructor(root: HTMLElement, registry: SettingsRegistry, isDevBuild: boolean) {
    this.root = root;
    this.registry = registry;
    this.isDevBuild = isDevBuild;
    this.render();
  }

  render(): void {
    const shell = document.createElement("div");
    shell.className = "workspace-panel-stack";
    const primaryGrid = document.createElement("div");
    primaryGrid.className = "workspace-card-grid";

    const productivity = createWorkspaceCard(
      i18n.get("productivity_dashboard_group"),
      i18n.get("productivity_insights_subtitle"),
    );
    moveControlToBody(this.registry, "productivityStatsPanel", productivity.body);
    moveControlToBody(this.registry, "resetProductivityStatsButton", productivity.body);
    primaryGrid.appendChild(productivity.card);

    const config = createWorkspaceCard(
      i18n.get("config_data"),
      `${i18n.get("import_settings_desc")} ${i18n.get("export_settings_desc")}`,
    );
    moveControlToBody(this.registry, "importSettingButton", config.body);
    moveControlToBody(this.registry, "exportSettingButton", config.body);
    primaryGrid.appendChild(config.card);
    shell.appendChild(primaryGrid);

    if (this.isDevBuild) {
      const debugDisclosure = document.createElement("details");
      debugDisclosure.className = "settings-disclosure";
      const debugSummary = document.createElement("summary");
      debugSummary.textContent = i18n.get("predictor_debug_group");
      debugDisclosure.appendChild(debugSummary);

      const debug = createWorkspaceCard(
        i18n.get("predictor_debug_group"),
        i18n.get("predictor_debug_desc"),
      );
      moveControlToBody(this.registry, "predictorDebugHint", debug.body);
      moveControlToBody(this.registry, KEY_DEBUG_PRESAGE_PREDICTOR_ENABLED, debug.body);
      moveControlToBody(this.registry, KEY_DEBUG_AI_PREDICTOR_ENABLED, debug.body);
      moveControlToBody(this.registry, KEY_AI_MODEL_ID, debug.body);
      moveControlToBody(this.registry, KEY_AI_PREDICTION_TIMEOUT_MS, debug.body);
      moveControlToBody(this.registry, "predictorDebugPanel", debug.body);
      debugDisclosure.appendChild(debug.card);
      shell.appendChild(debugDisclosure);
    }

    this.root.replaceChildren(shell);
    pruneEmptySettingsGroups(this.root);
  }
}
