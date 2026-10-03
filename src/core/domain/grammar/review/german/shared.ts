import { requiredLiteral } from "../phraseTemplates";
import type { DetectContext } from "../reviewDetectors";

export const isGerman = (ctx: DetectContext) => ctx.lang.slice(0, 2) === "de";

const LITERALS = new Map<RegExp, string>();
const SCANNED = new WeakMap<DetectContext, string>();
/**
 * False when the chunk's scan lacks a word every match of `regex` consumes, so the frame need
 * not run: frames that open with a lookbehind would otherwise try it at every position, which
 * is slow without the regex JIT.
 */
export function mayRun(ctx: DetectContext, regex: RegExp): boolean {
  let literal = LITERALS.get(regex);
  if (literal === undefined) {
    LITERALS.set(regex, (literal = requiredLiteral(regex.source).toLowerCase()));
  }
  if (literal.length < 3) return true;
  let scanned = SCANNED.get(ctx);
  if (scanned === undefined) {
    SCANNED.set(ctx, (scanned = ctx.scanText.slice(Math.max(0, ctx.from - 256)).toLowerCase()));
  }
  return scanned.includes(literal);
}

export const wordSet = (list: string) => new Set(list.split(" "));

/** A token that ends a clause, or no token at all. */
export const BOUNDARY = /^(?:[.!?:;,()"“”„«»–—\n-]|$)/;

// A word of letters, not glued into a number, path, mention or dotted token.
const WORD =
  /(?<![\p{L}\p{M}\p{N}_@/#\\.-])\p{L}[\p{L}\p{M}]*(?![\p{L}\p{M}\p{N}_@/#\\]|\.\p{L})/gu;

/** The words whose start the chunk owns. */
export function* words(ctx: DetectContext): Generator<RegExpExecArray> {
  WORD.lastIndex = ctx.from;
  for (let m = WORD.exec(ctx.scanText); m && m.index < ctx.to; m = WORD.exec(ctx.scanText)) {
    yield m;
  }
}

// Words (with "_", "/" or "-" joins: "Pädagog_in", "Partner/in", "Grammatik-Regeln"), line
// breaks and single marks; a hyphen at a word edge ("Vor- und") stays a mark.
const TOKEN = /\n|[\p{L}\p{M}\p{N}_]+(?:[-/][\p{L}\p{M}\p{N}_]+)*|[^\s\p{L}\p{M}\p{N}_]/gu;

/** Up to `n` tokens right before `index`, nearest last; a line break is a token. */
export function tokensBefore(text: string, index: number, n: number): string[] {
  const start = Math.max(0, index - 16 * n);
  const tokens = text.slice(start, index).match(TOKEN) ?? [];
  // The first token may be cut by the window.
  return tokens.slice(Math.max(start > 0 ? 1 : 0, tokens.length - n));
}

/** Up to `n` tokens right after `index`. */
export function tokensAfter(text: string, index: number, n: number): string[] {
  return (text.slice(index, index + 16 * n).match(TOKEN) ?? []).slice(0, n);
}

// "darüber", "hierunter", "worüber": a preposition joined to da-, hier- or wo-.
export const PRONOMINAL_ADVERB =
  /^(?:da|dar|hier|wo|wor)(?:an|auf|aus|bei|durch|für|gegen|hinter|in|mit|nach|neben|über|um|unter|von|vor|zu|zwischen)$/u;

export const PRONOUNS = wordSet("ich du er sie es wir ihr man sich mich dich uns euch mir dir");
// Verbs that close a clause with a bare infinitive or a participle ("kannst du das ändern",
// "diese habe ergeben").
export const VERB_GOVERNORS = wordSet(
  "kann kannst können könnt konnte konnten könnte könnten muss musst müssen müsst musste " +
    "mussten müsste müssten soll sollst sollen sollt sollte sollten will willst wollen " +
    "wollt wollte wollten darf darfst dürfen dürft durfte durften dürfte dürften mag " +
    "möchte möchtest möchten werde wirst wird werden werdet würde würdest würden wurde " +
    "wurden worden lass lasse lässt lassen ließ tu tue tut tun brauchst braucht brauchen " +
    "habe hast hat haben habt hatte hatten hätte hätten bin bist ist sind seid war waren " +
    "wäre wären sei",
);

/** Whether the clause has a verb that the word at its end can complete. */
export function governedBefore(before: string[], at: number): boolean {
  for (let i = at - 1; i >= 0 && !BOUNDARY.test(before[i]); i--) {
    if (VERB_GOVERNORS.has(before[i].toLowerCase())) return true;
  }
  return false;
}

// English function words that are no German words in lowercase.
const ENGLISH =
  /(?<![\p{L}'’])(?:the|and|of|with|you|your|is|are|this|that|it|to|for|be|have|has|from|but|not|they|we|my|I|people|our)(?![\p{L}'’])/gu;

/** How many English function words a span holds: quoted or embedded English material. */
export const englishWords = (span: string) => span.match(ENGLISH)?.length ?? 0;

/** Whether the line around `index` reads as English ("With 15 million people …"). */
export function englishLine(text: string, index: number): boolean {
  const start = Math.max(text.lastIndexOf("\n", index - 1) + 1, index - 120);
  const end = text.indexOf("\n", index);
  return englishWords(text.slice(start, Math.min(end < 0 ? text.length : end, index + 120))) >= 2;
}
