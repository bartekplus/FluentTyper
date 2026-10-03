import type { DetectContext, RawFinding } from "../reviewDetectors";
import {
  adjectiveForm,
  adjectiveOf,
  cases,
  finiteVerb,
  nounTags,
  onlyNoun,
  pastByShape,
} from "./lexicon";
import { caseLike, CLAUSE_START, findingAt, isPl, owned, S, userOrNamed } from "./shared";

/*
 * Subject and verb: a past form agrees with "on"/"ona" in gender ("ona poszła", not "ona
 * poszedł"), and "został"/"została"/"zostało"/"zostały" with the adjective or participle
 * after it ("zostało zrobione", not "zostało zrobiony").
 */

const RULE = "polishCaseAgreement" as const;
const MESSAGE = "review_msg_pl_subject_verb" as const;

/** Short words that may stand between a subject pronoun and its verb ("ona już wyszła"). */
const BETWEEN = `(?:(?:się|nie|już|też|także|również|wtedy|wczoraj|dziś|zawsze|nigdy|jednak|często|szybko|nagle|wreszcie|tylko)${S}){0,2}`;
const PRONOUN_VERB = new RegExp(
  `(?<![\\p{L}\\p{N}_'’@/-])(?<pronoun>on|ona)${S}${BETWEEN}(?<verb>\\p{Ll}{2,}ł(?<fem>a)?)(?![\\p{L}\\p{N}_'’@/-])`,
  "giud",
);
// "Przywróciła on pokój": the verb opens the clause, the pronoun follows it.
const VERB_PRONOUN = new RegExp(
  `${CLAUSE_START}(?<verb>\\p{L}{3,}ł(?<fem>a)?)${S}(?<pronoun>on|ona)(?![\\p{L}\\p{N}_'’@/-])`,
  "gud",
);

const pastForm = (word: string) => finiteVerb(word) || pastByShape(word);

/** "on poszła", "ona przyszedł": the pronoun disagrees with the past form's gender. */
function pronounGender(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const regex of [PRONOUN_VERB, VERB_PRONOUN])
    for (const m of owned(ctx, regex)) {
      const { pronoun, verb, fem } = m.groups!;
      const feminine = pronoun.toLowerCase() === "ona";
      if (feminine === !!fem || !pastForm(verb.toLowerCase()) || userOrNamed(ctx, verb)) continue;
      const [start, end] = m.indices!.groups!.pronoun;
      findings.push({
        ...findingAt(ctx, start, end, [caseLike(pronoun, feminine ? "on" : "ona")], RULE, MESSAGE),
        context: { start: m.index, end: m.index + m[0].length },
      });
    }
  return findings;
}

const ZOSTAC = "został|została|zostało|zostały";
const AUX_FIRST = new RegExp(
  `(?<![\\p{L}\\p{N}_'’@/-])(?<aux>${ZOSTAC})${S}(?<word>\\p{Ll}{3,})(?![\\p{L}\\p{N}_'’@/-])`,
  "giud",
);
// "Zrobiony zostało": the participle opens the clause.
const AUX_AFTER = new RegExp(
  `${CLAUSE_START}(?<word>\\p{L}{3,})${S}(?<aux>${ZOSTAC})(?![\\p{L}\\p{N}_'’@/-])`,
  "gud",
);

/** "zostało zrobiony" -> "zrobione": the nominative after "zostać" takes the verb's gender. */
function zostacAgreement(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const regex of [AUX_FIRST, AUX_AFTER])
    for (const m of owned(ctx, regex)) {
      const { aux, word } = m.groups!;
      const lower = word.toLowerCase();
      const adjective = adjectiveOf(lower);
      if (!adjective || userOrNamed(ctx, word) || onlyNoun(nounTags(lower))) continue;
      const { lemma } = adjective;
      const forms = [lemma, adjectiveForm(lemma, "a"), adjectiveForm(lemma, "e")];
      if (!forms.includes(lower)) continue;
      const wanted = { został: 0, została: 1, zostało: 2, zostały: 2 }[aux.toLowerCase()]!;
      if (forms[wanted] === lower) continue;
      const [start, end] = m.indices!.groups!.word;
      findings.push({
        ...findingAt(ctx, start, end, [caseLike(word, forms[wanted])], RULE, MESSAGE),
        context: { start: m.index, end: m.index + m[0].length },
      });
    }
  return findings;
}

/** Numerals in the genitive ("od jakichś kilku lat"). */
const GENITIVE_COUNT =
  /^(?:kilku|paru|kilkunastu|kilkudziesięciu|kilkuset|dwóch|dwu|trzech|czterech|pięciu|sześciu|siedmiu|ośmiu|dziewięciu|dziesięciu|stu|tysięcy|wielu|niewielu)$/u;
const JAKIS = new RegExp(
  `(?<![\\p{L}\\p{N}_'’@/-])(?<target>jakiś)${S}(?<next>\\p{Ll}{3,})(?![\\p{L}\\p{N}_'’@/-])`,
  "giud",
);
const SINGULAR_DIRECT = cases("Ns As Gs Ds Is Ls Vs Np");
const PLURAL_OBLIQUE = cases("Gp Lp");

/** "jakiś dziewczyn", "od jakiś kilku lat" -> "jakichś": the genitive or locative plural. */
function jakis(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, JAKIS)) {
    const { target, next } = m.groups!;
    const tags = nounTags(next.toLowerCase());
    const plural =
      GENITIVE_COUNT.test(next.toLowerCase()) ||
      (onlyNoun(tags) && tags & PLURAL_OBLIQUE && !(tags & SINGULAR_DIRECT));
    if (!plural || userOrNamed(ctx, next)) continue;
    const [start, end] = m.indices!.groups!.target;
    findings.push({
      ...findingAt(ctx, start, end, [caseLike(target, "jakichś")], RULE, "review_msg_pl_agreement"),
      context: { start: m.index, end: m.index + m[0].length },
    });
  }
  return findings;
}

export const DETECTORS = [
  {
    rules: [RULE] as RawFinding["ruleId"][],
    detect: (ctx: DetectContext) =>
      isPl(ctx) ? [...pronounGender(ctx), ...zostacAgreement(ctx), ...jakis(ctx)] : [],
  },
];
