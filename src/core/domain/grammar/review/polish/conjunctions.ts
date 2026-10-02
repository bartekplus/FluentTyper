import type { DetectContext, RawFinding } from "../reviewDetectors";
import { finiteVerb, nounTags } from "./lexicon";
import { caseLike, findingAt, isPl, owned, userOrNamed } from "./shared";

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

const CLAUSE = new RegExp(
  `(?<![\\p{L}])(?<conj>żeby|ażeby|aby|gdyby)(?<person>m|ś|śmy|ście)?(?<between>(?:[ \\t\\u00a0]{1,8}(?!(?:że|który|która|które|i|a|ale|lub|oraz)[ \\t\\u00a0])\\p{L}{1,15}){0,3}?)[ \\t\\u00a0]{1,8}(?<verb>\\p{Ll}{2,}(?:łbym|łabym|łbyś|łabyś|libyśmy|łybyśmy|libyście|łybyście|łem|łam|łeś|łaś|liśmy|łyśmy|liście|łyście))(?![\\p{L}])`,
  "giu",
);

function conjunctionEndings(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, CLAUSE)) {
    const { conj, person, between, verb } = m.groups!;
    // "żeby przed stołem", "aby działem": a noun in -łem is no verb.
    if (nounTags(verb.toLowerCase()) || userOrNamed(ctx, verb)) continue;
    const ending = ENDINGS.find(([regex]) => regex.test(verb));
    if (!ending) continue;
    const [regex, bare, ownPerson] = ending;
    const fixedVerb = verb.replace(regex, bare);
    // "gdybyś zrobiłeś": the conjunction already has it; otherwise it moves there.
    const fixedConj = person ? `${conj}${person}` : `${conj}${ownPerson}`;
    if (person && person !== ownPerson) continue;
    findings.push(
      findingAt(
        ctx,
        m.index,
        m.index + m[0].length,
        [`${caseLike(conj, fixedConj)}${between} ${fixedVerb}`],
        RULE,
        MESSAGE,
      ),
    );
  }
  return findings;
}

/** "żebyś przeczyta", "by będzie": a present or future form where the past one goes. */
const PRESENT_AFTER = new RegExp(
  `(?<![\\p{L}])(?:żeby|ażeby|aby|by)(?:m|ś|śmy|ście)?[ \\t\\u00a0]{1,8}(?:(?:nie|się)[ \\t\\u00a0]{1,8})?(?<verb>\\p{Ll}{2,})(?![\\p{L}])`,
  "giu",
);
const PAST = /(?:ł|ła|ło|li|ły)$/u;

function presentAfterConjunction(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, PRESENT_AFTER)) {
    const { verb } = m.groups!;
    if (PAST.test(verb) || !finiteVerb(verb) || userOrNamed(ctx, verb)) continue;
    const start = m.index + m[0].length - verb.length;
    findings.push(findingAt(ctx, start, start + verb.length, [], RULE, MESSAGE));
  }
  return findings;
}

export const DETECTORS = [
  {
    rules: [RULE] as RawFinding["ruleId"][],
    detect: (ctx: DetectContext) =>
      isPl(ctx) ? [...conjunctionEndings(ctx), ...presentAfterConjunction(ctx)] : [],
  },
];
