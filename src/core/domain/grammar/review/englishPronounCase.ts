import { englishWordInfo } from "../implementations/helpers/EnglishLexicon";
import { englishVerbForms } from "../implementations/helpers/EnglishVerbForms";
import { applyWordCase, detectWordCase } from "../implementations/helpers/GenericRuleShared";
import { PASTS, pluralNoun, tightAround } from "./englishSentenceStructure";
import { group, hasUserOrCasedWord, SPACE } from "./phraseTemplates";
import type { DetectContext, RawFinding } from "./reviewDetectors";
import type { FindingsFilter, MatchFixer } from "../engine/reviewRules";
import { finding } from "./finding";

const NEGATIVE = "n['’]t";
const AUX = `(?:am|is|are|was|were|has|have|had|do|does|did|will|would|can|could|shall|should|may|might|must)`;
/** Finite verb evidence that the words before it are a subject. */
const FINITE = `(?:${AUX}(?:${NEGATIVE})?|won['’]t|cannot|${PASTS.join("|")}|[a-z]{2,}ed)`;

const FINITE_VERB = new RegExp(`^${FINITE}$`, "i");

/** A correlative pair or an or-pair whose second pronoun is in object form. */
const correlativeSubjects: MatchFixer = (m, ctx) => {
  const findings: RawFinding[] = [];
  const { lead, a, conj, b, verb } = m.groups!;
  // A plain and-pair belongs to coordinatedSubjects; "both" needs and, either/neither or/nor.
  if (conj.toLowerCase() === "and" ? lead?.toLowerCase() !== "both" : /^both$/i.test(lead ?? ""))
    return findings;
  // "or me is" agrees with the nearest subject: "I am" would change the verb too.
  if (conj.toLowerCase() !== "and" && /^(?:is|was|has|does)/i.test(verb)) return findings;
  if (
    /^myself$/i.test(b) &&
    /\bI\b[^.!?;:\n]*$/.test(ctx.text.slice(Math.max(0, m.index - 160), m.index))
  )
    return findings;
  if (/^(?:me|myself)$/i.test(a) || hasUserOrCasedWord(ctx, m[0])) return findings;
  const [start, end] = m.indices!.groups!.b;
  findings.push({
    ruleId: "englishPronounCase",
    messageKey: "review_msg_pronoun_subject_case",
    range: { start, end },
    alternatives: [isFirstPerson(b) ? "I" : applyWordCase(subjectForm(b), detectWordCase(b))],
    context: { start: Math.max(0, m.index - 32), end: Math.min(ctx.text.length, end + 16) },
  });
  return findings;
};

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
const coordinatedSubjects: MatchFixer = (m, ctx) => {
  const findings: RawFinding[] = [];
  if (m.index < ctx.from || m.index >= ctx.to) return null;
  const { a, b, verb } = m.groups!;
  if (![a, b].some((word) => /^(?:me|him|her|them|myself)$/i.test(word))) return findings;
  // "I suggested that the engineer and myself take…": a reflexive after "I" stays.
  if (
    [a, b].some((word) => /^myself$/i.test(word)) &&
    /\bI\b[^.!?;:\n]*$/.test(ctx.text.slice(Math.max(0, m.index - 160), m.index))
  )
    return findings;
  // A present base verb only after "me"/"myself" ("Tim and me work"); "her" may own a noun.
  if (
    !FINITE_VERB.test(verb) &&
    !(
      [a, b].some((word) => /^(?:me|myself)$/i.test(word)) &&
      verb === verb.toLowerCase() &&
      englishWordInfo(verb)?.verbs.some((v) => v.form === "base" && v.lemma === verb)
    )
  )
    return findings;
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
    return findings;
  if (isFirstPerson(a) && isFirstPerson(b)) return findings;
  // "Her and my parents met" shares one noun between two possessives.
  if (/^her$/i.test(a) && /^(?:my|your|his|her|our|their|the)[ \t\u00a0]/i.test(b)) return findings;
  if (hasUserOrCasedWord(ctx, m[0])) return findings;
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
  if (phrase === typed) return findings;
  findings.push(
    finding("englishPronounCase", "review_msg_pronoun_subject_case", aStart, rangeEnd, [phrase], {
      context: tightAround(ctx, m),
    }),
  );
  return findings;
};

const PREPOSITION_BEFORE =
  /\b(?<prep>to|with|for|from|by|of|about|on|upon|in|into|at|among|between|against|without|under|over|through|toward|towards|behind|beside|before|after|like|than|around|near|beyond|via|unto|onto|within|regarding|concerning)[ \t\u00a0]+$/i;
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
const whomSubjects: MatchFixer = (m, ctx) => {
  const findings: RawFinding[] = [];
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
      if (/^(?:I|you|he|she|we|they|it|there)$/i.test(evidence)) return findings;
    } else if (/^(?:do|does|did)$/i.test(aux) || !verbAfterAuxiliary(aux, evidence))
      return findings;
    if (prep === "of") {
      const noun = OF_NOUN.exec(before)?.groups!.noun;
      const info = noun ? englishWordInfo(noun) : null;
      if (!noun || PARTITIVE.test(noun) || (info && (!info.noun || info.adjective)))
        return findings;
    } else if (prep) {
      // Only active perfects and modals ("to whom has opened"), not "to whom was given…".
      const active =
        (/^(?:has|have|had)$/i.test(aux) && evidence !== "been") ||
        (/^(?:will|would|can|could|shall|should|may|might|must)$/i.test(aux) && evidence !== "be");
      if (!active) return findings;
    }
  } else {
    const next = /^[ \t\u00a0]+([A-Za-z]+)/.exec(ctx.text.slice(matchEnd))?.[1] ?? "";
    if (prep || !finiteVerb(verb, ever, next.toLowerCase())) return findings;
  }
  if (hasUserOrCasedWord(ctx, m[0])) return findings;
  findings.push({
    ruleId: "englishPronounCase",
    messageKey: "review_msg_who_subject",
    range: { start, end },
    alternatives: [applyWordCase(whom.toLowerCase().replace("whom", "who"), detectWordCase(whom))],
    context: { start: Math.max(0, start - 32), end: Math.min(ctx.text.length, matchEnd + 9) },
  });
  return findings;
};

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
// Words after which "X and I" cannot be a subject: they need no verb from the pair.
const OBJECT_NEXT =
  /^(?:that|about|before|after|into|with|without|tonight|today|tomorrow|yesterday|here|there|but|for|on|at|in|to|from|by|over|again|together|if|when|which|who|whom)$/;

/** The finding writers of the object frames: each adds to `findings`. */
function objectPushers(ctx: DetectContext, findings: RawFinding[]) {
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
  // "Tom and I" -> "Tom and me": the first word in its object form, "ME" in all-caps text.
  const pushPair = (m: RegExpExecArray, a: string, range: [number, number], joint: string) => {
    const first = Object.hasOwn(OBJECT_FORM, a.toLowerCase()) ? objectForm(a) : a;
    push(m, range, `${first}${joint}${m[0] === m[0].toUpperCase() ? "ME" : "me"}`);
  };
  return { push, pushPair };
}

const objectForm = (word: string) =>
  applyWordCase(OBJECT_FORM[word.toLowerCase()] ?? word, detectWordCase(word));

const pronounObject: MatchFixer = (m, ctx) => {
  const findings: RawFinding[] = [];
  const { push } = objectPushers(ctx, findings);
  const { pronoun, noun } = m.groups!;
  if (noun !== undefined && !pluralNoun(noun)) return null;
  push(m, group(m, "pronoun"), objectForm(pronoun));
  return findings;
};
const andIObject: MatchFixer = (m, ctx) => {
  const findings: RawFinding[] = [];
  const { pushPair } = objectPushers(ctx, findings);
  const { a } = m.groups!;
  const [start, aEnd] = group(m, "a");
  const [iStart, end] = group(m, "i");
  // "between you and I" is left to its fixed phrase; "me and I" has no fix.
  if (/^(?:I|me)$/i.test(a) || (/^you$/i.test(a) && /^between/i.test(m[0]))) return findings;
  pushPair(m, a, [start, end], ctx.source.slice(aEnd, iStart));
  return findings;
};
const andMyselfObject: MatchFixer = (m, ctx) => {
  const findings: RawFinding[] = [];
  const { pushPair } = objectPushers(ctx, findings);
  const { a } = m.groups!;
  const [start, aEnd] = group(m, "a");
  const [iStart, end] = group(m, "i");
  if (/^(?:I|me|myself)$/i.test(a)) return findings;
  const sentence = ctx.text
    .slice(Math.max(0, m.index - 200), m.index)
    .split(/[.!?\n]/)
    .pop()!;
  if (/(?:^|[^\p{L}'’])I(?:[^\p{L}'’]|['’](?:m|ve|ll|d))/u.test(sentence)) return findings;
  pushPair(m, a, [start, end], ctx.source.slice(aEnd, iStart));
  return findings;
};
const andIBefore: MatchFixer = (m, ctx) => {
  const findings: RawFinding[] = [];
  const { pushPair } = objectPushers(ctx, findings);
  const { lead, a, next } = m.groups!;
  if (/^(?:I|me)$/i.test(a) || lead === "between" || (next && !OBJECT_NEXT.test(next)))
    return findings;
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
  if (!governs) return findings;
  const [start, aEnd] = group(m, "a");
  const [iStart, end] = group(m, "i");
  pushPair(m, a, [start, end], ctx.source.slice(aEnd, iStart));
  return findings;
};
const usSubject: MatchFixer = (m, ctx) => {
  const findings: RawFinding[] = [];
  const { push } = objectPushers(ctx, findings);
  const { pronoun, noun } = m.groups!;
  // "US companies" names the country.
  if (pronoun === "US" || !pluralNoun(noun)) return findings;
  push(m, group(m, "pronoun"), applyWordCase("we", detectWordCase(pronoun)), true);
  return findings;
};

/** "The coach asked Ana and myself": an object pair takes "me" when no "I" governs it. */
const myselfObjects: MatchFixer = (m, ctx) => {
  const findings: RawFinding[] = [];
  const sentence = /[^.!?;:\n]*$/.exec(ctx.text.slice(Math.max(0, m.index - 160), m.index))![0];
  // "I asked Ana and myself" is reflexive; a subject pair belongs to coordinatedSubjects.
  if (/\b(?:I|me|my|mine)\b/i.test(sentence)) return findings;
  const head = /([A-Za-z]+)[ \t\u00a0]+$/.exec(sentence)?.[1] ?? "";
  const read = englishWordInfo(head);
  const governs =
    head === head.toLowerCase() &&
    (new RegExp(`^(?:${OBJECT_PREPOSITION}|for|between)$`).test(head) ||
      !!read?.verbs.some((v) => v.form === "past" || v.form === "third"));
  if (!governs || hasUserOrCasedWord(ctx, m.groups!.target)) return findings;
  const end = m.index + m[0].length;
  const next = /^[ \t\u00a0]+([a-z]+)/.exec(ctx.text.slice(end, end + 24))?.[1] ?? "";
  // "…and myself went": a verb after the pair makes it a subject.
  if (FINITE_VERB.test(next) || englishWordInfo(next)?.verbs.some((v) => v.form === "base"))
    return findings;
  const [start, targetEnd] = m.indices!.groups!.target;
  findings.push({
    ruleId: "englishPronounCase",
    messageKey: "review_msg_pronoun_object_case",
    range: { start, end: targetEnd },
    alternatives: [applyWordCase("me", detectWordCase(m.groups!.target))],
    context: { start: Math.max(0, m.index - 48), end: Math.min(ctx.text.length, end + 16) },
  });
  return findings;
};

/** The named frame fixes of the englishPronounCase frames of grammar/rules/common.yaml. */
export const FIXERS = {
  coordinatedSubjects,
  correlativeSubjects,
  whomSubjects,
  pronounObject,
  andIObject,
  andMyselfObject,
  andIBefore,
  usSubject,
  myselfObjects,
} satisfies Record<string, MatchFixer>;

/** The named findings filters of grammar/rules/common.yaml (`filter:`). */
export const FILTERS = {
  // Two frames may find the same pair ("Me and Sam went" is a coordination with a finite verb
  // and with a base verb): the first finding at a start wins.
  firstPerStart: (_ctx, findings) => {
    const starts = new Set<number>();
    return findings.filter((f) => !starts.has(f.range.start) && !!starts.add(f.range.start));
  },
} satisfies Record<string, FindingsFilter>;
