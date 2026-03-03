export class InlineSuggestionView {
  static readonly CLASS_NAME = "tribute-inline";

  static removeAll(doc: Document = document): void {
    const nodes = doc.querySelectorAll(`.${InlineSuggestionView.CLASS_NAME}, .suggestion-inline`);
    nodes.forEach((node) => node.remove());
  }
}
