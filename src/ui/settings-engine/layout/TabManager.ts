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

  create(): TabBundle {
    const tabA = document.createElement("a");
    const tabLi = document.createElement("li");
    tabLi.appendChild(tabA);

    const content = document.createElement("div");
    content.className = "content-tab";

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
