import type {
  GrammarContext,
  GrammarEdit,
  GrammarEventType,
  GrammarRule,
  GrammarRuleId,
} from "../types";
import { LIVE_PATTERNS, LIVE_RULES } from "./live.generated";
import { RULE_LIVE } from "./rules/index.generated";
import { findMatches, type PatternSet } from "./matcher";
import { tokenize } from "./tokenizer";

export interface LiveRuleOptions {
  insertSpaceAfterAutocomplete: boolean;
}

/** A typing rule as code (a rule file's `let`, `when` and `return` with `triggers`). */
export interface LiveCode {
  readonly triggers: readonly GrammarEventType[];
  apply(context: GrammarContext, options: LiveRuleOptions): GrammarEdit | null;
}

/**
 * Named live implementations: none. Each typing rule has its code in its rule file. The empty
 * record stays because tests/grammar/GrammarEngineRules.test.ts imports it.
 */
export const LIVE_PREDICATES: Readonly<Record<string, never>> = {};

// Enough text before the cursor for any live pattern; the window starts after a space.
const LIVE_WINDOW = 200;
const BOUNDARY = /[\s\p{P}]/u;

/**
 * The live patterns of one check. When a space or punctuation mark is typed, the text
 * before the cursor is tokenized once, and the first match that ends at the typed
 * character (or at the typed mark itself) is fixed. Only safe-to-fix checks run live.
 */
export class PatternLiveRule implements GrammarRule {
  readonly triggers: GrammarEventType[] = ["insertChar", "wordBoundary"];

  constructor(
    readonly id: GrammarRuleId,
    private readonly patterns: ReadonlySet<number>,
    private readonly set: PatternSet = LIVE_PATTERNS,
  ) {}

  apply(context: GrammarContext): GrammarEdit | null {
    const text = context.beforeCursor;
    const typed = text.at(-1) ?? "";
    if (!BOUNDARY.test(typed)) return null;
    let windowStart = Math.max(0, text.length - LIVE_WINDOW);
    if (windowStart > 0) windowStart = text.indexOf(" ", windowStart) + 1 || text.length;
    const tokens = tokenize(text, windowStart);
    const dictionary = new Set(context.hints?.userDictionary?.map((word) => word.toLowerCase()));
    // The match ends at the typed character (a mark the pattern names) or just before it.
    const ends = new Set([text.length, text.length - typed.length]);
    const matches = findMatches(this.set, tokens, text, context.hints?.lang ?? "en_US", (p) =>
      this.patterns.has(p.index),
    );
    for (const match of matches) {
      if (!ends.has(match.end)) continue;
      const replaced = tokens.filter(
        (token) => token.start >= match.targetStart && token.end <= match.targetEnd,
      );
      if (replaced.some((token) => dictionary.has(token.key))) continue;
      const alternative = match.alternatives[0];
      if (alternative === text.slice(match.targetStart, match.targetEnd)) continue;
      return {
        replacement: alternative + text.slice(match.targetEnd),
        deleteBackwards: text.length - match.targetStart,
        deleteForwards: 0,
      };
    }
    return null;
  }
}

/** One typing check of the rule files: its code or its live patterns. */
function build(rule: (typeof LIVE_RULES)[number], options: LiveRuleOptions): GrammarRule {
  if (!rule.predicate)
    return new PatternLiveRule(rule.check as GrammarRuleId, new Set(rule.patterns));
  // "<file>:@<rule id>": the rule's code in its rule file.
  const [file, key] = rule.predicate.split(":");
  const code = key === undefined ? undefined : RULE_LIVE[file]?.[key];
  if (!code) throw new Error(`No code for typing rule ${rule.predicate}`);
  return {
    id: rule.check as GrammarRuleId,
    triggers: [...code.triggers],
    apply: (context: GrammarContext) => code.apply(context, options),
  };
}

/** The typing rules of the rule files, in priority order. */
export function createLiveRules(options: LiveRuleOptions): GrammarRule[] {
  return LIVE_RULES.map((rule) => build(rule, options));
}

/** The typing rule of one check: the facade classes of implementations/ delegate to it. */
export function liveRule(
  check: GrammarRuleId,
  options: LiveRuleOptions = { insertSpaceAfterAutocomplete: false },
): GrammarRule {
  const rule = LIVE_RULES.find((entry) => entry.check === check);
  if (!rule) throw new Error(`No typing rule for check ${check}`);
  return build(rule, options);
}
