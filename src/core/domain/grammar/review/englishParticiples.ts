import { englishVerbForms } from "../implementations/helpers/EnglishVerbForms";
import { applyWordCase, detectWordCase } from "../implementations/helpers/GenericRuleShared";
import { EDGE, frameMatches, gluedAfter, hasUserOrCasedWord, SPACE } from "./phraseTemplates";
import type { DetectContext, RawFinding } from "./reviewDetectors";

// A past form that is also a noun or another verb reads as possessive have ("I have saw blades"),
// so it needs a complete verb argument. Other past-only forms need none.
const ARGUMENTS: Readonly<Record<string, string>> = {
  see: "the (?:results|movie)",
  fall: "(?:asleep|behind|apart|ill)",
};
const MODAL =
  "(?:(?:could|would|should|might|must)(?:n['’]t)?|may|will|won['’]t|shall|can(?:not|['’]t)?)(?:[ \\t\\u00a0]{1,8}not)?";
// "'d" is had or would ("I'd went": gone or go), and "'s" is has or is: both abstain.
const PATTERN = `(?<subject>I|you|we|they|he|she|it)(?:${SPACE}(?<modal>${MODAL}))?(?:${SPACE}(?<aux>have|has|had|haven['’]t|hasn['’]t|hadn['’]t)|(?<contract>['’]ve))(?:${SPACE}(?:not|already|just|never|ever|really|still)){0,2}${SPACE}(?<verb>[A-Za-z]+)(?!${EDGE})`;

/** Perfect-tense evidence, not a general past-tense or possessive-have normalizer. */
export function perfectParticiples(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, PATTERN, "verb")) {
    const [start, end] = m.indices!.groups!.verb;
    const { subject, modal, aux, contract, verb } = m.groups!;
    const auxiliary = contract ? "have" : aux.toLowerCase().replace(/n['’]t$/, "");
    const singular = /^(?:he|she|it)$/i.test(subject);
    // Leave an incorrect auxiliary to the agreement detector; recheck the participle afterwards.
    if (
      modal
        ? !contract && !/^have$/i.test(aux)
        : (auxiliary === "has" && !singular) || (auxiliary === "have" && singular)
    )
      continue;
    const word = verb.toLowerCase();
    const forms = englishVerbForms(word);
    if (!forms || word !== forms.past || word === forms.participle || word === forms.lemma)
      continue;
    // Title case inside a clause is a name ("I have Drew on the line").
    if (verb !== word && verb !== verb.toUpperCase()) continue;
    let phraseEnd = end;
    if (forms.ambiguous.includes(word)) {
      if (!Object.hasOwn(ARGUMENTS, forms.lemma)) continue;
      const tail = new RegExp(
        `^${SPACE}${ARGUMENTS[forms.lemma].replaceAll(" ", SPACE)}(?!${EDGE})(?=[ \\t\\u00a0]{0,8}(?:[.!?,;:]|$))`,
        "iu",
      ).exec(ctx.scanText.slice(end, end + 128));
      if (!tail) continue;
      phraseEnd += tail[0].length;
    }
    if (gluedAfter(ctx.text, phraseEnd)) continue;
    if (hasUserOrCasedWord(ctx, ctx.scanText.slice(m.index, phraseEnd))) continue;
    findings.push({
      ruleId: "englishPerfectParticiples",
      messageKey: "review_msg_perfect_participle",
      range: { start, end },
      alternatives: [applyWordCase(forms.participle, detectWordCase(verb))],
      context: { start: Math.max(0, m.index - 96), end: Math.min(ctx.text.length, phraseEnd + 9) },
    });
  }
  return [...findings, ...progressiveAfterHave(ctx)];
}

// -ing forms that are also everyday nouns ("We have training on Monday") need an object pronoun.
const NOUN_LIKE_ING =
  /^(?:reading|writing|testing|planning|building|training|meeting|painting|drawing|shopping|setting|spending|recording|funding|parking|housing|clothing|seating|heating|lighting|cooking|swimming|dancing|marketing|pricing|timing|booking|warning|opening|ending|beginning|feeling|morning|evening|ceiling|nothing|something|anything|everything|thing|king|ring|spring|string|wedding|pudding|sibling|during)$/;
const OBJECT = "(?:it|them|him|her|us|me|this|that)";
const PROGRESSIVE = `(?<subject>I|you|we|they|he|she|it)(?:${SPACE}(?<aux>have|has)|(?<contract>['’]ve))${SPACE}(?<verb>[A-Za-z]{2,}ing)${SPACE}(?<follow>${OBJECT}|(?:(?:on|into|about|at|for|with|to)${SPACE})?(?:${OBJECT}|the|a|an|my|your|our|his|her|their))(?!${EDGE})`;

/** "I've looking into it": have in place of be before a progressive; both repairs are offered. */
function progressiveAfterHave(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const owner = (m: RegExpExecArray) =>
    m.indices!.groups![m.groups!.contract ? "contract" : "aux"][0];
  for (const m of frameMatches(ctx, PROGRESSIVE, owner)) {
    const { subject, aux, contract, verb, follow } = m.groups!;
    const [start, end] = m.indices!.groups![contract ? "contract" : "aux"];
    const singular = /^(?:he|she|it)$/i.test(subject);
    if (contract ? singular : (aux.toLowerCase() === "has") !== singular) continue;
    const ing = verb.toLowerCase();
    if (NOUN_LIKE_ING.test(ing) && !new RegExp(`^${OBJECT}$`, "i").test(follow)) continue;
    const before = ctx.scanText.slice(Math.max(0, m.index - 96), m.index);
    // A modal or question word owns have ("Why have you…", "could have…").
    if (
      /\b(?:could|would|should|might|must|may|will|to|what|why|how|where|when|which)[ \t ]+$/i.test(
        before,
      )
    )
      continue;
    const phraseEnd = m.index + m[0].length;
    if (hasUserOrCasedWord(ctx, m[0])) continue;
    const typed = contract ?? aux;
    const first = /^i$/i.test(subject);
    const be = contract
      ? `${contract[0]}${first ? "m" : "re"}`
      : first
        ? "am"
        : singular
          ? "is"
          : "are";
    const been = `${contract ? `${contract[0]}ve` : aux.toLowerCase()} been`;
    const kase = detectWordCase(typed);
    findings.push({
      ruleId: "englishPerfectParticiples",
      messageKey: "review_msg_progressive_be",
      range: { start, end },
      alternatives: [applyWordCase(be, kase), applyWordCase(been, kase)],
      requiresChoice: true,
      context: { start: Math.max(0, m.index - 96), end: Math.min(ctx.text.length, phraseEnd + 9) },
    });
  }
  return findings;
}
