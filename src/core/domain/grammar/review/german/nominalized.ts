import { namedExampleBefore } from "../exampleCues";
import { frameMatches, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import {
  germanAdjective,
  germanInfinitive,
  germanNounReading,
  germanVerbLike,
} from "./germanLexicon";
import {
  englishLine,
  governedBefore,
  isGerman,
  PRONOMINAL_ADVERB,
  PRONOUNS,
  tokensAfter,
  tokensBefore,
  words,
  wordSet,
} from "./shared";

// Adjectives used as nouns are capitalized: "im Freien", "zum Guten", "aufs Neue", "das
// Beste daraus machen", "etwas Neues", "alles Gute", "auf Deutsch". Only where no noun
// follows that the adjective could belong to ("im freien Feld" stays).

const ADJ = "(?<target>\\p{L}+)";
const LANGUAGES =
  "deutsch|englisch|französisch|spanisch|italienisch|polnisch|russisch|türkisch|griechisch|schwedisch|portugiesisch|kroatisch|arabisch|chinesisch|japanisch|latein";
const FRAMES = [
  // Contractions: "im klaren", "zum besseren", "ins reine", "aufs neue", "vom schlimmsten".
  `(?:im|zum|vom|ins|aufs|beim|fürs|übers|durchs)${SPACE}${ADJ}`,
  // An article with a superlative: "auf das schlimmste", "mit dem schlimmsten", "das beste".
  `(?:das|dem|den|des)${SPACE}(?<sup>\\p{L}+?(?:st|ßt)(?:e|en))`,
  // "des weiteren", "des öfteren", "von neuem", "seit längerem", "um ein vielfaches".
  `(?:des${SPACE}(?:weiteren|öfteren|näheren)|von${SPACE}neuem|um${SPACE}ein${SPACE}vielfaches|als${SPACE}(?:erstes|nächstes|letztes)|fürs${SPACE}erste|im${SPACE}großen${SPACE}und${SPACE}(?<ganzen>ganzen))`,
  // "etwas neues", "nichts gutes", "viel schönes", "etwas ganz besonderes", "nichts allzu
  // gutes"; "alles gute", "manches schöne".
  // "mit etwas leckerem" (dative), "etwas teures und schönes" (the second of two).
  `(?:etwas|nichts|viel|wenig|allerlei|genug)(?:${SPACE}(?:sehr|ganz|wirklich|total|allzu|besonders|ziemlich|richtig|echt|ganz${SPACE}schön)){0,2}${SPACE}(?<es>\\p{L}+e[sm])|(?:alles|manches)${SPACE}(?<e>\\p{L}+e)`,
  `(?:etwas|nichts|viel|wenig)${SPACE}\\p{Ll}+e[sm]${SPACE}(?:und|oder|sowie)${SPACE}(?<es>\\p{L}+e[sm])`,
  // "sein bestes geben", "ihr möglichstes tun", "mein erspartes".
  `(?:mein|dein|sein|ihr|unser|euer)${SPACE}(?<poss>bestes|möglichstes|übriges|erspartes|liebstes)`,
  // "das schöne daran", "das wichtige an der Sache", "das gute am Plan".
  `[Dd]as${SPACE}(?<abs>\\p{Ll}+e)(?=${SPACE}(?:daran|dabei|darin|daraus|darauf|am|an${SPACE}(?:der|dem|den|diesem|dieser|ihm|ihr)))`,
  // "das beste, was …", "das erste, worauf …": a superlative or ordinal with "was" or a
  // wo-word after it is a noun ("Von den Bildern ist das das schönste, das …" may refer back).
  `[Dd]as${SPACE}(?<what>\\p{Ll}+(?:st|ßt)e|erste|letzte|einzige|nächste)(?=,${SPACE}(?:was|wo|wor)\\p{Ll}*${WORD_END})`,
  // A colour as a noun: "in weiß heiraten", "auf grün stehen", "die Farbe rot".
  `(?:in|auf|von|nach|[Ff]arbe)${SPACE}(?<lang>weiß|schwarz|rot|blau|grün|gelb|grau|braun|lila|rosa|orange|türkis|violett|beige)(?=[ \\t]*[.!?,;])`,
  // A language as a noun: "auf deutsch", "in englisch", "kein französisch".
  `(?:auf|in|kein)${SPACE}(?<lang>${LANGUAGES})`,
  // The language one learns, teaches, understands or speaks: "Englisch lernen", "spricht
  // Deutsch", "kann Französisch sprechen" (not "sich deutsch unterhalten").
  `(?<lang>${LANGUAGES})(?=${SPACE}(?:zu${SPACE})?(?:lernen|lernt|lerne|lernst|gelernt|unterrichten|unterrichtet|unterrichte|verstehen|versteht|verstehe|verstanden|beherrschen|beherrscht|beherrsche|studieren|studiert|studiere)${WORD_END})`,
  `(?<=(?:kann|kannst|können|könnt|konnte|konnten|möchte|möchten|will|wollen)${SPACE}(?:\\p{Ll}+${SPACE})?)(?<lang>${LANGUAGES})(?=${SPACE}(?:sprechen|reden|lesen|schreiben)${WORD_END})`,
  `(?<=(?:lernt|lerne|lernst|lernen|lernte|lernten|unterrichtet|unterrichte|unterrichten|versteht|verstehe|verstehen|beherrscht|beherrsche|beherrschen|studiert|studiere|studieren|spricht|sprichst|spreche|sprechen|sprach)${SPACE}(?:(?:gut|fließend|perfekt|kein|etwas|nur|auch|schon|gerade|jetzt|noch|wieder|sehr${SPACE}gut)${SPACE})?)(?<lang>${LANGUAGES})(?=[ \\t]*[.!?,;]|${SPACE}(?:und|oder|als|mit|in)${WORD_END})`,
  // Fixed phrases with a nominalized adjective or adverb: "im Folgenden", "im Voraus", "im
  // Übrigen", "zum Besten geben".
  `(?:im|Im)${SPACE}(?<fixed>folgenden|weiteren|voraus|übrigen|nachhinein|vorhinein|allgemeinen|einzelnen|wesentlichen)|zum${SPACE}(?<fixed2>besten)(?=${SPACE}(?:geben|gab|gibt|gegeben|halten|hält|hielt|gehalten|haben))`,
].map((f) => `(?:${f})${WORD_END}`);
// Lowercase is standard or allowed: "am besten", "die meisten", "alles andere", "etwas
// mehr", "ohne weiteres", "bei weitem".
const LOWERCASE_OK = wordSet(
  "anderen andere anderes einen einzige einzigen meisten wenigsten mindesten ganzen beiden " +
    "weiteres mehr weniger viele vieles einiges solches folgendes mögliche dasselbe " +
    "denselben demselben letzten nächsten ersten",
);
const ENDING = /^(.+?)(?:sten|ste|sten|e|en|em|er|es)$/;
// Stems of irregular comparatives and superlatives: "beste", "besseres", "höchste", "nächste".
const IRREGULAR: Readonly<Record<string, string>> = {
  be: "gut",
  besser: "gut",
  höch: "hoch",
  näch: "nah",
};
const deumlaut = (w: string) => w.replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u");
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
function bareNeuter(ctx: DetectContext, findings: RawFinding[]): void {
  for (const m of words(ctx)) {
    const typed = m[0];
    if (!/^\p{Ll}{2,}es$/u.test(typed) || NOT_NEUTER_ADJECTIVES.has(typed)) continue;
    if (LOWERCASE_OK.has(typed) || ctx.dictionary.has(typed) || germanNounReading(typed)) continue;
    if (!adjectiveForm(typed, true)) continue;
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
      continue;
    const end = m.index + typed.length;
    const [next = "", second = ""] = tokensAfter(ctx.text, end, 2);
    // A noun after it, or a list that may end in one ("weltliches, sondern geistliches Amt").
    if (/^\p{Lu}/u.test(next) || /^(?:[-'’/,…]|und|oder|sowie|bzw|sondern|als)$/.test(next))
      continue;
    if (next === "." && second === ".") continue;
    const adjective = (w: string) => /^\p{Ll}+(?:e|en|er|es|em)$/u.test(w) && adjectiveForm(w);
    if (adjective(next) || (/^(?:,|und|oder)$/.test(next) && adjective(second))) continue;
    // "schönes wetter" (a noun typed lowercase), not "schlimmeres verhindern".
    const nextReading = germanNounReading(next);
    if (nextReading === "noun" || nextReading === "finite") continue;
    if (namedExampleBefore(ctx.text, m.index) || englishLine(ctx.text, m.index)) continue;
    findings.push({
      ruleId: "germanNounCasing",
      messageKey: "review_msg_german_noun_case",
      range: { start: m.index, end: m.index + 1 },
      alternatives: [typed[0].toUpperCase()],
      context: { start: Math.max(0, m.index - 40), end },
    });
  }
}

/** Run by germanNounCasing's detector (nounCasing.ts). */
export function nominalized(ctx: DetectContext): RawFinding[] {
  if (!isGerman(ctx)) return [];
  const findings: RawFinding[] = [];
  bareNeuter(ctx, findings);
  for (const frame of FRAMES) {
    for (const m of frameMatches(ctx, frame, null)) {
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
      ].find((k) => groups[k]);
      // The fixed phrases: capitalize the last word.
      const [start, end] = name
        ? groups[name]
        : [m.index + m[0].search(/\p{L}+$/u), m.index + m[0].length];
      if (start < ctx.from || start >= ctx.to) continue;
      const typed = ctx.text.slice(start, end);
      if (!/^\p{Ll}/u.test(typed) || ctx.dictionary.has(typed)) continue;
      const fixed = name === "fixed" || name === "fixed2";
      // "im folgenden korrigierten Artikel": an attribute before its noun.
      if (fixed) {
        const after = tokensAfter(ctx.text, end, 1)[0] ?? "";
        if (/^\p{Ll}+(?:e|en|er|es|em)$/u.test(after) && !germanInfinitive(after)) continue;
      }
      if (LOWERCASE_OK.has(typed) && name !== "what" && !fixed) continue;
      // "Dieses Konzept ist das beste, was …": a noun earlier in the sentence it may refer to.
      if (name === "what") {
        const sentence = ctx.text
          .slice(Math.max(0, start - 120), start)
          .split(/[.!?\n]/)
          .at(-1)!;
        if (/[ \t]\p{Lu}/u.test(sentence)) continue;
      }
      // "grau in grau": an idiom of the colour twice.
      if (ctx.text.slice(Math.max(0, m.index - typed.length - 1), m.index).trim() === typed)
        continue;
      // The word must be an adjective form (the languages are listed as such).
      if (
        name !== "lang" &&
        name !== "poss" &&
        name !== "what" &&
        name &&
        !fixed &&
        !adjectiveForm(typed)
      )
        continue;
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
        continue;
      if (next === "," && /^(?:sondern|\p{Ll}+(?:e|en|er|es|em))$/u.test(second)) continue;
      const adjectiveNext =
        /^\p{Ll}+(?:e|en|er|es|em)$/u.test(next) &&
        !germanVerbLike(next) &&
        !PRONOMINAL_ADVERB.test(next) &&
        !/^(?:hinter|unter|über|wider|aber|oder|sondern|weder|immer|wieder|gegen|ohne)$/.test(next);
      if (adjectiveNext && name !== "es" && name !== "e") continue;
      // "als erstes und einziges", "als letztes der Gase", "mehr als letztes?".
      if (!name && /^als/.test(m[0]) && !/^\p{Ll}+$/u.test(next)) continue;
      if (!name && /^als/.test(m[0]) && /^(?:der|des|die|das)$/.test(next)) continue;
      // "als erstes nach dem Krieg gebautes Auto": the first of an extended attribute.
      if (
        !name &&
        /^als/.test(m[0]) &&
        /^[^.!?,;:\n]{0,60}?\p{Ll}es[ \t]+\p{Lu}/u.test(ctx.text.slice(end, end + 80))
      )
        continue;
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
