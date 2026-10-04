import { englishWordInfo } from "../implementations/helpers/EnglishLexicon";
import { englishVerbForms } from "../implementations/helpers/EnglishVerbForms";
import { applyWordCase, detectWordCase } from "../implementations/helpers/GenericRuleShared";
import { PASTS, pluralNoun, tightAround } from "./englishSentenceStructure";
import {
  COMPLETE_OR_PAREN,
  frame,
  frameMatches,
  group,
  hasUserOrCasedWord,
  SPACE,
  WORD_END,
} from "./phraseTemplates";
import type { DetectContext, RawFinding } from "./reviewDetectors";

const NEGATIVE = "n['’]t";
const AUX = `(?:am|is|are|was|were|has|have|had|do|does|did|will|would|can|could|shall|should|may|might|must)`;
/** Finite verb evidence that the words before it are a subject. */
const FINITE = `(?:${AUX}(?:${NEGATIVE})?|won['’]t|cannot|${PASTS.join("|")}|[a-z]{2,}ed)`;

// Clause start, optionally after a short time or linking opener ("Yesterday me and Sam went").
const OPENER = `(?:yesterday|today|tonight|then|later|so|but|and|now|last${SPACE}(?:night|week|month|year|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday))`;
const CLAUSE_START = `(?<=(?:^|[.!?;:\\n"“(])[ \\t\\u00a0]{0,8}(?:${OPENER},?${SPACE})?)`;

const FUNCTION_WORD = `(?:and|or|but|so|then|also|not|only|just|even|both|all|too|to|of|in|on|at|for|with|from|by|the|a|an|this|that|these|those|it|its|us|there|here|now|me|him|her|them|i|you|he|she|we|they|my|your|his|our|their|myself|${AUX})${WORD_END}`;
const WORD = `(?!${FUNCTION_WORD})[a-z]+`;
const PRONOUN = "(?:me|him|her|them|I|you|he|she|they|we)";
// A pronoun, a determiner phrase of one or two words, or one content word (a name).
const CONJUNCT = `(?:${PRONOUN}|(?:my|your|his|her|our|their|the)${SPACE}(?:${WORD}${SPACE})?${WORD}|${WORD})`;
const ADVERB = "(?:both|all|also|always|never|just|still|often|already|then|actually|finally)";
const COORDINATION = frame(
  `${CLAUSE_START}(?<a>${CONJUNCT})${SPACE}and${SPACE}(?<b>${CONJUNCT})(?:${SPACE}${ADVERB})?${SPACE}(?<verb>${FINITE})${WORD_END}`,
);

const SUBJECT_FORM: Readonly<Record<string, string>> = {
  me: "I",
  i: "I",
  him: "he",
  her: "she",
  them: "they",
};
// A coordinated subject is plural.
const PLURAL_VERB: Readonly<Record<string, string>> = {
  am: "are",
  is: "are",
  was: "were",
  has: "have",
  does: "do",
};

const subjectForm = (word: string) => SUBJECT_FORM[word.toLowerCase()] ?? word;
const isFirstPerson = (word: string) => /^(?:me|i)$/i.test(word);

/** "Me and Sam went", "My wife and me are": object pronouns in a clause-initial coordinated subject. */
function coordinatedSubjects(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, COORDINATION, (match) => match.index)) {
    const { a, b, verb } = m.groups!;
    if (![a, b].some((word) => /^(?:me|him|her|them)$/i.test(word))) continue;
    if (isFirstPerson(a) && isFirstPerson(b)) continue;
    // "Her and my parents met" shares one noun between two possessives.
    if (/^her$/i.test(a) && /^(?:my|your|his|her|our|their|the)[ \t\u00a0]/i.test(b)) continue;
    if (hasUserOrCasedWord(ctx, m[0])) continue;
    const [aStart, aEnd] = group(m, "a");
    const [bStart, bEnd] = group(m, "b");
    const [verbStart, verbEnd] = group(m, "verb");
    const joint = ctx.source.slice(aEnd, bStart); // " and "
    let phrase =
      isFirstPerson(a) || isFirstPerson(b)
        ? `${subjectForm(isFirstPerson(a) ? b : a)}${joint}I`
        : `${subjectForm(a)}${joint}${subjectForm(b)}`;
    if (/^[A-Z]/.test(a)) phrase = phrase[0].toUpperCase() + phrase.slice(1);
    const verbKey = verb.toLowerCase().replace(/n['’]t$/, "");
    let rangeEnd = bEnd;
    if (Object.hasOwn(PLURAL_VERB, verbKey)) {
      const negative = verb.slice(verbKey.length);
      phrase += `${ctx.source.slice(bEnd, verbStart)}${applyWordCase(PLURAL_VERB[verbKey], detectWordCase(verb))}${negative}`;
      rangeEnd = verbEnd;
    }
    const typed = ctx.source.slice(aStart, rangeEnd);
    if (typed === typed.toUpperCase()) phrase = phrase.toUpperCase();
    if (phrase === typed) continue;
    findings.push({
      ruleId: "englishPronounCase",
      messageKey: "review_msg_pronoun_subject_case",
      range: { start: aStart, end: rangeEnd },
      alternatives: [phrase],
      context: tightAround(ctx, m),
    });
  }
  return findings;
}

const PREPOSITION_BEFORE =
  /\b(?<prep>to|with|for|from|by|of|about|on|upon|in|into|at|among|between|against|without|under|over|through|toward|towards|behind|beside|before|after|like|than|around|near|beyond|via|unto|onto|within|regarding|concerning)[ \t\u00a0]+$/i;
// Adverbs that can sit between an auxiliary and its verb ("Whom can of course build…").
const INSERT = `(?:not|of${SPACE}course|also|still|really|just|never|always|already|probably|certainly|definitely|actually|truly|then|now|ever|only)`;
const WHOM = frame(
  `(?<whom>whom(?:ever|soever)?)${SPACE}(?:(?<aux>${AUX})(?:${SPACE}${INSERT})?${SPACE}["“']?(?<evidence>[a-z]+)|(?<verb>[a-z]+))${WORD_END}`,
);
// "the topic of whom is…" is a free relative; "many/the rest/the eldest of whom were…" is not.
const OF_NOUN = new RegExp(
  `(?:^|[^,;:(\\u2013\\u2014\\s])[ \\t\\u00a0]*(?:the|a|an)${SPACE}(?<noun>[a-z]+)${SPACE}of[ \\t\\u00a0]+$`,
  "iu",
);
const PARTITIVE =
  /^(?:rest|majority|minority|remainder|bulk|most|half|number|total|whole|balance|sum|lot|couple|pair|group|handful|dozen|hundred|thousand|million|percent|portion|part|share|first|last|second|third|quarter|fraction|set|series|range|none|each|any|one|two|three|four|five|six|seven|eight|nine|ten)$/i;
const verbsOf = (word: string) => englishWordInfo(word)?.verbs ?? [];

/** Verb evidence after an auxiliary: "is coming", "was chosen", "will come". */
function verbAfterAuxiliary(aux: string, word: string): boolean {
  if (word !== word.toLowerCase()) return false;
  if (/^(?:be|been|being)$/.test(word)) return true;
  const readings = verbsOf(word);
  if (word.endsWith("ing")) return readings.some((verb) => verb.form === "ing");
  if (/^[a-z]{2,}ed$/.test(word) && !englishWordInfo(word)) return true;
  const base = readings.some((verb) => verb.form === "base");
  if (!base && readings.some((verb) => verb.form === "participle"))
    return !englishVerbForms(word)?.ambiguous.includes(word);
  // A base verb follows only a modal: "Whom will come?", not "Whom does help?".
  return base && /^(?:will|would|can|could|shall|should|may|might|must)$/i.test(aux);
}

/** A finite lexical verb right after whom: "Whom told you?", "whomever wants it". */
function finiteVerb(word: string, ever: boolean, next: string): boolean {
  if (word !== word.toLowerCase()) return false;
  const readings = verbsOf(word);
  const forms = englishVerbForms(word);
  const past =
    (readings.some((verb) => verb.form === "past") &&
      !readings.some((verb) => verb.form === "base") &&
      !forms?.ambiguous.includes(word)) ||
    (/^[a-z]{2,}ed$/.test(word) && !englishWordInfo(word));
  if (past || !ever) return past;
  // "whomever parents choose": an -s noun before a base verb is the subject, not the verb.
  const nextInfo = englishWordInfo(next);
  return (
    readings.some((verb) => verb.form === "third") &&
    !(nextInfo?.verbs.some((verb) => verb.form === "base") && !nextInfo.noun)
  );
}

/** "Whom is coming?", "to whomever wrote it": whom before its own finite verb is the subject. */
function whomSubjects(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, WHOM, "whom")) {
    const { whom, aux } = m.groups!;
    // Title case names someone ("Whom was Ted…"); all-caps text keeps its evidence.
    const caps = m[0] === m[0].toUpperCase();
    const evidence = caps ? m.groups!.evidence?.toLowerCase() : m.groups!.evidence;
    const verb = caps ? m.groups!.verb?.toLowerCase() : m.groups!.verb;
    const [start, end] = group(m, "whom");
    const matchEnd = m.index + m[0].length;
    // whoever/whosoever take their case from their own clause, never from a preposition.
    const ever = whom.length > 4;
    const before = ctx.text.slice(Math.max(0, start - 48), start);
    const prep = ever ? undefined : PREPOSITION_BEFORE.exec(before)?.groups!.prep.toLowerCase();
    if (aux) {
      if (ever) {
        if (/^(?:I|you|he|she|we|they|it|there)$/i.test(evidence)) continue;
      } else if (/^(?:do|does|did)$/i.test(aux) || !verbAfterAuxiliary(aux, evidence)) continue;
      if (prep === "of") {
        const noun = OF_NOUN.exec(before)?.groups!.noun;
        const info = noun ? englishWordInfo(noun) : null;
        if (!noun || PARTITIVE.test(noun) || (info && (!info.noun || info.adjective))) continue;
      } else if (prep) {
        // Only active perfects and modals ("to whom has opened"), not "to whom was given…".
        const active =
          (/^(?:has|have|had)$/i.test(aux) && evidence !== "been") ||
          (/^(?:will|would|can|could|shall|should|may|might|must)$/i.test(aux) &&
            evidence !== "be");
        if (!active) continue;
      }
    } else {
      const next = /^[ \t\u00a0]+([A-Za-z]+)/.exec(ctx.text.slice(matchEnd))?.[1] ?? "";
      if (prep || !finiteVerb(verb, ever, next.toLowerCase())) continue;
    }
    if (hasUserOrCasedWord(ctx, m[0])) continue;
    findings.push({
      ruleId: "englishPronounCase",
      messageKey: "review_msg_who_subject",
      range: { start, end },
      alternatives: [
        applyWordCase(whom.toLowerCase().replace("whom", "who"), detectWordCase(whom)),
      ],
      context: { start: Math.max(0, start - 32), end: Math.min(ctx.text.length, matchEnd + 9) },
    });
  }
  return findings;
}

const OBJECT_FORM: Readonly<Record<string, string>> = {
  i: "me",
  he: "him",
  she: "her",
  we: "us",
  they: "them",
};
// Prepositions that never open a clause ("for they are…", "like we do") or an inverted one
// ("In they went").
const OBJECT_PREPOSITION =
  "(?:to|with|from|by|of|about|among|against|without|toward|towards|at|upon|via|regarding|concerning|beside|near)";
// "to he and his team", "to we developers", "with Sam and I.", "Us developers are tired".
const PRONOUN_OBJECT = frame(
  `${OBJECT_PREPOSITION}${SPACE}(?<pronoun>he|she|they|we)${SPACE}(?:and|or)${WORD_END}(?!${SPACE}I${WORD_END})`,
);
const WE_OBJECT = frame(
  `${OBJECT_PREPOSITION}${SPACE}(?<pronoun>we)${SPACE}(?<noun>[a-z]+)${WORD_END}`,
);
const AND_I_OBJECT = frame(
  `(?:${OBJECT_PREPOSITION}|for)${SPACE}(?<a>${CONJUNCT})${SPACE}and${SPACE}(?<i>I)${COMPLETE_OR_PAREN}`,
);
const US_SUBJECT = frame(
  `${CLAUSE_START}(?<pronoun>us)${SPACE}(?<noun>[a-z]+)(?:${SPACE}${ADVERB})?${SPACE}${FINITE}${WORD_END}`,
);

/** Subject pronouns after a preposition take the object form; "us" before a subject noun, "we". */
function pronounObjects(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const push = (m: RegExpExecArray, range: [number, number], fix: string, subject = false) => {
    if (hasUserOrCasedWord(ctx, m[0])) return;
    findings.push({
      ruleId: "englishPronounCase",
      messageKey: subject ? "review_msg_pronoun_subject_case" : "review_msg_pronoun_object_case",
      range: { start: range[0], end: range[1] },
      alternatives: [fix],
      context: {
        start: Math.max(0, range[0] - 32),
        end: Math.min(ctx.text.length, m.index + m[0].length + 16),
      },
    });
  };
  const object = (word: string) =>
    applyWordCase(OBJECT_FORM[word.toLowerCase()] ?? word, detectWordCase(word));
  for (const pattern of [PRONOUN_OBJECT, WE_OBJECT])
    for (const m of frameMatches(ctx, pattern, "pronoun")) {
      const { pronoun, noun } = m.groups!;
      if (noun !== undefined && !pluralNoun(noun)) continue;
      push(m, group(m, "pronoun"), object(pronoun));
    }
  for (const m of frameMatches(ctx, AND_I_OBJECT, "a")) {
    const { a } = m.groups!;
    const [start, aEnd] = group(m, "a");
    const [iStart, end] = group(m, "i");
    // "between" is left to the fixed "between you and me" phrase; "me and I" has no fix.
    if (/^(?:I|me)$/i.test(a)) continue;
    const first = Object.hasOwn(OBJECT_FORM, a.toLowerCase()) ? object(a) : a;
    const me = m[0] === m[0].toUpperCase() ? "ME" : "me";
    push(m, [start, end], `${first}${ctx.source.slice(aEnd, iStart)}${me}`);
  }
  for (const m of frameMatches(ctx, US_SUBJECT, "pronoun")) {
    const { pronoun, noun } = m.groups!;
    // "US companies" names the country.
    if (pronoun === "US" || !pluralNoun(noun)) continue;
    push(m, group(m, "pronoun"), applyWordCase("we", detectWordCase(pronoun)), true);
  }
  return findings;
}

/** Pronoun case for subjects and prepositional objects; closed lists plus lexicon evidence. */
export function pronounCase(ctx: DetectContext): RawFinding[] {
  return [...coordinatedSubjects(ctx), ...whomSubjects(ctx), ...pronounObjects(ctx)];
}
