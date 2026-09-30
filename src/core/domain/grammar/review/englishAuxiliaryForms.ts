import { englishVerbForms } from "../implementations/helpers/EnglishVerbForms";
import { applyWordCase, detectWordCase } from "../implementations/helpers/GenericRuleShared";
import type { DetectContext, RawFinding } from "./reviewDetectors";

const SPACE = "[ \\t\\u00a0]{1,8}";
const SUBJECT = "(?:I|you|he|she|it|we|they)";
const AUXILIARY =
  "(?:did(?:n['’]t)?|does(?:n['’]t)?|do(?:n['’]t)?|can(?:not|['’]t)?|could(?:n['’]t)?|will|won['’]t|would(?:n['’]t)?|shall|should(?:n['’]t)?|may|might|must(?:n['’]t)?)";
const ADVERB = "(?:not|really|just|ever|even|always|still|actually)";
// Third-person forms that are also plural nouns, so "do/did" can be the main verb.
const DO_OBJECT_NOUNS = new Set(
  (
    "bears beats bends bets binds bites blows breaks breeds builds bursts buys catches costs " +
    "cuts deals digs draws drinks drives falls feeds fights finds flies goes hangs hits holds " +
    "keeps leads leaves lies lights means meets mistakes puts reads rebuilds reruns resets " +
    "rewrites rides rings rises runs sets shakes shoots sinks sits slides spins splits spreads " +
    "springs stands steals sticks stings strikes sweeps swims swings takes tears throws " +
    "upsets wakes wins winds works"
  ).split(" "),
);
const PREFIX = `(?:${SUBJECT}${SPACE}${AUXILIARY}|${AUXILIARY}${SPACE}${SUBJECT})`;
const PATTERN = new RegExp(
  `(?<![\\p{L}\\p{M}\\p{N}_'’@/#.\\\\-])${PREFIX}(?:${SPACE}${ADVERB}){0,2}${SPACE}([A-Za-z]+)(?![\\p{L}\\p{M}\\p{N}_'’@/#\\\\-])`,
  "giu",
);

/** Pronoun-led clauses and inverted questions only; no noun-phrase parser. */
export function auxiliaryForms(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const regex = new RegExp(PATTERN);
  regex.lastIndex = ctx.from;
  for (
    let match = regex.exec(ctx.scanText);
    match && match.index < ctx.to;
    match = regex.exec(ctx.scanText)
  ) {
    const start = match.index;
    const end = start + match[0].length;
    const contextStart = Math.max(0, start - 96);
    const before = ctx.text.slice(contextStart, start);
    // Avoid subordinate noun clauses: "What I did works" is grammatical.
    // Ordinary dialogue may open a clause; directly named error examples do not.
    if (
      !(contextStart === 0 && /^[ \t\u00a0]*$/.test(before)) &&
      !/[.!?;:\n"“][ \t\u00a0]{0,8}$/.test(before)
    )
      continue;
    if (
      /\b(?:write|type|spell|phrase|words?|example|literal|text|says?|reads?)[ :\t]*["“]$/i.test(
        before,
      )
    )
      continue;
    const token = match[1];
    const word = token.toLowerCase();
    const entry = englishVerbForms(word);
    if (
      !entry ||
      word === entry.lemma ||
      entry.ambiguous.includes(word) ||
      ctx.dictionary.has(word)
    )
      continue;
    // Mixed/internal title casing can name a product or identifier.
    if (token !== token.toLowerCase() && token !== token.toUpperCase()) continue;
    const after = ctx.text.slice(end, end + 32);
    if (/^\uFFFC|^\.[\p{L}\p{N}_]/u.test(after)) continue;
    // Lexical "do works of art", "did builds", "do rides" are not auxiliary errors.
    if (/\b(?:do|does|did)(?:n['’]t)?\b/i.test(match[0]) && DO_OBJECT_NOUNS.has(word)) continue;
    const replacement = applyWordCase(entry.lemma, detectWordCase(token));
    const verbStart = end - token.length;
    findings.push({
      ruleId: "englishAuxiliaryBaseVerb",
      messageKey: "review_msg_auxiliary_base",
      range: { start, end },
      alternatives: [`${ctx.source.slice(start, verbStart)}${replacement}`],
      context: { start: contextStart, end: Math.min(ctx.text.length, end + 32) },
    });
  }
  return findings;
}
