import type {
  FieldPreferenceRequest,
  FieldPreferenceResponse,
} from "@core/domain/fieldPreferences";
import { createElement } from "@ui/settings-engine/dom/createElement.js";
import { createButton } from "./workspacePanelUtils.js";

export async function renderFieldPreferencesPanel(root: HTMLElement): Promise<void> {
  const title = createElement("h4", { textContent: "Saved writing fields" });
  const status = createElement("p", { attributes: { role: "status" } });
  root.replaceChildren(title, status);
  const send = async (context: FieldPreferenceRequest) => {
    const response: FieldPreferenceResponse = await chrome.runtime.sendMessage({
      command: "CMD_FIELD_PREFERENCES",
      context,
    });
    if (!response?.ok) throw new Error(response?.error ?? "Saved fields are unavailable.");
    return response.records;
  };
  try {
    const records = await send({ action: "list" });
    if (!records.length)
      status.textContent =
        "No remembered fields. Enable assistance in a field, then choose Remember for this field.";
    const mutate = async (context: FieldPreferenceRequest) => {
      try {
        await send(context);
        await renderFieldPreferencesPanel(root);
      } catch (error) {
        status.textContent =
          error instanceof Error ? error.message : "Could not update saved fields.";
      }
    };
    for (const origin of new Set(records.map((record) => record.topOrigin))) {
      const group = document.createElement("section");
      const heading = createElement("h5", { textContent: origin });
      const clear = createButton(
        "Forget all fields for this site",
        "button",
        () => void mutate({ action: "clear", topOrigin: origin }),
      );
      group.append(heading, clear);
      for (const record of records.filter((item) => item.topOrigin === origin)) {
        const row = createElement("div", { className: "settings-stack-field" });
        const input = createElement("input", { className: "input" });
        input.value = record.label;
        input.maxLength = 80;
        input.setAttribute("aria-label", `Saved field label (${record.signature.slice(0, 8)})`);
        const detail = createElement("span", {
          textContent: `${record.frameOrigin} · ${record.signature.slice(0, 8)}`,
        });
        const key = {
          topOrigin: record.topOrigin,
          frameOrigin: record.frameOrigin,
          signature: record.signature,
        };
        const save = createButton(
          "Save label",
          "button",
          () => void mutate({ action: "rename", ...key, label: input.value }),
        );
        const forget = createButton(
          "Forget",
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
    status.textContent = error instanceof Error ? error.message : "Saved fields are unavailable.";
  }
}
