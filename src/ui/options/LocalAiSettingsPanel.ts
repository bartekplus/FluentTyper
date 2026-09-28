import type { SettingsRegistry } from "@ui/settings-engine/SettingsEngine.js";
import {
  CMD_LOCAL_AI_CANCEL_INSTALL,
  CMD_LOCAL_AI_DELETE_MODEL,
  CMD_LOCAL_AI_GET_STATUS,
  CMD_LOCAL_AI_INSTALL,
  CMD_LOCAL_AI_STATUS_CHANGED,
  KEY_LOCAL_AI_REVIEW_ENABLED,
  KEY_LOCAL_AI_REVIEW_TIER,
} from "@core/domain/constants";
import type { LocalAiStatus } from "@core/domain/contracts/localAi";
import {
  LOCAL_AI_DOWNLOAD_ORIGINS,
  LOCAL_AI_MODELS,
  localAiModelForTier,
  type LocalAiModelRecord,
  type LocalAiModelTier,
} from "@core/domain/localAi/modelRegistry";
import type { LocalAiCommandResponse } from "@core/domain/messageTypes";
import { sendRuntimeMessage } from "@ui/shared/runtimeMessaging";
import { formatTranslation, i18n } from "./fluenttyperI18n.js";
import {
  bindControlEvents,
  createWorkspaceCard,
  moveControlToBody,
} from "./workspacePanelUtils.js";

/** URL fragment the Review panel's "Set up local AI…" opens (options/options.html#local-ai). */
export const LOCAL_AI_SECTION_ID = "local-ai";

const t = (key: string) => i18n.get(key);
const DOWNLOAD_HOST = new URL(LOCAL_AI_DOWNLOAD_ORIGINS[0]).hostname;

interface LocalAiView {
  message: string;
  /** 0..1 while downloading or loading. */
  progress?: number;
  install?: "local_ai_install" | "local_ai_reinstall";
  cancel?: boolean;
  delete?: boolean;
  /** False when this device/browser cannot run Local AI at all. */
  modelChoice: boolean;
}

function formatGigabytes(bytes: number, maximumFractionDigits = 2): string {
  const locale = i18n.lang === "pr" ? "pt" : i18n.lang;
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "gigabyte",
    maximumFractionDigits,
  }).format(bytes / 1e9);
}

function modelLabel(model: LocalAiModelRecord): string {
  const family = /\(([^)]+)\)/.exec(model.displayName)?.[1];
  const tier = t(`local_ai_tier_${model.tier}`);
  return family ? `${tier} (${family})` : tier;
}

function isLocalAiStatus(value: unknown): value is LocalAiStatus {
  const status = value as Partial<LocalAiStatus> | null;
  return (
    typeof status === "object" &&
    status !== null &&
    typeof status.runtime === "string" &&
    typeof status.install === "string" &&
    typeof status.tier === "string"
  );
}

/** Maps the background's status to what the section shows; `undefined` = no answer yet. */
function describeStatus(
  status: LocalAiStatus | null | undefined,
  tier: LocalAiModelTier,
): LocalAiView {
  if (status === undefined) {
    return { message: t("local_ai_status_pending"), modelChoice: true };
  }
  if (status === null) {
    return { message: t("local_ai_status_unreachable"), modelChoice: true };
  }
  const hasFiles = status.install === "complete" || status.install === "partial";
  if (status.unavailable) {
    const hostless =
      status.unavailable === "host-unsupported" || status.unavailable === "not-in-build";
    return {
      message: formatTranslation("local_ai_status_unsupported", {
        reason: t(`local_ai_unavailable_${status.unavailable.replaceAll("-", "_")}`),
      }),
      delete: !hostless && hasFiles,
      modelChoice: false,
    };
  }
  switch (status.runtime) {
    case "checking-support":
      return { message: t("local_ai_status_checking"), modelChoice: true };
    case "downloading":
      return {
        message: t("local_ai_status_downloading"),
        progress: status.progress ?? 0,
        cancel: true,
        modelChoice: true,
      };
    case "loading":
      return {
        message: t("local_ai_status_loading"),
        progress: status.progress ?? 0,
        modelChoice: true,
      };
  }
  if (status.tier !== tier) {
    // The choice is saved but the background has not reported on the new model yet.
    return {
      message: formatTranslation("local_ai_status_tier_changed", {
        model: modelLabel(localAiModelForTier(tier)),
      }),
      install: "local_ai_install",
      modelChoice: true,
    };
  }
  const error =
    status.runtime === "error" && status.error
      ? `${t(`local_ai_error_${status.error.replaceAll("-", "_")}`)} `
      : "";
  if (status.install === "complete") {
    return { message: error + t("local_ai_status_ready"), delete: true, modelChoice: true };
  }
  if (status.install === "partial") {
    return {
      message: error + t("local_ai_status_partial"),
      install: "local_ai_reinstall",
      delete: true,
      modelChoice: true,
    };
  }
  return {
    message: error + t(status.consented ? "local_ai_status_missing" : "local_ai_status_not_setup"),
    install: "local_ai_install",
    modelChoice: true,
  };
}

function createButton(className: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `button is-small ${className}`;
  button.addEventListener("click", onClick);
  return button;
}

function setText(element: HTMLElement, text: string): void {
  // Only real changes reach the live region, so progress ticks are never announced.
  if (element.textContent !== text) {
    element.textContent = text;
  }
}

/**
 * Inserts the "Local AI" card after `anchor` and wires it to the background.
 * Talks only through CMD_LOCAL_AI_* runtime messages; nothing downloads until
 * the user confirms the inline install step.
 */
export function mountLocalAiSettings(anchor: HTMLElement, registry: SettingsRegistry): void {
  const enabledControl = registry[KEY_LOCAL_AI_REVIEW_ENABLED];
  const tierControl = registry[KEY_LOCAL_AI_REVIEW_TIER];
  if (!enabledControl?.rootElement) {
    return;
  }

  const { card, body } = createWorkspaceCard(t("local_ai_title"));
  card.id = LOCAL_AI_SECTION_ID;
  card.classList.add("local-ai-card");
  const heading = card.querySelector("h4")!;
  heading.id = `${LOCAL_AI_SECTION_ID}-title`;
  heading.tabIndex = -1;
  card.setAttribute("aria-labelledby", heading.id);

  const facts = document.createElement("ul");
  facts.className = "local-ai-facts settings-inline-help";
  for (const key of ["local_ai_fact_device", "local_ai_fact_download", "local_ai_fact_basic"]) {
    const item = document.createElement("li");
    item.textContent = t(key);
    facts.appendChild(item);
  }

  const models = document.createElement("fieldset");
  models.className = "local-ai-models";
  const legend = document.createElement("legend");
  legend.textContent = t("local_ai_model_legend");
  models.appendChild(legend);
  const radios = LOCAL_AI_MODELS.map((model) => {
    const option = document.createElement("label");
    option.className = "local-ai-model";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "local-ai-tier";
    radio.value = model.tier;
    radio.addEventListener("change", () => {
      if (radio.checked) {
        tierControl?.set(model.tier);
        render();
      }
    });
    const text = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = modelLabel(model);
    const meta = document.createElement("span");
    meta.className = "local-ai-model-meta";
    meta.textContent = formatTranslation("local_ai_model_meta", {
      size: formatGigabytes(model.downloadBytes),
      memory: formatGigabytes(model.vramEstimateMB * 1_048_576, 1),
    });
    text.append(name, meta);
    option.append(radio, text);
    models.appendChild(option);
    return radio;
  });
  const note = document.createElement("p");
  note.className = "settings-inline-help";
  note.textContent = t("local_ai_model_note");
  models.appendChild(note);

  const statusText = document.createElement("p");
  statusText.className = "local-ai-status";
  statusText.setAttribute("role", "status");
  statusText.setAttribute("aria-live", "polite");
  statusText.tabIndex = -1;

  const progressRow = document.createElement("div");
  progressRow.className = "local-ai-progress";
  const progress = document.createElement("progress");
  progress.className = "progress is-small is-link";
  progress.max = 100;
  progress.setAttribute("role", "progressbar");
  progress.setAttribute("aria-valuemin", "0");
  progress.setAttribute("aria-valuemax", "100");
  progress.setAttribute("aria-label", t("local_ai_progress_label"));
  const progressDetail = document.createElement("span");
  progressDetail.className = "settings-inline-help";
  progressRow.append(progress, progressDetail);

  const actions = document.createElement("div");
  actions.className = "text-assets-actions";
  const installButton = createButton("is-link", () => openConfirm("install", installButton));
  const cancelButton = createButton(
    "is-light",
    () => void send({ command: CMD_LOCAL_AI_CANCEL_INSTALL, context: {} }),
  );
  cancelButton.textContent = t("local_ai_cancel_download");
  const deleteButton = createButton("is-danger is-light", () =>
    openConfirm("delete", deleteButton),
  );
  deleteButton.textContent = t("local_ai_delete");
  actions.append(installButton, cancelButton, deleteButton);

  const confirmBox = document.createElement("div");
  confirmBox.className = "local-ai-confirm";
  confirmBox.setAttribute("role", "group");
  const confirmText = document.createElement("p");
  confirmText.id = `${LOCAL_AI_SECTION_ID}-confirm-text`;
  confirmBox.setAttribute("aria-labelledby", confirmText.id);
  const confirmActions = document.createElement("div");
  confirmActions.className = "text-assets-actions";
  const confirmButton = createButton("is-link", () => void confirmAction());
  const backButton = createButton("is-light", () => closeConfirm());
  backButton.textContent = t("local_ai_confirm_back");
  confirmActions.append(confirmButton, backButton);
  confirmBox.append(confirmText, confirmActions);

  moveControlToBody(registry, KEY_LOCAL_AI_REVIEW_ENABLED, body);
  body.append(facts, models, statusText, progressRow, actions, confirmBox);
  anchor.after(card);

  let status: LocalAiStatus | null | undefined;
  let busy = false;
  let notice = "";
  let confirming: "install" | "delete" | null = null;
  let returnFocus: HTMLElement | null = null;

  const selectedTier = (): LocalAiModelTier => localAiModelForTier(tierControl?.get()).tier;

  function render(): void {
    const tier = selectedTier();
    const model = localAiModelForTier(tier);
    const size = formatGigabytes(model.downloadBytes);
    const view = describeStatus(status, tier);
    if ((confirming === "install" && !view.install) || (confirming === "delete" && !view.delete)) {
      confirming = null;
    }

    setText(statusText, notice ? `${view.message} ${notice}` : view.message);

    for (const radio of radios) {
      radio.checked = radio.value === tier;
    }
    models.hidden = !view.modelChoice;
    models.disabled = busy || view.progress !== undefined;

    progressRow.hidden = view.progress === undefined;
    if (view.progress !== undefined) {
      const percent = Math.round(Math.min(Math.max(view.progress, 0), 1) * 100);
      progress.value = percent;
      progress.setAttribute("aria-valuenow", String(percent));
      progressDetail.textContent =
        status?.runtime === "downloading"
          ? formatTranslation("local_ai_progress_bytes", {
              done: formatGigabytes((status.downloadBytes * percent) / 100),
              total: formatGigabytes(status.downloadBytes),
            })
          : `${percent}%`;
    }

    installButton.hidden = !view.install || confirming !== null;
    if (view.install) {
      installButton.textContent = formatTranslation(view.install, { size });
    }
    cancelButton.hidden = !view.cancel;
    deleteButton.hidden = !view.delete || confirming !== null;
    for (const button of [installButton, cancelButton, deleteButton, confirmButton]) {
      button.disabled = busy;
    }

    confirmBox.hidden = confirming === null;
    if (confirming === "install") {
      confirmText.textContent = formatTranslation("local_ai_install_confirm_text", {
        size,
        host: DOWNLOAD_HOST,
      });
      confirmButton.textContent = t("local_ai_install_confirm");
    } else if (confirming === "delete") {
      confirmText.textContent = formatTranslation("local_ai_delete_confirm_text", {
        model: modelLabel(localAiModelForTier(status?.tier)),
      });
      confirmButton.textContent = t("local_ai_delete");
    }
  }

  async function send(message: { command: string; context: object }): Promise<void> {
    busy = true;
    notice = "";
    render();
    const response = await sendRuntimeMessage<LocalAiCommandResponse>(message);
    busy = false;
    if (response?.ok && isLocalAiStatus(response.status)) {
      status = response.status;
    } else if (status === undefined) {
      status = null;
    } else {
      notice = t("local_ai_command_failed");
    }
    render();
  }

  function openConfirm(kind: "install" | "delete", origin: HTMLElement): void {
    confirming = kind;
    returnFocus = origin;
    render();
    confirmButton.focus();
  }

  function closeConfirm(): void {
    confirming = null;
    render();
    returnFocus?.focus();
  }

  async function confirmAction(): Promise<void> {
    const kind = confirming;
    confirming = null;
    statusText.focus();
    if (kind === "install") {
      // "Download and enable": the explicit consent also switches the preference on.
      if (enabledControl.get() !== true) {
        enabledControl.set(true);
      }
      await send({ command: CMD_LOCAL_AI_INSTALL, context: { tier: selectedTier() } });
    } else if (kind === "delete" && status) {
      await send({ command: CMD_LOCAL_AI_DELETE_MODEL, context: { modelId: status.modelId } });
    }
  }

  function revealIfRequested(): void {
    if (location.hash !== `#${LOCAL_AI_SECTION_ID}`) {
      return;
    }
    const tabId = card.closest(".content-tab")?.id;
    if (tabId) {
      document.querySelector<HTMLElement>(`a[href="#${tabId}"]`)?.click();
    }
    card.scrollIntoView?.({ block: "start" });
    heading.focus();
  }

  bindControlEvents(tierControl, [["change", render]]);
  chrome.runtime.onMessage.addListener((message: unknown) => {
    const payload = message as {
      command?: string;
      status?: unknown;
      context?: { status?: unknown };
    } | null;
    if (payload?.command !== CMD_LOCAL_AI_STATUS_CHANGED) {
      return;
    }
    const next = payload.context?.status ?? payload.status;
    if (isLocalAiStatus(next)) {
      status = next;
      render();
    }
  });
  window.addEventListener("hashchange", revealIfRequested);

  // Probing may start the runtime host, so only ask once the section is actually on screen.
  const probe = () => void send({ command: CMD_LOCAL_AI_GET_STATUS, context: { probe: true } });
  if (typeof IntersectionObserver === "undefined") {
    probe();
  } else {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        probe();
      }
    });
    observer.observe(card);
  }

  render();
  revealIfRequested();
}
