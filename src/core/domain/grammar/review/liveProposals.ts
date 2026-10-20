import { ENGLISH_EXPLANATIONS } from "./englishExplanations";
import { finalizeReview, prepareReview, reviewChunks, scanReviewChunk } from "./reviewDiagnostics";
import { spellingCandidates, type SpellingCandidate } from "./reviewSpelling";
import {
  LIVE_PROPOSAL_WINDOW_CHARS,
  type LiveGrammarProposal,
  type LiveProposalOptions,
} from "./liveProposalSelection";
import type { ReviewDiagnostic, ReviewMessageKey } from "./types";

const WORD_CHAR = /[\p{L}\p{N}\p{M}_'’-]/u;
// After the last finished word: a separator, then at most the word being typed.
const AFTER_LAST_WORD = /^[^\p{L}\p{N}\p{M}_'’-]+[\p{L}\p{N}\p{M}_'’-]*$/u;

/**
 * Proposals only for fixes Review applies one at a time (never the batch-safe ones
 * typing rules mirror), with exactly one replacement and no dictionary word. Style
 * advice stays in Review.
 */
function isProposable(diagnostic: ReviewDiagnostic, liveRules: ReadonlySet<string>): boolean {
  if (
    diagnostic.category === "style" ||
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
 * caret. Ordered by position; the last one is nearest the caret. `explain`
 * gives each finding's explanation (English by default).
 */
export function findLiveGrammarProposals(
  beforeCursor: string,
  options: LiveProposalOptions,
  explain = (key: ReviewMessageKey): string => ENGLISH_EXPLANATIONS[key] ?? "",
): LiveGrammarProposal[] {
  return findLiveProposals(beforeCursor, options, explain).proposals;
}

/**
 * findLiveGrammarProposals, and the last finished word before the caret if the
 * dictionary check would look it up (offsets into `beforeCursor`): its top
 * candidate can be offered too, once the dictionary says it is unknown.
 */
export function findLiveProposals(
  beforeCursor: string,
  options: LiveProposalOptions,
  explain = (key: ReviewMessageKey): string => ENGLISH_EXPLANATIONS[key] ?? "",
): { proposals: LiveGrammarProposal[]; spelling: SpellingCandidate | null } {
  const none = { proposals: [], spelling: null };
  if (options.enabledRules.length === 0 || beforeCursor.trim().length === 0) return none;
  const offset = Math.max(0, beforeCursor.length - LIVE_PROPOSAL_WINDOW_CHARS);
  const text = beforeCursor.slice(offset);
  // A cut window starts mid-word: that partial word is not read as a word.
  const scopeStart = offset === 0 ? 0 : text.search(/\s/) + 1;
  if (scopeStart <= 0 && offset > 0) return none;
  const { liveRules, ...reviewOptions } = options;
  const live = new Set(liveRules);
  const prepared = prepareReview(
    {
      id: "live",
      text,
      scope: { start: scopeStart, end: text.length },
      protectedRanges:
        offset === 0 ? [] : [{ start: 0, end: scopeStart, reason: "outside-window" }],
    },
    { ...reviewOptions, spellingEnabled: false },
  );
  const { diagnostics } = finalizeReview(
    prepared,
    reviewChunks(prepared).map((chunk) => scanReviewChunk(prepared, chunk)),
  );
  const last = spellingCandidates(
    prepared,
    diagnostics.map((diagnostic) => diagnostic.range),
  )
    .filter((candidate) => AFTER_LAST_WORD.test(text.slice(candidate.range.end)))
    .at(-1);
  const spelling =
    last && !last.casing
      ? {
          ...last,
          range: { start: offset + last.range.start, end: offset + last.range.end },
        }
      : null;
  const proposals = diagnostics.flatMap((diagnostic) => {
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
        explanation: explain(diagnostic.messageKey),
      },
    ];
  });
  return { proposals, spelling };
}
