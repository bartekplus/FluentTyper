import type { SettingsRegistry } from "@ui/settings-engine/SettingsEngine.js";
import {
  KEY_DEBUG_PRESAGE_PREDICTOR_ENABLED,
  KEY_OBSERVABILITY_DEFAULT_LEVEL,
  KEY_OBSERVABILITY_ENABLED,
} from "@core/domain/constants";
import { i18n } from "./fluenttyperI18n.js";
import { createElement } from "@ui/settings-engine/dom/createElement.js";
import {
  createWorkspaceCard,
  moveControlToBody,
  pruneEmptySettingsGroups,
} from "./workspacePanelUtils.js";

export function renderObservabilityWorkspacePanel(
  root: HTMLElement,
  registry: SettingsRegistry,
): void {
  const shell = createElement("div", { className: "workspace-panel-stack" });

  const controls = createWorkspaceCard(
    i18n.get("observability_controls_group"),
    i18n.get("observability_desc"),
  );
  moveControlToBody(registry, "observabilityHint", controls.body);
  moveControlToBody(registry, KEY_OBSERVABILITY_ENABLED, controls.body);
  moveControlToBody(registry, KEY_OBSERVABILITY_DEFAULT_LEVEL, controls.body);
  shell.appendChild(controls.card);

  const predictor = createWorkspaceCard(
    i18n.get("observability_predictor_group"),
    i18n.get("predictor_debug_desc"),
  );
  moveControlToBody(registry, KEY_DEBUG_PRESAGE_PREDICTOR_ENABLED, predictor.body);
  shell.appendChild(predictor.card);

  const dashboard = createWorkspaceCard(
    i18n.get("observability_dashboard_group"),
    i18n.get("observability_dashboard_desc"),
  );
  moveControlToBody(registry, "observabilityPanel", dashboard.body);
  shell.appendChild(dashboard.card);

  root.replaceChildren(shell);
  pruneEmptySettingsGroups(root);
}
