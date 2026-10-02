import { englishLemma } from "../../implementations/helpers/EnglishInflection";
import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import { englishVerbForms } from "../../implementations/helpers/EnglishVerbForms";
import type { PhraseRow } from "../englishPhraseTables";
import { frameMatches, hasUserOrCasedWord, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { afterBreak, caseLike, english, evidence } from "./slotWords";

// Auxiliaries in questions: a do-question keeps its verb bare ("how did he smiled" -> smile),
// one auxiliary leads ("Does anyone can help?" -> Can anyone help?, "Did you have entered" ->
// Have you entered), and a repeated auxiliary goes ("Can I can", "have already have").

export const PHRASES: readonly PhraseRow[] = [];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

const PRONOUN = "(?:i|you|we|they|he|she|it)";
const ADVERB = `(?:${SPACE}(?:ever|really|actually|typically|usually|normally|still|even|just|always|also|never|already|generally|actually))?`;
const MODAL = "(?:can|could|would|will|should|may|might|must)";
const SUBJECT = `(?:${PRONOUN}|anyone|someone|anybody|somebody|everyone|everybody|(?:the|your|my|our|their|his|her|this|that)(?:${SPACE}[a-z]+){1,2})`;

function push(
  ctx: DetectContext,
  findings: RawFinding[],
  messageKey: RawFinding["messageKey"],
  start: number,
  end: number,
  alternatives: string[],
): void {
  if (findings.some((f) => f.range.start < end && start < f.range.end)) return;
  findings.push({
    ruleId: "englishAuxiliaryBaseVerb",
    messageKey,
    range: { start, end },
    alternatives,
    ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
    context: evidence(ctx, start, end),
  });
}

/** The base of a past, -s or -ing verb form ("smiled", "says", "writing"), or null. */
function bareOf(word: string): string | null {
  const read = englishWordInfo(word);
  // Right after do + a pronoun subject only a verb fits, so "works" and "used" read as verbs.
  if (!read?.verbs.length) return null;
  if (word.endsWith("ing")) return englishLemma(word, "ing");
  if (word.endsWith("s")) return englishLemma(word, "third");
  const forms = englishVerbForms(word);
  if (forms && (forms.ambiguous.includes(word) || forms.lemma === word)) return null;
  if (!read.verbs.some((v) => v.form === "past")) return null;
  return englishLemma(word, "past");
}

/** "Tell me how did he smiled", "what does it means", "How do I typically writing…". */
function whDoQuestion(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `(?:(?:what|how|why|where|when)(?:${SPACE}[a-z]+)?${SPACE}(?:do|does|did)${SPACE}${PRONOUN}|(?:who|which)${SPACE}(?:do|does|did)${SPACE}(?:i|we|they|he|she))${ADVERB}${SPACE}(?<verb>[a-z]+)${WORD_END}`,
    "verb",
  )) {
    const verb = m.groups!.verb;
    if (verb !== verb.toLowerCase() || ctx.dictionary.has(verb)) continue;
    // "what did he used to do" still wants "use". After who/which, "it" and "you" may be the
    // object of do: "the shop who does it tells me".
    // "What do you guys think?": a plural noun in apposition to you/we/they.
    const lead = m[0].slice(0, -verb.length);
    if (/s$/.test(verb) && englishWordInfo(verb)?.noun && /\b(?:you|we|they)\s+$/i.test(lead))
      continue;
    const base = bareOf(verb);
    if (!base || base === verb || base === "be") continue;
    const [start, end] = m.indices!.groups!.verb;
    push(ctx, findings, "review_msg_auxiliary_base", start, end, [caseLike(verb, base)]);
  }
  return findings;
}

/** "Does anyone can help?", "How does the client would like…": the modal leads the question. */
function doBeforeModal(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `(?<target>(?<aux>do|does|did)(?<subject>${SPACE}${SUBJECT})${SPACE}(?<modal>${MODAL}))${SPACE}(?<verb>[a-z]+)${WORD_END}`,
    "target",
  )) {
    const { aux, subject, modal, verb } = m.groups!;
    // A clause start or a question word right before the auxiliary.
    const before = ctx.text.slice(Math.max(0, m.index - 12), m.index);
    if (
      !afterBreak(ctx, m.index) &&
      !/\b(?:what|how|why|where|when|which)[ \t\u00a0]+$/i.test(before)
    )
      continue;
    if (hasUserOrCasedWord(ctx, `${subject} ${modal} ${verb}`)) continue;
    // The modal must be the auxiliary: a base verb after it ("can provide", "would like").
    const read = englishWordInfo(verb);
    if (!read?.verbs.some((v) => v.form === "base" && v.lemma === verb)) continue;
    const [start, end] = m.indices!.groups!.target;
    const lead = caseLike(aux, modal.toLowerCase());
    push(ctx, findings, "review_msg_question_auxiliary", start, end, [`${lead}${subject}`]);
  }
  return findings;
}

/** "Did you have entered your PIN?", "Did the dog has been fed?": a perfect question. */
function didBeforePerfect(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `(?<target>(?<aux>did)(?<subject>${SPACE}${SUBJECT})${SPACE}(?:has|have))${SPACE}(?<verb>[a-z]+)${WORD_END}`,
    "target",
  )) {
    const { aux, subject, verb } = m.groups!;
    if (!afterBreak(ctx, m.index) || hasUserOrCasedWord(ctx, `${subject} ${verb}`)) continue;
    const read = englishWordInfo(verb);
    // "Did you have fun", "Did they have lunch": have is the main verb there.
    if (verb !== "been" && !read?.verbs.some((v) => v.form === "participle")) continue;
    if (read?.verbs.some((v) => v.form === "base" && v.lemma === verb)) continue;
    const plural = /^\s*(?:i|you|we|they)$/i.test(subject.trim());
    const [start, end] = m.indices!.groups!.target;
    const lead = caseLike(aux, plural ? "have" : "has");
    push(ctx, findings, "review_msg_question_auxiliary", start, end, [`${lead}${subject}`]);
  }
  return findings;
}

/** "Can I can count on you?", "I have already have one": the auxiliary written twice. */
function repeatedAuxiliary(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `(?<first>${MODAL})(?<subject>${SPACE}${PRONOUN})${SPACE}(?<second>${MODAL})${WORD_END}`,
    "second",
  )) {
    const { first, subject, second } = m.groups!;
    if (first.toLowerCase() !== second.toLowerCase() || !afterBreak(ctx, m.index)) continue;
    const question = /^[^.!\n]*\?/.test(ctx.text.slice(m.index, m.index + 160));
    const asked = `${first}${subject}`;
    const told = `${caseLike(first, subject.trim())} ${second.toLowerCase()}`;
    const [start] = m.indices!.groups!.first;
    const [, end] = m.indices!.groups!.second;
    push(
      ctx,
      findings,
      "review_msg_repeated_auxiliary",
      start,
      end,
      question ? [asked] : [asked, told],
    );
  }
  for (const m of frameMatches(
    ctx,
    `(?<first>have|has)${SPACE}(?<adverb>already|ever|really|eventually|never|also|just|still|always|actually|definitely|probably|recently|finally)${SPACE}(?<second>have|has)${WORD_END}`,
    "second",
  )) {
    const { first, adverb, second } = m.groups!;
    if (first.toLowerCase() !== second.toLowerCase()) continue;
    // "have already had" is fine; only the same form twice.
    const [start] = m.indices!.groups!.first;
    const [, end] = m.indices!.groups!.second;
    push(ctx, findings, "review_msg_repeated_auxiliary", start, end, [
      caseLike(first, `${adverb} ${second}`),
      `${first} ${adverb}`,
    ]);
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: ["englishAuxiliaryBaseVerb"],
    detect: english(whDoQuestion, doBeforeModal, didBeforePerfect, repeatedAuxiliary),
  },
];
