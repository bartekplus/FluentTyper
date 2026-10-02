import { isInDocument } from "@core/application/dom-utils";

const OWN_UI = "[data-ft-suggestion-owned], [data-fluenttyper-review]";

type MutationPlan =
  | {
      type: "noop";
    }
  | {
      type: "full-scan";
    }
  | {
      type: "targeted-scan";
      roots: Element[];
    };

export class MutationPipeline {
  constructor(
    private readonly maxMutationBatchSize: number,
    private readonly maxMutationRoots: number,
  ) {}

  buildPlan(mutationsList: MutationRecord[]): MutationPlan {
    if (mutationsList.length === 0) {
      return { type: "noop" };
    }

    // FT-INV-2: typing-only records cannot discover a new editable element.
    mutationsList = mutationsList.filter(
      (mutation) =>
        !(mutation.target instanceof Element && mutation.target.closest(OWN_UI)) &&
        (mutation.type === "attributes" ||
          (mutation.type === "childList" &&
            [...mutation.addedNodes].some(
              (node) => node instanceof Element && !node.closest(OWN_UI),
            ))),
    );
    if (mutationsList.length >= this.maxMutationBatchSize) {
      return { type: "full-scan" };
    }

    const roots = this.collectMutationRoots(mutationsList);
    if (roots.length === 0) {
      return { type: "noop" };
    }

    if (roots.length >= this.maxMutationRoots) {
      return { type: "full-scan" };
    }

    return {
      type: "targeted-scan",
      roots,
    };
  }

  private collectMutationRoots(mutationsList: MutationRecord[]): Element[] {
    const candidates: Element[] = [];
    const addCandidate = (node: Node | null | undefined): void => {
      if (node instanceof Element && isInDocument(node) && !node.closest(OWN_UI)) {
        candidates.push(node);
      }
    };

    for (const mutation of mutationsList) {
      mutation.addedNodes.forEach(addCandidate);
      if (mutation.type === "attributes") {
        addCandidate(mutation.target);
      }
    }

    const uniqueCandidates = Array.from(new Set(candidates));
    uniqueCandidates.sort(
      (left, right) => this.getElementDepth(left) - this.getElementDepth(right),
    );

    const roots: Element[] = [];
    for (const candidate of uniqueCandidates) {
      if (roots.some((root) => root === candidate || root.contains(candidate))) {
        continue;
      }
      for (let i = roots.length - 1; i >= 0; i -= 1) {
        if (candidate.contains(roots[i])) {
          roots.splice(i, 1);
        }
      }
      roots.push(candidate);
    }
    return roots;
  }

  private getElementDepth(element: Element): number {
    let depth = 0;
    let currentNode: Node | null = element;
    while (currentNode.parentNode) {
      depth += 1;
      currentNode = currentNode.parentNode;
    }
    return depth;
  }
}
