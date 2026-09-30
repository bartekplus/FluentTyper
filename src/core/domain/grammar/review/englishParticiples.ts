import { englishVerbForms } from "../implementations/helpers/EnglishVerbForms";
import { applyWordCase, detectWordCase } from "../implementations/helpers/GenericRuleShared";
import type { DetectContext, RawFinding } from "./reviewDetectors";

const SPACE = "[ \\t\\u00a0]{1,8}";
const EDGE = "[\\p{L}\\p{M}\\p{N}_'’@/#\\\\-]";
// A past form that is also a noun or another verb reads as possessive have ("I have saw blades"),
// so it needs a complete verb argument. Other past-only forms need none.
const ARGUMENTS: Readonly<Record<string, string>> = {
  see: "the (?:results|movie)",
  fall: "(?:asleep|behind|apart|ill)",
};
const MODAL =
  "(?:(?:could|would|should|might|must)(?:n['’]t)?|may|will|won['’]t|shall|can(?:not|['’]t)?)(?:[ \\t\\u00a0]{1,8}not)?";
// "'d" is had or would ("I'd went": gone or go), and "'s" is has or is: both abstain.
const PATTERN = `(?<![.])(?<!${EDGE})(?<subject>I|you|we|they|he|she|it)(?:${SPACE}(?<modal>${MODAL}))?(?:${SPACE}(?<aux>have|has|had|haven['’]t|hasn['’]t|hadn['’]t)|(?<contract>['’]ve))(?:${SPACE}(?:not|already|just|never|ever|really|still)){0,2}${SPACE}(?<verb>[A-Za-z]+)(?!${EDGE})`;

/** Perfect-tense evidence, not a general past-tense or possessive-have normalizer. */
export function perfectParticiples(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const regex = new RegExp(PATTERN, "gidu");
  regex.lastIndex = Math.max(0, ctx.from - 256);
  for (let m = regex.exec(ctx.scanText); m && m.index < ctx.to; m = regex.exec(ctx.scanText)) {
    const [start, end] = m.indices!.groups!.verb;
    if (start < ctx.from || start >= ctx.to) continue;
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
    if (/^\uFFFC|^\.[\p{L}\p{N}_]/u.test(ctx.text.slice(phraseEnd, phraseEnd + 2))) continue;
    const before = ctx.scanText.slice(Math.max(0, m.index - 96), m.index);
    if (
      /\b(?:write|type|spell|phrase|words?|example|literal|text|says?|reads?)[ :\t]*["“'‘][^\r\n\uFFFC]{0,80}$/i.test(
        before,
      )
    )
      continue;
    if (
      (ctx.scanText.slice(m.index, phraseEnd).match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) ?? []).some(
        (word) =>
          ctx.dictionary.has(word.toLowerCase()) ||
          applyWordCase(word, detectWordCase(word)) !== word,
      )
    )
      continue;
    findings.push({
      ruleId: "englishPerfectParticiples",
      messageKey: "review_msg_perfect_participle",
      range: { start, end },
      alternatives: [applyWordCase(forms.participle, detectWordCase(verb))],
      context: { start: Math.max(0, m.index - 96), end: Math.min(ctx.text.length, phraseEnd + 9) },
    });
  }
  return findings;
}
