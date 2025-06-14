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
        setTimeout(() => this.callback(mutationsList), 0);
      });
    }
    this.observer.observe(this.node, {
      childList: true,
      attributes: true,
      attributeFilter: ["contenteditable", "type", "name", "id"],
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
