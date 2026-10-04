import type { SettingsRegistry } from "@ui/settings-engine/SettingsEngine";
import { KEY_PREFERRED_TERMINOLOGY } from "@core/domain/constants";
import { SUPPORTED_LANGUAGES, TEXT_EXPANDER_LANG } from "@core/domain/lang";
import {
  emptyTerminology,
  importTerminology,
  validateTerminology,
  MAX_TERMINOLOGY_IMPORT_BYTES,
  type PreferredTerm,
  type PreferredTerminology,
  type TerminologyValidation,
} from "@core/domain/grammar/review/preferredTerminology";
import { terminologyText, type TerminologyTextKey } from "./preferredTerminologyMessages";
import { i18n } from "./fluenttyperI18n";
import { createElement } from "@ui/settings-engine/dom/createElement.js";
import { createInputElement } from "@ui/settings-engine/controls/FieldControl.js";
import {
  createButton,
  createDisclosure,
  createStackField,
  createWorkspaceCard,
  downloadBlob,
} from "./workspacePanelUtils";

export function mountPreferredTerminology(root: HTMLElement, registry: SettingsRegistry): void {
  const control = registry[KEY_PREFERRED_TERMINOLOGY];
  if (!control) return;
  const t = (key: TerminologyTextKey) => terminologyText(key, i18n.lang);
  const { card, body } = createWorkspaceCard(t("terms_title"), t("terms_help"));
  card.id = "preferred-terminology";
  const status = createElement("p", { attributes: { role: "status", "aria-live": "polite" } });
  const button = (label: TerminologyTextKey, action: string, onClick: () => void) => {
    const el = createButton(t(label), "button", onClick);
    el.dataset.termsAction = action;
    return el;
  };
  const input = (name: string, maxLength: number) =>
    Object.assign(document.createElement("input"), {
      name,
      className: "input",
      maxLength,
      required: true,
    });
  const select = <T extends string>(name: string, choices: Array<[T, string]>) => {
    const el = document.createElement("select");
    el.name = name;

    for (const [value, label] of choices) {
      el.add(new window.Option(label, value));
    }
    return el;
  };
  const field = (label: string, widget: HTMLElement): HTMLLabelElement => {
    if (widget.tagName === "INPUT" && (widget as HTMLInputElement).type === "checkbox") {
      const row = createElement("label", { className: "checkbox" });
      row.append(widget, document.createTextNode(` ${label}`));
      return row;
    }
    if (widget.tagName === "SELECT") {
      const wrapper = createElement("div", { className: "select is-fullwidth" });
      wrapper.append(widget);
      return createStackField(label, wrapper);
    }
    return createStackField(label, widget);
  };
  const current = (): PreferredTerminology => {
    const result = validateTerminology(control.get());
    return result.ok ? result.value : emptyTerminology();
  };
  const report = (result: TerminologyValidation): boolean => {
    if (result.ok) return true;
    status.textContent = t(`terms_error_${result.error}`);
    return false;
  };
  const save = (value: PreferredTerminology): boolean => {
    const result = validateTerminology(value);
    if (!report(result) || !result.ok) return false;
    control.set(result.value);
    status.textContent = "";
    return true;
  };
  const enabled = createInputElement("checkbox");
  enabled.dataset.termsAction = "enabled";
  enabled.addEventListener("change", () => {
    if (!save({ ...current(), enabled: enabled.checked })) enabled.checked = current().enabled;
  });
  body.append(field(t("terms_enabled"), enabled));
  const list = document.createElement("ul");
  // The entry form stays folded until someone adds, edits or imports terms.
  const manage = createDisclosure(t("terms_add"));
  const form = createElement("form", { className: "workspace-section-body" });
  form.noValidate = true;
  let editingId: string | null = null;
  const source = input("source", 80);
  const replacement = input("replacement", 120);
  const explanation = input("explanation", 240);
  const casePolicy = select("casePolicy", [
    ["exact", t("terms_case_exact")],
    ["insensitive", t("terms_case_insensitive")],
  ]);
  const language = select(
    "language",
    Object.entries(SUPPORTED_LANGUAGES).filter(
      ([key]) => key !== "auto_detect" && key !== TEXT_EXPANDER_LANG,
    ),
  );
  const scope = select("scope", [
    ["all-prose", t("terms_scope_all")],
    ["selection", t("terms_scope_selection")],
  ]);
  const entryEnabled = createInputElement("checkbox");
  entryEnabled.name = "entryEnabled";
  entryEnabled.checked = true;
  for (const [label, widget] of [
    ["terms_source", source],
    ["terms_replacement", replacement],
    ["terms_explanation", explanation],
    ["terms_case", casePolicy],
    ["terms_language", language],
    ["terms_scope", scope],
    ["terms_entry_enabled", entryEnabled],
  ] as const)
    form.append(field(t(label), widget));
  const reset = () => {
    editingId = null;
    form.reset();
    language.value = "en_US";
    entryEnabled.checked = true;
  };
  const submit = createElement("button", {
    className: "button is-primary",
    attributes: { type: "submit" },
  });
  submit.dataset.termsAction = "save";
  submit.textContent = t("terms_save");
  const formActions = createElement("div", { className: "buttons" });
  formActions.append(
    submit,
    button("terms_cancel", "cancel", () => {
      reset();
      source.focus();
    }),
  );
  form.append(formActions);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const config = current();
    const entry: PreferredTerm = {
      id: editingId ?? crypto.randomUUID(),
      source: source.value,
      replacement: replacement.value,
      explanation: explanation.value,
      casePolicy: casePolicy.value as PreferredTerm["casePolicy"],
      language: language.value,
      scope: scope.value as PreferredTerm["scope"],
      enabled: entryEnabled.checked,
    };
    const exists = config.entries.some((e) => e.id === entry.id);
    const entries = exists
      ? config.entries.map((e) => (e.id === entry.id ? entry : e))
      : [...config.entries, entry];
    if (save({ ...config, entries })) {
      reset();
      source.focus();
    }
  });
  const render = () => {
    const config = current();
    enabled.checked = config.enabled;
    list.replaceChildren();
    for (const entry of config.entries) {
      const row = document.createElement("li");
      row.className = "workspace-section-body";
      const text = createElement("span", {
        textContent: `${entry.source} → ${entry.replacement} (${entry.enabled ? t("terms_on") : t("terms_off")})`,
      });
      const edit = button("terms_edit", "edit", () => {
        editingId = entry.id;
        source.value = entry.source;
        replacement.value = entry.replacement;
        explanation.value = entry.explanation;
        casePolicy.value = entry.casePolicy;
        language.value = entry.language;
        scope.value = entry.scope;
        entryEnabled.checked = entry.enabled;
        manage.open = true;
        source.focus();
      });
      edit.setAttribute("aria-label", `${t("terms_edit")}: ${entry.source}`);
      const remove = button("terms_remove", "remove", () => {
        if (save({ ...current(), entries: current().entries.filter((e) => e.id !== entry.id) })) {
          if (editingId === entry.id) reset();
          source.focus();
        }
      });
      remove.setAttribute("aria-label", `${t("terms_remove")}: ${entry.source}`);
      const actions = createElement("div", { className: "buttons" });
      actions.append(edit, remove);
      row.append(text, actions);
      list.append(row);
    }
  };
  const file = document.createElement("input");
  file.type = "file";
  file.accept = ".json,application/json";
  file.dataset.termsAction = "import-file";
  file.addEventListener(
    "change",
    () =>
      void (async () => {
        const chosen = file.files?.[0];
        if (!chosen) return;
        const before = control.get();
        try {
          if (chosen.size > MAX_TERMINOLOGY_IMPORT_BYTES) {
            report({ ok: false, error: "limit" });
            return;
          }
          const contents = await chosen.text();
          if (control.get() !== before) {
            status.textContent = t("terms_error_changed");
            return;
          }
          const result = importTerminology(contents);
          if (report(result) && result.ok && save(result.value)) reset();
        } catch {
          status.textContent = t("terms_error_schema");
        } finally {
          file.value = "";
        }
      })(),
  );
  manage.append(
    form,
    createStackField(t("terms_import"), file),
    button("terms_export", "export", () => {
      const result = validateTerminology(control.get() ?? emptyTerminology());
      if (!report(result) || !result.ok) return;
      downloadBlob(
        new Blob([JSON.stringify(result.value, null, 2)], { type: "application/json" }),
        "fluenttyper-terminology.json",
      );
    }),
  );
  body.append(list, manage, status);
  root.append(card);
  control.addEvent("change", render);
  reset();
  render();
}
