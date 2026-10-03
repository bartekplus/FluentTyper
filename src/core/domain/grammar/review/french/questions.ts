import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  conjugate,
  IL,
  ILS,
  isVerbHomograph,
  JE,
  NOUS,
  TU,
  verbReadings,
  VOUS,
} from "./frenchLexicon";
import { QUESTION_WORDS } from "./hyphenation";
import { CLITICS, ownedFrenchWords, tokensAfter, tokensBefore, wordFinding } from "./frenchTokens";
import { finding } from "../finding";
import { carryCase } from "../../implementations/helpers/GenericRuleShared";
import { isLang } from "../phraseTemplates";

// A subject pronoun joined after its verb agrees with it as before it: "sont-ils", "manges-tu",
// "pouvais-je", "partirons-nous". The euphonic t stands only before a singular: "viendra-t-il".

const RULE = "frenchSubjectVerbAgreement";
const MESSAGE = "review_msg_fr_subject_verb";

const PERSON: Record<string, number> = {
  je: JE,
  tu: TU,
  il: IL,
  elle: IL,
  on: IL,
  nous: NOUS,
  vous: VOUS,
  ils: ILS,
  elles: ILS,
};
// The pronoun of the other number or of the other plural person.
const SWAP: Record<string, string> = {
  il: "ils",
  elle: "elles",
  ils: "il",
  elles: "elle",
  nous: "vous",
  vous: "nous",
};

const PAIR =
  /(?<![\p{L}\p{M}\p{N}_'’-])(?<verb>\p{L}+)-(?<t>t-)?(?<pronoun>je|tu|il|elle|on|nous|vous|ils|elles)(?![\p{L}\p{M}\p{N}_'’-])/giu;

/** The verb and pronoun joined, with the euphonic t a third singular after a vowel needs. */
function joined(verb: string, pronoun: string): string {
  const third = PERSON[pronoun.toLowerCase()] === IL;
  return `${verb}${third && /[aeéc]$/i.test(verb) ? "-t-" : "-"}${pronoun}`;
}

/** "sont-il" -> "sont-ils", "mange-tu" -> "manges-tu", "pouvait-ils" -> "pouvaient-ils". */
function invertedAgreement(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const { verb: typedVerb, pronoun: typedPronoun, t } = m.groups!;
  const verb = typedVerb.toLowerCase();
  const pronoun = typedPronoun.toLowerCase();
  const person = PERSON[pronoun];
  if (/\p{Lu}/u.test(typedVerb.slice(1)) || ctx.dictionary.has(verb)) return null;
  if (namedExampleBefore(ctx.text, m.index)) return null;
  const readings = verbReadings(verb).filter((r) => typeof r.slot === "number");
  if (!readings.length) return null;
  const persons = readings.reduce((mask, r) => mask | (r.slot as number), 0);
  const euphonicPlural = !!t && person !== IL;
  if (persons & person && !euphonicPlural) return null;
  // "dussé-je", "aimé-je": the literary first person in -é.
  if (person === JE && verb.endsWith("é")) return null;
  // "Aidez-nous", "Laissons-vous": after an imperative "nous" and "vous" are objects. Only a
  // question word before the verb makes them its subject.
  if (person === NOUS || person === VOUS) {
    const previous = tokensBefore(ctx.text, m.index, 1)[0];
    if (!previous || !QUESTION_WORDS.has(previous.w)) return null;
  }
  const alternatives: string[] = [];
  // "aiment-t-ils": the verb agrees, the euphonic t goes.
  if (persons & person) alternatives.push(`${typedVerb}-${typedPronoun}`);
  const swapped = SWAP[pronoun];
  if (swapped && persons & PERSON[swapped])
    alternatives.push(joined(typedVerb, carryCase(typedPronoun, swapped)));
  for (const r of readings) {
    const form = conjugate(r, person)[0];
    if (form && form !== verb) alternatives.push(joined(carryCase(typedVerb, form), typedPronoun));
  }
  const unique = [...new Set(alternatives)];
  if (!unique.length || unique.length > 3) return null;
  return finding(RULE, MESSAGE, m.index, m.index + m[0].length, unique, {
    ...(unique.length > 1 ? { requiresChoice: true as const } : {}),
  });
}

// A stressed pronoun is the antecedent of "qui", whose verb takes its person: "toi qui as",
// "moi qui pensais", "nous qui partirons".
const STRESSED: Record<string, number> = {
  moi: JE,
  toi: TU,
  lui: IL,
  elle: IL,
  nous: NOUS,
  vous: VOUS,
  eux: ILS,
  elles: ILS,
};
const PRONOUN_QUI =
  /(?<![\p{L}\p{M}\p{N}_'’-])(?:(?<pronoun>moi|toi|lui|elle|nous|vous|eux|elles)(?:[ \t]+seule?s?)?[ \t]+qui|(?<demonstrative>ceux|celles))(?![\p{L}\p{M}\p{N}_'’-])/giu;

/** "C'est toi qui a" -> "as", "Et moi qui pensait" -> "pensais". */
function pronounAntecedent(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  // "Ceux me l'avaient dit": the plural demonstrative as a subject.
  const person = m.groups!.pronoun ? STRESSED[m.groups!.pronoun.toLowerCase()] : ILS;
  // Only where nothing else may be the antecedent: the sentence start, "et", "mais", or
  // "c'est" / "ce sont". "un ami de toi qui est venu" may be about the friend.
  const before = tokensBefore(ctx.text, m.index, 2);
  const previous = before[0]?.w;
  const presented =
    ["est", "sont", "était", "étaient", "sera"].includes(previous ?? "") &&
    ["c'", "ce"].includes(before[1]?.w ?? "");
  // "elle et moi qui savions": a coordinated antecedent.
  const opening = ["et", "mais"].includes(previous ?? "") && !before[1];
  if (previous && !presented && !opening) return null;
  if (namedExampleBefore(ctx.text, m.index)) return null;
  const after = tokensAfter(ctx.text, m.index + m[0].length, 5);
  let i = 0;
  while (after[i] && (CLITICS.has(after[i].w) || after[i].w === "ne" || after[i].w === "n'")) i++;
  const verb = after[i];
  if (!verb || verb.hyphen) return null;
  const auxiliary = verbReadings(verb.w).some((r) => r.lemma === "avoir" || r.lemma === "être");
  if (isVerbHomograph(verb.w) && !auxiliary) return null;
  if (ctx.text.slice(verb.start, verb.end) !== verb.w) return null;
  const readings = verbReadings(verb.w);
  if (!readings.length || !readings.every((r) => typeof r.slot === "number")) return null;
  if (readings.some((r) => (r.slot as number) & person)) return null;
  const forms = [...new Set(readings.map((r) => conjugate(r, person)[0]).filter(Boolean))];
  if (!forms.length || forms.length > 2) return null;
  const found = wordFinding(ctx, verb.start, verb.w, forms, RULE, MESSAGE);
  return found && { ...found, context: { start: m.index, end: verb.end } };
}

function questions(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "fr")) return [];
  const findings: RawFinding[] = [];
  for (const m of ownedFrenchWords(ctx, PAIR)) {
    const found = invertedAgreement(ctx, m);
    if (found) findings.push(found);
  }
  for (const m of ownedFrenchWords(ctx, PRONOUN_QUI)) {
    const found = pronounAntecedent(ctx, m);
    if (found) findings.push(found);
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: questions }];
