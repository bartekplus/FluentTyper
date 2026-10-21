import type { CatalogRuleId } from "../ruleCatalog";
import {
  articleAnLastWord,
  modalOfLastWord,
  pronounVerbLastWord,
  theirThereLastWord,
  yourWelcomeLastWord,
} from "./rules/common.generated";
import { phraseCorrections } from "./englishPhraseCorrections";
import { usePhraseRows } from "../library/common/engine";
import { useEnFrameRules } from "../library/english/rules";
import { useRuleDetectors } from "../library/english/views";
import type { ReviewMessageKey, TextRange } from "./types";
import { buildReviewDetectors, frameRuleDetector } from "../engine/reviewRules";

/**
 * Review detectors read ONE immutable snapshot and never mutate it.
 *
 * `text` is the analysis text: the source with protected characters (code,
 * technical tokens, non-editable islands) replaced one-for-one by U+FFFC, so
 * offsets match the source and no match can join prose across a protected span.
 * `source` is the real text; every edit's `original` comes from it.
 *
 * Each detector reuses the typing rule's own patterns, word lists and casing
 * helpers, evaluated at positions in the finished text. No typing events are
 * simulated and no delimiter is appended at the end of the input.
 */
export interface DetectContext {
  source: string;
  text: string;
  /**
   * `text` cut shortly after `to` (and masked at the cut), for forward regex
   * scans: a chunk without matches must not scan the rest of the document.
   * Same offsets as `text`; read context from `text`.
   */
  scanText: string;
  /** Findings are owned by the chunk their range starts in: [from, to). */
  from: number;
  to: number;
  lang: string;
  dictionary: ReadonlySet<string>;
  insertSpaceAfterAutocomplete: boolean;
  /** Enabled checks; a detector serving several may skip the others' work. Absent: all. */
  rules?: ReadonlySet<string>;
  quotationFindings?: readonly RawFinding[];
  quotationRanges?: readonly TextRange[];
  exampleRanges?: readonly TextRange[];
  styleFindings?: readonly RawFinding[];
  terminologyFindings?: readonly RawFinding[];
}

export interface RawFinding {
  terminology?: { id: string; explanation: string };
  ruleId: CatalogRuleId;
  messageKey: ReviewMessageKey;
  range: TextRange;
  /** Replacement for `range`, per alternative. */
  alternatives: string[];
  warningOnly?: true;
  /** Evidence the decision depended on; defaults to `range`. */
  context?: TextRange;
  /** A finding the rule's metadata would batch but this instance must not. */
  bulkBlock?: "context-dependent" | "ambiguous";
  dictionaryWord?: string;
  requiresChoice?: true;
}

export type ReviewDetectorEntry = {
  rules: CatalogRuleId[];
  detect: (ctx: DetectContext) => RawFinding[];
  /** The rule file that declares the entry ("common", "en", "de", ...). */
  source?: string;
  /**
   * The language (two-letter code) of the text the entry checks. Review runs the entry only
   * for that language, also when other languages run its rules. No value: every language.
   */
  lang?: string;
};

/**
 * For each phrase frame of common.yaml (modalOf, yourWelcome, theirThere, pronounVerb, articleAn):
 * the quick test of the word that ends a window, before its pattern runs. A fuzz test keeps each
 * test true wherever its pattern matches.
 */
export const PHRASE_LAST_WORD = {
  modalOf: modalOfLastWord,
  yourWelcome: yourWelcomeLastWord,
  theirThere: theirThereLastWord,
  pronounVerb: pronounVerbLastWord,
  articleAn: articleAnLastWord,
} satisfies Record<string, (text: string, start: number, end: number) => boolean>;

// Library helpers that run engine parts: the library cannot load the engine (an import cycle).
// The phrase rows that the phraseTables rule of common.yaml reads (library phraseRows).
usePhraseRows(phraseCorrections);
// The findings of another frame rule, in the chunk or in a view (library enFrameRuleFindings,
// enRuleFindings).
useEnFrameRules((id) => frameRuleDetector(id));
useRuleDetectors((id) => frameRuleDetector(id));

/**
 * Review detectors in evaluation order, built from the Review rules of grammar/rules/*.yaml:
 * their patterns, frames and code. Rules absent here are excluded from review (see reviewCatalog).
 */
export const REVIEW_DETECTORS: ReviewDetectorEntry[] = buildReviewDetectors();

/** Per-language entries: they may add context detectors to shared rules or serve their own. */
export const LANGUAGE_DETECTORS: readonly ReviewDetectorEntry[] = REVIEW_DETECTORS.filter(
  (entry) => entry.source !== "common" && entry.source !== "en",
);
