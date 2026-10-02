import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { PhraseRow } from "../englishPhraseTables";
import { frameMatches, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  afterBreak,
  caseLike,
  english,
  evidence,
  FUNCTION_WORDS,
  nounOnly,
  type Token,
  tokensAfter,
  wordBefore,
} from "./slotWords";

// Sound-alike words told apart by the slot around them: "will by" (buy/be), "more … then"
// (than), "ever day" (every), "don't now" (know), "come an see" (and), "to were" (where).

export const PHRASES: readonly PhraseRow[] = [];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

type Rule = "englishConfusedWords" | "englishThenThan" | "englishWereWhere";
const MESSAGE: Record<Rule, RawFinding["messageKey"]> = {
  englishConfusedWords: "review_msg_confused_word",
  englishThenThan: "review_msg_then_than",
  englishWereWhere: "review_msg_were_where",
};

function push(
  ctx: DetectContext,
  findings: RawFinding[],
  ruleId: Rule,
  start: number,
  end: number,
  typed: string,
  alternatives: string[],
  from: number,
): void {
  if (findings.some((f) => f.range.start === start)) return;
  findings.push({
    ruleId,
    messageKey: MESSAGE[ruleId],
    range: { start, end },
    alternatives: alternatives.map((a) => caseLike(typed, a)),
    ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
    context: evidence(ctx, from, end),
  });
}

const lower = (t: Token | undefined) => (t?.kind === "word" ? t.lower : "");
const verbsOf = (word: string) => englishWordInfo(word)?.verbs ?? [];
const participle = (word: string) =>
  verbsOf(word).some((v) => v.form === "participle" || v.form === "past");

// ------------------------------------------------------------------------------- by -> buy/be

const MODAL = `(?:will|would|can|could|should|shall|may|might|must|cannot|['’]ll|['’]d|(?:won|wouldn|can|couldn|shouldn|don|doesn|didn)['’]t)`;
// Heads that take "to" + a bare verb.
const TO_HEADS =
  /^(?:want|wants|wanted|need|needs|needed|going|have|has|had|try|tries|tried|trying|able|plan|plans|planned|decided|like|love|afford|hope|hoping|forgot|remember|me|you|him|her|us|them|wish)$/;
// "can by no means", "will by then", "should by default": a real preposition phrase.
const BY_PHRASE =
  /^(?:no|all|far|means|then|now|default|design|hand|chance|accident|mistake|nature|law|car|bus|train|plane|email|mail|phone|night|day|tomorrow|today|noon|midnight|definition|virtue|itself|themselves|himself|herself|myself|yourself|ourselves|way)$/;

/** "I would by a new phone", "Soup cannot by eaten with a fork", "wants you to by happy". */
function byBuy(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `(?<lead>${MODAL}|to)(?:${SPACE}(?:also|really|definitely|probably|surely|likely|never|not|always|soon|just|still|only|then|first))?${SPACE}(?<target>by)${WORD_END}`,
  )) {
    const lead = m.groups!.lead;
    if (lead === "to" && !TO_HEADS.test(wordBefore(ctx, m.index))) continue;
    // "at will by", "Uncle Zebulon's Will by": the noun will; a mid-sentence capital names.
    if (lead !== lead.toLowerCase() && !afterBreak(ctx, m.index)) continue;
    if (
      /^will$/i.test(lead) &&
      /^(?:at|free|good|ill|own|the|his|her|their|my|your|our)$/.test(wordBefore(ctx, m.index))
    )
      continue;
    const [start, end] = m.indices!.groups!.target;
    const [next, after] = tokensAfter(ctx, end, 2);
    if (next?.kind !== "word" || next.text !== next.lower) continue;
    const word = next.lower;
    if (BY_PHRASE.test(word) || /ing$/.test(word)) continue;
    const read = englishWordInfo(word);
    let fix: string | null = null;
    // "cannot by eaten", "to by happy": a participle or adjective that no noun reading shares.
    if (
      read &&
      !read.noun &&
      !read.adverb &&
      !FUNCTION_WORDS.has(word) &&
      !read.verbs.some((v) => v.form === "base" || v.form === "ing") &&
      (read.adjective || participle(word))
    )
      fix = "be";
    // "would by a new phone", "should by another brand": a purchase object.
    else if (
      /^(?:another|some|more|them|it|these|those|one|stock|stocks|shares|tickets|groceries|food)$/.test(
        word,
      ) ||
      (/^(?:a|an)$/.test(word) &&
        after?.kind === "word" &&
        !/^(?:margin|factor|mile|landslide|large|wide|narrow|small|long|little|lot|few|vote|majority)$/.test(
          after.lower,
        ) &&
        !/(?:er|or|ist|ian)$/.test(after.lower))
    )
      fix = "buy";
    if (!fix) continue;
    push(ctx, findings, "englishConfusedWords", start, end, m.groups!.target, [fix], m.index);
  }
  return findings;
}

// ------------------------------------------------------------------------------- then -> than

// "-er" words that are not comparatives, or compare in time ("later then").
const NOT_COMPARATIVE =
  /^(?:after|never|over|under|whether|either|neither|ever|together|other|later|earlier|order|number|water|matter|paper|power|user|server|letter|member|computer|summer|winter|corner|answer|manner|offer|enter|cover|consider|remember|wonder|differ|prefer|refer|suffer|deliver|discover|gather|bother|weather|father|mother|brother|sister|daughter|leader|player|owner|customer|partner|teacher|writer|reader|driver|finger|dinner|center|chapter|character|register|filter|folder|header|footer|layer|buffer|parameter|counter|monster|master|meter|liter|litter|butter|hammer|ladder|lower|upper|outer|inner|former|latter|proper|super|clever|tender|sober|bitter|eager|slender|rather)$/;
const COMPARATIVE_WORDS = /^(?:more|less|fewer|better|worse|rather|else|other)$/;
// What may follow a comparison's "than": noun phrases, pronoun objects, numbers and time words.
const COMPARED =
  /^(?:the|a|an|my|your|his|her|our|their|its|this|that|these|those|me|him|us|them|others|another|any|anyone|anything|anywhere|everyone|everything|everybody|anybody|ever|usual|before|expected|necessary|needed|last|in|at|on|for|with|one|two|three|four|five|ten|hundred|a)$/;

function comparative(word: string): boolean {
  if (COMPARATIVE_WORDS.test(word)) return true;
  if (!/^[a-z]{3,}er$/.test(word) || NOT_COMPARATIVE.test(word)) return false;
  const read = englishWordInfo(word);
  // "faster", "smoother", "scarier": the adjective or adverb's -er form, never a noun.
  return !!read && (read.adjective || read.adverb) && !read.noun && !read.verbs.length;
}

/** "more expensive on some systems then others", "much smoother then our flight": than. */
function thenAfterComparative(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, `(?<target>then)${SPACE}(?=[A-Za-z0-9])`)) {
    const target = m.groups!.target;
    if (target !== "then") continue;
    const before = ctx.text.slice(Math.max(0, m.index - 80), m.index);
    // "If I get stronger at this then I…", "when you feel better then you…": a sequence.
    const sentence = /[^.!?;:\n]*$/.exec(ctx.text.slice(Math.max(0, m.index - 200), m.index))![0];
    if (
      /\b(?:if|when|whenever|once|as long as|unless|after|before|while|until|since)\b/i.test(
        sentence,
      )
    )
      continue;
    // The comparison and "then" share a clause: no punctuation or linking word between.
    const clause = /[^.!?;:,\n(]*$/.exec(before)![0];
    const words = clause.toLowerCase().match(/[a-z]+/g) ?? [];
    let k = words.length - 1;
    while (k >= 0 && !comparative(words[k])) k--;
    // Right after the comparative, englishWordConfusions decides; here words stand between.
    if (k < 0 || k === words.length - 1 || words.length - k > 7) continue;
    const gap = words.slice(k + 1);
    if (
      gap.some(
        (w) =>
          /^(?:and|or|but|so|if|when|because|until|since|just|only|even|back|and|until)$/.test(w) ||
          (verbsOf(w).some((v) => v.form === "third" || v.form === "past") &&
            !englishWordInfo(w)?.noun),
      )
    )
      continue;
    // "even more then"? "If you need more, then call": a sequence needs a clause after then.
    if (
      /^(?:and|or|but|just|since|until|by|from|back|even|only|right|since)$/.test(
        words.at(-1) ?? "",
      )
    )
      continue;
    const [next, after] = tokensAfter(ctx, m.index + m[0].length, 2);
    const word = lower(next);
    const subjectComparison =
      /^(?:i|we|they|he|she|you)$/.test(word) &&
      /^(?:do|did|does|can|could|would|have|has|had|was|were|am|is|are|expected|thought)$/.test(
        lower(after),
      );
    const nounPhrase =
      next?.kind === "number" ||
      COMPARED.test(word) ||
      (next?.kind === "word" && nounOnly(word) === "plural");
    if (!subjectComparison && !nounPhrase) continue;
    // "…then the old version failed": a clause after then is a sequence; names and code abstain.
    const rest = tokensAfter(ctx, m.index + m[0].length, 6);
    if (rest.some((t) => t.kind === "other")) continue;
    if (
      !subjectComparison &&
      rest.some(
        (t) =>
          t.kind === "word" &&
          (/^(?:is|are|was|were|has|have|had|will|would|can|could)$/.test(t.lower) ||
            (verbsOf(t.lower).some((v) => v.form === "past" || v.form === "third") &&
              !englishWordInfo(t.lower)?.noun)),
      )
    )
      continue;
    // "more then the next day": a time sequence noun after "then".
    if (/^(?:next|following)$/.test(lower(after))) continue;
    const start = m.index;
    push(ctx, findings, "englishThenThan", start, start + 4, target, ["than"], start);
  }
  return findings;
}

// ------------------------------------------------------------------------------- ever -> every

const WEEKDAYS = /^(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/;
// "ever" before a time, count or noun that only "every" can take.
const EVERY_NOUNS =
  /^(?:day|week|month|year|time|morning|evening|night|hour|minute|second|other|single|member|user|person|student|child|kid|team|player|employee|customer|girl|boy|man|woman|step|page|item|line|file)$/;

/** "I do this ever day", "Ever member was there", "Has this every worked?". */
function everEvery(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, `(?<target>ever)${SPACE}(?=[A-Za-z0-9])`)) {
    const target = m.groups!.target;
    const [start, end] = m.indices!.groups!.target;
    const prev = wordBefore(ctx, m.index);
    // "the best ever season", "hardly ever", "if ever", "than ever".
    if (
      /^(?:hardly|never|if|than|as|nor|forever|best|worst|first|only|greatest|biggest)$|est$/.test(
        prev,
      )
    )
      continue;
    const [next] = tokensAfter(ctx, end, 1);
    const word = next?.kind === "word" ? next.lower : "";
    // "a blackout ever Monday" closes a noun phrase; only a verb or clause start before it.
    const prevNoun = !!prev && !FUNCTION_WORDS.has(prev) && !englishWordInfo(prev)?.verbs.length;
    const ok =
      (next?.kind === "number" && !prevNoun) ||
      (WEEKDAYS.test(word) && !prevNoun) ||
      (EVERY_NOUNS.test(word) &&
        (next?.kind !== "word" || next.text === next.lower || WEEKDAYS.test(word)));
    if (!ok || /^(?:since|after|so|more|again)$/.test(word)) continue;
    push(ctx, findings, "englishConfusedWords", start, end, target, ["every"], m.index);
  }
  // "Has this every worked?", "Have you every been there": every before a participle.
  for (const m of frameMatches(
    ctx,
    `(?:have|has|had|haven['’]t|hasn['’]t|you|this|it|they|we|i)${SPACE}(?<target>every)${SPACE}(?<verb>[a-z]+)${WORD_END}`,
  )) {
    const verb = m.groups!.verb;
    const read = englishWordInfo(verb);
    if (!read || read.noun || !participle(verb)) continue;
    const [start, end] = m.indices!.groups!.target;
    push(ctx, findings, "englishConfusedWords", start, end, m.groups!.target, ["ever"], m.index);
  }
  return findings;
}

// ------------------------------------------------------------------------------- now -> know

/** "I don't now where it is", "Thanks for letting us now.": know after do-not and let. */
function nowKnow(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `(?:(?:do|does|did)(?:n['’]t|${SPACE}not)|let(?:ting|s)?${SPACE}(?:me|us|him|her|them|you))${SPACE}(?<target>now)${WORD_END}`,
  )) {
    const [start, end] = m.indices!.groups!.target;
    const [next] = tokensAfter(ctx, end, 1);
    const word = lower(next);
    const closes =
      (next?.kind === "end" && /^let/i.test(m[0]) && /^[.!]/.test(next.text)) ||
      /^(?:what|where|when|why|how|who|whether|if|about|which|anything|much)$/.test(word);
    if (!closes) continue;
    push(ctx, findings, "englishConfusedWords", start, end, m.groups!.target, ["know"], m.index);
  }
  return findings;
}

// ------------------------------------------------------------------------------- an -> and

const PRONOUN_SUBJECT = /^(?:i|he|she|we|they|you)$/;

/** "come an have a look", "removed an migrated", "great an he is fast": "an" for "and". */
function anAnd(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, `(?<target>an)${SPACE}(?=[A-Za-z])`)) {
    const target = m.groups!.target;
    if (target !== "an") continue;
    const [start, end] = m.indices!.groups!.target;
    const [next, after] = tokensAfter(ctx, end, 2);
    if (next?.kind !== "word") continue;
    const word = next.lower;
    const read = englishWordInfo(word);
    const prev = wordBefore(ctx, m.index);
    // The word before must end a phrase: a verb, adjective, adverb or noun, not a preposition.
    if (!prev || (FUNCTION_WORDS.has(prev) && !/^(?:on|off|up|down|in|out|over|once)$/.test(prev)))
      continue;
    let ok = false;
    // A capitalized pronoun or a lowercase word with a consonant sound: "an" is no article here.
    if (word === "i" || (PRONOUN_SUBJECT.test(word) && next.text === next.lower)) ok = true;
    else if (next.text !== next.lower || /^(?:[aeiou]|h(?:our|onest|onor|eir))/.test(word))
      ok = false;
    // A verb-only word, closing the phrase or before its object ("an connect add-on" may
    // still be an article before a compound).
    else if (
      read &&
      !read.noun &&
      !read.adjective &&
      read.verbs.length > 0 &&
      read.verbs.every((v) => v.form === "base" || v.form === "past" || v.form === "participle") &&
      (!after ||
        after.kind === "end" ||
        after.kind === "comma" ||
        (after.kind === "word" &&
          (FUNCTION_WORDS.has(after.lower) || !englishWordInfo(after.lower)?.noun)))
    )
      ok = true;
    // "filter an order the data", "come an have a look": a verb before its own object.
    else if (
      read?.verbs.some((v) => v.form === "base") &&
      after?.kind === "word" &&
      /^(?:the|a|my|your|our|their|his|her|its|them|it|us|me|him)$/.test(after.lower)
    )
      ok = true;
    if (!ok) continue;
    push(ctx, findings, "englishConfusedWords", start, end, target, ["and"], m.index);
  }
  return findings;
}

// ------------------------------------------------------------------------------- were/where

/** "Go back to were you came from", "If I where a carpenter", "The runners where running". */
function wereWhere(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `(?:to|from)${SPACE}(?<target>were)${SPACE}(?=(?:I|you|he|she|it|we|they|the|this|that)${WORD_END})`,
  )) {
    // "next to were the boxes"? Only a clause with its own verb after.
    const [start, end] = m.indices!.groups!.target;
    const tokens = tokensAfter(ctx, end, 4);
    if (
      !tokens
        .slice(1)
        .some(
          (t) => t.kind === "word" && verbsOf(t.lower).length && !englishWordInfo(t.lower)?.noun,
        )
    )
      continue;
    push(ctx, findings, "englishWereWhere", start, end, m.groups!.target, ["where"], m.index);
  }
  for (const m of frameMatches(
    ctx,
    `(?:if|wish|as${SPACE}if|as${SPACE}though)${SPACE}(?:I|he|she|it|we|they|you)${SPACE}(?<target>where)${WORD_END}`,
  )) {
    const [start, end] = m.indices!.groups!.target;
    push(ctx, findings, "englishWereWhere", start, end, m.groups!.target, ["were"], m.index);
  }
  // A plural subject before where + an -ing verb: "the runners where running".
  for (const m of frameMatches(ctx, `(?<target>where)${SPACE}(?<verb>[a-z]+ing)${WORD_END}`)) {
    const verb = m.groups!.verb;
    const read = englishWordInfo(verb);
    if (!read?.verbs.some((v) => v.form === "ing")) continue;
    const prev = wordBefore(ctx, m.index);
    const prevRead = englishWordInfo(prev);
    const subject =
      /^(?:they|we|you)$/.test(prev) ||
      (!!prevRead?.noun &&
        prevRead.plural &&
        !/^(?:places|areas|cases|situations|times|days|conditions|jobs|countries|cities|events)$/.test(
          prev,
        ));
    if (!subject) continue;
    // "conditions where working is hard": a gerund subject with its own verb.
    const [next] = tokensAfter(ctx, m.index + m[0].length, 1);
    if (/^(?:is|was|has|can|will|would|seems|becomes|makes)$/.test(lower(next))) continue;
    const [start, end] = m.indices!.groups!.target;
    push(ctx, findings, "englishWereWhere", start, end, m.groups!.target, ["were"], m.index);
  }
  // "Where you ever able to…?", "Where you really hurt?": a yes/no question with be.
  for (const m of frameMatches(
    ctx,
    `(?<target>Where)${SPACE}(?:you|they|we)(?:${SPACE}(?:ever|really|also|all|both))?${SPACE}(?<pred>[a-z]+)${WORD_END}`,
  )) {
    if (!afterBreak(ctx, m.index)) continue;
    const pred = m.groups!.pred;
    const read = englishWordInfo(pred);
    const ok =
      /^(?:able|aware|sure|ready|happy|right|wrong|there|here)$/.test(pred) ||
      (!!read &&
        read.verbs.some((v) => v.form === "participle") &&
        !read.verbs.some((v) => v.form === "base"));
    if (!ok || !/^[^.!\n]*\?/.test(ctx.text.slice(m.index, m.index + 160))) continue;
    const [start, end] = m.indices!.groups!.target;
    push(ctx, findings, "englishWereWhere", start, end, m.groups!.target, ["were"], m.index);
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["englishConfusedWords"], detect: english(byBuy, everEvery, nowKnow, anAnd) },
  { rules: ["englishThenThan"], detect: english(thenAfterComparative) },
  { rules: ["englishWereWhere"], detect: english(wereWhere) },
];
