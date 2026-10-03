import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  adjectiveReadings,
  isInflectedNoun,
  isNounLemma,
  isVerbHomograph,
  nounGender,
  verbReadings,
} from "./frenchLexicon";
import {
  ownedFrenchWords,
  tokensAfter,
  tokensBefore,
  wordFinding,
  type Token,
} from "./frenchTokens";

// More sound-alike small words told apart by a neighbour: "il ni arrive pas" (n'y), "il si
// prend bien" (s'y), "il sans va" (s'en), "mes je" (mais), "dans prendre" (d'en), "cela leurs
// permet" (leur), "mêmes si" (même), "parler d'avantage" (davantage), and "quel que soit" with
// the gender and number of its noun.

const RULE = "frenchHomophones";
const MESSAGE = "review_msg_fr_homophone";

const SUBJECTS = new Set(["je", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles"]);
const THIRD = new Set(["il", "elle", "on", "ils", "elles"]);
const CLAUSE_PRONOUNS = new Set(
  "je j' tu il elle on nous vous ils elles ce c' ça cela pour moi toi".split(" "),
);
const ADVERBS_AFTER_MAIS = new Set(
  "bien pas plutôt aussi surtout encore non oui pourtant alors si quand".split(" "),
);
const DETERMINERS = new Set(
  "le la les l' un une mon ma mes ton ta tes son sa ses ce cet cette ces notre nos votre vos leur leurs".split(
    " ",
  ),
);
// Verbs that take "avantage" as their object: "tirer avantage", "avoir l'avantage".
const AVANTAGE_VERBS = new Set(
  "avoir tirer offrir présenter voir trouver apporter donner retirer procurer".split(" "),
);

const finite = (word: string) => verbReadings(word).some((r) => typeof r.slot === "number");
const nounLike = (word: string) => isInflectedNoun(word) || !!nounGender(word);
const verbOnly = (word: string) => !nounLike(word) && finite(word);
const infinitiveOnly = (word: string) =>
  !nounGender(word) && verbReadings(word).some((r) => r.slot === "I");

function smallWord(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const typed = m[0];
  const lower = typed.toLowerCase().replaceAll("’", "'");
  const before = tokensBefore(ctx.text, m.index, 3);
  const after = tokensAfter(ctx.text, m.index + typed.length, 3);
  const previous = before[0]?.w;
  const next = after[0];
  const fix = (alt: string, end = next?.end ?? m.index + typed.length) =>
    wordFinding(ctx, m.index, typed, [alt], RULE, MESSAGE, {
      start: before[0]?.start ?? m.index,
      end,
    });
  if (lower === "soi" || lower === "soit") return soiSoit(ctx, m, previous, next);
  if (!next) return null;
  const n = next.w;
  // "il ni arrive pas" -> "n'y"; "il si prend bien", "on ci sent bien" -> "s'y"; "il sans va",
  // "il c'en rend compte" -> "s'en".
  if (previous && SUBJECTS.has(previous) && verbOnly(n) && !/^\p{Lu}/u.test(typed.slice(1))) {
    if (lower === "ni") return fix("n'y");
    if ((lower === "si" || lower === "ci") && THIRD.has(previous)) return fix("s'y");
    if (lower === "sans" && THIRD.has(previous)) return fix("s'en");
  }
  // "mes je pense", "mai il pleut", "mas je" -> "mais".
  if (lower === "mes" || lower === "mai" || lower === "mas") {
    if (lower === "mai" && (/\d[\s  ]*$/u.test(ctx.text.slice(0, m.index)) || previous === "de"))
      return null;
    if (!CLAUSE_PRONOUNS.has(n) && !(lower === "mes" && ADVERBS_AFTER_MAIS.has(n))) return null;
    // "mes moi" is no phrase, "pour moi" is: only "mais pour moi".
    if (lower === "mes" && (n === "moi" || n === "toi")) return null;
    return fix("mais");
  }
  // "je viens dans prendre" -> "d'en".
  if (lower === "dans" && infinitiveOnly(n) && !DETERMINERS.has(n)) return fix("d'en");
  // "dan la maison" -> "dans" (lowercase: "Dan" is a name, "dan" a judo grade).
  if (
    typed === "dan" &&
    DETERMINERS.has(n) &&
    !/\d[\s  ]*(?:e|er|ème)?[\s  ]*$/u.test(ctx.text.slice(Math.max(0, m.index - 8), m.index))
  )
    return fix("dans");
  // "cela leurs permet" -> "leur".
  if (lower === "leurs" && verbOnly(n) && !DETERMINERS.has(n)) return fix("leur");
  if (lower === "nous" || lower === "vous") return possessiveForPronoun(ctx, m, previous, next);
  if (lower === "et") return etToEst(ctx, m, before, after);
  if (lower === "est") return estToEt(ctx, m, before, after);
  // "mêmes si", "ils sont mêmes grands" -> "même" (the adverb).
  if (lower === "mêmes") {
    if (previous && DETERMINERS.has(previous)) return null;
    if (["si", "s'il", "s'ils", "lorsque", "lorsqu'", "quand"].includes(n)) return fix("même");
    if (n === "s'") return fix("même");
    return null;
  }
  return null;
}

// Prepositions after which "nous"/"vous" + a plural noun is the possessive misspelt.
const NOUN_PREPOSITIONS = new Set("de d' à pour avec sur par dans sans selon".split(" "));
// Plurals that may address the reader or follow the pronoun: "merci à vous messieurs", "pour
// nous autres".
const VOCATIVES = new Set("messieurs mesdames mesdemoiselles amis enfants autres".split(" "));

/** "de vous impressions" -> "vos", "pour nous enfants" -> "nos": after a preposition a plural
 * noun no verb spells takes the possessive. */
function possessiveForPronoun(
  ctx: DetectContext,
  m: RegExpExecArray,
  previous: string | undefined,
  next: Token,
): RawFinding | null {
  if (!previous || !NOUN_PREPOSITIONS.has(previous) || VOCATIVES.has(next.w)) return null;
  if (!/[sx]$/.test(next.w) || isNounLemma(next.w) || !isInflectedNoun(next.w)) return null;
  if (verbReadings(next.w).length || adjectiveReadings(next.w).length) return null;
  if (/^\p{Lu}/u.test(ctx.text.slice(next.start, next.end))) return null;
  const lower = m[0].toLowerCase();
  return wordFinding(ctx, m.index, m[0], [lower === "nous" ? "nos" : "vos"], RULE, MESSAGE, {
    start: m.index,
    end: next.end,
  });
}

// Prepositions whose object "soi" may end the clause: "prendre soin de soi", "chez soi".
const SOI_PREPOSITIONS = new Set(
  "de d' derrière devant pour sur chez avec sans à entre".split(" "),
);

/** "qu'il soi" -> "soit", "quelque soi" -> "soit", "Soi prudent" -> "Sois", "prendre soin de
 * soit." -> "soi". */
function soiSoit(
  ctx: DetectContext,
  m: RegExpExecArray,
  previous: string | undefined,
  next: Token | undefined,
): RawFinding | null {
  const typed = m[0];
  const end = next?.end ?? m.index + typed.length;
  const fix = (alt: string, start = m.index) =>
    wordFinding(ctx, m.index, typed, [alt], RULE, MESSAGE, { start, end });
  if (typed.toLowerCase() === "soi") {
    if (previous && ["il", "elle", "on", "ça", "cela", "quelque"].includes(previous))
      return fix("soit");
    const opening = /(?:^|[.!?…]\s*)$/u.test(ctx.text.slice(Math.max(0, m.index - 4), m.index));
    if (!previous && opening && next && adjectiveReadings(next.w).length) return fix("sois");
    return null;
  }
  // "quoi qu'il en soit.": "en soit" is the verb.
  if (!previous || !SOI_PREPOSITIONS.has(previous)) return null;
  if (!/^[\s\u00a0]*(?:[.!?…;,)]|$)/u.test(ctx.text.slice(m.index + typed.length))) return null;
  return fix("soi");
}

const STRESSED = new Set("moi toi lui elle eux nous vous elles soi".split(" "));
// What "est" may introduce: a place, a degree or a time adverb.
const AFTER_EST = new Set(
  "sur sous dans là ici très déjà bien trop plus toujours encore vraiment assez si devant derrière loin près".split(
    " ",
  ),
);
const participleOrAdjective = (word: string) =>
  verbReadings(word).some((r) => r.slot === "Q") ||
  (adjectiveReadings(word).length > 0 && !nounGender(word));

/** "il et parti", "le garçon et arrivé", "ceci et une table" -> "est". */
function etToEst(
  ctx: DetectContext,
  m: RegExpExecArray,
  before: Token[],
  after: Token[],
): RawFinding | null {
  const next = after[0];
  if (!next || /^\p{Lu}/u.test(ctx.text.slice(next.start, next.end))) return null;
  const typed = m[0];
  const fix = () =>
    wordFinding(ctx, m.index, typed, ["est"], RULE, MESSAGE, {
      start: before[0]?.start ?? m.index,
      end: next.end,
    });
  const subject = before[0]?.w;
  if (!subject || STRESSED.has(next.w)) return null;
  // "chez elle et fait": a stressed pronoun after a preposition is no subject.
  const opensClause =
    !before[1] || ["et", "mais", "que", "qu'", "car", "donc"].includes(before[1].w);
  const attribute = participleOrAdjective(next.w) || AFTER_EST.has(next.w);
  // The word after the attribute closes the clause or opens a complement.
  const closes = !after[1] || /^(?:à|au|aux|en|dans|sur|par|de|d'|du|pour|avec)$/.test(after[1].w);
  if (subject === "il" || subject === "on" || subject === "qui")
    return attribute || DETERMINERS.has(next.w) ? fix() : null;
  if (["ceci", "cela", "ça"].includes(subject))
    return (attribute && closes) || /^(?:un|une|le|la|les)$/.test(next.w) ? fix() : null;
  if (subject === "elle" && !opensClause) return null;
  if (subject === "elle") return AFTER_EST.has(next.w) || (attribute && closes) ? fix() : null;
  // "Le garçon et arrivé.": a determiner + noun opening the clause.
  // "Le but et de partir": "de" and an infinitive, the attribute of "est".
  if (before.length === 2 && DETERMINERS.has(before[1].w) && nounLike(subject))
    return AFTER_EST.has(next.w) ||
      (verbReadings(next.w).some((r) => r.slot === "Q") && !nounGender(next.w) && closes) ||
      ((next.w === "de" || next.w === "d'") && !!after[1] && infinitiveOnly(after[1].w))
      ? fix()
      : null;
  return null;
}

const SUBJECT_PRONOUN_WORDS = new Set("je j' tu il elle on nous vous ils elles".split(" "));
// Words that open a clause of their own: "ce qu'il veut est simple", "celui qui part est
// triste", "si tu viens, ..." keep the main verb "est".
const SUBORDINATING = new Set(
  "que qu' qui dont où ce si quand lorsque lorsqu' comme puisque puisqu' quoi lequel laquelle".split(
    " ",
  ),
);

/** "il est marié est a trois enfants", "il partit est ne revint pas" -> "et". */
function estToEt(
  ctx: DetectContext,
  m: RegExpExecArray,
  before: Token[],
  after: Token[],
): RawFinding | null {
  const next = after[0];
  if (
    !next ||
    !before[0] ||
    ["c'", "n'", "qu'", "ce", "qui", "plus", "de", "on", "il", "elle", "tout"].includes(before[0].w)
  )
    return null;
  // "L'aile est n'est que", "la partie est fut": the noun "est" (east).
  if (before[1] && DETERMINERS.has(before[1].w)) return null;
  // "il est agile est grand", "elle a un manteau est des gants": the clause already has its
  // verb, and no relative or subordinate clause gives "est" a subject of its own.
  const clause = tokensBefore(ctx.text, m.index, 12);
  // A coordination or a capital (a sentence run on without its space) also starts afresh.
  const opener = clause.findIndex(
    (t, i) =>
      SUBORDINATING.has(t.w) ||
      ["et", "ou", "mais"].includes(t.w) ||
      (i > 0 && /^\p{Lu}/u.test(ctx.text.slice(t.start, t.end)) && i < clause.length - 1),
  );
  const own = opener < 0 ? clause : clause.slice(0, opener);
  if (
    opener < 0 &&
    // The earlier verb right after its subject pronoun: "il est agile est grand".
    own.some(
      (t, i) =>
        i > 0 &&
        SUBJECT_PRONOUN_WORDS.has(own[i + 1]?.w ?? "") &&
        (t.w === "est" || t.w === "a" || !isVerbHomograph(t.w)) &&
        verbReadings(t.w).some((r) => typeof r.slot === "number"),
    ) &&
    !/^\p{Lu}/u.test(ctx.text.slice(next.start, next.end))
  )
    return wordFinding(ctx, m.index, m[0], ["et"], RULE, MESSAGE, {
      start: before[0].start,
      end: next.end,
    });
  const clitic = ["ne", "n'", "se", "s'"].includes(next.w);
  const verb = clitic ? after[1] : next;
  if (!verb || verb.hyphen || /^\p{Lu}/u.test(ctx.text.slice(verb.start, verb.end))) return null;
  // Only a verb that cannot follow "est": a plural one, or one after ne/se ("est a une cause"
  // reads as "what is has a cause").
  if (!clitic && !/(?:ent|ont)$/.test(verb.w)) return null;
  if (verb.w === "est") return null;
  const readings = verbReadings(verb.w);
  if (!readings.length || !readings.every((r) => typeof r.slot === "number")) return null;
  if (nounLike(verb.w) || adjectiveReadings(verb.w).length) return null;
  return wordFinding(ctx, m.index, m[0], ["et"], RULE, MESSAGE, {
    start: before[0].start,
    end: verb.end,
  });
}

/** "je pense d'avantage à toi" -> "davantage" (more); "tirer avantage" keeps the noun. */
function davantage(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const typed = m[0];
  const before = tokensBefore(ctx.text, m.index, 4);
  const next = tokensAfter(ctx.text, m.index + typed.length, 1)[0];
  if (next && ["sur", "de", "d'", "du", "des", "pour", "fiscal", "concurrentiel"].includes(next.w))
    return null;
  let i = 0;
  while (
    before[i] &&
    ["pas", "plus", "jamais", "rien", "en", "bien", "encore", "beaucoup"].includes(before[i].w)
  )
    i++;
  const verb = before[i];
  if (!verb) return null;
  const readings = verbReadings(verb.w);
  if (!readings.length || readings.some((r) => AVANTAGE_VERBS.has(r.lemma))) return null;
  if (isInflectedNoun(verb.w) && !readings.some((r) => typeof r.slot === "number")) return null;
  // "il n'y a pas d'avantage", "aucun": the noun.
  if (before.some((t) => t.w === "aucun" || t.w === "y")) return null;
  return wordFinding(ctx, m.index, typed, ["davantage"], RULE, MESSAGE, {
    start: verb.start,
    end: m.index + typed.length,
  });
}

/** "quel que soit sa raison" -> "quelle que soit", "quelles que soit ses idées" -> "quels que
 * soient": "quel" and "soit" take the gender and number of the noun. */
function quelQueSoit(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const typed = m[0];
  const after = tokensAfter(ctx.text, m.index + typed.length, 3);
  const det = after[0]?.w;
  const noun = after[1]?.w;
  if (!det || !noun || !DETERMINERS.has(det)) return null;
  const plural = /^(?:les|mes|tes|ses|ces|nos|vos|leurs)$/.test(det);
  let gender: "m" | "f" | null;
  if (/^(?:la|ma|ta|sa|cette)$/.test(det)) gender = "f";
  else if (/^(?:le|ce|cet|un)$/.test(det)) gender = "m";
  else gender = nounGender(plural ? noun.replace(/[sx]$/, "") : noun);
  if (!gender) return null;
  // Coordinated nouns ("sa cause et ses solutions") take the plural: leave them.
  const rest = ctx.text.slice(after[1].end, after[1].end + 60);
  if (/^[^,.;:!?]*[\s  ](?:et|ou)[\s  ]/u.test(rest)) return null;
  const quel = { m: plural ? "quels" : "quel", f: plural ? "quelles" : "quelle" }[gender];
  const right = `${quel} que ${plural ? "soient" : "soit"}`;
  const words = typed.split(/[\s  ]+/u);
  const wanted = right.split(" ");
  if (words.map((w) => w.toLowerCase()).join(" ") === right) return null;
  const cased = /^\p{Lu}/u.test(typed) ? right[0].toUpperCase() + right.slice(1) : right;
  if (ctx.dictionary.has(words[0].toLowerCase()) || wanted.length !== words.length) return null;
  return wordFinding(ctx, m.index, typed, [cased], RULE, MESSAGE, {
    start: m.index,
    end: after[1].end,
  });
}

/** "elle a sept années" -> "ans": an age counts years. */
function ageInYears(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const typed = m.groups!.years;
  const start = m.index + m[0].length - typed.length;
  const before = tokensBefore(ctx.text, m.index, 4).filter(
    (t) =>
      !["maintenant", "déjà", "bientôt", "presque", "environ", "juste", "seulement"].includes(t.w),
  );
  const rest = ctx.text.slice(start + typed.length);
  // "j'ai trois années d'expérience": a span of years, not an age.
  if (!/^[\s  ]*(?:$|[.,;:!?)]|révolu)/u.test(rest)) return null;
  const previous = before[0]?.w ?? "";
  const age =
    verbReadings(previous).some((r) => r.lemma === "avoir" && typeof r.slot === "number") ||
    (previous === "de" && /^âgée?s?$/.test(before[1]?.w ?? ""));
  if (!age) return null;
  return wordFinding(
    ctx,
    start,
    typed,
    [typed.toLowerCase() === "années" ? "ans" : "an"],
    RULE,
    MESSAGE,
    {
      start: m.index,
      end: start + typed.length,
    },
  );
}

const NUMBER_WORDS = new Set(
  (
    "un une deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze quinze seize " +
    "vingt trente quarante cinquante soixante cent mille et"
  ).split(" "),
);
const MULTIPLIERS = new Set("deux trois quatre cinq six sept huit neuf".split(" "));

/** "trois cent timbres" -> "cents", "deux cents trois" -> "cent", "quatre-vingt ans" -> "vingts":
 * a multiplied cent or vingt takes an s only when it ends the number. */
function hundreds(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const typed = m.groups!.unit;
  const start = m.index + m[0].length - typed.length;
  const before = m.groups!.times.toLowerCase();
  if (!MULTIPLIERS.has(before) && before !== "quatre") return null;
  const lower = typed.toLowerCase();
  if ((lower === "vingt" || lower === "vingts") && before !== "quatre") return null;
  const rest = ctx.text.slice(start + typed.length);
  const next = tokensAfter(ctx.text, start + typed.length, 1)[0];
  // A hyphenated number goes on ("quatre-vingt-dix"), a digit or a word continues it.
  if (/^-\p{L}/u.test(rest)) return null;
  const ends = !next || !/^[\s  ]+\p{L}/u.test(rest) || !NUMBER_WORDS.has(next.w);
  const plural = lower.endsWith("s");
  // "deux cents millions": millions and milliards are nouns.
  if (ends === plural) return null;
  if (!ends && plural && next && /^(?:millions?|milliards?)$/.test(next.w)) return null;
  if (!next || !/^[\s  ]+\p{L}/u.test(rest)) return null;
  const fixed = plural ? lower.slice(0, -1) : `${lower}s`;
  return wordFinding(ctx, start, typed, [fixed], RULE, MESSAGE, {
    start: m.index,
    end: next.end,
  });
}

const SMALL =
  /(?<![\p{L}\p{M}\p{N}_'’-])(?:ni|si|ci|sans|mes|mai|mas|dans|dan|leurs|mêmes|et|est|nous|vous|soi|soit)(?![\p{L}\p{M}\p{N}_'’-])/giu;
const DAVANTAGE = /(?<![\p{L}\p{M}\p{N}_-])d['’]avantage(?![\p{L}\p{M}\p{N}_'’-])/giu;
const QUEL_QUE_SOIT =
  /(?<![\p{L}\p{M}\p{N}_'’-])quel(?:le)?s?[ \t]+que[ \t]+soi(?:en)?t(?![\p{L}\p{M}\p{N}_'’-])/giu;

const AGE =
  /(?<![\p{L}\p{M}\p{N}_'’-])(?:\d+|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|vingt|trente|quarante|cinquante|soixante|cent)[ \t]+(?<years>années)(?![\p{L}\p{M}\p{N}_'’-])/giu;

const HUNDREDS =
  /(?<![\p{L}\p{M}\p{N}_'’-])(?<times>\p{L}+)[ \t-]+(?<unit>cents?|vingts?)(?![\p{L}\p{M}\p{N}_'’])/giu;

function smallWords(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "fr") return [];
  const findings: RawFinding[] = [];
  for (const [pattern, check] of [
    [SMALL, smallWord],
    [DAVANTAGE, davantage],
    [QUEL_QUE_SOIT, quelQueSoit],
    [AGE, ageInYears],
    [HUNDREDS, hundreds],
  ] as const) {
    for (const m of ownedFrenchWords(ctx, pattern)) {
      const finding = check(ctx, m);
      if (finding) findings.push(finding);
    }
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: smallWords }];
