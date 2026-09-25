import type { ReviewCategory, ReviewDiagnostic, ReviewEdit } from "./types";
import { applyEdits, rangesOverlap } from "./textRanges";

export type DeferReason = "not-batch-approved" | "conflict" | "unproven";

export interface BulkPlan {
  /** Diagnostics whose chosen fix is in the plan. */
  diagnosticIds: string[];
  /** Deduplicated edits, descending by position, none overlapping. */
  edits: ReviewEdit[];
  /** The snapshot text after every planned edit. */
  expectedText: string;
  /** Eligible-looking or ineligible diagnostics left for individual review. */
  deferred: Array<{ id: string; reason: DeferReason }>;
}

export interface BulkPlanOptions {
  /** Diagnostics the user ignored in this session. */
  ignored?: ReadonlySet<string>;
  /** When set, only these categories are planned (the visible filter). */
  categories?: ReadonlySet<ReviewCategory>;
  /**
   * Proof hook for context-dependent groups: true when `diagnostic` is still
   * detected, with the same edits, in the text after `otherEdits` are applied.
   */
  stillHolds?: (diagnostic: ReviewDiagnostic, otherEdits: ReviewEdit[]) => boolean;
}

function sameEdit(a: ReviewEdit, b: ReviewEdit): boolean {
  return a.start === b.start && a.end === b.end && a.replacement === b.replacement;
}

/** Overlap, a shared insertion point, or an insertion inside the other edit. */
function editsCollide(a: ReviewEdit, b: ReviewEdit): boolean {
  if (a.start === a.end || b.start === b.end) {
    const insertion = a.start === a.end ? a : b;
    const other = insertion === a ? b : a;
    return insertion.start >= other.start && insertion.start <= other.end;
  }
  return rangesOverlap(a, b);
}

function touchesContext(edit: ReviewEdit, diagnostic: ReviewDiagnostic): boolean {
  const { context } = diagnostic;
  return edit.start < context.end && edit.end > context.start;
}

/**
 * Plans "Fix all safe" from ONE immutable snapshot.
 *
 * - Only diagnostics with an explicit bulk decision are candidates; the chosen
 *   alternative is the one that decision names (never "the first one").
 * - Identical edits proposed by several findings are applied once.
 * - Colliding edits (overlap, shared insertion point) defer every finding in
 *   the colliding group: no winner is picked by position.
 * - An edit inside another finding's evidence makes the pair context-dependent;
 *   such a group is kept only when `stillHolds` proves each member is still
 *   detected unchanged after all the others are applied, and deferred otherwise.
 */
export function planBulkFix(
  text: string,
  diagnostics: readonly ReviewDiagnostic[],
  options: BulkPlanOptions = {},
): BulkPlan {
  const deferred: BulkPlan["deferred"] = [];
  const candidates: Array<{ diagnostic: ReviewDiagnostic; edits: ReviewEdit[] }> = [];
  for (const diagnostic of diagnostics) {
    if (options.ignored?.has(diagnostic.id)) continue;
    if (options.categories && !options.categories.has(diagnostic.category)) continue;
    if (!diagnostic.bulk.eligible) {
      deferred.push({ id: diagnostic.id, reason: "not-batch-approved" });
      continue;
    }
    const alternative = diagnostic.alternatives[diagnostic.bulk.alternative];
    if (!alternative) {
      deferred.push({ id: diagnostic.id, reason: "not-batch-approved" });
      continue;
    }
    candidates.push({ diagnostic, edits: alternative.edits });
  }

  // Union-find over candidate indices.
  const parent = candidates.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };
  const hard = new Set<number>();
  const soft = new Set<number>();

  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const a = candidates[i];
      const b = candidates[j];
      let collide = false;
      let dependent = false;
      for (const editA of a.edits) {
        for (const editB of b.edits) {
          if (sameEdit(editA, editB)) continue;
          if (editsCollide(editA, editB)) collide = true;
        }
      }
      if (!collide) {
        const own = (edit: ReviewEdit, other: ReviewEdit[]) =>
          other.some((mine) => sameEdit(mine, edit));
        dependent =
          b.edits.some((edit) => !own(edit, a.edits) && touchesContext(edit, a.diagnostic)) ||
          a.edits.some((edit) => !own(edit, b.edits) && touchesContext(edit, b.diagnostic));
      }
      if (collide || dependent) {
        union(i, j);
        (collide ? hard : soft).add(i);
        (collide ? hard : soft).add(j);
      }
    }
  }

  const groups = new Map<number, number[]>();
  candidates.forEach((_, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), index]);
  });

  const accepted: number[] = [];
  for (const members of groups.values()) {
    if (members.length === 1) {
      accepted.push(members[0]);
      continue;
    }
    if (members.some((index) => hard.has(index))) {
      members.forEach((index) =>
        deferred.push({ id: candidates[index].diagnostic.id, reason: "conflict" }),
      );
      continue;
    }
    const proven =
      options.stillHolds !== undefined &&
      members.every((index) => {
        const mine = candidates[index].edits;
        const others = dedupe(
          members
            .filter((other) => other !== index)
            .flatMap((other) => candidates[other].edits)
            .filter((edit) => !mine.some((own) => sameEdit(own, edit))),
        );
        return options.stillHolds!(candidates[index].diagnostic, others);
      });
    if (proven) {
      accepted.push(...members);
    } else {
      members.forEach((index) =>
        deferred.push({ id: candidates[index].diagnostic.id, reason: "unproven" }),
      );
    }
  }

  accepted.sort((a, b) => a - b);
  const edits = dedupe(accepted.flatMap((index) => candidates[index].edits)).sort(
    (a, b) => b.start - a.start || b.end - a.end,
  );
  const expectedText = applyEdits(text, edits);
  if (expectedText === null) {
    // Cannot happen after the collision check; refuse rather than guess.
    return {
      diagnosticIds: [],
      edits: [],
      expectedText: text,
      deferred: [
        ...deferred,
        ...accepted.map((index) => ({
          id: candidates[index].diagnostic.id,
          reason: "conflict" as const,
        })),
      ],
    };
  }
  return {
    diagnosticIds: accepted.map((index) => candidates[index].diagnostic.id),
    edits,
    expectedText,
    deferred,
  };
}

function dedupe(edits: ReviewEdit[]): ReviewEdit[] {
  const unique: ReviewEdit[] = [];
  for (const edit of edits) {
    if (!unique.some((existing) => sameEdit(existing, edit))) unique.push(edit);
  }
  return unique;
}
