import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { accentedNoun } from "./determiners";
import {
  adjectiveReadings,
  type Gender,
  isDictionaryCompound,
  isInflectedNoun,
  isVerbHomograph,
  nounGender,
  verbReadings,
} from "./frenchLexicon";
import { hAspire } from "./elision";
import { LA_ADVERB_FOLLOWERS, sontForSon } from "./homophones";
import {
  ownedFrenchWords,
  PREPOSITIONS,
  SUBJECT_PRONOUNS,
  tokensAfter,
  tokensBefore,
} from "./frenchTokens";
import { carryCase } from "../../implementations/helpers/GenericRuleShared";
import { isLang } from "../phraseTemplates";

// A singular determiner takes its noun's gender: "une maison", "un arbre", "cette idée". Genders
// come from the bundled n-gram counts and the endings that fix one ("-tion", "-ment").

const RULE = "frenchNounGender";
const MESSAGE = "review_msg_fr_noun_gender";

const VOWEL = /^[aeiouyâàäéèêëîïôöûùüœæ]/i;

/** The determiner of the other gender, before a consonant and before a vowel (null: none). */
const SWAP: Record<string, [string | null, string | null]> = {
  un: ["une", "une"],
  une: ["un", "un"],
  le: ["la", null],
  la: ["le", null],
  ce: ["cette", "cette"],
  cet: ["cette", "cette"],
  cette: ["ce", "cet"],
  du: ["de la", null],
  au: ["à la", null],
  mon: ["ma", null],
  ton: ["ta", null],
  son: ["sa", null],
  ma: ["mon", "mon"],
  ta: ["ton", "ton"],
  sa: ["son", "son"],
  aucun: ["aucune", "aucune"],
  aucune: ["aucun", "aucun"],
};
// Adverbs and prefixes written apart that sit between a determiner and its noun ("une tout
// autre", "la post saison").
const NOT_HEADS = new Set(
  "tout bien mieux plus moins très trop peu mini maxi post pré anti ex super hyper ultra".split(
    " ",
  ),
);
// Object pronouns and negation that stand between a subject and its verb.
const CLITICS = new Set("me m' te t' se s' lui leur y en ne n'".split(" "));
const FEMININE = new Set(["une", "la", "cette", "ma", "ta", "sa", "aucune"]);
const NEVER_PRONOUNS = new Set(["cette", "cet", "mon", "ton", "du", "au", "aucun", "aucune"]);

/** "un longue ombre", "une excellent choix": an adjective before its noun whose singular forms
 * show the noun's gender; that gender, or null. */
function genderBeforeNoun(ctx: DetectContext, m: RegExpExecArray, word: string): Gender | null {
  const slots = adjectiveReadings(word).map((r) => r.slot);
  const genders = new Set(slots.filter((s) => s.endsWith("s")).map((s) => s[0] as Gender));
  if (genders.size !== 1 || slots.some((s) => s.endsWith("p"))) return null;
  // "ils excellent", "il ombre": a verb form counts only when another entry spells it too.
  const plainVerb = (w: string) =>
    !isVerbHomograph(w) && verbReadings(w).some((r) => typeof r.slot === "number");
  if (plainVerb(word)) return null;
  const [start] = m.indices!.groups!.noun;
  const next = tokensAfter(ctx.text, start + word.length, 1)[0];
  if (!next || next.hyphen || ctx.text.slice(next.start, next.end) !== next.w) return null;
  if (adjectiveReadings(next.w).length || plainVerb(next.w)) return null;
  // "la mort fait", "la saint Loup": a noun subject and its verb, a feast day.
  const verb = verbReadings(next.w).some((r) => typeof r.slot === "number");
  if ((verb && isInflectedNoun(word)) || word.startsWith("saint")) return null;
  const [gender] = genders;
  return nounGender(next.w) === gender ? gender : null;
}

function gender(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const typedDet = m.groups!.det;
  const det = typedDet.toLowerCase();
  const typed = m.groups!.noun;
  const word = typed.toLowerCase();
  if (typed !== word || word.length < 3 || ctx.dictionary.has(word)) return null;
  // "EDF SA": an acronym, not a possessive.
  if (typedDet.length > 1 && typedDet === typedDet.toUpperCase()) return null;
  if (NOT_HEADS.has(word) || word.endsWith("ième")) return null;
  // "il est la demain": "là" before an adverb, which the homophone check offers.
  if (det === "la" && LA_ADVERB_FOLLOWERS.has(word)) return null;
  const nounGenderOf: Gender | null = nounGender(word) ?? genderBeforeNoun(ctx, m, word);
  if (!nounGenderOf || (nounGenderOf === "f") === FEMININE.has(det)) return null;
  const [start] = m.indices!.groups!.noun;
  const after = ctx.text.slice(start + typed.length);
  // "un après-midi", "la mi-temps", "une·un": a compound or an inclusive form.
  if (/^[-'’·.*(]\p{L}/u.test(after)) return null;
  // "un marque page": a compound written apart takes its own gender.
  const second = /^[ \t]+(\p{L}+)/u.exec(after)?.[1].toLowerCase();
  if (second && isDictionaryCompound(`${word}-${second}`)) return null;
  // "le hibou", "la hausse": an h aspiré is a consonant; "la homme" -> "l'homme" elides.
  const vowel = VOWEL.test(word) || (word.startsWith("h") && !hAspire(word));
  const elided = vowel && (det === "le" || det === "la");
  const fixed = elided ? "l'" : SWAP[det][vowel ? 1 : 0];
  // "le cure": determiners.ts offers "le curé" and "la cure" together.
  if (!FEMININE.has(det) && verbReadings(word).length && accentedNoun(word)) return null;
  if (!fixed) return null;
  // "mon amie": a feminine noun keeps "mon" before a vowel.
  if (["mon", "ton", "son"].includes(det) && vowel) return null;
  const previous = tokensBefore(ctx.text, m.index, 1)[0];
  // "Sur ce, maman, je m'en vais": the phrase "sur ce" with its comma left out.
  if (det === "ce" && previous?.w === "sur" && tokensBefore(ctx.text, m.index, 2).length === 1)
    return null;
  // "les filles son arrivé": "sont" misspelt, no determiner.
  if (det === "son" && sontForSon(ctx.text, m.index)) return null;
  // "de ton", "le son": the nouns "ton" and "son".
  if (
    (det === "son" || det === "ton") &&
    previous &&
    ["de", "le", "un", "du", "ce", "au"].includes(previous.w)
  )
    return null;
  // "je la porte", "ce base" (se), "dont une fait": a pronoun before a verb. "cette", "mon",
  // "du" are never pronouns: "cette chasse", "du porte" name the noun. "pour la goûter": le and la
  // before an infinitive are pronouns.
  if (!NEVER_PRONOUNS.has(det)) {
    const readings = verbReadings(word);
    if ((det === "le" || det === "la") && readings.some((r) => r.slot === "I")) return null;
    // "c'est le facture", "tirer le chasse": after a verb, the determiner opens its object.
    const afterVerb =
      previous &&
      !SUBJECT_PRONOUNS.has(previous.w) &&
      !CLITICS.has(previous.w) &&
      verbReadings(previous.w).length > 0 &&
      !isInflectedNoun(previous.w);
    if (readings.some((r) => typeof r.slot === "number")) {
      if (!previous || !(PREPOSITIONS.has(previous.w) || afterVerb)) return null;
    }
  }
  // "un unique sommet", "une mini salle": a modifier before the noun the determiner agrees
  // with.
  const next = tokensAfter(ctx.text, start + typed.length, 1)[0];
  if (next && nounGender(next.w) === (FEMININE.has(det) ? "f" : "m")) return null;
  if (namedExampleBefore(ctx.text, m.index)) return null;
  // "Le Monde", "La Défense": the title of a name keeps its article.
  if (/^\p{Lu}/u.test(typedDet) && /^\p{Lu}/u.test(after.trim())) return null;
  // "de la gouvernement" -> "du", "à la projet" -> "au": the preposition contracts.
  const joined =
    det === "la" && !elided && previous && previous.end + 1 === m.index ? previous : null;
  const contracted = joined?.w === "de" ? "du" : joined?.w === "à" ? "au" : null;
  const from = contracted && joined ? joined.start : m.index;
  const typedFrom = ctx.text.slice(from, m.index + typedDet.length);
  return {
    ruleId: RULE,
    messageKey: MESSAGE,
    // "l'" joins its noun: the space goes too.
    range: { start: from, end: elided && !contracted ? start : m.index + typedDet.length },
    alternatives: [carryCase(typedFrom, contracted ?? fixed)],
    context: { start: m.index, end: start + typed.length },
  };
}

const DETERMINER_NOUN = new RegExp(
  `(?:(?<![\\p{L}\\p{M}\\p{N}_'’-])|(?<=(?<![\\p{L}\\p{M}\\p{N}_'’-])(?:[dD]|[qQ]u)['’]))(?<det>${Object.keys(SWAP).join("|")})(?=[ \\t]+(?<noun>\\p{L}+)(?![\\p{L}\\p{M}\\p{N}_]))`,
  "dgiu",
);

function genders(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "fr")) return [];
  const findings: RawFinding[] = [];
  for (const m of ownedFrenchWords(ctx, DETERMINER_NOUN)) {
    const finding = gender(ctx, m);
    if (finding) findings.push(finding);
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: genders }];
