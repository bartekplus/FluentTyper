import { namedExampleBefore } from "../exampleCues";
import type { MatchFixer } from "../../engine/reviewRules";
import {
  germanAdjective,
  germanInfinitive,
  germanMayBeNoun,
  germanPastInfinitives,
  germanVerbLike,
} from "./germanLexicon";
import { ARTICLES, DEMONSTRATIVES, PREPOSITIONS } from "./nounCasing";
import {
  BOUNDARY,
  englishLine,
  tokensAfter,
  tokensBefore,
  VERB_GOVERNORS,
  wordSet,
} from "./shared";
import { germanInfinitiveOf } from "./verbAgreement";

// An adjective capitalized inside a sentence where it is no noun: "Ich bin dir unendlich
// Dankbar.", "Es lief völlig Problemlos.", "Sie versuchen mich Mundtot zu machen." Only an
// adjective lemma that no noun form spells, after a lowercase word and before the end of its
// clause, so a name ("bei Real", "Herr Klein") or a heading stays.

// Words before a name or a title: "heißt Fröhlich", "und Ehrlich".
const NAME_CUES = wordSet(
  "heißt heiße heißen hieß hießen nennt nannte genannt namens titel und oder sowie bzw von",
);
const PARTICLES = wordSet("aus vor an ab zu");

const capitalizedAdjective: MatchFixer = (m, ctx) => {
  const typed = m[0];
  if (!/^\p{Lu}\p{Ll}{2,}$/u.test(typed)) return null;
  const low = typed.toLowerCase();
  if (!germanAdjective(low) || germanMayBeNoun(low) || germanInfinitive(low)) return null;
  const prior = tokensBefore(ctx.text, m.index, 1)[0] ?? "";
  if (!/^\p{Ll}+$/u.test(prior) || NAME_CUES.has(prior) || PREPOSITIONS.has(prior)) return null;
  if (ARTICLES.has(prior) || DEMONSTRATIVES.has(prior)) return null;
  const end = m.index + typed.length;
  const [next = "", second = ""] = tokensAfter(ctx.text, end, 2);
  // The clause ends after it, or after its verb, zu-infinitive or particle ("Weiß gefärbt.",
  // "Mundtot zu machen", "Kahl aus.").
  const closes =
    (BOUNDARY.test(next) && next !== "-") ||
    (next === "zu" && germanInfinitive(second)) ||
    ((/^\p{Ll}*(?:ge\p{Ll}+(?:t|en)|iert)$/u.test(next) || PARTICLES.has(next)) &&
      BOUNDARY.test(second));
  if (!closes || ctx.dictionary.has(low)) return null;
  // "Lernt ihr Französisch?", "ist Norddeutsch": a language is a noun, unless it "kommt
  // einem spanisch vor".
  if (/(?:isch|deutsch)$/.test(low) && next !== "vor") return null;
  if (namedExampleBefore(ctx.text, m.index) || englishLine(ctx.text, m.index)) return null;
  return {
    ruleId: "germanNounCasing",
    messageKey: "review_msg_german_not_noun",
    range: { start: m.index, end: m.index + 1 },
    alternatives: [typed[0].toLowerCase()],
    context: { start: Math.max(0, m.index - 40), end },
  };
  return null;
};

// A finite verb capitalized after its subject pronoun: "Ich Koche heute.", "Wir Treffen uns
// später.", "weil ich Arbeite,". Only where the pronoun opens the sentence (the verb comes
// next) or opens a subordinate clause that ends after the word, and the word is a verb form of
// the pronoun's person. "Ich Idiot habe …", "Wir Kranken müssen …" put a noun after the pronoun.
const SUBORDINATORS = wordSet(
  "weil dass wenn während ob als obwohl damit bevor nachdem sobald falls da seit seitdem",
);
const stemVerb = (stem: string) =>
  stem.length >= 2 && (germanInfinitive(`${stem}en`) || germanInfinitive(`${stem}n`));
/** Whether `low` is a finite verb form that agrees with the subject pronoun. */
function agrees(pronoun: string, low: string): boolean {
  if (/(?:en|ern|eln)$/.test(low) && germanInfinitive(low)) {
    return pronoun === "wir" || pronoun === "sie";
  }
  // "Kam", "Gibt", "Bin": a listed or strong form, of a person the list does not tell.
  if (germanInfinitiveOf(low) || germanPastInfinitives(low).length) return true;
  const third = /t$/.test(low) && stemVerb(low.replace(/e?t$/, ""));
  switch (pronoun) {
    case "ich":
      return /e$/.test(low) && germanVerbLike(low);
    case "du":
      return /st$/.test(low) && stemVerb(low.replace(/e?st$/, ""));
    case "er":
    case "es":
      return third;
    case "wir":
      return false;
    default:
      return third;
  }
}

const capitalizedVerb: MatchFixer = (m, ctx) => {
  const pronoun = m[0].toLowerCase();
  if (!/^(?:ich|du|er|sie|es|wir)$/.test(pronoun)) return null;
  const end = m.index + m[0].length;
  const gap = /^[ \t]{1,4}(\p{Lu}\p{Ll}{2,})(?![\p{L}\p{M}\p{N}_-])/u.exec(
    ctx.text.slice(end, end + 40),
  );
  if (!gap) return null;
  const typed = gap[1];
  const start = end + gap[0].length - typed.length;
  const next = tokensAfter(ctx.text, start + typed.length, 1)[0] ?? "";
  const prior = tokensBefore(ctx.text, m.index, 1)[0];
  const opens = prior === undefined || /^[.!?:\n„“"»«]$/.test(prior);
  const subordinate = prior !== undefined && SUBORDINATORS.has(prior.toLowerCase());
  if (!(opens ? /^\p{Lu}/u.test(m[0]) : subordinate && BOUNDARY.test(next) && next !== "-"))
    return null;
  const low = typed.toLowerCase();
  if (!agrees(pronoun, low) || ctx.dictionary.has(low)) return null;
  // "Wir Kranken müssen", "Wir Kranken warten": an adjective made a noun after the pronoun.
  if (VERB_GOVERNORS.has(next) || (/en$/.test(low) && germanAdjective(low.slice(0, -2))))
    return null;
  if (namedExampleBefore(ctx.text, m.index) || englishLine(ctx.text, m.index)) return null;
  return {
    ruleId: "germanNounCasing",
    messageKey: "review_msg_german_not_noun",
    range: { start, end: start + 1 },
    alternatives: [typed[0].toLowerCase()],
    context: { start: m.index, end: start + typed.length },
  };
  return null;
};

/** The named frame fixes of the capital frames of the de.nounCasing rule (grammar/rules/de.yaml). */
export const FIXERS = {
  capitalizedAdjective,
  capitalizedVerb,
} satisfies Record<string, MatchFixer>;
