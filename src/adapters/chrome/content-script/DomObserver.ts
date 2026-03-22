import { SHADOW_ATTACH_MARKER_ATTR } from "./ShadowRootInterceptor";

/**
 * Wraps a MutationObserver around a single root node and forwards only
 * non-empty mutation batches to the runtime callback.
 */
export class DomObserver {
  private observer: MutationObserver | null = null;
  private node: Node;
  private readonly callback: (mutationsList: MutationRecord[]) => void;

  constructor(node: Node, callback: (mutationsList: MutationRecord[]) => void) {
    this.node = node;
    this.callback = callback;
  }

  attach(): void {
    if (!this.observer) {
      this.observer = new MutationObserver((mutationsList) => {
        if (mutationsList.length > 0) {
          this.callback(mutationsList);
        }
      });
    }
    this.observer.observe(this.node, {
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
        "autocomplete",
        "aria-autocomplete",
        "aria-expanded",
        "aria-controls",
        "aria-owns",
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
    if (this.observer) {
      this.observer.disconnect();
    }
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
