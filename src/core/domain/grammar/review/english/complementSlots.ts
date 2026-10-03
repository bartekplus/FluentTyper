import { englishInflect, englishLemma } from "../../implementations/helpers/EnglishInflection";
import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import { englishVerbForms } from "../../implementations/helpers/EnglishVerbForms";
import { NOUN_LIKE_ING } from "../englishParticiples";
import type { PhraseRow } from "../englishPhraseTables";
import { frameMatches, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { caseLike, english, evidence, FUNCTION_WORDS, tokensAfter, wordBefore } from "./slotWords";

// Verb complements decided by the lexicon: a missing "to" ("I want go"), a gerund where an
// infinitive belongs ("can't afford buying") and the reverse ("enjoy to swim").

export const PHRASES: readonly PhraseRow[] = [];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

const OBJECT = /^(?:me|you|him|her|us|it|them)$/;
const PARTICLE = /^(?:out|up|down|off|in|on|back|over|away)$/;
// Words before want/need/like/try that make it a noun or a preposition: "for want of",
// "the need arises", "a try", "looks like rain".
const NOT_VERB_BEFORE =
  /^(?:the|a|an|for|of|no|any|every|each|my|your|his|her|its|our|their|this|that|these|those|looks?|looked|feels?|felt|seems?|seemed|sounds?|sounded|just|much|more|most|nothing|something|anything|is|are|was|were|be|been)$/;

const SUBJECT = /^(?:i|you|we|they|he|she|it|who)$/;
// Before a subject pronoun these make the clause a relative one with an object gap: "the
// woman he loves go…", "what you want using…".
const GAP_HEADS = /^(?:that|which|what|whatever|ones|things|all|everything|anything)$/;

/**
 * The head verb has a subject that is no relative clause's: "I want go" but not "the ones you
 * love walk out", "the products you want using".
 */
function plainSubject(ctx: DetectContext, headStart: number): boolean {
  const subject = wordBefore(ctx, headStart);
  if (!SUBJECT.test(subject)) return true;
  const before = wordBefore(ctx, headStart - subject.length - 1);
  if (!before || (FUNCTION_WORDS.has(before) && !GAP_HEADS.test(before))) return true;
  if (GAP_HEADS.test(before)) return false;
  const read = englishWordInfo(before);
  return !(read ? read.noun || read.plural : true);
}

/** A base verb with no other verb's form; `verbOnly` when the lexicon reads it as nothing else. */
function base(word: string): { lemma: string; verbOnly: boolean } | null {
  if (word === "be" || word === "do" || word === "have" || word === "get" || word === "go")
    return { lemma: word, verbOnly: true };
  if (FUNCTION_WORDS.has(word)) return null;
  const forms = englishVerbForms(word);
  if (forms && forms.lemma !== word) return null;
  const read = englishWordInfo(word);
  if (!read?.verbs.some((v) => v.form === "base" && v.lemma === word)) return null;
  if (read.verbs.some((v) => v.lemma !== word)) return null;
  return { lemma: word, verbOnly: !read.noun && !read.adjective && !read.adverb && !read.plural };
}

/** The verb's own object or particle follows: an object pronoun, a particle or a determiner. */
function verbEvidence(ctx: DetectContext, end: number, determiner: boolean): boolean {
  const [next, after] = tokensAfter(ctx, end, 2);
  if (next?.kind !== "word") return false;
  if (OBJECT.test(next.lower) || PARTICLE.test(next.lower)) return true;
  return (
    determiner &&
    /^(?:the|a|an|my|your|his|her|our|their|some|any|another|this|these|those|every|each)$/.test(
      next.lower,
    ) &&
    !(
      after?.kind === "word" &&
      /^(?:day|week|morning|night|time|weekend|month|year|next|following|same|rest|most|best|least|lot|bit|little|more|whole|great|good)$/.test(
        after.lower,
      )
    )
  );
}

function push(
  ctx: DetectContext,
  findings: RawFinding[],
  messageKey: RawFinding["messageKey"],
  start: number,
  end: number,
  alternatives: string[],
  from: number,
): void {
  if (findings.some((f) => f.range.start === start)) return;
  findings.push({
    ruleId: "englishVerbComplements",
    messageKey,
    range: { start, end },
    alternatives,
    context: evidence(ctx, from, end),
  });
}

/** "I want go", "try get", "would like see", "needs be there": an infinitive without "to". */
function missingTo(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `(?<head>want|wants|wanted|need|needs|needed|like|likes|love|loves|hope|hopes|hoped|try|tries|tried|decide|decided|decides)${SPACE}(?<verb>[a-z]+)${WORD_END}`,
    "verb",
  )) {
    const head = m.groups!.head.toLowerCase();
    const verb = m.groups!.verb;
    // "need further details", "want better tools": comparatives the dictionary lists as verbs.
    if (ctx.dictionary.has(verb) || /^(?:further|farther|better|worse|lower|less)$/.test(verb))
      continue;
    const before = wordBefore(ctx, m.index);
    if (
      (NOT_VERB_BEFORE.test(before) && !(before === "just" && !/^like/.test(head))) ||
      (/^(?:if|there|must|let|all|would|will)$/.test(before) &&
        /^need|^hope|^love/.test(head) &&
        before !== "would")
    )
      continue;
    if (!plainSubject(ctx, m.index)) continue;
    // "the documents that the managers need include…": a relative clause with a noun subject.
    if (
      /\b(?:that|which|whom)[ \t\u00a0]+(?:(?:the|a|an|my|our|your|their|his|her)[ \t\u00a0]+)?[a-z]+[ \t\u00a0]+$/i.test(
        ctx.text.slice(Math.max(0, m.index - 40), m.index),
      )
    )
      continue;
    // "What needs do you have?", "needs do not": do as an auxiliary.
    if (
      verb === "do" &&
      /^(?:not|you|we|they|i|he|she|it|it['’]s)$/.test(
        tokensAfter(ctx, m.index + m[0].length, 1)[0]?.lower ?? "",
      )
    )
      continue;
    // An -s head needs a singular subject: "Our needs become…", "Men's wants…" are nouns.
    // An adverb may stand between: "She really needs…".
    const adverbial = /^(?:really|just|also|still|always|never|only|often|usually|probably)$/.test(
      before,
    );
    const subjectAt = adverbial ? m.index - before.length - 1 : m.index;
    const subjectWord = adverbial ? wordBefore(ctx, subjectAt) : before;
    if (
      /s$/.test(head) &&
      !/^(?:he|she|it|who|that|which|one|someone|everyone|nobody)$/.test(subjectWord) &&
      !/^[A-Z][a-z]+$/.test(ctx.text.slice(subjectAt - subjectWord.length - 1, subjectAt - 1))
    )
      continue;
    // "Why would love make us happy", "Don't let hope become": a noun love/hope.
    if (
      /^(?:love|hope|loves|hopes)$/.test(head) &&
      !/^(?:i|you|we|they|he|she|really|also|would|['’]d)$|['’]d$/.test(before)
    )
      continue;
    // "like" is a verb after a subject, would/'d/do or to; elsewhere a preposition.
    if (
      /^(?:like|likes|love|loves)$/.test(head) &&
      /^(?:like|love)$/.test(head) &&
      !/^(?:i|you|we|they|would|should|could|do|don['’]t|didn['’]t|doesn['’]t|not|never|to|really|also|just|['’]d)$|['’]d$/.test(
        before,
      )
    )
      continue;
    const b = base(verb);
    if (!b) continue;
    const end = m.index + m[0].length;
    // "need talk to them", "love listen to music": verbs whose noun reading never follows
    // need/want bare, before a preposition or the end.
    const intransitive =
      /^(?:talk|listen|stay|wait|speak|think|reply|look|complain|apologize|come)$/.test(verb) &&
      /^(?:to|with|about|for|at|on|in|of|here|there|home|now|longer)?$/.test(
        tokensAfter(ctx, end, 1)[0]?.lower ?? "",
      );
    // Nouns a person needs or wants bare before a determiner: "need help the most".
    const massNoun =
      /^(?:help|work|time|rest|sleep|money|space|room|food|water|love|care|practice|support|advice|change|power|fun|access|peace|fish|cash)$/.test(
        verb,
      );
    // "I want work in Paris": a mass noun before a preposition.
    if (massNoun && /^(?:in|on|at|for|with)$/.test(tokensAfter(ctx, end, 1)[0]?.lower ?? ""))
      continue;
    if (
      !b.verbOnly &&
      !intransitive &&
      (/^(?:hope|hopes|love|loves)$/.test(head) ||
        // "We like make it", but "I like fish a lot": a verb that is also a noun needs its object.
        !verbEvidence(
          ctx,
          end,
          /^(?:try|tries|tried|like|likes)$/.test(head) ||
            // need/want: a subject before and an article or possessive after ("needs buy a car").
            (!massNoun &&
              !!before &&
              /^(?:a|an|the|another|my|your|his|her|our|their)$/.test(
                tokensAfter(ctx, end, 1)[0]?.lower ?? "",
              )),
        ))
    )
      continue;
    // "need not", "Need I say more": a modal need.
    if (/^need/.test(head) && /^(?:not|i|we|you|they|he|she)$/.test(verb)) continue;
    const [start, verbEnd] = m.indices!.groups!.verb;
    push(ctx, findings, "review_msg_missing_to", start, verbEnd, [`to ${verb}`], m.index);
  }
  return findings;
}

/** "can't afford buying", "you want creating": an -ing form where an infinitive belongs. */
function gerundForInfinitive(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `(?<head>afford|want|wants|wanted|struggling|refuse|refused|refuses|manage|managed|manages|decide|decided|decides|promise|promised|promises|(?:advise|advised|advises|remind|reminds|reminded|encourage|encouraged|encourages|help|helps|helped|tell|told|ask|asked|allow|allowed)${SPACE}(?:me|you|him|her|us|them))(?:${SPACE}(?<not>not))?${SPACE}(?<verb>[a-z]+ing)${WORD_END}`,
    "verb",
  )) {
    const verb = m.groups!.verb;
    if (ctx.dictionary.has(verb) || NOUN_LIKE_ING.test(verb)) continue;
    // Prepositions in -ing: "the changes you want including…", "…you wanted using our agent".
    if (/^(?:using|including|following|regarding|concerning|according|considering)$/.test(verb))
      continue;
    if (!plainSubject(ctx, m.index)) continue;
    const head = m.groups!.head.toLowerCase();
    const tail = tokensAfter(ctx, m.index + m[0].length, 6);
    // "The belt wants replacing.": want + -ing means "needs" before a clause end.
    if (
      /^want/.test(head) &&
      (tail[0]?.kind !== "word" || /ly$|^(?:also|too|now|soon)$/.test(tail[0].lower))
    )
      continue;
    // "He reminded them staying calm was…": the -ing clause is a subject.
    if (
      tail.some(
        (t) => t.kind === "word" && /^(?:is|was|are|were|would|will|helps?|helped)$/.test(t.lower),
      )
    )
      continue;
    const read = englishWordInfo(verb);
    if (!read || read.noun || read.adjective) continue;
    const lemma = englishLemma(verb, "ing");
    if (!lemma) continue;
    if (NOT_VERB_BEFORE.test(wordBefore(ctx, m.index))) continue;
    const [start, end] = m.indices!.groups!.verb;
    push(ctx, findings, "review_msg_verb_complements", start, end, [`to ${lemma}`], m.index);
  }
  return findings;
}

/** "I enjoy to swim", "We avoided to go": verbs that take a gerund. */
function infinitiveForGerund(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `(?<head>enjoy|enjoys|enjoyed|avoid|avoids|avoided|consider|considers|considered|suggest|suggests|suggested|finish|finishes|finished|admit|admits|admitted|recommend|recommends|recommended|quit|quits|keep|keeps|kept|risk|risks|risked|postpone|postponed|imagine|imagined|deny|denied)${SPACE}(?<target>to${SPACE}(?<verb>[a-z]+))${WORD_END}`,
    "target",
  )) {
    const verb = m.groups!.verb;
    const before = ctx.text.slice(Math.max(0, m.index - 24), m.index);
    // "is considered to be", "is recommended to use": a passive takes the infinitive.
    if (
      /\b(?:is|are|was|were|be|been|being|['’]s|['’]re|get|got)[ \t ]+(?:\w+ly[ \t ]+)?$/i.test(
        before,
      )
    )
      continue;
    if (NOT_VERB_BEFORE.test(wordBefore(ctx, m.index))) continue;
    const b = base(verb);
    if (!b?.verbOnly || verb === "be") continue;
    const ing = englishInflect(verb, "ing");
    if (!ing) continue;
    const [start, end] = m.indices!.groups!.target;
    push(ctx, findings, "review_msg_gerund_complement", start, end, [ing], m.index);
  }
  return findings;
}

/** "I'm used to run", "We are accustomed to work late": "to" there is a preposition. */
function usedToGerund(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    // Not "they": "they are used to define the genre" is a passive of things.
    `(?:I|you|we|he|she)(?:${SPACE}(?:am|are|is|was|were|get|got|became)|['’](?:m|re|s))(?:${SPACE}(?:so|very|really|quite|not|already|well))?${SPACE}(?:used|accustomed)${SPACE}to${SPACE}(?<verb>[a-z]+)${WORD_END}`,
    "verb",
  )) {
    const verb = m.groups!.verb;
    const b = base(verb);
    const next = tokensAfter(ctx, m.index + m[0].length, 1)[0];
    // "I am used to work as…" may mean "I am used (employed) to work as…".
    if (!b?.verbOnly || verb === "be" || next?.lower === "as") continue;
    const ing = englishInflect(verb, "ing");
    if (!ing) continue;
    const [start, end] = m.indices!.groups!.verb;
    push(ctx, findings, "review_msg_gerund_complement", start, end, [ing], m.index);
  }
  return findings;
}

// Adjectives and participles that take a to-infinitive.
const INFINITIVE_ADJECTIVES =
  /^(?:easy|easier|hard|harder|difficult|possible|impossible|happy|glad|ready|able|unable|willing|eager|necessary|important|better|best|cool|nice|safe|forced|allowed|supposed|expected|required|pleased|proud|expensive|cheap|fun|tough|simple|recommendable|advisable|reluctant|keen|free|determined|obliged|meant)$/;

/** "It's easy get feedback", "I'd be happy help": an adjective or participle before a bare verb. */
function adjectiveBeforeBareVerb(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `(?:is|are|was|were|be|been|[a-z]+['’](?:s|re|m)|am)(?:${SPACE}(?:very|really|so|too|quite|perfectly|not|more|most|always|also|still|extremely))?${SPACE}(?<adjective>[a-z]+)${SPACE}(?<verb>[a-z]+)${WORD_END}`,
    "verb",
  )) {
    const { adjective, verb } = m.groups!;
    if (FUNCTION_WORDS.has(adjective) || ctx.dictionary.has(verb)) continue;
    if (!INFINITIVE_ADJECTIVES.test(adjective)) continue;
    const b = base(verb);
    if (!b || /^(?:please|thank|except)$/.test(verb)) continue;
    const end = m.index + m[0].length;
    if (!b.verbOnly && !verbEvidence(ctx, end, false)) continue;
    const [start, verbEnd] = m.indices!.groups!.verb;
    push(ctx, findings, "review_msg_missing_to", start, verbEnd, [`to ${verb}`], m.index);
  }
  return findings;
}

/** "He wants that I send…": want takes an object and an infinitive. */
function wantThat(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const objects: Record<string, string> = {
    i: "me",
    you: "you",
    he: "him",
    she: "her",
    we: "us",
    they: "them",
  };
  for (const m of frameMatches(
    ctx,
    `(?<target>(?<head>want|wants|wanted)${SPACE}that${SPACE}(?<subject>I|you|he|she|we|they))${SPACE}[a-z]+${WORD_END}`,
  )) {
    const { head, subject } = m.groups!;
    const [start, end] = m.indices!.groups!.target;
    push(
      ctx,
      findings,
      "review_msg_verb_complements",
      start,
      end,
      [`${head} ${objects[subject.toLowerCase()]} to`],
      m.index,
    );
  }
  return findings;
}

/** "I look forward hearing from you", "looking forward too": look forward takes "to". */
function lookForward(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `(?:look|looks|looked|looking)${SPACE}forward(?<gap>${SPACE})(?<next>too|(?:from|of)(?=${SPACE}(?:you|him|her|them|hearing|seeing)${WORD_END})|[a-z]+ing)${WORD_END}`,
    "next",
  )) {
    const next = m.groups!.next.toLowerCase();
    const [start, end] = m.indices!.groups!.next;
    if (next.endsWith("ing")) {
      const read = englishWordInfo(next);
      if (!read?.verbs.some((v) => v.form === "ing")) continue;
      push(
        ctx,
        findings,
        "review_msg_forward_gerund",
        start,
        end,
        [`to ${m.groups!.next}`],
        m.index,
      );
    } else
      push(ctx, findings, "review_msg_forward_gerund", start, end, [caseLike(next, "to")], m.index);
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: ["englishVerbComplements"],
    detect: english(
      missingTo,
      gerundForInfinitive,
      infinitiveForGerund,
      usedToGerund,
      adjectiveBeforeBareVerb,
      wantThat,
      lookForward,
    ),
  },
];
