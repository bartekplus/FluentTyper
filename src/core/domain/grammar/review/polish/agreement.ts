import type { Detector, MatchFixer, MatchResult } from "../../engine/reviewRules";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import {
  adjectiveAgrees,
  adjectiveForm,
  adjectiveOf,
  agreeingEndings,
  ambiguousAdjective,
  finiteVerb,
  readingCases,
  ALL_CASES,
  cases,
  FEMININE,
  inflect,
  MASCULINE,
  menOnlyPlural,
  NEUTER,
  nounTags,
  onlyNoun,
  pastByShape,
  PLURAL,
  SINGULAR,
  VIRILE,
  virileAdjective,
} from "./lexicon";
import {
  caseLike,
  findingAt,
  isPl,
  owned,
  PREPOSITIONS,
  sentenceStartAt,
  userOrNamed,
} from "./shared";

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
function governedBy(prep: string, before = ""): number | undefined {
  if ((prep === "z" || prep === "ze") && WITH.test(before)) return cases("Is Ip");
  return GOVERNED[prep];
}

/** Idioms that keep an old accusative: "wyjść za mąż", "za pan brat", "Na koń!". */
const OLD_ACCUSATIVES = new Set(["za mąż", "za pan", "na koń"]);

/** The noun after `prep` carries none of the cases it governs. */
function prepositionClash(prep: string, noun: string, before = ""): boolean {
  if (OLD_ACCUSATIVES.has(`${prep} ${noun.toLowerCase()}`)) return false;
  const governed = governedBy(prep, before);
  const tags = nounTags(noun);
  if (governed === undefined || !onlyNoun(tags, true) || (tags & governed) !== 0) return false;
  return !(ADVERBIAL.has(prep) && tags & NOMINATIVE);
}

const NOMINATIVE = cases("Ns Np");
/** The word ends here and is not a short abbreviation ("por.", "ul."; none ends in "ą", "ę": "grą."). */
const WORD = "(?![\\p{L}\\p{N}_'’@/-])(?<![ \\t\\u00a0]\\p{L}{0,2}(?![ąęĄĘ])\\p{L}(?=\\.))";
/** Short abbreviations a preposition takes ("w ust. 2", "przy ul. Długiej"). */
const SHORT_ABBREVIATIONS = new Set(
  "ust lit ok ul al pl os ds cz ww ub dz br wł zw ob dn im jw św ks gen por kpr hm pkt art rys tab poz str".split(
    " ",
  ),
);

function prepositionCase(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const { prep, noun } = m.groups!;
  if (!/^\p{Ll}+$/u.test(noun) || userOrNamed(ctx, noun)) return null;
  // "w ust. 2", "na str. 5": a short word with a period is an abbreviation unless it ends the
  // sentence ("wraz z psa.").
  const after = ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 3);
  if (
    noun.length <= 3 &&
    after.startsWith(".") &&
    (SHORT_ABBREVIATIONS.has(noun.toLowerCase()) || !/^\.(?:$|\s*\n|\s+\p{Lu})/u.test(after))
  )
    return null;
  // A title abbreviation ("dzięki dr Kowalskiemu", "u mgr Nowak") is no noun to inflect.
  if (!/[aeiouyąęó]/u.test(noun)) return null;
  const before = ctx.text.slice(Math.max(0, m.index - 12), m.index);
  if (!prepositionClash(prep.toLowerCase(), noun, before)) return null;
  const start = m.index + m[0].length - noun.length;
  // "z" takes the accusative only for a rough amount ("z godzinę"): no fix offers it.
  const wanted = governedBy(prep.toLowerCase(), before)!;
  const fixes = recased(noun, /^ze?$/iu.test(prep) ? wanted & ~cases("As Ap") : wanted);
  return {
    ...findingAt(ctx, start, start + noun.length, fixes, RULE, "review_msg_pl_preposition_case"),
    context: { start: m.index, end: start + noun.length },
  };
}

/**
 * The noun's forms in the `wanted` cases and its own number ("sklepie" -> "sklepem", "sklep"
 * before "przed"); none when more than two would fit.
 */
function recased(noun: string, wanted: number): string[] {
  const tags = nounTags(noun);
  const number = tags & SINGULAR ? SINGULAR : PLURAL;
  const forms = inflect(noun, wanted & number);
  return forms.length <= 2 ? forms.map((form) => caseLike(noun, form)) : [];
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
const FAMILY: Record<string, string[]> = {
  ten: ["ten", "ta", "tę", "tą", "to", "te"],
  jeden: ["jeden", "jedna", "jedną", "jedno", "jedne"],
};
const familyOf = (det: string) => (det.startsWith("jed") ? FAMILY.jeden : FAMILY.ten);

/** The demonstratives of `det`'s family that agree with `tags` (none when `det` does). */
function demonstrativeFix(det: string, tags: number): string[] {
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

function demonstratives(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const { det, adj } = m.groups!;
  // "tą małą książkę": one adjective may stand between (it is checked on its own);
  // any other first word is the noun itself.
  const between = adj && adjectiveOf(adj);
  const skip =
    !between || PRONOUNS.has(between.lemma) || ambiguousAdjective(adj) || nounTags(adj) & ALL_CASES;
  const noun = adj && skip ? adj : m.groups!.noun;
  if (!/^\p{Ll}+$/u.test(noun) || userOrNamed(ctx, noun)) return null;
  const fixes = demonstrativeFix(det.toLowerCase(), nounTags(noun));
  if (fixes.length === 0) return null;
  return {
    ...findingAt(
      ctx,
      m.index,
      m.index + det.length,
      fixes.map((fix) => caseLike(det, fix)),
      RULE,
      "review_msg_pl_agreement",
    ),
    context: { start: m.index, end: m.index + m[0].length },
  };
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
/** Nouns of number that count in the genitive plural ("tysiące ludzi", "setki listów"). */
const COUNT_NOUNS =
  "dziesiątki setki tysiące miliony miliardy dziesiątek setek tysięcy milionów miliardów".split(
    " ",
  );
/** "dwa", "trzy", "cztery" (alone or ending "dwadzieścia trzy"): the nominative plural. */
const TWO_TO_FOUR = ["dwa", "dwie", "trzy", "cztery", "oba", "obie"];
const NOMINATIVE_FORMS = cases("Ns Np");

/** What a number asks of its noun: the genitive plural (5-21), the nominative (2-4) or nothing. */
function numeralNeeds(num: string): "Gp" | "Np" | null {
  if (TWO_TO_FOUR.includes(num)) return "Np";
  if (FIVE_UP.includes(num) || COUNT_NOUNS.includes(num)) return "Gp";
  if (!/^\d{1,3}$/.test(num)) return null;
  const n = Number(num);
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) return "Np";
  return n >= 5 ? "Gp" : null;
}

/** "pięć pliki", "kilka godzina", "15 baloniki", "98 osoby", "23 osób", "trzy godzin". */
function numeralClash(num: string, tags: number): boolean {
  const needs = numeralNeeds(num);
  if (!needs || !onlyNoun(tags)) return false;
  // A genitive plural only where the nominative goes, of a feminine or neuter noun: "dwa
  // procent" and men ("24 policjantów", "trzech studentów") are left alone.
  if (needs === "Np") return !(tags & (NOMINATIVE_FORMS | MASCULINE)) && (tags & cases("Gp")) !== 0;
  if (tags & cases("Gp") || !(tags & NOMINATIVE_FORMS)) return false;
  // Digits: a plural noun only ("15 baloniki"), since a year or a house number may come before
  // a subject ("w 2010 papież").
  return !/^\d/.test(num) || !(tags & cases("Ns"));
}

/** Words before a number that put it in the genitive ("od 3 lat", "około 3 lat", "brak"). */
const GOVERNING = new RegExp(
  `^(?:${Object.keys(GOVERNS).join("|")}|około|ponad|powyżej|poniżej|blisko|niespełna|koło|naprzeciw|kosztem|brak|braku|wiele|ile|tyle)$`,
  "iu",
);
/** Verbs whose object stands in the genitive ("dotyczy 3 osób", "brakuje 2 głosów"). */
const GENITIVE_VERB =
  /^(?:dotycz|potrzeb|wymag|szuk|używ|unik|brak|zabrak|żąd|udziel|życz|nabr|nabier|ubył|przybył|naucz|słuch|pilnow|pilnuj|trzeba|starcz|wystarcz)/iu;

/**
 * A count stands free here: no preposition, noun, genitive adjective ("ostatnich"), verb taking
 * the genitive or negation before it, so the noun's case is the number's own.
 */
function freeCount(text: string, at: number): boolean {
  const before = text.slice(Math.max(0, at - 48), at);
  const clause = before.split(/[,;:.!?()„”"–—]/u).pop()!;
  if (/(?:^|[^\p{L}])nie[ \t\u00a0]/iu.test(clause)) return false;
  const words = (clause.match(/\p{L}+/gu) ?? []).slice(-3).map((word) => word.toLowerCase());
  // "z posiadanych obecnie 43 miejsc": a preposition or genitive a few words back, unless a noun
  // or a verb stands between ("na przystanku czekało 37 osób").
  for (const word of [...words].reverse()) {
    if (GOVERNING.test(word) || /(?:ch|ego|ej)$/u.test(word)) return false;
    if (nounTags(word) & ALL_CASES || /(?:ł|ła|ło|li|ły)$/u.test(word)) break;
  }
  const prev = words.at(-1);
  if (!prev) return true;
  // A noun or verbal noun governs it ("grupa 3 os\u00f3b", "sprywatyzowanie 2 tysi\u0119cy").
  if (GENITIVE_VERB.test(prev) || /(?:ni|ci)e$/u.test(prev)) return false;
  return !(nounTags(prev) & ALL_CASES);
}

/** A cardinal's genitive ("dwieście" -> "dwustu", also "dwuset"). */
const GENITIVE_NUMERALS: Record<string, string[]> = {
  dwa: ["dwóch"],
  dwie: ["dwóch"],
  trzy: ["trzech"],
  cztery: ["czterech"],
  pięć: ["pięciu"],
  sześć: ["sześciu"],
  siedem: ["siedmiu"],
  osiem: ["ośmiu"],
  dziewięć: ["dziewięciu"],
  dziesięć: ["dziesięciu"],
  jedenaście: ["jedenastu"],
  dwanaście: ["dwunastu"],
  piętnaście: ["piętnastu"],
  dwadzieścia: ["dwudziestu"],
  trzydzieści: ["trzydziestu"],
  czterdzieści: ["czterdziestu"],
  pięćdziesiąt: ["pięćdziesięciu"],
  sto: ["stu"],
  dwieście: ["dwustu", "dwuset"],
  trzysta: ["trzystu"],
  czterysta: ["czterystu"],
  pięćset: ["pięciuset"],
  kilka: ["kilku"],
  kilkanaście: ["kilkunastu"],
  kilkadziesiąt: ["kilkudziesięciu"],
  kilkaset: ["kilkuset"],
};
/** Words after which a count stands in the genitive: "około pięciu", "do trzech", "bez dwóch". */
const GENITIVE_BEFORE =
  /(?:^|[^\p{L}])(?:około|ok\.|blisko|niespełna|do|od|bez|dla|spośród|wśród|wobec)[ \t\u00a0]{1,8}$/iu;

/** "około dwieście psów" -> "około dwustu psów": a count after a genitive-taking word. */
function genitiveNumerals(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const before = ctx.text.slice(Math.max(0, m.index - 12), m.index);
  if (!GENITIVE_BEFORE.test(before)) return null;
  // "o około dwie godziny", "na około pięć milionów": the preposition before "około" governs.
  if (
    new RegExp(
      `(?:^|[^\\p{L}])(?:${PREPOSITIONS})[ \\t\\u00a0]{1,8}(?:około|ok\\.|blisko|niespełna)[ \\t\\u00a0]{1,8}$`,
      "iu",
    ).test(ctx.text.slice(Math.max(0, m.index - 24), m.index))
  )
    return null;
  // "od dwa do trzech", "do pięć razy więcej" are left to the writer; so is "z dziesięć".
  const after = ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 30);
  if (/^[ \t\u00a0]+(?:do|razy|na|i|lub|albo)(?![\p{L}])/iu.test(after)) return null;
  const num = m.groups!.num;
  return {
    ...findingAt(
      ctx,
      m.index,
      m.index + num.length,
      GENITIVE_NUMERALS[num.toLowerCase()].map((form) => caseLike(num, form)),
      RULE,
      "review_msg_pl_preposition_case",
    ),
    context: { start: Math.max(0, m.index - 12), end: m.index + num.length },
  };
}

function numeralNouns(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const { num, noun } = m.groups!;
  if (!/^\p{Ll}+$/u.test(noun) || userOrNamed(ctx, noun)) return null;
  // A decimal, a number in a code or a list ("1,5", "art. 5", "5.") is not a count.
  const before = ctx.text.slice(Math.max(0, m.index - 6), m.index);
  if (/^\d/.test(num) && /(?:[\d,.:/§–—-]|\p{L}\.|nr|pkt|art|poz)[ \t\u00a0]*$/u.test(before))
    return null;
  const lower = num.toLowerCase();
  // "około pięć osób": the numeral itself takes the genitive (checked below), not the noun.
  if (
    GENITIVE_NUMERALS[lower] &&
    GENITIVE_BEFORE.test(ctx.text.slice(Math.max(0, m.index - 12), m.index))
  )
    return null;
  const tags = nounTags(noun);
  if (!numeralClash(lower, tags)) return null;
  const needs = numeralNeeds(lower)!;
  // Only a bare count says which case it wants: "od 3 lat", "rozdział 5 książki" and "nie ma
  // 2 osób" are right ("parę" is also a noun's accusative).
  const loose = /^\d/.test(num) || lower === "parę";
  if (loose && (needs === "Np" || tags & cases("Gs")) && !freeCount(ctx.text, m.index)) return null;
  const start = m.index + m[0].length - noun.length;
  const forms = inflect(noun, cases(needs), needs === "Gp" ? NOMINATIVE_FORMS : cases("Gp"));
  const fixes = forms.length === 1 ? forms.map((form) => caseLike(noun, form)) : [];
  return {
    ...findingAt(ctx, start, start + noun.length, fixes, RULE, "review_msg_pl_agreement"),
    context: { start: m.index, end: start + noun.length },
  };
}

function zloty(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const { num, unit, noun } = m.groups!;
  const before = ctx.text.slice(Math.max(0, m.index - 6), m.index);
  if (/[\d,.:/§–—-][ \t ]*$/u.test(before) || userOrNamed(ctx, noun)) return null;
  if (!unit && numeralNeeds(num.toLowerCase()) !== "Gp") return null;
  const start = m.index + m[0].length - noun.length;
  return {
    ...findingAt(
      ctx,
      start,
      start + noun.length,
      [caseLike(noun, "złotych")],
      RULE,
      "review_msg_pl_agreement",
    ),
    context: { start: m.index, end: start + noun.length },
  };
}

/* ------------------------------------------------------- verbs taking the genitive */

/** Forms of verbs whose object stands in the genitive ("używam młotka", "szukam pracy"). */
const GENITIVE_VERBS = new RegExp(
  `(?<![\\p{L}])(?<verb>${[
    "używ(?:am|asz|a|amy|acie|ają|ał\\p{L}*|ali|ać|aj|ajcie|ając)",
    "unik(?:am|asz|a|amy|acie|ają|ał\\p{L}*|ali|ać|aj|ajcie|ając)",
    "szuk(?:am|asz|a|amy|acie|ają|ał\\p{L}*|ali|ać|aj|ajcie|ając)",
    "przestrzeg(?:am|asz|a|amy|acie|ają|ał\\p{L}*|ali|ać|aj|ajcie|ając)",
    "potrzebuj(?:ę|esz|e|emy|ecie|ą)|potrzebował\\p{L}*|potrzebować",
    "pilnuj(?:ę|esz|e|emy|ecie|ą)?|pilnował\\p{L}*|pilnować",
    "wymag(?:am|a|ają|ał\\p{L}*|ali|ać)",
    "nienawidz(?:ę|isz|i|imy|icie|ą)|nienawidził\\p{L}*",
    "żału(?:ję|jesz|je|jemy|jecie|ją)|żałował\\p{L}*|żałować",
    // "ustąp miejsca": the place given up is in the genitive.
    "ustąp(?:|cie|ić|ię|isz|i|imy|icie|ią|ił\\p{L}*|ili)|ustępuj(?:ę|esz|e|emy|ecie|ą|cie)?|ustępował\\p{L}*|ustępować",
  ].join(
    "|",
  )})[ \\t\\u00a0]{1,8}(?:(?<adj>\\p{L}{3,})[ \\t\\u00a0]{1,8})?(?<noun>\\p{L}{3,})${WORD}`,
  "giud",
);
const GENITIVE_CASES = cases("Gs Gp");
const TIME_SPAN =
  /^(?:raz|razy|czas|dzień|dni|rok|lata|tydzień|tygodnie|miesiąc|miesiące|chwilę|godzinę|godziny|minutę|minuty|noc|wieczór|weekend|ranek|popołudnie|sobotę|niedzielę|wiosnę|lato|jesień|zimę)$/u;
const TIME_ADJECTIVE = /^(?:cał|każd|ostatni|następn|zeszł|przyszł|poprzedni)/u;
const ACCUSATIVE = cases("As Ap");

/** "Używam młotek", "przestrzega przepisy": an accusative object where the verb wants the genitive. */
function genitivePronouns(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const pronoun = m.groups!.pronoun;
  const start = m.index + m[0].length - pronoun.length;
  const fixes = pronoun.toLowerCase() === "ją" ? ["jej"] : ["ich", "go"];
  return {
    ...findingAt(
      ctx,
      start,
      start + pronoun.length,
      fixes.map((fix) => caseLike(pronoun, fix)),
      RULE,
      "review_msg_pl_preposition_case",
    ),
    context: { start: m.index, end: start + pronoun.length },
  };
}

function genitiveObjects(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  let { adj, noun } = m.groups!;
  let end = m.index + m[0].length;
  // "przestrzega przepisy polskiego prawa", "ustąpił miejsce staruszce": the object is the
  // first word. After a plural verb a plural noun may be its subject ("używają pasterze
  // trzód"), unless a genitive adjective follows it.
  const plural = /(?:ą|li|ły)$/u.test(m.groups!.verb) && nounTags(adj ?? "") & cases("Np");
  if (adj && !adjectiveOf(adj) && (!plural || /\p{L}(?:ego|ej|ych)$/u.test(noun))) {
    end = m.indices!.groups!.adj[1];
    [noun, adj] = [adj, undefined as unknown as string];
  }
  if (userOrNamed(ctx, noun)) return null;
  // A span of time in the accusative is no object ("szukał cały dzień", "raz po raz").
  if (TIME_SPAN.test(noun) || (adj && TIME_ADJECTIVE.test(adj))) return null;
  const tags = nounTags(noun);
  if (!onlyNoun(tags) || tags & GENITIVE_CASES || !(tags & ACCUSATIVE)) return null;
  // An adjective between must belong to the noun ("stare żelazko").
  if (adj && (!adjectiveOf(adj) || !adjectiveAgrees(adjectiveOf(adj)!.ending, tags))) return null;
  const start = adj ? m.indices!.groups!.adj[0] : end - noun.length;
  const forms = recased(noun, GENITIVE_CASES);
  let fixes = forms.length === 1 ? forms : [];
  if (adj && fixes.length) {
    // "stare żelazko" -> "starego żelazka": the adjective follows the noun into the genitive.
    const ending = tags & SINGULAR ? (tags & FEMININE ? "ej" : "ego") : "ych";
    const typed = ctx.source.slice(start, end);
    fixes = [caseLike(typed, `${adjectiveForm(adjectiveOf(adj)!.lemma, ending)} ${fixes[0]}`)];
  }
  return {
    ...findingAt(ctx, start, end, fixes, RULE, "review_msg_pl_preposition_case"),
    context: { start: m.index, end },
  };
}

/* ---------------------------------------------------------- negated objects */

/**
 * Transitive verbs a negation turns to the genitive ("nie mam czasu"): first- and second-person
 * present forms, third-person ones, the masculine past stem, the virile past stem, imperatives.
 */
const NEGATED_VERBS: ReadonlyArray<[string, string, string, string, string?]> = [
  ["mam masz mamy macie", "ma mają", "miał", "miel"],
  ["widzę widzisz widzimy widzicie", "widzi widzą", "widział", "widziel"],
  ["lubię lubisz lubimy lubicie", "lubi lubią", "lubił", "lubil", "lub lubcie"],
  ["znam znasz znamy znacie", "zna znają", "znał", "znal"],
  ["kocham kochasz kochamy kochacie", "kocha kochają", "kochał", "kochal"],
  ["rozumiem rozumiesz rozumiemy rozumiecie", "rozumie rozumieją", "rozumiał", "rozumiel"],
  ["kupię kupisz kupimy kupicie", "kupi kupią", "kupił", "kupil"],
  ["kupuję kupujesz kupujemy kupujecie", "kupuje kupują", "kupował", "kupowal", "kupuj kupujcie"],
  ["robię robisz robimy robicie", "robi robią", "robił", "robil", "rób róbcie"],
  ["zrobię zrobisz zrobimy zrobicie", "zrobi zrobią", "zrobił", "zrobil"],
  ["czytam czytasz czytamy czytacie", "czyta czytają", "czytał", "czytal", "czytaj czytajcie"],
  [
    "przeczytam przeczytasz przeczytamy przeczytacie",
    "przeczyta przeczytają",
    "przeczytał",
    "przeczytal",
  ],
  ["jem jesz jemy jecie", "jedzą", "jadł", "jedl", "jedz jedzcie"],
  ["zjem zjesz zjemy zjecie", "zje zjedzą", "zjadł", "zjedl"],
  ["piję pijesz pijemy pijecie", "pije piją", "pił", "pil", "pij pijcie"],
  ["wypiję wypijesz wypijemy wypijecie", "wypije wypiją", "wypił", "wypil"],
  ["słyszę słyszysz słyszymy słyszycie", "słyszy słyszą", "słyszał", "słyszel"],
  ["chcę chcesz chcemy chcecie", "chce chcą", "chciał", "chciel"],
  [
    "oglądam oglądasz oglądamy oglądacie",
    "ogląda oglądają",
    "oglądał",
    "oglądal",
    "oglądaj oglądajcie",
  ],
  ["piszę piszesz piszemy piszecie", "pisze piszą", "pisał", "pisal", "pisz piszcie"],
  ["napiszę napiszesz napiszemy napiszecie", "napisze napiszą", "napisał", "napisal"],
  ["czuję czujesz czujemy czujecie", "czuje czują", "czuł", "czul"],
  ["pamiętam pamiętasz pamiętamy pamiętacie", "pamięta pamiętają", "pamiętał", "pamiętal"],
  ["dostanę dostaniesz dostaniemy dostaniecie", "dostanie dostaną", "dostał", "dostal"],
  ["znajdę znajdziesz znajdziemy znajdziecie", "znajdzie znajdą", "znalazł", "znaleźl"],
  ["zauważę zauważysz zauważymy zauważycie", "zauważy zauważą", "zauważył", "zauważyl"],
  ["noszę nosisz nosimy nosicie", "nosi noszą", "nosił", "nosil", "noś noście"],
  ["biorę bierzesz bierzemy bierzecie", "bierze biorą", "brał", "bral", "bierz bierzcie"],
  ["płacę płacisz płacimy płacicie", "płaci płacą", "płacił", "płacil", "płać płaćcie"],
  ["odwiedzę odwiedzisz odwiedzimy odwiedzicie", "odwiedzi odwiedzą", "odwiedził", "odwiedzil"],
  ["otworzę otworzysz otworzymy otworzycie", "otworzy otworzą", "otworzył", "otworzyl"],
];
/** Verb form -> whether its subject is the speaker or the hearer (so a noun after it is no subject). */
const NEGATED_FORMS = new Map<string, boolean>();
for (const [present, third, past, virile, imperative = ""] of NEGATED_VERBS) {
  const personal = [
    ...present.split(" "),
    ...imperative.split(" "),
    ...["em", "eś", "am", "aś", "yśmy", "yście"].map((ending) => past + ending),
    ...["iśmy", "iście"].map((ending) => virile + ending),
  ];
  for (const form of personal) if (form) NEGATED_FORMS.set(form, true);
  for (const form of [...third.split(" "), past, `${past}a`, `${past}o`, `${virile}i`, `${past}y`])
    NEGATED_FORMS.set(form, false);
}
const NEGATED = new RegExp(
  `(?<![\\p{L}\\p{N}_'’-])nie[ \\t\\u00a0]{1,8}(?<verb>\\p{L}{2,})[ \\t\\u00a0]{1,8}(?:(?<adj>\\p{L}{3,})[ \\t\\u00a0]{1,8})?(?<noun>\\p{L}{2,})${WORD}`,
  "giud",
);
const NOMINATIVES = cases("Ns Np");
const OBJECT_PRONOUNS: Record<string, string> = { ją: "jej", je: "ich" };

/** "nie mam czas", "nie lubię ją": an accusative object after a negated verb. */
function negatedObjects(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, NEGATED)) {
    const { verb } = m.groups!;
    // "nie mam czas teraz": a first word that is no adjective is the noun itself.
    const between = m.groups!.adj && adjectiveOf(m.groups!.adj) ? m.groups!.adj : undefined;
    const adj = between;
    const personal = NEGATED_FORMS.get(verb.toLowerCase());
    if (personal === undefined) continue;
    // Overlapping frames: the next scan may start at the noun's own "nie".
    NEGATED.lastIndex = m.index + 3;
    const noun = m.groups!.adj && !adj ? m.groups!.adj : m.groups!.noun;
    const end = m.indices!.groups![noun === m.groups!.noun ? "noun" : "adj"][1];
    const pronoun = adj ? undefined : OBJECT_PRONOUNS[noun.toLowerCase()];
    if (pronoun) {
      findings.push({
        ...findingAt(
          ctx,
          end - noun.length,
          end,
          [caseLike(noun, pronoun)],
          RULE,
          "review_msg_pl_negated_genitive",
        ),
        context: { start: m.index, end },
      });
      continue;
    }
    // A span of time is no object ("nie widział cały rok"); "nie mam czas" is.
    if (
      userOrNamed(ctx, noun) ||
      (noun !== "czas" && TIME_SPAN.test(noun)) ||
      (adj && TIME_ADJECTIVE.test(adj))
    )
      continue;
    const tags = nounTags(noun);
    if (!onlyNoun(tags) || tags & GENITIVE_CASES || !(tags & ACCUSATIVE)) continue;
    // After "ma", "widzi"… a nominative may be the subject ("nie widzi pies"): accusative only.
    if (!personal && tags & NOMINATIVES) continue;
    const forms = recased(noun, GENITIVE_CASES);
    let start = end - noun.length;
    let fixes = forms.length === 1 ? forms : [];
    if (adj) {
      const reading = adjectiveOf(adj)!;
      if (ambiguousAdjective(adj) || !adjectiveAgrees(reading.ending, tags)) continue;
      // The adjective takes the genitive of the noun's own gender and number.
      const genitive = tags & SINGULAR ? cases("Gs") : cases("Gp");
      const endings = fixes.length ? agreeingEndings((tags & ~ALL_CASES) | genitive) : [];
      start = m.indices!.groups!.adj[0];
      fixes =
        endings.length === 1
          ? [`${caseLike(adj, adjectiveForm(reading.lemma, endings[0]))} ${fixes[0]}`]
          : [];
    }
    findings.push({
      ...findingAt(ctx, start, end, fixes, RULE, "review_msg_pl_negated_genitive"),
      context: { start: m.index, end },
    });
  }
  return findings;
}

/* ------------------------------------------- an adjective before a genitive object */

/** The NEGATED_VERBS rows whose object may also stand in the partitive genitive ("kupię chleba"). */
const PARTITIVE = new Set("kupię kupuję jem zjem piję wypiję biorę dostanę chcę".split(" "));
const PARTITIVE_FORMS = new Set(
  NEGATED_VERBS.filter(([present]) => PARTITIVE.has(present.split(" ")[0])).flatMap(
    ([present, third, past, virile, imperative = ""]) =>
      [...NEGATED_FORMS.keys()].filter(
        (form) =>
          [present, third, imperative].some((list) => list.split(" ").includes(form)) ||
          form.startsWith(past) ||
          form.startsWith(virile),
      ),
  ),
);
/** One form of a GENITIVE_VERBS verb ("szukam", "używali"). */
const GENITIVE_VERB_FORM = new RegExp(
  `^${GENITIVE_VERBS.source.slice(
    GENITIVE_VERBS.source.indexOf("(?<verb>"),
    GENITIVE_VERBS.source.indexOf(")[ \\t\\u00a0]{1,8}") + 1,
  )}$`,
  "iu",
);
/** Adjectives that govern the genitive themselves ("pełne wody", "pozbawiony wad", "warte uwagi"). */
const GENITIVE_ADJECTIVES = new Set(
  "pełny pozbawiony warty godny niegodny świadomy nieświadomy pewny ciekawy żądny spragniony głodny syty winny bliski chciwy".split(
    " ",
  ),
);
const VERB_OBJECT = new RegExp(
  `(?<![\\p{L}\\p{N}_'’-])(?:(?<nie>[Nn]ie)[ \\t\\u00a0]{1,8})?(?<verb>\\p{L}{2,})[ \\t\\u00a0]{1,8}(?<adj>\\p{Ll}{3,})[ \\t\\u00a0]{1,8}(?<noun>\\p{Ll}{3,})${WORD}`,
  "gud",
);

/**
 * "Widzę czyste talerzy", "szukam czyste talerzy": an adjective that does not agree with a
 * genitive-only noun right after a verb. The verb says which word is wrong: an accusative verb
 * wants the noun changed ("czyste talerze"), a genitive or negated verb the adjective
 * ("czystych talerzy"), a partitive one ("kupiłem") either.
 */
function genitiveObjectAdjectives(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of owned(ctx, VERB_OBJECT)) {
    const { nie, verb, adj, noun } = m.groups!;
    const groups = m.indices!.groups!;
    // Overlapping frames: the next scan starts at the word after the verb.
    VERB_OBJECT.lastIndex = groups.verb[1];
    const lower = verb.toLowerCase();
    // "lub" is also "or".
    const accusative = NEGATED_FORMS.has(lower) && lower !== "lub";
    const genitive = GENITIVE_VERB_FORM.test(lower) || (accusative && !!nie);
    if (!accusative && !genitive) continue;
    const reading = adjectiveOf(adj);
    if (!reading || PRONOUNS.has(reading.lemma) || GENITIVE_ADJECTIVES.has(reading.lemma)) continue;
    if (reading.lemma === "luty" || ambiguousAdjective(adj) || nounTags(adj) & ALL_CASES) continue;
    const tags = nounTags(noun);
    // A genitive-only noun; a masculine genitive plural also reads as a man's accusative
    // ("studentów"), which takes the genitive's ending all the same.
    if (!onlyNoun(tags) || !(tags & GENITIVE_CASES) || tags & ALL_CASES & ~cases("Gs Gp Ap"))
      continue;
    const own = tags & ~cases("Ap");
    if (adjectiveAgrees(reading.ending, own) || userOrNamed(ctx, `${adj} ${noun}`)) continue;
    const endings = agreeingEndings(own);
    const adjectiveFix =
      endings.length === 1 ? [`${adjectiveForm(reading.lemma, endings[0])} ${noun}`] : [];
    // The noun in the accusative the adjective already has ("czyste talerze").
    const nounForms = inflect(noun, ACCUSATIVE, GENITIVE_CASES).filter((form) => {
      const formTags = nounTags(form);
      return adjectiveAgrees(reading.ending, (formTags & ~ALL_CASES) | (formTags & ACCUSATIVE));
    });
    const nounFix = nounForms.length === 1 ? [`${adj} ${nounForms[0]}`] : [];
    let fixes: string[];
    if (genitive) fixes = adjectiveFix;
    else if (PARTITIVE_FORMS.has(lower)) fixes = [...nounFix, ...adjectiveFix];
    // A man's accusative is the genitive form itself ("widzę polskich żołnierzy").
    else fixes = nounFix.length || nounForms.length || !(tags & VIRILE) ? nounFix : adjectiveFix;
    const [start, end] = [groups.adj[0], groups.noun[1]];
    findings.push({
      ...findingAt(ctx, start, end, fixes, RULE, "review_msg_pl_agreement"),
      context: { start: m.index, end },
    });
  }
  return findings;
}

/* ------------------------------------------------------------ fixed genders */

/** Masculine singular determiners and what they become in the neuter, the plural and the feminine. */
const MASCULINE_DETERMINERS: Record<string, [neuter: string, plural: string, feminine: string]> = {
  ten: ["to", "te", "ta"],
  tamten: ["tamto", "tamte", "tamta"],
  taki: ["takie", "takie", "taka"],
  jeden: ["jedno", "jedne", "jedna"],
  mój: ["moje", "moje", "moja"],
  twój: ["twoje", "twoje", "twoja"],
  swój: ["swoje", "swoje", "swoja"],
  nasz: ["nasze", "nasze", "nasza"],
  wasz: ["wasze", "wasze", "wasza"],
  każdy: ["każde", "każde", "każda"],
  jakiś: ["jakieś", "jakieś", "jakaś"],
  żaden: ["żadne", "żadne", "żadna"],
};
/**
 * Nouns typed with a masculine modifier though they are neuter (indeclinable loans: "to menu"),
 * plural only ("te perfumy"; "perfum" is their genitive) or feminine ("ta pomarańcza").
 */
const GENDERED: Record<string, [index: 0 | 1 | 2, noun: string]> = {
  ...Object.fromEntries(
    "menu tiramisu sushi salami kakao musli euro hobby zoo graffiti alibi kimono risotto espresso bistro"
      .split(" ")
      .map((noun): [string, [0, string]] => [noun, [0, noun]]),
  ),
  perfum: [1, "perfumy"],
  pomarańcz: [2, "pomarańcza"],
};
const ADJECTIVE_ENDINGS = ["e", "e", "a"] as const;

/** A masculine determiner or adjective (nominative singular) as `index` wants it, or null. */
function regendered(word: string, index: 0 | 1 | 2): string | null {
  const lower = word.toLowerCase();
  const det = MASCULINE_DETERMINERS[lower]?.[index];
  if (det) return caseLike(word, det);
  const adj = adjectiveOf(lower);
  if (!adj || adj.ending !== "y" || ambiguousAdjective(lower) || nounTags(lower) & ALL_CASES)
    return null;
  return caseLike(word, adjectiveForm(adj.lemma, ADJECTIVE_ENDINGS[index]));
}

/** "ten menu" -> "to menu", "nowy perfum" -> "nowe perfumy", "smaczny pomarańcz" -> "smaczna pomarańcza". */
function fixedGenders(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const { first, mod, noun } = m.groups!;
  const [index, fixedNoun] = GENDERED[noun.toLowerCase()];
  const fixedMod = regendered(mod, index);
  if (!fixedMod || userOrNamed(ctx, `${mod} ${noun}`)) return null;
  const fixedFirst = first ? regendered(first, index) : null;
  const groups = m.indices!.groups!;
  const start = fixedFirst ? groups.first[0] : groups.mod[0];
  const end = groups.noun[1];
  const typed = ctx.source.slice(start, end);
  const fixed =
    (fixedFirst ? `${fixedFirst}${ctx.source.slice(groups.first[1], groups.mod[0])}` : "") +
    `${fixedMod}${ctx.source.slice(groups.mod[1], groups.noun[0])}${caseLike(noun, fixedNoun)}`;
  if (fixed === typed) return null;
  return findingAt(ctx, start, end, [fixed], RULE, "review_msg_pl_agreement");
}

/* --------------------------------------------------------------- adjectives */

/** Cases an adjective can govern ("pełna wody", "zajęta pracą"): such a noun may not be its own. */
const OBLIQUE = cases("Gs Ds Is Ls Gp Dp Ip Lp");
const NO_LOCATIVE = cases("Gs Ds Is Gp Dp Ip");
/** Pronouns that inflect like adjectives but stand alone ("o którym mowa", "temu klient"). */
const PRONOUNS = new Set(
  "ty który jaki taki ten tamten ów czyj każdy żaden wszystek sam jakiś mój twój swój nasz wasz niektóry inny".split(
    " ",
  ),
);
/**
 * Adjectives often used as nouns, with a genitive of their own after them ("dla podopiecznych
 * trenera", "do znajomych męża", "dla pochodnej funkcji"): such a pair is no clash.
 */
const NOMINAL_ADJECTIVES = new Set(
  (
    "podopieczny znajomy bliski najbliższy krewny dorosły pełnoletni niepełnoletni nieletni " +
    "małoletni chory bezrobotny niepełnosprawny poszkodowany pokrzywdzony ranny zmarły " +
    "oskarżony podejrzany zatrzymany skazany przełożony podwładny narzeczony uczony wierny " +
    "zainteresowany uprawniony ubezpieczony dyżurny śledczy mundurowy podróżny pieszy święty " +
    "bliźni dany średni pochodny styczny wypadkowy"
  ).split(" "),
);
/** Passive participles by their masculine form ("ogarnięty", "pokryty", "zmęczony", "pisany"). */
const PARTICIPLE = /(?:[aeo]n|[ęyiu]t|art)y$/u;
const INSTRUMENTALS = cases("Is Ip");
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

interface AdjectiveContext {
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
function adjectiveClash(
  adjective: string,
  noun: string,
  { governed, after }: AdjectiveContext = {},
): string[] | null {
  const adj = adjectiveOf(adjective);
  if (!adj || PRONOUNS.has(adj.lemma)) return null;
  // "15 lutego uczniowie": "lutego", "lutym" name February far more often than "luty" (fierce).
  if (adj.lemma === "luty") return null;
  if (nounTags(adjective) & ALL_CASES) return null;
  let tags = nounTags(noun);
  if (!onlyNoun(tags)) return null;
  if (NOMINAL_ADJECTIVES.has(adj.lemma) && tags & cases("Gs Gp")) return null;
  // A participle governs the instrumental of its agent ("z ogarniętej wojną Ukrainy").
  if (PARTICIPLE.test(adj.lemma) && !(tags & ALL_CASES & ~INSTRUMENTALS)) return null;
  // Men take their own plural ("nowi synowie"); a soft stem's is its masculine form ("ostatni").
  const men = menOnlyPlural(noun);
  if (men && adjective === virileAdjective(adj.lemma)) return null;
  // "-e" is no men's plural ("nastoletnie synowie"), unless the noun has another reading for it.
  const notMen =
    men &&
    !after &&
    governed === undefined &&
    adj.ending === "e" &&
    !adjectiveAgrees("e", tags & ~cases("Np Vp"));
  // A form another word also spells is checked only as "-e" before men ("nowe studenci").
  if (!notMen && ambiguousAdjective(adjective)) return null;
  if (governed !== undefined) {
    // After a preposition both words stand in a case it governs: compare those readings only,
    // unless the pair agrees in another case ("na różnego rodzaju sprzęt").
    if (adjectiveAgrees(adj.ending, tags)) return null;
    if (!(tags & governed)) return null;
    tags = (tags & ~ALL_CASES) | (tags & governed);
  } else if (PREDICATIVE.has(adj.ending)) {
    // A plural instrumental before a noun that has no plural reading ("prawdziwymi lekarzem")
    // predicates nothing.
    if (adj.ending !== "ymi" || !(tags & cases("Is")) || tags & PLURAL) return null;
    // With no preposition a locative cannot be ("różne ludzie" is no "o ludzie").
  } else if (after ? !AFTER_ENDINGS.has(adj.ending) : tags & (notMen ? NO_LOCATIVE : OBLIQUE))
    return null;
  if (!notMen && adjectiveAgrees(adj.ending, tags)) return null;
  const pair = (a: string, n: string) => (after ? `${n} ${a}` : `${a} ${n}`);
  const fixes = new Set<string>();
  // Of the endings that agree, those closest to the typed one ("szybkie samochód" -> "szybki").
  const overlap = (ending: string) => bitCount(readingCases(ending) & readingCases(adj.ending));
  const endings = agreeingEndings(tags);
  const best = Math.max(...endings.map(overlap));
  const closest = endings.filter((ending) => overlap(ending) === best);
  const form =
    men && closest[0] === "e" ? virileAdjective(adj.lemma) : adjectiveForm(adj.lemma, closest[0]);
  if (closest.length === 1 && form) fixes.add(pair(form, noun));
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

const COPULA = /^(?:jest|jestem|jesteś|była|byłam|byłaś|będzie|będę|będziesz|to)$/u;
/** "krok po kroku", "dzień po dniu", "słowo po słowie": the noun opens a repeated phrase. */
function repeatedAfter(text: string, end: number, noun: string): boolean {
  const next = /^[ \t\u00a0]+po[ \t\u00a0]+(\p{L}+)/u.exec(text.slice(end))?.[1];
  if (!next) return false;
  const [word, other] = [noun.toLowerCase(), next.toLowerCase()];
  return word.slice(0, 3) === other.slice(0, 3) || inflect(word, ALL_CASES).includes(other);
}

/** A copula or "się" (a predicate may follow), after which a degree word may stand. */
const PREDICATE_BEFORE =
  /(?:^|[^\p{L}])(?:jest|są|był[aoy]?|byli|będzie|będą|zosta(?:ł[aoy]?|li)|się)(?:[ \t\u00a0]+(?:bardzo|zbyt|za|dość|dosyć|całkiem|naprawdę|niezwykle|wyjątkowo|tak|coraz|nadal|wciąż|już|raczej))?[ \t\u00a0]+$/iu;

/**
 * "Zadania były trudne uczniowie narzekali": the adjective ends the clause of a copula and the
 * noun opens the next, whose verb follows it. A comma is missing, not an agreement.
 */
function runOn(text: string, start: number, end: number): boolean {
  if (!PREDICATE_BEFORE.test(text.slice(Math.max(0, start - 40), start))) return false;
  const next = /^[ \t\u00a0]+(\p{L}+)/u.exec(text.slice(end))?.[1]?.toLowerCase();
  return !!next && (finiteVerb(next) || pastByShape(next));
}

/**
 * "męska grą" -> "męska gra" or "męską grą": both nominative or both instrumental. Only a
 * relational adjective in "-ski", "-cki", "-dzki" ("męski", "polski"; not "niski", "płaski"):
 * a qualitative one may take an instrumental of respect ("łagodna naturą", "wyjątkowa urodą"),
 * a participle an agent ("zajęta pracą").
 */
function copulaClash(adjective: string, noun: string): string[] | null {
  const adj = adjectiveOf(adjective);
  if (adj?.ending !== "a" || ambiguousAdjective(adjective)) return null;
  if (!/(?:[^ia]sk|ck|dzk)i$/u.test(adj.lemma) || nounTags(adjective) & ALL_CASES) return null;
  const tags = nounTags(noun);
  const twin = `${noun.slice(0, -1)}a`;
  const twinTags = nounTags(twin);
  if (!noun.endsWith("ą") || !onlyNoun(tags) || tags & ~cases("Is") & ALL_CASES) return null;
  if (!onlyNoun(twinTags, true) || !(twinTags & cases("Ns") && twinTags & FEMININE)) return null;
  return [`${adjective} ${twin}`, `${adjectiveForm(adj.lemma, "ą")} ${noun}`];
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
    // Each check below needs an adjective in the pair: most pairs stop at this cheap gate.
    if (!adjectiveOf(first.toLowerCase()) && !adjectiveOf(second)) continue;
    const end = m.index + m[0].length;
    if (userOrNamed(ctx, first) || userOrNamed(ctx, second)) continue;
    // Nouns of a fixed gender are checked with their modifiers above.
    if (GENDERED[second.toLowerCase()]) continue;
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
      (governed !== undefined || !previous || !closesPhraseBefore(previous, first.toLowerCase())) &&
      !runOn(ctx.text, m.index, end) &&
      !repeatedAfter(ctx.text, end, second)
    ) {
      report(m.index, end, first, adjectiveFirst);
      continue;
    }
    // "jest męska grą": after a copula, a feminine adjective in the nominative before an
    // instrumental noun; one of the two lost or gained its "ą". Participles govern the
    // instrumental themselves ("była zajęta pracą", "zmęczona drogą") and are left alone.
    if (lower && COPULA.test(previous ?? "")) {
      const fixes = copulaClash(first, second);
      if (fixes) {
        report(m.index, end, first, fixes);
        continue;
      }
    }
    // "komisje śledczą.": an adjective closing the phrase after its noun.
    if (lower && /^[ \t\u00a0]*(?:[.,;:!?)…]|$)/u.test(ctx.text.slice(end, end + 3))) {
      const fixes = adjectiveClash(second, first, { after: true });
      if (fixes) report(m.index, end, first, fixes);
    }
  }
  return findings;
}

/* --------------------------------------------------------------- "uznany za" */

const INSTRUMENTAL = cases("Is Ip");

/** "uznany wielkim aktorem" -> "uznany za wielkiego aktora". */
function consideredAs(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const { phrase, adj, noun } = m.groups!;
  if (userOrNamed(ctx, phrase)) return null;
  const tags = nounTags(noun);
  if (!onlyNoun(tags) || !(tags & INSTRUMENTAL) || tags & ~INSTRUMENTAL & ALL_CASES) return null;
  const adjective = adj ? adjectiveOf(adj) : null;
  if (adj && (!adjective || !/^(?:ym|ą|ymi)$/u.test(adjective.ending))) return null;
  const plural = (tags & cases("Ip")) !== 0;
  const fixes = inflect(noun, cases(plural ? "Ap" : "As")).flatMap((form) => {
    if (!adjective) return [`za ${form}`];
    const formTags = nounTags(form);
    // The gender is the typed noun's ("lwem", not "lewa" the adjective); the accusative of a
    // man or an animal is the genitive form ("za wielkiego aktora").
    const ending = plural
      ? formTags & cases("Gp")
        ? "ych"
        : "e"
      : tags & FEMININE
        ? "ą"
        : tags & NEUTER
          ? "e"
          : formTags & cases("Gs")
            ? "ego"
            : "y";
    return [`za ${adjectiveForm(adjective.lemma, ending)} ${form}`];
  });
  if (fixes.length === 0 || fixes.length > 2) return null;
  const start = m.index + m[0].length - phrase.length;
  return {
    ...findingAt(ctx, start, start + phrase.length, fixes, RULE, "review_msg_pl_preposition_case"),
    context: { start: m.index, end: start + phrase.length },
  };
}

function consideredAsJako(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  return findingAt(
    ctx,
    m.index,
    m.index + m[0].length,
    [caseLike(m[0], "za")],
    RULE,
    "review_msg_pl_preposition_case",
  );
}

/* ------------------------------------------------------- fixed small frames */

const PRONOUN_GENITIVE: Record<string, string> = {
  niemu: "niego",
  nim: "niego",
  nią: "niej",
  nimi: "nich",
};

/** A fixed small frame: `fix` gives the fix of the whole match, set in its case. */
const smallFrame =
  (fix: (m: RegExpExecArray) => string | null): MatchFixer =>
  (m, ctx) => {
    const fixed = fix(m);
    if (!fixed || userOrNamed(ctx, m[0])) return null;
    return findingAt(
      ctx,
      m.index,
      m.index + m[0].length,
      [caseLike(m[0], fixed)],
      RULE,
      "review_msg_pl_preposition_case",
    );
  };

const SMALL_FRAMES = {
  genitiveOnlyPronoun: smallFrame((m) => PRONOUN_GENITIVE[m[0].toLowerCase()]),
  possessiveLocative: smallFrame((m) => {
    const tags = nounTags(m.groups!.noun);
    if (!onlyNoun(tags) || !(tags & cases("Ls Lp"))) return null;
    if (tags & cases("Lp")) return `${m[0]}ch`;
    return tags & FEMININE ? `${m[0].slice(0, -1)}jej` : `${m[0]}m`;
  }),
  poLanguage: smallFrame((m) => `${m[0].slice(0, -4)}u`),
  temuAccusative: smallFrame((m) => `${m[0].slice(0, -1)}ę`),
};

/* ------------------------------------- the subject after an instrumental */

function subjectsAfterPredicate(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const { noun } = m.groups!;
  const tags = nounTags(noun);
  // A genitive plural with no nominative reading ("uczniów", "organizacji").
  if (!onlyNoun(tags) || !(tags & cases("Gp")) || tags & cases("Ns Np")) return null;
  if (userOrNamed(ctx, noun)) return null;
  // The clause opens with an instrumental noun, the predicate: "Klientami są", "Dla firmy
  // autorami będą".
  const clause =
    (
      ctx.text
        .slice(Math.max(0, m.index - 60), m.index)
        .split(/[.!?;:,—–()]/u)
        .at(-1) ?? ""
    ).match(/\p{L}+/gu) ?? [];
  const predicate = clause.slice(-3).some((word) => {
    const own = nounTags(word.toLowerCase());
    return onlyNoun(own) && !(own & ALL_CASES & ~INSTRUMENTALS);
  });
  if (!predicate) return null;
  let forms = inflect(noun, cases("Np"), cases("Gp"));
  // "uczniów": the men's plural "uczniowie", not the plural of things "ucznie".
  const men = forms.filter(menOnlyPlural);
  if (forms.length > 1 && men.length) forms = men;
  if (forms.length === 0 || forms.length > 2) return null;
  const [start, end] = m.indices!.groups!.noun;
  return findingAt(
    ctx,
    start,
    end,
    forms.map((form) => caseLike(noun, form)),
    RULE,
    "review_msg_pl_agreement",
  );
}

/* ---------------------------------------- "tymi człowiekiem", "moimi siostrą" */

/** Plural instrumental pronouns and their singular forms: masculine or neuter, feminine. */
const PLURAL_PRONOUNS: Record<string, [string, string]> = {
  tymi: ["tym", "tą"],
  tamtymi: ["tamtym", "tamtą"],
  takimi: ["takim", "taką"],
  jakimi: ["jakim", "jaką"],
  jakimiś: ["jakimś", "jakąś"],
  moimi: ["moim", "moją"],
  twoimi: ["twoim", "twoją"],
  swoimi: ["swoim", "swoją"],
  naszymi: ["naszym", "naszą"],
  waszymi: ["waszym", "waszą"],
  owymi: ["owym", "ową"],
  żadnymi: ["żadnym", "żadną"],
};

function pluralPronouns(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const { pronoun, noun } = m.groups!;
  // The noun is only a singular instrumental, of one gender.
  const tags = nounTags(noun);
  if (!onlyNoun(tags) || tags & ALL_CASES & ~cases("Is") || userOrNamed(ctx, noun)) return null;
  const feminine = (tags & FEMININE) !== 0;
  if (feminine === ((tags & (MASCULINE | NEUTER)) !== 0)) return null;
  const fix = PLURAL_PRONOUNS[pronoun.toLowerCase()][feminine ? 1 : 0];
  return {
    ...findingAt(
      ctx,
      m.index,
      m.index + pronoun.length,
      [caseLike(pronoun, fix)],
      RULE,
      "review_msg_pl_agreement",
    ),
    context: { start: m.index, end: m.index + m[0].length },
  };
}

/* ------------------------------------------- "półtora", "dwadzieścia trzej" */

const TENS: Record<string, string> = {
  dwadzieścia: "dwudziestu",
  trzydzieści: "trzydziestu",
  czterdzieści: "czterdziestu",
  pięćdziesiąt: "pięćdziesięciu",
  sześćdziesiąt: "sześćdziesięciu",
  siedemdziesiąt: "siedemdziesięciu",
  osiemdziesiąt: "osiemdziesięciu",
  dziewięćdziesiąt: "dziewięćdziesięciu",
};
const MEN_UNITS: Record<string, string> = { dwaj: "dwóch", trzej: "trzech", czterej: "czterech" };

/**
 * "półtorej roku" -> "półtora roku", "półtora godziny" -> "półtorej godziny": the noun's gender
 * picks the form. "trzydzieści trzej mężczyźni" -> "trzydziestu trzech mężczyzn".
 */
function halfForms(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const { num, noun } = m.groups!;
  const tags = nounTags(noun);
  if (!onlyNoun(tags) || !(tags & cases("Gs")) || userOrNamed(ctx, noun)) return null;
  const gender = tags & (MASCULINE | FEMININE | NEUTER);
  const wanted = gender === FEMININE ? "półtorej" : gender & FEMININE || !gender ? "" : "półtora";
  if (!wanted || wanted === num.toLowerCase()) return null;
  return {
    ...findingAt(
      ctx,
      m.index,
      m.index + num.length,
      [caseLike(num, wanted)],
      RULE,
      "review_msg_pl_numeral_noun",
    ),
    context: { start: m.index, end: m.index + m[0].length },
  };
}

function tensMen(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const { noun } = m.groups!;
  const tags = nounTags(noun);
  if (!onlyNoun(tags) || !(tags & VIRILE) || userOrNamed(ctx, noun)) return null;
  const forms = inflect(noun, cases("Gp"), cases("Np"));
  const [tens, unit] = m[0].toLowerCase().split(/[ \t ]+/u);
  const end = m.index + m[0].length;
  const fixes =
    forms.length === 1 ? [caseLike(m[0], `${TENS[tens]} ${MEN_UNITS[unit]} ${forms[0]}`)] : [];
  return findingAt(ctx, m.index, end, fixes, RULE, "review_msg_pl_numeral_noun");
}

/* ------------------------------------------------- "Bruno Schulza" -> "Brunona" */

/** Foreign first names in -o and their genitive, dative and instrumental stems. */
const O_NAMES: Record<string, [genitive: string, dative: string, instrumental: string]> = {
  Bruno: ["Brunona", "Brunonowi", "Brunonem"],
  Hugo: ["Hugona", "Hugonowi", "Hugonem"],
  Otto: ["Ottona", "Ottonowi", "Ottonem"],
  Pablo: ["Pabla", "Pablowi", "Pablem"],
  Mario: ["Maria", "Mariowi", "Mariem"],
  Paulo: ["Paula", "Paulowi", "Paulem"],
  Leonardo: ["Leonarda", "Leonardowi", "Leonardem"],
  Ricardo: ["Ricarda", "Ricardowi", "Ricardem"],
  Fernando: ["Fernanda", "Fernandowi", "Fernandem"],
  Antonio: ["Antonia", "Antoniowi", "Antoniem"],
  Alfonso: ["Alfonsa", "Alfonsowi", "Alfonsem"],
  Romano: ["Romana", "Romanowi", "Romanem"],
  Guido: ["Guida", "Guidowi", "Guidem"],
  Sergio: ["Sergia", "Sergiowi", "Sergiem"],
  Claudio: ["Claudia", "Claudiowi", "Claudiem"],
};

/**
 * "prozę Bruno Schulza", "pomnik Hugo Kołłątajowi": a Polish surname in an oblique case takes
 * the first name along. "-owi" and "-em" say the case; "-a", "-y" and "-i" (also nominative
 * endings: "Pablo Neruda") only after a noun or a genitive preposition.
 */
function uninflectedNames(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const { name, ending } = m.groups!;
  const forms = O_NAMES[name];
  let form: string;
  if (ending === "owi") form = forms[1];
  else if (ending === "em") form = forms[2];
  else {
    const before = wordBefore(ctx.text, m.index);
    if (!before || !(onlyNoun(nounTags(before)) || GOVERNED[before] === cases("Gs Gp")))
      return null;
    form = forms[0];
  }
  return {
    ...findingAt(ctx, m.index, m.index + name.length, [form], RULE, "review_msg_pl_agreement"),
    context: { start: m.index, end: m.index + m[0].length },
  };
}

/* ------------------------------------------------------------ "który" agreement */

type Reading = [genders: number, plural: boolean];
const GENDERS = MASCULINE | FEMININE | NEUTER;
/** What each form of "który" can refer to: its gender (any for the plural) and number. */
const RELATIVE_READINGS: Record<string, Reading[]> = {
  który: [[MASCULINE, false]],
  która: [[FEMININE, false]],
  które: [
    [NEUTER, false],
    [GENDERS, true],
  ],
  którego: [[MASCULINE | NEUTER, false]],
  której: [[FEMININE, false]],
  któremu: [[MASCULINE | NEUTER, false]],
  którą: [[FEMININE, false]],
  którym: [
    [MASCULINE | NEUTER, false],
    [GENDERS, true],
  ],
  których: [[GENDERS, true]],
  którymi: [[GENDERS, true]],
  // Men or mixed groups only: "kobiety, którzy" is "które".
  którzy: [[MASCULINE, true]],
};
/** The form of "który" in the same case for a masculine, feminine or neuter singular noun, or a plural. */
const RELATIVE_FORMS: Record<string, Partial<Record<"m" | "f" | "n" | "p", string>>> = {
  który: { f: "która", n: "które", p: "które" },
  która: { m: "który", n: "które", p: "które" },
  której: { m: "którego", n: "którego", p: "których" },
  któremu: { f: "której", p: "którym" },
  którymi: { m: "którym", f: "którą", n: "którym" },
  którzy: { f: "które", n: "które" },
};
/** Words that may stand in the antecedent's clause without being another antecedent. */
const NEUTRAL = new Set(
  `${Object.keys(GOVERNS).join(" ")} jego jej ich mój moja moje mojego mojej twój twoja twoje swój swoja swoje swojego swojej nasz nasza nasze wasz wasza wasze bardzo już jeszcze też także tylko nawet wczoraj dziś dzisiaj jutro tam tu tutaj się nie`.split(
    " ",
  ),
);

const agrees = (tags: number, [genders, plural]: Reading) =>
  (tags & (plural ? PLURAL : SINGULAR)) !== 0 && (!(tags & GENDERS) || (tags & genders) !== 0);

/**
 * "człowiek, która dba", "samochód, którymi przyjechał": "który" agrees in gender and number with
 * its noun. Any noun back to the clause start may be the antecedent ("córka sąsiada, która",
 * "książkę z obrazkami, która"), so all must clash; a word the lexicon does not know keeps the
 * check quiet ("jedna z osób, która").
 */
function relatives(m: RegExpExecArray, ctx: DetectContext): MatchResult {
  const { noun, rel } = m.groups!;
  const readings = RELATIVE_READINGS[rel];
  const end = m.index + m[0].length;
  // "którzy z nas", "której z nich": a choice among, not a relative clause.
  if (/^[ \t\u00a0]+ze?[ \t\u00a0]/u.test(ctx.text.slice(end, end + 5))) return null;
  const last = nounTags(noun);
  if (!onlyNoun(last) || noun === "państwo" || userOrNamed(ctx, noun)) return null;
  const clause = ctx.text
    .slice(Math.max(0, m.index - 120), m.index + noun.length)
    .split(/[,.;:!?()\n„”"—–]/u)
    .at(-1)!;
  const words = clause.match(/\p{L}+/gu) ?? [];
  // Back from the noun to the clause's verb or start: a noun before the verb is its subject.
  let quiet = true;
  for (let i = words.length - 1; i >= Math.max(0, words.length - 8); i--) {
    const lower = words[i].toLowerCase();
    if (finiteVerb(lower)) {
      quiet = false;
      break;
    }
    if (i === 0) quiet = false;
    if (NEUTRAL.has(lower)) continue;
    const adjective = adjectiveOf(lower);
    // A pronoun may head the phrase itself ("Ta z dziewczyn, która").
    if (adjective && PRONOUNS.has(adjective.lemma)) {
      quiet = true;
      break;
    }
    if (adjective) continue;
    const tags = nounTags(lower);
    // An unknown word, a name, a pronoun ("Ten z nich, który") or "X i Y, którzy" may be the
    // antecedent; so may any noun that agrees.
    if (
      !tags ||
      (i > 0 && /^\p{Lu}/u.test(words[i])) ||
      readings.some((reading) => agrees(tags, reading))
    ) {
      quiet = true;
      break;
    }
  }
  if (quiet) return null;
  const genders = [MASCULINE, FEMININE, NEUTER].filter((gender) => last & gender);
  const key = !(last & SINGULAR)
    ? "p"
    : genders.length !== 1
      ? undefined
      : genders[0] === MASCULINE
        ? "m"
        : genders[0] === FEMININE
          ? "f"
          : "n";
  const fix = key ? RELATIVE_FORMS[rel]?.[key] : undefined;
  const start = m.indices!.groups!.rel[0];
  return {
    ...findingAt(
      ctx,
      start,
      start + rel.length,
      fix ? [caseLike(rel, fix)] : [],
      RULE,
      "review_msg_pl_agreement",
    ),
    context: { start: m.index, end: start + rel.length },
  };
}

export const PREDICATES = {
  caseAgreementOverlaps: (ctx: DetectContext) =>
    isPl(ctx) ? [...negatedObjects(ctx), ...genitiveObjectAdjectives(ctx), ...adjectives(ctx)] : [],
} satisfies Record<string, Detector>;

/** The named frame fixes of the case agreement rules of grammar/rules/pl.yaml (`fixer:`). */
export const FIXERS = {
  prepositionCase,
  demonstratives,
  numeralNouns,
  zloty,
  genitiveNumerals,
  genitivePronouns,
  genitiveObjects,
  fixedGenders,
  consideredAs,
  consideredAsJako,
  relatives,
  uninflectedNames,
  ...SMALL_FRAMES,
  halfForms,
  tensMen,
  subjectsAfterPredicate,
  pluralPronouns,
} satisfies Record<string, MatchFixer>;
