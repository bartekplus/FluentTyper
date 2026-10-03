import { englishWordInfo } from "../implementations/helpers/EnglishLexicon";
import { ENGLISH_VERB_FORMS, englishVerbForms } from "../implementations/helpers/EnglishVerbForms";
import { applyWordCase, detectWordCase } from "../implementations/helpers/GenericRuleShared";
import { pluralNoun } from "./englishSentenceStructure";
import { frame, frameMatches, hasUserOrCasedWord, SPACE, WORD_END } from "./phraseTemplates";
import type { DetectContext, RawFinding } from "./reviewDetectors";

// Irregular simple-past forms with one owner ("lay" is lay's lemma and lie's past).
const PASTS = ENGLISH_VERB_FORMS.filter((entry) => englishVerbForms(entry.past) === entry).map(
  (entry) => entry.past,
);
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
const CONJUNCT = `(?:${PRONOUN}|(?:my|your|his|her|our|their|the|an?)${SPACE}(?:${WORD}${SPACE})?${WORD}|${WORD})`;
const ADVERB = "(?:both|all|also|always|never|just|still|often|already|then|actually|finally)";
// Also after an opening comma or a subordinator: "However, Tim and me work", "that me and Sam are".
// Cheap first: an "and" within the next three words, so the clause lookbehind runs only there.
const AND_AHEAD = `(?=[A-Za-z]+(?:[ \\t\\u00a0]{1,8}[A-Za-z]+){0,2}[ \\t\\u00a0]{1,8}and(?![\\p{L}]))`;
// A verb that takes a clause without "that": "She thinks Ana and me are…".
const COORDINATION_START = `(?:${CLAUSE_START}|(?<=(?:,|\\b(?:that|when|because|if|since|while|whenever|until|think|thinks|thought|believe|believes|believed|hope|hopes|guess|suppose))${SPACE}))`;
const COORDINATION = frame(
  `${AND_AHEAD}${COORDINATION_START}(?<a>${CONJUNCT}|myself)${SPACE}and${SPACE}(?<b>${CONJUNCT}|myself)(?:${SPACE}${ADVERB})?${SPACE}(?<verb>${FINITE})${WORD_END}`,
);
// A present base verb after a pair of single words: "Tim and me work", "Me and Sam live".
const ONE_WORD = `(?:${PRONOUN}|myself|(?:my|your|his|her|our|their|the)${SPACE}${WORD}|${WORD})`;
const COORDINATION_BASE = frame(
  `${AND_AHEAD}${COORDINATION_START}(?<a>${ONE_WORD})${SPACE}and${SPACE}(?<b>${ONE_WORD})(?:${SPACE}${ADVERB})?${SPACE}(?<verb>[a-z]+)${WORD_END}`,
);
const FINITE_VERB = new RegExp(`^${FINITE}$`, "i");
// "Both Ana and me helped", "Either Ana or me will call", "Ana or myself can help".
const CORRELATIVE = frame(
  `(?=(?:both|either|neither|[a-z]+)[ \\t\\u00a0])${COORDINATION_START}(?:(?<lead>both|either|neither)${SPACE})?(?<a>${CONJUNCT})${SPACE}(?<conj>and|or|nor)${SPACE}(?<b>me|myself|him|them)(?:${SPACE}${ADVERB})?${SPACE}(?<verb>${FINITE})${WORD_END}`,
);

/** A correlative pair or an or-pair whose second pronoun is in object form. */
function correlativeSubjects(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, CORRELATIVE, "b")) {
    const { lead, a, conj, b, verb } = m.groups!;
    // A plain and-pair belongs to coordinatedSubjects; "both" needs and, either/neither or/nor.
    if (conj.toLowerCase() === "and" ? lead?.toLowerCase() !== "both" : /^both$/i.test(lead ?? ""))
      continue;
    // "or me is" agrees with the nearest subject: "I am" would change the verb too.
    if (conj.toLowerCase() !== "and" && /^(?:is|was|has|does)/i.test(verb)) continue;
    if (
      /^myself$/i.test(b) &&
      /\bI\b[^.!?;:\n]*$/.test(ctx.text.slice(Math.max(0, m.index - 160), m.index))
    )
      continue;
    if (/^(?:me|myself)$/i.test(a) || hasUserOrCasedWord(ctx, m[0])) continue;
    const [start, end] = m.indices!.groups!.b;
    findings.push({
      ruleId: "englishPronounCase",
      messageKey: "review_msg_pronoun_subject_case",
      range: { start, end },
      alternatives: [isFirstPerson(b) ? "I" : applyWordCase(subjectForm(b), detectWordCase(b))],
      context: { start: Math.max(0, m.index - 32), end: Math.min(ctx.text.length, end + 16) },
    });
  }
  return findings;
}

const SUBJECT_FORM: Readonly<Record<string, string>> = {
  me: "I",
  i: "I",
  him: "he",
  her: "she",
  them: "they",
  myself: "I",
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
const isFirstPerson = (word: string) => /^(?:me|i|myself)$/i.test(word);

/** "Me and Sam went", "My wife and me are": object pronouns in a clause-initial coordinated subject. */
function coordinatedSubjects(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const matches = [
    ...frameMatches(ctx, COORDINATION, (match) => match.index),
    ...frameMatches(ctx, COORDINATION_BASE, (match) => match.index),
  ];
  for (const m of matches) {
    const { a, b, verb } = m.groups!;
    if (![a, b].some((word) => /^(?:me|him|her|them|myself)$/i.test(word))) continue;
    if (findings.some((f) => f.range.start === m.indices!.groups!.a[0])) continue;
    // "I suggested that the engineer and myself take…": a reflexive after "I" stays.
    if (
      [a, b].some((word) => /^myself$/i.test(word)) &&
      /\bI\b[^.!?;:\n]*$/.test(ctx.text.slice(Math.max(0, m.index - 160), m.index))
    )
      continue;
    // A present base verb only after "me"/"myself" ("Tim and me work"); "her" may own a noun.
    if (
      !FINITE_VERB.test(verb) &&
      !(
        [a, b].some((word) => /^(?:me|myself)$/i.test(word)) &&
        verb === verb.toLowerCase() &&
        englishWordInfo(verb)?.verbs.some((v) => v.form === "base" && v.lemma === verb)
      )
    )
      continue;
    // After a comma, only a short opener ("However,", "On the other hand,") may stand before
    // the pair; "We saw Ana, Tim and me…" continues a list of objects.
    const lead = /(?:^|[.!?;:\n"“(])([^.!?;:\n"“(]*),[ \t\u00a0]*$/.exec(
      ctx.text.slice(Math.max(0, m.index - 64), m.index),
    );
    if (
      lead &&
      (lead[1].trim().split(/\s+/).length > 4 ||
        lead[1]
          .toLowerCase()
          .match(/[a-z]+/g)
          ?.some(
            (w) =>
              FINITE_VERB.test(w) ||
              englishWordInfo(w)?.verbs.some((v) => v.form === "past" || v.form === "third"),
          ))
    )
      continue;
    if (isFirstPerson(a) && isFirstPerson(b)) continue;
    // "Her and my parents met" shares one noun between two possessives.
    if (/^her$/i.test(a) && /^(?:my|your|his|her|our|their|the)[ \t\u00a0]/i.test(b)) continue;
    const start = m.index;
    const end = start + m[0].length;
    if (hasUserOrCasedWord(ctx, m[0])) continue;
    const [aStart, aEnd] = m.indices!.groups!.a;
    const [bStart, bEnd] = m.indices!.groups!.b;
    const [verbStart, verbEnd] = m.indices!.groups!.verb;
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
      context: { start: Math.max(0, start - 32), end: Math.min(ctx.text.length, end + 16) },
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
    const [start, end] = m.indices!.groups!.whom;
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
const preposed = (words: string) => `${words}${SPACE}`;
const CLOSES = `(?=[ \\t\\u00a0]{0,8}(?:[.!?,;:)]|$))`;
// "to he and his team", "to we developers", "with Sam and I.", "Us developers are tired".
const PRONOUN_OBJECT = frame(
  `${preposed(OBJECT_PREPOSITION)}(?<pronoun>he|she|they|we)${SPACE}(?:and|or)${WORD_END}(?!${SPACE}I${WORD_END})`,
);
const WE_OBJECT = frame(
  `${preposed(OBJECT_PREPOSITION)}(?<pronoun>we)${SPACE}(?<noun>[a-z]+)${WORD_END}`,
);
// After a preposition the pair also ends before a relative or a closed word: "of Tom and I
// when we were young", "between Ann and I which".
const PAIR_ENDS = `(?:${CLOSES}|(?=${SPACE}(?:and|which|who|whom|when|if|that|about|before|after|into|with|on|at|in|to|from|by|for)${WORD_END}))`;
const AND_I_OBJECT = frame(
  `${preposed(`(?:${OBJECT_PREPOSITION}|for|between)`)}(?<a>${CONJUNCT})${SPACE}and${SPACE}(?<i>I)${WORD_END}${PAIR_ENDS}`,
);
const AND_MYSELF_OBJECT = frame(
  `${preposed(`(?:${OBJECT_PREPOSITION}|for|between)`)}(?<a>${CONJUNCT})${SPACE}(?:and|or)${SPACE}(?<i>myself)${WORD_END}${CLOSES}`,
);
// "told Mary and I that…", "to Tom and I before you go", "Please include Tony and I.": an
// object pair before a closed word or the clause end.
const AND_I_BEFORE = frame(
  `(?=[a-z]+(?:[ \\t\\u00a0]{1,8}[a-z]+){1,3}[ \\t\\u00a0]{1,8}(?:and|or)[ \\t\\u00a0]{1,8}I(?![\\p{L}]))(?<lead>[a-z]+)${SPACE}(?<a>${CONJUNCT})${SPACE}(?:and|or)${SPACE}(?<i>I)${WORD_END}(?:(?=${SPACE}(?<next>[a-z]+)${WORD_END})|${CLOSES})`,
);
// Words after which "X and I" cannot be a subject: they need no verb from the pair.
const OBJECT_NEXT =
  /^(?:that|about|before|after|into|with|without|tonight|today|tomorrow|yesterday|here|there|but|for|on|at|in|to|from|by|over|again|together|if|when|which|who|whom)$/;
const US_SUBJECT = frame(
  `(?=us(?![\\p{L}]))${CLAUSE_START}(?<pronoun>us)${SPACE}(?<noun>[a-z]+)(?:${SPACE}${ADVERB})?${SPACE}${FINITE}${WORD_END}`,
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
      push(m, m.indices!.groups!.pronoun, object(pronoun));
    }
  for (const m of frameMatches(ctx, AND_I_OBJECT, "a")) {
    const { a } = m.groups!;
    const [start, aEnd] = m.indices!.groups!.a;
    const [iStart, end] = m.indices!.groups!.i;
    // "between you and I" is left to its fixed phrase; "me and I" has no fix.
    if (/^(?:I|me)$/i.test(a) || (/^you$/i.test(a) && /^between/i.test(m[0]))) continue;
    const first = Object.hasOwn(OBJECT_FORM, a.toLowerCase()) ? object(a) : a;
    push(m, [start, end], `${first}${ctx.source.slice(aEnd, iStart)}me`);
  }
  // "Talk to Don or myself.": with no "I" before it in the sentence, myself is me.
  for (const m of frameMatches(ctx, AND_MYSELF_OBJECT, "a")) {
    const { a } = m.groups!;
    const [start, aEnd] = m.indices!.groups!.a;
    const [iStart, end] = m.indices!.groups!.i;
    if (/^(?:I|me|myself)$/i.test(a)) continue;
    const sentence = ctx.text
      .slice(Math.max(0, m.index - 200), m.index)
      .split(/[.!?\n]/)
      .pop()!;
    if (/(?:^|[^\p{L}'’])I(?:[^\p{L}'’]|['’](?:m|ve|ll|d))/u.test(sentence)) continue;
    const first = Object.hasOwn(OBJECT_FORM, a.toLowerCase()) ? object(a) : a;
    push(m, [start, end], `${first}${ctx.source.slice(aEnd, iStart)}me`);
  }
  for (const m of frameMatches(ctx, AND_I_BEFORE, "a")) {
    const { lead, a, next } = m.groups!;
    if (/^(?:I|me)$/i.test(a) || lead === "between" || (next && !OBJECT_NEXT.test(next))) continue;
    // The lead takes the pair as its object: a preposition or a verb that is no auxiliary.
    const read = englishWordInfo(lead);
    const governs =
      new RegExp(`^${OBJECT_PREPOSITION}$`).test(lead) ||
      lead === "for" ||
      (!new RegExp(`^${AUX}$`).test(lead) &&
        !/^(?:and|or|but|that|if|when|because|so|think|thought|know|knew|said|says|hope|guess)$/.test(
          lead,
        ) &&
        // "Then came Tom and I.": an intransitive verb before an inverted subject.
        !/^(?:came|come|comes|went|go|goes|stood|sat|lay|ran|run|arrived|remain|remained)$/.test(
          lead,
        ) &&
        !!read?.verbs.some((v) => v.form === "past" || v.form === "base" || v.form === "third"));
    if (!governs) continue;
    const [start, aEnd] = m.indices!.groups!.a;
    const [iStart, end] = m.indices!.groups!.i;
    if (findings.some((f) => f.range.start === start)) continue;
    const first = Object.hasOwn(OBJECT_FORM, a.toLowerCase()) ? object(a) : a;
    push(m, [start, end], `${first}${ctx.source.slice(aEnd, iStart)}me`);
  }
  for (const m of frameMatches(ctx, US_SUBJECT, "pronoun")) {
    const { pronoun, noun } = m.groups!;
    // "US companies" names the country.
    if (pronoun === "US" || !pluralNoun(noun)) continue;
    push(m, m.indices!.groups!.pronoun, applyWordCase("we", detectWordCase(pronoun)), true);
  }
  return findings;
}

const MYSELF_OBJECT = frame(`(?<a>${CONJUNCT})${SPACE}and${SPACE}(?<target>myself)${WORD_END}`);

/** "The coach asked Ana and myself": an object pair takes "me" when no "I" governs it. */
function myselfObjects(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, MYSELF_OBJECT)) {
    const sentence = /[^.!?;:\n]*$/.exec(ctx.text.slice(Math.max(0, m.index - 160), m.index))![0];
    // "I asked Ana and myself" is reflexive; a subject pair belongs to coordinatedSubjects.
    if (/\b(?:I|me|my|mine)\b/i.test(sentence)) continue;
    const head = /([A-Za-z]+)[ \t\u00a0]+$/.exec(sentence)?.[1] ?? "";
    const read = englishWordInfo(head);
    const governs =
      head === head.toLowerCase() &&
      (new RegExp(`^(?:${OBJECT_PREPOSITION}|for|between)$`).test(head) ||
        !!read?.verbs.some((v) => v.form === "past" || v.form === "third"));
    if (!governs || hasUserOrCasedWord(ctx, m.groups!.target)) continue;
    const end = m.index + m[0].length;
    const next = /^[ \t\u00a0]+([a-z]+)/.exec(ctx.text.slice(end, end + 24))?.[1] ?? "";
    // "…and myself went": a verb after the pair makes it a subject.
    if (FINITE_VERB.test(next) || englishWordInfo(next)?.verbs.some((v) => v.form === "base"))
      continue;
    const [start, targetEnd] = m.indices!.groups!.target;
    findings.push({
      ruleId: "englishPronounCase",
      messageKey: "review_msg_pronoun_object_case",
      range: { start, end: targetEnd },
      alternatives: [applyWordCase("me", detectWordCase(m.groups!.target))],
      context: { start: Math.max(0, m.index - 48), end: Math.min(ctx.text.length, end + 16) },
    });
  }
  return findings;
}

/** Pronoun case for subjects and prepositional objects; closed lists plus lexicon evidence. */
export function pronounCase(ctx: DetectContext): RawFinding[] {
  return [
    ...coordinatedSubjects(ctx),
    ...correlativeSubjects(ctx),
    ...whomSubjects(ctx),
    ...pronounObjects(ctx),
    ...myselfObjects(ctx),
  ];
}
