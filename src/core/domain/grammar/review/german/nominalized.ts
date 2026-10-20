import { namedExampleBefore } from "../exampleCues";
import type { MatchFixer } from "../../engine/reviewRules";
import {
  deumlaut,
  germanAdjective,
  germanInfinitive,
  germanNounReading,
  germanVerbLike,
} from "./germanLexicon";
import {
  englishLine,
  governedBefore,
  PRONOMINAL_ADVERB,
  PRONOUNS,
  tokensAfter,
  tokensBefore,
  wordSet,
} from "./shared";

// Adjectives used as nouns are capitalized: "im Freien", "zum Guten", "aufs Neue", "das
// Beste daraus machen", "etwas Neues", "alles Gute", "auf Deutsch". Only where no noun
// follows that the adjective could belong to ("im freien Feld" stays).

// Lowercase is standard or allowed: "am besten", "die meisten", "alles andere", "etwas
// mehr", "ohne weiteres", "bei weitem".
const LOWERCASE_OK = wordSet(
  "anderen andere anderes einen einzige einzigen meisten wenigsten mindesten ganzen beiden " +
    "weiteres mehr weniger viele vieles einiges solches folgendes mögliche dasselbe " +
    "denselben demselben letzten nächsten ersten selben selbigen gleichen",
);
const ENDING = /^(.+?)(?:sten|ste|sten|e|en|em|er|es)$/;
// Stems of irregular comparatives and superlatives: "beste", "besseres", "höchste", "nächste".
const IRREGULAR: Readonly<Record<string, string>> = {
  be: "gut",
  besser: "gut",
  höch: "hoch",
  näch: "nah",
};
/**
 * Whether the word is an inflected adjective or superlative ("gröbste"); with `comparative`,
 * also a comparative or an irregular form ("schlimmeres", "besseres", "bestes").
 */
function adjectiveForm(typed: string, comparative = false): boolean {
  const stem = ENDING.exec(typed)?.[1];
  if (!stem) return false;
  if (comparative && IRREGULAR[stem]) return true;
  const stems = comparative ? [stem, stem.replace(/(?<=\p{L}{3})er$/u, "")] : [stem];
  return stems.some((s) => [s, `${s}e`, deumlaut(s)].some((form) => germanAdjective(form)));
}

// Words in -es that are determiners or pronouns, not adjectives.
const NOT_NEUTER_ADJECTIVES = wordSet(
  "alles etwas nichts dieses jenes welches manches solches folgendes vieles weniges anderes " +
    "einiges beides jedes keines meines deines seines ihres unseres eures eines dasselbe",
);
// Determiners that leave an adjective after them inflected for an elided noun ("ein neues").
const DETERMINER =
  /^(?:k?ein|[dms]ein|ihr|unser|euer|das|dies|jen|jed|welch|manch|solch|all|viel|wenig|etwas|nichts)(?:e|en|er|es|em)?$/;
const DEGREE = wordSet(
  "sehr ganz wirklich total allzu besonders ziemlich richtig echt so recht selbst",
);

/**
 * A strong neuter adjective with no determiner and no noun after it is a noun: "Was gibt es
 * neues?", "Wir wagen neues.", "um schlimmeres zu verhindern" ("Neues", "Schlimmeres"). Not
 * "ein neues" (an elided noun) or "neues Wissen".
 */
const bareNeuter: MatchFixer = (m, ctx) => {
  const typed = m[0];
  if (!/^\p{Ll}{2,}es$/u.test(typed) || NOT_NEUTER_ADJECTIVES.has(typed)) return null;
  if (LOWERCASE_OK.has(typed) || ctx.dictionary.has(typed) || germanNounReading(typed)) return null;
  if (!adjectiveForm(typed, true)) return null;
  const before = tokensBefore(ctx.text, m.index, 6);
  // Past degree words and other adjectives ("ein wirklich schönes neues").
  let at = before.length - 1;
  while (at > 0 && (DEGREE.has(before[at]) || before[at] === "," || adjectiveForm(before[at])))
    at--;
  const prior = before[at] ?? "";
  // A lowercase word that is no determiner; "als erstes" and colloquial "was neues" are
  // left to the frames and to the writer.
  if (
    !/^\p{Ll}+$/u.test(prior) ||
    DETERMINER.test(prior) ||
    /^(?:und|oder|sowie|als|was)$/.test(prior)
  )
    return null;
  const end = m.index + typed.length;
  const [next = "", second = ""] = tokensAfter(ctx.text, end, 2);
  // A noun after it, or a list that may end in one ("weltliches, sondern geistliches Amt").
  if (/^\p{Lu}/u.test(next) || /^(?:[-'’/,…]|und|oder|sowie|bzw|sondern|als)$/.test(next))
    return null;
  if (next === "." && second === ".") return null;
  const adjective = (w: string) => /^\p{Ll}+(?:e|en|er|es|em)$/u.test(w) && adjectiveForm(w);
  if (adjective(next) || (/^(?:,|und|oder)$/.test(next) && adjective(second))) return null;
  // "schönes wetter" (a noun typed lowercase), not "schlimmeres verhindern".
  const nextReading = germanNounReading(next);
  if (nextReading === "noun" || nextReading === "finite") return null;
  if (namedExampleBefore(ctx.text, m.index) || englishLine(ctx.text, m.index)) return null;
  return {
    ruleId: "germanNounCasing",
    messageKey: "review_msg_german_noun_case",
    range: { start: m.index, end: m.index + 1 },
    alternatives: [typed[0].toUpperCase()],
    context: { start: Math.max(0, m.index - 40), end },
  };
  return null;
};

/** A frame of a nominalized adjective; the frame owns no group, so the match start decides. */
const nominalizedFrame: MatchFixer = (m, ctx) => {
  const groups = m.indices!.groups ?? {};
  const name = [
    "target",
    "sup",
    "es",
    "e",
    "lang",
    "ganzen",
    "poss",
    "abs",
    "what",
    "fixed",
    "fixed2",
    "rank",
  ].find((k) => groups[k]);
  // The fixed phrases: capitalize the last word.
  const [start, end] = name
    ? groups[name]
    : [m.index + m[0].search(/\p{L}+$/u), m.index + m[0].length];
  if (start < ctx.from || start >= ctx.to) return null;
  const typed = ctx.text.slice(start, end);
  if (!/^\p{Ll}/u.test(typed) || ctx.dictionary.has(typed)) return null;
  const fixed = name === "fixed" || name === "fixed2" || name === "rank";
  // "im folgenden korrigierten Artikel": an attribute before its noun.
  if (fixed) {
    const after = tokensAfter(ctx.text, end, 1)[0] ?? "";
    // "die im folgenden beschriebene Geschichte", "im folgenden die Ursachen": an "-e" word
    // cannot follow "im" as its attribute.
    if (/^\p{Ll}+(?:en|er|es|em)$/u.test(after) && !germanInfinitive(after)) return null;
  }
  if (LOWERCASE_OK.has(typed) && name !== "what" && !fixed) return null;
  // "Dieses Konzept ist das beste, was …": a noun earlier in the sentence it may refer to.
  if (name === "what") {
    const sentence = ctx.text
      .slice(Math.max(0, start - 120), start)
      .split(/[.!?\n]/)
      .at(-1)!;
    if (/[ \t]\p{Lu}/u.test(sentence)) return null;
  }
  // "grau in grau": an idiom of the colour twice.
  if (ctx.text.slice(Math.max(0, m.index - typed.length - 1), m.index).trim() === typed)
    return null;
  // The word must be an adjective form (the languages are listed as such).
  if (
    name !== "lang" &&
    name !== "poss" &&
    name !== "what" &&
    name &&
    !fixed &&
    !adjectiveForm(typed)
  )
    return null;
  // A noun or another adjective after it: "im freien Feld", "etwas neues Wissen".
  const [next = "", second = ""] = tokensAfter(ctx.text, end, 2);
  // Coordinated or parenthesized adjectives: "im privaten und beruflichen Bereich",
  // "im äußeren, modernen Sinn", "ins pfälzische (bayerische) Dorf", "nicht im klaren,
  // sondern im komplizierten Stil".
  // "etwas Besonderes und dieses Jahr": after "etwas" only a second adjective before a noun
  // ("etwas neues und gutes Wissen") makes it an attribute.
  const pairedAttribute =
    name === "es" &&
    adjectiveForm(second) &&
    !NOT_NEUTER_ADJECTIVES.has(second) &&
    /^\p{Lu}/u.test(tokensAfter(ctx.text, end, 3)[2] ?? "");
  if (
    /^(?:und|oder|bzw|sowie|\()$/.test(next) &&
    name !== "ganzen" &&
    name !== "lang" &&
    (name !== "es" || next === "(" || pairedAttribute)
  )
    return null;
  if (next === "," && /^(?:sondern|\p{Ll}+(?:e|en|er|es|em))$/u.test(second)) return null;
  const adjectiveNext =
    /^\p{Ll}+(?:e|en|er|es|em)$/u.test(next) &&
    !germanVerbLike(next) &&
    !PRONOMINAL_ADVERB.test(next) &&
    !/^(?:hinter|unter|über|wider|aber|oder|sondern|weder|immer|wieder|gegen|ohne)$/.test(next);
  if (adjectiveNext && name !== "es" && name !== "e" && !fixed) return null;
  // "als erstes und einziges", "als letztes der Gase", "mehr als letztes?".
  if (!name && /^als/.test(m[0]) && !/^\p{Ll}+$/u.test(next)) return null;
  if (!name && /^als/.test(m[0]) && /^(?:der|des|die|das)$/.test(next)) return null;
  // "als erstes nach dem Krieg gebautes Auto": the first of an extended attribute.
  if (
    !name &&
    /^als/.test(m[0]) &&
    /^[^.!?,;:\n]{0,60}?\p{Ll}es[ \t]+\p{Lu}/u.test(ctx.text.slice(end, end + 80))
  )
    return null;
  // "über alles liebe": a verb.
  if (name === "e" && germanVerbLike(typed)) return null;
  if (/^\p{Lu}/u.test(next) && !/^(?:Sie|Ihnen|Ihr|Ihre)$/.test(next)) return null;
  if (/^\p{Ll}+(?:e|en|er|es|em)$/u.test(next) && germanAdjective(ENDING.exec(next)?.[1] ?? "")) {
    return null;
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
    return null;
  }
  if (namedExampleBefore(ctx.text, start)) return null;
  return {
    ruleId: "germanNounCasing",
    messageKey: "review_msg_german_noun_case",
    range: { start, end: start + 1 },
    alternatives: [typed[0].toUpperCase()],
    context: { start: m.index, end },
  };
};

/** The named frame fixes of the nominalized frames of the de.nounCasing rule. */
export const FIXERS = {
  bareNeuter,
  nominalizedFrame,
} satisfies Record<string, MatchFixer>;
