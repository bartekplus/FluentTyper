import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { adjectiveReadings, isInflectedNoun, nounGender, verbReadings } from "./frenchLexicon";
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
const nounLike = (word: string) =>
  isInflectedNoun(word) || isInflectedNoun(word.replace(/[sx]$/, "")) || !!nounGender(word);
const verbOnly = (word: string) => !nounLike(word) && finite(word);
const infinitiveOnly = (word: string) =>
  !nounGender(word) && verbReadings(word).some((r) => r.slot === "I");

function smallWord(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const typed = m[0];
  const lower = typed.toLowerCase().replace("’", "'");
  const before = tokensBefore(ctx.text, m.index, 3);
  const after = tokensAfter(ctx.text, m.index + typed.length, 3);
  const previous = before[0]?.w;
  const next = after[0];
  const fix = (alt: string, end = next?.end ?? m.index + typed.length) =>
    wordFinding(ctx, m.index, typed, [alt], RULE, MESSAGE, {
      start: before[0]?.start ?? m.index,
      end,
    });
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
  if (before.length === 2 && DETERMINERS.has(before[1].w) && nounLike(subject))
    return AFTER_EST.has(next.w) ||
      (verbReadings(next.w).some((r) => r.slot === "Q") && !nounGender(next.w) && closes)
      ? fix()
      : null;
  return null;
}

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

const SMALL =
  /(?<![\p{L}\p{M}\p{N}_'’-])(?:ni|si|ci|sans|mes|mai|mas|dans|dan|leurs|mêmes|et|est)(?![\p{L}\p{M}\p{N}_'’-])/giu;
const DAVANTAGE = /(?<![\p{L}\p{M}\p{N}_-])d['’]avantage(?![\p{L}\p{M}\p{N}_'’-])/giu;
const QUEL_QUE_SOIT =
  /(?<![\p{L}\p{M}\p{N}_'’-])quel(?:le)?s?[ \t]+que[ \t]+soi(?:en)?t(?![\p{L}\p{M}\p{N}_'’-])/giu;

const AGE =
  /(?<![\p{L}\p{M}\p{N}_'’-])(?:\d+|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|vingt|trente|quarante|cinquante|soixante|cent)[ \t]+(?<years>années)(?![\p{L}\p{M}\p{N}_'’-])/giu;

function smallWords(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "fr") return [];
  const findings: RawFinding[] = [];
  for (const [pattern, check] of [
    [SMALL, smallWord],
    [DAVANTAGE, davantage],
    [QUEL_QUE_SOIT, quelQueSoit],
    [AGE, ageInYears],
  ] as const) {
    for (const m of ownedFrenchWords(ctx, pattern)) {
      const finding = check(ctx, m);
      if (finding) findings.push(finding);
    }
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: smallWords }];
