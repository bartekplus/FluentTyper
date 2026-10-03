import { englishInflect, englishLemma } from "../../implementations/helpers/EnglishInflection";
import { englishNounPair, englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
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
  tokensAfter,
  wordBefore,
} from "./slotWords";
import { nounNumber } from "./nounNumberSlots";

// Everyday slips in verb frames, existentials and fixed word pairs: "keep see" (seeing),
// "going be" (to be), "makes me thinking" (think), "Was there many…" (Were), "reading though
// the contract" (through), "give me advise" (advice), "would we helpful" (be), "do not us
// this" (use), "take sometime" (some time), "went good" (well), "Do anyone know" (Does).

const S = SPACE;
const E = WORD_END;

const WOLD_NEXT =
  "you|have|be|like|love|not|never|rather|prefer|need|want|go|do|make|get|take|say|see|help";
export const PHRASES: readonly PhraseRow[] = [
  ["int he", "in the"],
  ...WOLD_NEXT.split("|").map((next): PhraseRow => [`wold ${next}`, `would ${next}`]),
  ...["file", "files", "document", "documents", "spreadsheet", "copy", "report"].map(
    (noun): PhraseRow => [`attache ${noun}`, `attached ${noun}`],
  ),
  [
    ["see attache", "find attache"],
    ["see attached", "find attached"],
  ],
  ["latter on", "later on"],
];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

type Rule = Pick<RawFinding, "ruleId" | "messageKey">;
const CONFUSED: Rule = { ruleId: "englishConfusedWords", messageKey: "review_msg_confused_word" };
const COMPOUND: Rule = { ruleId: "englishContextualCompounds", messageKey: "review_msg_compounds" };
const AGREEMENT: Rule = {
  ruleId: "englishSubjectVerbAgreement",
  messageKey: "review_msg_subject_verb",
};

function push(
  ctx: DetectContext,
  findings: RawFinding[],
  rule: Rule,
  m: RegExpExecArray,
  replacement: string,
  group = "target",
): void {
  const [start, end] = m.indices!.groups![group];
  findings.push({
    ...rule,
    range: { start, end },
    alternatives: [caseLike(ctx.source.slice(start, end), replacement)],
    context: evidence(ctx, m.index, end),
  });
}

/** A base verb with no noun, adjective or other form: "see", "send", "explain". */
function bareVerb(word: string): boolean {
  if (FUNCTION_WORDS.has(word)) return false;
  const read = englishWordInfo(word);
  return (
    !!read &&
    read.verbs.length > 0 &&
    read.verbs.every((v) => v.form === "base" && v.lemma === word) &&
    !read.noun &&
    !read.adjective &&
    !read.adverb
  );
}

// "I keep see errors": keep takes the -ing form.
const KEEP = `(?:keep|keeps|kept|keeping)${S}(?<target>[a-z]+)${E}`;
// "It's going be hard": going takes "to".
const GOING = `(?:am|is|are|was|were|['’]m|['’]re|(?:it|that|he|she|there|what|who|this)['’]s)${S}going${S}(?<target>[a-z]+)${E}`;
// "That makes me thinking": make/let + an object + the base verb.
const CAUSATIVE = `(?:make|makes|made|making|let|lets|letting)${S}(?:me|you|him|her|us|them|someone|everyone|people)${S}(?<target>[a-z]+ing)${E}`;

function verbFrames(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, KEEP)) {
    const verb = m.groups!.target;
    if (ctx.dictionary.has(verb) || FUNCTION_WORDS.has(verb)) continue;
    // A verb that is also a noun ("keep track", "keep time") needs an object after it.
    const read = englishWordInfo(verb);
    const next = tokensAfter(ctx, m.index + m[0].length, 1)[0];
    const object =
      next?.kind === "word" &&
      /^(?:the|a|an|this|that|these|those|my|your|his|her|our|their|its|it|them|me|us|him|you)$/.test(
        next.lower,
      );
    if (
      !bareVerb(verb) &&
      !(
        object &&
        !!read?.verbs.length &&
        read.verbs.every((v) => v.form === "base" && v.lemma === verb) &&
        !read.adjective
      )
    )
      continue;
    const ing = englishInflect(verb, "ing");
    if (ing)
      push(
        ctx,
        findings,
        { ruleId: "englishVerbComplements", messageKey: "review_msg_gerund_complement" },
        m,
        ing,
      );
  }
  for (const m of frameMatches(ctx, GOING)) {
    const verb = m.groups!.target;
    if (ctx.dictionary.has(verb) || (verb !== "be" && !bareVerb(verb))) continue;
    push(
      ctx,
      findings,
      { ruleId: "englishVerbComplements", messageKey: "review_msg_missing_to" },
      m,
      `to ${verb}`,
    );
  }
  for (const m of frameMatches(ctx, CAUSATIVE)) {
    const verb = m.groups!.target;
    const read = englishWordInfo(verb);
    if (!read || read.noun || read.adjective || ctx.dictionary.has(verb)) continue;
    // "The pool made me freezing", "made them recurring characters": an -ing adjective or a
    // gerund; only an object or a particle after it shows the verb.
    const next = tokensAfter(ctx, m.index + m[0].length, 1)[0];
    if (
      next?.kind !== "word" ||
      !/^(?:the|a|an|this|that|these|those|my|your|his|her|our|their|its|it|them|me|us|him|of|about|into|on|at|for|to|with|up|out|over|through)$/.test(
        next.lower,
      )
    )
      continue;
    const base = englishLemma(verb, "ing");
    if (base && base !== verb)
      push(
        ctx,
        findings,
        { ruleId: "englishVerbComplements", messageKey: "review_msg_causative_base" },
        m,
        base,
      );
  }
  return findings;
}

// "Was there too many people?", "Is there several options?": the plural takes were/are.
const WAS_THERE = `(?<target>was|is)${S}there${S}(?:(?:too|so)${S})?(?<quantity>many|several|a${S}few|a${S}lot${S}of|lots${S}of|plenty${S}of|dozens${S}of)${S}(?<noun>[a-z]+)${E}`;

function wasThereMany(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, WAS_THERE)) {
    if (!afterBreak(ctx, m.index)) continue;
    const { target, quantity, noun } = m.groups!;
    // "Is there a lot of water?": only a plural noun after "of" needs the plural verb.
    if (/of$/i.test(quantity) && nounNumber(noun)?.number !== "plural" && noun !== "people")
      continue;
    push(
      ctx,
      findings,
      {
        ruleId: "englishExistentialAgreement",
        messageKey: "review_msg_existential_agreement",
      },
      m,
      target.toLowerCase() === "was" ? "were" : "are",
    );
  }
  return findings;
}

// "reading though the contract": a verb of passage takes "through" before its noun phrase.
const THOUGH = `(?:go|goes|going|went|gone|read|reads|reading|look|looks|looking|looked|walk|walks|walked|walking|pass|passed|passing|get|got|getting|gets|flip|flipped|browse|browsed|scroll|scrolled|sift|search|searched|searching|dig|came|come|coming|run|ran|running|lived|living|break|broke|sailed|been)${S}(?<target>though)${S}(?:the|a|an|this|that|these|those|my|your|his|her|our|their|it|all|some|each|every)${E}`;

function thoughThrough(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, THOUGH)) {
    // "It worked though the results were bad": a finite verb makes "though" a conjunction.
    const tokens = tokensAfter(ctx, m.index + m[0].length, 6);
    const end = tokens.findIndex((t) => t.kind !== "word");
    const clause = (end < 0 ? tokens : tokens.slice(0, end)).some((t) => {
      if (/^(?:is|are|was|were|has|have|had|will|would|can|could|did|does|do)$/.test(t.lower))
        return true;
      const read = englishWordInfo(t.lower);
      return !!read?.verbs.some((v) => v.form === "past" || v.form === "third") && !read.noun;
    });
    if (!clause) push(ctx, findings, CONFUSED, m, "through");
  }
  return findings;
}

// "give me advise on it": the noun is advice.
const ADVISE = `(?:give|gives|gave|giving|given|need|needs|needed|some|any|your|my|his|our|their|good|bad|great|expert|legal|medical|financial|professional|helpful|useful|no|for|the)${S}(?:me${S}|us${S}|him${S}|them${S}|you${S})?(?<target>advise)(?=${S}(?:on|about|for|from|regarding|please)${E}|[ \\t\\u00a0]*(?:[.,!?;:]|$))`;

// "That would we very helpful": a modal, then "we" where "be" belongs.
const WE_BE = `(?<modal>would|will|could|should|might|may|must)(?:${S}(?:probably|definitely|certainly|also|really|surely))?${S}(?<target>we)${S}(?<next>very|so|really|quite|too|great|good|fine|helpful|useful|nice|possible|able|happy|glad|better|best|ready|available|appreciated|interesting|important|necessary)${E}`;

// "Please do not us this door": a verb slot before a determiner object.
const US_USE = `(?:do${S}not|don['’]t|please|can|will|should|must|would|could|cannot|can['’]t|won['’]t|shouldn['’]t|didn['’]t)${S}(?<target>us)${S}(?:the|this|that|these|those|a|an|my|your|our|their|it|them|any|some)${E}`;

// "Doe he like me?": does/do.
const DOE = `(?<target>doe)${S}(?<subject>he|she|it|you|they|we|i)${S}[a-z]+${E}`;

function wordPairs(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, ADVISE)) {
    if (ctx.dictionary.has("advise")) continue;
    push(ctx, findings, CONFUSED, m, "advice");
  }
  for (const m of frameMatches(ctx, WE_BE)) {
    // "Would we be…?": at a clause start the modal opens a question.
    if (afterBreak(ctx, m.index)) continue;
    push(ctx, findings, CONFUSED, m, "be");
  }
  for (const m of frameMatches(ctx, US_USE)) push(ctx, findings, CONFUSED, m, "use");
  for (const m of frameMatches(ctx, DOE)) {
    if (!afterBreak(ctx, m.index)) continue;
    push(ctx, findings, CONFUSED, m, /^(?:he|she|it)$/i.test(m.groups!.subject) ? "does" : "do");
  }
  return findings;
}

// "I got it did yesterday": get + an object + the participle "done".
const GOT_DID = `(?:got|get|gets|getting)${S}(?:it|them|this|that|everything|all${S}of${S}it|most${S}of${S}it|(?:my|her|his|our|their|the|your)${S}[a-z]+)${S}(?<target>did)(?=[ \\t\\u00a0]*(?:[.,!?;:]|$)|${S}(?:yesterday|today|already|early|before|by|in|on|last|quickly|fast)${E})`;

function gotItDone(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, GOT_DID))
    push(
      ctx,
      findings,
      { ruleId: "englishIrregularForms", messageKey: "review_msg_irregular_form" },
      m,
      "done",
    );
  return findings;
}

// "Kind regard," closes a letter: regards. "everyone of you": every one.
const REGARD = `(?:kind|best|warm|warmest|warmer)${S}(?<target>regard)(?=[ \\t\\u00a0]*(?:[,!.]|$|\\n))`;
const EVERY_ONE = `(?<target>everyone|everybody)${S}of${S}(?:you|us|them|the|these|those|my|our|your|their|his|her)${E}`;

function phrases(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const rule: Rule = {
    ruleId: "englishPhraseCorrections",
    messageKey: "review_msg_phrase_correction",
  };
  for (const m of frameMatches(ctx, REGARD)) {
    if (!afterBreak(ctx, m.index)) continue;
    push(ctx, findings, rule, m, "regards");
  }
  for (const m of frameMatches(ctx, EVERY_ONE)) {
    // "warn everyone of the danger": a verb that takes "of" after its object.
    if (
      /^(?:warn|warns|warned|warning|remind|reminds|reminded|inform|informs|informed|notify|notified|accuse|accused|rob|robbed|deprive|deprived|convince|convinced|assure|assured|suspect|suspected|clear|cleared|relieve|relieved|cure|cured|free|freed|tell|told|ask|asked|rid)$/.test(
        wordBefore(ctx, m.index),
      )
    )
      continue;
    push(ctx, findings, rule, m, "every one");
  }
  return findings;
}

// "Is there anyway to fix it?", "We need sometime to think", "need anymore information":
// the two-word forms.
const ANY_WAY = `(?:there(?:${S}(?:is|was)|['’]s)|is${S}there|was${S}there|find|found|no|know${S}of|have|has)${S}(?<target>anyway)${S}to${E}`;
// After "for", only a duration ("for sometime now"): "schedule it for sometime" names a time.
const SOME_TIME = `(?:(?:take|takes|took|taking|taken|need|needs|needed|have|has|had|having|spend|spent|spending|give|gave|given|giving|allow|allowed)${S}(?<target>sometime)(?=${S}(?:to|for|off|with|now|ago|alone|together|out|away|apart)${E}|[ \\t\\u00a0]*(?:[.,!?;:]|$))|for${S}(?<target2>sometime)(?=${S}(?:now|already|ago)${E}))`;
const ANY_MORE = `(?<target>anymore)${S}(?<noun>[a-z]+)${E}`;
const TIME_WORDS = /^(?:today|tonight|tomorrow|yesterday|now|then|though|either|anyway|please)$/;

function splitCompounds(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, ANY_WAY)) push(ctx, findings, COMPOUND, m, "any way");
  for (const m of frameMatches(ctx, SOME_TIME, (match) => match.index))
    push(ctx, findings, COMPOUND, m, "some time", m.groups!.target ? "target" : "target2");
  for (const m of frameMatches(ctx, ANY_MORE)) {
    const noun = m.groups!.noun;
    if (FUNCTION_WORDS.has(noun) || TIME_WORDS.test(noun)) continue;
    const read = englishWordInfo(noun);
    // "safe anymore due to…": an adjective after it starts a new phrase.
    if (read?.adjective) continue;
    if (!(
      nounOnly(noun) ||
      (read?.noun &&
        !read.adverb &&
        !read.verbs.some((v) => v.form !== "base" && v.form !== "third"))
    ))
      continue;
    push(ctx, findings, COMPOUND, m, "any more");
  }
  return findings;
}

// "Everything went good", "the clutch worked good": the verb takes the adverb "well".
const WENT_GOOD = `(?:went|goes|go|going|gone|worked|works|work|working|ran|runs|run|running|performed|played|slept|shifted)${S}(?<target>good)(?=[ \\t\\u00a0]*(?:[.,!?;:]|$)|${S}(?:until|and|but|so|today|yesterday|overall|too|though|enough|at)${E})`;

function wentGood(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, WENT_GOOD)) {
    // "This one works good enough for us" still wants well; "a good one" is no frame here.
    push(
      ctx,
      findings,
      { ruleId: "englishConfusedWords", messageKey: "review_msg_adverb_form" },
      m,
      "well",
    );
  }
  return findings;
}

// "More person are coming": more + a singular count noun + a plural verb.
const MORE_SINGULAR = `(?:more|fewer)${S}(?<target>[a-z]+)${S}(?:are|were|have|do)${E}`;

function moreSingular(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, MORE_SINGULAR)) {
    const noun = m.groups!.target;
    if (FUNCTION_WORDS.has(noun) || ctx.dictionary.has(noun)) continue;
    const read = englishWordInfo(noun);
    if (!read?.noun || read.plural || read.adjective || read.verbs.some((v) => v.form !== "base"))
      continue;
    const plural = noun === "person" ? "people" : englishNounPair(noun)?.plural;
    if (!plural) continue;
    push(
      ctx,
      findings,
      { ruleId: "englishNounNumber", messageKey: "review_msg_noun_count" },
      m,
      plural,
    );
  }
  return findings;
}

// "Do anyone know…?", "Do that mean…?", "…, do he?": does after a singular subject.
const DO_SINGULAR = `(?<target>do|don['’]t)${S}(?:anyone|anybody|someone|somebody|everyone|everybody|nobody|anything|something|everything|that|this|it|he|she)${S}(?<verb>[a-z]+)${E}`;
const TAG = `(?<=,${S})(?<target>do|don['’]t)${S}(?:he|she|it)(?=[ \\t\\u00a0]*\\?)`;

function doSingular(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const does = (typed: string) => (/^do$/i.test(typed) ? "does" : "doesn't");
  for (const m of frameMatches(ctx, DO_SINGULAR)) {
    if (!afterBreak(ctx, m.index)) continue;
    // A question: "Do that mean…?" needs the base verb after the subject.
    const verb = m.groups!.verb;
    const read = englishWordInfo(verb);
    if (!read?.verbs.some((v) => v.form === "base" && v.lemma === verb)) continue;
    if (!/\?/.test(ctx.text.slice(m.index, m.index + 160).split(/[.!\n]/)[0])) continue;
    push(ctx, findings, AGREEMENT, m, does(m.groups!.target));
  }
  for (const m of frameMatches(ctx, TAG, "target")) {
    // "He doesn't live here, do he?": the tag repeats the clause's own auxiliary.
    if (wordBefore(ctx, m.index) === "") {
      const clause = ctx.text.slice(Math.max(0, m.index - 80), m.index);
      if (!/\b(?:does|doesn['’]t|he|she|it)\b/i.test(clause)) continue;
    }
    push(ctx, findings, AGREEMENT, m, does(m.groups!.target));
  }
  return findings;
}

/** "the later of the two" is the latter. */
const LATTER = `the${S}(?<target>later)${S}of${S}(?:the|these|those|two|both)${E}`;

function latter(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, LATTER)) {
    const tokens = tokensAfter(ctx, m.index + m[0].length, 2);
    const after = /^(?:two|three|both)$/.test(tokens[0]?.lower ?? "") ? tokens[1] : tokens[0];
    // "the later of the two trains" compares times: a noun after it keeps "later".
    if (
      after?.kind === "word" &&
      !FUNCTION_WORDS.has(after.lower) &&
      englishWordInfo(after.lower)?.noun
    )
      continue;
    push(ctx, findings, CONFUSED, m, "latter");
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["englishVerbComplements"], detect: english(verbFrames) },
  { rules: ["englishExistentialAgreement"], detect: english(wasThereMany) },
  { rules: ["englishConfusedWords"], detect: english(thoughThrough, wordPairs, wentGood, latter) },
  { rules: ["englishIrregularForms"], detect: english(gotItDone) },
  { rules: ["englishPhraseCorrections"], detect: english(phrases) },
  { rules: ["englishContextualCompounds"], detect: english(splitCompounds) },
  { rules: ["englishNounNumber"], detect: english(moreSingular) },
  { rules: ["englishSubjectVerbAgreement"], detect: english(doSingular) },
];
