import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { PhraseRow } from "../englishPhraseTables";
import { SPACE as S, WORD_END as E } from "../phraseTemplates";
import type { ReviewDetectorEntry } from "../reviewDetectors";
import { frameDetector, type Frame, type Rule } from "./idioms5";
import { DETERMINERS, FUNCTION_WORDS, wordBefore } from "./slotWords";

// Clauses with a gap or a clash the words around it show: a subordinator with no subject
// ("if is too long"), "either … nor", two forms of one verb side by side ("want wanted"),
// "that" for "than" after a comparative, and "there after" for thereafter.

export const PHRASES: readonly PhraseRow[] = [];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

const STRUCTURE: Rule = {
  ruleId: "englishSentenceStructure",
  messageKey: "review_msg_sentence_structure",
};
const CONFUSED: Rule = { ruleId: "englishConfusedWords", messageKey: "review_msg_confused_word" };
const REPEATED: Rule = { ruleId: "englishConfusedWords", messageKey: "review_msg_repeated_words" };
const THAN: Rule = { ruleId: "englishThenThan", messageKey: "review_msg_then_than" };

const read = (word: string | undefined) => (word ? englishWordInfo(word.toLowerCase()) : null);

// The pronouns a subject gap takes, by the verb after it.
const THIRD = ["it", "he", "she"];
const PAST_BE = ["it", "I", "he", "she"];
const ANY = ["you", "I", "it", "we"];
const GAP_VERB =
  "is|was|has|does|did|will|would|should|can|could|must|might|isn['’]t|wasn['’]t|hasn['’]t|doesn['’]t|didn['’]t|won['’]t|wouldn['’]t|shouldn['’]t|can['’]t|couldn['’]t";
const FRAMES: readonly Frame[] = [
  // "Delete the sentence if is too long", "since was happening", "if should have questions":
  // a subordinator directly before a finite verb has lost its subject.
  {
    rule: STRUCTURE,
    cue: ["if", "since", "because", "unless", "although", "whether"],
    pattern: `(?<![\\p{L}'’])(?:if|since|because|unless|although|whether)${S}(?<target>${GAP_VERB}|need)${S}(?<next>[a-z]+)${E}`,
    fix: (m, ctx) => {
      const verb = m.groups!.target.toLowerCase();
      const next = m.groups!.next.toLowerCase();
      // "if need be", "since will power…", "if won't we'll": an idiom, a noun or a subject.
      if (/^(?:be|i|you|he|she|it|we|they|there|this|that)$/.test(next) || /['’]/.test(next))
        return null;
      const r = read(next);
      if (verb === "need") {
        // "if need anything else": an object after need.
        if (!/^(?:anything|something|any|more|help|a|an|the|to|me|it|them|us|some)$/.test(next))
          return null;
        if (!/^(?:if|unless)$/i.test(wordBefore(ctx, m.index + m[0].indexOf(m.groups!.target))))
          return null;
      } else if (r && (r.noun || r.plural) && !r.verbs.length && !r.adjective && !r.adverb)
        return null;
      // "because will power…", "since can openers…": a modal that is also a noun needs a plain
      // verb or adverb after it.
      if (
        /^(?:will|can|must|might|may)$/.test(verb) &&
        !/^(?:not|be|have|also|never|always|probably|definitely|just|really|still|only)$/.test(
          next,
        ) &&
        (!r?.verbs.some((v) => v.form === "base") || r.noun || r.plural)
      )
        return null;
      const pronouns = /^(?:is|isn['’]t|has|hasn['’]t|does|doesn['’]t)$/.test(verb)
        ? THIRD
        : /^was/.test(verb)
          ? PAST_BE
          : verb === "need"
            ? ["you", "I", "we"]
            : ANY;
      const [start, end] = m.indices!.groups!.target;
      const typed = ctx.text.slice(start, end);
      return { alternatives: pronouns.map((p) => `${p} ${typed}`), range: [start, end], raw: true };
    },
  },
  // "either the client nor the server": either pairs with or.
  {
    rule: CONFUSED,
    cue: ["either"],
    pattern: `(?<![\\p{L}'’])either${S}(?:[^.!?;:\\n,]{1,60}?)${S}(?<target>nor)${E}`,
    fix: (m, ctx) => {
      // "either Iran or Iraq, nor…", "not the case either that…": an or of its own, or the
      // adverb either after a noun.
      if (
        /\bor\b/i.test(m[0]) ||
        /\bneither\b/i.test(ctx.text.slice(Math.max(0, m.index - 60), m.index))
      )
        return null;
      const before = wordBefore(ctx, m.index);
      const r = FUNCTION_WORDS.has(before) ? null : read(before);
      return r && (r.noun || r.plural) ? null : "or";
    },
  },
  // "I want wanted to thank you", "To made make it better": two forms of one verb.
  {
    rule: REPEATED,
    pattern: `(?<![\\p{L}'’-])(?<target>[a-z]{2,})(?=${S}(?<two>[a-z]{2,})${E})`,
    fix: (m, ctx) => {
      if (m.groups!.target !== m.groups!.target.toLowerCase()) return null;
      const one = m.groups!.target.toLowerCase();
      const two = m.groups!.two.toLowerCase();
      if (one === two || FUNCTION_WORDS.has(one) || FUNCTION_WORDS.has(two)) return null;
      const a = read(one);
      const b = read(two);
      if (!a?.verbs.length || !b?.verbs.length) return null;
      const lemma = a.verbs.find((v) => b.verbs.some((w) => w.lemma === v.lemma))?.lemma;
      // have/be/do/get build verb groups with their own forms ("had had", "got gotten").
      if (!lemma || (/^(?:have|be|do|get|let|go)$/.test(lemma) && one !== "going")) return null;
      // Both forms must differ in kind: "set sets" is a noun and its verb.
      const kinds = (r: typeof a) => r.verbs.filter((v) => v.lemma === lemma).map((v) => v.form);
      if (kinds(a).some((k) => kinds(b).includes(k))) return null;
      const before = wordBefore(ctx, m.index);
      // Only a slip pairs "made make", "going go" or "I want wanted"; "I know knows" (a relative
      // clause), "to marry married", "locking locks" and "connect connected devices" are two
      // words with jobs of their own.
      const secondBase = kinds(b).includes("base") && !b.plural;
      const slip =
        (secondBase && kinds(a).some((k) => k === "past" || k === "ing")) ||
        (/^(?:i|we|you|they)$/.test(before) &&
          kinds(a).includes("base") &&
          kinds(b).includes("past"));
      if (!slip) return null;
      // "the test tested", "a run runs": a determiner makes the first word a noun.
      const nounFirst = a.noun && !a.verbs.some((v) => v.form === "ing" || v.form === "past");
      if (DETERMINERS.has(before) || (nounFirst && !/^(?:to|i|we|you|they|he|she)$/.test(before)))
        return null;
      return { alternatives: [one, two], range: [m.index, m.indices!.groups!.two[1]] };
    },
  },
  // "greater that 10", "more than that expected": than after a comparative.
  {
    rule: THAN,
    cue: ["that"],
    pattern: `(?<![\\p{L}'’])(?<cmp>[a-z]+er|more${S}[a-z]+|less${S}[a-z]+|more|less|fewer)${S}(?<target>that)${S}(?=\\d|(?:ever|usual|expected|before|anticipated|planned|needed|necessary|required)${E})`,
    fix: (m) => {
      const cmp = m.groups!.cmp.toLowerCase();
      if (/^(?:more|less|fewer)/.test(cmp)) return "than";
      const r = read(cmp);
      // "order that 10 units": an -er noun or verb is no comparative.
      return r?.adjective && !r.noun && !r.verbs.length ? "than" : null;
    },
  },
  // "it decreases gradually there after.", "might there after happen": thereafter.
  {
    rule: CONFUSED,
    cue: ["after"],
    pattern: `(?<![\\p{L}'’])(?<target>there${S}after)(?=[ \\t\\u00a0]*[.!?;]|${S}(?<verb>[a-z]+)${E})`,
    fix: (m, ctx) => {
      const verb = m.groups!.verb?.toLowerCase();
      const before = wordBefore(ctx, m.index);
      // "We got there after lunch": after opens a phrase of its own.
      if (verb) {
        const r = read(verb);
        if (!r?.verbs.some((v) => v.form === "base") || FUNCTION_WORDS.has(verb)) return null;
        return /^(?:might|may|will|would|could|should|shall|must)$/.test(before)
          ? "thereafter"
          : null;
      }
      return /^(?:gradually|shortly|soon|immediately|and|decreases|increases|declines|rises)$/.test(
        before,
      )
        ? "thereafter"
        : null;
    },
  },
];

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: ["englishSentenceStructure", "englishConfusedWords", "englishThenThan"],
    detect: frameDetector(FRAMES),
  },
];
