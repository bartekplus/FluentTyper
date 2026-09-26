import type { ReviewDiagnostic, ReviewEdit } from "./types";
import { applyEdits, editTouches, rangesOverlap } from "./textRanges";

type DeferReason = "not-batch-approved" | "conflict" | "unproven";

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
  /**
   * Proof hook for context-dependent groups: for each checked diagnostic, true
   * when it is still detected, with the same edits, in the text after
   * `otherEdits` are applied. `otherEdits` never contain or collide with a
   * checked diagnostic's own edits.
   */
  stillHold?: (checks: ReviewDiagnostic[], otherEdits: ReviewEdit[]) => boolean[];
}

/**
 * One proof round: true, per check, when it is still detected with the same
 * edits after `otherEdits` (never its own) are applied.
 */
export interface ProofRequest {
  checks: ReviewDiagnostic[];
  otherEdits: ReviewEdit[];
}

/** Longer chains of dependent fixes are left for individual review. */
export const MAX_PROOF_GROUP = 8;

function sameEdit(a: ReviewEdit, b: ReviewEdit): boolean {
  return a.start === b.start && a.end === b.end && a.replacement === b.replacement;
}

/** Overlap, a shared insertion point, or an insertion inside the other edit. */
function editsCollide(a: ReviewEdit, b: ReviewEdit): boolean {
  return a.start === a.end ? editTouches(a, b) : editTouches(b, a);
}

function touchesContext(edit: ReviewEdit, diagnostic: ReviewDiagnostic): boolean {
  return rangesOverlap(edit, diagnostic.context);
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
 *   such a group is kept only when `stillHold` proves each member is still
 *   detected unchanged after all the others are applied, and deferred otherwise.
 */
export function planBulkFix(
  text: string,
  diagnostics: readonly ReviewDiagnostic[],
  options: BulkPlanOptions = {},
): BulkPlan {
  const steps = planBulkFixSteps(text, diagnostics, {
    ...options,
    prove: options.stillHold !== undefined,
  });
  for (let step = steps.next(); ;) {
    if (step.done) return step.value;
    step = steps.next(options.stillHold!(step.value.checks, step.value.otherEdits));
  }
}

/** The plan as a sequence of proof requests; the caller answers each round. */
export function* planBulkFixSteps(
  text: string,
  diagnostics: readonly ReviewDiagnostic[],
  options: Omit<BulkPlanOptions, "stillHold"> & { prove: boolean },
): Generator<ProofRequest, BulkPlan, boolean[]> {
  const deferred: BulkPlan["deferred"] = [];
  const candidates: Array<{ diagnostic: ReviewDiagnostic; edits: ReviewEdit[] }> = [];
  for (const diagnostic of diagnostics) {
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

  // Only candidates whose spans (edits and evidence) overlap or touch can
  // collide or depend on each other: sweep in span order instead of all pairs.
  const spans = candidates.map((candidate, index) => ({
    index,
    start: Math.min(candidate.diagnostic.context.start, ...candidate.edits.map((e) => e.start)),
    end: Math.max(candidate.diagnostic.context.end, ...candidate.edits.map((e) => e.end)),
  }));
  spans.sort((a, b) => a.start - b.start || a.index - b.index);
  for (let x = 0; x < spans.length; x += 1) {
    for (let y = x + 1; y < spans.length && spans[y].start <= spans[x].end; y += 1) {
      const i = Math.min(spans[x].index, spans[y].index);
      const j = Math.max(spans[x].index, spans[y].index);
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
        if (collide) {
          hard.add(i);
          hard.add(j);
        }
      }
    }
  }

  const groups = new Map<number, number[]>();
  candidates.forEach((_, index) => {
    const root = find(index);
    const members = groups.get(root);
    if (members) members.push(index);
    else groups.set(root, [index]);
  });

  const accepted: number[] = [];
  const linked: number[][] = [];
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
    if (options.prove && members.length <= MAX_PROOF_GROUP) {
      linked.push(members);
    } else {
      members.forEach((index) =>
        deferred.push({ id: candidates[index].diagnostic.id, reason: "unproven" }),
      );
    }
  }
  const proven = options.prove ? yield* proveGroups(candidates, linked) : [];
  linked.forEach((members, group) => {
    if (proven[group]) {
      accepted.push(...members);
    } else {
      members.forEach((index) =>
        deferred.push({ id: candidates[index].diagnostic.id, reason: "unproven" }),
      );
    }
  });

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

/**
 * Proves each context-linked group: every member must still be detected, with
 * the same edits, after the other members' edits. Round k checks member k of
 * every group at once; different groups never collide, so a round shares one
 * text. A round where one group would pre-apply another group's checked fix
 * (an identical edit) falls back to checking those groups one by one.
 */
function* proveGroups(
  candidates: ReadonlyArray<{ diagnostic: ReviewDiagnostic; edits: ReviewEdit[] }>,
  groups: readonly number[][],
): Generator<ProofRequest, boolean[], boolean[]> {
  const proven = groups.map(() => true);
  const rounds = Math.max(0, ...groups.map((members) => members.length));
  for (let round = 0; round < rounds; round += 1) {
    const checks: Array<{ group: number; own: ReviewEdit[]; others: ReviewEdit[] }> = [];
    groups.forEach((members, group) => {
      if (!proven[group] || round >= members.length) return;
      const own = candidates[members[round]].edits;
      const others = members
        .filter((index) => index !== members[round])
        .flatMap((index) => candidates[index].edits)
        .filter((edit) => !own.some((mine) => sameEdit(mine, edit)));
      checks.push({ group, own, others });
    });
    if (checks.length === 0) break;
    const others = dedupe(checks.flatMap((check) => check.others));
    const otherKeys = new Set(others.map(editKey));
    const clash = checks.some((check) => check.own.some((mine) => otherKeys.has(editKey(mine))));
    let results: boolean[];
    if (clash) {
      results = [];
      for (const check of checks) {
        const [result] = yield {
          checks: [candidates[groups[check.group][round]].diagnostic],
          otherEdits: dedupe(check.others),
        };
        results.push(result);
      }
    } else {
      results = yield {
        checks: checks.map((check) => candidates[groups[check.group][round]].diagnostic),
        otherEdits: others,
      };
    }
    checks.forEach((check, index) => {
      if (results[index] !== true) proven[check.group] = false;
    });
  }
  return proven;
}

function editKey(edit: ReviewEdit): string {
  return `${edit.start}:${edit.end}:${edit.replacement}`;
}

function dedupe(edits: ReviewEdit[]): ReviewEdit[] {
  const unique = new Map<string, ReviewEdit>();
  for (const edit of edits) {
    const key = editKey(edit);
    if (!unique.has(key)) unique.set(key, edit);
  }
  return [...unique.values()];
}
