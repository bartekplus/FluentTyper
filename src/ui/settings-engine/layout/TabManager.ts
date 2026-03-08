export interface TabBundle {
  tabLi: HTMLLIElement;
  tabA: HTMLAnchorElement;
  content: HTMLDivElement;
  activate(): void;
  deactivate(): void;
}

export class TabManager {
  private readonly tabContainer: HTMLElement;
  private readonly contentContainer: HTMLElement;
  private activeBundle: TabBundle | null = null;

  constructor(tabContainer: HTMLElement, contentContainer: HTMLElement) {
    this.tabContainer = tabContainer;
    this.contentContainer = contentContainer;
  }

  create(config: {
    id: string;
    label: string;
    shortDescription?: string;
    icon?: string;
  }): TabBundle {
    const tabA = document.createElement("a");
    tabA.href = `#${config.id}`;
    tabA.className = "settings-nav-link";
    tabA.title = config.shortDescription
      ? `${config.label}: ${config.shortDescription}`
      : config.label;
    const tabLi = document.createElement("li");
    tabLi.appendChild(tabA);

    const content = document.createElement("div");
    content.className = "content-tab options-tab-content";

    const icon = document.createElement("span");
    icon.className = "settings-nav-icon";
    icon.textContent = config.icon || config.label.slice(0, 1);

    const copy = document.createElement("span");
    copy.className = "settings-nav-copy";
    const title = document.createElement("span");
    title.className = "settings-nav-title";
    title.textContent = config.label;
    copy.appendChild(title);

    if (config.shortDescription) {
      const description = document.createElement("span");
      description.className = "settings-nav-description";
      description.textContent = config.shortDescription;
      copy.appendChild(description);
    }

    tabA.appendChild(icon);
    tabA.appendChild(copy);

    this.tabContainer.appendChild(tabLi);
    this.contentContainer.appendChild(content);

    content.classList.add("is-hidden");

    const bundle: TabBundle = {
      tabLi,
      tabA,
      content,
      activate: () => {
        if (this.activeBundle && this.activeBundle !== bundle) {
          this.activeBundle.deactivate();
        }
        tabLi.classList.add("is-active");
        content.classList.add("is-active");
        content.classList.remove("is-hidden");
        this.activeBundle = bundle;
      },
      deactivate: () => {
        tabLi.classList.remove("is-active");
        content.classList.remove("is-active");
        content.classList.add("is-hidden");
        this.activeBundle = null;
      },
    };

    tabA.addEventListener("click", (e) => {
      e.preventDefault();
      bundle.activate();
    });

    // Auto-activate the first tab
    if (!this.activeBundle) {
      bundle.activate();
    }

    return bundle;
  }
}
