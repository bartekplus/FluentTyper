import { detectReviewDiagnostics } from "./reviewDiagnostics";
import { reviewExplanation } from "./reviewExplanations";
import {
  LIVE_PROPOSAL_WINDOW_CHARS,
  type LiveGrammarProposal,
  type LiveProposalOptions,
} from "./liveProposalSelection";
import type { ReviewDiagnostic } from "./types";

const WORD_CHAR = /[\p{L}\p{N}\p{M}_'’-]/u;

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
 * caret. Ordered by position; the last one is nearest the caret. Explanations
 * are in the UI language `uiLanguage`.
 */
export function findLiveGrammarProposals(
  beforeCursor: string,
  options: LiveProposalOptions,
  uiLanguage = "en",
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
        explanation: reviewExplanation(diagnostic.messageKey, uiLanguage),
      },
    ];
  });
}
