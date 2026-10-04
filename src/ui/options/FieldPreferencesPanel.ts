import type {
  FieldPreferenceRequest,
  FieldPreferenceResponse,
} from "@core/domain/fieldPreferences";
import { createElement } from "@ui/settings-engine/dom/createElement.js";
import { formatTranslation, i18n } from "./fluenttyperI18n.js";
import { createButton } from "./workspacePanelUtils.js";

const renderSeqs = new WeakMap<HTMLElement, number>();

export async function renderFieldPreferencesPanel(root: HTMLElement): Promise<void> {
  const seq = (renderSeqs.get(root) ?? 0) + 1;
  renderSeqs.set(root, seq);
  const title = createElement("h4", { textContent: i18n.get("field_preferences_title") });
  const status = createElement("p", { attributes: { role: "status" } });
  root.replaceChildren(title, status);
  const send = async (context: FieldPreferenceRequest) => {
    const response: FieldPreferenceResponse = await chrome.runtime.sendMessage({
      command: "CMD_FIELD_PREFERENCES",
      context,
    });
    if (!response?.ok)
      throw new Error(response?.error ?? i18n.get("field_preferences_unavailable"));
    return response.records;
  };
  try {
    const records = await send({ action: "list" });
    // A newer render cleared the root after this one did. Do not add a second copy of the groups.
    if (renderSeqs.get(root) !== seq) return;
    if (!records.length) status.textContent = i18n.get("field_preferences_empty");
    const mutate = async (context: FieldPreferenceRequest) => {
      try {
        await send(context);
        await renderFieldPreferencesPanel(root);
      } catch (error) {
        status.textContent =
          error instanceof Error ? error.message : i18n.get("field_preferences_update_failed");
      }
    };
    for (const origin of new Set(records.map((record) => record.topOrigin))) {
      const group = document.createElement("section");
      const heading = createElement("h5", { textContent: origin });
      const clear = createButton(
        i18n.get("field_preferences_forget_site"),
        "button",
        () => void mutate({ action: "clear", topOrigin: origin }),
      );
      group.append(heading, clear);
      for (const record of records.filter((item) => item.topOrigin === origin)) {
        const row = createElement("div", { className: "settings-stack-field" });
        const input = createElement("input", { className: "input" });
        input.value = record.label;
        input.maxLength = 80;
        input.setAttribute(
          "aria-label",
          formatTranslation("field_preferences_label_aria", { id: record.signature.slice(0, 8) }),
        );
        const detail = createElement("span", {
          textContent: `${record.frameOrigin} · ${record.signature.slice(0, 8)}`,
        });
        const key = {
          topOrigin: record.topOrigin,
          frameOrigin: record.frameOrigin,
          signature: record.signature,
        };
        const save = createButton(
          i18n.get("field_preferences_save_label"),
          "button",
          () => void mutate({ action: "rename", ...key, label: input.value }),
        );
        const forget = createButton(
          i18n.get("field_preferences_forget"),
          "button",
          () => void mutate({ action: "forget", ...key }),
        );
        const actions = createElement("div", { className: "text-assets-toolbar" });
        actions.append(save, forget);
        row.append(input, detail, actions);
        group.append(row);
      }
      root.append(group);
    }
  } catch (error) {
    status.textContent =
      error instanceof Error ? error.message : i18n.get("field_preferences_unavailable");
  }
}
