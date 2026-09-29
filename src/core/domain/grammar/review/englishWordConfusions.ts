import { ENGLISH_COMPARATIVES } from "../implementations/helpers/EnglishDegreeForms";
import { applyWordCase, detectWordCase } from "../implementations/helpers/GenericRuleShared";
import type { DetectContext, RawFinding } from "./reviewDetectors";
import type { ReviewMessageKey } from "./types";

const SPACE = "[ \\t\\u00a0]{1,8}";
const NOUN =
  "(?:passwords?|accounts?|files?|documents?|names?|address(?:es)?|keys?|reports?|versions?|models?|results?|plans?|answers?)";
const END_WORD = "(?![\\p{L}\\p{M}\\p{N}_'’@/#\\\\-])";
const COMPLETE = `${END_WORD}(?=[ \\t\\u00a0]{0,8}(?:[.!?,;:)]|$))`;
const COMPARATIVE = `(?:${ENGLISH_COMPARATIVES.join("|")})`;
const ARGUMENT = `(?:(?:the|my|your|our|their)${SPACE}(?:(?:old|new|previous|other)${SPACE})?${NOUN}|me|him|her|us|them)`;

function* matches(ctx: DetectContext, pattern: string): Generator<RegExpExecArray> {
  const regex = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_'’@/#.\\\\-])${pattern}`, "gidu");
  regex.lastIndex = Math.max(0, ctx.from - 256);
  for (
    let match = regex.exec(ctx.scanText);
    match && match.index < ctx.to;
    match = regex.exec(ctx.scanText)
  ) {
    const targetStart = match.indices!.groups!.target[0];
    if (targetStart < ctx.from || targetStart >= ctx.to) continue;
    const before = ctx.text.slice(Math.max(0, match.index - 96), match.index);
    // Directly named quoted examples, including words before the matched evidence.
    if (
      /\b(?:write|replace|type|spell|phrase|words?|example|literal|text|says?|reads?)[ :\t]*["“‘'][^"”’'\r\n\uFFFC]{0,64}$/i.test(
        before,
      )
    )
      continue;
    const end = match.index + match[0].length;
    if (/^\uFFFC|^\.[\p{L}\p{N}_]/u.test(ctx.text.slice(end, end + 2))) continue;
    yield match;
  }
}

function finding(
  ctx: DetectContext,
  match: RegExpExecArray,
  ruleId: RawFinding["ruleId"],
  messageKey: ReviewMessageKey,
  replacement: string,
): RawFinding | null {
  const target = match.groups!.target;
  if (ctx.dictionary.has(target.toLowerCase())) return null;
  if (applyWordCase(target, detectWordCase(target)) !== target) return null;
  const [start, end] = match.indices!.groups!.target;
  const phraseEnd = match.index + match[0].length;
  return {
    ruleId,
    messageKey,
    range: { start, end },
    alternatives: [applyWordCase(replacement, detectWordCase(target))],
    context: {
      start: Math.max(0, match.index - 96),
      end: Math.min(ctx.text.length, phraseEnd + 10),
    },
  };
}

/** Four independently selectable families, using explicit grammatical evidence. */
export function wordConfusions(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  // Copular comparison + complete comparison argument; temporal sentence tails abstain.
  for (const match of matches(
    ctx,
    `(?:is|are|was|were)${SPACE}(?:(?:much|even|far|slightly)${SPACE})?${COMPARATIVE}${SPACE}(?<target>then)${SPACE}${ARGUMENT}${COMPLETE}`,
  )) {
    const result = finding(ctx, match, "englishThenThan", "review_msg_then_than", "than");
    if (result) findings.push(result);
  }
  // "going to" + a known lexical verb and object, closed before another predicate.
  // "Your going away upset us" and "Your going to work upset us" remain noun phrases.
  for (const match of matches(
    ctx,
    `(?<target>your|their|there)${SPACE}going${SPACE}to${SPACE}(?:like|enjoy|need|want|understand|remember)${SPACE}(?:this|that|it|them|us|me)${COMPLETE}`,
  )) {
    const before = ctx.text.slice(Math.max(0, match.index - 96), match.index);
    if (
      !(match.index <= 96 && /^[ \t\u00a0]*$/.test(before)) &&
      !/[.!?;:\n"“][ \t\u00a0]{0,8}$/.test(before)
    )
      continue;
    const your = match.groups!.target.toLowerCase() === "your";
    const result = finding(
      ctx,
      match,
      your ? "englishYourYouAre" : "englishTheirThereTheyAre",
      your ? "review_msg_your_you_are" : "review_msg_they_are",
      your ? "you're" : "they're",
    );
    if (result) findings.push(result);
  }
  // An object-taking verb + own + a known noun supplies a complete possessive phrase.
  for (const match of matches(
    ctx,
    `(?:check|checked|reset|update|updated|save|saved|change|changed|remember|remembered|forgot|entered|used|found|lost)${SPACE}(?<target>there|they['’]re|you['’]re)${SPACE}own${SPACE}${NOUN}${COMPLETE}`,
  )) {
    const your = /^you/i.test(match.groups!.target);
    const result = finding(
      ctx,
      match,
      your ? "englishYourYouAre" : "englishTheirThereTheyAre",
      your ? "review_msg_your_possessive" : "review_msg_their_possessive",
      your ? "your" : "their",
    );
    if (result) findings.push(result);
  }
  // No light/fast/slow: those adjectives are also base verbs after prospective "is to".
  for (const match of matches(
    ctx,
    `(?:is|are|was|were|am|be|seems?|looks?)${SPACE}(?<target>to)${SPACE}(?:heavy|large|small|hot|cold|late|early|expensive|difficult|hard|tired)${SPACE}to${SPACE}(?:lift|carry|fit|eat|drink|finish|move|read|use|reach|leave|start|stop|understand)${END_WORD}`,
  )) {
    const result = finding(ctx, match, "englishToToo", "review_msg_to_too", "too");
    if (result) findings.push(result);
  }
  return findings;
}
