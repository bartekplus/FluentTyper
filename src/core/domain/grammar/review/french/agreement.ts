import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  adjectiveReadings,
  conjugate,
  finitePersons,
  isFrenchWord,
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
import { sontForSon } from "./homophones";
import { PRENOMINAL } from "./verbForms";
import {
  capitalizedName,
  CLITICS,
  ownedFrenchWords,
  type Token,
  tokensAfter,
  tokensBefore,
  withCase,
} from "./frenchTokens";
import { finding } from "../finding";

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
  // Demonstratives and "personne ne", subjects at a clause start: "ça fonctionne", "ceux-ci
  // partent", "personne ne peut".
  ça: IL,
  cela: IL,
  ceci: IL,
  personne: IL,
  "celui-ci": IL,
  "celui-là": IL,
  "celle-ci": IL,
  "celle-là": IL,
  "ceux-ci": ILS,
  "ceux-là": ILS,
  "celles-ci": ILS,
  "celles-là": ILS,
};
/** The personal pronouns, as against the demonstratives and "personne". */
const PARTICIPLE_PERSONS: Record<string, true> = Object.fromEntries(
  "je j' tu il elle on nous vous ils elles".split(" ").map((w) => [w, true]),
);
/** Pronouns that are always subjects; the others may be objects or stressed ("pour elle"). */
const ALWAYS_SUBJECT = new Set(["je", "j'", "tu", "il", "on", "ils"]);
const OPENERS = new Set(
  "et mais ou donc car que qu' quand si lorsque lorsqu' puisque puisqu' comme où alors puis".split(
    " ",
  ),
);
const NEGATION = new Set(["ne", "n'"]);
const RELATIVE_PRONOUNS = new Set(
  "lequel laquelle lesquels lesquelles auquel auxquels auxquelles duquel desquels desquelles dont".split(
    " ",
  ),
);
const SUBJECT_PRONOUNS_ALL = new Set("je j' tu il elle on nous vous ils elles".split(" "));
/** Words that name the pronoun after them rather than let it be a subject. */
const NAMING = new Set([
  "pronom",
  "personnel",
  "mot",
  "terme",
  "le",
  "un",
  "du",
  "au",
  "aux",
  "les",
  "des",
]);
const COORDINATING_OR_RELATIVE = new Set(["et", "ou", "que", "qu'", "où"]);

const finite = (r: VerbReading) => typeof r.slot === "number";

/** "je peut" -> "peux", "ils mange" -> "mangent", "tu rêver" -> "rêves". */
function agreement(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const pronoun = m[0].toLowerCase().replaceAll("’", "'");
  const person = PERSON[pronoun];
  if (ctx.text[m.index - 1] === "-" || namedExampleBefore(ctx.text, m.index)) return null;
  const previous = tokensBefore(ctx.text, m.index, 1)[0];
  // "le pronom tu n'est pas omis", "le je": the pronoun named, not a subject.
  if (previous && NAMING.has(previous.w)) return null;
  // "elle", "nous", "vous" open a clause only at its start or after a conjunction; "que vous
  // offrent ces cours", "Pierre et elle étaient" make them objects or a coordinated subject.
  const stressed = !ALWAYS_SUBJECT.has(pronoun);
  // "que vous ne le pensez": "ne" right after makes the pronoun the subject.
  const negatedSubject =
    pronoun in PARTICIPLE_PERSONS &&
    previous &&
    (previous.w === "que" || previous.w === "qu'") &&
    ["ne", "n'"].includes(tokensAfter(ctx.text, m.index + m[0].length, 1)[0]?.w ?? "");
  // "que vous arriver tard": an -er infinitive right after shows the pronoun is the subject.
  const first = tokensAfter(ctx.text, m.index + m[0].length, 1)[0];
  const infinitiveSubject =
    !!first &&
    first.w.endsWith("er") &&
    verbReadings(first.w).length > 0 &&
    verbReadings(first.w).every((r) => r.slot === "I") &&
    subordinateSubject(ctx.text, m.index, 0);
  if (
    stressed &&
    previous &&
    !negatedSubject &&
    !infinitiveSubject &&
    (!OPENERS.has(previous.w) || COORDINATING_OR_RELATIVE.has(previous.w))
  )
    return null;
  // "comme celui-ci", "comme cela": a comparison, not a subject.
  const demonstrative = !(pronoun in PARTICIPLE_PERSONS);
  if (demonstrative && previous?.w === "comme") return null;
  // "Peux tu aller", "que veut tu": an unhyphenated inversion ("puis", "plus" open a clause).
  if (
    previous &&
    !CLAUSE_ADVERBS.has(previous.w) &&
    !isVerbHomograph(previous.w) &&
    verbReadings(previous.w).some(finite)
  )
    return null;
  const after = tokensAfter(ctx.text, m.index + m[0].length, 5);
  let i = 0;
  while (after[i] && (NEGATION.has(after[i].w) || CLITICS.has(after[i].w))) i++;
  const verb = after[i];
  if (!verb || verb.hyphen || ctx.dictionary.has(verb.w)) return null;
  // "Je est un autre": "je" as a noun, a third person; an elided "j'est" is a slip.
  if (pronoun === "je" && i === 0 && verb.w === "est") return null;
  // "ils son contents": the homophone check writes "sont".
  if (verb.w === "son" && sontForSon(ctx.text, verb.start)) return null;
  const typed = ctx.text.slice(verb.start, verb.end);
  // A name or an acronym is no verb form.
  if (/\p{Lu}/u.test(typed)) return null;
  // A form that is also a noun ("est", "porte") is the verb only after an always-subject pronoun.
  if (isVerbHomograph(verb.w) && (stressed || pronoun === "on")) return null;
  const readings = verbReadings(verb.w);
  const negated = after.slice(0, i).some((t) => NEGATION.has(t.w));
  let alternatives: string[];
  let warningOnly = false;
  if (!readings.length || readings.every((r) => r.slot === "Q")) {
    // "je sorts", "il dix", "on désir", "il abandonné": a noun or a bare participle where the
    // verb goes.
    // "ces travaux on porté", "que s'est-il passé", "a-t-il": "ont", an inversion.
    // "dans laquelle tu vie": a relative pronoun opens the clause too.
    if (previous && !OPENERS.has(previous.w) && !RELATIVE_PRONOUNS.has(previous.w)) return null;
    if (/[-–‑]\s*$/u.test(ctx.text.slice(Math.max(0, m.index - 3), m.index))) return null;
    const reflexive = after.slice(0, i).some((t) => t.w === "se" || t.w === "s'");
    // "Cela dit, ...", "Ceci posé,": a demonstrative and a participle that end their phrase open
    // an absolute clause; "ça créé une brasserie" goes on with its object.
    const absolute = !demonstrative || !after[i + 1] || readings.length === 0;
    const found = nonVerbAlternatives(
      verb.w,
      person,
      readings.length > 0,
      stressed && i === 0 && absolute,
      reflexive,
      negated,
    );
    if (!found) return null;
    alternatives = found;
    warningOnly = !found.length;
  } else if (readings.every(finite)) {
    const persons = readings.reduce((mask, r) => mask | (r.slot as number), 0);
    if (persons & person)
      return isVerbHomograph(verb.w) ? null : coordinatedVerb(ctx, verb, person, readings);
    // "Ça, vous devez le demander": a pronoun after the demonstrative is the subject.
    if (demonstrative && after.slice(0, i).some((t) => PERSON[t.w] && persons & PERSON[t.w]))
      return null;
    // "Nous sont parvenus des parchemins", "(je) vous raconterai": with a third person or a
    // "je" verb, "nous"/"vous" is an object.
    // At the very start of a clause no other subject can come before: only "Nous sont
    // parvenus", an inverted subject, keeps "nous" an object there.
    const opens =
      !previous &&
      /(?:^|[.!?…\n])\s{0,8}$/u.test(ctx.text.slice(Math.max(0, m.index - 9), m.index));
    if ((person === NOUS || person === VOUS) && persons & (opens ? ILS : JE | IL | ILS))
      return null;
    // "je lui ait demandé": outside a "que" clause, "ait" is the present's "ai" misspelt.
    const present = verb.w === "ait" && !["que", "qu'"].includes(previous?.w ?? "");
    alternatives = [
      ...new Set(
        readings.flatMap((r) => conjugate(present ? { ...r, tense: 1 } : r, person).slice(0, 1)),
      ),
    ];
  } else if (
    readings.every((r) => r.slot === "I") &&
    (verb.w.endsWith("er") || (ALWAYS_SUBJECT.has(pronoun) && /(?:ir|re)$/.test(verb.w))) &&
    !invertedAfar(ctx.text, m.index) &&
    ((person !== NOUS && person !== VOUS) || negated || subordinateSubject(ctx.text, m.index, i))
  ) {
    // "je rêver souvent", "tu me le dire": an infinitive after its subject is the present.
    alternatives = [
      ...new Set(readings.flatMap((r) => conjugate({ ...r, tense: 1 }, person).slice(0, 1))),
    ];
  } else return null;
  if ((!alternatives.length && !warningOnly) || alternatives.length > 3) return null;
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
  return finding(RULE, MESSAGE, range.start, range.end, fixed, {
    context: { start: m.index, end: verb.end },
    ...(fixed.length > 1 ? { requiresChoice: true as const } : {}),
    ...(warningOnly ? { warningOnly: true as const } : {}),
  });
}

// Conjunctions after which "nous" or "vous" opens its clause as the subject: "si vous
// penser" -> "pensez", "est-ce que vous aimer" -> "aimez". A bare "que" may restrict or compare
// ("je ne veux que vous aider", "plutôt que vous déranger"): only "est-ce que" counts.
const SUBORDINATORS = new Set("si quand lorsque lorsqu' puisque puisqu'".split(" "));

// Adverbs after which "nous" or "vous" opens its clause: "puis vous manger" -> "mangez".
const CLAUSE_ADVERBS = new Set("puis alors ensuite donc car comme plus".split(" "));

/** "nous"/"vous" right after a subordinating conjunction, with nothing between it and the verb;
 * or after a clause adverb ("puis vous manger", "de plus vous oublier"), with object pronouns
 * between ("alors vous y voyer"). At a sentence start the infinitive may be the subject ("Vous
 * blesser n'était pas mon but"), and after an earlier infinitive "puis vous donner" goes on with
 * it: both are left alone. */
function subordinateSubject(text: string, index: number, gap: number): boolean {
  const [conjunction, before] = tokensBefore(text, index, 2);
  if (!conjunction) return false;
  // "je ne puis vous aider", "il ne peut plus vous voir": the verb "puis", the negation "plus".
  if (CLAUSE_ADVERBS.has(conjunction.w)) {
    const adverb =
      conjunction.w === "plus"
        ? !before || before.w === "de" || before.w === "en"
        : !before || !["je", "ne", "n'"].includes(before.w);
    if (!adverb) return false;
    const sentence = text.slice(Math.max(0, conjunction.start - 200), conjunction.start);
    const words = sentence.slice(sentence.search(/[^.!?…\n]*$/u)).match(/\p{L}+/gu) ?? [];
    return !words.some((w) => verbReadings(w.toLowerCase()).some((r) => r.slot === "I"));
  }
  // "ce que vous aller voir".
  if (["que", "qu'"].includes(conjunction.w) && before?.w === "ce") return true;
  if (gap) return false;
  if (SUBORDINATORS.has(conjunction.w)) return true;
  return (
    (conjunction.w === "que" || conjunction.w === "qu'") &&
    before?.w === "ce" &&
    text[before.start - 1] === "-"
  );
}

/** "Que vas donc tu faire ?": a verb a word or two before the pronoun, in the same clause. */
function invertedAfar(text: string, index: number): boolean {
  for (const t of tokensBefore(text, index, 3)) {
    if (OPENERS.has(t.w) && t.w !== "donc" && t.w !== "alors") return false;
    if (!isVerbHomograph(t.w) && verbReadings(t.w).some(finite)) return true;
  }
  return false;
}

/**
 * "ils hélaient et bousculait", "il rentra et senti": a second verb joined by "et" shares the
 * subject; it takes its person, and the first verb's tense when it was written as a
 * participle.
 */
function coordinatedVerb(
  ctx: DetectContext,
  first: Token,
  person: number,
  firstReadings: VerbReading[],
): RawFinding | null {
  const all = tokensAfter(ctx.text, first.end, 10);
  // "il rentra dans la chambre et senti": its complement may come before "et", as long as no
  // other verb, pronoun or relative does.
  const k = all.findIndex((t) => t.w === "et");
  if (k < 0 || k > 6) return null;
  const between = all.slice(0, k);
  const blocked = between.some(
    (t) =>
      SUBJECT_PRONOUNS_ALL.has(t.w) ||
      ["que", "qu'", "qui", "dont", "où", "ou"].includes(t.w) ||
      (!isVerbHomograph(t.w) && verbReadings(t.w).some(finite)),
  );
  if (blocked) return null;
  // "il fut condamné et assassiné": participles joined after an auxiliary.
  if (firstReadings.some((r) => r.lemma === "être" || r.lemma === "avoir")) return null;
  const rest = all.slice(k);
  let i = 1;
  while (rest[i] && (NEGATION.has(rest[i].w) || CLITICS.has(rest[i].w))) i++;
  const verb = rest[i];
  if (!verb || verb.hyphen || ctx.dictionary.has(verb.w) || isVerbHomograph(verb.w)) return null;
  const typed = ctx.text.slice(verb.start, verb.end);
  if (typed !== verb.w || SUBJECT_PRONOUNS_ALL.has(verb.w)) return null;
  const readings = verbReadings(verb.w);
  if (!readings.length || adjectiveReadings(verb.w).length) return null;
  let forms: string[];
  if (readings.every(finite)) {
    const persons = readings.reduce((mask, r) => mask | (r.slot as number), 0);
    if (persons & person) return null;
    // "et vous pourrez": "nous"/"vous" before a verb it agrees with is a new subject.
    if (rest.slice(1, i).some((t) => (t.w === "nous" || t.w === "vous") && persons & PERSON[t.w]))
      return null;
    // The tense the first verb is in, else the second's own.
    const tenses = new Set(firstReadings.map((r) => r.tense));
    const same = readings.filter((r) => tenses.has(r.tense));
    forms = (same.length ? same : readings).flatMap((r) => conjugate(r, person).slice(0, 1));
  } else if (readings.every((r) => r.slot === "Q")) {
    // "il rentra et senti": the participle for the first verb's tense.
    const tense = firstReadings.find((r) => r.tense > 2)?.tense;
    if (tense === undefined) return null;
    // The participle's own flag spells no tense: the infinitive's carries the conjugation.
    forms = readings.flatMap((r) =>
      verbReadings(r.lemma)
        .filter((i) => i.slot === "I" && i.lemma === r.lemma)
        .flatMap((i) => conjugate({ ...i, tense }, person).slice(0, 1)),
    );
  } else return null;
  const alternatives = [...new Set(forms)].filter((f) => f && f !== verb.w);
  if (!alternatives.length || alternatives.length > 2) return null;
  return {
    ruleId: RULE,
    messageKey: MESSAGE,
    range: { start: verb.start, end: verb.end },
    alternatives: alternatives.map((alt) => withCase(typed, alt)),
    context: { start: first.start, end: verb.end },
    ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
  };
}

// Endings a verb may take for each person, the silent letters a misspelling may carry.
const PERSON_ENDINGS: Record<number, string[]> = {
  [JE]: ["e", "s", "x", "is"],
  [TU]: ["es", "s", "x", "is"],
  [IL]: ["e", "t", "d", "it"],
  [NOUS]: ["ons"],
  [VOUS]: ["ez"],
  [ILS]: ["ent"],
};
const AVOIR_PRESENT: Record<number, string> = {
  [JE]: "ai",
  [TU]: "as",
  [IL]: "a",
  [NOUS]: "avons",
  [VOUS]: "avez",
  [ILS]: "ont",
};
// A reflexive verb ("elle s'y plu") takes être.
const ETRE_PRESENT: Record<number, string> = {
  [JE]: "suis",
  [TU]: "es",
  [IL]: "est",
  [NOUS]: "sommes",
  [VOUS]: "êtes",
  [ILS]: "sont",
};
// "nous deux", "vous autres", "elle seule", "je soussigné": words a pronoun may take.
const AFTER_PRONOUN = new Set(
  (
    "soussigné soussignée soussignés soussignées autres tous toutes tout même mêmes seul seule " +
    "seuls seules aussi non pendant point pas plus rien personne"
  ).split(" "),
);
// Function words the noun filter also lets through ("des" as "dés", "on", "leurs").
const NOT_NOUNS = new Set(
  (
    "et ou où on en y des les leurs ses ces mes tes nos vos le la un une du au aux de que qui " +
    "si car mais donc or ni"
  ).split(" "),
);
const PREPOSITION_WORDS = new Set("dans sans sous vers chez par pour avec entre contre".split(" "));
const PLACE_PREPOSITIONS = new Set(["dans", "sous", "chez"]);
const NUMBER_WORDS = new Set("deux trois quatre cinq six sept huit neuf dix cent mille".split(" "));

/**
 * The verb forms that sound like a noun or a participle written after a subject pronoun ("je
 * sorts" -> "sors", "il dix" -> "dit", "il abandonné" -> "a abandonné"); [] when the word is no
 * verb and nothing sounds like it, null when the word may stand there.
 */
function nonVerbAlternatives(
  word: string,
  person: number,
  participle: boolean,
  cautious: boolean,
  reflexive: boolean,
  negated = false,
): string[] | null {
  if (AFTER_PRONOUN.has(word) || word.length < 2) return null;
  // "nous deux", "elles trois"; "nous ne dix rien" is "disons".
  if (NUMBER_WORDS.has(word) && person & (NOUS | VOUS | ILS) && !negated) return null;
  // "Elle partie, la maison se tut": a stressed pronoun with a participle or a noun after it
  // may open an absolute clause.
  // "je dans la maison": a preposition where the verb goes; no verb sounds like it, but before
  // a place être is the verb left out ("il est dans").
  if (PREPOSITION_WORDS.has(word))
    return cautious
      ? null
      : PLACE_PREPOSITIONS.has(word) && !negated
        ? [`${ETRE_PRESENT[person]} ${word}`]
        : [];
  // Only a word the lists know as French: a foreign word ("on line") or a gap in the lists is
  // left alone; an adjective may be an apposition ("elles, heureuses").
  const noun = isInflectedNoun(word);
  if (!participle && (!noun || NOT_NOUNS.has(word) || adjectiveReadings(word).length)) return null;
  if (cautious) return null;
  const forms = new Set<string>();
  // "je ne mangé pas": a participle inside a negation is the finite verb misspelt.
  if (participle && !negated)
    forms.add(`${(reflexive ? ETRE_PRESENT : AVOIR_PRESENT)[person]} ${word}`);
  const stem = word.replace(/(?:ées|és|ée|é|ts|ds|es|e|s|t|x|d)$/, "");
  const doubled = /[nlt]$/.test(stem) ? stem + stem.slice(-1) : null;
  for (const base of [stem, doubled]) {
    if (!base || base.length < 2) continue;
    for (const ending of PERSON_ENDINGS[person]) {
      const form = base + ending;
      if (form !== word && finitePersons(form) & person) forms.add(form);
    }
  }
  // "nous sorts" -> "sortons", "nous ne dix" -> "disons": a form for another person ("sors",
  // "dis") spells the verb, conjugated for this one in the present.
  if (forms.size === (participle && !negated ? 1 : 0)) {
    // "tu me test" -> "testes", "il travail" -> "travaille": the noun is the verb's stem.
    const whole = /[nlt]$/.test(word) ? word + word.slice(-1) : null;
    for (const base of [stem, doubled, word, whole]) {
      if (!base || base.length < 2) continue;
      for (const ending of ["s", "t", "e", "x", "d"]) {
        if (base + ending === word) continue;
        for (const r of verbReadings(base + ending))
          if (r.tense === 1 && typeof r.slot === "number")
            for (const form of conjugate(r, person).slice(0, 1)) forms.add(form);
      }
    }
  }
  return [...forms].slice(0, 3);
}

const PRONOUN =
  /(?<![\p{L}\p{M}\p{N}_'’-])(?:(?:je|tu|il|elle|on|nous|vous|ils|elles|ça|cela|ceci)(?![\p{L}\p{M}\p{N}_-])|personne(?=[ \t]{1,8}n(?:e\b|['’]))|ce(?:lui|lle|ux|lles)-(?:ci|là)(?![\p{L}\p{M}\p{N}_-])|j['’](?=\p{L}))/giu;

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
    "quantité multitude série masse tas genre sorte espèce type essaim groupe bande troupe " +
    "troupeau nuée poignée flopée kyrielle horde meute myriade ribambelle foule tonne"
  ).split(" "),
);
// "Chaque jour des fonctions sont ajoutées", "neuf heures lui conviendrait": a time or a measure,
// not the subject the verb agrees with.
const TIME_OR_MEASURE = new Set(
  (
    "jour matin soir nuit semaine mois an année siècle heure minute seconde instant moment fois " +
    "hiver été automne printemps lendemain veille midi lundi mardi mercredi jeudi vendredi samedi " +
    "dimanche euro dollar franc centime kilo gramme kilogramme mètre kilomètre litre degré pour"
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
  (
    "mais car donc que qu' quand si lorsque lorsqu' puisque puisqu' alors pourquoi cependant " +
    "pourtant"
  ).split(" "),
);
// "aussi bien que", "plus vite que", "ne connaissent que": "que" compares or restricts there.
const COMPARING = new Set(
  "plus moins aussi autant si tant bien mieux pire même autre autres ainsi ne n' rien tel tels telle telles".split(
    " ",
  ),
);
const NOT_HEADS = new Set(
  (
    "plus moins mieux tant trop peu que qu' dont qui quoi ne n' des du de d' un une lequel " +
    "laquelle lesquels lesquelles"
  ).split(" "),
);
const AUXILIARY_HOMOGRAPHS = new Set(["est", "a"]);
// Determiners that open a verb's object and never follow a participle: "fait du bruit".
const OBJECT_DETERMINERS = new Set(
  "du des un une mon ma mes ton ta tes son sa ses notre nos votre vos leurs cette ces".split(" "),
);
/** Number words that stand for a plural determiner or follow one: "les dix maisons". */
const NUMBERS = new Set(
  (
    "deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze quinze seize vingt " +
    "trente quarante cinquante soixante cent mille plusieurs quelques"
  ).split(" "),
);
// "Le prix des maisons", "les enfants dans le jardin": a complement between the head and its verb.
const COMPLEMENT_PREPOSITIONS = new Set("de d' du des dans sur sous entre avec chez".split(" "));
// Words before a noun phrase that make it a complement, not the start of a list.
const PREPOSITIONS = new Set(
  (
    "de d' du des à au aux en dans sur sous pour par avec sans chez après avant depuis pendant " +
    "entre vers selon malgré contre durant dès"
  ).split(" "),
);
const ALL_DETERMINERS = new Set([...SINGULAR_DETERMINERS, ...PLURAL_DETERMINERS]);

/** A noun as far as the lists know: an entry, its plural, or a capitalized name or acronym. */
function nounLike(text: string, token: Token): boolean {
  const typed = text.slice(token.start, token.end);
  if (typed !== token.w) return /^(?:\p{Lu}\p{Ll}+|\p{Lu}{2,6})$/u.test(typed);
  if (verbReadings(token.w).length && !isVerbHomograph(token.w)) return false;
  const singular = token.w.replace(/aux$/, "al").replace(/[sx]$/, "");
  return Boolean(nounGender(token.w) || nounGender(singular) || isInflectedNoun(token.w));
}

/** An adjective or a past participle after a noun: "financiers", "données", "inscrits". */
function postnominal(t: Token | undefined): boolean {
  if (!t || t.hyphen || t.w.length < 3 || SUBJECT_PRONOUNS_ALL.has(t.w) || CLITICS.has(t.w))
    return false;
  const readings = verbReadings(t.w);
  if (!readings.length) return adjectiveReadings(t.w).length > 0;
  return readings.every((r) => r.slot === "Q");
}

/** Index past the adjectives after a noun: "les flux financiers actuels", "les entraînements
 * phonologiques et multisensoriels". */
function skipAdjective(tokens: Token[], i: number): number {
  for (let n = 0; n < 2 && postnominal(tokens[i]); n++) {
    i++;
    if (["et", "ou"].includes(tokens[i]?.w ?? "") && postnominal(tokens[i + 1])) i += 2;
  }
  return i;
}

const DEGREE = new Set("très si trop plus bien assez".split(" "));

/** Index past an adjective that comes before its noun: "la vieille chèvre", "le très petit
 * chat"; `i` when no noun follows it. */
function pastPrenominal(text: string, tokens: Token[], i: number): number {
  const k = DEGREE.has(tokens[i]?.w ?? "") ? i + 1 : i;
  const noun = tokens[k + 1];
  // "Une seule pluie et l'herbe reverdit": "seul" makes an elliptic clause, not a subject.
  const word = tokens[k]?.w ?? "";
  if (!PRENOMINAL.has(word) || /^(?:seul|même|autre)/.test(word)) return i;
  return noun && nounLike(text, noun) ? k + 1 : i;
}

/** Index past one complement of the head noun: "des maisons", "dans le jardin", "de Nora". */
function skipComplement(text: string, tokens: Token[], i: number): number {
  if (!tokens[i] || !COMPLEMENT_PREPOSITIONS.has(tokens[i].w)) return i;
  let k = i + 1;
  if (tokens[k] && ALL_DETERMINERS.has(tokens[k].w)) k++;
  // "entre ces deux langues": a number after the determiner.
  if (k > i + 1 && tokens[k] && NUMBERS.has(tokens[k].w)) k++;
  const noun = tokens[k];
  if (!noun || noun.hyphen || NOT_HEADS.has(noun.w) || !nounLike(text, noun)) return i;
  // "du Père Noël", "de Jean Dupont": a name of two capitalized words.
  const capital = (t?: Token) => !!t && /^\p{Lu}\p{Ll}/u.test(text.slice(t.start, t.end));
  if (capital(noun) && capital(tokens[k + 1]) && !capital(tokens[k + 2])) k++;
  return skipAdjective(tokens, k + 1);
}

/** Index past up to two complements: "les champs de blé dorés de l'Ukraine". */
function skipComplements(text: string, tokens: Token[], i: number): number {
  for (let n = 0; n < 2; n++) {
    const next = skipComplement(text, tokens, i);
    if (next === i) break;
    i = next;
  }
  return i;
}

// Words that end a subordinate clause's reach: another clause or a coordination starts.
const CLAUSE_STOPS = new Set(
  (
    "que qu' qui dont où et ou mais si comme car donc lorsque lorsqu' quand puisque puisqu' " +
    "je j' tu il elle on ils elles ni"
  ).split(" "),
);
const MARKING_CLITICS = new Set("ne n' me m' te t' se s' lui y".split(" "));

/** The index of the main verb after a relative clause's own verb at `k - 1` ("les enfants que
 * j'accompagne à l'école arrive"), past its complements; -1 when unsure. */
function mainVerbAfter(tokens: Token[], k: number): number {
  for (let n = 0; n < 8 && tokens[k]; n++, k++) {
    const t = tokens[k];
    if (CLAUSE_STOPS.has(t.w) || t.hyphen) return -1;
    if (MARKING_CLITICS.has(t.w)) return k;
    if (!verbReadings(t.w).some(finite)) continue;
    // "j'ai la garde": a determiner makes the next word a noun.
    const previous = tokens[k - 1];
    if (
      previous &&
      (ALL_DETERMINERS.has(previous.w) || NOT_HEADS.has(previous.w) || /^aux?$/.test(previous.w))
    )
      continue;
    // "a la bibliothèque" may be the preposition "à": only "a" before a participle.
    if (t.w === "a") {
      const next = tokens[k + 1];
      return next && verbReadings(next.w).some((r) => r.slot === "Q") ? k : -1;
    }
    return isVerbHomograph(t.w) && t.w !== "est" ? -1 : k;
  }
  return -1;
}

/** "les enfants que j'accompagne", "les enfants dont j'ai la garde": a relative clause with a
 * pronoun subject; the index of the main verb after it, or -1. */
function skipRelative(tokens: Token[], i: number): number {
  if (!["que", "qu'", "dont"].includes(tokens[i]?.w ?? "")) return -1;
  let k = i + 1;
  if (!tokens[k] || !SUBJECT_PRONOUNS_ALL.has(tokens[k].w)) return -1;
  k++;
  while (tokens[k] && (NEGATION.has(tokens[k].w) || CLITICS.has(tokens[k].w))) k++;
  if (!tokens[k] || !verbReadings(tokens[k].w).some(finite)) return -1;
  return mainVerbAfter(tokens, k + 1);
}

/** The verb at `i` (past ne and object pronouns) with another person than `person`. `direct`: the
 * subject is a noun phrase right before, in a clause of its own. */
function verbFinding(
  ctx: DetectContext,
  tokens: Token[],
  i: number,
  person: number,
  from: number,
  coordinated = false,
  direct = false,
): RawFinding | null {
  let j = i;
  let marked = tokens[i - 1]?.w === "qui";
  // "Ce soir nous allons", "Ces choses, nous les partageons": the pronoun is the subject. "Les
  // voisins nous salue": "nous" or "vous" before a verb that cannot agree with it is the object.
  if (tokens[j] && SUBJECT_PRONOUNS_ALL.has(tokens[j].w) && !marked) {
    const pronoun = tokens[j].w;
    const next = tokens[j + 1];
    const object =
      direct &&
      (pronoun === "nous" || pronoun === "vous") &&
      next !== undefined &&
      !next.hyphen &&
      !isVerbHomograph(next.w) &&
      verbReadings(next.w).length > 0 &&
      !(finitePersons(next.w) & PERSON[pronoun]);
    if (!object) return null;
  }
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
  // "est" and "a" after a subject are the verbs ("les côtes est" is too rare to weigh).
  // After a plural subject and its complement or adjective, a singular homograph is no noun ("les
  // enfants dans le jardin joue en bas"); right after a plural head noun it may be one ("les
  // hommes politique", "les dates limite"), and after "en" or a preposition it is ("en voie").
  const readings = verbReadings(verb.w);
  // "les enfants fait du bruit": a form in -it before its object is the verb, not the participle.
  const object = !!tokens[j + 1] && OBJECT_DETERMINERS.has(tokens[j + 1].w);
  const bareObject = object && person === ILS && /it$/.test(verb.w) && j === i;
  if (isVerbHomograph(verb.w) && !marked && !AUXILIARY_HOMOGRAPHS.has(verb.w) && !bareObject) {
    const [previous, second] = [tokens[j - 1], tokens[j - 2]];
    const next = tokens[j + 1];
    const bare =
      j === i &&
      person === ILS &&
      !/[sxz]$/.test(verb.w) &&
      (finitePersons(verb.w) & IL) > 0 &&
      previous &&
      !ALL_DETERMINERS.has(previous.w) &&
      !PREPOSITIONS.has(previous.w) &&
      !(
        /[sx]$/.test(previous.w) &&
        second &&
        (ALL_DETERMINERS.has(second.w) || NUMBERS.has(second.w))
      ) &&
      !(next && (postnominal(next) || isVerbHomograph(next.w))) &&
      // "les amis de Paul montre en main attendaient": the plural verb comes later.
      !tokens.slice(j + 1, j + 5).some((t) => !isVerbHomograph(t.w) && finitePersons(t.w) & ILS);
    if (!bare) return null;
  }
  const verbal =
    object && person === ILS && readings.some((r) => r.slot === IL)
      ? readings.filter(finite)
      : readings;
  if (!verbal.some(finite))
    return direct ? infinitiveForVerb(ctx, tokens.slice(i, j), verb, person, from) : null;
  if (!verbal.every(finite)) return null;
  const persons = verbal.reduce((mask, r) => mask | (r.slot as number), 0);
  // "les guerriers reculaient et perdait du terrain": a second verb shares the subject of a
  // clause the noun phrase opens ("l'espoir que les choses se tassaient et constate" goes
  // back to the main clause).
  if (persons & person) {
    if (isVerbHomograph(verb.w) || tokensBefore(ctx.text, from, 1).length) return null;
    return coordinatedVerb(ctx, verb, person, verbal);
  }
  // "Notre Père qui êtes aux cieux", "rappelons-le": an address or an imperative. A future in
  // -rons after a plural noun is its -ront misspelt ("nos voisins pourrons").
  const future = person === ILS && verb.w.endsWith("rons") && tokens[j - 1]?.w !== "qui";
  if ((person === IL || person === ILS) && !(persons & ~(NOUS | VOUS)) && !future) return null;
  // "votre site précèdent peut": a finite verb right after shows the word was no verb.
  const after = tokens[j + 1];
  // "Des boutons, en veux tu ?": a pronoun after the verb that it agrees with is its subject,
  // unless a verb of its own follows ("avant que Marc arrive je n'étais pas là").
  if (after && SUBJECT_PRONOUNS_ALL.has(after.w) && persons & PERSON[after.w]) {
    let k = j + 2;
    while (tokens[k] && (NEGATION.has(tokens[k].w) || CLITICS.has(tokens[k].w))) k++;
    const agrees = (r: VerbReading) => typeof r.slot === "number" && r.slot & PERSON[after.w];
    const own = tokens[k] && verbReadings(tokens[k].w).some(agrees);
    if (!own) return null;
  }
  if (after && !isVerbHomograph(after.w) && verbReadings(after.w).some(finite)) return null;
  // "un exemple pertinent sont les projets": an inverted attribute.
  const attribute = after && ["les", "des", "ces"].includes(after.w);
  if (!coordinated && ["est", "sont"].includes(verb.w) && attribute) return null;
  const alternatives = [...new Set(verbal.flatMap((r) => conjugate(r, person).slice(0, 1)))];
  if (!alternatives.length || alternatives.length > 2) return null;
  const fixed = alternatives.map((alt) => withCase(typed, alt));
  return finding(RULE, MESSAGE, verb.start, verb.end, fixed, {
    context: { start: from, end: verb.end },
    ...(fixed.length > 1 ? { requiresChoice: true as const } : {}),
  });
}

// Object pronouns that only a verb follows: "la foule se déplace", "le garçon lui cache".
const VERB_CLITICS = new Set("me m' te t' se s' lui leur nous vous".split(" "));

/** "La foule se déplacer", "le garçon lui caché ses mains": after a noun subject and an object
 * pronoun, an infinitive in -er or a participle in -é stands for the present or the imperfect. */
function infinitiveForVerb(
  ctx: DetectContext,
  clitics: Token[],
  verb: Token,
  person: number,
  from: number,
): RawFinding | null {
  if (!clitics.some((t) => VERB_CLITICS.has(t.w)) || !/(?:er|é)$/.test(verb.w)) return null;
  if (isVerbHomograph(verb.w)) return null;
  const readings = verbReadings(verb.w);
  const lemma = readings.find((r) => r.slot === "I" || r.slot === "Q")?.lemma;
  const base = lemma && verbReadings(lemma).find((r) => r.slot === "I");
  if (!base || !base.lemma.endsWith("er")) return null;
  const forms = [1, 2].map((tense) => conjugate({ ...base, tense }, person)[0]);
  if (forms.some((form) => !form)) return null;
  const typed = ctx.text.slice(verb.start, verb.end);
  return finding(
    RULE,
    MESSAGE,
    verb.start,
    verb.end,
    forms.map((form) => withCase(typed, form)),
    { context: { start: from, end: verb.end }, requiresChoice: true },
  );
}

/** The words from a subject's first word on; a number in digits reads as "deux". */
function numberedTokens(text: string, m: RegExpExecArray): Token[] {
  const word = m[0].toLowerCase().replaceAll("’", "'");
  const end = m.index + m[0].length;
  const digits = /^\d/.test(word);
  const number = digits
    ? null
    : /^[ \t\u00a0]{1,8}\d{1,9}(?=[ \t\u00a0]{1,8}\p{L})/u.exec(text.slice(end, end + 30));
  if (!digits && !number) return tokensAfter(text, m.index, 16);
  const lead: Token[] = [{ w: word, start: m.index, end, hyphen: false }];
  if (number) lead.push({ w: "deux", start: end, end: end + number[0].length, hyphen: false });
  return [...lead, ...tokensAfter(text, lead.at(-1)!.end, 16 - lead.length)];
}

/** "les rues était calmes", "mon enfant qui ne peux pas": a noun subject opening its clause, or
 * "moi qui", "ceux qui", and its verb. */
function nounSubject(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const word = m[0].toLowerCase().replaceAll("’", "'");
  if (namedExampleBefore(ctx.text, m.index)) return null;
  const tokens = numberedTokens(ctx.text, m);
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
  const previous = tokensBefore(ctx.text, m.index, 8);
  const before = previous[0];
  if (before && !CLAUSE_OPENERS.has(before.w) && !(before.w === "et" && verbBeforeEt(previous)))
    return null;
  if (before && (before.w === "que" || before.w === "qu'")) {
    if (previous.slice(1, 4).some((t) => COMPARING.has(t.w))) return null;
  }
  // A clause start: the text's start, a sentence end, a line or a comma, not a quote.
  if (
    !before &&
    !/(?:^|[.!?…:,\n])[\s\u00a0]*$/u.test(ctx.text.slice(Math.max(0, m.index - 4), m.index))
  )
    return null;
  const digits = /^\d/.test(m[0]);
  if (digits && Number(m[0]) < 2) return null;
  let n = 1;
  // "les dix maisons", "les 10 maisons": a number after the determiner.
  const counted = !digits && tokens[n] && NUMBERS.has(tokens[n].w) && !NUMBERS.has(word);
  if (counted) n++;
  n = pastPrenominal(ctx.text, tokens, n);
  const noun = tokens[n];
  if (!noun || noun.hyphen || NOT_HEADS.has(noun.w)) return null;
  // "trois quarts de la surface est": a fraction agrees with its complement.
  if (COLLECTIVES.has(noun.w) || noun.w === "quarts" || noun.w === "tiers") return null;
  const plural = digits || counted || NUMBERS.has(word) || PLURAL_DETERMINERS.has(word);
  const nounTyped = ctx.text.slice(noun.start, noun.end);
  // "Les Misérables est un roman": a title; "le PBA": an acronym.
  if (
    nounTyped !== noun.w &&
    (plural ||
      !SINGULAR_DETERMINERS.has(word) ||
      !/^(?:\p{Lu}\p{Ll}+|\p{Lu}{2,6})$/u.test(nounTyped))
  )
    return null;
  if (plural && !/[sx]$/.test(noun.w)) return null;
  // "Le faire est simple": an infinitive or a verb, not a noun.
  if (!nounLike(ctx.text, noun)) return null;
  const singular = noun.w.replace(/[sx]$/, "");
  if (TIME_OR_MEASURE.has(noun.w) || TIME_OR_MEASURE.has(singular)) return null;
  // ", des bois et des pâtures": after a comma, a noun phrase may continue a list.
  if (!before && /,[\s\u00a0]{0,8}$/u.test(ctx.text.slice(Math.max(0, m.index - 9), m.index))) {
    if (word === "des" || word === "du" || listBefore(ctx.text, m.index)) return null;
  }
  // Adjectives and complements may follow the noun: "les flux financiers actuels crée", "le
  // prix des maisons baissent".
  let head = skipAdjective(tokens, n + 1);
  // "mon enfant lui qui peut": a stressed pronoun in apposition.
  if (["lui", "eux"].includes(tokens[head]?.w ?? "") && tokens[head + 1]?.w === "qui") head++;
  let i = skipComplements(ctx.text, tokens, head);
  let person = plural ? ILS : IL;
  // "Le vélo et la voiture est": two noun phrases joined by "et" take a plural verb.
  const coordinated =
    i === head &&
    tokens[i]?.w === "et" &&
    Boolean(tokens[i + 1] && ALL_DETERMINERS.has(tokens[i + 1].w));
  if (coordinated) {
    const k = pastPrenominal(ctx.text, tokens, i + 2);
    const second = tokens[k];
    if (!second || second.hyphen || !nounLike(ctx.text, second)) return null;
    i = skipAdjective(tokens, k + 1);
    person = ILS;
  }
  // "les gens comme Tom mentent": a comparison inside a plural subject.
  if (person === ILS && !coordinated && tokens[i]?.w === "comme") {
    let k = i + 1;
    if (tokens[k] && ALL_DETERMINERS.has(tokens[k].w)) k++;
    if (!tokens[k] || !nounLike(ctx.text, tokens[k])) return null;
    k = skipAdjective(tokens, k + 1);
    if (tokens[k] && /^\p{Lu}/u.test(ctx.text[tokens[k].start])) k++;
    return verbFinding(ctx, tokens, k, person, m.index);
  }
  // "Les enfants, qui lui a dit cela, sont là": a relative set off by commas.
  if (i === head && !tokens[i]) return commaRelative(ctx, tokens[i - 1], person, m.index);
  // "l'autre vous condamner" after "et" may leave out a modal: an object pronoun before the verb
  // is read only for a noun phrase that opens its own clause right before it.
  const own = before?.w !== "et";
  return clauseVerbFinding(ctx, tokens, i, person, m.index, coordinated, i === head, own);
}

/** The verb of ", qui ..." right after a subject, which agrees with it. */
function commaRelative(
  ctx: DetectContext,
  last: Token,
  person: number,
  from: number,
): RawFinding | null {
  const comma = /^[ \t\u00a0]*,[ \t\u00a0]*(?=qui(?![\p{L}\p{M}]))/u.exec(ctx.text.slice(last.end));
  if (!comma) return null;
  // "Mes amis, qui veut du café ?": a call, then a question.
  const end = ctx.text.slice(last.end).search(/[.!?…\n]/u);
  if (end >= 0 && ctx.text[last.end + end] !== ".") return null;
  const tokens = tokensAfter(ctx.text, last.end + comma[0].length, 8);
  return verbFinding(ctx, tokens, 1, person, from);
}

const QUI = /(?<![\p{L}\p{M}\p{N}_'’-])qui(?=[ \t])/giu;

/** "cet homme qui travail", "l'ordinateur qui crash": a noun where the relative's verb goes. */
function nounAfterQui(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const before = tokensBefore(ctx.text, m.index, 2);
  // "à qui", "pour qui": "qui" is an object there.
  if (before[0] && PREPOSITIONS.has(before[0].w)) return null;
  const after = tokensAfter(ctx.text, m.index + 3, 4);
  let i = 0;
  while (after[i] && (NEGATION.has(after[i].w) || CLITICS.has(after[i].w))) i++;
  const word = after[i];
  if (!word || word.hyphen || ctx.dictionary.has(word.w) || verbReadings(word.w).length)
    return null;
  // "des personnes qui son là": the homophone check's "sont".
  if (word.w === "son") return null;
  const typed = ctx.text.slice(word.start, word.end);
  if (typed !== word.w || namedExampleBefore(ctx.text, m.index)) return null;
  // The antecedent gives the person: "moi qui", "les gens qui", else the third singular.
  const antecedent = before[0]?.w ?? "";
  const plural = /[sx]$/.test(antecedent) && PLURAL_DETERMINERS.has(before[1]?.w ?? "");
  const person = STRESSED[antecedent] ?? (plural ? ILS : IL);
  const negated = after.slice(0, i).some((t) => NEGATION.has(t.w));
  const found = nonVerbAlternatives(word.w, person, false, false, false, negated);
  if (!found?.length || found.length > 2) return null;
  return finding(RULE, MESSAGE, word.start, word.end, found, {
    context: { start: m.index, end: word.end },
    ...(found.length > 1 ? { requiresChoice: true as const } : {}),
  });
}

// Quantities whose verb agrees with their plural complement: "beaucoup de gens pensent", "la
// plupart des élèves travaillent", "de nombreux élèves pensent".
const QUANTITY = new RegExp(
  `(?<![\\p{L}\\p{M}\\p{N}_'’-])(?:(?:beaucoup|peu|trop|tant|assez|énormément|combien|la plupart|bon nombre|de plus en plus|de moins en moins)[ \\t]{1,8}(?:des?(?![\\p{L}\\p{M}\\p{N}_'’-])|d['’])|de(?=[ \\t]))`,
  "giu",
);

/** "Beaucoup de gens pense", "De grands camions n'arrive pas": a quantity and its plural noun. */
function quantitySubject(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const lead = m[0].toLowerCase().replaceAll("’", "'").trim();
  // "Combien de fois ai je", "De quels sites parles-tu": questions invert their subject.
  if (lead.startsWith("combien")) return null;
  const bare = lead === "de";
  if (!bare && !/(?:de|des|d')$/.test(lead)) return null;
  if (namedExampleBefore(ctx.text, m.index)) return null;
  const previous = tokensBefore(ctx.text, m.index, 8);
  const before = previous[0];
  if (before && !CLAUSE_OPENERS.has(before.w) && !(before.w === "et" && verbBeforeEt(previous)))
    return null;
  if (
    !before &&
    !/(?:^|[.!?…:\n])[\s\u00a0]*$/u.test(ctx.text.slice(Math.max(0, m.index - 4), m.index))
  )
    return null;
  const tokens = tokensAfter(ctx.text, m.index + m[0].length, 14);
  let n = 0;
  // "de nombreux élèves", "beaucoup de jeunes gens": an adjective before the noun.
  const pluralNoun = (t?: Token) => !!t && /[sx]$/.test(t.w) && nounLike(ctx.text, t);
  if (adjectiveReadings(tokens[0]?.w ?? "").some((r) => r.slot[1] === "p") && pluralNoun(tokens[1]))
    n = 1;
  else if (bare) return null;
  const noun = tokens[n];
  if (!noun || noun.hyphen || NOT_HEADS.has(noun.w) || !/[sx]$/.test(noun.w)) return null;
  if (ctx.text.slice(noun.start, noun.end) !== noun.w || !nounLike(ctx.text, noun)) return null;
  // "beaucoup de temps": a noun in -s that is its own singular.
  if (!isInflectedNoun(noun.w.replace(/aux$/, "al").replace(/[sx]$/, ""))) return null;
  const singular = noun.w.replace(/s$/, "");
  if (COLLECTIVES.has(singular) || TIME_OR_MEASURE.has(singular) || TIME_OR_MEASURE.has(noun.w))
    return null;
  if (/^quel/.test(tokens[0].w)) return null;
  const head = skipAdjective(tokens, n + 1);
  const i = skipComplements(ctx.text, tokens, head);
  return clauseVerbFinding(ctx, tokens, i, ILS, m.index, false, i === head);
}

// Words before a noun phrase that make it an object whose relative clause agrees with it: "voici
// les enfants qui jouent". After a preposition the phrase may complement a noun before it ("la
// façon dont ils jouent leurs rôles qui ..."), and "qui" may relate to that noun.
const OBJECT_OPENERS = new Set(["voici", "voilà"]);
// Verbs a question may follow ("demande aux enfants qui veut venir"): "qui" may ask, not relate.
const ASKING = new Set(
  "demander dire savoir expliquer indiquer montrer raconter décider ignorer choisir deviner".split(
    " ",
  ),
);

/** "j'ai vu les enfants qui joue", "je connais une femme qui travaillent": a relative clause's
 * verb agrees with the object noun before "qui". */
function objectRelative(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const word = m[0].toLowerCase().replaceAll("’", "'");
  const plural = PLURAL_DETERMINERS.has(word);
  if ((!plural && !SINGULAR_DETERMINERS.has(word)) || word === "chaque") return null;
  if (namedExampleBefore(ctx.text, m.index)) return null;
  const previous = tokensBefore(ctx.text, m.index, 5);
  const before = previous[0];
  if (!before || ctx.text[m.index - 1] === "-") return null;
  // A verb or a participle whose object it is: "je vois", "j'ai vu", "il y a".
  const verb =
    (!isVerbHomograph(before.w) &&
      verbReadings(before.w).some((r) => (finite(r) || r.slot === "Q") && r.lemma !== "être")) ||
    (before.w === "a" && previous[1]?.w === "y") ||
    (verbReadings(before.w).some((r) => r.slot === "Q") &&
      verbReadings(previous[1]?.w ?? "").some((r) => finite(r) && r.lemma === "avoir"));
  if (!verb && !OBJECT_OPENERS.has(before.w)) return null;
  if (previous.some((t) => verbReadings(t.w).some((r) => ASKING.has(r.lemma)))) return null;
  // "c'est la façon dont ils jouent leurs rôles qui compte": "qui" may close a cleft.
  if (tokensBefore(ctx.text, m.index, 16).some((t) => t.w === "c'" || t.w === "ce")) return null;
  const tokens = tokensAfter(ctx.text, m.index, 12);
  const noun = tokens[1];
  if (tokens[0]?.w !== word || !noun || noun.hyphen || NOT_HEADS.has(noun.w)) return null;
  if (ctx.text.slice(noun.start, noun.end) !== noun.w || !nounLike(ctx.text, noun)) return null;
  if (plural !== /[sx]$/.test(noun.w) && plural) return null;
  const singular = noun.w.replace(/[sx]$/, "");
  if (COLLECTIVES.has(singular)) return null;
  const i = skipAdjective(tokens, 2);
  if (tokens[i]?.w !== "qui") return null;
  return verbFinding(ctx, tokens, i + 1, plural ? ILS : IL, m.index);
}

/** The verb at `i` for a subject that ends there, past "qui" and its verb or a relative clause
 * ("les enfants que j'accompagne arrive", "la chaîne qui émet d'ici sont"). */
function clauseVerbFinding(
  ctx: DetectContext,
  tokens: Token[],
  i: number,
  person: number,
  from: number,
  coordinated: boolean,
  adjacent: boolean,
  direct = false,
): RawFinding | null {
  const relative = skipRelative(tokens, i);
  if (relative >= 0) return verbFinding(ctx, tokens, relative, person, from, coordinated);
  if (tokens[i]?.w !== "qui")
    return verbFinding(ctx, tokens, i, person, from, coordinated, direct && adjacent);
  // "le nom des étudiants qui avaient": after a complement, "qui" goes with its noun; after two
  // coordinated ones, maybe with the second.
  if (!adjacent || coordinated) return null;
  const own = verbFinding(ctx, tokens, i + 1, person, from, coordinated);
  if (own) return own;
  // Past "qui" and a verb that agrees, the main verb.
  let j = i + 1;
  while (tokens[j] && (NEGATION.has(tokens[j].w) || CLITICS.has(tokens[j].w))) j++;
  const verb = tokens[j];
  if (!verb || !(finitePersons(verb.w) & person) || isVerbHomograph(verb.w)) return null;
  const main = mainVerbAfter(tokens, j + 1);
  return main < 0 ? null : verbFinding(ctx, tokens, main, person, from, coordinated);
}

/** Whether "et" before a noun phrase joins two clauses: the clause before it has its own verb and
 * no noun phrase after that verb ("les cours sont durs et les élèves", not "le pain et le vin"). */
function verbBeforeEt(previous: Token[]): boolean {
  for (const t of previous.slice(1)) {
    if (ALL_DETERMINERS.has(t.w) || ["du", "de", "d'", "des", "et", "ou"].includes(t.w))
      return false;
    if (AUXILIARY_HOMOGRAPHS.has(t.w)) return true;
    if (!isVerbHomograph(t.w) && verbReadings(t.w).some(finite)) return true;
  }
  return false;
}

// Capitalized function words that open sentences or titles, which the verb and noun lists leave
// out: never names.
const NOT_NAMES = new Set(
  (
    "ce cet cette ces ne me te se le la les lui leur qui que quoi quel quels quelle quelles tel " +
    "tels telle telles pour par sur sous sans si ni mais car donc de du des dans chez vers voici " +
    "voilà ça cela ceci celui celle ceux celles moi toi soi eux rien tout tous toute toutes " +
    "chaque chacun chacune certains certaines plusieurs plus moins très trop peu beaucoup bien " +
    "mal non puis quand comme comment pourquoi combien depuis pendant selon malgré parmi seul " +
    "seule seuls seules nul nulle sauf mon ton son ma ta sa mes tes ses notre votre nos vos"
  ).split(" "),
);

/** "Dominique peux venir", "Sam et Marie comprit": a name opening its clause and its verb. */
function nameSubject(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const lower = m[0].toLowerCase();
  if (namedExampleBefore(ctx.text, m.index) || ctx.dictionary.has(lower)) return null;
  if (lower in PERSON || NOT_NAMES.has(lower) || NUMBERS.has(lower) || lower.length < 3)
    return null;
  // At a sentence start only a word the lists do not know is surely a name; "Mrs. Smith".
  if (!capitalizedName(ctx.text, m.index, m[0])) {
    if (isFrenchWord(lower) || lower.length < 4) return null;
    if (/\p{Lu}\p{Ll}{0,3}\.[\s ]*$/u.test(ctx.text.slice(Math.max(0, m.index - 8), m.index)))
      return null;
  }
  const previous = tokensBefore(ctx.text, m.index, 3);
  const before = previous[0];
  if (before && !CLAUSE_OPENERS.has(before.w)) return null;
  // "aussi bien Tom que Marie", "ainsi que Rudy": a comparison or an addition.
  if (before && (before.w === "que" || before.w === "qu'")) {
    if (previous.slice(1).some((t) => COMPARING.has(t.w))) return null;
  }
  if (
    !before &&
    !/(?:^|[.!?…:,\n])[\s ]*$/u.test(ctx.text.slice(Math.max(0, m.index - 4), m.index))
  )
    return null;
  // "Los Angeles, Londres et Singapour": a list of names.
  if (!before && /\p{Lu}\p{Ll}*,[\s ]*$/u.test(ctx.text.slice(Math.max(0, m.index - 30), m.index)))
    return null;
  const tokens = tokensAfter(ctx.text, m.index + m[0].length, 12);
  const capitalized = (t?: Token) =>
    Boolean(t && /^\p{Lu}\p{Ll}/u.test(ctx.text.slice(t.start, t.end)));
  let i = 0;
  // "Jean Dupont": a surname.
  if (capitalized(tokens[i])) i++;
  let person = IL;
  if (tokens[i]?.w === "et" && capitalized(tokens[i + 1])) {
    i += 2;
    if (capitalized(tokens[i])) i++;
    person = ILS;
  }
  if (capitalized(tokens[i])) return null;
  // "Paul viens ici !": a call, with the imperative.
  const end = ctx.text.slice(m.index).search(/[.!?…\n]/u);
  if (end >= 0 && ctx.text[m.index + end] === "!") return null;
  return clauseVerbFinding(ctx, tokens, i, person, m.index, person === ILS, true);
}

/** Whether a noun phrase that no preposition governs ends right before the comma before `index`:
 * "une activité, un écrit" lists subjects, "après son régime, Marie" does not. */
function listBefore(text: string, index: number): boolean {
  const comma = text.lastIndexOf(",", index);
  const words = tokensBefore(text, comma, 4);
  const k = words.findIndex((t) => ALL_DETERMINERS.has(t.w) || t.w === "des" || t.w === "du");
  if (k < 0 || k > 2) return false;
  return !words[k + 1] || !PREPOSITIONS.has(words[k + 1].w);
}

const NOUN_SUBJECT = new RegExp(
  `(?<![\\p{L}\\p{M}\\p{N}_'’-])(?:l['’](?=\\p{L})|(?:${[
    ...SINGULAR_DETERMINERS,
    ...PLURAL_DETERMINERS,
    ...Object.keys(STRESSED),
    ...NUMBERS,
  ]
    .filter((w) => w !== "l'")
    .join("|")})(?![\\p{L}\\p{M}\\p{N}_'’-])|(?<![\\p{N},.][ \\u00a0]?)\\d+(?=[ \\u00a0]+\\p{L}))`,
  "giu",
);

const NAME =
  /(?<![\p{L}\p{M}\p{N}_'’-])\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)?(?![\p{L}\p{M}\p{N}_'’-])/gu;

function subjectVerbAgreement(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "fr") return [];
  const findings: RawFinding[] = [];
  for (const m of ownedFrenchWords(ctx, PRONOUN)) {
    const finding = agreement(ctx, m) ?? participleAgreement(ctx, m);
    if (finding) findings.push(finding);
  }
  for (const m of ownedFrenchWords(ctx, NOUN_SUBJECT)) {
    const finding = nounSubject(ctx, m) ?? objectRelative(ctx, m);
    if (finding) findings.push(finding);
  }
  for (const m of ownedFrenchWords(ctx, QUI)) {
    const finding = nounAfterQui(ctx, m);
    if (finding) findings.push(finding);
  }
  for (const m of ownedFrenchWords(ctx, QUANTITY)) {
    const finding = quantitySubject(ctx, m);
    if (finding) findings.push(finding);
  }
  for (const m of ownedFrenchWords(ctx, NAME)) {
    const finding = nameSubject(ctx, m);
    if (finding) findings.push(finding);
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: [RULE], detect: subjectVerbAgreement },
];
