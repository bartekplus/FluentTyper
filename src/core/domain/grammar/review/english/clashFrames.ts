import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { PhraseRow } from "../englishPhraseTables";
import { SPACE as S, WORD_END as E } from "../phraseTemplates";
import type { DetectContext, ReviewDetectorEntry } from "../reviewDetectors";
import { frameDetector, type Frame, type Rule } from "./idioms5";
import { afterBreak, DETERMINERS, wordBefore } from "./slotWords";

// Words that clash in one clause: two auxiliaries ("I'm haven't", "He was hasn't"), a clause
// after "that's" ("that's you are"), a pronoun and a negative be ("I isn't"), "25 year old",
// "needs fixed". Opt-in style: "more easy", "the reason is because", a second "please".

export const PHRASES: readonly PhraseRow[] = [];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

const STRUCTURE: Rule = {
  ruleId: "englishSentenceStructure",
  messageKey: "review_msg_sentence_structure",
};
const PRONOUN_VERB: Rule = {
  ruleId: "englishPronounVerbWhitelistAgreement",
  messageKey: "review_msg_pronoun_verb",
};
const NUMBER: Rule = { ruleId: "englishNounNumber", messageKey: "review_msg_noun_count" };
const COMPLEMENT: Rule = {
  ruleId: "englishVerbComplements",
  messageKey: "review_msg_verb_complements",
};
const STYLE_ADVICE: Rule = { ruleId: "stylePhrasing", messageKey: "review_msg_style_phrasing" };

const START = "(?<![\\p{L}'’])";
const NEGATIVES = ["has", "have", "had", "does", "do", "did", "is", "are", "was", "were"];
const NEGATIVE = `(?:${[...NEGATIVES, "wo", "ca", "could", "would", "should"].join("|")})n['’]t`;
const NEGATIVE_CUES = [...NEGATIVES, "could", "would", "should"].map((w) => `${w}n`);
const ADVERB = `(?:${S}(?:just|really|still|also|obviously|actually|simply|certainly|definitely|probably|clearly|usually|honestly|sometimes))?`;
const COUNT =
  "\\d+|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety";
// Subjects that take "needs fixed" only as the verb: a pronoun, or a determiner + one noun.
const NEED_SUBJECT = /^(?:it|this|that|he|she|they|these|those|everything|something|nothing)$/;
// Participles that also read as a past after a plural noun "needs": "Our needs changed".
const NEEDS_CHANGED =
  /^(?:changed|evolved|increased|decreased|shifted|differed|varied|expanded|emerged|developed|existed|remained|appeared|happened|occurred|arrived|continued|ended|started|peaked|grew|exceeded|included|listed|stated|mentioned|outlined|described|identified|addressed)$/;
// Words that make a following "were" a subjunctive.
const SUBJUNCTIVE = /\b(?:if|wish|wished|wishes|though|unless|suppose|supposing|imagine|only)\b/i;
/** The text from the last sentence end before `index`, at most 80 characters. */
const sentenceBefore = (ctx: DetectContext, index: number) =>
  ctx.text
    .slice(Math.max(0, index - 80), index)
    .split(/[.!?\n]/)
    .at(-1) ?? "";
// "more likely", "more often": set phrases that stay.
const KEEP_MORE = /^(?:likely|often|real|right|wrong|fun|apt|just|true|ill|well)$/;

/** "easier", "clearer", "safer": the -er comparative the dictionary lists as an adjective. */
function comparative(adjective: string): string | null {
  const info = englishWordInfo(adjective);
  if (!info?.adjective || /ly$/.test(adjective)) return null;
  // One syllable, or two ending in -y or -le: "more robust" and "more common" stay.
  const syllables = adjective.replace(/e$/, "").match(/[aeiouy]+/g)?.length ?? 0;
  if (syllables > 1 && !/(?:[^aeiou]y|le)$/.test(adjective)) return null;
  const doubled = /[^aeiou][aeiou]([bdgmnpt])$/.exec(adjective);
  const form = /[^aeiou]y$/.test(adjective)
    ? `${adjective.slice(0, -1)}ier`
    : adjective.endsWith("e")
      ? `${adjective}r`
      : doubled
        ? `${adjective}${doubled[1]}er`
        : `${adjective}er`;
  // "opener", "cleaner" also name things: only a pure adjective form is offered.
  const read = englishWordInfo(form);
  return read?.adjective && !read.noun ? form : null;
}

const FRAMES: readonly Frame[] = [
  // "I'm haven't been", "It's just doesn't seem right": a contracted be before a negative
  // auxiliary. A contraction never ends a clause, so the be is always extra.
  {
    rule: STRUCTURE,
    cue: NEGATIVE_CUES,
    pattern: `${START}(?:I|you|we|they|he|she|it)(?<target>['’](?:m|re|s))${ADVERB}${S}${NEGATIVE}${E}`,
    fix: "",
  },
  // "He was hasn't there", "He wasn't obviously wasn't there": a full be at the clause start.
  // "What it is isn't clear" has its pronoun inside a subject clause.
  {
    rule: STRUCTURE,
    cue: NEGATIVE_CUES,
    pattern: `${START}(?:I|you|we|they|he|she|it)(?<target>${S}(?:am|is|are|was|were)(?:n['’]t)?)${ADVERB}${S}${NEGATIVE}${E}`,
    fix: (m, ctx) => (afterBreak(ctx, m.index) ? "" : null),
  },
  // "It's the site that's we are using", "what's I'm doing": "'s" before a whole clause.
  // "you're" and "they're" count only before -ing or "not" ("what's you're name" is "your").
  {
    rule: STRUCTURE,
    cue: ["that", "what"],
    pattern: `${START}(?<target>(?<word>that|what)['’]s)${S}(?:(?:I|you|we|they|he|she|it)${S}(?:am|are|is|was|were)|I['’]m|(?:he|she|it)['’]s|we['’]re|(?:you|they)['’]re(?=${S}(?:[a-z]+ing|not)${E}))${E}`,
    fix: (m) => m.groups!.word,
  },
  // "I isn't", "I really aren't", "we isn't", "she weren't": a negative be that does not
  // agree with its pronoun. "it" and "you" can be objects ("the ones that made it aren't").
  {
    rule: PRONOUN_VERB,
    cue: ["isn", "aren", "wasn", "weren"],
    pattern: `${START}(?<subject>I|we|they|he|she)${ADVERB}${S}(?<target>(?<be>is|are|was|were)n['’]t)${E}`,
    fix: (m, ctx) => {
      const { subject, be } = m.groups!;
      const s = subject.toLowerCase();
      // A lowercase "i" is a variable; "you and I", "than they" are no whole subject.
      if (subject === "i" || /^(?:and|or|nor|than|as)$/.test(wordBefore(ctx, m.index))) return null;
      const b = be.toLowerCase();
      // "I wish I weren't", "if she weren't so young": a subjunctive were.
      if (b === "were" && SUBJUNCTIVE.test(sentenceBefore(ctx, m.index))) return null;
      const fix =
        s === "i"
          ? { is: "am not", are: "am not", were: "wasn't" }[b]
          : s === "we" || s === "they"
            ? { is: "aren't", was: "weren't" }[b]
            : { are: "isn't", were: "wasn't" }[b];
      return fix ?? null;
    },
  },
  // "He turned 25 year old.", "She is six month old now": a plural count before "old".
  // "a 25 year old" is a noun and wants hyphens.
  {
    rule: NUMBER,
    cue: ["old"],
    pattern: `(?:${START}(?:is|was|turned|turns|turn|turning|be|am|are|were|being)|['’](?:s|m|re))${S}(?<count>${COUNT})${S}(?<target>year|month|week|day)${S}old(?=[ \\t\\u00a0]*(?:[.,;:!?)]|$)|${S}(?:and|but|now|today|this|last|when|in)${E})`,
    fix: (m) => (m.groups!.count === "1" ? null : `${m.groups!.target}s`),
  },
  // "My car needs fixed", "The walls need painted": the dialect "need" + participle.
  {
    rule: COMPLEMENT,
    cue: ["need", "needs", "needed"],
    pattern: `${START}(?<subject>[a-z]+)${S}(?<target>(?<need>needs|need|needed)${S}(?<verb>[a-z]+ed))(?=[ \\t\\u00a0]*(?:[.!?,;]|$)|${S}(?:before|soon|again|now|badly|if|when|or|and)${E})`,
    fix: (m, ctx) => {
      const { subject, need, verb } = m.groups!;
      const s = subject.toLowerCase();
      const v = verb.toLowerCase();
      if (NEEDS_CHANGED.test(v)) return null;
      if (!englishWordInfo(v)?.verbs.some((x) => x.form === "participle")) return null;
      const read = englishWordInfo(s);
      const nounSubject = !!read?.noun && DETERMINERS.has(wordBefore(ctx, m.index));
      if (!NEED_SUBJECT.test(s) && !nounSubject) return null;
      return [`${need} to be ${verb}`, `${need} ${v.replace(/e?d$/, "")}ing`].filter(
        (alt, i) => i === 0 || englishWordInfo(alt.split(" ")[1]),
      );
    },
  },
  // Opt-in: "more easy to read" -> "easier", "more clear" -> "clearer".
  {
    rule: STYLE_ADVICE,
    cue: ["more"],
    // "more dark and muted" keeps more for both words; "more wise than clever" compares two.
    pattern: `${START}(?<target>more${S}(?<adjective>[a-z]{3,8}))(?=${S}(?:to|for|if|when|with)${E}|${S}than${S}(?<other>[a-z]+)|[ \\t\\u00a0]*(?:[.,;:!?)]|$))`,
    fix: (m, ctx) => {
      const { adjective, other } = m.groups!;
      if (adjective !== adjective.toLowerCase() || KEEP_MORE.test(adjective)) return null;
      if (/^(?:no|once|never|and)$/.test(wordBefore(ctx, m.index))) return null;
      const then = other && englishWordInfo(other.toLowerCase());
      if (then && then.adjective && !then.noun) return null;
      return comparative(adjective);
    },
  },
  // Opt-in: "The reason we left is because…" -> "is that".
  {
    rule: STYLE_ADVICE,
    cue: ["reason"],
    pattern: `${START}reason(?:${S}[a-z'’]+){0,8}?${S}(?:is|was)${S}(?<target>because)${E}(?!${S}of${E})`,
    fix: "that",
  },
  // Opt-in: "Please send both files, please." A second please at the sentence end goes.
  {
    rule: STYLE_ADVICE,
    cue: ["please"],
    pattern: `${START}please${E}[^.!?\\n]{1,100}?(?<target>,?${S}please)(?=[ \\t\\u00a0]*[.!?])`,
    // The first please opens the sentence: "Can you say please?" mentions the word.
    fix: (m, ctx) => (afterBreak(ctx, m.index) ? "" : null),
  },
  // Opt-in: "very very cool" -> "very, very cool" or one "very". A word must follow ("so so"
  // alone is "so-so").
  {
    rule: STYLE_ADVICE,
    cue: ["very", "so", "far", "long", "really"],
    pattern: `${START}(?<target>(?<word>very|so|far|long|really)${S}\\k<word>)${S}(?=[a-z])`,
    fix: (m) => {
      const { target, word } = m.groups!;
      // Typed casing differs ("So so"): the backreference matched case-blind.
      if (target.slice(-word.length) !== word.toLowerCase()) return null;
      return { alternatives: [`${word}, ${word.toLowerCase()}`, word], raw: true };
    },
  },
];

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: [
      "englishSentenceStructure",
      "englishPronounVerbWhitelistAgreement",
      "englishNounNumber",
      "englishVerbComplements",
      "stylePhrasing",
    ],
    detect: frameDetector(FRAMES),
  },
];
