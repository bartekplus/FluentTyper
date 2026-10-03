import type { DetectContext, RawFinding } from "../reviewDetectors";
import {
  adjectiveForm,
  ALL_CASES,
  ambiguousAdjective,
  adjectiveOf,
  cases,
  finiteVerb,
  MASCULINE,
  nounTags,
  onlyNoun,
  pastByShape,
  virileAdjective,
  virileLemma,
  VERB,
  VIRILE,
} from "./lexicon";
import {
  caseLike,
  CLAUSE_START,
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
      // A man's plural that is no accusative or singular form ("studenci", "ludzie").
      if (!(tags & VIRILE) || tags & cases("Ns Gs As Ap")) continue;
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

/** A plural "być" or "zostać" and the adjective that ends its clause ("byli zmęczeni."). */
const PREDICATE = new RegExp(
  `(?<![\\p{L}\\p{N}_'’@/-])(?<verb>(?:by|zosta)(?:li|ły)(?:śmy|ście)?)${S}(?:(?:bardzo|już|nadal|wciąż|też|także|również|zawsze|naprawdę|zbyt|całkiem|zupełnie|wtedy|tam|tu)${S})?(?<adj>\\p{Ll}{4,})(?=[ \\t\\u00a0]{0,8}(?:[.,;:!?…)]|$|(?:i|oraz|a|ale)[ \\t\\u00a0]))`,
  "giud",
);

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
function predicateAdjectives(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, PREDICATE)) {
    const { verb, adj } = m.groups!;
    if (nounTags(adj) & ALL_CASES || ambiguousAdjective(adj) || userOrNamed(ctx, adj)) continue;
    const virileVerb = /li/u.test(verb.toLowerCase());
    // A subject of the other gender before the verb ("Dzieci byli zmęczone"): the verb is
    // what disagrees (pluralSubjects), not the adjective.
    const subject = nounTags(
      /(\p{L}+)[ \t ]+$/u
        .exec(ctx.text.slice(Math.max(0, m.index - 30), m.index))?.[1]
        .toLowerCase() ?? "",
    );
    if (onlyNoun(subject) && subject & cases("Np")) {
      const men = (subject & VIRILE) !== 0;
      if (virileVerb ? !men && !(subject & MASCULINE) : men) continue;
    }
    let fixes: string[];
    if (virileVerb) {
      const adjective = adjectiveWithNie(adj);
      if (adjective?.ending !== "e") continue;
      const virile = virileAdjective(adjective.lemma);
      fixes = virile ? [virile] : [];
    } else {
      const lemma = virileLemmaWithNie(adj);
      if (!lemma || adjectiveOf(adj)) continue;
      fixes = [adjectiveForm(lemma, "e")];
    }
    const [start, end] = m.indices!.groups!.adj;
    findings.push({
      ...findingAt(ctx, start, end, fixes, RULE, "review_msg_pl_agreement"),
      context: { start: m.index, end },
    });
  }
  return findings;
}

/** "Nigdy tego zrobiłam", "Nikt przyszedł": a negative pronoun or adverb without "nie". */
const NEGATIVE = new RegExp(
  `(?<![\\p{L}\\p{N}_'’@/-])(?<neg>nigdy|nikt|nikogo|nikomu|niczego|nigdzie|nic)${S}(?:(?:tego|to|go|ją|je|mu|mi|jej|im|nam|wam|ci|się|już|tam|tu)${S}){0,2}(?<verb>\\p{Ll}{2,})(?![\\p{L}\\p{N}_'’@/-])`,
  "giud",
);
/** Before the word: a comparison ("jak nikt"), a preposition ("za nic", "o nic"). */
const NOT_NEGATING_BEFORE = new RegExp(
  `(?:^|[^\\p{L}])(?:jak|niż|niczym|prawie|${PREPOSITIONS})[ \\t\\u00a0]+$`,
  "iu",
);

function doubleNegation(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, NEGATIVE)) {
    const { verb } = m.groups!;
    if (!finiteVerb(verb) && !pastByShape(verb)) continue;
    if (NOT_NEGATING_BEFORE.test(ctx.text.slice(Math.max(0, m.index - 24), m.index))) continue;
    if (userOrNamed(ctx, verb)) continue;
    const [start, end] = m.indices!.groups!.verb;
    findings.push({
      ...findingAt(ctx, start, end, [`nie ${verb}`], RULE, "review_msg_pl_double_negation"),
      context: { start: m.index, end },
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
      isPl(ctx)
        ? [
            ...pronounGender(ctx),
            ...zostacAgreement(ctx),
            ...pluralSubjects(ctx),
            ...doubleNegation(ctx),
            ...predicateAdjectives(ctx),
            ...jakis(ctx),
          ]
        : [],
  },
];
