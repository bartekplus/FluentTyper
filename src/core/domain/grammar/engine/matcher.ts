import { carryCase } from "../implementations/helpers/GenericRuleShared";
import { TOKEN_PREDICATES } from "./predicates";
import { endsSentence } from "./tokenizer";
import type { CompiledMatcher, CompiledPattern, Token } from "./types";

/** A compiled pattern set: patterns, the literal anchor index and the structural rules. */
export interface PatternSet {
  patterns: readonly CompiledPattern[];
  /** Token key -> indexes of the patterns anchored on that literal. */
  anchors: Readonly<Record<string, readonly number[]>>;
  /** Patterns without a literal, tried at each token. */
  structural: readonly number[];
}

export interface PatternMatch {
  pattern: CompiledPattern;
  /** Token index of the first element. */
  first: number;
  start: number;
  end: number;
  targetStart: number;
  targetEnd: number;
  alternatives: string[];
}

const REGEXES = new Map<string, RegExp>();
const whole = (source: string) => {
  let regex = REGEXES.get(source);
  if (!regex) REGEXES.set(source, (regex = new RegExp(`^(?:${source})$`, "u")));
  return regex;
};

/** True when pattern element `m` (0-based `j`) accepts tokens[at]. */
function accepts(
  m: CompiledMatcher,
  tokens: readonly Token[],
  first: number,
  j: number,
  lang: string,
): boolean {
  const at = first + j;
  const token = tokens[at];
  // Protected text matches only an element that names the "protected" type.
  const shielded = token.type === "protected" || token.protected === true;
  if (
    m.type ? !m.type.includes(token.type) && !(shielded && m.type.includes("protected")) : shielded
  )
    return false;
  if (m.lower && !m.lower.includes(token.key)) return false;
  if (m.surface && !m.surface.includes(token.text)) return false;
  if (m.casing && !m.casing.includes(token.casing)) return false;
  if (m.spaceBefore !== undefined && (token.space !== "") !== m.spaceBefore) return false;
  if (m.spaceAfter !== undefined) {
    const next = tokens[at + 1];
    if ((next === undefined || next.space !== "") !== m.spaceAfter) return false;
  }
  if (m.exactWhitespaceBefore !== undefined && token.space !== m.exactWhitespaceBefore)
    return false;
  if (m.matchRef !== undefined && token.key !== tokens[first + m.matchRef - 1].key) return false;
  if (m.isSentenceStart !== undefined && token.sentenceStart !== m.isSentenceStart) return false;
  if (m.isSentenceEnd !== undefined && endsSentence(tokens, at) !== m.isSentenceEnd) return false;
  if (m.prevTokenNotLower?.includes(tokens[at - 1]?.key ?? "")) return false;
  if (m.nextTokenNotLower?.includes(tokens[at + 1]?.key ?? "")) return false;
  if (m.regex !== undefined && !whole(m.regex).test(token.text)) return false;
  if (m.negateRegex !== undefined && whole(m.negateRegex).test(token.text)) return false;
  return m.predicate === undefined || TOKEN_PREDICATES[m.predicate](tokens, at, lang);
}

type Check = (tokens: readonly Token[], first: number, j: number, lang: string) => boolean;
// An element that only names literal keys is a set lookup; others take the general check.
const CHECKS = new WeakMap<CompiledMatcher, Check>();
function checkOf(m: CompiledMatcher): Check {
  let check = CHECKS.get(m);
  if (!check) {
    if (m.lower && Object.keys(m).length === 1) {
      const keys = new Set(m.lower);
      check = (tokens, first, j) => {
        const token = tokens[first + j];
        return keys.has(token.key) && token.type !== "protected" && token.protected !== true;
      };
    } else check = (tokens, first, j, lang) => accepts(m, tokens, first, j, lang);
    CHECKS.set(m, check);
  }
  return check;
}

function matchAt(
  pattern: CompiledPattern,
  tokens: readonly Token[],
  first: number,
  lang: string,
): boolean {
  const { elements } = pattern;
  if (first < 0 || first + elements.length > tokens.length) return false;
  for (let j = 0; j < elements.length; j += 1) {
    if (j > 0 && !pattern.crossLines && tokens[first + j].space.includes("\n")) return false;
    if (!checkOf(elements[j])(tokens, first, j, lang)) return false;
  }
  return true;
}

const TEMPLATE = /\$(?:(\d+)|\{(\d+)(?::(\w+))?\})/g;
const FILTERS: Readonly<Record<string, (text: string) => string>> = {
  lower: (text) => text.toLowerCase(),
  upper: (text) => text.toUpperCase(),
  title: (text) => text.charAt(0).toUpperCase() + text.slice(1).toLowerCase(),
  preserveCase: (text) => text,
};

/** A replacement template with the matched tokens: "$2", "${1:lower}", or a literal. */
export function render(
  template: string,
  tokens: readonly Token[],
  first: number,
  replaced: string,
  preserveCase: boolean,
): string {
  let referenced = false;
  const text = template.replace(TEMPLATE, (_, plain: string, braced: string, filter: string) => {
    referenced = true;
    const value = tokens[first + Number(plain ?? braced) - 1].text;
    return filter ? FILTERS[filter](value) : value;
  });
  // A literal follows the casing of the text it replaces: "Alot" -> "A lot".
  return !referenced && preserveCase ? carryCase(replaced, text, true) : text;
}

/** The match of `pattern` with its first element at tokens[first]. */
function toMatch(
  pattern: CompiledPattern,
  tokens: readonly Token[],
  first: number,
  text: string,
): PatternMatch {
  const [from, to] = pattern.target;
  const targetStart = tokens[first + from - 1].start;
  const targetEnd = tokens[first + to - 1].end;
  const replaced = text.slice(targetStart, targetEnd);
  return {
    pattern,
    first,
    start: tokens[first].start,
    end: tokens[first + pattern.elements.length - 1].end,
    targetStart,
    targetEnd,
    alternatives: pattern.replacements.map((template) =>
      render(template, tokens, first, replaced, pattern.preserveCase),
    ),
  };
}

/** True when `pattern` runs for text in `lang` (a locale such as "pt_BR"). */
export function runsInLanguage(pattern: CompiledPattern, lang: string): boolean {
  const code = lang.slice(0, 2);
  return (
    (pattern.langs.length === 0 || pattern.langs.includes(code)) &&
    !pattern.excludeLangs.includes(code)
  );
}

/**
 * Every match of the patterns `use` accepts, in one walk over `tokens`: each token looks up
 * the patterns anchored on its key (one map read) and tries the structural patterns.
 */
export function findMatches(
  set: PatternSet,
  tokens: readonly Token[],
  text: string,
  lang: string,
  use: (pattern: CompiledPattern) => boolean,
): PatternMatch[] {
  // Decided only for the patterns a token reaches (0 unknown, 1 runs, 2 skipped): a pass
  // must not cost one step per rule.
  const state = new Uint8Array(set.patterns.length);
  const allowed = (index: number) => {
    if (state[index] === 0) {
      const pattern = set.patterns[index];
      state[index] = use(pattern) && runsInLanguage(pattern, lang) ? 1 : 2;
    }
    return state[index] === 1;
  };
  const structural = set.structural.filter(allowed);
  const matches: PatternMatch[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const anchored = Object.hasOwn(set.anchors, tokens[i].key) ? set.anchors[tokens[i].key] : [];
    for (const index of anchored) {
      if (!allowed(index)) continue;
      const pattern = set.patterns[index];
      const first = i - pattern.anchor;
      if (matchAt(pattern, tokens, first, lang))
        matches.push(toMatch(pattern, tokens, first, text));
    }
    for (const index of structural) {
      const pattern = set.patterns[index];
      if (matchAt(pattern, tokens, i, lang)) matches.push(toMatch(pattern, tokens, i, text));
    }
  }
  // An anchor can sit after the first element: order by start, then by pattern.
  return matches.sort((a, b) => a.start - b.start || a.pattern.index - b.pattern.index);
}
