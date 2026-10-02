import type { DetectContext, RawFinding } from "../reviewDetectors";
import {
  adjectiveAgrees,
  adjectiveForm,
  adjectiveOf,
  agreeingEndings,
  ambiguousAdjective,
  readingCases,
  ALL_CASES,
  cases,
  FEMININE,
  MASCULINE,
  NEUTER,
  nounTags,
  onlyNoun,
} from "./lexicon";
import { caseLike, findingAt, isPl, owned, sentenceStartAt, userOrNamed } from "./shared";

/*
 * Case and agreement read from the noun lexicon: a preposition governs the case of the noun
 * right after it ("przed sklepem", not "przed sklepie"), a demonstrative agrees with its noun
 * ("tę książkę", "to dziecko"), and a numeral from five up takes the genitive plural
 * ("pięć plików"). A word is checked only when every dictionary reading of it is a noun.
 */

const RULE = "polishCaseAgreement" as const;

/** The cases each preposition governs (L locative, V for the vocative after "o"). */
const GOVERNS: Record<string, string> = {
  bez: "G",
  beze: "G",
  dla: "G",
  do: "G",
  od: "G",
  ode: "G",
  u: "G",
  z: "GIA",
  ze: "GIA",
  spod: "G",
  znad: "G",
  zza: "G",
  sprzed: "G",
  spomiędzy: "G",
  spośród: "G",
  wśród: "G",
  obok: "G",
  podczas: "G",
  według: "G",
  zamiast: "G",
  oprócz: "G",
  prócz: "G",
  wobec: "G",
  wokół: "G",
  dookoła: "G",
  wzdłuż: "G",
  dzięki: "D",
  ku: "D",
  przeciw: "D",
  przeciwko: "D",
  wbrew: "D",
  w: "LA",
  we: "LA",
  na: "LA",
  o: "LAV",
  po: "LA",
  przy: "L",
  przez: "A",
  przeze: "A",
  poprzez: "A",
  przed: "IA",
  przede: "IA",
  za: "IAG",
  nad: "IA",
  nade: "IA",
  pod: "IA",
  pode: "IA",
  między: "IA",
  pomiędzy: "IA",
  poza: "AI",
};
const GOVERNED = Object.fromEntries(
  Object.entries(GOVERNS).map(([prep, letters]) => [
    prep,
    [...letters].reduce((mask, letter) => mask | cases(`${letter}s ${letter}p`), 0),
  ]),
);

/** Prepositions that also stand alone as adverbs ("Obok stoi dom"): a nominative after them is a subject. */
const ADVERBIAL = new Set(["obok", "wokół", "dookoła", "wzdłuż", "przeciw", "przeciwko"]);

/** "wraz z psem", "razem z nim": these "z" phrases take the instrumental only. */
const WITH = /(?:^|[^\p{L}])(?:wraz|razem)[ \t\u00a0]+$/iu;

/** The cases `prep` governs where it stands (`before` is the text before it). */
export function governedBy(prep: string, before = ""): number | undefined {
  if ((prep === "z" || prep === "ze") && WITH.test(before)) return cases("Is Ip");
  return GOVERNED[prep];
}

/** The noun after `prep` carries none of the cases it governs. */
export function prepositionClash(prep: string, noun: string, before = ""): boolean {
  const governed = governedBy(prep, before);
  const tags = nounTags(noun);
  if (governed === undefined || !onlyNoun(tags, true) || (tags & governed) !== 0) return false;
  return !(ADVERBIAL.has(prep) && tags & NOMINATIVE);
}

const NOMINATIVE = cases("Ns Np");
/** The word ends here and is not a short abbreviation ("por.", "ul.", "lit."). */
const WORD = "(?![\\p{L}\\p{N}_'’@/-])(?<![ \\t\\u00a0]\\p{L}{1,3}(?=\\.))";
const PREPOSITION = new RegExp(
  `(?<![\\p{L}\\p{N}_'’.@/-])(?<prep>${Object.keys(GOVERNS).join("|")})[ \\t\\u00a0]+(?<noun>\\p{L}+)${WORD}`,
  "giu",
);

function prepositionCase(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, PREPOSITION)) {
    const { prep, noun } = m.groups!;
    if (!/^\p{Ll}+$/u.test(noun) || userOrNamed(ctx, noun)) continue;
    const before = ctx.text.slice(Math.max(0, m.index - 12), m.index);
    if (!prepositionClash(prep.toLowerCase(), noun, before)) continue;
    const start = m.index + m[0].length - noun.length;
    findings.push({
      ...findingAt(ctx, start, start + noun.length, [], RULE, "review_msg_pl_preposition_case"),
      context: { start: m.index, end: start + noun.length },
    });
  }
  return findings;
}

/* ------------------------------------------------------------ demonstratives */

const SG = (spec: string) =>
  cases(
    spec
      .split(" ")
      .map((c) => `${c}s`)
      .join(" "),
  );
const PL = (spec: string) =>
  cases(
    spec
      .split(" ")
      .map((c) => `${c}p`)
      .join(" "),
  );
/** A demonstrative's forms by what they agree with: gender (or plural), cases. */
const DEMONSTRATIVES: Record<string, Array<[gender: number, cases: number, form: string]>> = {
  ten: [[MASCULINE, SG("N A"), "ten"]],
  ta: [[FEMININE, SG("N"), "ta"]],
  tę: [[FEMININE, SG("A"), "tę"]],
  tą: [[FEMININE, SG("I"), "tą"]],
  to: [[NEUTER, SG("N A"), "to"]],
  te: [[0, PL("N A"), "te"]],
  jeden: [[MASCULINE, SG("N A"), "jeden"]],
  jedna: [[FEMININE, SG("N"), "jedna"]],
  jedną: [[FEMININE, SG("A I"), "jedną"]],
  jedno: [[NEUTER, SG("N A"), "jedno"]],
  jedne: [[0, PL("N A"), "jedne"]],
};
// "to" is also the copula ("to dom"), so it is never checked, only suggested.
const CHECKED = ["ten", "ta", "tę", "tą", "te", "jedne", "jedna", "jedną"];
const FAMILY: Record<string, string[]> = {
  ten: ["ten", "ta", "tę", "tą", "to", "te"],
  jeden: ["jeden", "jedna", "jedną", "jedno", "jedne"],
};
const familyOf = (det: string) => (det.startsWith("jed") ? FAMILY.jeden : FAMILY.ten);

/** The demonstratives of `det`'s family that agree with `tags` (none when `det` does). */
export function demonstrativeFix(det: string, tags: number): string[] {
  const agrees = (form: string) =>
    DEMONSTRATIVES[form].some(
      ([gender, wanted]) => (tags & wanted) !== 0 && (gender === 0 || (tags & gender) !== 0),
    );
  if (!DEMONSTRATIVES[det] || !onlyNoun(tags) || agrees(det)) return [];
  // Only a noun of a single gender: "te rzeczywistość" is "ta" or "tę", never "ten".
  if ([MASCULINE, FEMININE, NEUTER].filter((g) => tags & g).length !== 1) return [];
  const fits = familyOf(det).filter((form) => form !== det && agrees(form));
  return fits.length <= 2 ? fits : [];
}

const DEMONSTRATIVE = new RegExp(
  `(?<![\\p{L}\\p{N}_'’.@/-])(?<det>${CHECKED.join("|")})[ \\t\\u00a0]+(?:(?<adj>\\p{Ll}{3,})[ \\t\\u00a0]+)?(?<noun>\\p{Ll}+)${WORD}`,
  "giu",
);

function demonstratives(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, DEMONSTRATIVE)) {
    const { det, adj } = m.groups!;
    // "tą małą książkę": one adjective may stand between (it is checked on its own);
    // any other first word is the noun itself.
    const between = adj && adjectiveOf(adj);
    const skip =
      !between ||
      PRONOUNS.has(between.lemma) ||
      ambiguousAdjective(adj) ||
      nounTags(adj) & ALL_CASES;
    const noun = adj && skip ? adj : m.groups!.noun;
    if (!/^\p{Ll}+$/u.test(noun) || userOrNamed(ctx, noun)) continue;
    const fixes = demonstrativeFix(det.toLowerCase(), nounTags(noun));
    if (fixes.length === 0) continue;
    findings.push({
      ...findingAt(
        ctx,
        m.index,
        m.index + det.length,
        fixes.map((fix) => caseLike(det, fix)),
        RULE,
        "review_msg_pl_agreement",
      ),
      context: { start: m.index, end: m.index + m[0].length },
    });
  }
  return findings;
}

/* ----------------------------------------------------------------- numerals */

/** Numerals from five up (and "kilka"), which take the genitive plural in the nominative. */
const FIVE_UP = [
  ..."pięć sześć siedem osiem dziewięć dziesięć jedenaście dwanaście trzynaście czternaście piętnaście szesnaście siedemnaście osiemnaście dziewiętnaście".split(
    " ",
  ),
  ..."dwadzieścia trzydzieści czterdzieści pięćdziesiąt sześćdziesiąt siedemdziesiąt osiemdziesiąt dziewięćdziesiąt".split(
    " ",
  ),
  ..."sto dwieście trzysta czterysta pięćset sześćset siedemset osiemset dziewięćset".split(" "),
  ..."kilka kilkanaście kilkadziesiąt kilkaset parę".split(" "),
];
const GENITIVE = cases("Gs Gp");
const NOMINATIVE_FORMS = cases("Ns Np");

const NUMERAL = new RegExp(
  `(?<![\\p{L}\\p{N}_'’.,@/-])(?<num>${FIVE_UP.join("|")}|\\d+)[ \\t\\u00a0]+(?<noun>\\p{Ll}+)${WORD}`,
  "giu",
);

/** "pięć pliki", "kilka godzina", "15 baloniki": a nominative where the genitive plural goes. */
export function numeralClash(num: string, tags: number): boolean {
  if (!/^\d+$/.test(num) && !FIVE_UP.includes(num)) return false;
  if (!onlyNoun(tags) || tags & GENITIVE || !(tags & NOMINATIVE_FORMS)) return false;
  if (!/^\d+$/.test(num)) return true;
  // Digits: a plural noun only ("15 baloniki"), since a year or a house number may come before
  // a subject ("w 2010 papież"), and only where the number asks for the genitive (not 22-24).
  const n = Number(num);
  if (num.length > 3 || tags & cases("Ns")) return false;
  return n >= 5 && !(n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14));
}

function numerals(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, NUMERAL)) {
    const { num, noun } = m.groups!;
    if (!/^\p{Ll}+$/u.test(noun) || userOrNamed(ctx, noun)) continue;
    // A decimal, a number in a code or a list ("1,5", "art. 5", "5.") is not a count.
    const before = ctx.text.slice(Math.max(0, m.index - 6), m.index);
    if (/^\d/.test(num) && /(?:[\d,.:/§-]|\p{L}\.|nr|pkt|art|poz)[ \t\u00a0]*$/u.test(before))
      continue;
    if (!numeralClash(num.toLowerCase(), nounTags(noun))) continue;
    const start = m.index + m[0].length - noun.length;
    findings.push({
      ...findingAt(ctx, start, start + noun.length, [], RULE, "review_msg_pl_agreement"),
      context: { start: m.index, end: start + noun.length },
    });
  }
  return findings;
}

/* --------------------------------------------------------------- adjectives */

/** Cases an adjective can govern ("pełna wody", "zajęta pracą"): such a noun may not be its own. */
const OBLIQUE = cases("Gs Ds Is Ls Gp Dp Ip Lp");
/** Pronouns that inflect like adjectives but stand alone ("o którym mowa", "temu klient"). */
const PRONOUNS = new Set(
  "ty który jaki taki ten tamten ów czyj każdy żaden wszystek sam jakiś mój twój swój nasz wasz niektóry inny".split(
    " ",
  ),
);
const bitCount = (mask: number) => mask.toString(2).replace(/0/g, "").length;
/** a <-> ą, e <-> ę: the diacritic typed or dropped. */
const TWIN: Record<string, string> = { a: "ą", ą: "a", e: "ę", ę: "e" };
/** The instrumental also predicates ("uczynić łatwiejszym życie"), so it is not checked. */
const PREDICATIVE = new Set(["ym", "ymi"]);
/**
 * The only ending an adjective after its noun has just by agreeing with it: a nominative may
 * describe the subject ("wrócił do domu zmęczony"), and a genitive or dative may be a noun
 * itself ("ustąp miejsca starszemu", "algorytm obliczania średniej").
 */
const AFTER_ENDINGS = new Set(["ą"]);

export interface AdjectiveContext {
  /** The cases the preposition before the pair governs. */
  governed?: number;
  /** The adjective follows its noun and ends the phrase ("komisje śledczą."). */
  after?: boolean;
}

/**
 * "ważną sprawa", "odpowiednia infrastrukturę", "duży dziecko": an adjective and its noun share
 * no case, number and gender. Returns the fixes for the pair, in its word order: the adjective
 * made to agree, or the noun's diacritic toggled. Null when they agree or a reading is unsure.
 */
export function adjectiveClash(
  adjective: string,
  noun: string,
  { governed, after }: AdjectiveContext = {},
): string[] | null {
  const adj = adjectiveOf(adjective);
  if (!adj || PRONOUNS.has(adj.lemma) || ambiguousAdjective(adjective)) return null;
  if (nounTags(adjective) & ALL_CASES) return null;
  let tags = nounTags(noun);
  if (!onlyNoun(tags)) return null;
  if (governed !== undefined) {
    // After a preposition both words stand in a case it governs: compare those readings only,
    // unless the pair agrees in another case ("na różnego rodzaju sprzęt").
    if (adjectiveAgrees(adj.ending, tags)) return null;
    if (!(tags & governed)) return null;
    tags = (tags & ~ALL_CASES) | (tags & governed);
  } else if (PREDICATIVE.has(adj.ending)) return null;
  else if (after ? !AFTER_ENDINGS.has(adj.ending) : tags & OBLIQUE) return null;
  if (adjectiveAgrees(adj.ending, tags)) return null;
  const pair = (a: string, n: string) => (after ? `${n} ${a}` : `${a} ${n}`);
  const fixes = new Set<string>();
  // Of the endings that agree, those closest to the typed one ("szybkie samochód" -> "szybki").
  const overlap = (ending: string) => bitCount(readingCases(ending) & readingCases(adj.ending));
  const endings = agreeingEndings(tags);
  const best = Math.max(...endings.map(overlap));
  const closest = endings.filter((ending) => overlap(ending) === best);
  if (closest.length === 1) fixes.add(pair(adjectiveForm(adj.lemma, closest[0]), noun));
  const twin = TWIN[noun.at(-1)!];
  if (twin) {
    const toggled = noun.slice(0, -1) + twin;
    const twinTags = nounTags(toggled);
    if (onlyNoun(twinTags) && adjectiveAgrees(adj.ending, twinTags))
      fixes.add(pair(adjective, toggled));
  }
  return [...fixes];
}

const PAIR = new RegExp(
  `(?<![\\p{L}\\p{N}_'’.@/-])(?<first>\\p{L}{3,})[ \\t\\u00a0]+(?<second>\\p{Ll}{3,})${WORD}`,
  "gu",
);

/** The word before `start`, lowercased. */
function wordBefore(text: string, start: number): string | undefined {
  return /(\p{L}+)[ \t\u00a0]+$/u
    .exec(text.slice(Math.max(0, start - 40), start))?.[1]
    .toLowerCase();
}

/**
 * The adjective agrees with the word before it, so it ends that phrase ("w górach wysokich
 * forma", "stronę niemiecką data") or stands for a noun ("Tej wysokiej forma nie opuszcza").
 */
function closesPhraseBefore(word: string, adjective: string): boolean {
  const { ending } = adjectiveOf(adjective)!;
  if (
    /(?:ej|ego|emu|ych|ich|ymi|imi|ym|im|ą)$/u.test(adjective) &&
    word.slice(-2) === adjective.slice(-2)
  )
    return true;
  const tags = nounTags(word);
  return (tags & ALL_CASES) !== 0 && adjectiveAgrees(ending, tags);
}

function adjectives(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const report = (start: number, end: number, typed: string, fixes: string[]) =>
    findings.push(
      findingAt(
        ctx,
        start,
        end,
        fixes.map((fix) => caseLike(typed, fix)),
        RULE,
        "review_msg_pl_agreement",
      ),
    );
  for (const m of owned(ctx, PAIR)) {
    const { first, second } = m.groups!;
    // Overlapping pairs: the next scan starts at the second word, which may open the next pair.
    PAIR.lastIndex = m.index + first.length;
    const end = m.index + m[0].length;
    if (userOrNamed(ctx, first) || userOrNamed(ctx, second)) continue;
    // A capital inside a sentence names something ("w Wysokiej", "łaski Bożej").
    const lower = /^\p{Ll}+$/u.test(first);
    if (!lower && !(/^\p{Lu}\p{Ll}+$/u.test(first) && sentenceStartAt(ctx.text, m.index))) continue;
    const previous = wordBefore(ctx.text, m.index);
    const governed =
      previous === undefined
        ? undefined
        : governedBy(
            previous,
            ctx.text.slice(Math.max(0, m.index - 24), m.index).replace(/\p{L}+[ \t\u00a0]+$/u, ""),
          );
    const adjectiveFirst = adjectiveClash(first.toLowerCase(), second, { governed });
    if (
      adjectiveFirst &&
      (governed !== undefined || !previous || !closesPhraseBefore(previous, first.toLowerCase()))
    ) {
      report(m.index, end, first, adjectiveFirst);
      continue;
    }
    // "komisje śledczą.": an adjective closing the phrase after its noun.
    if (lower && /^[ \t\u00a0]*(?:[.,;:!?)…]|$)/u.test(ctx.text.slice(end, end + 3))) {
      const fixes = adjectiveClash(second, first, { after: true });
      if (fixes) report(m.index, end, first, fixes);
    }
  }
  return findings;
}

export const DETECTORS = [
  {
    rules: [RULE] as RawFinding["ruleId"][],
    detect: (ctx: DetectContext) =>
      isPl(ctx)
        ? [...prepositionCase(ctx), ...demonstratives(ctx), ...numerals(ctx), ...adjectives(ctx)]
        : [],
  },
];
