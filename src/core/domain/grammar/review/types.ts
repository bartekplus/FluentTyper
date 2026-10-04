import type { PreferredTerminology } from "./preferredTerminology";
import type { CatalogRuleId } from "../ruleCatalog";
import type { ExplainedMessageKey } from "./reviewExplanations";
import type { PageMessageKey } from "./reviewMessages";

/**
 * Review diagnostics contract.
 *
 * All offsets are UTF-16 code units into ONE immutable source snapshot, with
 * end-exclusive bounds ([start, end)). Visual highlight ranges are kept apart
 * from mutation ranges: a finding may underline a phrase but change one word.
 */
export type ReviewCategory = "spelling" | "grammar" | "punctuation" | "typography" | "style";

export const REVIEW_CATEGORIES: readonly ReviewCategory[] = [
  "spelling",
  "grammar",
  "punctuation",
  "typography",
  "style",
];

/**
 * What kind of problem a native rule finds, within its category. Shown next
 * to the category and on settings cards; never used for filtering, colors or
 * Fix all.
 */
export type ReviewKind =
  | "typo"
  | "boundary"
  | "agreement"
  | "wordForm"
  | "confusedWords"
  | "usage"
  | "capitalization"
  | "repetition"
  | "spacing"
  | "numbers"
  | "marks"
  | "redundancy"
  | "readability"
  | "terminology";

/**
 * Review's own dictionary check: not a typing rule (typing offers spelling
 * corrections as suggestions), so it has an id outside the rule catalog.
 */
export const REVIEW_SPELLING_CHECK = "reviewSpelling" as const;
/**
 * Local AI corrections (optional on-device model). Outside the rule catalog,
 * always individual: never part of Fix all safe.
 */
export const REVIEW_LOCAL_AI_CHECK = "reviewLocalAi" as const;
export type ReviewCheckId =
  CatalogRuleId | typeof REVIEW_SPELLING_CHECK | typeof REVIEW_LOCAL_AI_CHECK;

/** Stands for each protected (non-prose) character in the analysis text; same length. */
export const MASK_CHAR = "\uFFFC";
/** Largest scope reviewed at once (UTF-16 code units). Larger scopes are cut and reported. */
export const MAX_REVIEW_CHARS = 50_000;
/**
 * Scan unit between yields. A chunk ends at a line end, else a space; ownership makes
 * any split correct.
 */
export const REVIEW_CHUNK_CHARS = 4_000;

export interface TextRange {
  start: number;
  end: number;
}

/** One replacement. `original` is the exact snapshot text it expects to replace. */
export interface ReviewEdit extends TextRange {
  original: string;
  replacement: string;
}

interface ReviewAlternative {
  /** The edits are applied together; they never overlap each other. */
  edits: ReviewEdit[];
  /** The corrected text of the highlighted range, for display. */
  preview: string;
  /**
   * Offered by the optional local model where it disagrees with a check on the
   * same text: shown as a labelled option, never preselected, never in Fix all.
   */
  localAi?: true;
}

/** A finding message: the background explains most of them (reviewExplanations.ts), the page the rest. */
export type ReviewMessageKey = ExplainedMessageKey | PageMessageKey;

export type BulkDecision =
  | { eligible: true; alternative: number }
  | {
      eligible: false;
      reason:
        | "rule-not-batch-approved"
        | "ambiguous"
        | "context-dependent"
        | "local-ai"
        | "warning-only"
        /** Inside a quotation: it can cite someone's words verbatim, so the user decides. */
        | "quoted";
    };

export interface ReviewDiagnostic {
  terminology?: { id: string; explanation: string };
  /** Unique within its snapshot: rule, range and replacement. */
  id: string;
  snapshotId: string;
  ruleId: ReviewCheckId;
  category: ReviewCategory;
  messageKey: ReviewMessageKey;
  lang: string;
  /** What to underline. */
  range: TextRange;
  /** Snapshot text of `range`. */
  original: string;
  alternatives: ReviewAlternative[];
  /** A diagnostic to inspect, with no replacement or write path. */
  warningOnly?: true;
  bulk: BulkDecision;
  /**
   * Text the decision depended on (the evidence), at least `range`. Another
   * fix that edits inside it can change whether this one is still right.
   */
  context: TextRange;
  /** Set only for single-word spelling findings a user dictionary can accept. */
  dictionaryWord?: string;
  /**
   * No alternative is preselected: the user picks one (an unknown word and
   * its possible replacements). Never part of Fix all.
   */
  requiresChoice?: true;
}

/**
 * `outside-window`: the cut edges of a window of a longer document (a partial
 * word or sentence); the target counts them in `unread`, not as protected.
 */
type ProtectedReason =
  "code" | "structure" | "technical" | "outside-window" | "other-language" | "language-uncertain";

export interface ProtectedRange extends TextRange {
  reason: ProtectedReason;
}

export interface ReviewSourceSnapshot {
  /** The user explicitly selected this scope, even when it spans the whole field. */
  selection?: true;
  /** Changes whenever the text or its structure changes. */
  id: string;
  text: string;
  /** What the user asked to review; findings and edits stay inside it. */
  scope: TextRange;
  /**
   * Ranges the adapter knows are not prose (code elements, non-editable islands,
   * virtual block separators). Nothing inside may be read as prose or edited.
   */
  protectedRanges: ProtectedRange[];
  /** The adapter omitted text outside its available window. */
  incomplete?: true;
}

export interface ReviewOptions {
  longSentenceWords?: number;
  preferredTerminology?: PreferredTerminology;
  /** Explicitly keep dictionary suggestions independent of native rule choices. */
  spellingEnabled?: boolean;
  lang: string;
  /** Invalidates a pending auto-language pass when preferences change. */
  languagePreferences?: string;
  enabledRules: readonly string[];
  userDictionary: readonly string[];
  insertSpaceAfterAutocomplete: boolean;
}

export type CoverageGap =
  | "code"
  | "technical"
  | "structure"
  | "size-limit"
  | "outside-window"
  | "rule-error"
  /** Characters of paragraphs in another language, where spelling was not checked. */
  | "other-language"
  | "language-uncertain";

export interface ReviewCoverage {
  /** Review-supported rules that ran. */
  checkedRules: CatalogRuleId[];
  /** Rules that threw; their findings are missing, so "no issues" must not be claimed. */
  failedRules: CatalogRuleId[];
  /** Characters of scope skipped as protected, by reason. */
  skipped: Partial<Record<CoverageGap, number>>;
}

export interface ReviewScanResult {
  diagnostics: ReviewDiagnostic[];
  coverage: ReviewCoverage;
}
