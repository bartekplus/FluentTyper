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
  CLITICS,
  ownedFrenchWords,
  tokensAfter,
  tokensBefore,
  wordFinding,
  type Token,
} from "./frenchTokens";
import { isLang } from "../phraseTemplates";
import { namedExampleBefore } from "../exampleCues";
import { finding } from "../finding";

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
  if (lower === "sois" || lower === "soie") return soisSoie(ctx, m, before, next);
  // "çà" only stands in "çà et là"; alone it is the pronoun "ça".
  if (lower === "çà")
    return next?.w === "et" ? null : wordFinding(ctx, m.index, typed, ["ça"], RULE, MESSAGE);
  if (lower === "ci" || lower === "si") {
    const found = demonstrativeCi(ctx, m, before, next);
    if (found) return found;
  }
  if (!next) return null;
  const n = next.w;
  // "il ni arrive pas" -> "n'y"; "il si prend bien", "on ci sent bien" -> "s'y"; "il sans va",
  // "il c'en rend compte" -> "s'en".
  if (previous && SUBJECTS.has(previous) && verbOnly(n) && !/^\p{Lu}/u.test(typed.slice(1))) {
    if (lower === "ni") return fix("n'y");
    if ((lower === "si" || lower === "ci") && THIRD.has(previous)) return fix("s'y");
    if (lower === "sans" && THIRD.has(previous)) return fix("s'en");
  }
  if (lower === "ci") {
    if (ctx.text[m.index - 1] === "-" || ctx.text[m.index + 2] === "-") return null;
    // "il venait ci souvent", "je ne sais pas ci c'est possible": "si" misspelt. "comme ci
    // comme ça" and "de ci de là" keep it; a noun before it may want "-ci".
    const adverb = ["pas", "plus", "jamais", "et", "mais"].includes(previous ?? "");
    if (previous && !adverb && (["comme", "de", "par"].includes(previous) || nounLike(previous)))
      return null;
    if (previous && !adverb && !finite(previous)) return null;
    return fix("si");
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

const DEMONSTRATIVES = new Set(["ce", "cet", "cette", "ces"]);
const DEMONSTRATIVE_PRONOUNS = new Set(["celui", "celle", "ceux", "celles"]);

/** "cette voiture ci" -> "voiture-ci", "celui si" -> "celui-ci": the demonstrative's "-ci". */
function demonstrativeCi(
  ctx: DetectContext,
  m: RegExpExecArray,
  before: Token[],
  next: Token | undefined,
): RawFinding | null {
  const head = before[0];
  if (!head || ctx.text[m.index - 1] === "-" || ctx.text[m.index + 2] === "-") return null;
  if (namedExampleBefore(ctx.text, m.index)) return null;
  const pronoun = DEMONSTRATIVE_PRONOUNS.has(head.w);
  if (pronoun) {
    // "celui si cher": "si" before an adjective or an adverb is the degree word.
    if (m[0].toLowerCase() === "si" && next && !finite(next.w)) return null;
  } else {
    if (m[0].toLowerCase() !== "ci" || !nounLike(head.w)) return null;
    if (!before.slice(1, 3).some((t) => DEMONSTRATIVES.has(t.w))) return null;
  }
  const typedHead = ctx.text.slice(head.start, head.end);
  return finding(RULE, MESSAGE, head.start, m.index + m[0].length, [`${typedHead}-ci`]);
}

/** "je vais sois à la plage ou" -> "soit", "les contenus soie appropriés" -> "soient". */
function soisSoie(
  ctx: DetectContext,
  m: RegExpExecArray,
  before: Token[],
  next: Token | undefined,
): RawFinding | null {
  const previous = before[0];
  if (!previous || !next) return null;
  const typed = m[0].toLowerCase();
  if (typed === "sois") {
    // "que je sois", "ne sois pas", "et sois sage": a subject or an order keeps it.
    if (!verbReadings(previous.w).length || isVerbHomograph(previous.w)) return null;
    if (["je", "tu", "ne", "n'", "et", "mais", "ou", "donc"].includes(previous.w)) return null;
    return wordFinding(ctx, m.index, m[0], ["soit"], RULE, MESSAGE);
  }
  // "soie" (silk) is a noun: after a noun and before an adjective it is "soit".
  if (!nounLike(previous.w) || finite(previous.w) || DETERMINERS.has(previous.w)) return null;
  if (!adjectiveReadings(next.w).length && !verbReadings(next.w).some((r) => r.slot === "Q"))
    return null;
  if (nounLike(next.w) && !adjectiveReadings(next.w).length) return null;
  const plural = /[sx]$/.test(previous.w);
  return wordFinding(ctx, m.index, m[0], [plural ? "soient" : "soit"], RULE, MESSAGE);
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
    // "il faut soi partir, soit rester": the "soit ... soit" choice before an infinitive or a
    // noun phrase; "cette soirée soi mémorable": the verb between a noun and its attribute.
    if (!previous || !next) return null;
    const choice =
      finite(previous) &&
      !isVerbHomograph(previous) &&
      (infinitiveOnly(next.w) || DETERMINERS.has(next.w));
    const attribute =
      nounLike(previous) &&
      !finite(previous) &&
      !DETERMINERS.has(previous) &&
      (adjectiveReadings(next.w).length > 0 || isInflectedNoun(next.w)) &&
      !nounGender(next.w) &&
      !finite(next.w);
    if (choice || attribute) return fix("soit");
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
// triste", "si tu viens, ..." keep the main verb "est"; so does an indirect question ("je sais
// quel est le problème").
const SUBORDINATING = new Set(
  (
    "que qu' qui dont où ce si quand lorsque lorsqu' comme puisque puisqu' quoi lequel laquelle " +
    "quel quelle quels quelles comment pourquoi combien"
  ).split(" "),
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

// "croître" (to grow) has no object and takes no "que", no infinitive and no "à" + a noun:
// those read "croire" (to believe). "il ne croît rien" -> "croit", "je te croîs" -> "crois".
const GROW_TO_BELIEVE: Record<string, string> = {
  croît: "croit",
  croîs: "crois",
  crût: "crut",
  crûs: "crus",
  crû: "cru",
};
const BELIEF_OBJECTS = new Set(
  "que qu' rien cela ça ceci le la les l' ce cet cette ces mon ma mes ton ta tes son sa ses notre nos votre vos leur leurs".split(
    " ",
  ),
);
const OBJECT_CLITICS = new Set("me m' te t' le la les l' en".split(" "));
// "croît la nuit", "croît cette année": a time, not an object.
const TIMES = new Set(
  "nuit jour jours matin soir an ans année années hiver été printemps automne saison semaine mois siècle".split(
    " ",
  ),
);
const RELATIVE_BELIEF = new Set(["auquel", "auxquels", "auxquelles", "laquelle", "quoi"]);
const AFTER_VERB = new Set(
  "ne n' pas plus jamais guère point vraiment bien aussi même toujours encore donc".split(" "),
);

function growToBelieve(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const typed = m[0];
  const lower = typed.toLowerCase();
  const before = tokensBefore(ctx.text, m.index, 6);
  let k = 0;
  while (before[k] && (before[k].w === "ne" || before[k].w === "n'")) k++;
  // "j'ai crû" is the participle: only with avoir before it.
  if (lower === "crû" && !verbReadings(before[k]?.w ?? "").some((r) => r.lemma === "avoir"))
    return null;
  // "bien qu'il crût": the imperfect subjunctive of croire keeps its accent.
  if (lower === "crût" && before.some((t) => t.w === "que" || t.w === "qu'")) return null;
  const end = m.index + typed.length;
  const fix = () =>
    wordFinding(ctx, m.index, typed, [GROW_TO_BELIEVE[lower]], RULE, MESSAGE, {
      start: before.at(-1)?.start ?? m.index,
      end,
    });
  // "je te croîs", "si l'on en croît": an object pronoun before the verb.
  if (before[k] && OBJECT_CLITICS.has(before[k].w) && before[k + 1]) return fix();
  // "ce en quoi il croît", "les paroles auxquelles il croît".
  if (before[k + 1] && RELATIVE_BELIEF.has(before[k + 1].w)) return fix();
  // "Croîs-moi", "croît-on cela": an imperative or an inverted subject with an object.
  const after = tokensAfter(ctx.text, end, 4);
  let j = 0;
  if (ctx.text[end] === "-") {
    if (["moi", "nous", "le", "la", "les"].includes(after[0]?.w ?? "")) return fix();
    j = 1;
  }
  while (after[j] && AFTER_VERB.has(after[j].w)) j++;
  const next = after[j];
  if (!next) return null;
  const typedNext = ctx.text.slice(next.start, next.end);
  const name = /^\p{Lu}/u.test(typedNext);
  const second = after[j + 1]?.w ?? "";
  if (TIMES.has(second)) return null;
  // "il croit dur comme fer".
  if (next.w === "dur" && second === "comme") return fix();
  const infinitive = verbReadings(next.w).some((r) => r.slot === "I" && r.lemma === next.w);
  // "croît à ces propos" believes; "croît à 10 mètres" grows.
  const toNoun =
    (next.w === "à" || next.w === "au" || next.w === "aux") &&
    !!after[j + 1] &&
    !/^\d/.test(ctx.text.slice(after[j + 1].start, after[j + 1].end));
  if (BELIEF_OBJECTS.has(next.w) || name || toNoun || (infinitive && !isInflectedNoun(next.w)))
    return fix();
  return null;
}

/** "il n'a qua partir" -> "qu'à", "pour qu'a la fin" -> "qu'à": "que" and the preposition. */
function quToQuA(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const typed = m[0];
  const before = tokensBefore(ctx.text, m.index, 1)[0];
  const next = tokensAfter(ctx.text, m.index + typed.length, 1)[0];
  if (!next || /^\p{Lu}/u.test(ctx.text.slice(next.start, next.end))) return null;
  const participle = verbReadings(next.w).some((r) => r.slot === "Q");
  if (/^qua$/i.test(typed)) {
    // "sine qua non": Latin.
    if (before?.w === "sine") return null;
    return wordFinding(ctx, m.index, typed, [participle ? "qu'a" : "qu'à"], RULE, MESSAGE);
  }
  // "pour qu'a" + a noun phrase: "pour que" takes no indicative "a".
  if (!before || !["pour", "afin", "plutôt"].includes(before.w) || participle) return null;
  if (!/^(?:la|le|les|l'|un|une|ce|cette|ces|mon|ma|ton|ta|son|sa|nos|vos|leur|\d)/u.test(next.w))
    return null;
  return wordFinding(ctx, m.index, typed, [`${typed.slice(0, 3)}à`], RULE, MESSAGE, {
    start: before.start,
    end: next.end,
  });
}

// The subjunctive of avoir in a sentence with no "que" or relative to govern it is the
// indicative that sounds alike: "il ait venu" -> "est", "j'aie fini" -> "ai".
const INDICATIVE: Record<string, [string, string]> = {
  aie: ["ai", "suis"],
  aies: ["as", "es"],
  ait: ["a", "est"],
  aient: ["ont", "sont"],
};
const SUBJECTS_OF: Record<string, readonly string[]> = {
  aie: ["je", "j'"],
  aies: ["tu"],
  ait: ["il", "elle", "on"],
  aient: ["ils", "elles"],
};
// Verbs that take être: "il est venu", not "il a venu".
const ETRE_VERBS = new Set(
  (
    "aller venir partir arriver naître mourir rester tomber entrer sortir monter descendre " +
    "retourner devenir revenir rentrer décéder parvenir intervenir survenir"
  ).split(" "),
);
const GOVERNORS =
  /(?<![\p{L}\p{M}])(?:(?:que|quoique|qui|dont|où|quoi|soit|plaise)(?![\p{L}\p{M}])|(?:qu|quoiqu)['’])/iu;

function mainClauseAvoir(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const typed = m[0];
  const lower = typed.toLowerCase();
  const lead = /[^.!?…;:\n«"“]*$/u.exec(ctx.text.slice(Math.max(0, m.index - 300), m.index))![0];
  if (GOVERNORS.test(lead)) return null;
  const before = tokensBefore(ctx.text, m.index, 6);
  let k = 0;
  while (before[k] && (before[k].w === "ne" || before[k].w === "n'" || CLITICS.has(before[k].w)))
    k++;
  // A pronoun subject of the same person ("N'aie pas peur" is the imperative).
  if (!before[k] || !SUBJECTS_OF[lower].includes(before[k].w)) return null;
  if (namedExampleBefore(ctx.text, m.index)) return null;
  const after = tokensAfter(ctx.text, m.index + typed.length, 4);
  let j = 0;
  while (after[j] && SKIPPED_AFTER.has(after[j].w)) j++;
  const next = after[j];
  const [have, be] = INDICATIVE[lower];
  let alternatives = [have, be];
  if (next) {
    const participle = verbReadings(next.w).find((r) => r.slot === "Q");
    // "il ait parti" -> "est"; "il ait affiché" may be a passive ("il est affiché"): both.
    if (participle && ETRE_VERBS.has(participle.lemma)) alternatives = [be];
    else if (DETERMINERS.has(next.w)) alternatives = [have];
  }
  return wordFinding(ctx, m.index, typed, alternatives, RULE, MESSAGE, {
    start: before[k].start,
    end: (next ?? after[0])?.end ?? m.index + typed.length,
  });
}
const SKIPPED_AFTER = new Set(
  "pas plus jamais rien point guère déjà bien toujours souvent vraiment aussi encore tout".split(
    " ",
  ),
);

// Words after which "qu'elle" opens a clause: "afin qu'elle", "dès qu'elle".
const QUELLE_OPENERS = new Set("afin pour dès bien sans avant pendant parce alors".split(" "));
const QUELLE_FORMS: Record<string, string[]> = {
  quel: ["qu'elle", "qu'il"],
  quelle: ["qu'elle"],
  quels: ["qu'ils", "qu'elles"],
  quelles: ["qu'elles"],
};
const QUELLE_VERBS = new Set("a est sont ont soit soient fait était sera".split(" "));
const OBJECT_CLITICS_AFTER = new Set(
  "ne n' me m' te t' se s' le la les l' lui leur y en".split(" "),
);

/** "il pense quelle a menti", "dès quel ouvre la porte": "qu'elle" before a verb. "Il se demande
 * quelle est la date" (an indirect question) keeps "quelle". */
function quelleForQuElle(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const lower = m[0].toLowerCase();
  const previous = tokensBefore(ctx.text, m.index, 1)[0];
  if (!previous) return null;
  const opener =
    QUELLE_OPENERS.has(previous.w) ||
    (ctx.text[previous.start - 1] === "-" && previous.w === "ce") ||
    (!isVerbHomograph(previous.w) &&
      verbReadings(previous.w).some((r) => typeof r.slot === "number"));
  if (!opener) return null;
  const after = tokensAfter(ctx.text, m.index + m[0].length, 6);
  let j = 0;
  while (after[j] && OBJECT_CLITICS_AFTER.has(after[j].w)) j++;
  const verb = after[j];
  // "a", "est", "soit", "fait" are verbs as often as nouns there.
  if (!verb || verb.hyphen || (isVerbHomograph(verb.w) && !QUELLE_VERBS.has(verb.w))) return null;
  const readings = verbReadings(verb.w).filter((r) => typeof r.slot === "number");
  if (!readings.length) return null;
  let k = j + 1;
  while (after[k] && SKIPPED_AFTER.has(after[k].w)) k++;
  const next = after[k];
  // "quelle est la date", "quelle a été ta réaction": an indirect question before a noun.
  if (readings.some((r) => r.lemma === "être" || r.lemma === "avoir")) {
    if (!next || DETERMINERS.has(next.w) || next.w === "été" || isInflectedNoun(next.w)) {
      const describes =
        next &&
        (adjectiveReadings(next.w).length > 0 || verbReadings(next.w).some((r) => r.slot === "Q"));
      if (!describes || DETERMINERS.has(next.w) || next.w === "été") return null;
    }
  }
  if (namedExampleBefore(ctx.text, m.index)) return null;
  return wordFinding(ctx, m.index, m[0], QUELLE_FORMS[lower], RULE, MESSAGE, {
    start: previous.start,
    end: verb.end,
  });
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
  /(?<![\p{L}\p{M}\p{N}_'’-])(?:ni|si|ci|sans|mes|mai|mas|dans|dan|leurs|mêmes|et|est|nous|vous|soi|soit|sois|soie|çà)(?![\p{L}\p{M}\p{N}_'’-])/giu;
const DAVANTAGE = /(?<![\p{L}\p{M}\p{N}_-])d['’]avantage(?![\p{L}\p{M}\p{N}_'’-])/giu;
const QUEL_QUE_SOIT =
  /(?<![\p{L}\p{M}\p{N}_'’-])quel(?:le)?s?[ \t]+que[ \t]+soi(?:en)?t(?![\p{L}\p{M}\p{N}_'’-])/giu;

const AGE =
  /(?<![\p{L}\p{M}\p{N}_'’-])(?:\d+|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|vingt|trente|quarante|cinquante|soixante|cent)[ \t]+(?<years>années)(?![\p{L}\p{M}\p{N}_'’-])/giu;

const HUNDREDS =
  /(?<![\p{L}\p{M}\p{N}_'’-])(?<times>\p{L}+)[ \t-]+(?<unit>cents?|vingts?)(?![\p{L}\p{M}\p{N}_'’])/giu;

const CROITRE = /(?<![\p{L}\p{M}\p{N}_'’-])cr(?:oî[st]|û[st]?)(?![\p{L}\p{M}\p{N}_'’])/giu;

const QUA = /(?<![\p{L}\p{M}\p{N}_'’-])qu(?:['’]a|a)(?![\p{L}\p{M}\p{N}_'’-])/giu;
const SUBJUNCTIVE_AVOIR =
  /(?<![\p{L}\p{M}\p{N}_-])(?:aie|aies|ait|aient)(?![\p{L}\p{M}\p{N}_'’-])/giu;

const QUELLE = /(?<![\p{L}\p{M}\p{N}_'’-])quel(?:le)?s?(?![\p{L}\p{M}\p{N}_'’-])/giu;

function smallWords(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "fr")) return [];
  const findings: RawFinding[] = [];
  for (const [pattern, check] of [
    [SMALL, smallWord],
    [DAVANTAGE, davantage],
    [QUEL_QUE_SOIT, quelQueSoit],
    [AGE, ageInYears],
    [HUNDREDS, hundreds],
    [CROITRE, growToBelieve],
    [QUA, quToQuA],
    [SUBJUNCTIVE_AVOIR, mainClauseAvoir],
    [QUELLE, quelleForQuElle],
  ] as const) {
    for (const m of ownedFrenchWords(ctx, pattern)) {
      const finding = check(ctx, m);
      if (finding) findings.push(finding);
    }
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: smallWords }];
