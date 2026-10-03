import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  adjectiveReadings,
  finitePersons,
  IL,
  ILS,
  isInflectedNoun,
  isVerbHomograph,
  nounGender,
  TU,
  verbReadings,
  VOUS,
} from "./frenchLexicon";
import {
  ownedFrenchWords,
  SUBJECT_PRONOUNS,
  type Token,
  tokensAfter,
  tokensBefore,
} from "./frenchTokens";

// A comma never parts words that hold together: a subject pronoun and its verb ("Il, arrive"), a
// determiner and its noun ("les, jolies filles"), "ne" and the verb, an object pronoun and its
// verb, an auxiliary or a modal and its participle or infinitive ("il a, réussi"), "parce" and
// "que". An inserted phrase closes with a second comma ("il a, bien sûr, réussi"): left alone.

const RULE = "frenchCommas";
const MESSAGE = "review_msg_fr_stray_comma";
const MISSING = "review_msg_fr_missing_comma";

/** Subject pronouns never stressed: "elle", "nous", "vous" may open a dislocation ("Elle, elle
 * sait"). */
const CLITIC_SUBJECTS = new Set(["je", "tu", "il", "ils", "on"]);
const DETERMINERS = new Set(
  "les des ces mes tes ses nos vos cette cet ma ta mon notre votre leurs".split(" "),
);
const OBJECT_CLITICS = new Set("me m' te t' se s' le la les lui leur y en".split(" "));
// A negation before the comma is left out: "j'en peux plus, avancer !" calls out.
const ADVERBS = new Set(
  "déjà bien toujours encore souvent vraiment beaucoup aussi enfin".split(" "),
);
// Words that open an insertion after a relative or a conjunction: "qui, sans sa copie, ...".
const INSERTION_OPENERS = new Set(
  (
    "si quand lorsque lorsqu' comme pour par sans avec dans sur sous selon malgré après avant " +
    "en à au aux de d' du des depuis pendant entre vers ni bien même surtout notamment"
  ).split(" "),
);
const NEGATIONS = new Set(["pas", "plus", "jamais", "rien", "guère"]);
const MODALS = new Set(["pouvoir", "devoir", "vouloir", "savoir", "aller", "falloir"]);
const STRESSED = new Set("moi toi lui elle nous vous eux elles".split(" "));
// Words that open a clause or a relative and take their words without a comma when no second
// comma closes an insertion.
const OPENERS = new Set(
  "qui que qu' où ni parce lorsque lorsqu' puisque puisqu' quoique".split(" "),
);

const finite = (word: string) =>
  verbReadings(word).some((r) => typeof r.slot === "number") && !isVerbHomograph(word);
const auxiliary = (word: string) =>
  word === "été" ||
  verbReadings(word).some(
    (r) => typeof r.slot === "number" && (r.lemma === "avoir" || r.lemma === "être"),
  );
const modal = (word: string) =>
  verbReadings(word).some((r) => typeof r.slot === "number" && MODALS.has(r.lemma));

/** Index past the subject pronoun, "ne" and object pronouns before `k`, or -1 without one.
 * With `plain`, "en", "y" and a reflexive pronoun make a verb of its own ("elle s'en fut,
 * caressée par la brise"): -1. */
function subjectBefore(left: Token[], k: number, plain = false): number {
  while (left[k] && (OBJECT_CLITICS.has(left[k].w) || left[k].w === "ne" || left[k].w === "n'")) {
    if (plain && ["en", "y", "se", "s'"].includes(left[k].w)) return -1;
    k++;
  }
  return left[k] && SUBJECT_PRONOUNS.has(left[k].w) ? k : -1;
}

function stray(left: Token[], right: Token[]): boolean {
  const [l0, l1] = left;
  const r0 = right[0];
  if (!l0 || !r0) return false;
  // "Il, arrive demain": a subject pronoun opening its clause.
  if (CLITIC_SUBJECTS.has(l0.w))
    return left.length === 1 && !SUBJECT_PRONOUNS.has(r0.w) && !["et", "ou"].includes(r0.w);
  // "Les, jolies filles": a determiner and what it determines; "les leurs" is a pronoun.
  if (DETERMINERS.has(l0.w)) {
    if (l1 && ["le", "la", "les"].includes(l1.w)) return false;
    return nounGender(r0.w) !== null || isInflectedNoun(r0.w) || adjectiveReadings(r0.w).length > 0;
  }
  if (l0.w === "ne") return true;
  if (l0.w === "parce") return r0.w === "que" || r0.w === "qu'";
  // "de, ne plus le faire": a preposition and its infinitive.
  if (l0.w === "de") return r0.w === "ne" || r0.w === "n'";
  // "Il ne vient, pas": the two parts of a negation around the verb.
  if (NEGATIONS.has(r0.w) && left.slice(1, 4).some((t) => t.w === "ne" || t.w === "n'"))
    return verbReadings(l0.w).some((r) => typeof r.slot === "number");
  // "Lesquelles, arrivent": an interrogative pronoun and its verb.
  if (left.length === 1 && /^les?quel(?:le)?s?$|^laquelle$/.test(l0.w)) return finite(r0.w);
  // "C'est lui, qui part": a cleft.
  if (STRESSED.has(l0.w) && l1?.w === "est" && left[2]?.w === "c'") return r0.w === "qui";
  // "Il lui, dit", "Ils vont se, manger": an object pronoun and its verb.
  if (OBJECT_CLITICS.has(l0.w) && l0.w !== "en" && l0.w !== "la") {
    if (subjectBefore(left, 1) < 0 && !(l1 && modal(l1.w))) return false;
    // After an object pronoun a form also spelled as a noun is the verb ("il le, dit").
    return verbReadings(r0.w).some((r) => typeof r.slot === "number" || r.slot === "I");
  }
  // "Il a, réussi", "il a déjà, réussi", "il doit, toujours réussir".
  let k = 0;
  while (left[k] && ADVERBS.has(left[k].w)) k++;
  const verb = left[k];
  // "il a été, aperçu": the passive's auxiliary before "été".
  const passive = verb?.w === "été" && left[k + 1] && auxiliary(left[k + 1].w) ? 1 : 0;
  if (verb && subjectBefore(left, k + 1 + passive, true) >= 0) {
    let j = 0;
    while (right[j] && ADVERBS.has(right[j].w)) j++;
    const next = right[j];
    // "Tout occupé que tu sois, tu dois": a new clause's subject ("tu" is also a participle).
    if (!next || SUBJECT_PRONOUNS.has(next.w)) return false;
    if (auxiliary(verb.w) && verbReadings(next.w).some((r) => r.slot === "Q")) return true;
    if (modal(verb.w) && verbReadings(next.w).some((r) => r.slot === "I" && r.lemma === next.w))
      return true;
  }
  // "Le chat qui, arrive", "le lieu où, le chat arrive"; "qui, sans sa copie" opens an insertion.
  if (OPENERS.has(l0.w))
    return left.length > 1 && !ADVERBS.has(r0.w) && !INSERTION_OPENERS.has(r0.w);
  // "Cela, arrive", "Les enfants, arrivent demain": a subject opening its clause and its verb.
  if (!finite(r0.w) || right[1]?.hyphen) return false;
  const persons = finitePersons(r0.w);
  // "Les enfants, venez": a call and an imperative.
  if (persons & (TU | VOUS)) return false;
  if (left.length === 1 && ["cela", "ça", "ceci"].includes(l0.w)) return (persons & IL) > 0;
  if (left.length === 2 && ["les", "des", "ces", "mes", "tes", "ses", "nos", "vos"].includes(l1.w))
    return (
      /[sx]$/.test(l0.w) &&
      (persons & ILS) > 0 &&
      (nounGender(l0.w.slice(0, -1)) !== null || isInflectedNoun(l0.w.slice(0, -1)))
    );
  return false;
}

const COMMA = /(?<=\p{L})[ \t]?,[ \t]{1,4}(?=\p{Ll})/gu;

function strayCommas(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "fr") return [];
  const findings: RawFinding[] = [];
  for (const m of ownedFrenchWords(ctx, COMMA)) {
    const comma = m.index + m[0].indexOf(",");
    // A second comma before the clause ends closes an insertion: "il a, bien sûr, réussi".
    const rest = ctx.text.slice(comma + 1, comma + 300);
    const end = rest.search(/[,.;:!?…\n()«»"“”—]/u);
    if (end < 0 || rest[end] === ",") continue;
    const left = tokensBefore(ctx.text, m.index, 6);
    const right = tokensAfter(ctx.text, m.index + m[0].length, 4);
    if (!left[0] || ctx.text[left[0].start - 1] === "-" || left.some((t) => t.hyphen)) continue;
    // Names, acronyms and words in capitals keep their punctuation.
    if (/\p{Lu}/u.test(ctx.text.slice(left[0].start + 1, left[0].end))) continue;
    if (namedExampleBefore(ctx.text, left[0].start) || !stray(left, right)) continue;
    findings.push({
      ruleId: RULE,
      messageKey: MESSAGE,
      range: { start: m.index, end: m.index + m[0].length },
      alternatives: [" "],
      context: { start: left[0].start, end: right[0].end },
    });
  }
  return findings;
}

// A reporting verb inverted with its subject is set off by commas: "Il viendra, dit-elle, demain".
const REPORTING =
  /[ \t]{1,4}(?:(?:me|te|lui|leur|nous|vous)[ \t]{1,4})?(?:dit|disait|répondit|répond|ajouta|ajoute|demanda|demande|répliqua|réplique|expliqua|explique|poursuivit|poursuit|reprit|murmura|murmure|cria|lança|lance|affirma|affirme|déclara|déclare|souffla|souffle|soupira|soupire|précisa|précise|insista|insiste|conclut|répéta|répète)-(?:t-)?(?:il|elle|on|ils|elles)(?![\p{L}\p{M}\p{N}_'’-])/giu;
// Words after which an inversion asks or follows an adverb: "que dit-il ?", "ainsi dit-il".
const NOT_INCISE = new Set(
  (
    "que qu' comment pourquoi où quand combien quoi qui ainsi aussi peut-être encore doute moins " +
    "peine sans tant toujours"
  ).split(" "),
);

/** "Il le pense dit-elle mais": the inverted reporting verb between commas. */
function reportingComma(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const before = tokensBefore(ctx.text, m.index, 1)[0];
  if (!before || before.end !== m.index || NOT_INCISE.has(before.w)) return null;
  // "Ne dit-on pas", "il a dit-on pu": a question, or "dit-on" inside a compound tense.
  if (before.w === "ne" || verbReadings(before.w).some((r) => r.lemma === "avoir")) return null;
  if (ctx.text[before.start - 1] === "-" || namedExampleBefore(ctx.text, m.index)) return null;
  const end = m.index + m[0].length;
  // A word goes on after it: a comma closes the insertion too.
  const after = /^[ \t]{1,4}(?=\p{L})/u.exec(ctx.text.slice(end, end + 5));
  const inner = m[0].trimStart();
  return {
    ruleId: RULE,
    messageKey: MISSING,
    range: { start: m.index, end: after ? end + after[0].length : end },
    alternatives: [after ? `, ${inner}, ` : `, ${inner}`],
    context: { start: before.start, end },
  };
}

const SUPERLATIVES = new Set(["plus", "moins", "mieux", "pire", "pis", "meilleur", "meilleure"]);
const TIMES = new Set(
  (
    "jour matin soir nuit semaine mois an année fois heure moment instant été hiver automne " +
    "printemps week-end lendemain veille midi"
  ).split(" "),
);

/** "Le plus grand c'est Pierre", "Ces photos je les aime": a fronted phrase taken up by "c'est"
 * or by a pronoun takes a comma. */
function frontedComma(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const left = tokensBefore(ctx.text, m.index, 5);
  const first = left.at(-1);
  if (!first || left.length < 2 || left.length > 4) return null;
  // The phrase opens its sentence.
  if (!/(?:^|[.!?…]\s{0,8}|\n)$/u.test(ctx.text.slice(Math.max(0, first.start - 9), first.start)))
    return null;
  if (left.some((t) => t.hyphen) || namedExampleBefore(ctx.text, first.start)) return null;
  const right = tokensAfter(ctx.text, m.index + m[0].length, 3);
  const det = first.w;
  let fronted = false;
  if (["c'", "ce", "cela", "ça"].includes(right[0]?.w ?? "")) {
    // "Le plus grand c'est", "le pire ce fut", "le mieux cela serait".
    fronted = ["le", "la", "les"].includes(det) && SUPERLATIVES.has(left.at(-2)!.w);
  } else if (left.length === 2 && SUBJECT_PRONOUNS.has(right[0]?.w ?? "") && right[2]) {
    // "Ces photos je les aime", "ce gâteau je le mange": the object taken up by its pronoun.
    const noun = left[0];
    const plural = ["les", "ces", "mes", "tes", "ses", "nos", "vos", "leurs"].includes(det);
    const singular = ["le", "ce", "cet", "cette", "mon", "ton", "son", "ma", "ta", "sa"].includes(
      det,
    );
    const clitic = right[1].w;
    const takenUp = plural ? clitic === "les" : singular && ["le", "la", "l'"].includes(clitic);
    const nounWord = ctx.text.slice(noun.start, noun.end) === noun.w && !TIMES.has(noun.w);
    fronted =
      takenUp &&
      nounWord &&
      (nounGender(noun.w.replace(/[sx]$/, "")) !== null ||
        isInflectedNoun(noun.w.replace(/[sx]$/, ""))) &&
      verbReadings(right[2].w).some((r) => typeof r.slot === "number");
  }
  if (!fronted) return null;
  return {
    ruleId: RULE,
    messageKey: MISSING,
    range: { start: m.index, end: m.index + m[0].length },
    alternatives: [", "],
    context: { start: first.start, end: right[0].end },
  };
}

const FRONT_GAP =
  /(?<=\p{L})[ \t]{1,4}(?=c['’]|(?:ce|cela|ça|je|tu|il|elle|on|nous|vous|ils|elles)(?![\p{L}\p{M}\p{N}_-]))/gu;

function commas(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "fr") return [];
  const findings = strayCommas(ctx);
  for (const m of ownedFrenchWords(ctx, REPORTING)) {
    const finding = reportingComma(ctx, m);
    if (finding) findings.push(finding);
  }
  for (const m of ownedFrenchWords(ctx, FRONT_GAP)) {
    const finding = frontedComma(ctx, m);
    if (finding) findings.push(finding);
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: commas }];
