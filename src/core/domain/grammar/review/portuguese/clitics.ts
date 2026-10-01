import { applyWordCase, detectWordCase } from "../../implementations/helpers/GenericRuleShared";
import { frameMatches, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";

/**
 * "Não diga-me" -> "Não me diga": a negation or an indefinite pronoun right
 * before the verb pulls the object pronoun in front of
 * it (proclisis). Only pronouns that keep their shape are moved (me, te, se, lhe,
 * lhes, nos, vos); infinitives and gerunds, where both orders are correct, stay.
 */

// Negations and indefinite pronouns: the attractors every variety agrees on ("que deve-lhe"
// and "quando perguntei-lhe" are still written in Portugal).
const ATTRACTORS =
  "não|nunca|jamais|ninguém|nada|nenhum|nenhuma|quem|tampouco|tudo|todos|todas|alguém|algo";
const PATTERN = `(?:${ATTRACTORS})${SPACE}(?<target>(?<verb>\\p{Ll}+)-(?<pronoun>me|te|se|lhe|lhes|nos|vos))${WORD_END}`;
// Infinitives (personal ones too) and gerunds allow enclisis after an attractor.
const NON_FINITE = /(?:[aeioô]r|[aeio]rem|[aeio]rmos|[aeio]res|ndo)$/;

export function cliticPlacement(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "pt") return [];
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, PATTERN)) {
    const { verb, pronoun, target } = m.groups!;
    if (verb.length < 2 || NON_FINITE.test(verb) || ctx.dictionary.has(target.toLowerCase()))
      continue;
    // "encontramo-nos" drops the -s of "encontramos" before "nos".
    const restored = pronoun === "nos" && verb.endsWith("mo") ? `${verb}s` : verb;
    const [start, end] = m.indices!.groups!.target;
    findings.push({
      ruleId: "portugueseCliticPlacement",
      messageKey: "review_msg_pt_proclisis",
      range: { start, end },
      alternatives: [applyWordCase(`${pronoun} ${restored}`, detectWordCase(target))],
      context: { start: m.index, end },
    });
  }
  return findings;
}
