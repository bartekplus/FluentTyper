import { detectReviewDiagnostics } from "./reviewDiagnostics";
import { diffTexts, remapRange } from "./textRanges";
import type { ReviewCheckId, ReviewDiagnostic, ReviewMessageKey, ReviewOptions } from "./types";

/** How much text before the caret a typing-time check reads. */
export const LIVE_PROPOSAL_WINDOW_CHARS = 500;
const WORD_CHAR = /[\p{L}\p{N}\p{M}_'’-]/u;

/** A Review finding offered while typing: shown, never applied without the user. */
export interface LiveGrammarProposal {
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

/** Proposals already seen, as spans of the text they were found in. */
export interface SeenLiveProposals {
  text: string;
  spans: LiveGrammarProposal[];
}

/** The same fix for the same span of the same text. */
export function sameLiveProposal(a: LiveGrammarProposal, b: LiveGrammarProposal): boolean {
  return (
    a.start === b.start &&
    a.end === b.end &&
    a.ruleId === b.ruleId &&
    a.replacement === b.replacement
  );
}

/**
 * The newest proposal not seen before, nearest the caret. Seen spans follow
 * edits elsewhere in `beforeCursor`; an edit touching one forgets it. Every
 * current proposal is then marked seen, so a finding that was shown (or that
 * already existed) is never offered again for the same span.
 */
export function nextLiveGrammarProposal(
  proposals: readonly LiveGrammarProposal[],
  beforeCursor: string,
  seen: SeenLiveProposals,
): LiveGrammarProposal | null {
  const diff = diffTexts(seen.text, beforeCursor);
  if (diff) {
    seen.spans = seen.spans.flatMap((span) => {
      const range = remapRange(span, diff);
      return range ? [{ ...span, ...range }] : [];
    });
  }
  seen.text = beforeCursor;
  const fresh = proposals.filter((p) => !seen.spans.some((span) => sameLiveProposal(span, p)));
  seen.spans.push(...fresh);
  return fresh.at(-1) ?? null;
}
