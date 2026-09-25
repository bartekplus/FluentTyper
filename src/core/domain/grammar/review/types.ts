import type { CatalogRuleId } from "../ruleCatalog";

/**
 * Review diagnostics contract.
 *
 * All offsets are UTF-16 code units into ONE immutable source snapshot, with
 * end-exclusive bounds ([start, end)). Visual highlight ranges are kept apart
 * from mutation ranges: a finding may underline a phrase but change one word.
 */
export type ReviewCategory = "spelling" | "grammar" | "punctuation" | "typography";

export const REVIEW_CATEGORIES: readonly ReviewCategory[] = [
  "spelling",
  "grammar",
  "punctuation",
  "typography",
];

export interface TextRange {
  start: number;
  end: number;
}

/** One replacement. `original` is the exact snapshot text it expects to replace. */
export interface ReviewEdit extends TextRange {
  original: string;
  replacement: string;
}

export interface ReviewAlternative {
  /** The edits are applied together; they never overlap each other. */
  edits: ReviewEdit[];
  /** The corrected text of the highlighted range, for display. */
  preview: string;
}

export type ReviewMessageKey =
  | "review_msg_sentence_start"
  | "review_msg_line_start"
  | "review_msg_pronoun_i"
  | "review_msg_contraction"
  | "review_msg_typo"
  | "review_msg_modal_of"
  | "review_msg_your_welcome"
  | "review_msg_their_there"
  | "review_msg_alot"
  | "review_msg_pronoun_verb"
  | "review_msg_article"
  | "review_msg_ordinal"
  | "review_msg_proper_noun"
  | "review_msg_space_before_comma"
  | "review_msg_space_after_comma"
  | "review_msg_space_before_mark"
  | "review_msg_repeated_spaces"
  | "review_msg_duplicate_punctuation"
  | "review_msg_measurement_spacing"
  | "review_msg_currency_spacing";

export type BulkDecision =
  | { eligible: true; alternative: number }
  | { eligible: false; reason: "rule-not-batch-approved" | "ambiguous" | "context-dependent" };

export interface ReviewDiagnostic {
  /** Unique within its snapshot: rule, range and replacement. */
  id: string;
  snapshotId: string;
  ruleId: CatalogRuleId;
  category: ReviewCategory;
  messageKey: ReviewMessageKey;
  lang: string;
  /** What to underline. */
  range: TextRange;
  /** Snapshot text of `range`. */
  original: string;
  alternatives: ReviewAlternative[];
  bulk: BulkDecision;
  /**
   * Text the decision depended on (the evidence), at least `range`. Another
   * fix that edits inside it can change whether this one is still right.
   */
  context: TextRange;
  /** Set only for single-word spelling findings a user dictionary can accept. */
  dictionaryWord?: string;
}

export type ProtectedReason = "code" | "structure" | "technical";

export interface ProtectedRange extends TextRange {
  reason: ProtectedReason;
}

export interface ReviewSourceSnapshot {
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
}

export interface ReviewOptions {
  lang: string;
  enabledRules: readonly string[];
  userDictionary: readonly string[];
  insertSpaceAfterAutocomplete: boolean;
}

export type CoverageGap = "code" | "technical" | "structure" | "size-limit" | "rule-error";

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
