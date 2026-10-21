import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import type { FindingsFilter, MatchFixer } from "../../engine/reviewRules";
import { quotedMention } from "./grammarStyle1";
import {
  afterBreak,
  caseLike,
  evidence,
  FUNCTION_WORDS,
  nounOnly,
  type Token,
  tokensAfter,
  wordBefore,
} from "./slotWords";

// Sound-alike words told apart by the slot around them: "will by" (buy/be), "more … then"
// (than), "ever day" (every), "don't now" (know), "come an see" (and), "to were" (where).

type Rule = "englishConfusedWords" | "englishThenThan" | "englishWereWhere";
const MESSAGE: Record<Rule, RawFinding["messageKey"]> = {
  englishConfusedWords: "review_msg_confused_word",
  englishThenThan: "review_msg_then_than",
  englishWereWhere: "review_msg_were_where",
};

const lower = (t: Token | undefined) => (t?.kind === "word" ? t.lower : "");
const verbsOf = (word: string) => englishWordInfo(word)?.verbs ?? [];
const participle = (word: string) =>
  verbsOf(word).some((v) => v.form === "participle" || v.form === "past");

// ------------------------------------------------------------------------------- by -> buy/be

// Heads that take "to" + a bare verb.
const TO_HEADS =
  /^(?:want|wants|wanted|need|needs|needed|going|have|has|had|try|tries|tried|trying|able|plan|plans|planned|decided|like|love|afford|hope|hoping|forgot|remember|me|you|him|her|us|them|wish)$/;
// "can by no means", "will by then", "should by default": a real preposition phrase.
const BY_PHRASE =
  /^(?:no|all|far|means|then|now|default|design|hand|chance|accident|mistake|nature|law|car|bus|train|plane|email|mail|phone|night|day|tomorrow|today|noon|midnight|definition|virtue|itself|themselves|himself|herself|myself|yourself|ourselves|way)$/;

// Nouns that make "by this/my …" a time or a measure: "will by this point", "by my count".
const BY_TIME =
  /^(?:time|point|stage|date|day|week|month|year|morning|evening|afternoon|night|weekend|deadline|hour|end|count|estimate|reckoning|standards?|measure|logic|definition|own|account|calculation|side|request|leave|choice|design)$/;

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

// ------------------------------------------------------------------------------- ever -> every

const WEEKDAYS = /^(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/;
// "ever" before a time, count or noun that only "every" can take.
const EVERY_NOUNS =
  /^(?:day|week|month|year|time|morning|evening|night|hour|minute|second|other|single|member|user|person|student|child|kid|team|player|employee|customer|girl|boy|man|woman|step|page|item|line|file)$/;

// ------------------------------------------------------------------------------- now -> know

// ------------------------------------------------------------------------------- an -> and

const PRONOUN_SUBJECT = /^(?:i|he|she|we|they|you)$/;

// ------------------------------------------------------------------------------- were/where

function slot(
  ctx: DetectContext,
  ruleId: Rule,
  start: number,
  end: number,
  typed: string,
  alternatives: string[],
  from: number,
): RawFinding {
  return {
    ruleId,
    messageKey: MESSAGE[ruleId],
    range: { start, end },
    alternatives: alternatives.map((a) => caseLike(typed, a)),
    ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
    context: evidence(ctx, from, end),
  };
}

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  confusionByBuy: (m, ctx) => {
    const lead = m.groups!.lead ?? "will";
    const strict = !m.groups!.lead;
    if (m.groups!.inverted && !afterBreak(ctx, m.index)) return null;
    if (lead === "to" && !TO_HEADS.test(wordBefore(ctx, m.index))) return null;
    // "at will by", "Uncle Zebulon's Will by": the noun will; a mid-sentence capital names.
    if (lead !== lead.toLowerCase() && !afterBreak(ctx, m.index)) return null;
    if (
      /^will$/i.test(lead) &&
      /^(?:at|free|good|ill|own|the|his|her|their|my|your|our)$/.test(wordBefore(ctx, m.index))
    )
      return null;
    const [start, end] = m.indices!.groups!.target;
    const [next, after] = tokensAfter(ctx, end, 2);
    if (next?.kind !== "word" || next.text !== next.lower) return null;
    const word = next.lower;
    if (BY_PHRASE.test(word) || /ing$/.test(word)) return null;
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
    // "would by a new phone", "should by another brand": a purchase object. Without a modal
    // only a possessive object counts ("I usually by my food").
    else if (strict) {
      if (/^(?:my|your|his|our|their)$/.test(word) && !BY_TIME.test(lower(after))) fix = "buy";
    } else if (
      /^(?:another|some|more|them|it|these|those|one|stock|stocks|shares|tickets|groceries|food)$/.test(
        word,
      ) ||
      // "wouldn't by this pen", "I'll by you lunch": not "will by this time", "by my count".
      (/^(?:this|that|my|your|his|our|their|you|me|us)$/.test(word) &&
        after?.kind === "word" &&
        !BY_TIME.test(after.lower) &&
        !(word === "you" && after.lower === "and")) ||
      (/^(?:a|an)$/.test(word) &&
        after?.kind === "word" &&
        !/^(?:margin|factor|mile|landslide|large|wide|narrow|small|long|little|lot|few|vote|majority)$/.test(
          after.lower,
        ) &&
        !/(?:er|or|ist|ian)$/.test(after.lower))
    )
      fix = "buy";
    if (!fix) return null;
    return slot(ctx, "englishConfusedWords", start, end, m.groups!.target, [fix], m.index);
  },
  confusionThenThan: (m, ctx) => {
    const target = m.groups!.target;
    if (target !== "then") return null;
    const before = ctx.text.slice(Math.max(0, m.index - 80), m.index);
    // "If I get stronger at this then I…", "when you feel better then you…": a sequence.
    const sentence = /[^.!?;:\n]*$/.exec(ctx.text.slice(Math.max(0, m.index - 200), m.index))![0];
    if (
      /\b(?:if|when|whenever|once|as long as|unless|after|before|while|until|since)\b/i.test(
        sentence,
      )
    )
      return null;
    // The comparison and "then" share a clause: no punctuation or linking word between.
    const clause = /[^.!?;:,\n(]*$/.exec(before)![0];
    const words = clause.toLowerCase().match(/[a-z]+/g) ?? [];
    let k = words.length - 1;
    while (k >= 0 && !comparative(words[k])) k--;
    // Right after the comparative, englishWordConfusions decides; here words stand between.
    if (k < 0 || k === words.length - 1 || words.length - k > 7) return null;
    const gap = words.slice(k + 1);
    if (
      gap.some(
        (w) =>
          /^(?:and|or|but|so|if|when|because|until|since|just|only|even|back|and|until)$/.test(w) ||
          (verbsOf(w).some((v) => v.form === "third" || v.form === "past") &&
            !englishWordInfo(w)?.noun),
      )
    )
      return null;
    // "even more then"? "If you need more, then call": a sequence needs a clause after then.
    if (
      /^(?:and|or|but|just|since|until|by|from|back|even|only|right|since)$/.test(
        words.at(-1) ?? "",
      )
    )
      return null;
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
    if (!subjectComparison && !nounPhrase) return null;
    // "…then the old version failed": a clause after then is a sequence; names and code abstain.
    const rest = tokensAfter(ctx, m.index + m[0].length, 6);
    if (rest.some((t) => t.kind === "other")) return null;
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
      return null;
    // "more then the next day": a time sequence noun after "then".
    if (/^(?:next|following)$/.test(lower(after))) return null;
    const start = m.index;
    return slot(ctx, "englishThenThan", start, start + 4, target, ["than"], start);
  },
  confusionEverEvery: (m, ctx) => {
    const target = m.groups!.target;
    const [start, end] = m.indices!.groups!.target;
    const prev = wordBefore(ctx, m.index);
    // "the best ever season", "hardly ever", "if ever", "than ever".
    if (
      /^(?:hardly|never|if|than|as|nor|forever|best|worst|first|only|greatest|biggest)$|est$/.test(
        prev,
      )
    )
      return null;
    const [next] = tokensAfter(ctx, end, 1);
    const word = next?.kind === "word" ? next.lower : "";
    // "a blackout ever Monday" closes a noun phrase; only a verb or clause start before it.
    const prevNoun = !!prev && !FUNCTION_WORDS.has(prev) && !englishWordInfo(prev)?.verbs.length;
    const ok =
      (next?.kind === "number" && !prevNoun) ||
      (WEEKDAYS.test(word) && !prevNoun) ||
      (EVERY_NOUNS.test(word) &&
        (next?.kind !== "word" || next.text === next.lower || WEEKDAYS.test(word)));
    if (!ok || /^(?:since|after|so|more|again)$/.test(word)) return null;
    return slot(ctx, "englishConfusedWords", start, end, target, ["every"], m.index);
  },
  confusionEveryEver: (m, ctx) => {
    const verb = m.groups!.verb;
    const read = englishWordInfo(verb);
    if (!read || read.noun || !participle(verb)) return null;
    const [start, end] = m.indices!.groups!.target;
    return slot(ctx, "englishConfusedWords", start, end, m.groups!.target, ["ever"], m.index);
  },
  confusionEveryAfterSubject: (m, ctx) => {
    const [start, end] = m.indices!.groups!.target;
    return {
      ruleId: "englishConfusedWords",
      messageKey: "review_msg_ever_every",
      range: { start, end },
      alternatives: [caseLike(m.groups!.target, "ever")],
      context: evidence(ctx, m.index, m.index + m[0].length),
    };
  },
  confusionNowKnow: (m, ctx) => {
    const [start, end] = m.indices!.groups!.target;
    const [next] = tokensAfter(ctx, end, 1);
    const word = lower(next);
    const closes =
      (next?.kind === "end" && /^let/i.test(m[0]) && /^[.!]/.test(next.text)) ||
      /^(?:what|where|when|why|how|who|whether|if|about|which|anything|much)$/.test(word);
    if (!closes) return null;
    return slot(ctx, "englishConfusedWords", start, end, m.groups!.target, ["know"], m.index);
  },
  confusionAnAnd: (m, ctx) => {
    const target = m.groups!.target;
    if (target !== "an") return null;
    const [start, end] = m.indices!.groups!.target;
    const [next, after] = tokensAfter(ctx, end, 2);
    if (next?.kind !== "word") return null;
    const word = next.lower;
    const read = englishWordInfo(word);
    const prev = wordBefore(ctx, m.index);
    // The word before must end a phrase: a verb, adjective, adverb or noun, not a preposition.
    if (!prev || (FUNCTION_WORDS.has(prev) && !/^(?:on|off|up|down|in|out|over|once)$/.test(prev)))
      return null;
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
    if (!ok) return null;
    return slot(ctx, "englishConfusedWords", start, end, target, ["and"], m.index);
  },
  confusionToWere: (m, ctx) => {
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
      return null;
    return slot(ctx, "englishWereWhere", start, end, m.groups!.target, ["where"], m.index);
  },
  confusionIfWhere: (m, ctx) => {
    const [start, end] = m.indices!.groups!.target;
    return slot(ctx, "englishWereWhere", start, end, m.groups!.target, ["were"], m.index);
  },
  confusionWhereIng: (m, ctx) => {
    const verb = m.groups!.verb;
    const read = englishWordInfo(verb);
    if (!read?.verbs.some((v) => v.form === "ing")) return null;
    const prev = wordBefore(ctx, m.index);
    const prevRead = englishWordInfo(prev);
    const subject =
      /^(?:they|we|you)$/.test(prev) ||
      (!!prevRead?.noun &&
        prevRead.plural &&
        !/^(?:places|areas|cases|situations|times|days|conditions|jobs|countries|cities|events)$/.test(
          prev,
        ));
    if (!subject) return null;
    // "conditions where working is hard": a gerund subject with its own verb.
    const [next] = tokensAfter(ctx, m.index + m[0].length, 1);
    if (/^(?:is|was|has|can|will|would|seems|becomes|makes)$/.test(lower(next))) return null;
    const [start, end] = m.indices!.groups!.target;
    return slot(ctx, "englishWereWhere", start, end, m.groups!.target, ["were"], m.index);
  },
  confusionWhereYou: (m, ctx) => {
    if (!afterBreak(ctx, m.index)) return null;
    const pred = m.groups!.pred;
    const read = englishWordInfo(pred);
    const ok =
      /^(?:able|aware|sure|ready|happy|right|wrong|there|here)$/.test(pred) ||
      (!!read &&
        read.verbs.some((v) => v.form === "participle") &&
        !read.verbs.some((v) => v.form === "base"));
    if (!ok || !/^[^.!\n]*\?/.test(ctx.text.slice(m.index, m.index + 160))) return null;
    const [start, end] = m.indices!.groups!.target;
    return slot(ctx, "englishWereWhere", start, end, m.groups!.target, ["were"], m.index);
  },
} satisfies Record<string, MatchFixer>;

/** A finding of a slot rule stays when it starts in the chunk, outside a named example. */
const kept = (ctx: DetectContext, f: RawFinding) =>
  f.range.start >= ctx.from && f.range.start < ctx.to && !quotedMention(ctx, f);

/** The named findings filters of grammar/rules/en.yaml (`filter:`). */
export const FILTERS = {
  /** US English only; the findings that start in the chunk, outside named examples. */
  slotFindings: (ctx, findings) =>
    ctx.lang !== "en_US" ? [] : findings.filter((f) => kept(ctx, f)),
  /** The same, and only the first finding at each start: an earlier frame wins. */
  slotFindingsOncePerStart: (ctx, findings) => {
    if (ctx.lang !== "en_US") return [];
    const starts = new Set<number>();
    return findings.filter((f) => {
      if (starts.has(f.range.start)) return false;
      starts.add(f.range.start);
      return kept(ctx, f);
    });
  },
  /** The same, and a finding that overlaps an earlier one is dropped. */
  slotFindingsNoOverlap: (ctx, findings) => {
    if (ctx.lang !== "en_US") return [];
    const taken: RawFinding[] = [];
    return findings.filter((f) => {
      const { start, end } = f.range;
      if (taken.some((t) => t.range.start < end && start < t.range.end)) return false;
      taken.push(f);
      return kept(ctx, f);
    });
  },
} satisfies Record<string, FindingsFilter>;
