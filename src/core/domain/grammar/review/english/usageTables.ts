import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import {
  frameMatches,
  hasUserOrCasedWord,
  isLang,
  SPACE as S,
  WORD_END as E,
} from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import type { Detector } from "../../engine/reviewRules";
import { table } from "./tables";

// Contractions split by a space, holiday names with their apostrophes, and optional plain-style
// rewrites of wordy phrases.

/** Rows for englishPhraseCorrections, englishClosedCompounds and stylePhrasing. */
export const PHRASES = table("usageTables.phrases");

export const STYLE = table("usageTables.style");

// ---------------------------------------------------------------------------- frames

type Rule = Pick<RawFinding, "ruleId" | "messageKey">;
const STYLE_RULE: Rule = { ruleId: "stylePhrasing", messageKey: "review_msg_style_phrasing" };
const info = (word: string) => englishWordInfo(word.toLowerCase());

/** The -ly adverb of an adjective, when the dictionary lists it: hasty -> hastily. */
function adverbOf(adjective: string): string | null {
  const a = adjective.toLowerCase();
  const form = a.endsWith("ic")
    ? `${a}ally`
    : /[^aeiou]y$/.test(a)
      ? `${a.slice(0, -1)}ily`
      : /[^aeiou]le$/.test(a)
        ? `${a.slice(0, -1)}y`
        : `${a}ly`;
  return info(a)?.adjective && info(form)?.adverb ? form : null;
}

// "in a hasty manner" -> "hastily"; "in a way that…" and "in a manner of speaking" stay.
const MANNER = `(?<target>in${S}an?${S}(?<adjective>[a-z]+)${S}(?:manner|way|fashion))${E}(?![ \\t\\u00a0]+(?:that|which|to|as|of|than|for|in|you|we|I|it)${E})`;
// "sent me an email" -> "emailed me".
const SEND_EMAIL = `(?<target>(?<verb>send|sends|sent|sending)${S}(?<object>me|you|him|her|us|them)${S}an${S}(?<mail>email|e-mail))${E}`;
// "is not complete" -> "is incomplete": the adjective's negative prefix form, when listed.
const NOT_ADJECTIVE = `(?:is|are|was|were|be|been|being|seems?|seemed|looks?|looked)${S}(?<target>not${S}(?<adjective>[a-z]{4,}))${E}(?![ \\t\\u00a0]+(?:enough|only|just|as|so|but)${E})`;

function frames(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "en") || (ctx.rules && !ctx.rules.has("stylePhrasing"))) return [];
  const findings: RawFinding[] = [];
  const push = (m: RegExpExecArray, alternatives: string[]) => {
    const [start, end] = m.indices!.groups!.target;
    if (hasUserOrCasedWord(ctx, m[0])) return;
    const typed = ctx.text.slice(start, end);
    const cased = alternatives.map((alt) =>
      /^\p{Lu}/u.test(typed) ? alt[0].toUpperCase() + alt.slice(1) : alt,
    );
    findings.push({
      ...STYLE_RULE,
      range: { start, end },
      alternatives: cased,
      ...(cased.length > 1 ? { requiresChoice: true as const } : {}),
    });
  };
  for (const m of frameMatches(ctx, MANNER)) {
    const adverb = adverbOf(m.groups!.adjective);
    if (adverb) push(m, [adverb]);
  }
  for (const m of frameMatches(ctx, SEND_EMAIL)) {
    const { verb, object, mail } = m.groups!;
    const form = { send: "", sends: "s", sent: "ed", sending: "ing" }[verb.toLowerCase()];
    if (form === undefined) continue;
    push(m, [`${mail.toLowerCase()}${form} ${object}`]);
  }
  for (const m of frameMatches(ctx, NOT_ADJECTIVE)) {
    const adjective = m.groups!.adjective.toLowerCase();
    if (!info(adjective)?.adjective) continue;
    const negative = ["un", "in", "im", "ir", "il"]
      .map((prefix) => prefix + adjective)
      .find((word) => {
        const entry = info(word);
        return !!entry?.adjective && !entry.verbs.length;
      });
    if (negative) push(m, [negative]);
  }
  return findings;
}

// "We'Re", "don'T", "I'Ve": a capital after the apostrophe of a contraction. All capitals
// ("DON'T", "I'M") are emphasis, and "O'Neil" is no contraction ending.
const CONTRACTION_CASE =
  /(?<![\p{L}\p{N}_'’])(?<head>\p{L}+)(?<mark>['’])(?<tail>s|t|re|ve|ll|d|m)(?![\p{L}\p{N}_])/giu;

function contractionCase(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "en")) return [];
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, CONTRACTION_CASE, (match) => match.index)) {
    const { head, mark, tail } = m.groups!;
    const tailHasUpper = tail !== tail.toLowerCase();
    if (!tailHasUpper || (head === head.toUpperCase() && tail === tail.toUpperCase())) continue;
    if (ctx.dictionary.has(`${head}${mark}${tail}`.toLowerCase())) continue;
    const start = m.index + head.length + mark.length;
    findings.push({
      ruleId: "englishContractionNormalization",
      messageKey: "review_msg_contraction",
      range: { start, end: start + tail.length },
      alternatives: [tail.toLowerCase()],
      context: { start: m.index, end: start + tail.length },
    });
  }
  return findings;
}

/** The Review detectors by name; grammar/rules/en.yaml sets their checks and order. */
export const PREDICATES = {
  usageFrames: frames,
  contractionCase: contractionCase,
} satisfies Record<string, Detector>;
