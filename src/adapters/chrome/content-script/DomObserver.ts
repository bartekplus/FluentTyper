import { SHADOW_ATTACH_MARKER_ATTR } from "./ShadowRootInterceptor";

export class DomObserver {
  private observer: MutationObserver | null = null;

  constructor(
    private node: Node,
    private readonly callback: (mutationsList: MutationRecord[]) => void,
  ) {}

  attach(): void {
    if (!this.observer) {
      this.observer = new MutationObserver((mutationsList) => this.callback(mutationsList));
    }
    this.observer.observe(this.node, {
      // Do not observe text changes: MutationPipeline drops characterData records (FT-INV-2).
      childList: true,
      attributes: true,
      // Include visibility-related and interactivity-related attributes so state
      // transitions (hidden↔visible, disabled↔enabled, readonly↔editable) trigger rescans.
      attributeFilter: [
        "contenteditable",
        "type",
        "name",
        "id",
        "list",
        "role",
        "data-qa",
        "autocomplete",
        "aria-autocomplete",
        "aria-expanded",
        "aria-controls",
        "aria-owns",
        "aria-activedescendant",
        "aria-hidden",
        "aria-disabled",
        "aria-busy",
        "aria-readonly",
        "aria-multiline",
        "aria-haspopup",
        "inputmode",
        "value",
        "inert",
        "style",
        "class",
        "hidden",
        "disabled",
        "readonly",
        SHADOW_ATTACH_MARKER_ATTR,
      ],
      subtree: true,
    });
  }

  disconnect(): void {
    this.observer?.disconnect();
  }

  setNode(node: Node): void {
    this.node = node;
    if (this.observer) {
      this.disconnect();
      this.attach();
    }
  }

  getNode(): Node {
    return this.node;
  }
}
