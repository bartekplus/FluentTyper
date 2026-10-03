import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { germanInfinitive, germanNounReading, germanVerbLike } from "./germanLexicon";
import { englishLine, isGerman } from "./shared";

// The spoken short forms of her-/hin- particles before a verb: "reingehen" (hineingehen),
// "rausbekommen" (herausbekommen or hinausbekommen), "rumsitzen" (herumsitzen), and "rum",
// "rüber", "runter", "rauf", "raus" on their own. Opt-in: fine in speech and casual writing.

const FULL: Readonly<Record<string, string[]>> = {
  ran: ["heran"],
  rum: ["herum"],
  raus: ["heraus", "hinaus"],
  rein: ["herein", "hinein"],
  rauf: ["herauf", "hinauf"],
  runter: ["herunter", "hinunter"],
  rüber: ["herüber", "hinüber"],
};
// "rein" and "ran" alone are an adjective ("rein zufällig") and a call ("ran an die Arbeit").
const ALONE = new Set(["rum", "raus", "rauf", "runter", "rüber"]);
const WORD =
  /(?<![\p{L}\p{M}\p{N}_\-'’])(?<short>[Rr](?:an|um|aus|ein|auf|unter|über))(?<rest>\p{Ll}*)(?![\p{L}\p{M}\p{N}_\-'’])/gu;

/** A verb form: an infinitive, a 1st singular or past form, a present form in -t or -st. */
function verbForm(word: string): boolean {
  if (word.length < 3) return false;
  if (germanVerbLike(word) || germanInfinitive(word)) return true;
  return [`${word.replace(/e?s?t$/, "")}en`, `${word.replace(/t$/, "")}n`].some(
    (infinitive) => infinitive !== word && germanInfinitive(infinitive),
  );
}

/** The verb after the particle: "bekommen", "zubekommen" (zu-infinitive), "gefallen". */
function verbAfter(rest: string): boolean {
  if (verbForm(rest)) return true;
  if (rest.startsWith("zu") && verbForm(rest.slice(2))) return true;
  // A participle: "ge" + stem + "t" or "en" ("gegangen", "getastet").
  const participle = /^ge(\p{Ll}{2,}?)(?:et|t|en)$/u.exec(rest);
  return !!participle && [`${participle[1]}en`, `${participle[1]}n`].some(germanInfinitive);
}

// A preposition with an interrogative "was" is spoken German; writing uses the wo(r)- adverb:
// "Für was kämpft er?" (Wofür), "um was es geht" (worum). Not the indefinite "was" ("für was
// Neues", "gegen was neues").
const WHAT =
  /(?<![\p{L}\p{M}\p{N}_-])(?<prep>[Aa]us|[Uu]m|[Aa]uf|[Ff]ür|[Dd]urch|[Mm]it|[Üü]ber|[Aa]n|[Vv]on|[Nn]ach|[Zz]u|[Ii]n|[Bb]ei|[Gg]egen|[Vv]or)[ \t]+was(?![\p{L}\p{M}\p{N}_-])/gu;
const WO = (prep: string) => (/^[aeiouü]/.test(prep) ? `wor${prep}` : `wo${prep}`);
function prepositionWhat(ctx: DetectContext, findings: RawFinding[]): void {
  WHAT.lastIndex = ctx.from;
  for (let m = WHAT.exec(ctx.scanText); m && m.index < ctx.to; m = WHAT.exec(ctx.scanText)) {
    const after = ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 30);
    // "was Neues", "was neues", "was anderes": "etwas"; "Auf was für einem …": "was für".
    if (/^[ \t]+(?:\p{Lu}|\p{Ll}+(?:es|e)(?![\p{L}])|für(?![\p{L}]))/u.test(after)) continue;
    // "um was zu essen", "um was aufzubauen": "um … zu" with "etwas".
    const clause = /^[^.!?,;:\n]*/.exec(after)![0];
    if (
      /^[Uu]m$/.test(m.groups!.prep) &&
      /(?<![\p{L}])zu(?![\p{L}])|\p{Ll}+zu\p{Ll}+en(?![\p{L}])/u.test(clause)
    )
      continue;
    const before = ctx.text.slice(Math.max(0, m.index - 2), m.index);
    // The clause opens with it: a question or an indirect question after a comma.
    if (m.index > 0 && !/(?:^|[,;:\n„"]\s*|[.!?]\s+)$/.test(before)) continue;
    const prep = m.groups!.prep;
    const adverb = WO(prep.toLowerCase());
    findings.push({
      ruleId: "germanColloquial",
      messageKey: "review_msg_german_colloquial",
      range: { start: m.index, end: m.index + m[0].length },
      alternatives: [/^\p{Lu}/u.test(prep) ? adverb[0].toUpperCase() + adverb.slice(1) : adverb],
      context: { start: Math.max(0, m.index - 40), end: m.index + m[0].length + 20 },
    });
  }
}

function colloquial(ctx: DetectContext): RawFinding[] {
  if (!isGerman(ctx)) return [];
  const findings: RawFinding[] = [];
  prepositionWhat(ctx, findings);
  WORD.lastIndex = ctx.from;
  for (let m = WORD.exec(ctx.scanText); m && m.index < ctx.to; m = WORD.exec(ctx.scanText)) {
    const { short, rest } = m.groups!;
    const word = m[0];
    const low = word.toLowerCase();
    const key = short.toLowerCase();
    const capital = short !== key;
    if (rest) {
      // A dictionary word of its own ("rangieren", "Ranzen"); the dictionary also
      // lists a few colloquial raus- verbs ("rauslassen"), which stay checked.
      const known = germanVerbLike(low) || germanInfinitive(low) || germanNounReading(low) !== null;
      if (known && key === "ran") continue;
      // Capitalized inside a sentence: a noun ("die Rangliste"), unless a verb made one ("zum
      // Rumprobieren").
      if (
        capital &&
        !/(?:en|ern|eln)$/.test(rest) &&
        !/(?:^|[.!?:\n„“"»«])[ \t]*$/.test(ctx.text.slice(Math.max(0, m.index - 4), m.index))
      )
        continue;
      if (!verbAfter(rest)) continue;
    } else {
      // "Rum" is the drink; a capital at a sentence start may be either.
      if (capital || !ALONE.has(key)) continue;
    }
    // Idioms with no written twin: "sich an jemanden ranmachen", "ans Telefon rangehen",
    // "jemandem eine runterhauen", "rum wie num"; and "rein- und rausschlüpfen".
    const before = ctx.text.slice(Math.max(0, m.index - 60), m.index);
    const after = ctx.text.slice(m.index + word.length, m.index + word.length + 12);
    if (/^ran(?:zu|ge)?mach/.test(low) || (/^rum$/.test(low) && /^\s+wie\s/.test(after))) continue;
    if (/^ran(?:zu|ge)?geh|^ranging/.test(low) && /Telefon|Handy/.test(before)) continue;
    if (/^runter/.test(low) && /(?<!\p{L})einen?\s+$/u.test(before)) continue;
    if (/-\s+(?:und|oder)\s+$/.test(before)) continue;
    if (ctx.dictionary.has(low) || namedExampleBefore(ctx.text, m.index)) continue;
    if (englishLine(ctx.text, m.index)) continue;
    const alternatives = FULL[key].map((full) => {
      const spelled = full + rest;
      return capital ? spelled[0].toUpperCase() + spelled.slice(1) : spelled;
    });
    findings.push({
      ruleId: "germanColloquial",
      messageKey: "review_msg_german_colloquial",
      range: { start: m.index, end: m.index + word.length },
      alternatives,
      context: { start: Math.max(0, m.index - 40), end: m.index + word.length },
      ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
    });
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["germanColloquial"], detect: colloquial },
];
