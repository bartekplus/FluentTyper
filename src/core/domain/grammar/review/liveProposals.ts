import { detectReviewDiagnostics } from "./reviewDiagnostics";
import type { ReviewCheckId, ReviewDiagnostic, ReviewMessageKey, ReviewOptions } from "./types";

/** How much text before the caret a typing-time check reads. */
export const LIVE_PROPOSAL_WINDOW_CHARS = 500;
// Text before a finding that identifies it while later text changes.
const KEY_PREFIX_CHARS = 32;
const WORD_CHAR = /[\p{L}\p{N}\p{M}_'’-]/u;

/** A Review finding offered while typing: shown, never applied without the user. */
export interface LiveGrammarProposal {
  /** Same text span and fix, wherever it moves: what "already seen" is keyed on. */
  key: string;
  ruleId: ReviewCheckId;
  messageKey: ReviewMessageKey;
  /** Offsets into the `beforeCursor` it was found in. */
  start: number;
  end: number;
  original: string;
  replacement: string;
}

export interface LiveProposalOptions extends Omit<ReviewOptions, "spellingEnabled"> {
  /** Typing rules that are on: what they correct themselves is not proposed again. */
  liveRules: readonly string[];
}

/**
 * Proposals only for fixes Review applies one at a time (never the batch-safe ones
 * typing rules mirror), with exactly one replacement and no dictionary word.
 */
function isProposable(diagnostic: ReviewDiagnostic, liveRules: ReadonlySet<string>): boolean {
  if (
    diagnostic.bulk.eligible ||
    diagnostic.warningOnly ||
    diagnostic.requiresChoice ||
    diagnostic.dictionaryWord ||
    diagnostic.alternatives.length !== 1
  ) {
    return false;
  }
  // A typing rule Review only ever applies singly (line-break capitals, units) runs live already.
  return !(
    liveRules.has(diagnostic.ruleId) && diagnostic.bulk.reason === "rule-not-batch-approved"
  );
}

/**
 * Native Review checks over the text before the caret (at most the last
 * LIVE_PROPOSAL_WINDOW_CHARS), keeping findings that end before the word at the
 * caret. Ordered by position; the last one is nearest the caret.
 */
export function findLiveGrammarProposals(
  beforeCursor: string,
  options: LiveProposalOptions,
): LiveGrammarProposal[] {
  if (options.enabledRules.length === 0 || beforeCursor.trim().length === 0) return [];
  const offset = Math.max(0, beforeCursor.length - LIVE_PROPOSAL_WINDOW_CHARS);
  const text = beforeCursor.slice(offset);
  // A cut window starts mid-word: that partial word is not read as a word.
  const scopeStart = offset === 0 ? 0 : text.search(/\s/) + 1;
  if (scopeStart <= 0 && offset > 0) return [];
  const { liveRules, ...reviewOptions } = options;
  const live = new Set(liveRules);
  const { diagnostics } = detectReviewDiagnostics(
    {
      id: "live",
      text,
      scope: { start: scopeStart, end: text.length },
      protectedRanges:
        offset === 0 ? [] : [{ start: 0, end: scopeStart, reason: "outside-window" }],
    },
    { ...reviewOptions, spellingEnabled: false },
  );
  return diagnostics.flatMap((diagnostic) => {
    const start = offset + diagnostic.range.start;
    const end = offset + diagnostic.range.end;
    // The word being typed may still change; so may a finding that reaches it.
    if (!isProposable(diagnostic, live) || end >= beforeCursor.length) return [];
    if (WORD_CHAR.test(beforeCursor[end])) return [];
    const replacement = diagnostic.alternatives[0].preview;
    return [
      {
        key: [
          diagnostic.ruleId,
          beforeCursor.slice(Math.max(0, start - KEY_PREFIX_CHARS), start),
          diagnostic.original,
          replacement,
        ].join("\u0000"),
        ruleId: diagnostic.ruleId,
        messageKey: diagnostic.messageKey,
        start,
        end,
        original: diagnostic.original,
        replacement,
      },
    ];
  });
}

/**
 * The newest proposal not seen before, nearest the caret. Every current key is
 * marked seen, so a finding that was shown (or that already existed) is never
 * offered again for the same span.
 */
export function nextLiveGrammarProposal(
  proposals: readonly LiveGrammarProposal[],
  seen: Set<string>,
): LiveGrammarProposal | null {
  const fresh = proposals.filter((proposal) => !seen.has(proposal.key));
  proposals.forEach((proposal) => seen.add(proposal.key));
  return fresh.at(-1) ?? null;
}
