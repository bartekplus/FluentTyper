import type { SettingsRegistry } from "@ui/settings-engine/SettingsEngine.js";
import {
  KEY_AI_MODEL_ID,
  KEY_AI_PREDICTION_TIMEOUT_MS,
  KEY_DEBUG_AI_PREDICTOR_ENABLED,
  KEY_DEBUG_PRESAGE_PREDICTOR_ENABLED,
  KEY_OBSERVABILITY_DEFAULT_LEVEL,
  KEY_OBSERVABILITY_ENABLED,
  KEY_OBSERVABILITY_MODULE_OVERRIDES,
} from "@core/domain/constants";
import { i18n } from "./fluenttyperI18n.js";
import {
  createWorkspaceCard,
  createWorkspaceShell,
  moveControlToBody,
  pruneEmptySettingsGroups,
} from "./workspacePanelUtils.js";

export function renderObservabilityWorkspacePanel(
  root: HTMLElement,
  registry: SettingsRegistry,
): void {
  const shell = createWorkspaceShell();

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
  moveControlToBody(registry, KEY_DEBUG_AI_PREDICTOR_ENABLED, predictor.body);
  moveControlToBody(registry, KEY_AI_MODEL_ID, predictor.body);
  moveControlToBody(registry, KEY_AI_PREDICTION_TIMEOUT_MS, predictor.body);
  shell.appendChild(predictor.card);

  const dashboard = createWorkspaceCard(
    i18n.get("observability_dashboard_group"),
    i18n.get("observability_dashboard_desc"),
  );
  moveControlToBody(registry, "observabilityPanel", dashboard.body);
  shell.appendChild(dashboard.card);

  const hiddenHost = document.createElement("div");
  hiddenHost.hidden = true;
  moveControlToBody(registry, KEY_OBSERVABILITY_MODULE_OVERRIDES, hiddenHost);
  shell.appendChild(hiddenHost);

  root.replaceChildren(shell);
  pruneEmptySettingsGroups(root);
}
