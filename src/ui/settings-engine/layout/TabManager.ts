interface TabBundle {
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

  create(config: { id: string; label: string; shortDescription?: string }): TabBundle {
    const tabA = document.createElement("a");
    tabA.href = `#${config.id}`;
    tabA.className = "settings-nav-link";
    tabA.textContent = config.label;
    const tabLi = document.createElement("li");
    tabLi.appendChild(tabA);

    const content = document.createElement("div");
    content.className = "content-tab options-tab-content";

    this.tabContainer.appendChild(tabLi);
    this.contentContainer.appendChild(content);

    content.classList.add("is-hidden");
    const setActiveState = (active: boolean): void => {
      tabLi.classList.toggle("is-active", active);
      content.classList.toggle("is-active", active);
      content.classList.toggle("is-hidden", !active);
    };

    const bundle: TabBundle = {
      tabLi,
      tabA,
      content,
      activate: () => {
        if (this.activeBundle && this.activeBundle !== bundle) {
          this.activeBundle.deactivate();
        }
        setActiveState(true);
        this.activeBundle = bundle;
      },
      deactivate: () => {
        setActiveState(false);
        this.activeBundle = null;
      },
    };

    if (!this.activeBundle) {
      bundle.activate();
    }

    return bundle;
  }
}
