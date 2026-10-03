import type { SettingsRegistry } from "@ui/settings-engine/SettingsEngine.js";
import { toStoredString } from "@core/application/domain-utils";
import { i18n } from "./fluenttyperI18n.js";
import { createElement } from "@ui/settings-engine/dom/createElement.js";

type ControlEventTarget = {
  addEvent?: (type: string, fn: () => void) => void;
};

export function createButton(
  label: string,
  className = "button",
  onClick?: () => void,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  if (onClick) {
    button.addEventListener("click", onClick);
  }
  return button;
}

export function createExternalLink(
  href: string,
  className?: string,
  textContent?: string,
): HTMLAnchorElement {
  const link = createElement("a", { className, textContent });
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

export function formatLooseText(value: unknown, fallback = ""): string {
  return toStoredString(value) ?? fallback;
}

export function createSearchInput(
  placeholder: string,
  value: string,
  onQuery: (query: string) => void,
): HTMLInputElement {
  const search = document.createElement("input");
  search.type = "search";
  search.className = "input";
  search.placeholder = placeholder;
  search.value = value;
  search.addEventListener("input", () => onQuery(search.value.trim().toLowerCase()));
  return search;
}

export function downloadBlob(blob: Blob, filename: string, revokeDelayMs: number): void {
  const link = document.createElement("a");
  link.href = window.URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  window.setTimeout(() => window.URL.revokeObjectURL(link.href), revokeDelayMs);
}

/** Builds section.settings-inline-card with an optional h4 title and p.settings-inline-help. */
export function createInlineCard(titleText?: string, helpText?: string): HTMLElement {
  const card = createElement("section", { className: "settings-inline-card" });
  if (titleText) {
    card.appendChild(createElement("h4", { textContent: titleText }));
  }
  if (helpText) {
    card.appendChild(
      createElement("p", { className: "settings-inline-help", textContent: helpText }),
    );
  }
  return card;
}

export function createWorkspaceCard(titleText?: string, bodyText?: string) {
  const card = createInlineCard(titleText, bodyText);
  card.classList.add("workspace-section-card");
  const body = createElement("div", { className: "workspace-section-body" });
  card.appendChild(body);
  return { card, body };
}

/**
 * Builds a "domain-table" editor: a toolbar with a search input, an add input and an add
 * button, then a list with one row and one remove button for each item that matches the query.
 */
export function createRemovableList(options: {
  searchPlaceholder: string;
  query: string;
  onQuery: (query: string) => void;
  addPlaceholder: string;
  addLabel: string;
  onAdd: (input: HTMLInputElement) => void;
  items: string[];
  hint?: string;
  onRemove: (item: string) => void;
  emptyText: string;
}) {
  const toolbar = createElement("div", { className: "text-assets-toolbar" });
  const addInput = createElement("input", { className: "input" });
  addInput.placeholder = options.addPlaceholder;
  const addButton = createButton(options.addLabel, "button", () => options.onAdd(addInput));
  const list = createElement("div", { className: "domain-table" });
  // Rebuild only the list, so that the search input keeps its focus while the user types.
  const fillList = (query: string) => {
    const rows = options.items
      .filter((entry) => entry.toLowerCase().includes(query))
      .map((item) => {
        const row = createElement("div", { className: "domain-table-row" });
        row.appendChild(
          createElement("div", { className: "domain-table-name", textContent: item }),
        );
        if (options.hint) {
          row.appendChild(
            createElement("div", { className: "domain-table-hint", textContent: options.hint }),
          );
        }
        row.appendChild(
          createButton(i18n.get("remove"), "button is-light", () => options.onRemove(item)),
        );
        return row;
      });
    list.replaceChildren(
      ...(rows.length
        ? rows
        : [
            createElement("p", {
              className: "settings-inline-help",
              textContent: options.emptyText,
            }),
          ]),
    );
  };
  toolbar.append(
    createSearchInput(options.searchPlaceholder, options.query, (query) => {
      options.onQuery(query);
      fillList(query);
    }),
    addInput,
    addButton,
  );
  fillList(options.query);
  return { toolbar, list, addInput, addButton };
}

export function createStackField(labelText: string, control: HTMLElement): HTMLLabelElement {
  const wrapper = document.createElement("label");
  wrapper.className = "settings-stack-field";

  const label = document.createElement("span");
  label.textContent = labelText;

  wrapper.append(label, control);
  return wrapper;
}

export function bindControlEvents(
  control: ControlEventTarget | undefined,
  events: Array<["action" | "change", () => void]>,
): void {
  if (!control?.addEvent) {
    return;
  }

  for (const [type, handler] of events) {
    control.addEvent(type, handler);
  }
}

export function bindRerender(
  control: ControlEventTarget | undefined,
  render: () => void | Promise<void>,
): void {
  // A value-only control fires "change" and then "action" for one set ("change" only when the
  // set is silent). Other controls fire only "action". Render one time for each set.
  let renderedOnChange = false;
  bindControlEvents(control, [
    [
      "change",
      () => {
        renderedOnChange = true;
        void render();
      },
    ],
    [
      "action",
      () => {
        if (renderedOnChange) {
          renderedOnChange = false;
          return;
        }
        void render();
      },
    ],
  ]);
}

/** Replaces the children of root and keeps each <details> open or closed as it was before. */
export function replaceChildrenKeepingDisclosures(root: HTMLElement, content: HTMLElement): void {
  const openStates = Array.from(root.querySelectorAll("details"), (details) => details.open);
  content.querySelectorAll("details").forEach((details, index) => {
    details.open = openStates[index] ?? details.open;
  });
  root.replaceChildren(content);
}

export function moveControlToBody(
  registry: SettingsRegistry,
  key: string,
  destination: HTMLElement,
): void {
  const control = registry[key];
  if (!control?.rootElement) {
    return;
  }
  destination.appendChild(control.rootElement);
}

export function pruneEmptySettingsGroups(panelRoot: HTMLElement): void {
  const tabRoot = panelRoot.closest(".content-tab");
  if (!tabRoot) {
    return;
  }

  tabRoot.querySelectorAll<HTMLElement>(".settings-group").forEach((group) => {
    const body = group.querySelector<HTMLElement>(".settings-group-body");
    group.classList.toggle("is-empty-workspace-group", !body || body.children.length === 0);
  });
}
