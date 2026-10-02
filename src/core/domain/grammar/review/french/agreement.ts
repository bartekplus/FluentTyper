import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  adjectiveReadings,
  conjugate,
  isInflectedNoun,
  nounGender,
  IL,
  ILS,
  isVerbHomograph,
  JE,
  NOUS,
  TU,
  verbReadings,
  VOUS,
  type VerbReading,
} from "./frenchLexicon";
import {
  CLITICS,
  ownedFrenchWords,
  type Token,
  tokensAfter,
  tokensBefore,
  withCase,
} from "./frenchTokens";

// A personal pronoun subject and its verb agree in person and number: "je peux", "tu manges",
// "ils mangent". The verb's possible persons come from the dictionary's conjugations.

const RULE = "frenchSubjectVerbAgreement";
const MESSAGE = "review_msg_fr_subject_verb";

const PERSON: Record<string, number> = {
  je: JE,
  "j'": JE,
  tu: TU,
  il: IL,
  elle: IL,
  on: IL,
  nous: NOUS,
  vous: VOUS,
  ils: ILS,
  elles: ILS,
};
/** Pronouns that are always subjects; the others may be objects or stressed ("pour elle"). */
const ALWAYS_SUBJECT = new Set(["je", "j'", "tu", "il", "on", "ils"]);
const OPENERS = new Set(
  "et mais ou donc car que qu' quand si lorsque lorsqu' puisque puisqu' comme où alors puis".split(
    " ",
  ),
);
const NEGATION = new Set(["ne", "n'"]);
const SUBJECT_PRONOUNS_ALL = new Set("je j' tu il elle on nous vous ils elles".split(" "));
/** Words that name the pronoun after them rather than let it be a subject. */
const NAMING = new Set(["pronom", "personnel", "mot", "terme", "le", "un", "du", "au"]);
const COORDINATING_OR_RELATIVE = new Set(["et", "ou", "que", "qu'", "où"]);

const finite = (r: VerbReading) => typeof r.slot === "number";

/** "je peut" -> "peux", "ils mange" -> "mangent", "tu rêver" -> "rêves". */
function agreement(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const pronoun = m[0].toLowerCase().replace("’", "'");
  const person = PERSON[pronoun];
  if (ctx.text[m.index - 1] === "-" || namedExampleBefore(ctx.text, m.index)) return null;
  const previous = tokensBefore(ctx.text, m.index, 1)[0];
  // "le pronom tu n'est pas omis", "le je": the pronoun named, not a subject.
  if (previous && NAMING.has(previous.w)) return null;
  // "elle", "nous", "vous" open a clause only at its start or after a conjunction; "que vous
  // offrent ces cours", "Pierre et elle étaient" make them objects or a coordinated subject.
  const stressed = !ALWAYS_SUBJECT.has(pronoun);
  if (
    stressed &&
    previous &&
    (!OPENERS.has(previous.w) || COORDINATING_OR_RELATIVE.has(previous.w))
  )
    return null;
  // "Peux tu aller", "que veut tu": an unhyphenated inversion.
  if (previous && !isVerbHomograph(previous.w) && verbReadings(previous.w).some(finite))
    return null;
  const after = tokensAfter(ctx.text, m.index + m[0].length, 5);
  let i = 0;
  while (after[i] && (NEGATION.has(after[i].w) || CLITICS.has(after[i].w))) i++;
  const verb = after[i];
  if (!verb || verb.hyphen || ctx.dictionary.has(verb.w)) return null;
  // "Je est un autre": "je" as a noun, a third person; an elided "j'est" is a slip.
  if (pronoun === "je" && i === 0 && verb.w === "est") return null;
  const typed = ctx.text.slice(verb.start, verb.end);
  // A name or an acronym is no verb form.
  if (/\p{Lu}/u.test(typed)) return null;
  // A form that is also a noun ("est", "porte") is the verb only after an always-subject pronoun.
  if (isVerbHomograph(verb.w) && (stressed || pronoun === "on")) return null;
  const readings = verbReadings(verb.w);
  if (!readings.length) return null;
  let alternatives: string[];
  if (readings.every(finite)) {
    const persons = readings.reduce((mask, r) => mask | (r.slot as number), 0);
    if (persons & person) return null;
    // "Nous sont parvenus des parchemins", "(je) vous raconterai": with a third person or a
    // "je" verb, "nous"/"vous" is an object.
    if ((person === NOUS || person === VOUS) && persons & (JE | IL | ILS)) return null;
    alternatives = [...new Set(readings.flatMap((r) => conjugate(r, person).slice(0, 1)))];
  } else if (
    readings.every((r) => r.slot === "I") &&
    verb.w.endsWith("er") &&
    person !== NOUS &&
    person !== VOUS
  ) {
    // "je rêver souvent": a first-group infinitive after its subject is the present.
    alternatives = [
      ...new Set(readings.flatMap((r) => conjugate({ ...r, tense: 1 }, person).slice(0, 1))),
    ];
  } else return null;
  if (!alternatives.length || alternatives.length > 2) return null;
  // "j'" elides only before a vowel: "j'est" becomes "je suis".
  // An elided word before the verb follows the new form: "j'est" -> "je suis", "se sont" ->
  // "s'est" ("je", "ne", "me", "te", "se", "le", "la" elide before a vowel).
  const vowel = (word: string) => /^[aeiouyéèêàâîôûh]/i.test(word);
  const before = i > 0 ? after[i - 1] : { w: pronoun, start: m.index, end: m.index + m[0].length };
  const elidable = /^(?:j|n|m|t|s|l)(?:e|')$|^la$/.test(before.w) && before.end <= verb.start;
  const range = elidable
    ? { start: before.start, end: verb.end }
    : { start: verb.start, end: verb.end };
  const fixed = alternatives.map((alt) => {
    const form = withCase(typed, alt);
    if (!elidable) return form;
    const original = ctx.text.slice(before.start, before.end);
    const apostrophe = /['’]/.exec(original)?.[0] ?? "'";
    const base = original.replace(/['’]$/, "").replace(/[ea]$/i, "");
    const full = before.w === "la" ? `${base}a` : `${base}e`;
    return vowel(alt) ? `${base}${apostrophe}${form}` : `${full} ${form}`;
  });
  return {
    ruleId: RULE,
    messageKey: MESSAGE,
    range,
    alternatives: fixed,
    context: { start: m.index, end: verb.end },
    ...(fixed.length > 1 ? { requiresChoice: true as const } : {}),
  };
}

const PRONOUN =
  /(?<![\p{L}\p{M}\p{N}_'’-])(?:(?:je|tu|il|elle|on|nous|vous|ils|elles)(?![\p{L}\p{M}\p{N}_-])|j['’](?=\p{L}))/giu;

const ETRE_FORMS = new Set(
  "est sont était étaient sera seront serait seraient fut furent soit soient".split(" "),
);
const PARTICIPLE_ENDING: Record<string, string> = { il: "é", elle: "ée", ils: "és", elles: "ées" };
const ADVERBS = new Set(
  "pas plus jamais bien très trop si déjà toujours encore vraiment souvent vite enfin aussi".split(
    " ",
  ),
);

/** "elle est arrivé" -> "arrivée", "ils sont parti" -> "partis": a first-group participle
 * after être agrees with a third-person pronoun subject. */
function participleAgreement(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const pronoun = m[0].toLowerCase();
  const ending = PARTICIPLE_ENDING[pronoun];
  if (!ending || ctx.text[m.index - 1] === "-") return null;
  const previous = tokensBefore(ctx.text, m.index, 1)[0];
  if ((pronoun === "elle" || pronoun === "elles") && previous && !OPENERS.has(previous.w))
    return null;
  if (previous && !isVerbHomograph(previous.w) && verbReadings(previous.w).some(finite))
    return null;
  const after = tokensAfter(ctx.text, m.index + m[0].length, 6);
  let i = 0;
  while (after[i] && NEGATION.has(after[i].w)) i++;
  // A reflexive verb agrees with its object, not always its subject: left out.
  if (!after[i] || !ETRE_FORMS.has(after[i].w) || after[i].hyphen) return null;
  // "Pierre et elle étaient fiancés": a coordinated subject agrees as a plural.
  const persons = verbReadings(after[i].w).reduce(
    (mask, r) => mask | (finite(r) ? (r.slot as number) : 0),
    0,
  );
  if (!(persons & PERSON[pronoun])) return null;
  i++;
  while (after[i] && ADVERBS.has(after[i].w)) i++;
  const word = after[i];
  if (!word || word.hyphen || ctx.dictionary.has(word.w)) return null;
  const typed = ctx.text.slice(word.start, word.end);
  if (typed !== word.w) return null;
  const match = /^(.+)(é|ée|és|ées)$/.exec(word.w);
  if (!match || match[2] === ending) return null;
  const lemma = `${match[1]}er`;
  if (!verbReadings(word.w).some((r) => r.slot === "Q" && r.lemma === lemma)) return null;
  return {
    ruleId: RULE,
    messageKey: "review_msg_fr_participle_agreement",
    range: { start: word.start, end: word.end },
    alternatives: [match[1] + ending],
    context: { start: m.index, end: word.end },
  };
}

const SINGULAR_DETERMINERS = new Set(
  "le la l' un une ce cet cette mon ton son ma ta sa notre votre chaque".split(" "),
);
const PLURAL_DETERMINERS = new Set("les des ces mes tes ses nos vos leurs plusieurs".split(" "));
// Nouns of quantity whose verb follows their complement ("la plupart des gens pensent").
const COLLECTIVES = new Set(
  (
    "plupart peu nombre majorité minorité reste foule totalité ensemble moitié tiers quart " +
    "dizaine douzaine vingtaine trentaine centaine millier million milliard partie infinité " +
    "quantité multitude série masse tas"
  ).split(" "),
);
/** Stressed pronouns before "qui", with the person they give its verb. */
const STRESSED: Record<string, number> = {
  moi: JE,
  toi: TU,
  lui: IL,
  nous: NOUS,
  vous: VOUS,
  eux: ILS,
  ceux: ILS,
  celles: ILS,
  celui: IL,
  celle: IL,
};
const CLAUSE_OPENERS = new Set(
  "mais car donc que qu' quand si lorsque lorsqu' puisque puisqu' alors".split(" "),
);
// "aussi bien que", "plus vite que", "ne connaissent que": "que" compares or restricts there.
const COMPARING = new Set(
  "plus moins aussi autant si tant bien mieux pire même autre autres ainsi ne n' rien".split(" "),
);
const NOT_HEADS = new Set("plus moins mieux tant trop peu que qu' dont qui quoi ne n'".split(" "));

/** The verb at `i` (past ne and object pronouns) with another person than `person`. */
function verbFinding(
  ctx: DetectContext,
  tokens: Token[],
  i: number,
  person: number,
  from: number,
): RawFinding | null {
  let j = i;
  let marked = tokens[i - 1]?.w === "qui";
  // "Ce soir nous allons", "Ces choses, nous les partageons": the pronoun is the subject.
  if (tokens[j] && SUBJECT_PRONOUNS_ALL.has(tokens[j].w) && !marked) return null;
  while (tokens[j] && (NEGATION.has(tokens[j].w) || CLITICS.has(tokens[j].w))) {
    // "une intoxication en cours": "en" is as often the preposition.
    if (tokens[j].w !== "en") marked = true;
    j++;
  }
  const verb = tokens[j];
  if (!verb || verb.hyphen || ctx.dictionary.has(verb.w) || NOT_HEADS.has(verb.w)) return null;
  const typed = ctx.text.slice(verb.start, verb.end);
  if (typed !== verb.w) return null;
  // "les enfants joue" may be a noun phrase ("la joue"): only a pronoun or ne marks the verb.
  if (isVerbHomograph(verb.w) && !marked) return null;
  const readings = verbReadings(verb.w);
  if (!readings.length || !readings.every(finite)) return null;
  const persons = readings.reduce((mask, r) => mask | (r.slot as number), 0);
  if (persons & person) return null;
  // "Notre Père qui êtes aux cieux", "rappelons-le": an address or an imperative.
  if ((person === IL || person === ILS) && !(persons & ~(NOUS | VOUS))) return null;
  // "votre site précèdent peut": a finite verb right after shows the word was no verb.
  const after = tokens[j + 1];
  if (after && !isVerbHomograph(after.w) && verbReadings(after.w).some(finite)) return null;
  // "un exemple pertinent sont les projets": an inverted attribute.
  if (["est", "sont"].includes(verb.w) && after && ["les", "des", "ces"].includes(after.w))
    return null;
  const alternatives = [...new Set(readings.flatMap((r) => conjugate(r, person).slice(0, 1)))];
  if (!alternatives.length || alternatives.length > 2) return null;
  const fixed = alternatives.map((alt) => withCase(typed, alt));
  return {
    ruleId: RULE,
    messageKey: MESSAGE,
    range: { start: verb.start, end: verb.end },
    alternatives: fixed,
    context: { start: from, end: verb.end },
    ...(fixed.length > 1 ? { requiresChoice: true as const } : {}),
  };
}

/** "les rues était calmes", "mon enfant qui ne peux pas": a noun subject opening its clause, or
 * "moi qui", "ceux qui", and its verb. */
function nounSubject(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const word = m[0].toLowerCase().replace("’", "'");
  if (namedExampleBefore(ctx.text, m.index)) return null;
  const tokens = tokensAfter(ctx.text, m.index, 8);
  if (tokens[0]?.w !== word) return null;
  if (word in STRESSED) {
    if (tokens[1]?.w !== "qui" || ctx.text[m.index - 1] === "-") return null;
    // "c'est moi qui", "ce sont eux qui": a focused subject; "plus vieux que moi qui" is not.
    const [verb, ce] = tokensBefore(ctx.text, m.index, 3).filter((t) => t.w !== "pas");
    const focus =
      word === "ceux" ||
      word === "celles" ||
      word === "celui" ||
      word === "celle" ||
      (verb &&
        ["est", "sont", "était", "étaient", "fut"].includes(verb.w) &&
        ce &&
        ["c'", "ce"].includes(ce.w));
    if (!focus) return null;
    return verbFinding(ctx, tokens, 2, STRESSED[word], m.index);
  }
  const previous = tokensBefore(ctx.text, m.index, 4);
  const before = previous[0];
  if (before && !CLAUSE_OPENERS.has(before.w)) return null;
  if (before && (before.w === "que" || before.w === "qu'")) {
    if (previous.slice(1, 4).some((t) => COMPARING.has(t.w))) return null;
  }
  // A clause start: the text's start, a sentence end or a line, not a quote or a comma.
  if (
    !before &&
    !/(?:^|[.!?…:\n])[\s\u00a0]*$/u.test(ctx.text.slice(Math.max(0, m.index - 4), m.index))
  )
    return null;
  const noun = tokens[1];
  if (!noun || noun.hyphen || COLLECTIVES.has(noun.w) || NOT_HEADS.has(noun.w)) return null;
  const plural = PLURAL_DETERMINERS.has(word);
  const nounTyped = ctx.text.slice(noun.start, noun.end);
  // "Les Misérables est un roman": a title.
  if (nounTyped !== noun.w && (plural || !/^\p{Lu}\p{Ll}+$/u.test(nounTyped))) return null;
  // "Le faire est simple": an infinitive or a verb, not a noun.
  if (verbReadings(noun.w).length && !isVerbHomograph(noun.w)) return null;
  if (plural && !/[sx]$/.test(noun.w)) return null;
  const singular = noun.w.replace(/aux$/, "al").replace(/[sx]$/, "");
  const nounLike =
    nounGender(noun.w) ||
    nounGender(singular) ||
    isInflectedNoun(noun.w) ||
    isInflectedNoun(singular) ||
    nounTyped !== noun.w;
  if (!nounLike) return null;
  let i = 2;
  // One adjective may follow the noun: "les flux financiers crée".
  if (tokens[i] && adjectiveReadings(tokens[i].w).length && !verbReadings(tokens[i].w).length) i++;
  if (tokens[i]?.w === "qui") i++;
  return verbFinding(ctx, tokens, i, plural ? ILS : IL, m.index);
}

const NOUN_SUBJECT = new RegExp(
  `(?<![\\p{L}\\p{M}\\p{N}_'’-])(?:l['’](?=\\p{L})|(?:${[
    ...SINGULAR_DETERMINERS,
    ...PLURAL_DETERMINERS,
    ...Object.keys(STRESSED),
  ]
    .filter((w) => w !== "l'")
    .join("|")})(?![\\p{L}\\p{M}\\p{N}_'’-]))`,
  "giu",
);

function subjectVerbAgreement(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "fr") return [];
  const findings: RawFinding[] = [];
  for (const m of ownedFrenchWords(ctx, PRONOUN)) {
    const finding = agreement(ctx, m) ?? participleAgreement(ctx, m);
    if (finding) findings.push(finding);
  }
  for (const m of ownedFrenchWords(ctx, NOUN_SUBJECT)) {
    const finding = nounSubject(ctx, m);
    if (finding) findings.push(finding);
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: [RULE], detect: subjectVerbAgreement },
];
