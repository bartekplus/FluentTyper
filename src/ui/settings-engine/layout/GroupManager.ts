export interface GroupBundle {
  content: HTMLDivElement;
}

export function createGroup(tabContent: HTMLElement, label: string): GroupBundle {
  const groupDiv = document.createElement("div");
  groupDiv.className = "settings-group";

  const divider = document.createElement("div");
  divider.className = "divider settings-group-title";
  divider.innerText = label;
  groupDiv.appendChild(divider);

  tabContent.appendChild(groupDiv);

  return { content: groupDiv };
}
