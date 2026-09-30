import { detectPhraseTemplates } from "./phraseTemplates";
import { englishVerbForms, englishVerbGerund } from "../implementations/helpers/EnglishVerbForms";
import { applyWordCase, detectWordCase } from "../implementations/helpers/GenericRuleShared";
import type { DetectContext, RawFinding } from "./reviewDetectors";

const SPACE = "[ \\t\\u00a0]{1,8}";
const EDGE = "[\\p{L}\\p{M}\\p{N}_'’@/#\\\\-]";
const SUBJECT = "(?:I|you|we|they|he|she|it)";
const NEGATIVE = `(?:(?:(?:do|does|did)${SPACE}not|(?:don't|doesn't|didn't|don’t|doesn’t|didn’t))${SPACE})?`;
// Complete arguments distinguish verbs from noun uses: "need work" is deliberately absent.
const COMPLEMENTS: Readonly<Record<string, string>> = {
  fix: "(?:this|the) bug",
  deploy: "(?:tomorrow|today)",
  meet: "(?:you|them|her|him)",
  make: "the change",
  take: "a break",
  write: "the report",
  run: "the tests",
  come: "home",
  see: "the results",
  learn: "(?:Rust|English|Python)",
  visit: "the office",
  read: "the file",
  send: "the message",
  go: "home",
};

/** Only complete complement frames; missing subjects and ambiguous fragments abstain. */
export function verbComplements(ctx: DetectContext): RawFinding[] {
  const findings = detectPhraseTemplates(
    ctx,
    [
      ...(
        [
          [
            `${SUBJECT}${SPACE}(?:enjoy|enjoys|enjoyed|avoid|avoids|avoided)${SPACE}(?<target>to${SPACE}work)${SPACE}(?:on${SPACE}(?:(?:difficult|technical)${SPACE}){0,2}problems|late${SPACE}at${SPACE}night)`,
            "working",
          ],
          [
            `${SUBJECT}${SPACE}(?:decided|decide|decides)${SPACE}(?<target>testing)${SPACE}the${SPACE}(?:feature|application)(?:${SPACE}again)?(?:${SPACE}tomorrow)?`,
            "to test",
          ],
          [
            `(?:and${SPACE})?(?:suggested|suggest|suggests)${SPACE}(?<target>to${SPACE}add)${SPACE}more${SPACE}(?:unit${SPACE})?tests`,
            "adding",
          ],
          [
            `(?:made|let)${SPACE}(?:me|him|her|us|them)${SPACE}(?<target>to${SPACE})(?:restart${SPACE}the${SPACE}service|check${SPACE}the${SPACE}logs)`,
            "",
          ],
          [
            `(?:helps?|helped)${SPACE}(?:me|him|her|us|them)${SPACE}to${SPACE}(?<target>finding)${SPACE}mistakes`,
            "find",
          ],
        ] as const
      ).map(([pattern, replacement]) => ({
        pattern: `${pattern}(?!${EDGE})(?=[ \\t\\u00a0]{0,8}${replacement === "to test" ? "(?:[.!?]|$)" : `(?:[.!?,;:]|$|(?:and|but)${SPACE})`})`,
        replacement,
        messageKey: "review_msg_contextual_grammar" as const,
      })),
    ],
    "englishVerbComplements",
  );
  for (const gerundFrame of [false, true]) {
    const governor = gerundFrame
      ? `(?:${NEGATIVE}(?:look|looks|looked)|(?:am|is|are|was|were)${SPACE}(?:not${SPACE})?looking)${SPACE}forward${SPACE}to`
      : `${NEGATIVE}(?:need|needs|needed|want|wants|wanted|plan|plans|planned)`;
    const pattern = `(?<![.])(?<!${EDGE})${SUBJECT}${SPACE}${governor}${SPACE}(?<target>${Object.keys(COMPLEMENTS).join("|")})(?!${EDGE})`;
    const regex = new RegExp(pattern, "gidu");
    regex.lastIndex = Math.max(0, ctx.from - 256);
    for (
      let match = regex.exec(ctx.scanText);
      match && match.index < ctx.to;
      match = regex.exec(ctx.scanText)
    ) {
      const [start, end] = match.indices!.groups!.target;
      if (start < ctx.from || start >= ctx.to) continue;
      const target = match.groups!.target;
      const lemma = target.toLowerCase();
      const known = englishVerbForms(lemma);
      const gerund = englishVerbGerund(lemma);
      if ((known && known.lemma !== lemma) || !gerund) continue;
      const tail = new RegExp(
        `^${SPACE}${COMPLEMENTS[lemma].replaceAll(" ", SPACE)}(?!${EDGE})(?=[ \\t\\u00a0]{0,8}(?:[.!?,;:]|$))`,
        "iu",
      ).exec(ctx.scanText.slice(end, end + 128));
      if (!tail) continue;
      const before = ctx.scanText.slice(Math.max(0, match.index - 96), match.index);
      if (
        /\b(?:write|type|spell|phrase|words?|example|literal|text|says?|reads?)[ :\t]*["“'‘][^\r\n\uFFFC]{0,80}$/i.test(
          before,
        )
      )
        continue;
      const phraseEnd = end + tail[0].length;
      if (/^\.[\p{L}\p{N}_]/u.test(ctx.text.slice(phraseEnd, phraseEnd + 2))) continue;
      if (
        (
          ctx.scanText.slice(match.index, phraseEnd).match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) ?? []
        ).some(
          (word) =>
            ctx.dictionary.has(word.toLowerCase()) ||
            applyWordCase(word, detectWordCase(word)) !== word,
        )
      )
        continue;
      findings.push({
        ruleId: "englishVerbComplements",
        messageKey: gerundFrame ? "review_msg_forward_gerund" : "review_msg_missing_to",
        range: { start, end },
        alternatives: [
          gerundFrame
            ? applyWordCase(gerund, detectWordCase(target))
            : `${target === target.toUpperCase() ? "TO" : "to"} ${target}`,
        ],
        context: {
          start: Math.max(0, match.index - 96),
          end: Math.min(ctx.text.length, phraseEnd + 9),
        },
      });
    }
  }
  return findings;
}
