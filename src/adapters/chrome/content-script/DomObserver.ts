import { SHADOW_ATTACH_MARKER_ATTR } from "./ShadowRootInterceptor";

/**
 * DomObserver class encapsulates MutationObserver logic for DOM changes.
 * It notifies a callback when relevant mutations occur.
 */
export class DomObserver {
  private observer: MutationObserver | null = null;
  private node: Node;
  private callback: (mutationsList: MutationRecord[]) => void;

  constructor(node: Node, callback: (mutationsList: MutationRecord[]) => void) {
    this.node = node;
    this.callback = callback;
  }

  attach() {
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

  disconnect() {
    if (this.observer) {
      this.observer.disconnect();
    }
  }

  setNode(node: Node) {
    this.node = node;
    if (this.observer) {
      this.disconnect();
      this.attach();
    }
  }

  getNode() {
    return this.node;
  }
}
