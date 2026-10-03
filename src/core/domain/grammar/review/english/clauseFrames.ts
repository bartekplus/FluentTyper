import { englishLemma } from "../../implementations/helpers/EnglishInflection";
import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { PhraseRow } from "../englishPhraseTables";
import { SPACE as S, WORD_END as E } from "../phraseTemplates";
import type { ReviewDetectorEntry } from "../reviewDetectors";
import { MASS, nounNumber } from "./nounNumberSlots";
import { COMPOUND, CONTEXT, frameDetector, TYPO, type Frame, type Rule } from "./idioms5";
import { afterBreak, FUNCTION_WORDS, nounOnly, wordBefore } from "./slotWords";

// Clause-level slips one frame can name: "The United States are" (is), "The symptom's vary"
// (symptoms), "It you have questions" (If), "Help us helps you" (help), "Nobody told me
// nothing" (anything), "What is reason that…" (the reason), "in Tuesday" (on), "a bit money"
// (a bit of), "I am interesting in" (interested), "a much fast route" (faster).

const AGREEMENT: Rule = {
  ruleId: "englishSubjectVerbAgreement",
  messageKey: "review_msg_subject_verb",
};
const CONFUSED: Rule = { ruleId: "englishConfusedWords", messageKey: "review_msg_confused_word" };
const PREPOSITION: Rule = {
  ruleId: "englishFixedPrepositions",
  messageKey: "review_msg_fixed_prepositions",
};
const NUMBER: Rule = { ruleId: "englishNounNumber", messageKey: "review_msg_noun_count" };
const STRUCTURE: Rule = {
  ruleId: "englishSentenceStructure",
  messageKey: "review_msg_sentence_structure",
};

export const PHRASES: readonly PhraseRow[] = [
  ["heave use of", "heavy use of"],
  ["a quite a", "quite a"],
  ["a rather a", "rather a"],
  ["the only the", "the only"],
  ["a such a", "such a"],
  ...["the", "this", "good", "every", "in the", "Friday", "Sunday"].map((lead): PhraseRow => [
    `${lead} after noon`,
    `${lead} afternoon`,
  ]),
  ...["to", "please", "can", "need to", "should"].map((lead): PhraseRow => [
    `${lead} fresh up`,
    `${lead} freshen up`,
  ]),
];
export const COMPOUNDS: readonly PhraseRow[] = [
  ...["stated", "turn", "whelm", "whelmed", "whelming"].map((verb): PhraseRow => [
    `over ${verb}`,
    `over${verb}`,
  ]),
];
export const STYLE: readonly PhraseRow[] = [];

const read = (word: string | undefined) => (word ? englishWordInfo(word.toLowerCase()) : null);
// Mass nouns "a bit" measures; "a bit player", "a bit rate" stay.
const BIT_OF =
  "money|time|help|luck|water|food|sugar|salt|milk|information|advice|work|sleep|rest|space|" +
  "patience|practice|pressure|experience|knowledge|research|effort|energy|fun|trouble|attention";
const COLLECTIVE = new Set(
  "staff police personnel cattle clergy crew team family government audience faculty public youth people".split(
    " ",
  ),
);
const COMPARATIVE: Record<string, string> = {
  fast: "faster",
  slow: "slower",
  big: "bigger",
  small: "smaller",
  cheap: "cheaper",
  easy: "easier",
  hard: "harder",
  long: "longer",
  short: "shorter",
  high: "higher",
  low: "lower",
  quick: "quicker",
  safe: "safer",
  large: "larger",
  nice: "nicer",
  good: "better",
  bad: "worse",
  strong: "stronger",
  young: "younger",
  old: "older",
};

const FRAMES: readonly Frame[] = [
  // "The United States are 246 years old": one country.
  {
    rule: AGREEMENT,
    cue: ["states"],
    pattern: `the${S}United${S}States${S}(?<target>are|were|have)${E}`,
    fix: (m, ctx) =>
      !afterBreak(ctx, m.index)
        ? null
        : { are: "is", were: "was", have: "has" }[m.groups!.target.toLowerCase() as "are"],
  },
  // "The symptom's vary": a plural before a plural verb ("my dad's are blue" is elliptical).
  {
    rule: { ruleId: "englishApostrophes", messageKey: "review_msg_plural_apostrophe" },
    cue: ["are", "were", "have", "vary", "differ", "seem", "look"],
    pattern: `(?:the|these|those|all|some|many)${S}(?<target>(?<noun>[a-z]{3,})['’]s)${S}(?:are|were|have|vary|differ|seem|look|need|show)${E}`,
    fix: (m) => {
      const n = nounNumber(m.groups!.noun);
      return n?.number === "singular" && m.groups!.noun !== "let" ? n.plural : null;
    },
  },
  // "It you have any questions": if.
  {
    rule: TYPO,
    cue: ["it"],
    pattern: `(?<target>it)${S}(?:you|we|they|I|he|she)${S}(?:have|need|want|are|can|make|find|see|do|would|get|like)${E}`,
    fix: (m, ctx) =>
      afterBreak(ctx, m.index) || /^(?:and|but|so)$/.test(wordBefore(ctx, m.index)) ? "if" : null,
  },
  // "Help us helps you", "Let us documents it": the base after let/help/make + object.
  {
    rule: {
      ruleId: "englishVerbComplements",
      messageKey: "review_msg_causative_base",
    },
    cue: ["help", "let", "make", "helps", "lets", "makes", "made"],
    pattern: `(?:help|helps|helped|let|lets|make|makes|made)${S}(?:us|me|him|her|them|you)${S}(?<target>[a-z]+s)(?=[ \\t\\u00a0]*[.!?,]|${S}(?:you|me|him|her|us|them|it|the|a|an|this|that|our|your|their|my|his)${E})`,
    fix: (m, ctx) => {
      const word = m.groups!.target;
      const r = read(word);
      if (!r?.verbs.some((v) => v.form === "third")) return null;
      // "made us friends.", "help me guys.": a plural noun object, not a verb.
      if (r.plural && /^[ \t\u00a0]*[.!?,]/.test(ctx.text.slice(m.index + m[0].length)))
        return null;
      return englishLemma(word, "third");
    },
  },
  // "Nobody told me nothing": anything after a negative subject.
  {
    rule: { ruleId: "englishUsagePhrases", messageKey: "review_msg_double_negative" },
    cue: ["nothing", "nobody", "nowhere"],
    pattern: `(?<![\\p{L}'’])(?:nobody|no${S}one)${S}(?<verb>[a-z]+)(?:${S}(?:me|him|her|us|them|you))?${S}(?<target>nothing|nobody|nowhere)${E}`,
    fix: (m) => {
      const r = read(m.groups!.verb);
      if (!r?.verbs.some((v) => v.form === "past" || v.form === "third")) return null;
      return m.groups!.target.toLowerCase().replace(/^no/, "any");
    },
  },
  // "What is reason that it fails?": the reason.
  {
    rule: CONTEXT,
    cue: ["reason", "solution", "problem", "difference", "point", "purpose", "meaning", "cause"],
    pattern: `(?:what|which)${S}(?:is|was)${S}(?<target>reason|solution|problem|difference|purpose|meaning|cause|answer|result)(?=${S}(?:that|for|of|why|behind|to|in|with)${E})`,
    fix: (m) => ({ alternatives: [`the ${m.groups!.target}`, `a ${m.groups!.target}`] }),
  },
  // "in Tuesday", "At this Saturday": on.
  {
    rule: PREPOSITION,
    cue: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
    // A sentence-start "In Friday morning", or after a dated event verb ("met in Tuesday");
    // "be in Friday", "weighed in Monday", "slept in Sunday" are particles.
    pattern: `(?:(?<lead>met|meet|arrive|arrived|arrives|left|happened|happens|scheduled|planned|due|held|born|died|closed|started|starts|began|begins|ended|ends|opened|opens|work|works|worked|person)${S})?(?<target>in|at)${S}(?:(?<near>this|next|last)${S})?(?<day>Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)${E}(?!['’]|${S}\\p{L}+['’]s|,)`,
    fix: (m, ctx) =>
      /^[A-Z][a-z]/.test(m.groups!.day) &&
      (m.groups!.lead || m.groups!.near || afterBreak(ctx, m.index))
        ? "on"
        : null,
  },
  // "since I rebooted it it's fine": a comma between two clauses.
  {
    rule: { ruleId: "englishPhraseCorrections", messageKey: "review_msg_clause_comma" },
    cue: ["it"],
    pattern: `(?:[a-z]+ed)${S}(?<target>it)${S}it(?:['’]s|${S}(?:is|was|has|will|works|worked|stopped|started|kept))${E}`,
    fix: "it,",
  },
  // "I have a bit money": a bit of.
  {
    rule: CONTEXT,
    cue: ["bit"],
    pattern: `a(?:${S}(?:good|little|tiny|small))?${S}(?<target>bit)${S}(?:${BIT_OF})${E}`,
    fix: "bit of",
  },
  // "We left in a harry": hurry (not "a Harry Potter book").
  {
    rule: TYPO,
    cue: ["harry"],
    pattern: `in${S}a${S}(?<target>harry)${E}(?!${S}potter)`,
    fix: (m) => (m.groups!.target === "harry" ? "hurry" : null),
  },
  // "He graduated the university": graduated from.
  {
    rule: PREPOSITION,
    cue: ["graduated", "graduate", "graduating"],
    pattern: `(?<target>graduated|graduating)${S}the${S}(?:university|college|academy)${E}`,
    fix: (m) => `${m.groups!.target} from`,
  },
  // "This results missed the estimate", "This guys have left": these.
  {
    rule: { ruleId: "englishNounNumber", messageKey: "review_msg_demonstrative_number" },
    cue: ["this"],
    pattern: `(?<target>this)${S}(?<noun>[a-z]+s)${S}(?<verb>[a-z]+)(?=${S}(?:the|a|an|my|his|her|its|our|their|this|that|some|all|[0-9$])|${S}(?:made|been|had|done|got|seen)${E})`,
    fix: (m, ctx) => {
      if (!afterBreak(ctx, m.index)) return null;
      const verb = read(m.groups!.verb);
      const pastOnly =
        !!verb?.verbs.some((v) => v.form === "past") &&
        !verb.noun &&
        !verb.verbs.some((v) => v.form === "base" || v.form === "third");
      return (nounNumber(m.groups!.noun)?.number === "plural" || m.groups!.noun === "guys") &&
        (pastOnly || /^(?:have|are|were|do)$/.test(m.groups!.verb))
        ? "these"
        : null;
    },
  },
  // "some language are complicated": some + a plain count noun + a plural verb.
  {
    rule: NUMBER,
    cue: ["some"],
    pattern: `some${S}(?<target>[a-z]+)${S}(?:are|were|have)${E}`,
    fix: (m) => {
      const noun = m.groups!.target;
      const r = read(noun);
      if (r && (!r.noun || r.adjective || r.adverb || r.verbs.some((v) => v.form !== "base")))
        return null;
      const n = nounNumber(noun);
      return n?.number === "singular" && !MASS.has(noun) && !COLLECTIVE.has(noun) ? n.plural : null;
    },
  },
  // "I am interesting in this book": interested.
  {
    rule: CONFUSED,
    cue: ["interesting", "interest"],
    pattern: `(?:(?:am|are|were|['’]m|['’]re)(?:${S}(?:very|so|really|not|also))?${S}(?<target>interest)|(?:I${S}am|I['’]m)(?:${S}(?:very|so|really|not|also))?${S}(?<target2>interesting))${S}in${E}(?!${S}that${E})`,
    fix: "interested",
  },
  // "He had been knowing it": known.
  {
    rule: { ruleId: "englishPerfectParticiples", messageKey: "review_msg_perfect_participle" },
    cue: ["knowing"],
    pattern: `(?:had|has|have|ve|d)${S}(?<target>been${S}knowing)${E}`,
    fix: "known",
  },
  // "Am I ride?", "I am ride.": right.
  {
    rule: TYPO,
    cue: ["ride"],
    pattern: `(?:am${S}I|I${S}am|I['’]m|you${S}are|you['’]re|are${S}you|is${S}that|that['’]s)${S}(?<target>ride)(?=[ \\t\\u00a0]*[?.!,])`,
    fix: "right",
  },
  // "It is a much fast route": a comparative after "much".
  {
    rule: CONTEXT,
    cue: ["much"],
    pattern: `(?:a|is|was|are|were|be|it['’]s|that['’]s|feels|looks|seems)${S}much${S}(?<target>fast|slow|big|small|cheap|easy|hard|short|quick|safe|large|nice|strong|young)${E}`,
    fix: (m) => COMPARATIVE[m.groups!.target.toLowerCase()],
  },
  // "He like me", "It like a higher power": likes / is like.
  {
    rule: AGREEMENT,
    cue: ["like"],
    pattern: `(?<![\\p{L}'’])(?:he|she|it)${S}(?<target>like)${S}(?:me|you|him|her|us|them|it|a|an|the)${E}(?!${S}(?:has|is|was|does|had|can|will|would|did)${E})`,
    fix: (m, ctx) =>
      afterBreak(ctx, m.index) || /^(?:but|so|because)$/.test(wordBefore(ctx, m.index))
        ? ["likes", "is like"]
        : null,
  },
  // "entered the he house": a stray pronoun after the article.
  {
    rule: STRUCTURE,
    cue: ["the"],
    pattern: `(?<target>the${S}(?<pron>he|she|they|it))${S}(?<noun>[a-z]+)${E}`,
    fix: (m) => {
      const noun = m.groups!.noun;
      if (m.groups!.pron !== m.groups!.pron.toLowerCase()) return null;
      return (read(noun)?.noun || nounOnly(noun)) && !FUNCTION_WORDS.has(noun) ? "the" : null;
    },
  },
  // "at the at the turn": a doubled preposition phrase.
  {
    rule: { ruleId: "englishRepeatedWords", messageKey: "review_msg_repeated_words" },
    cue: ["the"],
    pattern: `(?<target>(?<prep>at|on|in|of|to|for|with|from|by|into)${S}the${S}\\k<prep>${S}the)${E}`,
    fix: (m) => `${m.groups!.prep} the`,
  },
  // "Many other have tried": others before a verb.
  {
    rule: CONFUSED,
    cue: ["other"],
    pattern: `(?:several|many|some|few|both)${S}(?<target>other)${S}(?:have|are|were|will|can|did|do|had|would|could|should|may|might|must)${E}`,
    fix: "others",
  },
  // "The fox' tail": an -x noun takes 's.
  {
    rule: { ruleId: "englishApostrophes", messageKey: "review_msg_noun_possessive" },
    pattern: `(?<target>(?<noun>[a-z]+x)['’])${S}(?<next>[a-z]+)${E}`,
    fix: (m) => (read(m.groups!.noun)?.noun ? `${m.groups!.noun}'s` : null),
  },
  // "They custom build a solution": the verb compound is hyphenated.
  {
    rule: COMPOUND,
    cue: ["custom"],
    pattern: `(?:they|we|I|you|he|she|have|has|had|can|will|to|be|been)${S}(?<target>custom${S}(?<verb>build|built|make|made|design|designed|tailor|tailored))${S}(?:a|an|the|their|our|your|it|them|every)${E}`,
    fix: (m) => `custom-${m.groups!.verb}`,
  },
  // "has been signed-in": the verb phrase is open.
  {
    rule: COMPOUND,
    cue: ["signed", "logged"],
    pattern: `(?:been|be|is|are|was|were|get|got|getting|stay|stayed)${S}(?<target>(?:signed|logged)-(?:in|out))(?=[ \\t\\u00a0]*[.!?,]|${S}(?:from|of|to|on|at|automatically|again)${E})`,
    fix: (m) => m.groups!.target.replace("-", " "),
  },
  // "put it a side for later": aside.
  {
    rule: COMPOUND,
    cue: ["side"],
    pattern: `(?:put|puts|putting|set|sets|setting|leave|left|step|stepped|stand|stood|move|moved|lay|laid)(?:${S}(?:it|them|this|that|some))?${S}(?<target>a${S}side)(?=[ \\t\\u00a0]*[.!?,]|${S}(?:for|from|until|and|some|time|money|[0-9]+)${E})`,
    fix: "aside",
  },
  // "Neither children are happy": neither of the.
  {
    rule: CONTEXT,
    cue: ["neither"],
    pattern: `(?<target>neither)${S}(?<noun>[a-z]+)${S}(?:are|were|have|do|seem|look|want|like|need)${E}`,
    fix: (m) => {
      const noun = m.groups!.noun;
      return nounOnly(noun) === "plural" || /^(?:children|people|men|women)$/.test(noun)
        ? "neither of the"
        : null;
    },
  },
  // "There are number of animals": a number of.
  {
    rule: CONTEXT,
    cue: ["number"],
    pattern: `(?:are|were|is|was|have|has)${S}(?<target>number)${S}of${S}(?<noun>[a-z]+s)${E}`,
    fix: (m) => (nounNumber(m.groups!.noun)?.number === "plural" ? "a number" : null),
  },
  // "the us", "a us resident": the US.
  {
    rule: { ruleId: "englishCanonicalCasing", messageKey: "review_msg_name_casing" },
    cue: ["us"],
    pattern: `(?:the|a)${S}(?<target>us)(?=[ \\t\\u00a0]*[.!?,]|${S}(?:resident|residents|citizen|citizens|government|market|army|dollar|dollars|economy|president|embassy|military|state|states|border|navy|congress|senate|team|version)${E})`,
    fix: "US",
  },
  // "that kind of stories": a singular kind with a plural noun.
  {
    rule: NUMBER,
    cue: ["kind", "type", "sort"],
    pattern: `(?<target>(?<dem>this|that)${S}(?<kind>kind|type|sort)${S}of${S}(?<noun>[a-z]+s))${E}(?!${S}(?:is|was|has|does)${E})`,
    fix: (m, ctx) => {
      const { dem, kind, noun } = m.groups!;
      const r = read(noun);
      if (
        r?.verbs.some((v) => v.form === "third") &&
        (!r.plural || /^[ \t\u00a0]*[.!?,]/.test(ctx.text.slice(m.index + m[0].length)))
      )
        return null;
      const n = nounNumber(noun);
      if (n?.number !== "plural") return null;
      const single = n.singular;
      const these = dem.toLowerCase() === "this" ? "these" : "those";
      return [`${dem} ${kind} of ${single}`, `${these} ${kind}s of ${noun}`];
    },
  },
  // "As Christopher show us": a name's verb takes -s.
  {
    rule: AGREEMENT,
    cue: ["as", "once", "when", "if", "because", "since", "until", "after", "before"],
    pattern: `(?:as|once|when|if|because|since|until|after|before)${S}(?<name>[A-Z][a-z]+)${S}(?<target>[a-z]+)${S}(?:us|me|him|her|them|it|this|that|the)${E}`,
    fix: (m) => {
      const { name, target } = m.groups!;
      if (!/^[A-Z][a-z]+[^s]$/.test(name) || read(name)?.noun || nounOnly(name.toLowerCase()))
        return null;
      const r = read(target);
      if (!r?.verbs.length || !r.verbs.every((v) => v.form === "base") || r.adjective) return null;
      if (FUNCTION_WORDS.has(target)) return null;
      return /[^aeiou]y$/.test(target)
        ? `${target.slice(0, -1)}ies`
        : /(?:s|x|z|ch|sh|o)$/.test(target)
          ? `${target}es`
          : `${target}s`;
    },
  },
  // "David and I's cat": David's and my.
  {
    rule: CONTEXT,
    pattern: `(?<target>(?<who>[A-Z][a-z]+|my${S}[a-z]+)${S}and${S}I['’]s)${E}`,
    fix: (m, ctx) => (wordBefore(ctx, m.index) === "the" ? null : `${m.groups!.who}'s and my`),
  },
];

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: [
      "englishSubjectVerbAgreement",
      "englishApostrophes",
      "englishPhraseCorrections",
      "englishVerbComplements",
      "englishConfusedWords",
      "englishFixedPrepositions",
      "englishUsagePhrases",
      "englishNounNumber",
      "englishPerfectParticiples",
      "englishSentenceStructure",
      "englishRepeatedWords",
      "englishContextualCompounds",
      "englishCanonicalCasing",
    ],
    detect: frameDetector(FRAMES),
  },
];
