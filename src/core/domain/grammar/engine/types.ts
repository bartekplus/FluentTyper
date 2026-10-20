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

/**
 * A frame: a regex over the text with a `target` group that the fix replaces. `{{NAME}}`
 * inserts a fragment (the file's `fragments`, or S, E, COMPLETE, COMPLETE_OR_PAREN, CLAUSE,
 * TOKEN_END), and `{{notAfter:a|b}}` a "not right after these words" guard.
 */
export interface FrameSpec {
  regex: string;
  /** The fix, or the fixes to choose from. */
  fix?: string | readonly string[];
  /** A named fix function (a `FIXERS` record of the language); it may veto with null. */
  fixer?: string;
  /** The fix already carries the typed casing. */
  raw?: boolean;
  /** The message of this frame, when it differs from the rule's. */
  message?: string;
  /** Template rules: the match must open a sentence or clause. */
  clauseStart?: boolean;
  /** Slot rules: the check of this frame (one of the rule's checks). */
  check?: string;
  /** Slot rules: the frame runs only when one of these words occurs near the chunk. */
  cue?: readonly string[];
  /** False: the regex is complete and gets no word-start guard (it carries its own). */
  wordStart?: boolean;
  /** Polish rules: the fix keeps its own casing (names, abbreviations). */
  verbatim?: boolean;
  /** Polish rules: a capital inside a sentence makes the target a name, so the frame abstains. */
  lowercase?: boolean;
  /** Portuguese rules: the target must start with a capital. */
  capitalized?: boolean;
  /** German rules: the fix sets its own case. */
  ownCase?: boolean;
  /** Carry rules: only the target's words must be plain (not user-dictionary or cased). */
  targetOnly?: boolean;
}

/** An executable rule: a token pattern, a list of frames, or a named detector predicate. */
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
  /** Frames, tried in order. */
  frames?: readonly FrameSpec[];
  /**
   * "frame" (default): English text, a fix per frame, context 40/20 characters around the
   * match. "template": every language the check runs in, one replacement per frame, context
   * 96/9 characters, and `clauseStart`. "slot": English text, a check and cue words per frame,
   * quoted examples skipped, and fixers that may also give the range to replace. "polish":
   * Polish text, a check per frame, user-dictionary words and names skipped, context 96/32.
   * "portuguese": Portuguese text, a list of alternatives per frame (or a fixer of the typed
   * target), `clauseStart` and `capitalized`, and the match as context. "german": German text,
   * complete case-sensitive regexes (flags "gdu"), the first named group other than `noun`
   * replaced, and `ownCase`. "carry": English text, a check per frame, the typed casing carried
   * onto the fix unless `verbatim`, `targetOnly`, and context 40/20. "cased": Portuguese text,
   * case-sensitive frames, a check per frame, one fix each, user-dictionary tokens skipped.
   */
  style?: "frame" | "template" | "slot" | "polish" | "portuguese" | "german" | "carry" | "cased";
  /** A named filter of the rule's findings (a `FILTERS` record of the rule file). */
  filter?: string;
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
  /** Regex fragments for the frames of the file: `{{NAME}}`. */
  fragments?: Readonly<Record<string, string>>;
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
  /** Named detector; or the compiled pattern index; or the compiled frame indexes. */
  predicate?: string;
  pattern?: number;
  frames?: readonly number[];
  /** The message of a frame rule. */
  message?: string;
  style?: "template" | "slot" | "polish" | "portuguese" | "german" | "carry" | "cased";
  /** "<file>:<name>" of a named findings filter. */
  filter?: string;
  cacheable?: true;
  /** The rule file it came from ("common", "en", "de", ...). */
  source: string;
}

/** A compiled frame: the expanded regex, its prefilter literals and its fix. */
export interface CompiledFrame {
  pattern: string;
  /** Lowercase literals of which every match consumes one (requiredLiterals). */
  literals: readonly string[];
  fix?: string | readonly string[];
  /** "<file>:<name>" of a named fix function. */
  fixer?: string;
  raw?: true;
  message?: string;
  clauseStart?: true;
  check?: string;
  cue?: readonly string[];
  wordStart?: false;
  verbatim?: true;
  lowercase?: true;
  capitalized?: true;
  ownCase?: true;
  targetOnly?: true;
}
