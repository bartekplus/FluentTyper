import {
  englishNounForms,
  ENGLISH_COUNT_WORDS,
  hasCountPrefix,
} from "../implementations/helpers/EnglishNounNumber";
import { applyWordCase, detectWordCase } from "../implementations/helpers/GenericRuleShared";
import {
  COMPLETE as END,
  EDGE,
  frameMatches,
  hasUserOrCasedWord,
  SPACE,
  WORD_END,
} from "./phraseTemplates";
import type { DetectContext, RawFinding } from "./reviewDetectors";

const ADJECTIVE = `(?:(?:new|old|missing|broken|small|large|updated)${SPACE})?`;
const STATUS = "(?:missing|broken|ready|new|old|available|useful)";
const PAST = "(?:failed|arrived|returned)";

const templates = [
  `(?<one>one${SPACE}of${SPACE}the)${SPACE}${ADJECTIVE}(?<noun>[A-Za-z]+)(?<tail>${SPACE}(?:${PAST}|(?:is|was)${SPACE}${STATUS}|has${SPACE}failed))${END}`,
  `(?<count>${ENGLISH_COUNT_WORDS.join("|")}|[0-9]{1,4})${SPACE}${ADJECTIVE}(?<noun>[A-Za-z]+)(?<tail>(?:${SPACE}(?:${PAST}|(?:in|on|near)${SPACE}the${SPACE}(?:report|folder|office|table|room|screen)))?)${END}`,
  `(?<dem>these|those)(?<gap>${SPACE}${ADJECTIVE})(?<noun>[A-Za-z]+)(?<tail>${SPACE}(?:(?<verb>are|were|is|was)${SPACE}${STATUS}|${PAST}))${END}`,
  // Up to three free modifiers; the known noun must end the phrase ("one of the file formats" abstains).
  `(?<one>one${SPACE}of${SPACE}(?:the|my|your|his|her|our|their|these|those))${SPACE}(?:[A-Za-z]+${SPACE}){0,3}?(?<noun>[A-Za-z]+)(?<tail>${SPACE}(?:is|was|has|had|does|did|can|could|will|would|should|must|seems|looks|that|which|who|where|with|in|on|at|of|for|to|from|I|I['’](?:ve|d|m)|we|you|they|he|she|it)(?!${EDGE})|[ \\t\\u00a0]{0,8}[.!?,;:])`,
];

/** Known inflections only; explicit counts win, ambiguous demonstratives require a choice. */
export function nounNumberConstructions(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const pattern of templates) {
    // Ownership waits for the choice between the demonstrative and the noun.
    for (const m of frameMatches(ctx, `${pattern}${WORD_END}`, null)) {
      const { one, count, dem, gap, noun, verb, tail } = m.groups!;
      const forms = englishNounForms(noun);
      if (!forms) continue;
      const before = ctx.scanText.slice(Math.max(0, m.index - 96), m.index);
      if (count && hasCountPrefix(before)) continue;
      // "a 1990 car", "the 3 bedroom flat": a year or a label modifies the noun.
      if (
        count &&
        /^[0-9]/.test(count) &&
        (/^(?:1[6-9]|20)[0-9]{2}$/.test(count) ||
          /\b(?:an?|the|this|that|its|his|her|their|our|my|your|every|each)[ \t ]+$/i.test(before))
      )
        continue;
      // Clause-initial "One leaves." is the pronoun and a verb; "One files arrived." is a count.
      if (count?.toLowerCase() === "one" && !tail && /(?:^|[.!?:;"“(][ \t\u00a0]*)$/.test(before))
        continue;
      if (hasUserOrCasedWord(ctx, m[0])) continue;
      const [nounStart, end] = m.indices!.groups!.noun;
      let start = nounStart;
      let alternatives: string[];
      let messageKey: RawFinding["messageKey"] = "review_msg_noun_count";
      let requiresChoice: true | undefined;
      const plural = applyWordCase(forms.plural, detectWordCase(noun));
      if (dem) {
        if (noun.toLowerCase() !== forms.singular) continue;
        const singularDem = applyWordCase(
          dem.toLowerCase() === "these" ? "this" : "that",
          detectWordCase(dem),
        );
        if (verb && /^(?:are|were)$/i.test(verb)) alternatives = [plural];
        else {
          start = m.indices!.groups!.dem[0];
          const singular = `${singularDem}${gap}${noun}`;
          alternatives = verb ? [singular] : [`${dem}${gap}${plural}`, singular];
          requiresChoice = verb ? undefined : true;
        }
        messageKey = requiresChoice ? "review_msg_noun_choice" : "review_msg_demonstrative_number";
      } else {
        const singular = count && (count.toLowerCase() === "one" || /^0*1$/.test(count));
        const corrected = applyWordCase(
          singular ? forms.singular : forms.plural,
          detectWordCase(noun),
        );
        if (corrected === noun) continue;
        alternatives = [corrected];
        if (one) messageKey = "review_msg_one_of";
      }
      if (start < ctx.from || start >= ctx.to) continue;
      if (findings.some((f) => f.range.start === start)) continue;
      findings.push({
        ruleId: "englishNounNumber",
        messageKey,
        range: { start, end },
        alternatives,
        requiresChoice,
        context: {
          start: Math.max(0, m.index - 96),
          end: Math.min(ctx.text.length, m.index + m[0].length + 9),
        },
      });
    }
  }
  return [...findings, ...decadePlurals(ctx)];
}

// "the 1990's" is a decade, not the year 1990's; names and versions ("Windows 10's") abstain.
const DECADE = new RegExp(
  `(?<![\\p{L}\\p{N}_'’@/#.\\\\-])(?:[Tt]he${SPACE}(?:(?:early|mid|late)[ \\t\\u00a0-]{1,8})?(?:(?<four>1[0-9]{2}0|20[0-9]0)|(?<two>[1-9]0))|(?<=(?:^|[(\\[“"‘]|\\b(?:in|from|during|since|of|through|until|by)[ \\t\\u00a0]{1,8}))(?<bare>1[0-9]{2}0|20[0-9]0)(?=['’]s[ \\t\\u00a0]{0,8}(?:[.!?,;:)\\]”"]|$))|(?<tens>[1-9]0{1,3})(?=['’]s${SPACE}of${SPACE}[a-z]))(?<mark>['’])s(?![\\p{L}\\p{N}_'’@/#\\\\-])`,
  "gdu",
);
function decadePlurals(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const digitsStart = ({ indices }: RegExpExecArray) => {
    const { four, two, bare, tens } = indices!.groups!;
    return (four ?? two ?? bare ?? tens)[0];
  };
  for (const m of frameMatches(ctx, DECADE, digitsStart)) {
    const { four, two, bare, tens, mark } = m.groups!;
    const digits = four ?? two ?? bare ?? tens;
    const start = digitsStart(m);
    const end = m.index + m[0].length;
    findings.push({
      ruleId: "englishNounNumber",
      messageKey: "review_msg_decade_plural",
      range: { start, end },
      alternatives: two ? [`${mark}${digits}s`, `${digits}s`] : [`${digits}s`],
      requiresChoice: two ? true : undefined,
      context: { start: Math.max(0, m.index - 96), end: Math.min(ctx.text.length, end + 9) },
    });
  }
  return findings;
}
