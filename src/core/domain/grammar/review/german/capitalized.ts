import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { germanAdjective, germanInfinitive, germanMayBeNoun } from "./germanLexicon";
import { ARTICLES, DEMONSTRATIVES, PREPOSITIONS } from "./nounCasing";
import {
  BOUNDARY,
  englishLine,
  isGerman,
  tokensAfter,
  tokensBefore,
  words,
  wordSet,
} from "./shared";

// An adjective capitalized inside a sentence where it is no noun: "Ich bin dir unendlich
// Dankbar.", "Es lief völlig Problemlos.", "Sie versuchen mich Mundtot zu machen." Only an
// adjective lemma that no noun form spells, after a lowercase word and before the end of its
// clause, so a name ("bei Real", "Herr Klein") or a heading stays.

// Words before a name or a title: "heißt Fröhlich", "und Ehrlich".
const NAME_CUES = wordSet(
  "heißt heiße heißen hieß hießen nennt nannte genannt namens titel und oder sowie bzw von",
);
const PARTICLES = wordSet("aus vor an ab zu");

export function capitalizedAdjectives(ctx: DetectContext): RawFinding[] {
  if (!isGerman(ctx)) return [];
  const findings: RawFinding[] = [];
  for (const m of words(ctx)) {
    const typed = m[0];
    if (!/^\p{Lu}\p{Ll}{2,}$/u.test(typed)) continue;
    const low = typed.toLowerCase();
    if (!germanAdjective(low) || germanMayBeNoun(low) || germanInfinitive(low)) continue;
    const prior = tokensBefore(ctx.text, m.index, 1)[0] ?? "";
    if (!/^\p{Ll}+$/u.test(prior) || NAME_CUES.has(prior) || PREPOSITIONS.has(prior)) continue;
    if (ARTICLES.has(prior) || DEMONSTRATIVES.has(prior)) continue;
    const end = m.index + typed.length;
    const [next = "", second = ""] = tokensAfter(ctx.text, end, 2);
    // The clause ends after it, or after its verb, zu-infinitive or particle ("Weiß gefärbt.",
    // "Mundtot zu machen", "Kahl aus.").
    const closes =
      (BOUNDARY.test(next) && next !== "-") ||
      (next === "zu" && germanInfinitive(second)) ||
      ((/^\p{Ll}*(?:ge\p{Ll}+(?:t|en)|iert)$/u.test(next) || PARTICLES.has(next)) &&
        BOUNDARY.test(second));
    if (!closes || ctx.dictionary.has(low)) continue;
    // "Lernt ihr Französisch?", "ist Norddeutsch": a language is a noun, unless it "kommt
    // einem spanisch vor".
    if (/(?:isch|deutsch)$/.test(low) && next !== "vor") continue;
    if (namedExampleBefore(ctx.text, m.index) || englishLine(ctx.text, m.index)) continue;
    findings.push({
      ruleId: "germanNounCasing",
      messageKey: "review_msg_german_not_noun",
      range: { start: m.index, end: m.index + 1 },
      alternatives: [typed[0].toLowerCase()],
      context: { start: Math.max(0, m.index - 40), end },
    });
  }
  return findings;
}
