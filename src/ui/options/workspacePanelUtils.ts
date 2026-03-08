import type { SettingsRegistry } from "@ui/settings-engine/SettingsEngine.js";

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
