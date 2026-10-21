import type {
  GrammarContext,
  GrammarEdit,
  GrammarEventType,
  GrammarRule,
  GrammarRuleId,
} from "../types";
import { LIVE_RULES } from "./live.generated";
import { RULE_LIVE } from "../review/rules/live-index.generated";

export interface LiveRuleOptions {
  insertSpaceAfterAutocomplete: boolean;
}

/** A typing rule as code (a rule file's `let`, `when` and `return` with `triggers`). */
export interface LiveCode {
  readonly triggers: readonly GrammarEventType[];
  apply(context: GrammarContext, options: LiveRuleOptions): GrammarEdit | null;
}

/** One typing check of the rule files: the code of its rule. */
function build(rule: (typeof LIVE_RULES)[number], options: LiveRuleOptions): GrammarRule {
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

/** The typing rule of one check, for tests of a single typing rule. */
export function liveRule(
  check: GrammarRuleId,
  options: LiveRuleOptions = { insertSpaceAfterAutocomplete: false },
): GrammarRule {
  const rule = LIVE_RULES.find((entry) => entry.check === check);
  if (!rule) throw new Error(`No typing rule for check ${check}`);
  return build(rule, options);
}
