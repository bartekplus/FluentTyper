import type { SettingsRegistry } from "@ui/settings-engine/SettingsEngine.js";

type ControlEventTarget = {
  addEvent?: (type: string, fn: () => void) => void;
};

export function createWorkspaceShell(className = "workspace-panel-stack"): HTMLDivElement {
  const shell = document.createElement("div");
  shell.className = className;
  return shell;
}

export function createWorkspaceGrid(className: "workspace-top-grid" | "workspace-main-grid") {
  const grid = document.createElement("div");
  grid.className = className;
  return grid;
}

export function createWorkspaceCard(titleText?: string, bodyText?: string) {
  const card = document.createElement("section");
  card.className = "settings-inline-card workspace-section-card";

  if (titleText) {
    const title = document.createElement("h4");
    title.textContent = titleText;
    card.appendChild(title);
  }

  if (bodyText) {
    const copy = document.createElement("p");
    copy.className = "settings-inline-help";
    copy.textContent = bodyText;
    card.appendChild(copy);
  }

  const body = document.createElement("div");
  body.className = "workspace-section-body";
  card.appendChild(body);

  return { card, body };
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
  bindControlEvents(control, [
    ["action", () => void render()],
    ["change", () => void render()],
  ]);
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
