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
  constructor(private readonly maxMutationRoots: number) {}

  buildPlan(mutationsList: MutationRecord[]): MutationPlan {
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

    const unique = Array.from(new Set(candidates));
    return unique.filter(
      (candidate) => !unique.some((other) => other !== candidate && other.contains(candidate)),
    );
  }
}
