import { englishInflect } from "../../implementations/helpers/EnglishInflection";
import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import { englishVerbForms } from "../../implementations/helpers/EnglishVerbForms";
import type { DetectContext } from "../reviewDetectors";
import type { Fixer } from "../../engine/reviewRules";
import { afterBreak, DETERMINERS, wordBefore } from "./slotWords";

const matchEnd = (m: RegExpExecArray) => m.index + m[0].length;
// Words before a bare "bit" + degree word that leave "a" out: "I'm bit lazy", "and bit of".
const BIT_LEAD =
  /^(?:['’](?:m|re|s)|am|is|are|was|were|be|been|being|feel|feels|felt|seem|seems|seemed|look|looks|looked|get|gets|got|getting|have|has|had|having|and|or|with|for|just|only|also|still)$/;
// Determiners that already own "little bit": "a little bit", "every little bit helps".
const NOT_BEFORE_LITTLE =
  /^(?:a|the|this|that|my|your|his|her|our|their|its|every|each|one|no|any|some|which|what|whose)$/;

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

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  // "He was hasn't there", "He wasn't obviously wasn't there": a full be at the clause start.
  // "What it is isn't clear" has its pronoun inside a subject clause.
  clashFramesT: (m, ctx) => (afterBreak(ctx, m.index) ? "" : null),
  // "It's the site that's we are using", "what's I'm doing": "'s" before a whole clause.
  // "you're" and "they're" count only before -ing or "not" ("what's you're name" is "your").
  clashFramesWord: (m) => m.groups!.word,
  // "I isn't", "I really aren't", "we isn't", "she weren't": a negative be that does not
  // agree with its pronoun. "it" and "you" can be objects ("the ones that made it aren't").
  clashFramesBe: (m, ctx) => {
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
  // "He turned 25 year old.", "She is six month old now": a plural count before "old".
  // "a 25 year old" is a noun and wants hyphens.
  clashFramesYear: (m) => (m.groups!.count === "1" ? null : `${m.groups!.target}s`),
  // "My car needs fixed", "The walls need painted": the dialect "need" + participle.
  clashFramesNeed: (m, ctx) => {
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
  // "She wasn't ever be able", "I'm never be able": be, an adverb, then a second be.
  clashFramesBe2: (m) => {
    const { be, adverb } = m.groups!;
    const will = /n['’]t$/i.test(be) ? "won't" : /^['’]/.test(be) ? `${be[0]}ll` : "will";
    return [`${be}${adverb}`, `${will}${adverb} be`];
  },
  // "I'm bit lazy", "having bit of a problem", "think little bit different": "a" is missing.
  clashFramesLittle: (m, ctx) => {
    const { lead, little } = m.groups!;
    const word = lead?.toLowerCase();
    // "Little bit stupid": the lead is "little" itself, at the clause start or after a word.
    if (word === "little") {
      const before = wordBefore(ctx, m.index);
      if (before ? NOT_BEFORE_LITTLE.test(before) : !afterBreak(ctx, m.index)) return null;
      return { alternatives: ["a little bit"], range: [m.index, matchEnd(m)] };
    }
    if (word === undefined) {
      if (!little || !afterBreak(ctx, m.index)) return null;
    } else if (little ? NOT_BEFORE_LITTLE.test(word) : !BIT_LEAD.test(word)) return null;
    return little ? "a little bit" : "a bit";
  },
  // "Are we have to go?", "Am I finally go home?": be inverted before a base verb.
  clashFramesBe3: (m, ctx) => {
    const { be, rest, subject, verb } = m.groups!;
    // A lowercase "i" is a variable.
    if (!afterBreak(ctx, m.index) || subject === "i") return null;
    const read = englishWordInfo(verb);
    // A noun reading counts only for the irregular verbs ("Are we have", "Am I go"): "Is it
    // love?" and "Are we friends?" are nouns after be.
    const irregular = englishVerbForms(verb);
    if (!read?.verbs.length || read.adjective || read.adverb) return null;
    // "Is it work or play?": a noun before a conjunction or the clause end.
    const next = /^[ \t\u00a0]+([a-z]+)/i.exec(ctx.text.slice(matchEnd(m), matchEnd(m) + 24));
    if (read.noun && (irregular?.lemma !== verb || !next || /^(?:or|and|nor|but)$/i.test(next[1])))
      return null;
    if (!read.verbs.every((v) => v.form === "base" && v.lemma === verb)) return null;
    // "Is he suppose to" wants "supposed"; "Are you please going" has the adverb please.
    if (irregular?.participle === verb || /^(?:be|suppose|use|please)$/.test(verb)) return null;
    const b = be.toLowerCase();
    const aux = /^(?:was|were)$/.test(b) ? "did" : /^(?:he|she|it)$/i.test(subject) ? "does" : "do";
    const ing = englishInflect(verb, "ing");
    return [`${aux}${rest}${verb}`, ...(ing ? [`${be}${rest}${ing}`] : [])];
  },
  // Opt-in: "more easy to read" -> "easier", "more clear" -> "clearer".
  clashFramesMore: (m, ctx) => {
    const { adjective, other } = m.groups!;
    if (adjective !== adjective.toLowerCase() || KEEP_MORE.test(adjective)) return null;
    // "all the more sad", "the more sad I got": the correlative keeps "more".
    if (/^(?:no|once|never|and|the)$/.test(wordBefore(ctx, m.index))) return null;
    const then = other && englishWordInfo(other.toLowerCase());
    if (then && then.adjective && !then.noun) return null;
    return comparative(adjective);
  },
  // Opt-in: "Please send both files, please." A second please at the sentence end goes.
  clashFramesT2: (m, ctx) => (afterBreak(ctx, m.index) ? "" : null),
  // Opt-in: "very very cool" -> "very, very cool" or one "very". A word must follow ("so so"
  // alone is "so-so").
  clashFramesWord2: (m) => {
    const { target, word } = m.groups!;
    // Typed casing differs ("So so"): the backreference matched case-blind.
    if (target.slice(-word.length) !== word.toLowerCase()) return null;
    return { alternatives: [`${word}, ${word.toLowerCase()}`, word], raw: true };
  },
} satisfies Record<string, Fixer>;
