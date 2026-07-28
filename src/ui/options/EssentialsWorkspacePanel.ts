import type { SettingsRegistry } from "@ui/settings-engine/SettingsEngine.js";
import {
  KEY_AI_PREDICTOR_ENABLED,
  KEY_AUTOCOMPLETE,
  KEY_AUTOCOMPLETE_ON_ENTER,
  KEY_AUTOCOMPLETE_ON_TAB,
  KEY_INLINE_SUGGESTION,
  KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE,
  KEY_MIN_WORD_LENGTH_TO_PREDICT,
  KEY_NUM_SUGGESTIONS,
  KEY_PERSONALIZATION_ENABLED,
  KEY_PREFER_NATIVE_AUTOCOMPLETE,
  KEY_PREFIX_ONLY_MODE,
  KEY_SELECT_BY_DIGIT,
} from "@core/domain/constants";
import { i18n } from "./fluenttyperI18n.js";
import { createWorkspaceShell } from "./workspacePanelUtils.js";
import {
  createWorkspaceCard,
  moveControlToBody,
  pruneEmptySettingsGroups,
} from "./workspacePanelUtils.js";

export class EssentialsWorkspacePanel {
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
    const shell = createWorkspaceShell();

    const general = createWorkspaceCard(i18n.get("General"));
    moveControlToBody(this.registry, "enable", general.body);
    moveControlToBody(this.registry, KEY_INLINE_SUGGESTION, general.body);
    moveControlToBody(this.registry, KEY_PREFER_NATIVE_AUTOCOMPLETE, general.body);
    moveControlToBody(this.registry, KEY_PREFIX_ONLY_MODE, general.body);

    const prediction = createWorkspaceCard(i18n.get("prediction_engine"));
    moveControlToBody(this.registry, KEY_PERSONALIZATION_ENABLED, prediction.body);
    moveControlToBody(this.registry, KEY_NUM_SUGGESTIONS, prediction.body);
    moveControlToBody(this.registry, KEY_MIN_WORD_LENGTH_TO_PREDICT, prediction.body);
    if (this.isDevBuild) {
      moveControlToBody(this.registry, KEY_AI_PREDICTOR_ENABLED, prediction.body);
    }

    const acceptance = createWorkspaceCard(i18n.get("accept_predictions"));
    moveControlToBody(this.registry, KEY_AUTOCOMPLETE_ON_TAB, acceptance.body);
    moveControlToBody(this.registry, KEY_AUTOCOMPLETE_ON_ENTER, acceptance.body);
    moveControlToBody(this.registry, KEY_AUTOCOMPLETE, acceptance.body);
    moveControlToBody(this.registry, KEY_SELECT_BY_DIGIT, acceptance.body);

    const behavior = createWorkspaceCard(i18n.get("behavior_after_completion"));
    moveControlToBody(this.registry, KEY_INSERT_SPACE_AFTER_AUTOCOMPLETE, behavior.body);

    shell.append(general.card, prediction.card, acceptance.card, behavior.card);
    this.root.replaceChildren(shell);
    pruneEmptySettingsGroups(this.root);
  }
}
