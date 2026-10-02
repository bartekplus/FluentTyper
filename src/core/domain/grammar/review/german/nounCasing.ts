import { hasCanonicalCasing } from "../canonicalCasing";
import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  germanAdjective,
  germanInfinitive,
  germanNounOverAdjective,
  germanNounReading,
  germanVerbLike,
  type GermanNounReading,
} from "./germanLexicon";
import { idioms } from "./idioms";
import { names } from "./names";
import { salutationCase } from "./salutations";
import { nominalized } from "./nominalized";
import {
  BOUNDARY,
  englishLine,
  governedBefore,
  isGerman,
  PRONOUNS,
  tokensAfter,
  tokensBefore,
  VERB_GOVERNORS,
  words,
  wordSet,
} from "./shared";

// A lowercase noun after a determiner, a preposition or a number: "der zugriff", "mit
// schnellen schritten", "2 tage". German capitalizes every noun. A word that is also a verb
// form is only flagged where the determiner cannot be a pronoun and the word cannot be the
// verb ("die kosten viel", "das stelle ich", "kannst du das ändern", "von der leben sie").

// Never a pronoun: the genitive article, ein-words and possessives with a short ending, and
// the preposition-article contractions.
export const ARTICLES = wordSet(
  "des ein eine einen einem kein keine keinen keinem keinerlei mein meine meinen meinem dein deine " +
    "deinen deinem sein seine seinen seinem ihre ihren ihrem unser unsere unseren unserem " +
    "euer eure euren eurem am im zum zur beim vom ins ans aufs ums durchs fürs übers " +
    "unters vors hinterm überm unterm",
);
// Articles and demonstratives that also stand alone as pronouns ("die kosten viel").
export const DEMONSTRATIVES = wordSet(
  "der die das den dem dies diese dieser diesen diesem dieses jene jener jenen jenem jenes " +
    "welche welcher welchen welchem welches solche solcher solchen solchem solches",
);
// Determiners that are as often a whole noun phrase: "keiner macht", "alle liefen".
const QUANTIFIERS = wordSet(
  "alle allen aller alles viele vielen vieler einige einigen einiger mehrere mehreren " +
    "beide beiden wenige wenigen andere anderen meisten manche mancher manchen manchem " +
    "manches jede jeder jeden jedem jedes einer eines keiner keines meiner meines deiner " +
    "deines seiner seines ihrer ihres unserer unseres eurer eures ihr",
);
export const PREPOSITIONS = wordSet(
  "in an auf aus bei mit nach von vor zu für gegen ohne durch um über unter hinter neben " +
    "zwischen seit wegen trotz während statt anstatt per pro laut gemäß dank samt bis ab " +
    "außer innerhalb außerhalb oberhalb unterhalb mittels entlang",
);
const NUMBERS = wordSet(
  "zwei drei vier fünf sechs sieben acht neun zehn elf zwölf zwanzig dreißig hundert tausend",
);
// Lowercase words with an adjective ending that are not adjectives.
const NOT_ADJECTIVES = wordSet(
  "gerne alleine lange heute ohne ferne nahe gestern morgen oben unten außen innen hinten " +
    "vorne zusammen trotzdem seitdem außerdem ebenso eben wieder immer nimmer sondern aber " +
    "oder weder später früher näher weiter selten offen gegen neben unter hinter über wider " +
    "bisschen ihnen denen deren dessen wessen habe hatte hätte werde wurde würde wäre sei " +
    "könne müsse solle wolle dürfe möge wisse gebe",
);
// The finite verb after a sentence-initial noun phrase ("Der zugriff wurde …").
const AUXILIARIES = wordSet(
  "ist sind war waren wird werden wurde wurden hat haben hatte hatten kann können konnte " +
    "konnten muss müssen musste mussten soll sollen sollte sollten will wollen wollte " +
    "wollten darf dürfen durfte durften mag möchte möchten würde würden wäre wären sei " +
    "seien hätte hätten bleibt blieb gibt gab",
);
const NOMINALIZING = /(?<![\p{L}\p{N}])(?:beim|zum|vom|ins)[ \t]+$/iu;
const COORDINATORS = wordSet("und oder sowie bzw");
// Genitive determiners after a noun ("der angriff des Gegners"); "der", "meiner" are also
// datives ("Diese stellen meiner Frau Wein").
const GENITIVES = wordSet("des eines meines deines seines unseres eures dieses jenes");
// ", mit dem", ", die", ", wegen der": a relative clause after the noun.
const RELATIVE =
  /^(?:(?:\p{Ll}+ )?(?:der|die|das|dem|den|denen|dessen|deren|welche|welcher|welches|welchem|welchen))(?: |$)/u;
const DEGREE_WORDS = wordSet("wirklich sehr ganz ziemlich besonders äußerst echt total so recht");
const CLAUSE_LINKS = wordSet(
  "und oder aber denn doch sondern dass weil ob wenn als obwohl damit bevor nachdem " +
    "während bis falls sobald solange da wie wo was wer sodass",
);
// Fixed phrases with a lowercase word that is no noun there.
const IDIOMS = /^(?:kreuz und quer|sage und schreibe|zeit (?:seines|ihres|meines|deines))\b/iu;

const lower = (token: string | undefined) => token?.toLowerCase() ?? "";
const isAdjective = (token: string) =>
  /^\p{Ll}{2,}(?:e|en|er|es|em)$/u.test(token) &&
  !NOT_ADJECTIVES.has(token) &&
  !ARTICLES.has(token) &&
  !DEMONSTRATIVES.has(token) &&
  !QUANTIFIERS.has(token) &&
  germanNounReading(token) === null &&
  !germanVerbLike(token);
/** An adjective after the word, so the word is no noun head ("das alte Haus"). */
const attributive = (word: string) => {
  if (!isAdjective(word) || PREPOSITIONS.has(word)) return false;
  const stem = word.replace(/(?:e|en|er|es|em)$/, "");
  if (germanAdjective(stem) || germanAdjective(`${stem}e`)) return true;
  // Unknown: a participle or other verb form is no attributive adjective ("gelaufen").
  return !/^(?:ge|er|ver|be|ent|zer)\p{Ll}+en$/u.test(word);
};
// A finite verb after a word: an auxiliary or a present or past form of a known verb
// ("lebt", "ändert", "machte").
const finiteVerb = (word: string) =>
  AUXILIARIES.has(word) ||
  VERB_GOVERNORS.has(word) ||
  (!PREPOSITIONS.has(word) &&
    !ARTICLES.has(word) &&
    !DEMONSTRATIVES.has(word) &&
    germanNounReading(word) !== "noun" &&
    (germanVerbLike(word) ||
      (/^\p{Ll}{2,}e?t$/u.test(word) &&
        [`${word.replace(/e?t$/, "")}en`, `${word.replace(/t$/, "")}n`].some(germanInfinitive))));
// Genitive or dative determiners after a noun ("die Grenzen meiner Sprache").
const GENITIVE_LIKE = wordSet(
  "von vom der des dieser dieses jener jenes meiner meines deiner deines seiner seines ihrer ihres " +
    "unserer unseres eurer eures einer eines",
);
/** "der Waffe waren", "meiner Sprache sind": a genitive phrase, then the clause's verb. */
function genitiveThenVerb(after: string[]): boolean {
  if (!GENITIVE_LIKE.has(lower(after[0]))) return false;
  let i = 1;
  while (i < after.length - 1 && isAdjective(lower(after[i]))) i++;
  return /^\p{Lu}\p{Ll}/u.test(after[i] ?? "") && finiteVerb(lower(after[i + 1]));
}
// Particles that open a separable verb: its finite form only ends a clause ("als er angriff").
const PARTICLE =
  /^(?:an|auf|aus|ab|ein|mit|nach|vor|zu|zurück|weg|bei|los|fest|hin|her)(?=\p{Ll}{3})/u;

type Trigger = "article" | "demonstrative" | "quantifier" | "preposition" | "number";

/** The determiner, preposition or number before the word, across up to two adjectives. */
function trigger(before: string[]): { kind: Trigger; at: number } | null {
  let adjectives = false;
  for (let i = before.length - 1; i >= Math.max(0, before.length - 3); i--) {
    const token = before[i];
    const low = token.toLowerCase();
    const prior = lower(before[i - 1]);
    // Capitalized inside a sentence: a noun ("Zum Sein bedarf es Mut").
    if (token !== low && i > 0 && !BOUNDARY.test(before[i - 1])) return null;
    if (/^\p{N}+$/u.test(token) || NUMBERS.has(low)) {
      // "nach drei tagen", "die zwei wochen": counted, so a noun.
      const counted = PREPOSITIONS.has(prior) || ARTICLES.has(prior) || DEMONSTRATIVES.has(prior);
      return { kind: counted ? "article" : "number", at: i };
    }
    // "ich meine, …": the verb.
    if (ARTICLES.has(low) && !(/^(?:ich|wir|sie)$/.test(prior) && /^meinen?$/.test(low))) {
      return { kind: "article", at: i };
    }
    // After a preposition or an adjective, a demonstrative is an article: "für die kosten".
    const article = adjectives || PREPOSITIONS.has(prior);
    if (DEMONSTRATIVES.has(low)) return { kind: article ? "article" : "demonstrative", at: i };
    if (QUANTIFIERS.has(low)) return { kind: article ? "article" : "quantifier", at: i };
    if (PREPOSITIONS.has(low)) {
      // "nach wie vor erscheinen"
      return low === "vor" && prior === "wie" ? null : { kind: "preposition", at: i };
    }
    // "ein wirklich merkwürdiges verhalten": a degree word before the adjective.
    if (adjectives && DEGREE_WORDS.has(token)) continue;
    // "Der schnelle anstieg": an adjective that is also a verb form, right after an article.
    const lemma =
      ARTICLES.has(prior) || DEMONSTRATIVES.has(prior) ? low.replace(/(?:e|en|er|es|em)$/, "") : "";
    if (token !== low || !(isAdjective(low) || (lemma !== low && germanAdjective(lemma))))
      return null;
    adjectives = true;
  }
  return null;
}

/** Whether a word that is also a verb form reads as the noun here. */
function nounReadingHolds(
  reading: Exclude<GermanNounReading, "noun">,
  typed: string,
  kind: Trigger,
  before: string[],
  at: number,
  after: string[],
): boolean {
  const next = lower(after[0]);
  const prior = before[at - 1];
  if (typed === "bitte" && kind !== "article") return false;
  // "die beide passen", ", die kosten": a pronoun, or a relative pronoun.
  if (kind === "demonstrative" && prior !== undefined && /^[,;:(–—-]$/.test(prior)) return false;
  const clauseStart =
    prior === undefined || BOUNDARY.test(prior) || CLAUSE_LINKS.has(prior.toLowerCase());
  const determiner = kind === "article" || kind === "demonstrative";
  // "Die grenzen meiner Sprache", "Das gerät, mit dem …": a genitive or a relative clause.
  const relative = next === "," && RELATIVE.test(after.slice(1, 3).join(" "));
  if (determiner && (GENITIVES.has(next) || relative)) return true;
  const det = lower(before[at]);
  // ", in dem leben viele": a relative pronoun after its preposition, then the verb.
  if (
    before[at - 2] === "," &&
    PREPOSITIONS.has(lower(before[at - 1])) &&
    /^(?:der|die|das|dem|den|denen|welche[mnrs]?)$/.test(det)
  ) {
    return false;
  }
  // "Die klingen der Waffe waren", "Die grenzen meiner Sprache sind": a genitive, then the verb.
  if (determiner && clauseStart && genitiveThenVerb(after)) return true;
  // "Dieser angriff kommt", "der anstieg der Zahl": a separable verb's finite form only ends a
  // clause.
  const separable = PARTICLE.exec(typed);
  if (
    determiner &&
    reading === "finite" &&
    separable &&
    !(BOUNDARY.test(next) || COORDINATORS.has(next))
  ) {
    return true;
  }
  // "die rolle", "mehrere versuche": a first-person form cannot follow a third-person or plural
  // pronoun ("das sage ich" has its subject after it).
  if (
    reading === "finite" &&
    /[^t]e$/.test(typed) &&
    /^(?:die|der|diese|dieser|mehrere|viele|einige|alle|beide|wenige|manche)$/.test(det)
  ) {
    return true;
  }
  // "In den räumen wurde": a preposition and its article open the sentence, so no relative
  // clause ("…, in dem leben viele") follows.
  if (
    kind === "article" &&
    PREPOSITIONS.has(lower(before[at - 1])) &&
    (at < 2 || /^(?:[.!?\n„“"»«])$/.test(before[at - 2]))
  ) {
    return true;
  }
  // "Ihre aussagen sind falsch", "Diese blasen platzen": the noun phrase opens the
  // sentence and its verb follows; not "Die würden glauben", "Diese stellen einen Teil",
  // "Ihr fahrt schwimmen?".
  const sentenceStart = prior === undefined || /^(?:[.!?\n„“"»«])$/.test(prior);
  const pronounLike = (w: string) =>
    ARTICLES.has(w) || DEMONSTRATIVES.has(w) || QUANTIFIERS.has(w) || PRONOUNS.has(w);
  if (
    determiner &&
    sentenceStart &&
    lower(before[at]) !== "ihr" &&
    !VERB_GOVERNORS.has(typed) &&
    !pronounLike(next) &&
    next !== typed &&
    finiteVerb(next)
  ) {
    return true;
  }
  if (kind === "quantifier" || (kind === "demonstrative" && clauseStart)) {
    // "Die kosten sind hoch", "Das ende des Films".
    return AUXILIARIES.has(next) || next === "des";
  }
  if (kind === "number") return reading === "finite" && /(?:e|en|er|n|s)$/.test(typed);
  if (reading === "finite") return true;
  if (kind === "preposition" && lower(before[at]) === "zu") return false;
  // "wenn man eine stellen darf", "ich möchte das öffnen können": a verb chain.
  if (VERB_GOVERNORS.has(next)) return false;
  return !(BOUNDARY.test(next) || COORDINATORS.has(next)) || !governedBefore(before, at);
}

/**
 * Whether a noun that is also an adjective form ("alter", "spitze") reads as the noun: after an
 * article that is no pronoun ("das hohe alter", "auf die spitze"), or a sentence-opening one
 * before its verb or a genitive, with no noun or adjective after it ("das alte Haus").
 */
function adjectiveNounHolds(kind: Trigger, before: string[], at: number, after: string[]) {
  const next = lower(after[0]);
  const prior = before[at - 1];
  const sentenceStart = prior === undefined || /^(?:[.!?\n„“"»«])$/.test(prior);
  if (kind === "demonstrative") {
    const verbFollows = finiteVerb(next) || GENITIVES.has(next) || genitiveThenVerb(after);
    if (!sentenceStart || !verbFollows) return false;
  } else if (kind !== "article") return false;
  // "über alles liebe": a pronoun, not an article.
  const det = lower(before[at]);
  if (!ARTICLES.has(det) && !DEMONSTRATIVES.has(det)) return false;
  if (BOUNDARY.test(next) || COORDINATORS.has(next) || VERB_GOVERNORS.has(next)) return true;
  if (ARTICLES.has(next) || DEMONSTRATIVES.has(next) || PREPOSITIONS.has(next)) return true;
  return (
    /^\p{Ll}/u.test(next) &&
    !germanAdjective(next) &&
    !attributive(next) &&
    germanNounReading(next) !== "noun"
  );
}

function nounCasing(ctx: DetectContext): RawFinding[] {
  if (!isGerman(ctx)) return [];
  const findings: RawFinding[] = [];
  for (const m of words(ctx)) {
    const typed = m[0];
    if (!/^\p{Ll}/u.test(typed) || typed.length < 3 || NUMBERS.has(typed)) continue;
    // "beim laufen", "zum verzweifeln": an infinitive after these is always a noun.
    const reading =
      germanNounReading(typed) ??
      (NOMINALIZING.test(ctx.text.slice(Math.max(0, m.index - 8), m.index)) &&
      germanInfinitive(typed) &&
      !ARTICLES.has(typed) &&
      !QUANTIFIERS.has(typed)
        ? "noun"
        : germanNounOverAdjective(typed)
          ? "adjective"
          : null);
    if (!reading || ctx.dictionary.has(typed) || hasCanonicalCasing(typed)) continue;
    const end = m.index + typed.length;
    // Glued to a hyphen, apostrophe or slash; an abbreviation ("den sog. Strudel").
    if (/^[-'’/]/.test(ctx.text[end] ?? "") || (typed === "sog" && ctx.text[end] === ".")) {
      continue;
    }
    const before = tokensBefore(ctx.text, m.index, 12);
    const found = trigger(before);
    if (!found) continue;
    const after = tokensAfter(ctx.text, end, 6);
    const next = after[0] ?? "";
    // "für strafentlassene, obdachlose oder …": one of several adjectives.
    if ((next === "," || COORDINATORS.has(next)) && attributive(lower(after[1]))) continue;
    // "von der leben sie", "mit der bürste ich": a verb; "in der marine Lebensformen",
    // "von 2008 grad 100": an attribute.
    if (PRONOUNS.has(next.toLowerCase()) || /^\p{N}/u.test(next)) continue;
    // "eine zwiebeln zu dürfen": a verb before its zu-infinitive.
    if (next === "zu" && VERB_GOVERNORS.has(lower(after[1]))) continue;
    // A capitalized word after it ("in der marine Lebensformen"), but not an acronym
    // ("im dritten schritt POS-Tags").
    const nextFirst = next.split("-")[0];
    if (/^\p{Lu}/u.test(next) && nextFirst !== nextFirst.toUpperCase()) continue;
    if (IDIOMS.test(ctx.text.slice(m.index, m.index + 24))) continue;
    if (reading === "adjective") {
      if (!adjectiveNounHolds(found.kind, before, found.at, after)) continue;
    } else if (
      reading !== "noun" &&
      (attributive(next) || !nounReadingHolds(reading, typed, found.kind, before, found.at, after))
    ) {
      continue;
    }
    if (namedExampleBefore(ctx.text, m.index) || englishLine(ctx.text, m.index)) continue;
    findings.push({
      ruleId: "germanNounCasing",
      messageKey: "review_msg_german_noun_case",
      range: { start: m.index, end: m.index + 1 },
      alternatives: [typed[0].toUpperCase()],
      context: { start: Math.max(0, m.index - 40), end },
    });
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: ["germanNounCasing"],
    detect: (ctx) => [
      ...nounCasing(ctx),
      ...nominalized(ctx),
      ...idioms(ctx),
      ...names(ctx),
      ...salutationCase(ctx),
    ],
  },
];
