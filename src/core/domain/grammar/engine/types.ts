import type { LiteralAnchor } from "./prefixes";
import type { BodySpec, CodeSections, DefSpec } from "./ruleCode";
/**
 * The declarative grammar rule format (src/core/domain/grammar/rules/*.yaml) and its
 * compiled form. scripts/compile-grammar-rules.ts validates the files and writes the
 * compiled form to the *.generated.ts modules of this folder; the runtime never parses YAML.
 */

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
  /** Batch-approved for "Fix all safe". */
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
interface FrameSpec extends BodySpec {
  regex: string;
  /** The fix, or the fixes to choose from. */
  fix?: string | readonly string[];
  /** The name of the frame's code (`return`), when something must find the frame by it. */
  name?: string;
  /** The fix already carries the typed casing. */
  raw?: boolean;
  /** The message of this frame, when it differs from the rule's. */
  message?: string;
  /** Template rules: the match must open a sentence or clause. */
  clauseStart?: boolean;
  /** Slot rules: the check of this frame (one of the rule's checks). */
  check?: string;
  /** Slot rules: the frame runs only when one of these words occurs near the chunk. Default: the
   * frame's prefilter literals, when each is a lowercase word. False: no cue words. */
  cue?: readonly string[] | false;
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
  /** The regex flags of a complete regex (comma, swap and match rules). */
  flags?: string;
  /**
   * Match rules: how the frame scans the chunk. "frame" (default): a frame scan
   * (frameScan; a regex with `wordStart: false` or `flags` is used as it is). "owned": the
   * regex from `lookback` characters before the chunk over the scan text, while a match starts
   * before the chunk end. "text": the same over the text. "polish": the Polish owned scan (64
   * characters back, named examples skipped).
   */
  scan?: "frame" | "owned" | "text" | "polish";
  /** Match rules, "owned" and "text" scans: the characters read before the chunk. Default 0. */
  lookback?: number;
  /** Match rules, "owned" and "text" scans: a match may start this many characters after the chunk. Default 0. */
  lookahead?: number;
  /**
   * Match rules: the frame runs when any check of its rule is on (its fixer gives findings of
   * several checks). Default: only when the frame's own check is on.
   */
  anyCheck?: boolean;
  /**
   * Match rules, frame scans: the group whose start must lie in the chunk. "a|b": the first
   * of these groups that matched. "none": every match of the scan (the fixer decides).
   * Default "target".
   */
  owner?: string;
  /**
   * The frame runs only on a chunk whose text, from 256 characters before it to 64 after
   * it, matches this regex (a rare word of the frame).
   */
  gate?: string;
  /** The flags of `gate`. Default "gi". */
  gateFlags?: string;
  /** The frame runs only on text of this language ("de", "pt_BR"): a rule of many languages. */
  lang?: string;
}

/** An executable rule: a list of frames, its own code (`let`, `when`, `return`) or findings. */
export interface RuleSpec extends BodySpec, CodeSections {
  id: string;
  /** Typing rules with code: the events the rule runs on ("insertChar", "wordBoundary"). */
  triggers?: readonly string[];
  /** The checks whose findings this rule reports; the first one by default. */
  checks: readonly string[];
  /** "*", a two-letter code or a locale ("pt_BR"). Default: the file's language. */
  lang?: string;
  modes?: readonly ("live" | "review")[];
  /** Evaluation stage; lower runs first. Default 0. File order inside a stage. */
  stage?: number;
  /** Review result cache (NativeReviewCache). */
  cacheable?: boolean;
  /** Review message key. */
  message?: string;
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
   * "comma": Polish text, complete regexes with `flags`, a check per frame, a fixer each.
   * "swap": Polish text, complete regexes with `flags`, the whole match replaced by a fixer.
   * "match": every language the rule runs in; a fixer reads each match and gives its fixes
   * (a finding on the `target` group, context 96/9), its own findings, or null. `scan`,
   * `lookback` and `owner` set how the frame reads the chunk.
   */
  style?: FrameStyle;
  /** A named filter of the rule's findings (a `FILTERS` record of the rule file). */
  filter?: string | BodySpec;
  /**
   * A rule that reports findings Review made before the rule scan, in the chunk: "style" (the
   * style advice), "terminology" (the user's preferred terms) or "quotation" (unclosed quotes).
   */
  findings?: "style" | "terminology" | "quotation";
  /**
   * Consecutive Review rules of one group run as one detector: their findings join in order,
   * and a rule that throws stops the group and drops its findings (as one composite check).
   */
  group?: string;
}

/** A phrase table: "typed = fix" rows; "a | b = fix" for typed variants, "fix1; fix2" for choices. */
type PhraseTables = Partial<Record<"words" | "phrases" | "compounds" | "style", string>>;

export interface RuleFile {
  /** The file's language: "*", or the locale ("en", "pt_BR", "ar_SA"). */
  lang: string;
  checks?: readonly CheckSpec[];
  exclusive?: readonly (readonly string[])[];
  rules?: readonly RuleSpec[];
  phrases?: PhraseTables;
  /** Named phrase tables (English modules and option tables): name -> rows. */
  tables?: Readonly<Record<string, string>>;
  /** Regex fragments for the frames and expressions of the file: `{{NAME}}`. */
  fragments?: Readonly<Record<string, string>>;
  /** Word sets that expressions read: name -> words, a list or one string split on whitespace
   * (a ReadonlySet<string>). */
  sets?: Readonly<Record<string, readonly string[] | string>>;
  /** Mappings that expressions read: name -> key -> value. */
  maps?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /** Named expressions and functions of the file's expressions; common.yaml's are shared. */
  defs?: Readonly<Record<string, DefSpec>>;
}

// ------------------------------------------------------------------ compiled form

export interface CompiledRule {
  id: string;
  checks: readonly string[];
  /** Two-letter language, or undefined for every language. */
  lang?: string;
  /** "<file>:<name>" of the rule's code; or the compiled frame indexes. */
  predicate?: string;
  frames?: readonly number[];
  /** The message of a frame rule. */
  message?: string;
  style?: Exclude<FrameStyle, "frame">;
  /** "<file>:<name>" of a named findings filter. */
  filter?: string;
  cacheable?: true;
  group?: string;
  findings?: "style" | "terminology" | "quotation";
  /** The rule file it came from ("common", "en", "de", ...). */
  source: string;
}

/** How the frames of a rule read their matches (engine/frameStyles.ts). */
export type FrameStyle =
  | "frame"
  | "template"
  | "slot"
  | "polish"
  | "portuguese"
  | "german"
  | "carry"
  | "cased"
  | "comma"
  | "swap"
  | "match";

/** A compiled frame: the expanded regex, its prefilter literals and its fix. */
export interface CompiledFrame {
  pattern: string;
  /** Lowercase literals of which every match consumes one (requiredLiterals). */
  literals: readonly string[];
  /** A frame scan's start positions (prefixes.ts scanStarts): the prefixes of every match. */
  prefixes?: readonly string[];
  /** Without prefixes: an anchor that every match holds near its start. */
  anchor?: LiteralAnchor;
  /** A later anchor of every match: a start with no occurrence of it in reach is skipped. */
  later?: LiteralAnchor;
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
  flags?: string;
  scan?: "frame" | "owned" | "text" | "polish";
  lookback?: number;
  lookahead?: number;
  anyCheck?: true;
  owner?: string;
  gate?: string;
  gateFlags?: string;
  lang?: string;
}
