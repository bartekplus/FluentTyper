import type {
  FieldPreferenceRequest,
  FieldPreferenceResponse,
} from "@core/domain/fieldPreferences";

export async function renderFieldPreferencesPanel(root: HTMLElement): Promise<void> {
  const title = document.createElement("h4");
  title.textContent = "Saved writing fields";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
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
      const heading = document.createElement("h5");
      heading.textContent = origin;
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "button";
      clear.textContent = "Forget all fields for this site";
      clear.addEventListener("click", () => void mutate({ action: "clear", topOrigin: origin }));
      group.append(heading, clear);
      for (const record of records.filter((item) => item.topOrigin === origin)) {
        const row = document.createElement("div");
        row.className = "settings-stack-field";
        const input = document.createElement("input");
        input.className = "input";
        input.value = record.label;
        input.maxLength = 80;
        input.setAttribute("aria-label", `Saved field label (${record.signature.slice(0, 8)})`);
        const detail = document.createElement("span");
        detail.textContent = `${record.frameOrigin} · ${record.signature.slice(0, 8)}`;
        const save = document.createElement("button");
        save.type = "button";
        save.className = "button";
        save.textContent = "Save label";
        const key = {
          topOrigin: record.topOrigin,
          frameOrigin: record.frameOrigin,
          signature: record.signature,
        };
        save.addEventListener(
          "click",
          () => void mutate({ action: "rename", ...key, label: input.value }),
        );
        const forget = document.createElement("button");
        forget.type = "button";
        forget.className = "button";
        forget.textContent = "Forget";
        forget.addEventListener("click", () => void mutate({ action: "forget", ...key }));
        const actions = document.createElement("div");
        actions.className = "text-assets-toolbar";
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
