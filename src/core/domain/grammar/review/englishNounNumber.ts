import { englishNounForms, hasCountPrefix } from "../implementations/helpers/EnglishNounNumber";
import { applyWordCase, detectWordCase } from "../implementations/helpers/GenericRuleShared";
import { around, group, hasUserOrCasedWord } from "./phraseTemplates";
import type { RawFinding } from "./reviewDetectors";
import type { MatchFixer } from "../engine/reviewRules";
import { finding } from "./finding";

// A determiner and a label before the number: "a grade 9", "my term 1", "the iOS 12". Not an
// ordinal or a quantity word ("the last 3 car").
const LABEL_WITH_NUMBER =
  /\b(?:an?|the|this|that|its|his|her|their|our|my|your|every|each)[ \t\u00a0]+(?!(?:first|last|next|other|top|best|only|few|many|same|final|initial|whole|entire|remaining|extra)\b)[\p{L}]+[ \t\u00a0]+$/iu;

const nounCount: MatchFixer = (m, ctx) => {
  const findings: RawFinding[] = [];
  const { one, count, dem, gap, noun, verb, tail } = m.groups!;
  const forms = englishNounForms(noun);
  if (!forms) return null;
  const before = ctx.scanText.slice(Math.max(0, m.index - 96), m.index);
  if (count && hasCountPrefix(before)) return null;
  // "a 1990 car", "the 3 bedroom flat": a year or a label modifies the noun. So does a
  // name or label with its number: "a grade 9 student", "a Word 97 file", "N+1 queries".
  if (
    count &&
    /^[0-9]/.test(count) &&
    (/^(?:1[6-9]|20)[0-9]{2}$/.test(count) ||
      /\b(?:an?|the|this|that|its|his|her|their|our|my|your|every|each)[ \t ]+$/i.test(before) ||
      /[+−×*/^-]$/.test(before) ||
      LABEL_WITH_NUMBER.test(before))
  )
    return null;
  // Clause-initial "One leaves." is the pronoun and a verb; "One files arrived." is a count.
  if (count?.toLowerCase() === "one" && !tail && /(?:^|[.!?:;"“(][ \t\u00a0]*)$/.test(before))
    return null;
  if (hasUserOrCasedWord(ctx, m[0])) return null;
  const [nounStart, end] = group(m, "noun");
  let start = nounStart;
  let alternatives: string[];
  let messageKey: RawFinding["messageKey"] = "review_msg_noun_count";
  let requiresChoice: true | undefined;
  const plural = applyWordCase(forms.plural, detectWordCase(noun));
  if (dem) {
    if (noun.toLowerCase() !== forms.singular) return null;
    const singularDem = applyWordCase(
      dem.toLowerCase() === "these" ? "this" : "that",
      detectWordCase(dem),
    );
    if (verb && /^(?:are|were)$/i.test(verb)) alternatives = [plural];
    else {
      start = group(m, "dem")[0];
      const singular = `${singularDem}${gap}${noun}`;
      alternatives = verb ? [singular] : [`${dem}${gap}${plural}`, singular];
      requiresChoice = verb ? undefined : true;
    }
    messageKey = requiresChoice ? "review_msg_noun_choice" : "review_msg_demonstrative_number";
  } else {
    const singular = count && (count.toLowerCase() === "one" || /^0*1$/.test(count));
    const corrected = applyWordCase(singular ? forms.singular : forms.plural, detectWordCase(noun));
    if (corrected === noun) return null;
    alternatives = [corrected];
    if (one) messageKey = "review_msg_one_of";
  }
  if (start < ctx.from || start >= ctx.to) return null;
  if (findings.some((f) => f.range.start === start)) return null;
  findings.push(
    finding("englishNounNumber", messageKey, start, end, alternatives, {
      requiresChoice,
      context: around(ctx, m),
    }),
  );
  return findings;
};

const decadePlural: MatchFixer = (m, ctx) => {
  const findings: RawFinding[] = [];
  const digitsStart = ({ indices }: RegExpExecArray) => {
    const { four, two, bare, tens } = indices!.groups!;
    return (four ?? two ?? bare ?? tens)[0];
  };
  if (digitsStart(m) < ctx.from || digitsStart(m) >= ctx.to) return null;
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
    context: around(ctx, m),
  });
  return findings;
};

/** The named frame fixes of the englishNounNumber frames of grammar/rules/common.yaml. */
export const FIXERS = { nounCount, decadePlural } satisfies Record<string, MatchFixer>;
