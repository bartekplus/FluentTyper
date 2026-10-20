import type { Detector, MatchFixer, MatchResult } from "../../engine/reviewRules";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import {
  adjectiveForm,
  ALL_CASES,
  ambiguousAdjective,
  adjectiveOf,
  cases,
  finiteVerb,
  MASCULINE,
  menOnlyPlural,
  menPluralShape,
  nounTags,
  onlyNoun,
  pastByShape,
  perfectiveVerb,
  PLURAL,
  virileAdjective,
  virileLemma,
  VERB,
  VIRILE,
} from "./lexicon";
import {
  caseLike,
  findingAt,
  isPl,
  owned,
  PREPOSITIONS,
  S,
  sentenceStartAt,
  userOrNamed,
} from "./shared";

/*
 * Subject and verb: a past form agrees with "on"/"ona" in gender ("ona poszła", not "ona
 * poszedł"), and "został"/"została"/"zostało"/"zostały" with the adjective or participle
 * after it ("zostało zrobione", not "zostało zrobiony").
 */

const RULE = "polishCaseAgreement" as const;
const MESSAGE = "review_msg_pl_subject_verb" as const;

/** Short words that may stand between a subject pronoun and its verb ("ona już wyszła"). */
const BETWEEN = `(?:(?:się|nie|już|też|także|również|wtedy|wczoraj|dziś|zawsze|nigdy|jednak|często|szybko|nagle|wreszcie|tylko)${S}){0,2}`;

const pastForm = (word: string) => finiteVerb(word) || pastByShape(word);

/** "on poszła", "ona przyszedł": the pronoun disagrees with the past form's gender. */
function pronounGender(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const { pronoun, verb, fem } = m.groups!;
  const feminine = pronoun.toLowerCase() === "ona";
  if (feminine === !!fem || !pastForm(verb.toLowerCase()) || userOrNamed(ctx, verb)) return null;
  const [start, end] = m.indices!.groups!.pronoun;
  return {
    ...findingAt(ctx, start, end, [caseLike(pronoun, feminine ? "on" : "ona")], RULE, MESSAGE),
    context: { start: m.index, end: m.index + m[0].length },
  };
}

/** "zostało zrobiony" -> "zrobione": the nominative after "zostać" takes the verb's gender. */
function zostacAgreement(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const { aux, word } = m.groups!;
  const lower = word.toLowerCase();
  const adjective = adjectiveOf(lower);
  if (!adjective || userOrNamed(ctx, word) || onlyNoun(nounTags(lower))) return null;
  const { lemma } = adjective;
  const forms = [lemma, adjectiveForm(lemma, "a"), adjectiveForm(lemma, "e")];
  if (!forms.includes(lower)) return null;
  const wanted = { został: 0, została: 1, zostało: 2, zostały: 2 }[aux.toLowerCase()]!;
  if (forms[wanted] === lower) return null;
  const [start, end] = m.indices!.groups!.word;
  return {
    ...findingAt(ctx, start, end, [caseLike(word, forms[wanted])], RULE, MESSAGE),
    context: { start: m.index, end: m.index + m[0].length },
  };
}

/*
 * A plural subject and its past form: men take "-li" ("studenci przyszli"), everyone and
 * everything else "-ły" ("dzieci przyszły", "kobiety były").
 */

/** Plural past forms of verbs that take no direct object, so a plural noun before them is their subject. */
const INTRANSITIVE =
  "by|bywa|zosta|zostawa|(?:po|przy|wy|w|we|od|ode|do|ze|z|nad|nade|pod|pode)?sz|(?:przy|wy|po|od|do|za)?jecha|przyby|uciek|zniknę|umar|zmar|zginę|spa|siedzie|leże|mieszka|ży|płaka|krzycze|biega|chodzi|przychodzi|wychodzi|wraca|wróci|przyjeżdża|przyleci|odleci|pływa|(?:wy)?roś|zasnę|usnę";
const PLURAL_SUBJECT = new RegExp(
  `(?<![\\p{L}\\p{N}_'’@/.-])(?<noun>\\p{L}{3,})${S}${BETWEEN}(?<verb>\\p{Ll}{2,}(?:li|ły))(?![\\p{L}\\p{N}_'’@/-])(?<reflexive>${S}się)?`,
  "gud",
);
const INTRANSITIVE_PAST = new RegExp(`^(?:${INTRANSITIVE})(?:li|ły)$`, "u");
/** Clause openers before a subject; a determiner may stand between ("że te dzieci"). */
const OPENS_CLAUSE =
  /(?:^|[.!?…:;]["”’»)]{0,3}\s+|\n\s*|(?:^|[^\p{L}])(?:że|gdy|kiedy|bo|ponieważ|jeśli|jeżeli|choć|chociaż|zanim|aż|a|ale|lecz|więc|wtedy|potem|dziś|wczoraj|tam|tu|tutaj)\s+)$/iu;
/** Non-virile plural determiners ("te dzieci", "wszystkie kobiety"). */
const PLURAL_DETERMINER =
  /^(?:te|tamte|owe|moje|twoje|swoje|nasze|wasze|wszystkie|inne|takie|niektóre|obie|dwie|trzy|cztery)$/iu;
/** Nouns of time and extent that stand in the accusative beside a verb ("całe noce spali"). */
const DURATION =
  /^(?:godziny|noce|minuty|sekundy|lata|doby|niedziele|soboty|wakacje|ferie|święta|popołudnia|chwile|mile)$/u;
/** Words before a noun that make it a second term, not the subject ("kobiety jak mężczyźni"). */
const NOT_SUBJECT_BEFORE = new RegExp(
  `(?:^|[^\\p{L}])(?:jak|niż|jako|niczym|ani|czy|lub|albo|bądź|${PREPOSITIONS})[ \\t\\u00a0]+$`,
  "iu",
);

/** The other plural past form: "-ły" for "-li" and back ("mieli" -> "miały"), when listed. */
function otherPlural(verb: string): string[] {
  const stem = verb.slice(0, -2);
  const virile = verb.endsWith("li");
  const forms = virile
    ? [`${stem}ły`, ...(stem.endsWith("e") ? [`${stem.slice(0, -1)}ały`] : [])]
    : [`${stem}li`, ...(stem.endsWith("a") ? [`${stem.slice(0, -1)}eli`] : [])];
  const known = forms.filter((form) => pluralPast(form) || adjectiveOf(form));
  return known.length === 1 ? known : [];
}

/** A plural past form, also one that is a noun too ("miały"). */
const pluralPast = (word: string) =>
  word === "były" || word === "byli" || pastForm(word) || (nounTags(word) & VERB) !== 0;

/** A singular noun opening its clause before "są" ("Dociekanie nie są kluczowe"). */
const SINGULAR_SUBJECT = new RegExp(
  `(?<![\\p{L}\\p{N}_'’@/.-])(?<noun>\\p{L}{3,})${S}(?:nie${S})?(?<verb>są)(?![\\p{L}\\p{N}_'’@/-])`,
  "giud",
);

/**
 * "Pływanie nie są zdrowe": "są" after a singular subject (or the noun lost its plural ending,
 * so the finding only warns). "Państwo są" (a couple) takes the plural.
 */
function singularSubjects(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, SINGULAR_SUBJECT)) {
    const { noun } = m.groups!;
    SINGULAR_SUBJECT.lastIndex = m.index + noun.length;
    const lower = noun.toLowerCase();
    const tags = nounTags(lower);
    if (!onlyNoun(tags) || !(tags & cases("Ns")) || tags & PLURAL || /stwo$/u.test(lower)) continue;
    if (!OPENS_CLAUSE.test(ctx.text.slice(Math.max(0, m.index - 40), m.index))) continue;
    if (userOrNamed(ctx, noun)) continue;
    const [start, end] = m.indices!.groups!.verb;
    findings.push({
      ...findingAt(ctx, start, end, [], RULE, MESSAGE),
      context: { start: m.index, end },
    });
  }
  return findings;
}

function majority(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const { between, verb } = m.groups!;
  // Only genitives between: "z nich", "ludności", "polskich miast".
  const genitive = (word: string) =>
    /^(?:z|ze|nich|nas|was|tych|tego|tej|ich|jego|jej|(?:m|tw|sw)oj(?:ej|ego)|(?:m|tw|sw)oich|(?:nasz|wasz)(?:ej|ego|ych))$/u.test(
      word,
    ) ||
    (nounTags(word) & cases("Gs Gp")) !== 0 ||
    /^(?:ego|ej|ych)$/u.test(adjectiveOf(word)?.ending ?? "");
  const words = between.match(/\p{L}+/gu) ?? [];
  if (!words.every((word) => genitive(word.toLowerCase()))) return null;
  // "(Przez) większość czasu było zimno": a span of time before an impersonal predicate.
  if (NOT_SUBJECT_BEFORE.test(ctx.text.slice(Math.max(0, m.index - 40), m.index))) return null;
  const next = /^[ \t ]+(\p{L}+)/u.exec(ctx.text.slice(m.index + m[0].length))?.[1];
  if (next && /o$/u.test(next) && !onlyNoun(nounTags(next.toLowerCase()))) return null;
  const [start, end] = m.indices!.groups!.verb;
  return {
    ...findingAt(ctx, start, end, [caseLike(verb, `${verb.slice(0, -1)}a`)], RULE, MESSAGE),
    context: { start: m.index, end },
  };
}

/** "Dzieci byli tutaj" -> "były", "Studenci przyszły" -> "przyszli". */
function pluralSubjects(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, PLURAL_SUBJECT)) {
    const { noun, verb, reflexive } = m.groups!;
    PLURAL_SUBJECT.lastIndex = m.index + noun.length;
    const lower = noun.toLowerCase();
    const tags = nounTags(lower);
    if (!onlyNoun(tags) || !(tags & cases("Np")) || userOrNamed(ctx, `${noun} ${verb}`)) continue;
    if (/\p{Lu}/u.test(noun[0]) && !sentenceStartAt(ctx.text, m.index)) continue;
    const before = ctx.text.slice(Math.max(0, m.index - 40), m.index);
    if (NOT_SUBJECT_BEFORE.test(before)) continue;
    const virileVerb = verb.endsWith("li");
    if (virileVerb) {
      // Feminine and neuter nouns (and "dzieci") only: a man's noun the lexicon does not mark
      // ("kolarze") must not read as a thing's.
      if (tags & (MASCULINE | VIRILE) || DURATION.test(lower)) continue;
      // An intransitive verb, or a reflexive one after a noun that is no genitive object.
      if (!INTRANSITIVE_PAST.test(verb) && !(reflexive && !(tags & cases("Gp")) && pastForm(verb)))
        continue;
      // The noun opens its clause, after a plural determiner at most.
      const det = /(\p{L}+)[ \t ]+$/u.exec(before);
      const opens = OPENS_CLAUSE.test(before);
      const determined =
        det &&
        (PLURAL_DETERMINER.test(det[1]) || adjectiveOf(det[1].toLowerCase())?.ending === "e") &&
        OPENS_CLAUSE.test(before.slice(0, det.index));
      if (!opens && !determined) continue;
    } else {
      // A man's plural that is no accusative or singular form ("studenci", "ludzie"; not "metry").
      if (!menOnlyPlural(lower) || tags & cases("Ns Gs As Ap")) continue;
      if (!pluralPast(verb)) continue;
    }
    const [start, end] = m.indices!.groups!.verb;
    findings.push({
      ...findingAt(ctx, start, end, otherPlural(verb.toLowerCase()), RULE, MESSAGE),
      context: { start: m.index, end },
    });
  }
  return findings;
}

/** An adjective form read through a "nie-" prefix the lexicon does not list ("nieobecne"). */
function adjectiveWithNie(word: string): { lemma: string; ending: string } | null {
  const adjective = adjectiveOf(word);
  if (adjective || !word.startsWith("nie")) return adjective;
  const base = adjectiveOf(word.slice(3));
  return base && { lemma: `nie${base.lemma}`, ending: base.ending };
}
function virileLemmaWithNie(word: string): string | null {
  if (word.length < 4) return null;
  const lemma = virileLemma(word);
  if (lemma || !word.startsWith("nie")) return lemma;
  const base = virileLemma(word.slice(3));
  return base && `nie${base}`;
}

/** "Oficerowie byli nieobecne" -> "nieobecni", "Kobiety były zmęczeni" -> "zmęczone". */
function predicateAdjectives(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const { verb, adj } = m.groups!;
  if (nounTags(adj) & ALL_CASES || ambiguousAdjective(adj) || userOrNamed(ctx, adj)) return null;
  const virileVerb = /li/u.test(verb.toLowerCase());
  // A subject of the other gender before the verb ("Dzieci byli zmęczone"): the verb is
  // what disagrees (pluralSubjects), not the adjective.
  const word =
    /(\p{L}+)[ \t ]+$/u
      .exec(ctx.text.slice(Math.max(0, m.index - 30), m.index))?.[1]
      .toLowerCase() ?? "";
  const subject = nounTags(word);
  if (onlyNoun(subject) && subject & cases("Np")) {
    // A thing's plural the lexicon also reads as men's ("praktyki", "powody") is no man's; a
    // man's noun it does not mark ("kolarze") still has a man's shape.
    const men = menOnlyPlural(word);
    const maybeMen = men || (subject & MASCULINE && menPluralShape(word));
    if (virileVerb ? !maybeMen : men) return null;
  }
  let fixes: string[];
  if (virileVerb) {
    const adjective = adjectiveWithNie(adj);
    if (adjective?.ending !== "e") return null;
    const virile = virileAdjective(adjective.lemma);
    fixes = virile ? [virile] : [];
  } else {
    const lemma = virileLemmaWithNie(adj);
    if (!lemma || adjectiveOf(adj)) return null;
    fixes = [adjectiveForm(lemma, "e")];
  }
  const [start, end] = m.indices!.groups!.adj;
  return {
    ...findingAt(ctx, start, end, fixes, RULE, "review_msg_pl_agreement"),
    context: { start: m.index, end },
  };
}

/** Words before a future "będzie" + infinitive: its subject, a question word or a time. */
const FUTURE_SUBJECT =
  /^(?:ja|ty|on|ona|ono|my|wy|oni|one|kto|co|czy|nie|już|też|jutro|wkrótce|zaraz|potem|wtedy|później|dziś|dzisiaj|wieczorem|rano|że|gdy|kiedy|jeśli|i|a|ale)$/iu;

/** "będzie zrobić", "będzie zrobił", "zaczął napisać": a perfective after them. */
function aspect(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const { aux, verb } = m.groups!;
  const future = /^będ/iu.test(aux);
  // The future takes an infinitive or a past form; the phase verbs only an infinitive.
  if (!future && !/[ćc]$/u.test(verb)) return null;
  // "będzie dojrzały": a past form that is also an adjective is the predicate.
  const lower = verb.toLowerCase();
  if (!/[ćc]$/u.test(lower) && (adjectiveOf(lower) || nounTags(lower))) return null;
  if (!perfectiveVerb(verb.toLowerCase()) || userOrNamed(ctx, verb)) return null;
  if (future && /[ćc]$/u.test(lower)) {
    // "będzie" + infinitive is a future only after its subject or a time word: "Najlepiej
    // będzie wyznać", "Zmuszona będę uciec", "Trzeba to będzie zrobić" use it as a copula.
    const before = /(\p{L}+)[ \t ]+$/u.exec(
      ctx.text.slice(Math.max(0, m.index - 30), m.index),
    )?.[1];
    const tags = before ? nounTags(before.toLowerCase()) : 0;
    if (before && !FUTURE_SUBJECT.test(before) && !onlyNoun(tags)) return null;
    // "Pierwszym krokiem będzie wyjechać": an instrumental noun makes "będzie" the copula.
    if (tags & cases("Is Ip") && !(tags & cases("Ns Np"))) return null;
    // "Będą umrzeć musieli": the modal comes after its infinitive.
    const after = ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 30);
    if (/^[ \t ]+(?:mus|mog|móg|chci|chcie|mia|mie|potraf|umia|umie)\p{L}*/iu.test(after))
      return null;
  }
  const [start, end] = m.indices!.groups!.verb;
  return {
    ...findingAt(ctx, start, end, [], RULE, "review_msg_pl_aspect"),
    context: { start: m.index, end },
  };
}

/** Before the word: a comparison ("jak nikt"), a preposition ("za nic", "o nic"). */
const NOT_NEGATING_BEFORE = new RegExp(
  `(?:^|[^\\p{L}])(?:jak|niż|niczym|prawie|${PREPOSITIONS})[ \\t\\u00a0]+$`,
  "iu",
);

function doubleNegation(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const { verb } = m.groups!;
  if (!finiteVerb(verb) && !pastByShape(verb)) return null;
  if (NOT_NEGATING_BEFORE.test(ctx.text.slice(Math.max(0, m.index - 24), m.index))) return null;
  if (userOrNamed(ctx, verb)) return null;
  const [start, end] = m.indices!.groups!.verb;
  return {
    ...findingAt(ctx, start, end, [`nie ${verb}`], RULE, "review_msg_pl_double_negation"),
    context: { start: m.index, end },
  };
}

/** Numerals in the genitive ("od jakichś kilku lat"). */
const GENITIVE_COUNT =
  /^(?:kilku|paru|kilkunastu|kilkudziesięciu|kilkuset|dwóch|dwu|trzech|czterech|pięciu|sześciu|siedmiu|ośmiu|dziewięciu|dziesięciu|stu|tysięcy|wielu|niewielu)$/u;
const SINGULAR_DIRECT = cases("Ns As Gs Ds Is Ls Vs Np");
const PLURAL_OBLIQUE = cases("Gp Lp");

/** "jakiś dziewczyn", "od jakiś kilku lat" -> "jakichś": the genitive or locative plural. */
function jakis(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const { target, next } = m.groups!;
  const tags = nounTags(next.toLowerCase());
  const plural =
    GENITIVE_COUNT.test(next.toLowerCase()) ||
    (onlyNoun(tags) && tags & PLURAL_OBLIQUE && !(tags & SINGULAR_DIRECT));
  if (!plural || userOrNamed(ctx, next)) return null;
  const [start, end] = m.indices!.groups!.target;
  return {
    ...findingAt(ctx, start, end, [caseLike(target, "jakichś")], RULE, "review_msg_pl_agreement"),
    context: { start: m.index, end: m.index + m[0].length },
  };
}

export const PREDICATES = {
  subjectNumber: (ctx: DetectContext) =>
    isPl(ctx) ? [...pluralSubjects(ctx), ...singularSubjects(ctx)] : [],
} satisfies Record<string, Detector>;

/** The named frame fixes of the subject rules of grammar/rules/pl.yaml (`fixer:`). */
export const FIXERS = {
  pronounGender,
  zostacAgreement,
  majority,
  aspect,
  doubleNegation,
  predicateAdjectives,
  jakis,
} satisfies Record<string, MatchFixer>;
