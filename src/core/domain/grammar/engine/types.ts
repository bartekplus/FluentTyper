/**
 * The declarative grammar rule format (src/core/domain/grammar/rules/*.yaml) and its
 * compiled form. scripts/compile-grammar-rules.ts validates the files and writes the
 * compiled form to the *.generated.ts modules of this folder; the runtime never parses YAML.
 */

export type TokenType = "word" | "number" | "punct" | "symbol" | "protected";
export type Casing = "lower" | "upper" | "title" | "mixed" | "none";

/** One token of the single tokenizer pass. Whitespace is not a token: `space` keeps it. */
export interface Token {
  type: TokenType;
  text: string;
  /** Lowercase text without Arabic harakat and tatweel: the anchor and literal key. */
  key: string;
  start: number;
  end: number;
  /** The raw whitespace between the previous token (or the text start) and this one. */
  space: string;
  casing: Casing;
  /** First token of a sentence: text start, blank line, or after closing punctuation. */
  sentenceStart: boolean;
  /** Part of a URL, e-mail address, path, inline code or shortcode: patterns skip it. */
  protected?: true;
}

/** One element of a token pattern. Every field narrows the match; none matches any token. */
export interface TokenMatcherSpec {
  /** The token's lowercase key equals one of these. */
  lower?: string | readonly string[];
  /** The token's text equals one of these exactly. */
  surface?: string | readonly string[];
  type?: TokenType | readonly TokenType[];
  /** A Unicode regex the whole token text must match. */
  regex?: string;
  /** A Unicode regex the whole token text must not match. */
  negateRegex?: string;
  casing?: Casing | readonly Casing[];
  /** True: whitespace before the token; false: none. */
  spaceBefore?: boolean;
  /** True: whitespace after the token; false: none. */
  spaceAfter?: boolean;
  /** The whitespace before the token is exactly this. */
  exactWhitespaceBefore?: string;
  /** The token's key equals the key of pattern element N (1-based). */
  matchRef?: number;
  isSentenceStart?: boolean;
  /** Sentence-final punctuation or the text end follows the token. */
  isSentenceEnd?: boolean;
  /** The token before the match is not one of these keys (only on the first element). */
  prevTokenNotLower?: readonly string[];
  /** The token after the match is not one of these keys (only on the last element). */
  nextTokenNotLower?: readonly string[];
  /** A named token predicate (engine/predicates.ts). */
  predicate?: string;
}

/** A settings-level check: one switch, one catalog id. */
export interface CheckSpec {
  id: string;
  /** "live": a typing rule; "review": Review runs it. */
  modes: readonly ("live" | "review")[];
  priority: number;
  /** Catalog language scope. Default "all". */
  scope?: "all" | "en_US";
  /** i18n keys; default grammar_rule_<id> and <title>_desc. */
  title?: string;
  description?: string;
  /** Live rules: on by default. */
  rollout?: "on" | "off";
  codeSafe?: boolean;
  category: string;
  kind?: string;
  /** Batch-approved for "Fix all safe" and the instant live fix of pattern rules. */
  safeToFix?: boolean;
  /** Review: on by default. Default true. */
  enabled?: boolean;
  /** Review languages: a list, "named" (every language), or the phrase table kinds. */
  languages?: readonly string[] | "named" | { phraseTables: readonly string[] };
  note?: string;
  /** Review excludes the check, with this reason (modes without "review"). */
  excluded?: string;
  /** Settings copy by UI language (en, fr, hr, es, el, sv, de, pl, pr). */
  text?: { title: Readonly<Record<string, string>>; description: Readonly<Record<string, string>> };
  /** The settings example: the text before and after the fix; null after: a warning. */
  example: { lang: string; before: string; after: string | null };
}

/** An executable rule: a token pattern or a named detector predicate. */
export interface RuleSpec {
  id: string;
  /** The checks whose findings this rule reports; the first one by default. */
  checks: readonly string[];
  /** "*", a two-letter code or a locale ("pt_BR"). Default: the file's language. */
  lang?: string;
  includeLangs?: readonly string[];
  excludeLangs?: readonly string[];
  modes?: readonly ("live" | "review")[];
  /** Evaluation stage; lower runs first. Default 0. File order inside a stage. */
  stage?: number;
  /** Named detector (review) or named live implementation (live). */
  predicate?: string;
  /** Review result cache (NativeReviewCache). */
  cacheable?: boolean;
  pattern?: readonly TokenMatcherSpec[];
  /** Replacement templates: "$1", "${1:lower}", "${1:upper}", "${1:title}", literals. */
  replacements?: readonly string[];
  /** The 1-based elements [from, to] the replacement covers. Default: the whole match. */
  target?: readonly [number, number];
  /** Carry the casing of the replaced text onto literal replacements. Default true. */
  preserveCase?: boolean;
  /** Review message key. */
  message?: string;
  /** Elements may span a line break. Default false. */
  crossLines?: boolean;
  /** Fix all must not batch it. */
  bulkBlock?: "context-dependent" | "ambiguous";
}

/** A phrase table: "typed = fix" rows; "a | b = fix" for typed variants, "fix1; fix2" for choices. */
export type PhraseTables = Partial<Record<"words" | "phrases" | "compounds" | "style", string>>;

export interface RuleFile {
  /** The file's language: "*", or the locale ("en", "pt_BR", "ar_SA"). */
  lang: string;
  checks?: readonly CheckSpec[];
  exclusive?: readonly (readonly string[])[];
  rules?: readonly RuleSpec[];
  phrases?: PhraseTables;
  /** Named phrase tables (English modules and option tables): name -> rows. */
  tables?: Readonly<Record<string, string>>;
}

// ------------------------------------------------------------------ compiled form

export interface CompiledMatcher {
  lower?: readonly string[];
  surface?: readonly string[];
  type?: readonly TokenType[];
  regex?: string;
  negateRegex?: string;
  casing?: readonly Casing[];
  spaceBefore?: boolean;
  spaceAfter?: boolean;
  exactWhitespaceBefore?: string;
  matchRef?: number;
  isSentenceStart?: boolean;
  isSentenceEnd?: boolean;
  prevTokenNotLower?: readonly string[];
  nextTokenNotLower?: readonly string[];
  predicate?: string;
}

export interface CompiledPattern {
  /** Index into the compiled pattern list (anchor index values). */
  index: number;
  rule: string;
  check: string;
  /** Two-letter languages; empty: every language. */
  langs: readonly string[];
  excludeLangs: readonly string[];
  live: boolean;
  review: boolean;
  safeToFix: boolean;
  elements: readonly CompiledMatcher[];
  /** The element whose literals index the rule, or -1 for a structural rule. */
  anchor: number;
  replacements: readonly string[];
  target: readonly [number, number];
  preserveCase: boolean;
  message: string;
  crossLines: boolean;
  bulkBlock?: "context-dependent" | "ambiguous";
}

export interface CompiledRule {
  id: string;
  checks: readonly string[];
  /** Two-letter language, or undefined for every language. */
  lang?: string;
  /** Named detector; or the compiled pattern index. */
  predicate?: string;
  pattern?: number;
  cacheable?: true;
  /** The rule file it came from ("common", "en", "de", ...). */
  source: string;
}
