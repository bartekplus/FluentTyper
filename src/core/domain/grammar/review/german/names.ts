import { namedExampleBefore } from "../exampleCues";
import { frameMatches, SPACE, WORD_END, WORD_START } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { isGerman } from "./shared";

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
  "international:Währungsfonds international:Strafgerichtshof bayerisch:Rundfunk"
).split(" ");
const ALWAYS = new Set(PAIRS.filter((p) => p.startsWith("!")).map((p) => p.slice(1)));
const NAMES = new Set(PAIRS.map((p) => p.replace("!", "")));
const NOUN_SET = new Set(PAIRS.map((p) => p.split(":")[1]));
const NOUNS = [...NOUN_SET].join("|");
const DEFINITE = /(?<![\p{L}\p{N}])(?:der|die|das|des|dem|den|im|am|vom|zum|zur|beim|ins)[ \t]+$/iu;
const NAME = new RegExp(
  `${WORD_START}(?<adj>\\p{Ll}+?(?:e|en|er|es|em))${SPACE}(?<noun>(?:${NOUNS})(?:es|s|n)?)${WORD_END}`,
  "gdu",
);

/** Run by germanNounCasing's detector (nounCasing.ts). */
export function names(ctx: DetectContext): RawFinding[] {
  if (!isGerman(ctx)) return [];
  const findings: RawFinding[] = [];
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
