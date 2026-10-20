import type { MatchFixer, MatchResult } from "../../engine/reviewRules";
import type { DetectContext } from "../reviewDetectors";
import { finiteVerb, imperativeVerb, nounTags } from "./lexicon";
import { caseLike, findingAt, userOrNamed } from "./shared";

/*
 * "żeby", "aby", "gdyby" carry the person ending themselves: "żebym zrobił", not "żeby
 * zrobiłem" or "żeby zrobiłbym"; "gdybyś zrobił", not "gdybyś zrobiłeś".
 */

const RULE = "polishCaseAgreement" as const;
const MESSAGE = "review_msg_pl_conjunction_ending" as const;

/** The verb's past-tense or conditional ending -> [its bare past form ending, the person ending]. */
const ENDINGS: Array<[RegExp, string, string]> = [
  [/łbym$/u, "ł", "m"],
  [/łabym$/u, "ła", "m"],
  [/łbyś$/u, "ł", "ś"],
  [/łabyś$/u, "ła", "ś"],
  [/libyśmy$/u, "li", "śmy"],
  [/łybyśmy$/u, "ły", "śmy"],
  [/libyście$/u, "li", "ście"],
  [/łybyście$/u, "ły", "ście"],
  [/łem$/u, "ł", "m"],
  [/łam$/u, "ła", "m"],
  [/łeś$/u, "ł", "ś"],
  [/łaś$/u, "ła", "ś"],
  [/liśmy$/u, "li", "śmy"],
  [/łyśmy$/u, "ły", "śmy"],
  [/liście$/u, "li", "ście"],
  [/łyście$/u, "ły", "ście"],
];

function conjunctionEndings(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const { conj, person, between, verb } = m.groups!;
  // "żeby przed stołem", "aby działem": a noun in -łem is no verb.
  if (nounTags(verb.toLowerCase()) || userOrNamed(ctx, verb)) return null;
  const ending = ENDINGS.find(([regex]) => regex.test(verb));
  if (!ending) return null;
  const [regex, bare, ownPerson] = ending;
  const fixedVerb = verb.replace(regex, bare);
  // "gdybyś zrobiłeś": the conjunction already has it; otherwise it moves there.
  const fixedConj = person ? `${conj}${person}` : `${conj}${ownPerson}`;
  if (person && person !== ownPerson) return null;
  return findingAt(
    ctx,
    m.index,
    m.index + m[0].length,
    [`${caseLike(conj, fixedConj)}${between} ${fixedVerb}`],
    RULE,
    MESSAGE,
  );
}

const PAST = /(?:ł|ła|ło|li|ły)$/u;

function presentAfterConjunction(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const { verb } = m.groups!;
  if (PAST.test(verb) || userOrNamed(ctx, verb)) return null;
  const imperative = imperativeVerb(verb);
  if (!imperative && !finiteVerb(verb)) return null;
  const start = m.index + m[0].length - verb.length;
  return findingAt(ctx, start, start + verb.length, [], RULE, imperative ? IMPERATIVE : MESSAGE);
}

const IMPERATIVE = "review_msg_pl_imperative" as const;

/** "Wiem, że przeczytaj", "Czy przeczytaj tę książkę?": an imperative in a clause. */
function imperativeAfterConjunction(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const { verb } = m.groups!;
  if (!imperativeVerb(verb) || userOrNamed(ctx, verb)) return null;
  const [start, end] = m.indices!.groups!.verb;
  return findingAt(ctx, start, end, [], RULE, IMPERATIVE);
}

/** The named frame fixes of the conjunction rule of grammar/rules/pl.yaml (`fixer:`). */
export const FIXERS = {
  conjunctionEndings,
  presentAfterConjunction,
  imperativeAfterConjunction,
} satisfies Record<string, MatchFixer>;
