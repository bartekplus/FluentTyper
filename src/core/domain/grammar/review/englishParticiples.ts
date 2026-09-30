import { englishVerbForms } from "../implementations/helpers/EnglishVerbForms";
import { applyWordCase, detectWordCase } from "../implementations/helpers/GenericRuleShared";
import type { DetectContext, RawFinding } from "./reviewDetectors";

const SPACE = "[ \\t\\u00a0]{1,8}";
const EDGE = "[\\p{L}\\p{M}\\p{N}_'’@/#\\\\-]";
const ARGUMENTS: Readonly<Record<string, string>> = {
  go: "(?:through the report|home|to the office)",
  write: "the (?:summary|report)",
  take: "(?:the wrong turn|a break)",
  know: "the answer",
  come: "home",
  eat: "the meal",
  give: "the answer",
  speak: "to the team",
  run: "the tests",
  do: "the work",
  see: "the (?:results|movie)",
  choose: "the option",
  begin: "the project",
};
const PATTERN = `(?<![.])(?<!${EDGE})(?<subject>I|you|we|they|he|she|it)(?:${SPACE}(?<aux>have|has|had|haven['’]t|hasn['’]t|hadn['’]t)|(?<contract>['’]ve))(?:${SPACE}(?:not|already|just|never|ever|really|still)){0,2}${SPACE}(?<verb>[A-Za-z]+)(?!${EDGE})`;

/** Perfect-tense evidence, not a general past-tense or possessive-have normalizer. */
export function perfectParticiples(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const regex = new RegExp(PATTERN, "gidu");
  regex.lastIndex = Math.max(0, ctx.from - 256);
  for (let m = regex.exec(ctx.scanText); m && m.index < ctx.to; m = regex.exec(ctx.scanText)) {
    const [start, end] = m.indices!.groups!.verb;
    if (start < ctx.from || start >= ctx.to) continue;
    const { subject, aux, contract, verb } = m.groups!;
    const auxiliary = contract ? "have" : aux.toLowerCase().replace(/n['’]t$/, "");
    const singular = /^(?:he|she|it)$/i.test(subject);
    // Leave an incorrect auxiliary to the agreement detector; recheck the participle afterwards.
    if ((auxiliary === "has" && !singular) || (auxiliary === "have" && singular)) continue;
    const forms = englishVerbForms(verb);
    if (
      !forms ||
      forms.past !== verb.toLowerCase() ||
      forms.past === forms.participle ||
      !Object.hasOwn(ARGUMENTS, forms.lemma)
    )
      continue;
    const tail = new RegExp(
      `^${SPACE}${ARGUMENTS[forms.lemma].replaceAll(" ", SPACE)}(?!${EDGE})(?=[ \\t\\u00a0]{0,8}(?:[.!?,;:]|$))`,
      "iu",
    ).exec(ctx.scanText.slice(end, end + 128));
    if (!tail) continue;
    const phraseEnd = end + tail[0].length;
    if (/^\.[\p{L}\p{N}_]/u.test(ctx.text.slice(phraseEnd, phraseEnd + 2))) continue;
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
