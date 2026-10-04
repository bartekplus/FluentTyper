import { diffTexts, remapRange } from "./textRanges";
import type { ReviewCheckId, ReviewMessageKey, ReviewOptions } from "./types";

/*
 * The page side of typing-time proposals: what a proposal is and which one to
 * offer. Finding them (liveProposals.ts) runs the Review detectors.
 */

/** How much text before the caret a typing-time check reads. */
export const LIVE_PROPOSAL_WINDOW_CHARS = 500;

/** A Review finding offered while typing: shown, never applied without the user. */
export interface LiveGrammarProposal {
  ruleId: ReviewCheckId;
  messageKey: ReviewMessageKey;
  /** Offsets into the `beforeCursor` it was found in. */
  start: number;
  end: number;
  original: string;
  replacement: string;
  /** What `messageKey` means, in the UI language it was asked for. */
  explanation: string;
}

export interface LiveProposalOptions extends Omit<ReviewOptions, "spellingEnabled"> {
  /** Typing rules that are on: what they correct themselves is not proposed again. */
  liveRules: readonly string[];
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
