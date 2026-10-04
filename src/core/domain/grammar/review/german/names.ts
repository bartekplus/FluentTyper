import { namedExampleBefore } from "../exampleCues";
import { frameMatches, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { isGerman, WORD_GATE } from "./shared";

// Names of several words capitalize their adjective too: "der Erste Weltkrieg", "die
// Französische Revolution", "im Nahen Osten". Each pair is "adjective stem:noun"; a leading "!"
// marks a name the words never spell generically, the others need a definite article before
// them ("ein rotes Kreuz" is any red cross, "das Rote Kreuz" the organization). Authored.
const PAIRS = (
  "!erst:Weltkrieg !zweit:Weltkrieg !französisch:Revolution !dreißigjährig:Krieg " +
  "!hundertjährig:Krieg !siebenjährig:Krieg !transsibirisch:Eisenbahn !westfälisch:Frieden " +
  "chinesisch:Mauer rot:Armee rot:Kreuz rot:Meer schwarz:Meer tot:Meer still:Ozean " +
  "indisch:Ozean atlantisch:Ozean kalt:Krieg heilig:Abend heilig:Schrift heilig:Geist " +
  "heilig:Land vereint:Nationen europäisch:Union europäisch:Zentralbank " +
  "europäisch:Kommission nah:Osten fern:Osten mittler:Osten sächsisch:Schweiz " +
  "fränkisch:Schweiz holsteinisch:Schweiz märkisch:Schweiz böhmisch:Schweiz schwäbisch:Alb " +
  "olympisch:Spiele römisch:Reich jüngst:Gericht " +
  "letzt:Abendmahl vereinigt:Staaten vereinigt:Königreich tschechisch:Republik " +
  "dominikanisch:Republik zentralafrikanisch:Republik kanarisch:Inseln britisch:Inseln " +
  "balearisch:Inseln ewig:Stadt dritt:Welt dritt:Reich golden:Zwanziger " +
  "international:Währungsfonds international:Strafgerichtshof bayerisch:Rundfunk " +
  "!trojanisch:Krieg !unbefleckt:Empfängnis !hängend:Gärten !hoh:Tatra !groß:Walachei " +
  "!klein:Walachei !statistisch:Bundesamt !gelb:Fluss bayerisch:Fernsehen deutsch:Bank " +
  "deutsch:Bund demokratisch:Republik demokratisch:Volksrepublik islamisch:Republik " +
  "türkisch:Republik heilig:Vater englisch:Garten schief:Turm gelb:Seiten"
).split(" ");
// Names of two adjectives and a noun, each adjective capitalized (authored).
const TRIPLES = new Set(
  (
    "heilig römisch:reich zweit deutsch:fernsehen erst deutsch:fernsehen " +
    "national olympisch:komitee international olympisch:komitee"
  ).split(/ (?=\p{Ll}+ )/u),
);
const TRIPLE = new RegExp(
  `${WORD_GATE}(?<first>\\p{L}+?(?:e|en|er|es|em))${SPACE}(?<second>\\p{L}+?(?:e|en|er|es|em))${SPACE}(?<noun>Reich|Fernsehen|Komitee)(?:es|s)?${WORD_END}`,
  "gdu",
);
// "Reich deutscher Nation": the genitive closes the name.
const NATION = new RegExp(
  `Reich(?:es|s)?${SPACE}(?<target>deutscher)${SPACE}Nation${WORD_END}`,
  "gdu",
);
// Adjectives of places in -er are capitalized and never inflect: "Wiener Kongress", "Berliner
// Mauer", "Schweizer Käse" (authored).
const PLACE_ADJECTIVE = new RegExp(
  `${WORD_GATE}(?<target>(?:wiener|berliner|münchner|münchener|hamburger|kölner|frankfurter|stuttgarter|dresdner|leipziger|bremer|nürnberger|düsseldorfer|bonner|heidelberger|zürcher|basler|berner|grazer|salzburger|innsbrucker|schweizer|pariser|londoner|römer|prager|mailänder|venezianer)${SPACE}\\p{Lu}\\p{Ll})`,
  "gdu",
);
const ALWAYS = new Set(PAIRS.filter((p) => p.startsWith("!")).map((p) => p.slice(1)));
const NAMES = new Set(PAIRS.map((p) => p.replace("!", "")));
const NOUN_SET = new Set(PAIRS.map((p) => p.split(":")[1]));
const NOUNS = [...NOUN_SET].join("|");
const DEFINITE = /(?<![\p{L}\p{N}])(?:der|die|das|des|dem|den|im|am|vom|zum|zur|beim|ins)[ \t]+$/iu;
const NAME = new RegExp(
  `${WORD_GATE}(?<adj>\\p{Ll}+?(?:e|en|er|es|em))${SPACE}(?<noun>(?:${NOUNS})(?:es|s|n)?)${WORD_END}`,
  "gdu",
);

// Adjective and noun pairs that are no names, so the adjective stays lowercase inside a sentence:
// "grüner Tee", "künstliche Intelligenz", "mit freundlichen Grüßen" (authored).
const LOWER_PAIRS = new Set(
  (
    "grün:Tee schwarz:Tee klein:Einmaleins groß:Einmaleins olympisch:Feuer linear:Algebra " +
    "analytisch:Geometrie englisch:Rasen künstlich:Intelligenz sozial:Netzwerk sozial:Netzwerke " +
    "sozial:Medien erneuerbar:Energien erneuerbar:Energie öffentlich:Dienst mittler:Reife " +
    "rot:Faden kalt:Buffet höher:Gewalt freundlich:Grüße freundlich:Grüßen herzlich:Grüße " +
    "herzlich:Grüßen lieb:Grüße lieb:Grüßen best:Grüße best:Grüßen neu:Jahr recht:Winkel " +
    "spitz:Winkel stumpf:Winkel offen:Tür elektrisch:Feld elektrisch:Feldstärke " +
    "elektrisch:Strom magnetisch:Feld mittler:Bildungsabschluss mittler:Bildungsabschlüsse " +
    "gesund:Menschenverstand"
  ).split(" "),
);
const LOWER_NOUNS = [...new Set([...LOWER_PAIRS].map((p) => p.split(":")[1]))].join("|");
const CAPITALIZED = new RegExp(
  `${WORD_GATE}(?<adj>\\p{Lu}\\p{Ll}+?(?:e|en|er|es|em))${SPACE}(?<noun>(?:${LOWER_NOUNS})(?:es|s|n)?)${WORD_END}`,
  "gdu",
);

const stemOf = (adj: string) => adj.toLowerCase().replace(/(?:e|en|er|es|em)$/, "");
// The noun without a case or plural ending: "Tees", "Feldes", "Winkeln".
const lemmas = (noun: string) => [
  noun,
  ...["s", "es", "n"].map((e) => noun.replace(new RegExp(`${e}$`), "")),
];

/** Run by germanNounCasing's detector (nounCasing.ts). */
export function names(ctx: DetectContext): RawFinding[] {
  if (!isGerman(ctx)) return [];
  const findings: RawFinding[] = [];
  const push = (start: number, context: { start: number; end: number }) => {
    const word = /^\p{L}+/u.exec(ctx.text.slice(start))?.[0] ?? "";
    if (!/^\p{Ll}/u.test(word) || ctx.dictionary.has(word) || namedExampleBefore(ctx.text, start))
      return;
    findings.push({
      ruleId: "germanNounCasing",
      messageKey: "review_msg_german_name_case",
      range: { start, end: start + 1 },
      alternatives: [word[0].toUpperCase()],
      context,
    });
  };
  for (const m of frameMatches(ctx, TRIPLE, "first")) {
    const { first, second, noun } = m.groups!;
    if (!TRIPLES.has(`${stemOf(first)} ${stemOf(second)}:${noun.toLowerCase()}`)) continue;
    const context = { start: m.index, end: m.index + m[0].length };
    push(m.indices!.groups!.first[0], context);
    push(m.indices!.groups!.second[0], context);
  }
  for (const m of frameMatches(ctx, CAPITALIZED, "adj")) {
    const { adj, noun } = m.groups!;
    const lemma = lemmas(noun).find((n) => LOWER_PAIRS.has(`${stemOf(adj)}:${n}`));
    const start = m.index + m[0].indexOf(adj);
    // Not at the start of a sentence, line or quotation, where the capital is due anyway.
    const before = ctx.text.slice(Math.max(0, start - 4), start);
    if (!lemma || start === 0 || /(?:^|[.!?:\n„“"»«])[ \t]*$/.test(before)) continue;
    if (ctx.dictionary.has(adj.toLowerCase()) || namedExampleBefore(ctx.text, start)) continue;
    findings.push({
      ruleId: "germanNounCasing",
      messageKey: "review_msg_german_adjective_lowercase",
      range: { start, end: start + 1 },
      alternatives: [adj[0].toLowerCase()],
      context: { start, end: m.index + m[0].length },
    });
  }
  for (const regex of [NATION, PLACE_ADJECTIVE]) {
    for (const m of frameMatches(ctx, regex)) {
      push(m.indices!.groups!.target[0], { start: m.index, end: m.index + m[0].length });
    }
  }
  for (const m of frameMatches(ctx, NAME, "adj")) {
    const { adj, noun } = m.groups!;
    const lemma = [noun, noun.replace(/(?:es|s|n)$/, "")].find((n) => NOUN_SET.has(n));
    const stem = adj.replace(/(?:e|en|er|es|em)$/, "");
    const pair = `${stem}:${lemma}`;
    if (!lemma || !NAMES.has(pair)) continue;
    const [start] = m.indices!.groups!.adj;
    const before = ctx.text.slice(Math.max(0, start - 12), start);
    if (!ALWAYS.has(pair) && !DEFINITE.test(before)) continue;
    if (ctx.dictionary.has(adj) || namedExampleBefore(ctx.text, start)) continue;
    findings.push({
      ruleId: "germanNounCasing",
      messageKey: "review_msg_german_name_case",
      range: { start, end: start + 1 },
      alternatives: [adj[0].toUpperCase()],
      context: { start: m.index, end: m.indices!.groups!.noun[1] },
    });
  }
  return findings;
}
