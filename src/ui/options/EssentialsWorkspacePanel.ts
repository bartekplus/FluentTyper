import type { SettingsRegistry } from "@ui/settings-engine/SettingsEngine.js";
import {
  KEY_AUTOCOMPLETE,
  KEY_AUTOCOMPLETE_ON_ENTER,
  KEY_AUTOCOMPLETE_ON_TAB,
  KEY_INLINE_SUGGESTION,
  KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE,
  KEY_MIN_WORD_LENGTH_TO_PREDICT,
  KEY_NUM_SUGGESTIONS,
  KEY_PERSONALIZATION_ENABLED,
  KEY_PREFER_NATIVE_AUTOCOMPLETE,
  KEY_CODE_MODE,
  KEY_PREFIX_ONLY_MODE,
  KEY_SELECT_BY_DIGIT,
  KEY_HORIZONTAL_SUGGESTIONS,
  KEY_SHOW_SUGGESTION_FOOTER,
} from "@core/domain/constants";
import { i18n } from "./fluenttyperI18n.js";
import { createElement } from "@ui/settings-engine/dom/createElement.js";
import {
  createWorkspaceCard,
  moveControlToBody,
  pruneEmptySettingsGroups,
} from "./workspacePanelUtils.js";

export function renderEssentialsWorkspacePanel(
  root: HTMLElement,
  registry: SettingsRegistry,
): void {
  const shell = createElement("div", { className: "workspace-panel-stack" });

  const general = createWorkspaceCard(i18n.get("General"));
  moveControlToBody(registry, "enable", general.body);
  moveControlToBody(registry, KEY_INLINE_SUGGESTION, general.body);
  moveControlToBody(registry, KEY_HORIZONTAL_SUGGESTIONS, general.body);
  moveControlToBody(registry, KEY_NUM_SUGGESTIONS, general.body);
  moveControlToBody(registry, KEY_PERSONALIZATION_ENABLED, general.body);

  const acceptance = createWorkspaceCard(i18n.get("accept_predictions"));
  moveControlToBody(registry, KEY_AUTOCOMPLETE_ON_TAB, acceptance.body);
  moveControlToBody(registry, KEY_AUTOCOMPLETE_ON_ENTER, acceptance.body);
  moveControlToBody(registry, KEY_AUTOCOMPLETE, acceptance.body);
  moveControlToBody(registry, KEY_SELECT_BY_DIGIT, acceptance.body);
  moveControlToBody(registry, KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE, acceptance.body);

  const advanced = createElement("details", {
    className: "settings-inline-card settings-advanced",
  });
  const summary = createElement("summary", { textContent: i18n.get("options_advanced") });
  const advancedBody = createElement("div", { className: "workspace-section-body" });
  advanced.append(summary, advancedBody);
  moveControlToBody(registry, KEY_MIN_WORD_LENGTH_TO_PREDICT, advancedBody);
  moveControlToBody(registry, KEY_SHOW_SUGGESTION_FOOTER, advancedBody);
  moveControlToBody(registry, KEY_PREFIX_ONLY_MODE, advancedBody);
  moveControlToBody(registry, KEY_PREFER_NATIVE_AUTOCOMPLETE, advancedBody);
  moveControlToBody(registry, KEY_CODE_MODE, advancedBody);

  shell.append(general.card, acceptance.card, advanced);
  root.replaceChildren(shell);
  pruneEmptySettingsGroups(root);
}
