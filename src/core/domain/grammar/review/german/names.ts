import { namedExampleBefore } from "../exampleCues";
import type { MatchFixer } from "../../engine/reviewRules";
import type { DetectContext } from "../reviewDetectors";

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
const ALWAYS = new Set(PAIRS.filter((p) => p.startsWith("!")).map((p) => p.slice(1)));
const NAMES = new Set(PAIRS.map((p) => p.replace("!", "")));
const NOUN_SET = new Set(PAIRS.map((p) => p.split(":")[1]));
const DEFINITE = /(?<![\p{L}\p{N}])(?:der|die|das|des|dem|den|im|am|vom|zum|zur|beim|ins)[ \t]+$/iu;

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

const stemOf = (adj: string) => adj.toLowerCase().replace(/(?:e|en|er|es|em)$/, "");
// The noun without a case or plural ending: "Tees", "Feldes", "Winkeln".
const lemmas = (noun: string) => [
  noun,
  ...["s", "es", "n"].map((e) => noun.replace(new RegExp(`${e}$`), "")),
];

/** A capital for the lowercase word at `start` of a name. */
function capital(ctx: DetectContext, start: number, context: { start: number; end: number }) {
  const word = /^\p{L}+/u.exec(ctx.text.slice(start))?.[0] ?? "";
  if (!/^\p{Ll}/u.test(word) || ctx.dictionary.has(word) || namedExampleBefore(ctx.text, start))
    return null;
  return {
    ruleId: "germanNounCasing" as const,
    messageKey: "review_msg_german_name_case" as const,
    range: { start, end: start + 1 },
    alternatives: [word[0].toUpperCase()],
    context,
  };
}

/** The named frame fixes of the name frames of the de.nounCasing rule (grammar/rules/de.yaml). */
export const FIXERS = {
  nameTriple: (m, ctx) => {
    const { first, second, noun } = m.groups!;
    if (!TRIPLES.has(`${stemOf(first)} ${stemOf(second)}:${noun.toLowerCase()}`)) return null;
    const context = { start: m.index, end: m.index + m[0].length };
    return [
      capital(ctx, m.indices!.groups!.first[0], context),
      capital(ctx, m.indices!.groups!.second[0], context),
    ].filter((f) => f !== null);
  },
  lowercaseAdjective: (m, ctx) => {
    const { adj, noun } = m.groups!;
    const lemma = lemmas(noun).find((n) => LOWER_PAIRS.has(`${stemOf(adj)}:${n}`));
    const start = m.index + m[0].indexOf(adj);
    // Not at the start of a sentence, line or quotation, where the capital is due anyway.
    const before = ctx.text.slice(Math.max(0, start - 4), start);
    if (!lemma || start === 0 || /(?:^|[.!?:\n„“"»«])[ \t]*$/.test(before)) return null;
    if (ctx.dictionary.has(adj.toLowerCase()) || namedExampleBefore(ctx.text, start)) return null;
    return {
      ruleId: "germanNounCasing",
      messageKey: "review_msg_german_adjective_lowercase",
      range: { start, end: start + 1 },
      alternatives: [adj[0].toLowerCase()],
      context: { start, end: m.index + m[0].length },
    };
  },
  nameTarget: (m, ctx) =>
    capital(ctx, m.indices!.groups!.target[0], { start: m.index, end: m.index + m[0].length }),
  nameAdjective: (m, ctx) => {
    const { adj, noun } = m.groups!;
    const lemma = [noun, noun.replace(/(?:es|s|n)$/, "")].find((n) => NOUN_SET.has(n));
    const stem = adj.replace(/(?:e|en|er|es|em)$/, "");
    const pair = `${stem}:${lemma}`;
    if (!lemma || !NAMES.has(pair)) return null;
    const [start] = m.indices!.groups!.adj;
    const before = ctx.text.slice(Math.max(0, start - 12), start);
    if (!ALWAYS.has(pair) && !DEFINITE.test(before)) return null;
    if (ctx.dictionary.has(adj) || namedExampleBefore(ctx.text, start)) return null;
    return {
      ruleId: "germanNounCasing",
      messageKey: "review_msg_german_name_case",
      range: { start, end: start + 1 },
      alternatives: [adj[0].toUpperCase()],
      context: { start: m.index, end: m.indices!.groups!.noun[1] },
    };
  },
} satisfies Record<string, MatchFixer>;
