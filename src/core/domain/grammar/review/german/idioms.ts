import { namedExampleBefore } from "../exampleCues";
import { frameMatches, SPACE, WORD_END, WORD_START } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { germanAdjective } from "./germanLexicon";
import { isGerman } from "./shared";

// Fixed phrases whose words change case: a word that is a noun only in the phrase ("die
// Schuld", "im Ernst", "in den Arm", "zum Dank", "ein Riesenerfolg") and a noun that is an
// adverb or adjective in it ("mir ist es recht", "nach links", "mir ist angst", "ernst
// nehmen", "zu Recht" against "zurechtkommen").

const S = SPACE;
const E = WORD_END;
const re = (source: string) => new RegExp(`${WORD_START}(?:${source})${E}`, "gdu");
const DATIVES = "[Mm]ir|[Dd]ir|[Ii]hm|ihr|[Uu]ns|[Ee]uch|ihnen|Ihnen";
const POSSESSIVES = "mein|dein|sein|ihr|unser|euer|Ihr";
const SEIN = "ist|war|wäre|wird|wurde|sei|sein|bin|bist|sind|seid|waren|wären";
// Verbs "zurecht" belongs to: zurechtkommen, -legen, -finden, -machen, -rücken, -weisen.
const ZURECHT_VERBS =
  /(?<!\p{L})(?:ge)?(?:komm|kam|käm|leg|find|fand|fänd|mach|rück|weis|wies|stell|schneid|schnitt|bieg|bog|setz|zupf|richt)\p{Ll}*/u;

type Frame = [RegExp, (m: RegExpExecArray, ctx: DetectContext) => string | string[] | null];

/** The rest of the clause after the match, to the next stop. */
const clauseRest = (ctx: DetectContext, m: RegExpExecArray) =>
  ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 120).split(/[.!?;,:\n]/)[0];
const clauseBefore = (ctx: DetectContext, m: RegExpExecArray) =>
  ctx.text
    .slice(Math.max(0, m.index - 120), m.index)
    .split(/[.!?;,:\n]/)
    .at(-1) ?? "";

const FRAMES: Frame[] = [
  // "die schuld", "keine schuld", "deine schuld": the noun; "ist Schuld daran": the adjective.
  [
    re(
      `(?<=(?:die|der|keine|keiner|alle|ohne|von|jede|schwere|große|ganze|meine|deine|seine|ihre|unsere|eure|Ihre)${S})(?<target>schuld)`,
    ),
    () => "Schuld",
  ],
  [
    re(
      `(?<=(?:${SEIN})(?:${S}(?:doch|nicht|auch|selbst|allein))*${S})(?<target>Schuld)(?=${S}daran)`,
    ),
    () => "schuld",
  ],
  // "mein ernst", "im ernst", "ernst machen"; "Ernst nehmen", "Ernst gemeint".
  [
    re(`(?<=(?:${POSSESSIVES}|meinen|deinen|vollen|voller|im|allem)${S})(?<target>ernst)`),
    () => "Ernst",
  ],
  [re(`(?<target>ernst)(?=${S}(?:machen|macht|machte|machten|gemacht)${E})`), () => "Ernst"],
  [
    re(
      `(?<!(?:der|den|dem|des|vollen|voller|im|mein|dein|sein|meinen|deinen|seinen|Ihr|ihr|für|allem)${S})(?<=\\p{L}${S})(?<target>Ernst)(?=${S}(?:nehmen|nimm|nimmt|nahm|nahmen|genommen|zu${S}nehmen\\p{Ll}*|gemeint|meinen|meint)${E})`,
    ),
    () => "ernst",
  ],
  // "Nimm das Ernst." → ernst: the verb before it.
  [
    re(
      `(?<!(?:der|den|dem|des|vollen|voller|im|mein|dein|sein|meinen|deinen|seinen|Ihr|ihr|für|allem)${S})(?<=\\p{L}${S})(?<target>Ernst)(?=[ \\t]*[.!?,])`,
    ),
    (m, ctx) =>
      /(?<!\p{L})(?:nimm|nimmt|nehme|nehmen|nehmt|nahm|nahmen)(?!\p{L})/iu.test(
        clauseBefore(ctx, m),
      )
        ? "ernst"
        : null,
  ],
  // "in den arm", "im arm", "mit offenen armen", "arm in Arm".
  [re(`(?<=(?:in${S}den|im|unter${S}den|am)${S})(?<target>arm)`), () => "Arm"],
  [re(`(?<=offenen${S})(?<target>armen)`), () => "Armen"],
  [
    re(`(?<target>[Aa]rm${S}in${S}[Aa]rm)`),
    (m) => (m.groups!.target.includes("arm") ? "Arm in Arm" : null),
  ],
  // "zum dank", "der dank", "vielen dank", "Gott sei dank", "zu dank verpflichtet".
  [
    re(
      `(?<=(?:[Zz]um|der|den|dem|euer|unser|mein|dein|sein|ihr|[Vv]ielen|[Bb]esten|[Hh]erzlichen|großen|großem|sei)${S})(?<target>dank)(?!${S}(?:des|der|dem|den|seiner|ihrer|meiner|deiner|unserer|eurer)${E})`,
    ),
    () => "Dank",
  ],
  [re(`(?<=zu${S}(?:großem${S})?)(?<target>dank)(?=${S}verpflichtet)`), () => "Dank"],
  // "nach Links abbiegen", "von Links nach rechts", "mit Links." → links; "eine Seite mit
  // Links zum Thema", "der Blick nach Rechts ist …" (a name) stay.
  [
    re(
      `(?<=(?:nach|halb|ganz|weiter|scharf)${S})(?<target>Links|Rechts)(?=[ \\t]*[.!?,]|${S}(?!(?:ist|sind|war|waren|wird|hat|zum|zur|zu|auf|über|von|für|und)${E})\\p{Ll})|` +
        `(?<=von${S})(?<t3>Links|Rechts)(?=${S}nach${E})|(?<=mit${S})(?<t4>Links)(?=[ \\t]*[.!?])|` +
        `(?<t2>Links|Rechts)(?=${S}(?:abbiegen|abbiegt|abgebogen|abbog|einbiegen|halten|ab)${E})`,
    ),
    (m) => (m.groups!.target ?? m.groups!.t2 ?? m.groups!.t3 ?? m.groups!.t4).toLowerCase(),
  ],
  // "mir ist Recht", "es geschah ihm Recht", "Recht und billig", "alles Recht machen".
  [
    re(
      `(?<=(?:${DATIVES})(?:${S}(?:ganz|nicht|auch|aber|wirklich|durchaus|doch|schon|nur))*${S})(?<target>Recht)(?=${S}(?:sein|ist|war|wäre|so)${E}|[ \\t]*[,.!?])`,
    ),
    (m, ctx) =>
      /\b(?:haben|hat|hast|habe|hatte|gibt|gab|geben|gegeben|gebe|gebt|gib)\b/.test(
        clauseBefore(ctx, m),
      )
        ? null
        : "recht",
  ],
  [re(`(?<=(?:geschieht|geschah|geschehe)${S}(?:${DATIVES})${S})(?<target>Recht)`), () => "recht"],
  [re(`(?<target>Recht)(?=${S}und${S}billig)`), () => "recht"],
  [
    re(`(?<=(?:alles|nichts|es|ihm|ihr|allen)${S})(?<target>Recht)(?=${S}(?:zu${S})?machen)`),
    () => "recht",
  ],
  [
    re(
      `(?<=(?:gehe|gehen|geht)(?:${S}(?:ich|wir|du|ihr|Sie))?${S})(?<target>Recht)(?=${S}in${S}der${S}Annahme)`,
    ),
    () => "recht",
  ],
  // "ich bin ihr Gram" → gram.
  [
    re(`(?<=(?:${SEIN})${S}(?:${DATIVES})(?:${S}(?:nicht|wirklich))*${S})(?<target>Gram)`),
    () => "gram",
  ],
  // "mir ist Angst und Bange" → angst und bange; "macht mir angst und bange" → Angst und Bange.
  [
    re(
      `(?<=(?:(?:${DATIVES})${S}(?:${SEIN}|sollte${S}|wurde)|(?:${SEIN}|wurde)${S}(?:${DATIVES}))(?:${S}nicht)?${S})(?<target>[Aa]ngst(?:${S}und${S}[Bb]ange)?)(?=${S}sein${E}|[ \\t]*[,.!?])`,
    ),
    (m) =>
      m.groups!.target === m.groups!.target.toLowerCase() ? null : m.groups!.target.toLowerCase(),
  ],
  [
    re(
      `(?<=(?:mach|macht|machen|machte|machten|gemacht)${S}(?:\\p{Ll}+${S})?(?:${DATIVES}|mich|dich|ihn|sie|uns|euch)(?:${S}nicht)?${S})(?<target>[Aa]ngst${S}und${S}[Bb]ange)`,
    ),
    (m) =>
      m.groups!.target === m.groups!.target.replace(/^a/, "A").replace(/ b/, " B")
        ? null
        : "Angst und Bange",
  ],
  // "ein riesen Dank", "eine Riesen Freude" → "Riesendank", "Riesen-Freude".
  [
    re(
      `(?<target>(?:riesen|(?<=(?:ein|eine|einen|einem|einer|eines|unserer|unseres|dieser|dieses|diesen)${S})Riesen)${S}(?<noun>\\p{Lu}\\p{Ll}{2,}))`,
    ),
    (m) => [`Riesen${m.groups!.noun.toLowerCase()}`, `Riesen-${m.groups!.noun}`],
  ],
  // "behauptet zurecht" → zu Recht; "kommt zu recht" → zurecht.
  [
    re(`(?<target>zurecht|zu${S}recht)`),
    (m, ctx) => {
      const rest = clauseRest(ctx, m);
      // "zu recht kleinen Stücken": "recht" is "quite" before an adjective.
      const next = /^\s*(\p{L}+)/u.exec(rest)?.[1] ?? "";
      const adjective = germanAdjective(next) || /\p{Ll}{2}(?:e|en|er|es|em)$/u.test(next);
      if (/^\p{Ll}/u.test(next) && adjective && !ZURECHT_VERBS.test(next)) return null;
      const clause = `${clauseBefore(ctx, m)} ${rest}`;
      const verb = ZURECHT_VERBS.test(clause);
      if (m.groups!.target === "zurecht") return verb ? null : "zu Recht";
      return verb ? "zurecht" : "zu Recht";
    },
  ],
];

/** Run by germanNounCasing's detector (nounCasing.ts). */
export function idioms(ctx: DetectContext): RawFinding[] {
  if (!isGerman(ctx)) return [];
  const findings: RawFinding[] = [];
  for (const [regex, fix] of FRAMES) {
    // The typed words are in "target", or in "t2"–"t4" for a frame's other branches.
    const named = (m: RegExpExecArray) =>
      ["target", "t2", "t3", "t4"].find((k) => m.groups![k] !== undefined)!;
    const owner = (m: RegExpExecArray) => m.indices!.groups![named(m)][0];
    for (const m of frameMatches(ctx, regex, owner)) {
      const name = named(m);
      const [start, end] = m.indices!.groups![name];
      const typed = m.groups![name];
      if (ctx.dictionary.has(typed.toLowerCase()) || namedExampleBefore(ctx.text, start)) continue;
      const fixed = fix(m, ctx);
      const replacements = fixed === null ? [] : [fixed].flat().filter((r) => r !== typed);
      if (replacements.length === 0) continue;
      findings.push({
        ruleId: "germanNounCasing",
        messageKey: "review_msg_german_idiom_case",
        range: { start, end },
        alternatives: replacements,
        ...(replacements.length > 1 ? { requiresChoice: true as const } : {}),
        context: { start: Math.max(0, start - 40), end: Math.min(ctx.text.length, end + 40) },
      });
    }
  }
  return findings;
}
