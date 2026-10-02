import { namedExampleBefore } from "../exampleCues";
import { frameMatches, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { germanAdjective, germanNounReading, germanVerbLike } from "./germanLexicon";
import { governedBefore, isGerman, PRONOUNS, tokensAfter, tokensBefore, wordSet } from "./shared";

// Adjectives used as nouns are capitalized: "im Freien", "zum Guten", "aufs Neue", "das
// Beste daraus machen", "etwas Neues", "alles Gute", "auf Deutsch". Only where no noun
// follows that the adjective could belong to ("im freien Feld" stays).

const ADJ = "(?<target>\\p{L}+)";
const FRAMES = [
  // Contractions: "im klaren", "zum besseren", "ins reine", "aufs neue", "vom schlimmsten".
  `(?:im|zum|vom|ins|aufs|beim|fürs|übers|durchs)${SPACE}${ADJ}`,
  // An article with a superlative: "auf das schlimmste", "mit dem schlimmsten", "das beste".
  `(?:das|dem|den|des)${SPACE}(?<sup>\\p{L}+?(?:st|ßt)(?:e|en))`,
  // "des weiteren", "des öfteren", "von neuem", "seit längerem", "um ein vielfaches".
  `(?:des${SPACE}(?:weiteren|öfteren|näheren)|von${SPACE}neuem|um${SPACE}ein${SPACE}vielfaches|als${SPACE}(?:erstes|nächstes|letztes)|fürs${SPACE}erste|im${SPACE}großen${SPACE}und${SPACE}(?<ganzen>ganzen))`,
  // "etwas neues", "nichts gutes", "viel schönes"; "alles gute".
  `(?:etwas|nichts|viel|wenig|allerlei|genug)${SPACE}(?<es>\\p{L}+es)|alles${SPACE}(?<e>\\p{L}+e)`,
  // A language as a noun: "auf deutsch", "in englisch", "kein französisch".
  `(?:auf|in|kein)${SPACE}(?<lang>deutsch|englisch|französisch|spanisch|italienisch|polnisch|russisch|türkisch|griechisch|schwedisch|portugiesisch|kroatisch|arabisch|chinesisch|japanisch|latein)`,
].map((f) => `(?:${f})${WORD_END}`);
// Lowercase is standard or allowed: "am besten", "die meisten", "alles andere", "etwas
// mehr", "ohne weiteres", "bei weitem".
const LOWERCASE_OK = wordSet(
  "anderen andere anderes einen einzigen meisten wenigsten mindesten ganzen beiden " +
    "weiteres mehr weniger viele vieles einiges solches folgendes mögliche dasselbe " +
    "denselben demselben letzten nächsten ersten",
);
const ENDING = /^(.+?)(?:sten|ste|sten|e|en|em|er|es)$/;

/** Run by germanNounCasing's detector (nounCasing.ts). */
export function nominalized(ctx: DetectContext): RawFinding[] {
  if (!isGerman(ctx)) return [];
  const findings: RawFinding[] = [];
  for (const frame of FRAMES) {
    for (const m of frameMatches(ctx, frame, null)) {
      const groups = m.indices!.groups ?? {};
      const name = ["target", "sup", "es", "e", "lang", "ganzen"].find((k) => groups[k]);
      // The fixed phrases: capitalize the last word.
      const [start, end] = name
        ? groups[name]
        : [m.index + m[0].search(/\p{L}+$/u), m.index + m[0].length];
      if (start < ctx.from || start >= ctx.to) continue;
      const typed = ctx.text.slice(start, end);
      if (!/^\p{Ll}/u.test(typed) || LOWERCASE_OK.has(typed) || ctx.dictionary.has(typed)) continue;
      // The word must be an adjective form (the languages are listed as such).
      const stem = ENDING.exec(typed)?.[1];
      if (
        name !== "lang" &&
        name &&
        (!stem || !(germanAdjective(stem) || germanAdjective(`${stem}e`)))
      ) {
        continue;
      }
      // A noun or another adjective after it: "im freien Feld", "etwas neues Wissen".
      const [next = "", second = ""] = tokensAfter(ctx.text, end, 2);
      // Coordinated or parenthesized adjectives: "im privaten und beruflichen Bereich",
      // "im äußeren, modernen Sinn", "ins pfälzische (bayerische) Dorf", "nicht im klaren,
      // sondern im komplizierten Stil".
      if (/^(?:und|oder|bzw|sowie|\()$/.test(next) && name !== "ganzen") continue;
      if (next === "," && /^(?:sondern|\p{Ll}+(?:e|en|er|es|em))$/u.test(second)) continue;
      const adjectiveNext = /^\p{Ll}+(?:e|en|er|es|em)$/u.test(next) && !germanVerbLike(next);
      if (adjectiveNext && name !== "es" && name !== "e") continue;
      // "als erstes und einziges", "als letztes der Gase", "mehr als letztes?".
      if (!name && /^als/.test(m[0]) && !/^\p{Ll}+$/u.test(next)) continue;
      if (!name && /^als/.test(m[0]) && /^(?:der|des|die|das)$/.test(next)) continue;
      // "über alles liebe": a verb.
      if (name === "e" && germanVerbLike(typed)) continue;
      if (/^\p{Lu}/u.test(next) && !/^(?:Sie|Ihnen|Ihr|Ihre)$/.test(next)) continue;
      if (
        /^\p{Ll}+(?:e|en|er|es|em)$/u.test(next) &&
        germanAdjective(ENDING.exec(next)?.[1] ?? "")
      ) {
        continue;
      }
      // "fürs hartnäckige nachfragen": the adjective of a noun typed lowercase.
      // Not where it is the verb: "im allgemeinen stimme ich", "wird sich zum guten wenden".
      const nextNoun = next.length > 2 ? germanNounReading(next) : null;
      const before = tokensBefore(ctx.text, m.index, 12);
      if (
        nextNoun === "noun" ||
        (nextNoun === "finite" && !PRONOUNS.has(second.toLowerCase())) ||
        (nextNoun === "infinitive" && name === "target" && !governedBefore(before, before.length))
      ) {
        continue;
      }
      if (namedExampleBefore(ctx.text, start)) continue;
      findings.push({
        ruleId: "germanNounCasing",
        messageKey: "review_msg_german_noun_case",
        range: { start, end: start + 1 },
        alternatives: [typed[0].toUpperCase()],
        context: { start: m.index, end },
      });
    }
  }
  return findings;
}
