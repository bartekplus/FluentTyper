import { englishInflect } from "../implementations/helpers/EnglishInflection";
import { quotedMention } from "./english/grammarStyle1";
import { englishWordInfo } from "../implementations/helpers/EnglishLexicon";
import { englishVerbForms } from "../implementations/helpers/EnglishVerbForms";
import {
  applyWordCase,
  detectWordCase,
  wordSet,
} from "../implementations/helpers/GenericRuleShared";
import {
  EDGE,
  frameMatches,
  hasUserOrCasedWord,
  plainToken,
  SPACE,
  WORD_END,
} from "./phraseTemplates";
import type { DetectContext, RawFinding } from "./reviewDetectors";

const PRONOUN = /^(?:i|you|we|they|he|she|it)$/;
const DETERMINERS = wordSet(
  "the a an this that these those my your his her its our their some any every each no",
);
// Closed-class words: after an ambiguous past they start no noun compound ("saw that", "fell out").
const CLOSED = wordSet(
  "the a an this that these those my your his her its our their some any every each no it them " +
    "him us me you i he she we they what which who whom how why where when if whether to of in " +
    "on at by for from with into onto out up down off over under through about after before " +
    "since until around across along behind beneath between beyond against toward towards away " +
    "back again here there now then and but or nor so as than not never yet too also very " +
    "asleep apart aside ahead alone awake something anything nothing everything someone anyone " +
    "everyone nobody somebody anybody everybody past near like upon via within without " +
    "throughout inside outside below above beside among during except per despite unlike once " +
    "twice",
);
const ADVERBS = wordSet(
  "not never already just ever really still also even only all both since then now always",
);
// A head the following clause can modify with an object gap: "Everything we had went into it".
const GAP_HEADS = wordSet(
  "what whatever whoever whichever everything anything something nothing all",
);
// The lexicon does not mark these pasts as adjectives ("I am broke", "a woke reader"). Penniless
// "broke" describes people, so a thing that "is broke" is broken.
const ADJECTIVE_PASTS = wordSet("broke woke");
const NON_PERSON = /^(?:it|its|this|that|which|what|everything|something|nothing|anything)$/;
const PARTICLE = /^[ \t\u00a0]+(?:up|down|off|out|into|open|apart)(?![A-Za-z])/i;
// Ambiguous pasts whose other reading (a stole, to saw) cannot stand bare after be.
const BARE_PAST = wordSet("stole saw");
// No passive: "He was went" more likely meant "went". A has-'s still takes the participle.
const NO_PASSIVE = /^(?:arise|come|become|go|stink|swim)$/;
const MODAL_BEFORE =
  /(?:^|[^A-Za-z'’])(?:(?:could|would|should|might|must)(?:n['’]?t)?|may|will|won['’]?t|shall|can(?:not|['’]?t)?|to)(?:[ \t\u00a0]+not)?[ \t\u00a0]+$/i;
// Clitic owners: 'd and 's need a pronoun subject ("John's saw" is possessive).
const LEADS: Readonly<Record<string, RegExp>> = {
  ve: /^(?:i|you|we|they|who|what|that|there|could|would|should|must|might|may)$/,
  d: /^(?:i|you|we|they|he|she|it|who|that|there)$/,
  s: /^(?:he|she|it|that|there|here|what|who|where|(?:every|some|no|any)(?:thing|one|body))$/,
  re: /^(?:you|we|they)$/,
  m: /^i$/,
};
const ADVERB = `(?:not|never|already|just|ever|really|still|also|even|only|all|both|since|then|now|always|[a-z]+ly)`;
// A chained auxiliary is not the verb, so "has been took" is still scanned from "been".
const TAIL = `(?<adverbs>(?:${SPACE}${ADVERB}){0,2})${SPACE}(?!(?:be|been|being|have|having)${WORD_END})(?<verb>[A-Za-z]+)(?!${EDGE})`;
// have/be in every spelling, clitics on their owner ("I'd", "it's") and dropped apostrophes.
const DECLARATIVE = `(?:(?<lead>[A-Za-z]+)(?<clitic>['’](?:ve|d|s|re|m))|(?<aux>have|has|had|having|be|being|been|am|is|are|was|were|(?:have|has|had|is|are|was|were)n['’]?t|(?:i|you|we|they|could|would|should|must|might)ve|its))${TAIL}`;
// "Have you ate?", "Was it took?": the auxiliary opens the clause, a subject follows.
const INVERTED = `(?<aux>have|has|had|am|is|are|was|were|(?:have|has|had|is|are|was|were)n['’]?t)${SPACE}(?<subject>i|you|we|they|he|she|it|(?:the|this|that|these|those|my|your|his|her|our|their|its)${SPACE}[a-z]+)${TAIL}`;
const OPENS_CLAUSE =
  /(?:[.!?;:,"“(\n]|(?:^|[^A-Za-z])(?:and|but|or|so|why|how|where|when|what|who|which))[ \t\u00a0]*$/i;

type Past = { lemma: string; participle: string; ambiguous: boolean };
// Not "be": "bespoke" is an adjective the lexicon does not mark.
const PREFIXES = ["out", "over", "under", "re", "mis", "fore", "with", "up"];

/**
 * A simple past that differs from its participle and its base. Prefixed pasts the dictionary
 * lists only as bare words ("outgrew", "foresaw") borrow the table row of their stem.
 */
function pastOnly(word: string): Past | null {
  const forms = englishVerbForms(word);
  if (forms)
    return word === forms.past && word !== forms.participle && word !== forms.lemma
      ? { ...forms, ambiguous: forms.ambiguous.includes(word) }
      : null;
  for (const prefix of PREFIXES) {
    const stem = englishVerbForms(word.slice(prefix.length));
    if (!word.startsWith(prefix) || !stem || stem.past !== word.slice(prefix.length)) continue;
    if (stem.past === stem.participle || stem.past === stem.lemma) continue;
    const info = englishWordInfo(word);
    if (!info || info.verbs.length || info.noun || info.adjective) continue;
    return { lemma: prefix + stem.lemma, participle: prefix + stem.participle, ambiguous: false };
  }
  return null;
}

const nextWord = (after: string) =>
  /^[ \t\u00a0]+([A-Za-z]+)(?![A-Za-z'’-])/.exec(after)?.[1].toLowerCase();

/** The next word may continue a noun ("have saw blades", "have rose bushes", "saw teeth"). */
function nounFollows(after: string): boolean {
  const next = nextWord(after);
  if (!next || CLOSED.has(next)) return false;
  const info = englishWordInfo(next);
  // No reading at all is an unlisted word or an irregular plural.
  if (!info || next.endsWith("ing") || !(info.verbs.length || info.adjective || info.adverb))
    return true;
  return (info.noun || info.plural) && !info.adjective;
}

/** A noun read as a modifier, not a verb: plural, determiner-led, or nothing but a noun. */
function nounHead(word: string, before: string | undefined): boolean {
  if (GAP_HEADS.has(word)) return true;
  if (CLOSED.has(word)) return false;
  const info = englishWordInfo(word);
  if (!info || !(info.noun || info.plural)) return false;
  return (
    (info.plural && !info.verbs.some((v) => v.form === "third")) ||
    !info.verbs.length ||
    (before !== undefined && DETERMINERS.has(before))
  );
}

/**
 * The auxiliary closes a clause whose object is a head before it: "Everything we had went into
 * it", "the cat my dad had ran off with". have/be is then a main verb and the past is the next
 * clause's verb.
 */
function objectGap(text: string, start: number): boolean {
  const run = /(?:[A-Za-z]+[ \t\u00a0]+){1,5}$/.exec(text.slice(Math.max(0, start - 64), start));
  if (!run) return false;
  const w = run[0]
    .trim()
    .toLowerCase()
    .split(/[ \t\u00a0]+/);
  let i = w.length - 1;
  if (PRONOUN.test(w[i])) i -= 1;
  else if (i >= 1 && DETERMINERS.has(w[i - 1])) i -= 2;
  else return false;
  if (i >= 0 && /^(?:that|which|whom)$/.test(w[i])) i -= 1;
  return i >= 0 && nounHead(w[i], w[i - 1]);
}

/** Pronoun and be/have agreement; a mismatch is left to the agreement checks. */
function agrees(subject: string, be: string): boolean {
  const s = subject.toLowerCase();
  const first = s === "i";
  const singular = /^(?:he|she|it|this|that)$/.test(s);
  if (be === "m" || be === "am") return first;
  if (be === "s" || be === "is" || be === "has") return singular;
  if (be === "re" || be === "are" || be === "were") return !first && !singular;
  if (be === "was") return first || singular;
  return be !== "have" || !singular; // had, or a modal before be
}

/** The auxiliary's key: have, has, had, having, be, been, being, am, is, …, or a clitic. */
function auxKey(aux: string): string {
  const a = aux.toLowerCase().replace(/n['’]?t$/, "");
  if (a === "its") return "s";
  return a.endsWith("ve") ? "have" : a;
}

/**
 * Past participle after have or be: "has went", "was took", "Having went", "Have you ate?",
 * "it's broke". Any subject; possessive have ("I have saw blades"), adjectives ("I am broke"),
 * noun-clause subjects ("What it was took courage") and object gaps abstain.
 */
function participleAfterAuxiliary(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const inverted of [false, true]) {
    for (const m of frameMatches(ctx, inverted ? INVERTED : DECLARATIVE, "verb")) {
      const finding = participleFinding(ctx, m, inverted);
      if (finding) findings.push(finding);
    }
  }
  return findings;
}

function participleFinding(
  ctx: DetectContext,
  m: RegExpExecArray,
  inverted: boolean,
): RawFinding | null {
  const { lead, clitic, aux, subject: inner, adverbs, verb } = m.groups!;
  const [start, end] = m.indices!.groups!.verb;
  const word = verb.toLowerCase();
  // Title case inside a clause is a name ("I have Drew on the line").
  if (!plainToken(ctx, verb)) return null;
  const past = pastOnly(word);
  if (!past) return null;
  // An -ly word between must be only an adverb ("has recently went", not "has family").
  for (const adverb of adverbs
    .toLowerCase()
    .split(/[ \t\u00a0]+/)
    .slice(1)) {
    if (ADVERBS.has(adverb)) continue;
    const info = englishWordInfo(adverb);
    if (!info?.adverb || info.noun || info.verbs.length) return null;
  }
  const key = auxKey(clitic ? clitic.slice(1) : aux);
  const before = ctx.text.slice(Math.max(0, m.index - 64), m.index);
  // The written subject, when one is known: the clitic's owner, the inverted subject, or a
  // pronoun right before the auxiliary.
  const prev = /([A-Za-z]+)[ \t\u00a0]+$/.exec(before)?.[1].toLowerCase();
  const subject = (lead ?? inner ?? (/^its$/i.test(aux ?? "") ? "its" : prev))?.toLowerCase();
  if (inverted) {
    const opener = ctx.text.slice(Math.max(0, m.index - 32), m.index);
    if (!OPENS_CLAUSE.test(opener) && !(m.index <= 32 && /^[ \t\u00a0]*$/.test(opener)))
      return null;
  }
  if (lead && !LEADS[clitic.slice(1).toLowerCase()].test(lead.toLowerCase())) return null;
  if (subject && /^(?:i|you|we|they|he|she|it|this|that)$/.test(subject) && !agrees(subject, key))
    return null;
  if (!lead && !inverted) {
    // "could has went" belongs to the modal checks; "I am" alone carries "am" ("9 am took").
    if (MODAL_BEFORE.test(before) && !/^(?:have|be)$/.test(aux.toLowerCase())) return null;
    if (key === "am" && prev !== "i") return null;
    if (/^(?:has|have|had|am|is|are|was|were)$/.test(key) && objectGap(ctx.text, m.index))
      return null;
  }
  const after = ctx.scanText.slice(end, end + 48);
  // "its" for "it's" only where no modifier reading fits: "its broke and", not "its bespoke UI".
  const next = nextWord(after);
  if (/^its$/i.test(aux ?? "") && next && !CLOSED.has(next)) return null;
  const info = englishWordInfo(word);
  const adjective = ADJECTIVE_PASTS.has(word) || !!info?.adjective;
  const nounish = past.ambiguous || !!info?.noun;
  if (/^(?:have|has|had|having|d)$/.test(key)) {
    if ((nounish || adjective) && nounFollows(after)) return null;
  } else {
    if (adjective) {
      const thing = word === "broke" && !!subject && NON_PERSON.test(subject);
      if (!PARTICLE.test(after) && !thing) return null;
    } else if (past.ambiguous && !BARE_PAST.has(word)) return null;
    if (nounish && nounFollows(after)) return null;
    if (key !== "s" && NO_PASSIVE.test(past.lemma)) return null;
    // "The question is did he go": an embedded question, not a passive.
    if (word === "did" && key !== "s") return null;
    // "a being", "human being stole the car": the noun, not the auxiliary.
    if (
      key === "being" &&
      (DETERMINERS.has(prev ?? "") ||
        /^[ \t\u00a0]+(?:the|a|an|my|your|his|her|its|our|their|this|that|these|those|me|him|us|them)(?![A-Za-z])/i.test(
          after,
        ))
    )
      return null;
  }
  if (hasUserOrCasedWord(ctx, m[0])) return null;
  const kase = detectWordCase(verb);
  const participle = applyWordCase(past.participle, kase);
  // 'd is had (participle) or would (base): both fit, the writer picks.
  const base = key === "d" ? applyWordCase(past.lemma, kase) : participle;
  const have = /^(?:have|has|had|having|d)$/.test(key);
  return {
    ruleId: "englishPerfectParticiples",
    messageKey:
      base !== participle
        ? "review_msg_had_or_would"
        : have
          ? "review_msg_perfect_participle"
          : "review_msg_be_participle",
    range: { start, end },
    alternatives: base !== participle ? [participle, base] : [participle],
    ...(base !== participle ? { requiresChoice: true } : {}),
    context: { start: Math.max(0, m.index - 96), end: Math.min(ctx.text.length, end + 9) },
  };
}

/** Perfect and passive participles, the "I've looking" and "am/is/are + bare verb" frames. */
export function perfectParticiples(ctx: DetectContext): RawFinding[] {
  return [...participleAfterAuxiliary(ctx), ...progressiveAfterHave(ctx), ...baseAfterBe(ctx)];
}

// -ing forms that are also everyday nouns ("We have training on Monday") need an object pronoun.
export const NOUN_LIKE_ING =
  /^(?:reading|writing|testing|planning|building|training|meeting|painting|drawing|shopping|setting|spending|recording|funding|parking|housing|clothing|seating|heating|lighting|cooking|swimming|dancing|marketing|pricing|timing|booking|warning|opening|ending|beginning|feeling|morning|evening|ceiling|nothing|something|anything|everything|thing|king|ring|spring|string|wedding|pudding|sibling|during)$/;
const OBJECT = "(?:it|them|him|her|us|me|this|that)";
// "Ive" lost its apostrophe; a time adverb also closes the progressive ("I've working today").
// A soft line wrap may split it ("I've\nlooking"); "doing" needs nothing after it.
const WRAP = `(?:${SPACE}|[ \\t\\u00a0]{0,8}\\r?\\n[ \\t\\u00a0]{0,8})`;
const PROGRESSIVE = `(?<subject>I|you|we|they|he|she|it)(?:${WRAP}(?<aux>have|has)|(?<contract>['’]ve)|(?<bare>ve))${WRAP}(?:(?<verb>[A-Za-z]{2,}ing)${SPACE}(?<follow>${OBJECT}|(?:(?:on|into|about|at|for|with|to)${SPACE})?(?:${OBJECT}|the|a|an|my|your|our|his|her|their)|today|now|tonight|lately)|(?<doing>doing)(?=[ \\t\\u00a0]{0,8}(?:[.!?,;:]|$)|${SPACE}(?:and|or|but|right|now|here|there)${WORD_END}))(?!${EDGE})`;

/**
 * "I've looking into it": have in place of be before a progressive. A contracted have becomes
 * the contracted be; a full one is offered both ways ("I am", "I'm"), and the perfect progressive.
 */
function progressiveAfterHave(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const owner = (m: RegExpExecArray) =>
    m.indices!.groups![m.groups!.contract ? "contract" : "subject"][0];
  for (const m of frameMatches(ctx, PROGRESSIVE, owner)) {
    const { subject, aux, contract, bare, doing } = m.groups!;
    const verb = m.groups!.verb ?? doing;
    const follow = m.groups!.follow ?? "";
    const [start] = m.indices!.groups![contract ? "contract" : "subject"];
    const [, end] = m.indices!.groups![contract ? "contract" : aux ? "aux" : "bare"];
    const singular = /^(?:he|she|it)$/i.test(subject);
    if (contract || bare ? singular : (aux.toLowerCase() === "has") !== singular) continue;
    const ing = verb.toLowerCase();
    if (NOUN_LIKE_ING.test(ing) && !new RegExp(`^${OBJECT}$`, "i").test(follow)) continue;
    const before = ctx.scanText.slice(Math.max(0, m.index - 96), m.index);
    // A modal or question word owns have ("Why have you…", "could have…", "what I have
    // going"); nothing is ever had "doing" ("what they've doing").
    if (
      /\b(?:could|would|should|might|must|may|will|to|what|why|how|where|when|which)[ \t\u00a0]+$/i.test(
        before,
      ) &&
      !(doing && /\bwhat[ \t\u00a0]+$/i.test(before))
    )
      continue;
    const phraseEnd = m.index + m[0].length;
    if (hasUserOrCasedWord(ctx, m[0])) continue;
    const typed = contract ?? aux ?? bare;
    const first = /^i$/i.test(subject);
    const mark = contract?.[0] ?? "'";
    const short = `${mark}${first ? "m" : singular ? "s" : "re"}`;
    const kase = detectWordCase(typed);
    const cased = (word: string) => applyWordCase(word, kase);
    let alternatives: string[];
    if (contract) alternatives = [cased(short), cased(`${mark}ve been`)];
    else if (bare) alternatives = [subject + cased(short), subject + cased(`${mark}ve been`)];
    else {
      const gap = ctx.text.slice(m.indices!.groups!.subject[1], m.indices!.groups!.aux[0]);
      const be = first ? "am" : singular ? "is" : "are";
      alternatives = [
        `${subject}${gap}${cased(be)}`,
        `${subject}${cased(short)}`,
        `${subject}${gap}${cased(`${aux.toLowerCase()} been`)}`,
      ];
    }
    const finding: RawFinding = {
      ruleId: "englishPerfectParticiples",
      messageKey: "review_msg_progressive_be",
      range: { start, end },
      alternatives,
      requiresChoice: true,
      context: { start: Math.max(0, m.index - 96), end: Math.min(ctx.text.length, phraseEnd + 9) },
    };
    // A quoted example under discussion ("She has cleaning the kitchen") is not prose.
    if (!quotedMention(ctx, finding)) findings.push(finding);
  }
  return findings;
}

/** The subject opens its clause, so no noun-clause opener owns it ("What it was took…"). */
export function atClauseStart(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 96), index);
  return (
    (index <= 96 && /^[ \t\u00a0]*$/.test(before)) || /[.!?;:\n"“][ \t\u00a0]{0,8}$/.test(before)
  );
}

const BASE = `(?<subject>I|you|we|they|he|she)(?:${SPACE}(?<be>am|is|are)(?<neg>n['’]t)?|(?<contract>['’](?:m|re|s)))(?<adverbs>(?:${SPACE}(?:not|also|just|still|really)){0,2})${SPACE}(?<verb>[A-Za-z]+)(?!${EDGE})`;
// Closed-class words (prepositions, adverbs, determiners, reflexives), plus adjectives and role
// nouns that take an object, a clause or a time phrase ("I am sure the build works", "He is mean
// the whole time", "I am lead on this"). Open classes stay unlisted.
const NOT_A_VERB = new Set(
  (
    "like near past about above across after against along among amid around before behind " +
    "below beneath beside between beyond by despite down during except for from in inside into " +
    "off on onto opposite out outside over per round through throughout to toward towards " +
    "under underneath unlike until up upon via with within without worth atop aboard " +
    "alongside all both each either neither only just still also now here there home back away " +
    "then so too very as at of not more most less again even ever never already once twice half " +
    "double triple often quite rather almost yet soon maybe kinda sorta somewhat otherwise " +
    "together apart ahead aside abroad alike instead the a an this that these those my your his " +
    "her our their its some any no every one what who whom whose which where when why how " +
    "myself yourself himself herself itself sure unsure aware unaware glad afraid sorry proud " +
    "certain uncertain correct busy free ready done able unable due late early open close next " +
    "full short sad mad fine ok okay right wrong alone asleep awake well ill safe new mean " +
    "light lead"
  ).split(" "),
);
// Adjective and noun shapes: -ing, -ed, -s, -ful, -ic, -al, -ible, -able (not enable/disable),
// -tive/-sive/-live, consonant + y (not -ify, apply, supply), polysyllabic -ant/-ent (not -ment).
const ADJECTIVE_SHAPE =
  /(?:ing|ed|s|ful|ic|[^e]al|ible|[tsla]ive)$|(?<!en|dis)able$|(?<![aeo]|if|ppl)y$|[aeiouy][^aeiouy]+(?<!m)[ae]nt$/;
// Words that open a time or degree phrase after an adjective ("busy the whole day", "a lot").
const TIME =
  "(?:whole|entire|next|last|first|second|third|final|same|rest|other|day|days|week|weeks|month|months|year|years|morning|mornings|afternoon|evening|evenings|night|nights|weekend|weekends|time|times|moment|minute|minutes|hour|hours|while|way|lot|bit|little|few)";
// An object pronoun, or a determiner opening a noun phrase that is not a time phrase.
// Demonstratives stay out: "She is captain this season".
const OBJECT_AFTER = new RegExp(
  `^${SPACE}(?:(?:me|him|us|them)${WORD_END}|(?:the|a|an|my|your|his|our|their)${SPACE}(?!${TIME}${WORD_END})[A-Za-z])`,
  "i",
);
// Any next word unless it makes a compound ("sleep deprived", "fly fishing", "swing voters").
const WORD_AFTER = new RegExp(
  `^${SPACE}(?:(?:this|his|us|its)${WORD_END}|(?![A-Za-z]*(?:ed|ing|s)${WORD_END})[A-Za-z])`,
  "i",
);

/**
 * "I am go to the store": be before a bare verb; offers the progressive and the simple present.
 * The word must be a verb by spelling: an irregular base whose past and participle both differ
 * from it, or a regular base right before an object. Anything else may be an adjective or noun.
 */
function baseAfterBe(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, BASE, (match) => match.index)) {
    const { subject, be, neg, contract, adverbs, verb } = m.groups!;
    const [verbStart, end] = m.indices!.groups!.verb;
    if (!atClauseStart(ctx.text, m.index)) continue;
    if (!agrees(subject, (contract ? contract.slice(1) : be).toLowerCase())) continue;
    const lemma = verb.toLowerCase();
    if (!plainToken(ctx, verb) || NOT_A_VERB.has(lemma)) continue;
    const after = ctx.scanText.slice(end, end + 32);
    const forms = englishVerbForms(lemma);
    if (forms) {
      if (lemma !== forms.lemma || forms.past === lemma || forms.participle === lemma) continue;
      if (forms.ambiguous.includes(lemma) || !WORD_AFTER.test(after)) continue;
      if (lemma === "go" && /^[ \t\u00a0]+for\b/i.test(after)) continue; // "We are go for launch."
    } else if (
      ADJECTIVE_SHAPE.test(lemma) ||
      !englishInflect(lemma, "past") ||
      !OBJECT_AFTER.test(after)
    )
      continue;
    const singular = /^(?:he|she)$/i.test(subject);
    const negated = !!neg || /\bnot\b/i.test(adverbs);
    const ing = englishInflect(lemma, "ing");
    const finite = negated || !singular ? lemma : englishInflect(lemma, "third");
    if (!ing || !finite) continue;
    if (hasUserOrCasedWord(ctx, ctx.scanText.slice(m.index, end))) continue;
    const kase = detectWordCase(verb);
    const support = applyWordCase(singular ? "does" : "do", kase);
    const gap = ctx.source.slice(m.indices!.groups!.adverbs[1], verbStart);
    // Negation needs do-support: "I am not go" → "I do not go", "He isn't write" → "He doesn't write".
    const present = neg
      ? `${subject} ${support}${neg}${adverbs}`
      : `${subject}${adverbs.replace(/(?<![A-Za-z])not(?![A-Za-z])/i, (not) => `${support} ${not}`)}`;
    findings.push({
      ruleId: "englishPerfectParticiples",
      messageKey: "review_msg_be_base",
      range: { start: m.index, end },
      alternatives: [
        `${ctx.source.slice(m.index, verbStart)}${applyWordCase(ing, kase)}`,
        `${present}${gap}${applyWordCase(finite, kase)}`,
      ],
      requiresChoice: true,
      context: { start: Math.max(0, m.index - 96), end: Math.min(ctx.text.length, end + 32) },
    });
  }
  return findings;
}
