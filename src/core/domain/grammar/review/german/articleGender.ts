import { frameMatches, SPACE, WORD_END, WORD_START } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  germanAdjective,
  germanGender,
  germanNounReading,
  germanInfinitive,
  germanVerbObjectCase,
  type GermanGenderReading,
} from "./germanLexicon";
import { PREPOSITIONS } from "./nounCasing";
import { BOUNDARY, isGerman, tokensAfter, tokensBefore, wordSet } from "./shared";

// An article or ein-word no gender of its noun takes: "der Auto" (das), "mit dem Frau" (der),
// "eine schönes Haus" (ein). Noun genders come from the bundled n-gram counts and compound
// heads (germanGender); the article keeps its case, narrowed by the preposition before it, and
// adjectives between take the new article's ending.

type Gender = "m" | "f" | "n" | "pl";
type Case = "nom" | "acc" | "dat" | "gen";
type Kind = "d" | "dies" | "ein";

const CASE_ORDER: readonly Case[] = ["nom", "acc", "dat", "gen"];
// Endings by gender and case, in CASE_ORDER: the definite article spelled out, dies- and ein-
// words as endings ("" for the bare "ein").
const FORMS: Readonly<Record<Kind, Readonly<Record<Gender, readonly string[]>>>> = {
  d: {
    m: ["der", "den", "dem", "des"],
    f: ["die", "die", "der", "der"],
    n: ["das", "das", "dem", "des"],
    pl: ["die", "die", "den", "der"],
  },
  dies: {
    m: ["er", "en", "em", "es"],
    f: ["e", "e", "er", "er"],
    n: ["es", "es", "em", "es"],
    pl: ["e", "e", "en", "er"],
  },
  ein: {
    m: ["", "en", "em", "es"],
    f: ["e", "e", "er", "er"],
    n: ["", "", "em", "es"],
    pl: ["e", "e", "en", "er"],
  },
};
// The adjective ending after a definite or dies-word (weak) and after an ein-word (mixed).
const ADJECTIVE_ENDINGS: Readonly<Record<"weak" | "mixed", Readonly<Record<Gender, string[]>>>> = {
  weak: {
    m: ["e", "en", "en", "en"],
    f: ["e", "e", "en", "en"],
    n: ["e", "e", "en", "en"],
    pl: ["en", "en", "en", "en"],
  },
  mixed: {
    m: ["er", "en", "en", "en"],
    f: ["e", "e", "en", "en"],
    n: ["es", "es", "en", "en"],
    pl: ["en", "en", "en", "en"],
  },
};
// Contractions of a preposition and "dem", "der" or "das": [preposition, article].
const CONTRACTIONS: Readonly<Record<string, [string, string]>> = {
  zum: ["zu", "dem"],
  zur: ["zu", "der"],
  im: ["in", "dem"],
  am: ["an", "dem"],
  vom: ["von", "dem"],
  beim: ["bei", "dem"],
  ins: ["in", "das"],
};
// Prepositions and the cases they govern; two-way ones take the dative or the accusative.
const GOVERNED = new Map<string, Case[]>([
  ...wordSetEntries("mit von bei aus nach zu seit samt nebst außer gemäß", ["dat"]),
  ...wordSetEntries("für gegen durch ohne um wider", ["acc"]),
  ...wordSetEntries(
    "wegen trotz während statt anstatt aufgrund innerhalb außerhalb oberhalb unterhalb mittels",
    ["gen"],
  ),
  ...wordSetEntries("in an auf über unter vor hinter neben zwischen", ["dat", "acc"]),
]);
function wordSetEntries(words: string, cases: Case[]): Array<[string, Case[]]> {
  return words.split(" ").map((w) => [w, cases]);
}

const EIN_STEMS = wordSet("ein kein mein dein sein ihr unser euer eur");
const DIES_STEMS = wordSet("dies jed jen");
// Degree words between the article and its adjective ("eine sehr schönes Haus").
const DEGREE = "sehr|ganz|so|recht|ziemlich|besonders|wirklich|echt|total|äußerst|relativ|eher|zu";
const DETERMINER = [
  "der die das dem den des",
  "ein eine einen einem einer eines kein keine keinen keinem keiner keines",
  "mein meine meinen meinem meiner meines dein deine deinen deinem deiner deines",
  "sein seine seinen seinem seiner seines ihre ihren ihrem ihrer ihres",
  "unser unsere unseren unserem unserer unseres euer eure euren eurem eurer eures",
  "dieser diese dieses diesem diesen jeder jede jedes jedem jeden",
  "zum zur im am vom beim ins",
]
  .join(" ")
  .split(" ")
  .map((w) => `[${w[0]}${w[0].toUpperCase()}]${w.slice(1)}`)
  .join("|");
const PHRASE = new RegExp(
  `${WORD_START}(?<det>${DETERMINER})(?<mods>(?:${SPACE}(?:${DEGREE}|\\p{Ll}+(?:e|en|er|es|em))){0,3})` +
    `${SPACE}(?<noun>\\p{Lu}[\\p{L}\\p{M}]*(?:-[\\p{L}\\p{M}]+)*)${WORD_END}`,
  "gdu",
);

type Determiner = { kind: Kind; stem: string; ending: string; cases?: Case[]; prep?: string };

/** The stem and ending of a determiner: "keinen" → ein-word "kein" + "en". */
function parse(typed: string): Determiner | null {
  const low = typed.toLowerCase();
  if (Object.hasOwn(CONTRACTIONS, low)) {
    const [prep, article] = CONTRACTIONS[low];
    return { kind: "d", stem: "d", ending: article, prep };
  }
  if (/^d(?:er|ie|as|em|en|es)$/.test(low)) return { kind: "d", stem: "d", ending: low };
  const m = /^(.*?)(e|en|em|er|es|)$/.exec(low)!;
  for (const [stem, ending] of [
    [m[1], m[2]],
    [low, ""],
  ]) {
    if (DIES_STEMS.has(stem) && ending) return { kind: "dies", stem, ending };
    if (EIN_STEMS.has(stem)) return { kind: "ein", stem, ending };
  }
  return null;
}

/** The determiner's spelling for a gender and case, in the typed word's casing. */
function spell(det: Determiner, gender: Gender, c: Case, typed: string): string | null {
  const form = FORMS[det.kind][gender][CASE_ORDER.indexOf(c)];
  // "ein" has no plural.
  if (det.kind === "ein" && det.stem === "ein" && gender === "pl") return null;
  let word: string;
  if (det.prep) {
    const contracted = Object.entries(CONTRACTIONS).find(
      ([, [prep, article]]) => prep === det.prep && article === form,
    );
    word = contracted ? contracted[0] : `${det.prep} ${form}`;
  } else if (det.kind === "d") word = form;
  else {
    // "euer" drops its e before an ending: "eure".
    const stem = det.stem === "euer" || det.stem === "eur" ? (form ? "eur" : "euer") : det.stem;
    word = stem + form;
  }
  return /^\p{Lu}/u.test(typed) ? word[0].toUpperCase() + word.slice(1) : word;
}

/** The gender and case readings a determiner spells. */
function readings(det: Determiner): Array<[Gender, Case]> {
  const out: Array<[Gender, Case]> = [];
  for (const gender of ["m", "f", "n", "pl"] as Gender[]) {
    if (det.kind === "ein" && det.stem === "ein" && gender === "pl") continue;
    CASE_ORDER.forEach((c, i) => {
      // "zur", "im": the preposition's dative; "ins": the accusative.
      if (det.prep && c !== (det.ending === "das" ? "acc" : "dat")) return;
      if (FORMS[det.kind][gender][i] === det.ending) out.push([gender, c]);
    });
  }
  return out;
}

/** Whether the noun form can take a gender and case: a masculine or neuter genitive ends in
 * -s or -n ("des Autos", "des Menschen"), a dative plural in -n or -s ("den Kindern"). */
function fits(noun: string, reading: GermanGenderReading, gender: Gender, c: Case): boolean {
  if (gender === "pl") {
    return reading.plural && (c !== "dat" || /[ns]$/.test(noun));
  }
  const genders = reading.gender === "x" ? ["m", "n"] : [reading.gender];
  if (!genders.includes(gender)) return false;
  return c !== "gen" || gender === "f" || /[sn]$/.test(noun);
}

/** Whether a determiner can stand before a noun; null when either is unknown. */
export function determinerFits(typed: string, noun: string): boolean | null {
  const det = parse(typed);
  const head = noun.split("-").at(-1)!;
  const reading = det && germanGender(head);
  if (!det || !reading) return null;
  return readings(det).some(([g, c]) => fits(head, reading, g, c));
}

const sentenceStart = (before: string[]) => {
  const prior = before.at(-1) ?? "";
  return prior === "" || /^[.!?:\n„"“»«]$/.test(prior);
};
const DETERMINER_WORDS = new RegExp(`^(?:${DETERMINER})$`, "u");
const DEGREE_WORD = new RegExp(`^(?:${DEGREE})$`, "u");
/** An inflected adjective or participle ("schönes", "gekaufte", "spannenden"); no determiner. */
const isAdjective = (word: string) => {
  if (DETERMINER_WORDS.test(word)) return false;
  const stem = word.replace(/(?:e|en|er|es|em)$/, "");
  return (
    germanAdjective(stem) ||
    germanAdjective(`${stem}e`) ||
    germanAdjective(stem.replace(/(.)([lr])$/, "$1e$2")) ||
    /^ge\p{Ll}{3,}t$|\p{Ll}{3,}end$/u.test(stem)
  );
};
const endingOf = (word: string) => /(?:e|en|er|es|em)$/.exec(word)?.[0] ?? "";

// A masculine noun as the direct object of a pronoun subject: "Ich habe ein Tisch reserviert"
// (einen), "Wenn er der Mann sieht" (den). The pronoun is the subject, so the article cannot be
// nominative unless a copula ("ich bin ein Mann") or "als"/"wie" makes the noun a predicate;
// dative verbs ("ich helfe …") and a second object ("ich gebe ein Freund das Buch") are left
// out.
const SUBJECTS = wordSet("ich du er wir man");
const COPULAS =
  /^(?:sein|bin|bist|ist|sind|seid|war|warst|waren|wart|wäre|wärst|wären|sei|gewesen|werden|werde|wirst|wird|werdet|wurde|wurdest|wurden|würde|würdest|würden|geworden|bleiben|bleibe|bleibst|bleibt|blieb|blieben|geblieben|heißen|heiße|heißt|hieß|scheinen|scheint|schien|nennen|nenne|nennt|nannte|als|wie)$/;
// Verbs whose object is a dative ("helfen", "danken", "gehören", "gefallen").
const DATIVE_VERBS =
  /^(?:hilf|helf|half|geholf|dank|folg|gehör|gefall|gefäll|gefiel|antwort|vertrau|begegn|gratulier|zuhör|widersprech|schad|nütz|fehl|pass|schmeck|gehorch|rat|rät|riet|dien|ähnel|droh|verzeih|glaub|zustimm|stimm|beisteh|gönn)/;
// Words after the object that keep the clause open: a participle, an infinitive, an adverb.
const OBJECT_FOLLOWERS = wordSet(
  "heute morgen gestern allerdings auch noch schon nicht gern gerne bereits mal wieder jetzt " +
    "sofort dort hier da nie immer bitte doch endlich erst zu",
);

function objectCase(
  ctx: DetectContext,
  index: number,
  nounEnd: number,
  det: Determiner,
  typed: string,
  reading: GermanGenderReading,
  adjectives: string[],
): string | null {
  if (reading.gender !== "m" || det.prep) return null;
  if (!(det.kind === "ein" && det.ending === "") && !(det.kind === "d" && det.ending === "der")) {
    return null;
  }
  // "der Lehrer" may be a genitive plural.
  if (det.kind === "d" && reading.plural) return null;
  if (det.kind === "ein" && (det.stem === "ihr" || det.stem === "sein")) return null;
  const before = tokensBefore(ctx.text, index, 12);
  let from = before.length;
  while (from > 0 && !BOUNDARY.test(before[from - 1]) && before[from - 1] !== ",") from--;
  const clause = before.slice(from);
  if (!clause.some((t) => SUBJECTS.has(t.toLowerCase()))) return null;
  const prior = (clause.at(-1) ?? "").toLowerCase();
  if (PREPOSITIONS.has(prior) || DETERMINER_WORDS.test(prior)) return null;
  // "Weder ich noch mein Freund können …": joined to the subject.
  if (/^(?:und|oder|noch|sowie|sondern|bzw)$/.test(prior)) return null;
  const rest = ctx.text.slice(nounEnd, nounEnd + 120).split(/[.!?;:,\n–—]/)[0];
  const restWords = rest.match(/\p{L}+/gu) ?? [];
  // Lowercase words only: "Fehler" is no form of "fehlen".
  const words = [...clause, ...restWords].filter((w) => /^\p{Ll}/u.test(w));
  if (words.some((w) => COPULAS.test(w) || DATIVE_VERBS.test(w))) return null;
  // A second article after the noun, outside a prepositional phrase: two objects, or a new
  // phrase ("ich gebe ein Freund das Buch").
  const second = restWords.some(
    (w, i) =>
      DETERMINER_WORDS.test(w) &&
      !Object.hasOwn(CONTRACTIONS, w.toLowerCase()) &&
      !PREPOSITIONS.has(restWords[i - 1]?.toLowerCase() ?? ""),
  );
  if (second) return null;
  const subordinate = /^(?:wenn|weil|dass|ob|als|da|obwohl|falls|sobald|bevor|nachdem)$/.test(
    (clause[0] ?? "").toLowerCase(),
  );
  const next = restWords[0]?.toLowerCase() ?? "";
  const open =
    !next ||
    subordinate ||
    OBJECT_FOLLOWERS.has(next) ||
    PREPOSITIONS.has(next) ||
    Object.hasOwn(CONTRACTIONS, next) ||
    /^(?:\p{Ll}*ge\p{Ll}+(?:t|en)|\p{Ll}+iert)$/u.test(next) ||
    germanInfinitive(next);
  if (!open || /^\p{Lu}/u.test(restWords[0] ?? "")) return null;
  const article = spell(det, "m", "acc", typed);
  if (!article) return null;
  const inflected = adjectives.map((a) =>
    DEGREE_WORD.test(a) ? a : a.replace(/(?:e|en|er|es|em)$/, "en"),
  );
  return [article, ...inflected].join(" ");
}

// The object of a verb that takes only a dative or only an accusative (germanVerbObjectCase):
// "Ich helfe den Mann" (dem), "Er fragt dem Lehrer" (den). Only a singular masculine or
// neuter noun whose article shows the other case; the verb right before it with its subject
// earlier in the clause or a subject pronoun between, or the verb right after it at the end
// of a clause that opens with a subordinator or holds a modal. A second object, a
// postposition ("dem Namen nach") or an infinitive the noun may belong to ("ich helfe den
// Tisch decken", "ich sehe den Mann helfen") keeps the article.
const SUBJECT_PRONOUNS = wordSet("ich du er sie es wir ihr man");
const SUBORDINATORS = wordSet("dass weil wenn ob als obwohl damit nachdem bevor falls da sobald");
const MODALS = wordSet(
  "kann kannst können könnt will willst wollen wollt muss musst müssen müsst soll sollst " +
    "sollen sollt möchte möchtest möchten darf darfst dürfen werde wirst wird werden würde würden",
);
const PERCEPTION = /^(?:seh|sieh|sah|hör|lass|läss|ließ|fühl|spür|heiß|hieß)/;
const POSTPOSITIONS = wordSet(
  "nach zufolge gegenüber entgegen zuliebe entsprechend gemäß nahe halber wegen",
);
const CLAUSE_END = /[.!?;:,\n–—()"„“»«]/;

function verbObjectCase(
  ctx: DetectContext,
  index: number,
  nounEnd: number,
  det: Determiner,
  typed: string,
  head: string,
  reading: GermanGenderReading,
  adjectives: string[],
): { fixes: string[] } | null {
  if (det.prep || reading.gender === "f") return null;
  const before = tokensBefore(ctx.text, index, 12);
  let from = before.length;
  while (from > 0 && !BOUNDARY.test(before[from - 1])) from--;
  const clause = before.slice(from);
  const restText = ctx.text.slice(nounEnd, nounEnd + 120).split(CLAUSE_END)[0];
  const rest = restText.match(/[\p{L}\p{M}]+/gu) ?? [];
  const verbCase = (word: string | undefined, first: boolean) =>
    word === undefined
      ? null
      : germanVerbObjectCase(first && /^\p{Lu}\p{Ll}+$/u.test(word) ? word.toLowerCase() : word);
  let governed: "dative" | "accusative" | null = null;
  let i = clause.length - 1;
  const pronounAfter = i > 0 && SUBJECT_PRONOUNS.has(clause[i].toLowerCase());
  if (pronounAfter) i--;
  const verbBefore = i >= 0 ? verbCase(clause[i], i === 0) : null;
  if (verbBefore && (pronounAfter || clause.slice(0, i).some((t) => /^\p{L}/u.test(t)))) {
    governed = verbBefore;
  } else if (rest.length && rest.length <= 2) {
    // "weil ich den Mann helfe", "ich will den Mann helfen", "…, dass er dem Lehrer fragt".
    const verbAfter = verbCase(rest[0], false);
    const opener = (clause[0] ?? "").toLowerCase();
    const closes = rest.length === 1 || MODALS.has(rest[1].toLowerCase());
    const lowered = clause.map((t) => t.toLowerCase());
    if (verbAfter && closes && (SUBORDINATORS.has(opener) || lowered.some((t) => MODALS.has(t)))) {
      if (lowered.some((t) => SUBJECT_PRONOUNS.has(t)) || /^\p{Lu}/u.test(clause[1] ?? "")) {
        governed = verbAfter;
      }
    }
    if (governed) rest.length = 0;
  }
  if (!governed) return null;
  if (clause.some((t) => PERCEPTION.test(t.toLowerCase()))) return null;
  // A second object, a postposition, a zu-infinitive or a bare infinitive after the noun.
  const lowerRest = rest.map((w) => w.toLowerCase());
  if (POSTPOSITIONS.has(lowerRest[0] ?? "")) return null;
  const second = rest.some(
    (w, k) =>
      DETERMINER_WORDS.test(w) &&
      !Object.hasOwn(CONTRACTIONS, w.toLowerCase()) &&
      !PREPOSITIONS.has(lowerRest[k - 1] ?? ""),
  );
  if (second || lowerRest.includes("zu")) return null;
  if (
    lowerRest.some((w, k) => k === rest.length - 1 && /^\p{Ll}/u.test(w) && germanInfinitive(w))
  ) {
    return null;
  }
  // The typed article's readings that fit the noun ("den Lehrer": accusative singular only;
  // "den Lehrern": also the dative plural).
  const own = readings(det).filter(([g, c]) => fits(head, reading, g, c));
  const target: Case = governed === "dative" ? "dat" : "acc";
  const genders: Gender[] = reading.gender === "x" ? ["m", "n"] : [reading.gender];
  // Already the verb's case; or not only the other object case ("der Mann" may be the subject).
  if (own.some(([, c]) => c === target)) return null;
  const other: Case = governed === "dative" ? "acc" : "dat";
  if (!own.length || own.some(([g, c]) => c !== other || g === "pl")) return null;
  const kind = det.kind === "ein" ? "mixed" : "weak";
  const fixes = new Set<string>();
  for (const g of genders) {
    const article = spell(det, g, target, typed);
    if (!article) continue;
    const ending = ADJECTIVE_ENDINGS[kind][g][CASE_ORDER.indexOf(target)];
    const inflected = adjectives.map((a) =>
      DEGREE_WORD.test(a) ? a : a.replace(/(?:e|en|er|es|em)$/, ending),
    );
    fixes.add([article, ...inflected].join(" "));
  }
  return fixes.size ? { fixes: [...fixes] } : null;
}

// A compound written apart, told by its article: "die Haus Tür" (die fits Tür, not Haus),
// "der Auto Schlüssel", "das Verkehrs Schild" (a linking -s after a nominative article).
// "der Mutter Blumen" (two objects) keeps its space: the article fits the first noun.
function splitCompound(
  ctx: DetectContext,
  m: RegExpExecArray,
  typed: string,
  first: string,
): RawFinding | null {
  // "einer Berliner Schule", "die Hamburger Straße": a place adjective in -er.
  if (/-|er$/.test(first) || ctx.dictionary.has(first.toLowerCase())) return null;
  const nounEnd = m.indices!.groups!.noun[1];
  const gap = /^[ \t]{1,3}(\p{Lu}\p{Ll}{2,})(?![\p{L}\p{M}\p{N}_-])/u.exec(ctx.text.slice(nounEnd));
  if (!gap) return null;
  const second = gap[1];
  const after = tokensAfter(ctx.text, nounEnd + gap[0].length, 1)[0] ?? "";
  // "die Bank Austria": a name goes on capitalized.
  if (/^\p{Lu}/u.test(after) || ctx.dictionary.has(second.toLowerCase())) return null;
  if (germanNounReading(second.toLowerCase()) === null) return null;
  const low = first.toLowerCase();
  // "Verkehrs", "Küchen" (after "ein-", which has no plural): a linking -s or -n.
  const linked =
    (/(?:s|es)$/.test(low) && germanNounReading(low.replace(/e?s$/, "")) !== null) ||
    (/^ein(?:e[mnrs]?)?$/i.test(typed) &&
      /n$/.test(low) &&
      [low.slice(0, -1), low.slice(0, -2)].some((stem) => germanNounReading(stem) !== null));
  if (!linked && germanNounReading(low) === null) return null;
  if (determinerFits(typed, second) !== true) return null;
  // A linking -s after an article that is no genitive ("das Verkehrs Schild"); otherwise the
  // article must not fit the first noun.
  const genitive = /^(?:des|eines|keines|meines|deines|seines|ihres|unseres|eures|dieses|jedes)$/i;
  if (linked ? genitive.test(typed) : determinerFits(typed, first) !== false) return null;
  const mods = m.groups!.mods ?? "";
  if (
    mods.trim() &&
    !mods
      .trim()
      .split(/[ \t ]+/)
      .every((a) => DEGREE_WORD.test(a) || isAdjective(a))
  ) {
    return null;
  }
  const [start] = m.indices!.groups!.noun;
  const end = nounEnd + gap[0].length;
  return {
    ruleId: "germanArticleGender",
    messageKey: "review_msg_closed_compound",
    range: { start, end },
    alternatives: [first + second.toLowerCase()],
    context: { start: m.index, end },
  };
}

// An adjective used as a noun keeps the adjective's ending after its article: "der
// Angestellte" (not "Angestellter"), "ein Abgeordneter" or "eine Abgeordnete" (not "ein
// Abgeordnete"). Any gender fits a person, so the article's own readings decide.
function nominalizedAdjective(
  ctx: DetectContext,
  m: RegExpExecArray,
  det: Determiner,
  typed: string,
  noun: string,
): RawFinding | null {
  const low = noun.toLowerCase();
  if (det.prep || noun.includes("-") || germanNounReading(low) !== null) return null;
  const parts = /^(\p{Ll}{3,}?)(e|en|er|es|em)$/u.exec(low);
  if (!parts) return null;
  const [, stem, typedEnding] = parts;
  // Only "-er" after "der" and "-e" after a bare ein-word: "des Gebietes", "seiner Spitze",
  // "das Machen" are nouns of their own.
  const bareEin = det.kind === "ein" && det.ending === "";
  if (typedEnding !== (bareEin ? "e" : "er") || (!bareEin && det.kind === "ein")) return null;
  // Person words: participles ("Angestellte", "Verrückte") and adjectives in -lich, -ig,
  // -los, -isch ("Jugendliche", "Obdachlose"); "Alter", "Junge", "Tauber" are nouns.
  const participle =
    (/^\p{Ll}*ge\p{Ll}+t$/u.test(stem) &&
      germanInfinitive(`${stem.replace(/^\p{Ll}*?ge/u, "").slice(0, -1)}en`)) ||
    (/^(?:ver|be|er|zer|ent)\p{Ll}+t$/u.test(stem) && germanInfinitive(`${stem.slice(0, -1)}en`));
  // "Vorsitzende", "Reisende": a present participle.
  const present = /\p{Ll}{3,}end$/u.test(stem) && germanInfinitive(stem.slice(0, -1));
  const personAdjective = present || (/(?:lich|ig|los|isch)$/.test(stem) && germanAdjective(stem));
  if (!participle && !personAdjective) return null;
  const before = tokensBefore(ctx.text, m.index, 2);
  const start = sentenceStart(before);
  // ", der Abgeordneter war": a relative pronoun before a predicate noun.
  if (before.at(-1) === "," && det.kind === "d") return null;
  let pairs = readings(det);
  if (start && pairs.some(([, c]) => c === "nom")) pairs = pairs.filter(([, c]) => c === "nom");
  // "ein Abgeordneter": a person, so no neuter fix.
  if (pairs.some(([g]) => g === "m")) pairs = pairs.filter(([g]) => g !== "n");
  const kind = det.kind === "ein" ? "mixed" : "weak";
  const allowed = new Set(
    readings(det).map(([g, c]) => ADJECTIVE_ENDINGS[kind][g][CASE_ORDER.indexOf(c)]),
  );
  if (allowed.has(typedEnding)) return null;
  // A capitalized word after it: a name or an open compound.
  const nounEnd = m.indices!.groups!.noun[1];
  const next = tokensAfter(ctx.text, nounEnd, 1)[0] ?? "";
  if (/^\p{Lu}/u.test(next) || ctx.dictionary.has(low)) return null;
  // "Ein Abgeordnete betreffendes Problem", "Ein Verrückte zu … provozierendes": the noun is
  // the object of a participle that the article belongs to.
  if (next === "zu" || /^(?:\p{Ll}+nd|\p{Ll}*ge\p{Ll}+t)(?:e|en|er|es|em)$/u.test(next))
    return null;
  const head = noun.slice(0, stem.length);
  const fixes = new Set(
    pairs.map(([g, c]) => `${typed} ${head}${ADJECTIVE_ENDINGS[kind][g][CASE_ORDER.indexOf(c)]}`),
  );
  // "Ein Abgeordnete": a woman ("Eine Abgeordnete") as much as a man ("Ein Abgeordneter").
  if (det.kind === "ein" && det.ending === "" && typedEnding === "e" && start) {
    fixes.add(`${spell(det, "f", "nom", typed)} ${noun}`);
  }
  const [detStart] = m.indices!.groups!.det;
  return {
    ruleId: "germanArticleGender",
    messageKey: "review_msg_german_adjective_ending",
    range: { start: detStart, end: nounEnd },
    alternatives: [...fixes],
    context: { start: m.index, end: nounEnd },
    ...(fixes.size > 1 ? { requiresChoice: true as const } : {}),
  };
}

function articleGender(ctx: DetectContext): RawFinding[] {
  if (!isGerman(ctx)) return [];
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, PHRASE, "det")) {
    const { det: typed, mods = "", noun } = m.groups!;
    const det = parse(typed);
    if (!det) continue;
    const parts = noun.split("-");
    const head = parts.at(-1)!;
    if (head.length < 3 || !/^\p{Lu}/u.test(head)) continue;
    if (ctx.dictionary.has(noun.toLowerCase()) || ctx.dictionary.has(head.toLowerCase())) continue;
    const compound = splitCompound(ctx, m, typed, noun);
    if (compound) {
      findings.push(compound);
      continue;
    }
    const reading = germanGender(head);
    if (!reading && !mods.trim()) {
      const nominal = nominalizedAdjective(ctx, m, det, typed, noun);
      if (nominal) findings.push(nominal);
      continue;
    }
    // "Die Bild": the newspaper.
    if (!reading || /^die bild$/i.test(`${typed} ${noun}`)) continue;
    // "die Naturschutz und Umweltthemen": the first part of a shortened compound pair, which
    // the suspended-hyphen check repairs.
    const pair = /^[ \t]+(?:und|oder)[ \t]+(\p{Lu}\p{Ll}{4,})/u.exec(
      ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 40),
    );
    if (pair && determinerFits(typed, pair[1]) !== false) continue;
    const adjectives = mods.trim() ? mods.trim().split(/[ \t\u00a0]+/) : [];
    const inflected = adjectives.filter((a) => !DEGREE_WORD.test(a));
    if (!inflected.every(isAdjective)) continue;
    // "die im folgenden beschriebene", "im wesentlichen Geschmackssache": adjectives that do
    // not agree with each other, or a lowercased noun after a contraction, head no phrase.
    if (new Set(inflected.map(endingOf)).size > 1) continue;
    if (/^(?:im|am|vom|beim)$/i.test(typed) && inflected.length) continue;
    const before = tokensBefore(ctx.text, m.index, 2);
    const prior = (before.at(-1) ?? "").toLowerCase();
    const start = sentenceStart(before);
    const afterPreposition = PREPOSITIONS.has(prior);
    const nounEnd = m.indices!.groups!.noun[1];
    const [detStart] = m.indices!.groups!.det;
    const end = adjectives.length ? m.indices!.groups!.mods[1] : m.indices!.groups!.det[1];
    const typedReadings = readings(det);
    // "über sein Umzug", "um kein Tisch": a bare ein-word before a masculine noun is only a
    // nominative, which no preposition governs. Not "was für ein Lärm", "ohne ein Titel zu
    // sein", "meiner Ansicht nach kein Konflikt", "ein Server internes Problem".
    const clauseRest = /^[^.!?;,\n]*/.exec(ctx.text.slice(nounEnd))![0];
    const wrongCase =
      det.kind === "ein" &&
      det.ending === "" &&
      reading.gender === "m" &&
      !(det.stem === "kein" && prior === "ohne") &&
      !reading.plural &&
      /^(?:für|um|gegen|ohne|durch|über|auf|in|an|unter|vor|hinter|neben|zwischen|mit|von|zu|bei|aus)$/.test(
        prior,
      ) &&
      !/(?<!\p{L})was(?!\p{L})/iu.test(ctx.text.slice(Math.max(0, m.index - 30), m.index)) &&
      !/(?<!\p{L})(?:sein|werden|bleiben|nach)(?!\p{L})/u.test(clauseRest) &&
      !/^[ \t]+\p{Ll}+(?:e|es|en|er|em)[ \t]+\p{Lu}/u.test(clauseRest) &&
      !/(?<!\p{L})(?:nach|und)[ \t]+$/u.test(
        ctx.text.slice(Math.max(0, m.index - 12), m.index - prior.length - 1),
      );
    if (!wrongCase && typedReadings.some(([g, c]) => fits(head, reading, g, c))) {
      const verb = verbObjectCase(ctx, m.index, nounEnd, det, typed, head, reading, adjectives);
      if (verb) {
        findings.push({
          ruleId: "germanArticleGender",
          messageKey: "review_msg_german_verb_case",
          range: { start: detStart, end },
          alternatives: verb.fixes,
          context: { start: m.index, end: nounEnd },
          ...(verb.fixes.length > 1 ? { requiresChoice: true as const } : {}),
        });
        continue;
      }
      const object = objectCase(ctx, m.index, nounEnd, det, typed, reading, adjectives);
      if (object) {
        findings.push({
          ruleId: "germanArticleGender",
          messageKey: "review_msg_german_object_case",
          range: { start: detStart, end },
          alternatives: [object],
          context: { start: m.index, end: nounEnd },
        });
      }
      continue;
    }
    // "der", "die", "diese" are also pronouns: "…, der Auto fährt", "weil die Angst haben".
    if ((det.kind === "d" || det.kind === "dies") && !det.prep && !start && !afterPreposition) {
      continue;
    }
    // "auf der einen Seite", "das eine Mal": an adjective "eine"; "ich meine", "kann sein",
    // "ihr" and "einer" also are pronouns or verbs.
    if (det.kind === "ein") {
      if (DETERMINER_WORDS.test(prior) || /^(?:ans|aufs|durchs|fürs|ums)$/.test(prior)) continue;
      if (det.stem === "ihr" || (det.stem === "mein" && /^(?:ich|wir|sie)$/.test(prior))) continue;
      if (det.stem === "sein" && det.ending === "" && !afterPreposition) continue;
      if (det.ending === "er" && /^k?ein$/.test(det.stem) && !afterPreposition) continue;
    }
    const after = tokensAfter(ctx.text, nounEnd, 2);
    const next = after[0] ?? "";
    // "die Hotel Lobby", "das Auto-" written apart, a name after the noun.
    if (/^\p{Lu}/u.test(next) && !BOUNDARY.test(next)) continue;
    // "die Rad fahren": a pronoun and a bare object.
    if (det.kind !== "ein" && !det.prep && germanInfinitive(next)) continue;
    // "die Gewinn und Verlustrechnung": a compound part missing its hyphen, whose article
    // belongs to the compound after "und" (germanSuspendedHyphen).
    if (/^(?:und|oder|sowie|bzw)$/.test(next) && determinerFits(typed, after[1] ?? "")) continue;
    // The cases left: the typed article's, narrowed by the preposition or the sentence start.
    let cases = [...new Set(typedReadings.map(([, c]) => c))];
    const governed = det.prep ? undefined : afterPreposition ? GOVERNED.get(prior) : undefined;
    if (governed) {
      const narrowed = cases.filter((c) => governed.includes(c));
      // "mit das Auto": the preposition's case is wrong too (germanPrepositionCase).
      if (!narrowed.length) continue;
      cases = narrowed;
    } else if (start) {
      // A sentence opens with its subject as often as not: "Unserer Test war kurz".
      cases = cases.includes("nom") ? ["nom"] : ["nom", ...cases];
    }
    const genders: Gender[] = reading.gender === "x" ? ["m", "n"] : [reading.gender];
    if (reading.plural && !(det.kind === "ein" && det.stem === "ein")) genders.push("pl");
    const fixes = new Map<string, string>();
    for (const c of cases) {
      for (const g of genders) {
        if (!fits(head, reading, g, c)) continue;
        const article = spell(det, g, c, typed);
        if (!article) continue;
        const endings = ADJECTIVE_ENDINGS[det.kind === "ein" ? "mixed" : "weak"][g];
        const ending = endings[CASE_ORDER.indexOf(c)];
        const words = adjectives.map((a) =>
          DEGREE_WORD.test(a) ? a : a.replace(/(?:e|en|er|es|em)$/, ending),
        );
        const replacement = [article, ...words].join(" ");
        fixes.set(replacement, replacement);
      }
    }
    if (!fixes.size || fixes.size > 3) continue;
    findings.push({
      ruleId: "germanArticleGender",
      messageKey: "review_msg_german_article_gender",
      range: { start: detStart, end },
      alternatives: [...fixes.keys()],
      context: { start: m.index, end: nounEnd },
      ...(fixes.size > 1 ? { requiresChoice: true as const } : {}),
    });
  }
  return findings;
}

// An adjective with no article before its noun takes the strong ending that shows the case:
// "schönes Wetter", "mit großer Freude", "herzlichen Dank".
const STRONG: Readonly<Record<Gender, readonly string[]>> = {
  m: ["er", "en", "em", "en"],
  f: ["e", "e", "er", "er"],
  n: ["es", "es", "em", "en"],
  pl: ["e", "e", "en", "er"],
};
const BARE = new RegExp(
  `${WORD_START}(?<adj>\\p{L}+(?:e|en|er|es|em))${SPACE}(?<noun>\\p{Lu}[\\p{L}\\p{M}]*(?:-[\\p{L}\\p{M}]+)*)${WORD_END}`,
  "gdu",
);
// Verbs after which a bare noun phrase is the subject or object: "es gibt", "ist", "hat".
const BARE_AFTER = wordSet(
  "ist sind war waren gibt gab hat habe haben hatte hatten wird werden bietet bieten braucht " +
    "brauchen suche suchen wünsche wünschen",
);

// Determiners and quantifiers spelled like adjectives, and prepositions in -e ("inklusive").
const QUANTIFIER =
  /^(?:(?:dies|jen|jed|welch|manch|all|viel|wenig|einig|mehrer|beid|etlich|sämtlich|irgendwelch)\p{Ll}*|inklusive|exklusive)$/u;

function bareAdjective(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, BARE, "adj")) {
    const { adj, noun } = m.groups!;
    const low = adj.toLowerCase();
    // "-er", "-en" and "-em" are left out: "früher", "voller", "weniger" and "vor allem" are
    // adverbs or idioms.
    if (!/[^e]es$|[^e]e$/.test(low) || DETERMINER_WORDS.test(low) || QUANTIFIER.test(low)) continue;
    if (!isAdjective(low)) continue;
    const head = noun.split("-").at(-1)!;
    if (head.length < 3 || !/^\p{Lu}/u.test(head)) continue;
    if (ctx.dictionary.has(low) || ctx.dictionary.has(head.toLowerCase())) continue;
    const reading = germanGender(head);
    if (!reading) continue;
    const before = tokensBefore(ctx.text, m.index, 1);
    const prior = (before.at(-1) ?? "").toLowerCase();
    const start = sentenceStart(before);
    // Only a sentence start, a preposition or a verb before: after an article, an adverb or
    // another adjective the ending follows other rules.
    // "zu verstehende Bestimmung": a gerundive, no preposition.
    const governed = prior === "zu" ? undefined : GOVERNED.get(prior);
    if (!start && !governed && !BARE_AFTER.has(prior)) continue;
    if (start && adj === low) continue;
    const next = tokensAfter(ctx.text, m.indices!.groups!.noun[1], 1)[0] ?? "";
    if (/^\p{Lu}/u.test(next) && !BOUNDARY.test(next)) continue;
    const cases: Case[] = governed ?? ["nom", "acc"];
    const genders: Gender[] = reading.gender === "x" ? ["m", "n"] : [reading.gender];
    if (reading.plural) genders.push("pl");
    const typed = endingOf(low);
    const allowed = new Set<string>();
    for (const g of genders) {
      for (const c of cases)
        if (fits(head, reading, g, c)) allowed.add(STRONG[g][CASE_ORDER.indexOf(c)]);
    }
    if (!allowed.size || allowed.has(typed)) continue;
    // Every ending the case allows ("herzliche Dank": herzlicher or herzlichen).
    const stem = adj.slice(0, adj.length - typed.length);
    const [adjStart, end] = m.indices!.groups!.adj;
    findings.push({
      ruleId: "germanArticleGender",
      messageKey: "review_msg_german_adjective_ending",
      range: { start: adjStart, end },
      alternatives: [...allowed].map((e) => stem + e),
      context: { start: m.index, end: m.indices!.groups!.noun[1] },
      ...(allowed.size > 1 ? { requiresChoice: true as const } : {}),
    });
  }
  return findings;
}

// "das Haus als solches", "dem Menschen als solchem": "als solch-" after a noun takes the
// strong ending of the noun's case, gender and number, which its determiner shows.
const ALS_SOLCH = new RegExp(
  `${WORD_START}(?<det>[Dd](?:er|ie|as|en|em)|[Dd]ies(?:er|e|es|en|em)|(?:[Kk]?[Ee]in|[Mm]ein|[Dd]ein|[Ss]ein|[Ii]hr|[Uu]nser)(?:e|en|em|er)?)(?:${SPACE}\\p{Ll}{2,30}(?:e|en|er|es|em))?${SPACE}(?<noun>\\p{Lu}\\p{Ll}{2,})${SPACE}als${SPACE}(?<target>solch(?:e|er|es|em|en))${WORD_END}`,
  "gdu",
);
/** The ending the determiner fixes: "der" → "er", "dem" → "em"; null for "ein", "des". */
function solchEnding(det: string, noun: string): string | null {
  const low = det.toLowerCase();
  if (/^d(?:er|ieser)$/.test(low) || /^(?:k?ein|mein|dein|sein|ihr|unser)er$/.test(low))
    return "er";
  if (/^d(?:ie|iese)$/.test(low) || /^(?:k?ein|mein|dein|sein|ihr|unser)e$/.test(low)) return "e";
  if (/^d(?:as|ieses)$/.test(low)) return "es";
  if (/em$/.test(low)) return "em";
  if (/en$/.test(low)) return "en";
  // "ein Haus als solches", "kein Mensch als solcher": the noun's gender decides.
  const gender = germanGender(noun)?.gender;
  return gender === "m" ? "er" : gender === "n" ? "es" : null;
}

// Verbs whose object is a genitive: "es bedarf eines Beweises", "wir gedenken der Opfer",
// and reflexive ones: "sich der Stimme enthalten", "sich eines Erfolgs rühmen".
const GENITIVE_VERBS =
  "bedarf|bedürfen|bedurfte|bedurften|bedürfte|gedenke|gedenkt|gedenken|gedachte|gedachten";
const GENITIVE_REFLEXIVES =
  "enthielt|enthielten|enthalte|enthältst|enthält|enthaltet|rühmen|rühmt|rühmte|rühmten|rühme|" +
  "entledigte|entledigten|entledigt|entledigen|entledige|bemächtigte|bemächtigten|bemächtigt|" +
  "bemächtigen|vergewisserte|vergewissert|vergewissern|erbarmte|erbarmt|erbarmen";
const GENITIVE_PARTICIPLES = "enthalten|gerühmt|entledigt|bemächtigt|vergewissert|erbarmt";
const DATIVE_DET =
  "dem|einem|keinem|meinem|deinem|seinem|ihrem|unserem|eurem|diesem|jenem|jedem|den|meinen|deinen|seinen|ihren|unseren|euren|diesen|jenen";
const GENITIVE_OBJECT = new RegExp(
  `${WORD_START}(?:(?:${GENITIVE_VERBS})(?:${SPACE}es)?|(?:${GENITIVE_REFLEXIVES})${SPACE}(?:sich|mich|dich|uns|euch))${SPACE}(?<target>${DATIVE_DET})${SPACE}(?<rest>(?:\\p{Ll}+${SPACE}){0,2}\\p{Lu}\\p{Ll}+)${WORD_END}|` +
    `${WORD_START}(?:sich|mich|dich|uns|euch)${SPACE}(?<t2>${DATIVE_DET})${SPACE}(?<rest2>(?:\\p{Ll}+${SPACE}){0,2}\\p{Lu}\\p{Ll}+)(?=${SPACE}(?:${GENITIVE_PARTICIPLES})${WORD_END})`,
  "gdu",
);

/** The genitive of a dative determiner: "dem" → "des", "den Kameraden" → "der". */
function genitiveOf(det: string, noun: string): string | null {
  if (det.endsWith("m")) return `${det.slice(0, -1)}s`;
  // "den"/"ihren" before a plural in -n: the plural genitive; before a masculine: "des".
  if (/n$/.test(noun) && noun.length > 3) return det === "den" ? "der" : `${det.slice(0, -1)}r`;
  if (det === "den" && germanGender(noun)?.gender === "m") return "des";
  return null;
}

function genitiveObject(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    GENITIVE_OBJECT,
    (match) => match.indices!.groups![match.groups!.target ? "target" : "t2"][0],
  )) {
    const name = m.groups!.target ? "target" : "t2";
    const det = m.groups![name];
    const noun = (m.groups!.rest ?? m.groups!.rest2).split(/[ \t]+/).at(-1)!;
    // "Er gedachte den Vertrag zu kündigen": "gedenken" as "intend" takes a zu-infinitive.
    const end = m.index + m[0].length;
    if (
      /^[^.!?;,\n]{0,60}(?<!\p{L})zu[ \t]+\p{Ll}|^[^.!?;,\n]{0,60}\p{Ll}zu\p{Ll}{3,}en(?!\p{L})/u.test(
        ctx.text.slice(end, end + 80),
      )
    )
      continue;
    const fixed = genitiveOf(det.toLowerCase(), noun);
    if (!fixed || ctx.dictionary.has(det.toLowerCase())) continue;
    const [start, stop] = m.indices!.groups![name];
    const article = /^\p{Lu}/u.test(det) ? fixed[0].toUpperCase() + fixed.slice(1) : fixed;
    // "eines neuen Gesetzes", "des Urteils": a masculine or neuter noun takes -s or -es too
    // ("des Menschen" keeps its -en).
    const phraseEnd = end;
    const between = ctx.text.slice(stop, phraseEnd - noun.length);
    const singular = fixed.endsWith("s") && !/(?:en|n|s)$/.test(noun);
    const genitive = singular ? noun + (/(?:ß|z|x|sch)$/.test(noun) ? "es" : "s") : null;
    findings.push({
      ruleId: "germanArticleGender",
      messageKey: "review_msg_german_genitive_verb",
      range: { start, end: genitive ? phraseEnd : stop },
      alternatives: [genitive ? `${article}${between}${genitive}` : article],
      context: { start: m.index, end },
    });
  }
  return findings;
}

function alsSolch(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, ALS_SOLCH)) {
    const { det, noun, target } = m.groups!;
    const prior = (tokensBefore(ctx.text, m.index, 1).at(-1) ?? "").toLowerCase();
    // "in der Stadt als solche bekannt": the noun of a prepositional phrase need not be what
    // "als solche" refers to.
    if (PREPOSITIONS.has(prior)) continue;
    if (germanNounReading(noun.toLowerCase()) === null && !germanGender(noun)) continue;
    // "als solche Menschen": an attribute of the noun after it.
    const [, end] = m.indices!.groups!.target;
    const next = tokensAfter(ctx.text, end, 1)[0] ?? "";
    if (/^\p{Lu}/u.test(next) || ctx.dictionary.has(target.toLowerCase())) continue;
    const ending = solchEnding(det, noun);
    if (!ending || target === `solch${ending}`) continue;
    const [start] = m.indices!.groups!.target;
    findings.push({
      ruleId: "germanArticleGender",
      messageKey: "review_msg_german_als_solch",
      range: { start, end },
      alternatives: [`solch${ending}`],
      context: { start: m.index, end },
    });
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: ["germanArticleGender"],
    detect: (ctx) =>
      isGerman(ctx)
        ? [...articleGender(ctx), ...bareAdjective(ctx), ...alsSolch(ctx), ...genitiveObject(ctx)]
        : [],
  },
];
