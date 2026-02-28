import { isInDocument } from "@core/application/utils";

export type MutationPlan =
  | {
      type: "noop";
    }
  | {
      type: "full-scan";
      reason: "large-batch" | "too-many-roots";
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

    if (mutationsList.length >= this.maxMutationBatchSize) {
      return {
        type: "full-scan",
        reason: "large-batch",
      };
    }

    const roots = this.collectMutationRoots(mutationsList);
    if (roots.length === 0) {
      return { type: "noop" };
    }

    if (roots.length >= this.maxMutationRoots) {
      return {
        type: "full-scan",
        reason: "too-many-roots",
      };
    }

    return {
      type: "targeted-scan",
      roots,
    };
  }

  private collectMutationRoots(mutationsList: MutationRecord[]): Element[] {
    const candidates: Element[] = [];
    for (const mutation of mutationsList) {
      mutation.addedNodes.forEach((node) => {
        if (node instanceof Element && isInDocument(node)) {
          candidates.push(node);
        }
      });
      if (
        mutation.type === "attributes" &&
        mutation.target instanceof Element &&
        isInDocument(mutation.target)
      ) {
        candidates.push(mutation.target);
      }
    }

    if (candidates.length === 0) {
      return [];
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
