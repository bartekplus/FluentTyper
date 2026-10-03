import { hasCanonicalCasing } from "../canonicalCasing";
import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  germanAdjective,
  germanAdjectiveNoun,
  germanGender,
  germanInfinitive,
  germanNounOverAdjective,
  germanNounReading,
  germanVerbLike,
  type GermanNounReading,
} from "./germanLexicon";
import { idioms } from "./idioms";
import { names } from "./names";
import { politeImperative, salutationCase } from "./salutations";
import { nominalized } from "./nominalized";
import {
  BOUNDARY,
  englishLine,
  governedBefore,
  PRONOMINAL_ADVERB,
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
    "könne müsse solle wolle dürfe möge wisse gebe hier eher",
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
// "ein klopfen erfüllte den Raum", "kein zurückweichen.": an infinitive after a neuter ein-word,
// before the clause's end, its verb or a preposition, is a noun; not before "zu", where "ein"
// may be a particle.
// "einem" alone is the pronoun "one" ("der es einem leihen würde"), so only after a preposition.
const NEUTER_EIN =
  /(?<![\p{L}\p{N}])(?:ein|kein|(?:mit|von|bei|aus|nach|zu|seit)[ \t]+k?einem)[ \t]+$/iu;
function neuterArticleInfinitive(ctx: DetectContext, index: number, length: number): boolean {
  if (!NEUTER_EIN.test(ctx.text.slice(Math.max(0, index - 16), index))) return false;
  const next = lower(tokensAfter(ctx.text, index + length, 1)[0]);
  if (next === "zu") return false;
  return BOUNDARY.test(next) || PREPOSITIONS.has(next) || finiteVerb(next);
}
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
const IDIOMS =
  /^(?:kreuz und quer|sage und schreibe|gang und gäbe|zeit (?:seines|ihres|meines|deines))\b/iu;

const lower = (token: string | undefined) => token?.toLowerCase() ?? "";
const isAdjective = (token: string) =>
  /^\p{Ll}{2,}(?:e|en|er|es|em)$/u.test(token) &&
  !PRONOMINAL_ADVERB.test(token) &&
  // "daher", "bisher", "nacheinander"
  !/^(?:da|wo|bis|seit|vor|nach|um|hier|dort|ein|neben|hinter)her$|einander$/u.test(token) &&
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

type Trigger =
  "article" | "demonstrative" | "quantifier" | "preposition" | "number" | "bare" | "adjective";

// Nouns that end a clause as the particle of a separable verb: "er steht kopf", "sie gibt
// nichts preis", "das findet statt", "er hält stand" (authored).
const VERB_PARTICLE_NOUNS = wordSet("kopf preis statt stand eis haus hof maß not acht kehrt hohn");

/**
 * Whether a noun form that is no other word stands lowercase inside a sentence with no
 * determiner to show it: "wir geben uns mühe", "ich habe viel zeit". The word before it must be
 * a lowercase word, so a heading, list item or sentence start is left to other checks.
 */
function bareNoun(typed: string, before: string[], after: string[]): boolean {
  const prior = before.at(-1) ?? "";
  const next = after[0] ?? "";
  // "nach einer Lösung ausschau": a noun inside the sentence before it, too.
  // Only where the clause ends after it, and not a form in -en that may be a verb or participle
  // the dictionary lacks ("Die Kommandeure beamten den …", "von einer Straße durchschnitten").
  const nounPrior =
    /^\p{Lu}\p{Ll}{2,}$/u.test(prior) &&
    before.length > 1 &&
    !BOUNDARY.test(before.at(-2)!) &&
    !/(?:en|ern|eln)$/.test(typed) &&
    BOUNDARY.test(next) &&
    (germanNounReading(prior.toLowerCase()) !== null || germanGender(prior) !== null);
  if (typed.length < 4 || BARE_EXCEPTIONS.has(typed) || !(nounPrior || /^\p{Ll}+$/u.test(prior)))
    return false;
  const ends = BOUNDARY.test(next) || COORDINATORS.has(next);
  if (VERB_PARTICLE_NOUNS.has(typed) && ends) return false;
  // "Das ist mir wurst": "egal", with someone it is egal to.
  if (
    /^wurs(?:ch)?t$/.test(typed) &&
    before.some((t) => /^(?:mir|dir|ihm|ihr|uns|euch|ihnen)$/i.test(t))
  )
    return false;
  // "ich düse los": a verb form the dictionary lacks, before its particle.
  if (VERB_PARTICLES.has(next) && BOUNDARY.test(after[1] ?? "")) return false;
  // Both neighbours are German words, so the word is no foreign or Latin one ("opus manuum").
  return (
    (nounPrior || germanWord(prior)) &&
    (ends || germanWord(lower(next)) || /^ge\p{Ll}+(?:t|en)$/u.test(next))
  );
}

// Object pronouns before a demonstrative that is the article of an object ("mir die treue").
const OBJECT_PRONOUNS = wordSet("mir dir ihm ihr uns euch ihnen sich sie es er wir ich du man");
const HABEN = wordSet("habe hast hat haben habt hatte hattest hatten hattet hätte hätten");
/**
 * A noun form that is also a verb form, as the object of "haben" that ends its clause: "Ich habe
 * hunger.", "Wir haben bedenken, ob …", "Ich habe fragen dazu". Not "Ich habe ihn fragen
 * wollen", where a modal follows.
 */
function hadObject(typed: string, before: string[], after: string[]): boolean {
  const next = lower(after[0]);
  if (typed.length < 4 || !HABEN.has(lower(before.at(-1)))) return false;
  // "Ich habe vergessen", "Diese habe ergeben": a participle spelled like its infinitive.
  if (/^(?:be|er|ver|ge|ent|zer|emp|miss|über|unter|hinter|wider)\p{Ll}{3,}en$/u.test(typed))
    return false;
  return (
    BOUNDARY.test(next) ||
    PRONOMINAL_ADVERB.test(next) ||
    /^(?:am|im|zum|zur|vom|beim|ins|ans|aufs|fürs)$/.test(next) ||
    (PREPOSITIONS.has(next) && !VERB_GOVERNORS.has(lower(after[1])))
  );
}
/**
 * A noun form that is also a finite verb form, where the clause already has its finite verb, so
 * it cannot be one: "Ich drehe filme.", "Da rollen köpfe.", "Ich werde heute fische fangen". The
 * clause has no subordinator or coordinator that could open another verb's clause.
 */
function secondFinite(typed: string, before: string[], after: string[]): boolean {
  const next = lower(after[0]);
  const ends = BOUNDARY.test(next) || (germanInfinitive(next) && BOUNDARY.test(after[1] ?? ""));
  if (typed.length < 4 || !ends || !/^\p{Ll}+$/u.test(before.at(-1) ?? "")) return false;
  // "würden" (also "die Würden"), "halt" (also "der Halt"): a verb or particle of their own.
  if (AUXILIARIES.has(typed) || VERB_GOVERNORS.has(typed) || SECOND_EXCEPTIONS.has(typed)) {
    return false;
  }
  let verb = false;
  for (let i = before.length - 1; i >= 0 && !BOUNDARY.test(before[i]); i--) {
    const low = before[i].toLowerCase();
    if (CLAUSE_LINKS.has(low) || SUBORDINATORS.has(low) || COORDINATORS.has(low)) return false;
    // ", die ich mir stelle", "Die Frage die ich mir stelle": a relative clause.
    const relative = /^(?:der|die|das|den|dem|denen|welche[mnrs]?)$/.test(low);
    if (relative && (before[i - 1] === "," || /^\p{Lu}/u.test(before[i - 1] ?? ""))) return false;
    // "die Dinge, von denen ich sprach", "die Dos von denen ich sprach": a preposition's relative.
    if (/^(?:denen|deren|dessen)$/.test(low) && PREPOSITIONS.has(lower(before[i - 1])))
      return false;
    // An infinitive right before it may close a subordinate clause ("… wegfallen würden").
    if (i === before.length - 1 && /en$/.test(low)) continue;
    const finite = AUXILIARIES.has(low) || VERB_GOVERNORS.has(low) || finiteVerb(low);
    if (i > 0 && before[i] === low && finite) verb = true;
  }
  return verb;
}
const SECOND_EXCEPTIONS = wordSet("halt stand statt teil preis acht");
/** "Zuckerbrot und peitsche.": a noun joined to a noun, ending the pair. */
function pairedNoun(before: string[], after: string[]): boolean {
  const next = after[0] ?? "";
  const noun = before.at(-2) ?? "";
  return (
    COORDINATORS.has(lower(before.at(-1))) &&
    /^\p{Lu}\p{Ll}+$/u.test(noun) &&
    !BOUNDARY.test(before.at(-3) ?? ".") &&
    germanNounReading(noun.toLowerCase()) !== null &&
    (BOUNDARY.test(next) || COORDINATORS.has(next))
  );
}
// Lowercase words the dictionary lists only as nouns that are also adverbs ("wir sind zuhause").
const BARE_EXCEPTIONS = wordSet("zuhause topp");
const VERB_PARTICLES = wordSet("los ab an auf aus ein mit vor weg zu zurück hin her fest");
// Frequent German function words that are no noun, adjective or verb form.
const FUNCTION_WORDS = wordSet(
  "nicht auch noch schon nur viel wenig mehr genug etwas nichts kein gern gerne bitte immer " +
    "wieder dann jetzt heute hier da dort ja doch mal gerade nie oft ihm ihnen ihn uns euch " +
    "selbst bloß eben halt wohl kaum fast sogar gar ganz endlich bereits meist erst zuerst",
);
const germanWord = (w: string) =>
  FUNCTION_WORDS.has(w) ||
  PRONOUNS.has(w) ||
  VERB_GOVERNORS.has(w) ||
  AUXILIARIES.has(w) ||
  PREPOSITIONS.has(w) ||
  ARTICLES.has(w) ||
  DEMONSTRATIVES.has(w) ||
  QUANTIFIERS.has(w) ||
  CLAUSE_LINKS.has(w) ||
  DEGREE_WORDS.has(w) ||
  finiteVerb(w) ||
  germanInfinitive(w) ||
  germanAdjective(w) ||
  germanAdjective(w.replace(/(?:e|en|er|es|em)$/, ""));

/** The determiner, preposition or number before the word, across up to two adjectives. */
function trigger(before: string[]): { kind: Trigger; at: number } | null {
  let adjectives = false;
  // The first of the adjectives before the word, when one is a known inflected adjective:
  // "Heute ist schönes wetter", "mit erbitterten widerstand" has its preposition.
  let attribute = -1;
  const bare = () => (attribute >= 0 ? { kind: "adjective" as const, at: attribute } : null);
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
    // An inflected adjective or participle ("faule", "erbitterten"), even when also a verb form.
    const stem = low.replace(/(?:e|en|er|es|em)$/, "");
    // "Wir machen morgen", "die Schmerzen lassen langsam nach": an infinitive is no adjective
    // unless a determiner or preposition stands before it ("mit kühlen Getränken").
    const verbForm =
      germanInfinitive(low) &&
      !ARTICLES.has(prior) &&
      !DEMONSTRATIVES.has(prior) &&
      !QUANTIFIERS.has(prior) &&
      !PREPOSITIONS.has(prior);
    const inflected =
      stem !== low &&
      !verbForm &&
      !NOT_ADJECTIVES.has(low) &&
      !/^(?:k?ein|[dms]ein|ihr|unser|eu|dies|jen|jed|welch|manch|solch|all|d)$/.test(stem) &&
      (germanAdjective(stem) ||
        germanAdjective(`${stem}e`) ||
        /^(?:ge|er|ver|be|ent|zer)\p{Ll}{3,}t$/u.test(stem));
    // A capital here opens the sentence ("Effizientes arbeiten ist wichtig").
    if (
      !(isAdjective(low) || inflected || (lemma !== low && germanAdjective(lemma))) ||
      (token !== low && !inflected)
    )
      return low !== "als" && low !== "wie" ? bare() : null;
    adjectives = true;
    if (inflected) attribute = i;
  }
  return bare();
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
  if (kind === "bare") return true;
  if (kind === "adjective") {
    // "Wir wollen frische kaufen", "dass neue kommen": the verb after an elided noun.
    const ends = BOUNDARY.test(next) || COORDINATORS.has(next);
    const opens = at === 0 || BOUNDARY.test(before[at - 1]);
    // "Effizientes arbeiten ist wichtig": the subject, then its verb.
    if (opens && AUXILIARIES.has(next)) return true;
    if (VERB_GOVERNORS.has(next) || PRONOUNS.has(next)) return false;
    if (reading === "infinitive" && ends) {
      // "Neue kommen.": the adjectives open the sentence, so the word is its verb.
      return !opens && !subordinate(before, at) && !modalBefore(before, at);
    }
    return reading === "finite" || !ends;
  }
  // "auf 0 setzen": no plural noun follows 0 or 1, so this is the verb.
  if (reading === "infinitive" && /^[01]$/.test(before[at])) return false;
  const det = lower(before[at]);
  // "wie er das macht", "das stand": a neuter determiner before a form whose noun is no neuter
  // singular ("die Macht", "der Stand") is the pronoun before its verb.
  if (/^(?:das|dies|dieses|jenes|welches)$/.test(det)) {
    const gender = germanGender(typed);
    const verbForm = reading === "finite" && /[^s]t$/.test(typed) && kind === "demonstrative";
    if (gender ? gender.gender !== "n" && gender.gender !== "x" : verbForm) return false;
  }
  // "wenn du das besorgen könntest", "wie das gehen soll": the pronoun, then a verb chain; not
  // "Das Essen wird kalt", "und das Essen wird kalt", where the noun opens a main clause.
  if (
    reading === "infinitive" &&
    kind === "demonstrative" &&
    prior !== undefined &&
    !BOUNDARY.test(prior) &&
    !MAIN_CLAUSE_LINKS.has(prior.toLowerCase()) &&
    (VERB_GOVERNORS.has(next) || MODALS.test(next))
  ) {
    return false;
  }
  // "die beide passen", ", die kosten": a pronoun, or a relative pronoun.
  if (kind === "demonstrative" && prior !== undefined && /^[,;:(–—-]$/.test(prior)) return false;
  const clauseStart =
    prior === undefined || BOUNDARY.test(prior) || CLAUSE_LINKS.has(prior.toLowerCase());
  const determiner = kind === "article" || kind === "demonstrative";
  // "Die grenzen meiner Sprache", "Das gerät, mit dem …": a genitive or a relative clause.
  const relative = next === "," && RELATIVE.test(after.slice(1, 3).join(" "));
  if (determiner && (GENITIVES.has(next) || relative)) return true;
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
  if (!(BOUNDARY.test(next) || COORDINATORS.has(next))) return true;
  // "wenn Sie ein neues eingeben": the verb that ends the clause.
  if (reading === "infinitive" && subordinate(before, at)) return false;
  return !governedBefore(before, at);
}

const MAIN_CLAUSE_LINKS = wordSet("und oder aber denn doch sondern");
// Verbs that take a bare infinitive: modals, "werden", "lassen".
const MODALS =
  /^(?:k[aöo]nn|m[üu]ss|soll|will|woll|d[aüu]rf|mag|m[öo]cht|werd|wirst|wird|würd|wurd|lass|läss|ließ)/;
function modalBefore(before: string[], at: number): boolean {
  for (let i = at - 1; i >= 0 && !BOUNDARY.test(before[i]); i--) {
    if (MODALS.test(before[i].toLowerCase())) return true;
  }
  return false;
}
const SUBORDINATORS = wordSet(
  "dass weil wenn ob obwohl damit nachdem bevor falls sobald solange sodass",
);
const WH_WORDS = wordSet(
  "wie wo was wer wen wem wann warum weshalb wieso weswegen wohin woher womit wodurch worauf " +
    "woran worüber wofür",
);
const SUBJECT_AFTER_WH = /^(?:ich|du|er|sie|es|wir|ihr|man|Sie|der|die|das)$/;
/** Whether the clause opens with a subordinator, so its verb comes last. */
function subordinate(before: string[], at: number): boolean {
  let i = at - 1;
  for (; i >= 0 && !BOUNDARY.test(before[i]); i--) {
    const low = before[i].toLowerCase();
    if (SUBORDINATORS.has(low)) return true;
    // "wie sie das schaffen", "wo das hinführt": a question word before its subject, not before
    // a finite verb ("Wie findest du das essen?").
    if (WH_WORDS.has(low) && (i + 1 === at || SUBJECT_AFTER_WH.test(before[i + 1]))) return true;
  }
  // ", die sich teilweise überlappen": a relative clause, its verb last.
  return before[i] === "," && RELATIVE.test(before.slice(i + 1, i + 3).join(" "));
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
  // A participle or infinitive that ends the clause: "in die enge getrieben."
  const clauseVerb =
    /^(?:\p{Ll}*ge\p{Ll}+(?:t|en)|\p{Ll}+iert|\p{Ll}+en)$/u.test(next) &&
    (BOUNDARY.test(after[1] ?? "") || AUXILIARIES.has(lower(after[1])));
  if (kind === "demonstrative") {
    const verbFollows = finiteVerb(next) || GENITIVES.has(next) || genitiveThenVerb(after);
    // "Er hat die ehe gebrochen", "machte die runde.", "erreichten sie die spitze der Liga": an
    // object after a verb or a pronoun, closed by the clause's end, its verb or a genitive.
    const object =
      prior !== undefined &&
      (VERB_GOVERNORS.has(lower(prior)) ||
        OBJECT_PRONOUNS.has(lower(prior)) ||
        finiteVerb(lower(prior))) &&
      // "das" is often the pronoun itself ("Ich kann das null", "kann das weg?").
      ((lower(before[at]) !== "das" && (BOUNDARY.test(next) || clauseVerb)) ||
        (/^de[rs]$/.test(next) && /^\p{Lu}/u.test(after[1] ?? "")));
    if (!object && (!sentenceStart || !verbFollows)) return false;
  } else if (kind !== "article" && kind !== "adjective") return false;
  // "über alles liebe": a pronoun, not an article.
  const det = lower(before[at]);
  if (kind !== "adjective" && !ARTICLES.has(det) && !DEMONSTRATIVES.has(det)) return false;
  // After a bare adjective only where no verb or other word could follow: "hohe werte, die".
  if (kind === "adjective") {
    return (
      BOUNDARY.test(next) ||
      COORDINATORS.has(next) ||
      ARTICLES.has(next) ||
      DEMONSTRATIVES.has(next) ||
      PREPOSITIONS.has(next)
    );
  }
  if (BOUNDARY.test(next) || COORDINATORS.has(next) || VERB_GOVERNORS.has(next)) return true;
  if (ARTICLES.has(next) || DEMONSTRATIVES.has(next) || PREPOSITIONS.has(next)) return true;
  if (clauseVerb) return true;
  return (
    /^\p{Ll}/u.test(next) &&
    !germanAdjective(next) &&
    !attributive(next) &&
    germanNounReading(next) !== "noun"
  );
}

/** The weak or mixed adjective endings a determiner leaves for an adjective after it. */
function endingsAfter(det: string): readonly string[] | null {
  const d = det.toLowerCase();
  if (/^(?:der|die|dieser|diese|jener|jene|welcher|welche)$/.test(d)) return ["e", "en"];
  if (/^(?:das|dieses|jenes|welches|ins|ans|aufs|fürs|übers|ums|durchs)$/.test(d)) return ["e"];
  if (/^(?:den|dem|des|im|am|zum|zur|vom|beim)$/.test(d)) return ["en"];
  if (/^(?:dies|jen|welch)(?:en|em)$/.test(d)) return ["en"];
  const ein = /^(?:k?ein|mein|dein|sein|ihr|unser|euer|eur)(e|en|em|er|es|)$/.exec(d);
  if (!ein) return null;
  if (ein[1] === "") return ["er", "es"];
  if (ein[1] === "e") return ["e", "en"];
  return ["en"];
}

/**
 * Whether a form that is a noun and an adjective form cannot be the adjective after this
 * determiner or adjective: "keine wunder" (the adjective would be "wunden"), "kein defekt",
 * "in heißem fett" (an adjective there takes an ending).
 */
function endingRulesOutAdjective(typed: string, kind: Trigger, det: string): boolean {
  const m = /^(\p{Ll}+?)(e|en|er|es|em)$/u.exec(typed);
  const ending = m && (germanAdjective(m[1]) || germanAdjective(`${m[1]}e`)) ? m[2] : "";
  if (kind === "adjective") return ending === "";
  if (kind !== "article") return false;
  const allowed = endingsAfter(det);
  return allowed !== null && !allowed.includes(ending);
}

// Words in the noun-or-adjective list that are function words or particles here: "sein", "ein",
// "unter", "weiß" (knows), "fern" (sieht fern), "klein" (sieht klein aus).
const EITHER_EXCEPTIONS = wordSet("weiß fern fest frei klein groß dicht nah nahe hoch tief weit");
// Comparatives used as adverbs before a particle or adjective ("lieber fern").
const ADVERB_COMPARATIVES = wordSet("lieber eher besser mehr weniger länger weiter öfter");

/**
 * A noun form that is also an adjective form ("wunder", "defekt", "bar") reads as the noun right
 * after a determiner or adjective whose ending it cannot have as an adjective ("keine wunder",
 * "an der bar", "in heißem fett"), where the phrase ends after it.
 */
function eitherNounHolds(
  typed: string,
  kind: Trigger,
  before: string[],
  at: number,
  after: string[],
): boolean {
  if (EITHER_EXCEPTIONS.has(typed) || PREPOSITIONS.has(typed) || ARTICLES.has(typed)) return false;
  if (/^(?:k?ein|mein|dein|sein|ihr|unser|euer|eur)\p{Ll}*$/u.test(typed)) return false;
  // "getrieben", "gehalten", "verletzt": a participle, as much an adjective as a verb.
  // "vorbehalten", "abgesagt": a separable verb's participle too.
  if (
    /^(?:an|auf|aus|ab|ein|mit|nach|vor|zu|zurück|weg|bei|über|unter|durch|um)?(?:ge|be|ver|er|ent|zer)\p{Ll}{3,}(?:t|en)$/u.test(
      typed,
    )
  )
    return false;
  const det = before[at] ?? "";
  // "mit ihr halb und halb": the pronoun "ihr", not the possessive; "das kann einem leicht
  // passieren": the pronoun "one".
  if (det.toLowerCase() === "ihr") return false;
  if (/^einem$/i.test(det) && !PREPOSITIONS.has(lower(before[at - 1]))) return false;
  // An adjective between the determiner and the word sets the ending: "ein notwendiges übel".
  if (kind === "article" && at !== before.length - 1) kind = "adjective";
  if (kind === "article") {
    // No relative pronoun after a comma and preposition (", in das dicht an dicht …").
    if (DEMONSTRATIVES.has(det.toLowerCase()) && before[at - 2] === ",") return false;
  } else if (kind === "adjective") {
    // "lieber fern", "am liebsten schwarz": an adverb before it, not an attribute.
    if (ADVERB_COMPARATIVES.has(lower(before.at(-1))) || /sten$/.test(lower(before.at(-1))))
      return false;
  } else return false;
  if (!endingRulesOutAdjective(typed, kind, det)) return false;
  const next = lower(after[0]);
  const clauseVerb =
    /^(?:\p{Ll}*ge\p{Ll}+(?:t|en)|\p{Ll}+iert|\p{Ll}+en)$/u.test(next) &&
    BOUNDARY.test(after[1] ?? "");
  return (
    BOUNDARY.test(next) ||
    COORDINATORS.has(next) ||
    PREPOSITIONS.has(next) ||
    ARTICLES.has(next) ||
    DEMONSTRATIVES.has(next) ||
    next === "mehr" ||
    clauseVerb
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
      ((NOMINALIZING.test(ctx.text.slice(Math.max(0, m.index - 8), m.index)) ||
        neuterArticleInfinitive(ctx, m.index, typed.length)) &&
      germanInfinitive(typed) &&
      !ARTICLES.has(typed) &&
      !QUANTIFIERS.has(typed)
        ? "noun"
        : germanNounOverAdjective(typed)
          ? "adjective"
          : germanAdjectiveNoun(typed)
            ? "either"
            : null);
    if (!reading || ctx.dictionary.has(typed) || hasCanonicalCasing(typed)) continue;
    const end = m.index + typed.length;
    // Glued to a hyphen, apostrophe or slash; an abbreviation ("den sog. Strudel").
    if (/^[-'’/]/.test(ctx.text[end] ?? "") || (typed === "sog" && ctx.text[end] === ".")) {
      continue;
    }
    const before = tokensBefore(ctx.text, m.index, 12);
    const after = tokensAfter(ctx.text, end, 6);
    const next = after[0] ?? "";
    const found =
      trigger(before) ??
      ((reading === "noun" && bareNoun(typed, before, after)) ||
      ((reading === "finite" || reading === "infinitive") && hadObject(typed, before, after)) ||
      (reading === "finite" && secondFinite(typed, before, after)) ||
      (reading !== "infinitive" && pairedNoun(before, after))
        ? { kind: "bare" as const, at: before.length - 1 }
        : null);
    if (!found) continue;
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
    if (reading === "either") {
      // After a preposition and an adjective ("in heißem fett"), as after an adjective alone.
      const kind =
        found.kind === "preposition" && found.at < before.length - 1 ? "adjective" : found.kind;
      if (!eitherNounHolds(typed, kind, before, found.at, after)) continue;
    } else if (reading === "adjective") {
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
      ...politeImperative(ctx),
    ],
  },
];
