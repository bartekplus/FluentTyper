import { hasCanonicalCasing } from "../canonicalCasing";
import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  germanInfinitive,
  germanNounReading,
  germanVerbLike,
  type GermanNounReading,
} from "./germanLexicon";
import { nominalized } from "./nominalized";
import { BOUNDARY, isGerman, tokensAfter, tokensBefore, words, wordSet } from "./shared";

// A lowercase noun after a determiner, a preposition or a number: "der zugriff", "mit
// schnellen schritten", "2 tage". German capitalizes every noun. A word that is also a verb
// form is only flagged where the determiner cannot be a pronoun and the word cannot be the
// verb ("die kosten viel", "das stelle ich", "kannst du das ändern", "von der leben sie").

// Never a pronoun: the genitive article, ein-words and possessives with a short ending, and
// the preposition-article contractions.
export const ARTICLES = wordSet(
  "des ein eine einen einem kein keine keinen keinem mein meine meinen meinem dein deine " +
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
// Verbs that close a clause with a bare infinitive or a participle ("kannst du das ändern",
// "diese habe ergeben").
const VERB_GOVERNORS = wordSet(
  "kann kannst können könnt konnte konnten könnte könnten muss musst müssen müsst musste " +
    "mussten müsste müssten soll sollst sollen sollt sollte sollten will willst wollen " +
    "wollt wollte wollten darf darfst dürfen dürft durfte durften dürfte dürften mag " +
    "möchte möchtest möchten werde wirst wird werden werdet würde würdest würden wurde " +
    "wurden worden lass lasse lässt lassen ließ tu tue tut tun brauchst braucht brauchen " +
    "habe hast hat haben habt hatte hatten hätte hätten bin bist ist sind seid war waren " +
    "wäre wären sei",
);
const NOMINALIZING = /(?<![\p{L}\p{N}])(?:beim|zum|vom|ins)[ \t]+$/iu;
const COORDINATORS = wordSet("und oder sowie bzw");
const PRONOUNS = wordSet("ich du er sie es wir ihr man sich mich dich uns euch mir dir");
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
    if (token !== low || !isAdjective(low)) return null;
    adjectives = true;
  }
  return null;
}

/** Whether the clause has a verb that the word at its end can complete. */
function governedBefore(before: string[], at: number): boolean {
  for (let i = at - 1; i >= 0 && !BOUNDARY.test(before[i]); i--) {
    if (VERB_GOVERNORS.has(before[i].toLowerCase())) return true;
  }
  return false;
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
    const after = tokensAfter(ctx.text, end, 3);
    const next = after[0] ?? "";
    // "für strafentlassene, obdachlose oder …": one of several adjectives.
    if ((next === "," || COORDINATORS.has(next)) && isAdjective(lower(after[1]))) continue;
    // "von der leben sie", "mit der bürste ich": a verb; "in der marine Lebensformen",
    // "von 2008 grad 100": an attribute.
    if (PRONOUNS.has(next.toLowerCase()) || /^\p{N}/u.test(next)) continue;
    // "eine zwiebeln zu dürfen": a verb before its zu-infinitive.
    if (next === "zu" && VERB_GOVERNORS.has(lower(after[1]))) continue;
    if (/^\p{Lu}/u.test(next) && next !== next.toUpperCase()) continue;
    if (IDIOMS.test(ctx.text.slice(m.index, m.index + 24))) continue;
    if (
      reading !== "noun" &&
      (isAdjective(next) || !nounReadingHolds(reading, typed, found.kind, before, found.at, after))
    ) {
      continue;
    }
    if (namedExampleBefore(ctx.text, m.index)) continue;
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
  { rules: ["germanNounCasing"], detect: (ctx) => [...nounCasing(ctx), ...nominalized(ctx)] },
];
