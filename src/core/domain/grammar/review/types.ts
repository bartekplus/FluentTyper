import type { PreferredTerminology } from "./preferredTerminology";
import type { CatalogRuleId } from "../ruleCatalog";

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
/** Scan unit between yields; chunks end on line breaks so no token straddles two. */
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

export type ReviewMessageKey =
  | "review_msg_style_redundancy"
  | "review_msg_style_phrasing"
  | "review_msg_phrase_correction"
  | "review_msg_closed_compound"
  | "review_msg_name_casing"
  | "review_msg_style_long_sentence"
  | "review_msg_preferred_terminology"
  | "review_msg_canonical_casing"
  | "review_msg_quotation_balance"
  | "review_msg_unclosed_quote"
  | "review_msg_quote_spacing"
  | "review_msg_prime_symbols"
  | "review_msg_usage_phrases"
  | "review_msg_intents_purposes"
  | "review_msg_one_same"
  | "review_msg_pique_interest"
  | "review_msg_doubled_degree"
  | "review_msg_countability"
  | "review_msg_contextual_grammar"
  | "review_msg_mass_noun"
  | "review_msg_countable_number"
  | "review_msg_compounds"
  | "review_msg_every_day"
  | "review_msg_everyday_adjective"
  | "review_msg_a_few"
  | "review_msg_double_negative"
  | "review_msg_negated_hardly"
  | "review_msg_question_auxiliary"
  | "review_msg_repeated_auxiliary"
  | "review_msg_since_duration"
  | "review_msg_log_in"
  | "review_msg_set_up"
  | "review_msg_noun_count"
  | "review_msg_noun_choice"
  | "review_msg_demonstrative_number"
  | "review_msg_one_of"
  | "review_msg_decade_plural"
  | "review_msg_perfect_participle"
  | "review_msg_progressive_be"
  | "review_msg_be_participle"
  | "review_msg_had_or_would"
  | "review_msg_be_base"
  | "review_msg_verb_complements"
  | "review_msg_missing_to"
  | "review_msg_forward_gerund"
  | "review_msg_worth_gerund"
  | "review_msg_causative_base"
  | "review_msg_allow_object"
  | "review_msg_ahead_and_tense"
  | "review_msg_tense_time_word"
  | "review_msg_future_date_past"
  | "review_msg_gerund_complement"
  | "review_msg_fixed_prepositions"
  | "review_msg_despite_of"
  | "review_msg_discuss_about"
  | "review_msg_interested_on"
  | "review_msg_its_possessive"
  | "review_msg_its_contraction"
  | "review_msg_lets_contraction"
  | "review_msg_else_possessive"
  | "review_msg_existential_agreement"
  | "review_msg_then_than"
  | "review_msg_then_than_temporal"
  | "review_msg_your_you_are"
  | "review_msg_they_are"
  | "review_msg_your_possessive"
  | "review_msg_their_possessive"
  | "review_msg_to_too"
  | "review_msg_to_infinitive"
  | "review_msg_ever_every"
  | "review_msg_were_where"
  | "review_msg_auxiliary_base"
  | "review_msg_modal_be"
  | "review_msg_to_base"
  | "review_msg_to_noun"
  | "review_msg_pronoun_subject_case"
  | "review_msg_pronoun_object_case"
  | "review_msg_who_subject"
  | "review_msg_sentence_structure"
  | "review_msg_confused_word"
  | "review_msg_double_subject"
  | "review_msg_pronoun_sequence"
  | "review_msg_determiner_clash"
  | "review_msg_double_modal"
  | "review_msg_missing_be"
  | "review_msg_clause_be"
  | "review_msg_subject_verb"
  | "review_msg_adverb_form"
  | "review_msg_couple_of"
  | "review_msg_partitive_of"
  | "review_msg_not_only_inversion"
  | "review_msg_repeated_words"
  | "review_msg_sentence_start"
  | "review_msg_line_start"
  | "review_msg_pronoun_i"
  | "review_msg_contraction"
  | "review_msg_apostrophe_mark"
  | "review_msg_typo"
  | "review_msg_modal_of"
  | "review_msg_your_welcome"
  | "review_msg_their_there"
  | "review_msg_alot"
  | "review_msg_pronoun_verb"
  | "review_msg_article"
  | "review_msg_ordinal"
  | "review_msg_ordinal_case"
  | "review_msg_proper_noun"
  | "review_msg_space_before_comma"
  | "review_msg_space_after_comma"
  | "review_msg_space_after_mark"
  | "review_msg_avoid_contractions"
  | "review_msg_oxford_comma"
  | "review_msg_no_oxford_comma"
  | "review_msg_alternative_phrasing"
  | "review_msg_possible_error"
  | "review_msg_quoted_mention"
  | "review_msg_american_spelling"
  | "review_msg_british_spelling"
  | "review_msg_word_choice"
  | "review_msg_spelled_numbers"
  | "review_msg_wide_comma"
  | "review_msg_space_before_mark"
  | "review_msg_space_after_opening_mark"
  | "review_msg_split_words"
  | "review_msg_german_noun_capital"
  | "review_msg_repeated_spaces"
  | "review_msg_duplicate_punctuation"
  | "review_msg_ellipsis_length"
  | "review_msg_ellipsis_character"
  | "review_msg_typed_dash"
  | "review_msg_measurement_spacing"
  | "review_msg_kelvin_degree"
  | "review_msg_currency_spacing"
  | "review_msg_currency_placement"
  | "review_msg_unknown_word"
  | "review_msg_two_initial_capitals"
  | "review_msg_local_ai"
  | "review_msg_irregular_form"
  | "review_msg_noun_possessive"
  | "review_msg_word_boundary"
  // German-only Review checks (review/german/).
  | "review_msg_german_noun_case"
  | "review_msg_german_preposition_case"
  | "review_msg_german_adjective_ending"
  | "review_msg_german_suspended_hyphen"
  | "review_msg_german_abbreviation"
  | "review_msg_german_quotes"
  | "review_msg_german_abbreviation_spacing"
  | "review_msg_german_invalid_date"
  | "review_msg_german_weekday_date"
  | "review_msg_german_date_punctuation"
  | "review_msg_german_comma"
  | "review_msg_german_verb_agreement"
  | "review_msg_german_article_gender"
  | "review_msg_german_object_case"
  | "review_msg_german_verb_case"
  | "review_msg_german_double_verb"
  | "review_msg_german_question_mark"
  | "review_msg_german_idiom_case"
  | "review_msg_german_name_case"
  | "review_msg_german_colloquial"
  | "review_msg_german_numbers"
  | "review_msg_greek_final_nu"
  | "review_msg_greek_strict_final_nu"
  | "review_msg_greek_question_accent"
  | "review_msg_greek_intro_comma"
  | "review_msg_greek_repeated_marks"
  | "review_msg_greek_perfect_form"
  | "review_msg_swedish_typography"
  | "review_msg_swedish_ordinal_colon"
  | "review_msg_swedish_acronym_genitive"
  | "review_msg_swedish_lowercase_names"
  | "review_msg_swedish_mellan_till"
  | "review_msg_swedish_agreement"
  | "review_msg_arabic_agreement"
  | "review_msg_arabic_case_endings"
  | "review_msg_arabic_dates"
  | "review_msg_arabic_impossible_date"
  | "review_msg_arabic_weekday_mismatch"
  | "review_msg_arabic_date_order"
  | "review_msg_arabic_demonstrative_gender"
  | "review_msg_arabic_dual_case"
  | "review_msg_arabic_relative_gender"
  | "review_msg_swedish_de_dem"
  | "review_msg_swedish_speech_comma"
  | "review_msg_arabic_number_case"
  | "review_msg_arabic_number_gender"
  | "review_msg_arabic_case_ending"
  | "review_msg_arabic_jussive"
  | "review_msg_arabic_subjunctive"
  | "review_msg_arabic_indicative"
  | "review_msg_arabic_counted_singular"
  // Portuguese.
  | "review_msg_pt_accent_paronym"
  | "review_msg_pt_accent_verb"
  | "review_msg_pt_confusions"
  | "review_msg_pt_crase"
  | "review_msg_pt_por_que"
  | "review_msg_pt_homophone"
  | "review_msg_pt_contraction"
  | "review_msg_pt_number_format"
  | "review_msg_pt_typography_style"
  | "review_msg_pt_proclisis"
  | "review_msg_pt_mesoclisis"
  | "review_msg_pt_pronoun_case"
  | "review_msg_pt_invalid_date"
  | "review_msg_pt_weekday_date"
  | "review_msg_pt_country_article"
  | "review_msg_pt_auxiliary_infinitive"
  | "review_msg_pt_comma"
  | "review_msg_pt_agreement"
  | "review_msg_pt_noun_agreement"
  | "review_msg_pt_tense_adverb"
  | "review_msg_pt_subjunctive"
  | "review_msg_pt_future_subjunctive"
  | "review_msg_pt_regency"
  | "review_msg_pt_participle"
  | "review_msg_pt_question_mark"
  | "review_msg_pt_enclitic_accent"
  | "review_msg_pt_object_form"
  | "review_msg_pt_ao90"
  | "review_msg_weekday_mismatch"
  | "review_msg_impossible_date"
  // English apostrophes and typography (review/english/).
  | "review_msg_plural_apostrophe"
  | "review_msg_verb_apostrophe"
  | "review_msg_apostrophe_space"
  | "review_msg_whose"
  | "review_msg_nationality_capital"
  | "review_msg_english_decimal"
  | "review_msg_english_digit_groups"
  | "review_msg_full_width_mark"
  | "review_msg_initialism_period"
  | "review_msg_degree_abbreviation"
  | "review_msg_typographic_symbol"
  | "review_msg_english_quotes"
  | "review_msg_range_dash"
  | "review_msg_date_comma"
  | "review_msg_oclock"
  | "review_msg_geographic_the"
  | "review_msg_superlative_the"
  | "review_msg_adverb_position"
  | "review_msg_passive_voice"
  | "review_msg_stray_comma"
  | "review_msg_introductory_comma"
  | "review_msg_clause_comma"
  | "review_msg_tag_question"
  // Polish-only checks (review/polish/).
  | "review_msg_pl_numeral_suffix"
  | "review_msg_pl_numeral_hyphen"
  | "review_msg_pl_numeral_noun"
  | "review_msg_pl_impossible_date"
  | "review_msg_pl_weekday_date"
  | "review_msg_pl_month_form"
  | "review_msg_pl_misplaced_comma"
  | "review_msg_pl_missing_comma"
  | "review_msg_pl_participle_comma"
  | "review_msg_pl_run_on"
  | "review_msg_pl_preposition_form"
  | "review_msg_pl_abbreviation_dot"
  | "review_msg_pl_inflected_name"
  | "review_msg_pl_decade"
  | "review_msg_pl_preposition_case"
  | "review_msg_pl_agreement"
  | "review_msg_pl_typography"
  | "review_msg_pl_quotes"
  | "review_msg_pl_extra_comma"
  | "review_msg_pl_comma_aside"
  | "review_msg_pl_capitals"
  | "review_msg_pl_conjunction_ending"
  | "review_msg_pl_negated_genitive"
  // Spanish Review checks (review/spanish/).
  | "review_msg_spanish_accent"
  | "review_msg_spanish_accent_extra"
  | "review_msg_spanish_interrogative"
  | "review_msg_spanish_confusion"
  | "review_msg_spanish_verb_form"
  | "review_msg_spanish_conjunction"
  | "review_msg_spanish_year"
  | "review_msg_spanish_lowercase_name"
  | "review_msg_spanish_acronym"
  | "review_msg_spanish_abbreviation"
  | "review_msg_spanish_date"
  | "review_msg_spanish_agreement"
  | "review_msg_spanish_comma"
  | "review_msg_spanish_verb_agreement"
  | "review_msg_spanish_pronoun_article"
  | "review_msg_spanish_ordinal"
  | "review_msg_spanish_unit"
  | "review_msg_spanish_dialogue_dash"
  | "review_msg_spanish_enclitic"
  | "review_msg_spanish_impersonal_haber"
  | "review_msg_spanish_quotes"
  | "review_msg_spanish_doubled_pronoun"
  | "review_msg_spanish_alta"
  // French (review/french/)
  | "review_msg_fr_past_participle"
  | "review_msg_fr_noun_participle"
  | "review_msg_fr_infinitive"
  | "review_msg_fr_vous_verb"
  | "review_msg_fr_homophone"
  | "review_msg_fr_hyphen"
  | "review_msg_fr_subject_verb"
  | "review_msg_fr_elision"
  | "review_msg_fr_date"
  | "review_msg_fr_noun_number"
  | "review_msg_fr_noun_gender"
  | "review_msg_fr_adjective_agreement"
  | "review_msg_fr_participle_agreement"
  | "review_msg_fr_tout"
  | "review_msg_fr_subjunctive"
  | "review_msg_fr_conditional"
  | "review_msg_fr_missing_ne"
  | "review_msg_fr_double_determiner"
  | "review_msg_fr_determiner_noun"
  | "review_msg_fr_ordinal";

export type BulkDecision =
  | { eligible: true; alternative: number }
  | {
      eligible: false;
      reason:
        "rule-not-batch-approved" | "ambiguous" | "context-dependent" | "local-ai" | "warning-only";
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
type ProtectedReason = "code" | "structure" | "technical" | "outside-window";

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
  | "other-language";

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
