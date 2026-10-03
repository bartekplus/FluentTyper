import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { determinerFits } from "./articleGender";
import {
  germanAdjective,
  germanGender,
  germanListedNoun,
  germanNounReading,
} from "./germanLexicon";
import { ARTICLES, DEMONSTRATIVES, PREPOSITIONS } from "./nounCasing";
import { BOUNDARY, isGerman, PRONOUNS, tokensAfter, tokensBefore, words } from "./shared";

// A compound noun written as two words: "elf Fußball Spieler" (Fußballspieler), "die Abfahrts
// Zeiten" (Abfahrtszeiten), "einen Pflege Fall" (Pflegefall). Flagged only when the joined word
// is a known noun and the first word cannot stand alone there: it is no word of its own
// ("Abfahrts"), or a number or a determiner before it fits the compound and not the first noun.

const SECOND = /^[ \t]+(\p{Lu}\p{Ll}{2,})(?![\p{L}\p{M}\p{N}_@/#\\-])/u;
const NUMBER =
  /^(?:\p{N}+|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf|viele|mehrere)$/iu;
// Words before a name, so the pair after them is a name ("Herr Fuchs Bauer").
const FUNCTION_WORDS = new Set([
  ...ARTICLES,
  ...DEMONSTRATIVES,
  ...PREPOSITIONS,
  ...PRONOUNS,
  ..."ein kein mehr viel wenig ganz halb so sehr nur auch noch schon gut neu alle".split(" "),
]);
// Superlative and other stems that only open compounds ("Kleinst|lebewesen", "Selbst|achtung").
const STEMS = /^(?:kleinst|größt|höchst|mindest|best|selbst|meist)$/;
/** A noun with a linking -s, -es, -n or -en ("Abfahrts", "Hochleistungs", "Behinderten"). */
const linked = (word: string) =>
  ["s", "es", "n", "en"].some(
    (end) =>
      word.endsWith(end) &&
      word.length - end.length >= 3 &&
      germanNounReading(word.slice(0, -end.length)) !== null,
  );
const TITLES = /^(?:Herr|Herrn|Frau|Dr|Prof|Familie|Firma|St|Sankt)$/;

// Determiners and counts after which an adjective before a noun takes an ending. Forms that
// also stand alone as a pronoun or a verb ("eine", "meinen", "sein") are left out, and "der",
// "die", "das" count only at a sentence start ("in dem ständig Soldaten" is a relative clause).
const DETERMINED = new Set(
  [...ARTICLES, ..."viele vielen mehrere mehreren einige einigen beide beiden".split(" ")].filter(
    (w) => !/^(?:k?ein(?:e|er|es)|meinen?|deine|seine?|ihre|unsere|eure)$/.test(w),
  ),
);
const SENTENCE_DETERMINERS = new Set([...DEMONSTRATIVES]);
// Adjectives that take no ending ("ein lila Kleid", "eine super Idee") or that make a fixed
// phrase with a noun ("ein wenig Zeit", "ein gut Stück"), and adverbs that the dictionary also
// lists as adjectives ("Die erst Mitte Mai gefundene …").
const UNINFLECTED = new Set(
  (
    "lila rosa pink beige orange oliv super klasse prima spitze extra top mega okay live online " +
    "offline cool fair gratis egal pleite schuld quitt wenig viel mehr genug ganz gut klein halt " +
    "solch welch manch paar bisschen recht echt voll erst sicher natürlich wirklich ziemlich " +
    "bestimmt eben kaum fast gleich"
  ).split(" "),
);

/**
 * "im roh Zustand", "eine trans Frau", "zwei halb Brüder": an adjective with no ending between
 * a determiner and a noun. An adjective there takes an ending, so the two words are one
 * compound ("Rohzustand"). Lemmas in -e ("die müde Frau") already show an ending.
 */
function splitAdjective(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const first = m[0];
  if (!/^\p{Ll}{2,}$/u.test(first) || /e$/.test(first) || UNINFLECTED.has(first)) return null;
  // "der vorangegangen Frage": a participle that lacks its ending, no compound part.
  if (ARTICLES.has(first) || DEMONSTRATIVES.has(first) || /ge\p{Ll}{2,}en$/u.test(first))
    return null;
  if (!germanAdjective(first) || germanNounReading(first) !== null) return null;
  const end = m.index + first.length;
  const pair = SECOND.exec(ctx.text.slice(end, end + 48));
  if (!pair) return null;
  const second = pair[1];
  const low = second.toLowerCase();
  // A noun, not an adjective or participle used as one ("das politisch Machbare").
  if (germanListedNoun(low) === null || germanAdjective(low.replace(/(?:e|en|er|es|em)$/, ""))) {
    return null;
  }
  // "sein eigen Fleisch und Blut": an old fixed phrase.
  if (first === "eigen" && low === "fleisch") return null;
  const before = tokensBefore(ctx.text, m.index, 2);
  const prior = before.at(-1) ?? "";
  const opening = before.length < 2 || /^[.!?:\n„“"»«]$/.test(before[0]);
  const det = prior.toLowerCase();
  if (!DETERMINED.has(det) && !NUMBER.test(prior) && !(opening && SENTENCE_DETERMINERS.has(det)))
    return null;
  const stop = end + pair[0].length;
  // A longer name after it ("die frei Wählbare Liste"), or an extended attribute whose object
  // the noun is ("die schnell Hilfe leistenden Helfer").
  const next = tokensAfter(ctx.text, stop, 1)[0] ?? "";
  if (/^\p{Lu}/u.test(next) || attribute(next)) return null;
  if (ctx.dictionary.has(first) || ctx.dictionary.has(low)) return null;
  if (namedExampleBefore(ctx.text, m.index)) return null;
  return {
    ruleId: "germanCompounds",
    messageKey: "review_msg_closed_compound",
    range: { start: m.index, end: stop },
    alternatives: [first[0].toUpperCase() + first.slice(1) + low],
    context: { start: Math.max(0, m.index - 40), end: stop + 20 },
  };
}

/** An inflected adjective or a participle ("getarnte", "leistenden", "einquartiert"). */
const attribute = (w: string) =>
  /^\p{Ll}*(?:ge\p{Ll}+(?:t|en)|iert|end)(?:e|en|er|es|em)?$/u.test(w) ||
  (/^\p{Ll}+(?:e|en|er|es|em)$/u.test(w) && germanAdjective(w.replace(/(?:e|en|er|es|em)$/, "")));

export function nounPairs(ctx: DetectContext): RawFinding[] {
  if (!isGerman(ctx)) return [];
  const findings: RawFinding[] = [];
  for (const m of words(ctx)) {
    const first = m[0];
    const split = splitAdjective(ctx, m);
    if (split) findings.push(split);
    if (!/^\p{Lu}\p{Ll}{2,}$/u.test(first)) continue;
    const end = m.index + first.length;
    const pair = SECOND.exec(ctx.text.slice(end, end + 48));
    if (!pair) continue;
    const second = pair[1];
    const joined = first.toLowerCase() + second.toLowerCase();
    const low = first.toLowerCase();
    // Both parts German nouns or opening parts ("Joint Venture", "Game Boys" stay English).
    if (joined.length < 8 || germanNounReading(joined) === null) continue;
    if (germanListedNoun(second.toLowerCase()) === null || FUNCTION_WORDS.has(low)) continue;
    if (ctx.dictionary.has(low) || ctx.dictionary.has(second.toLowerCase())) continue;
    const before = tokensBefore(ctx.text, m.index, 2);
    const prior = before.at(-1) ?? "";
    const next = tokensAfter(ctx.text, end + pair[0].length, 1)[0] ?? "";
    // A longer name or title: a capitalized word right before (not at a sentence start) or after.
    if (/^\p{Lu}/u.test(next) || TITLES.test(prior)) continue;
    if (/^\p{Lu}/u.test(prior) && !BOUNDARY.test(before.at(-2) ?? "")) continue;
    // A noun of its own ("Fußball Spieler" may be two nouns) needs a number or a determiner that
    // fits the compound and not the first noun; "Abfahrts", "Kleinst", "Regional" are none.
    const opening = BOUNDARY.test(prior);
    // At a sentence start a capitalized adjective or adverb is no part ("Viel Spaß").
    if (opening && germanAdjective(low)) continue;
    // "Abfahrts", "Zeitungs": a feminine noun takes no -s of its own, so it links a compound.
    const linking =
      /(?:ung|heit|keit|schaft|ion|tät)s$/.test(low) ||
      (/s$/.test(low) && germanGender(low.slice(0, -1))?.gender === "f");
    const noun = germanNounReading(low) !== null;
    if (noun && !linking) {
      const counted = NUMBER.test(prior) && /(?:er|en|n|e|s)$/.test(second);
      const fits = determinerFits(prior, first) !== true && determinerFits(prior, second);
      if (!counted && !fits) continue;
    } else if (!noun && !germanAdjective(low) && !STEMS.test(low) && !linked(low)) continue;
    if (namedExampleBefore(ctx.text, m.index)) continue;
    const stop = end + pair[0].length;
    findings.push({
      ruleId: "germanCompounds",
      messageKey: "review_msg_closed_compound",
      range: { start: m.index, end: stop },
      alternatives: [first + second.toLowerCase()],
      context: { start: Math.max(0, m.index - 40), end: stop + 20 },
    });
  }
  return findings;
}
