export interface GroupBundle {
  content: HTMLDivElement;
}

export function createGroup(tabContent: HTMLElement, label: string): GroupBundle {
  const groupDiv = document.createElement("section");
  groupDiv.className = "settings-group";

  const header = document.createElement("div");
  header.className = "settings-group-header";
  const title = document.createElement("h3");
  title.className = "settings-group-title divider";
  title.textContent = label;
  header.appendChild(title);
  groupDiv.appendChild(header);

  const body = document.createElement("div");
  body.className = "settings-group-body";
  groupDiv.appendChild(body);

  tabContent.appendChild(groupDiv);

  return { content: body };
}
