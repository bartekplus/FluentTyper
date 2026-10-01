import {
  englishListedNoun,
  englishVerbNouns,
  englishWordInfo,
} from "../../implementations/helpers/EnglishLexicon";
import { englishVerbForms } from "../../implementations/helpers/EnglishVerbForms";
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

// A determiner before a word that cannot follow it: a bare verb where its noun belongs ("the
// translate was correct" -> translation) and "the" for "they" before a verb ("The will help").

export const PHRASES: readonly PhraseRow[] = [];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

/** A word the lexicon reads only as a base verb, with no noun, adjective or other form. */
function verbOnly(word: string): boolean {
  // "in the know"; "the except of" belongs to a phrase row.
  if (FUNCTION_WORDS.has(word) || /^(?:know|be|do|have|go|get|say|let|except)$/.test(word))
    return false;
  const forms = englishVerbForms(word);
  if (forms && forms.lemma !== word) return false;
  const read = englishWordInfo(word);
  return (
    !!read &&
    read.verbs.length > 0 &&
    read.verbs.every((v) => v.form === "base" && v.lemma === word) &&
    !read.noun &&
    !read.adjective &&
    !read.adverb &&
    !read.plural &&
    !englishListedNoun(word)
  );
}

// A Bloom-filter noun can be a false hit: only long derived shapes count from it.
const isNoun = (word: string) =>
  !!englishWordInfo(word)?.noun || (word.length >= 8 && nounOnly(word) === "singular");

/** Nouns built from a verb: the dictionary's own -ion/-ment, then common suffixes it lists. */
function derivedNouns(verb: string): string[] {
  const flagged = englishVerbNouns(verb);
  if (flagged.length) return flagged;
  const stem = verb.replace(/e$/, "");
  const candidates = [
    `${verb}ion`,
    `${stem}ion`,
    `${stem}ation`,
    `${verb}ation`,
    `${stem}sion`,
    `${verb}ment`,
    `${stem}al`,
    `${verb}al`,
    `${stem}ance`,
  ];
  const found = [...new Set(candidates)].filter((c) => c !== verb && isNoun(c));
  return found.slice(0, 2);
}

const DETERMINER = "(?:the|a|an|my|your|his|our|their|its)";

/** "The translate to English was correct", "Sorry for the late respond": a verb as a noun. */
function verbAsNoun(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(
    ctx,
    `${DETERMINER}${SPACE}(?<first>[a-z]+)(?:${SPACE}(?<second>[a-z]+))?${WORD_END}`,
    "first",
  )) {
    const { first, second } = m.groups!;
    // "the late respond": one adjective may stand between.
    const adjective = englishWordInfo(first);
    const skip =
      !verbOnly(first) &&
      !!second &&
      !!adjective?.adjective &&
      !adjective.verbs.length &&
      !FUNCTION_WORDS.has(first);
    const word = skip ? second : first;
    if (ctx.dictionary.has(word) || !verbOnly(word)) continue;
    const wordEnd = skip ? m.index + m[0].length : m.indices!.groups!.first[1];
    // "this/that" can be a pronoun subject: "that explains it". Only before a closing word.
    const det = m[0].split(/\s+/)[0].toLowerCase();
    const next = tokensAfter(ctx, wordEnd, 1)[0];
    if (/^(?:this|that)$/.test(det)) continue;
    // A following noun or verb object makes the word a modifier or the determiner a mistake
    // elsewhere ("the install script"); only a phrase end, preposition or verb follows.
    if (
      next?.kind === "word" &&
      !/^(?:of|for|to|in|into|on|at|by|as|with|from|was|is|were|are|has|had|will|would|can|could|should|didn['’]t|did|does|and|but|or)$/.test(
        next.lower,
      )
    )
      continue;
    if (next?.kind === "other") continue;
    const nouns = derivedNouns(word);
    if (!nouns.length) continue;
    const [start, end] = skip ? m.indices!.groups!.second : m.indices!.groups!.first;
    findings.push({
      ruleId: "englishConfusedWords",
      messageKey: "review_msg_confused_word",
      range: { start, end },
      alternatives: nouns.map((n) => caseLike(word, n)),
      ...(nouns.length > 1 ? { requiresChoice: true as const } : {}),
      context: evidence(ctx, m.index, end),
    });
  }
  return findings;
}

const MODAL_THEY =
  /^(?:would|should|could|cannot|can['’]t|won['’]t|don['’]t|didn['’]t|wouldn['’]t|shouldn['’]t|couldn['’]t|haven['’]t)$/;

/** "The cannot help you", "if the create the concept": "the" where "they" is meant. */
function theForThey(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, `(?<target>the)${SPACE}(?=[a-z])`)) {
    const target = m.groups!.target;
    if (target !== target.toLowerCase() && !afterBreak(ctx, m.index)) continue;
    const before = wordBefore(ctx, m.index);
    if (
      !afterBreak(ctx, m.index) &&
      !/^(?:if|when|and|but|so|because|what|that|since|as|until|while|how|why|where|indicates|ensures)$/.test(
        before,
      )
    )
      continue;
    const [first, second, third] = tokensAfter(ctx, m.index + m[0].length, 3);
    if (first?.kind !== "word" || first.text !== first.lower) continue;
    let ok = MODAL_THEY.test(first.lower);
    // "The will make me happy" but "The will states…": a base verb after will/can/may.
    if (!ok && /^(?:will|can|may|might|must)$/.test(first.lower))
      ok =
        second?.kind === "word" &&
        // "the must have toy": a compound noun.
        second.lower !== "have" &&
        !!englishWordInfo(second.lower)?.verbs.some(
          (v) => v.form === "base" && v.lemma === second.lower,
        ) &&
        !nounOnly(second.lower);
    // "The also use camouflage", "The unsuccessfully attacked the ship".
    if (
      !ok &&
      /^(?:also|always|really|probably|never|just|correctly|quietly)$|ly$/.test(first.lower)
    ) {
      const read = second?.kind === "word" ? englishWordInfo(second.lower) : null;
      // "The seriously injured man": a participle adjective; a past needs its object.
      const object =
        third?.kind === "word" &&
        third.text === third.lower &&
        /^(?:the|a|an|us|them|me|him|her|it|you|my|your|our|their)$/.test(third.lower);
      ok =
        !!read &&
        (!read.noun || !/ly$/.test(first.lower)) &&
        !read.adjective &&
        (read.verbs.some((v) => v.form === "base" && v.lemma === second.lower) ||
          (object && read.verbs.some((v) => v.form === "past"))) &&
        !(englishWordInfo(first.lower)?.adjective && !/ly$/.test(first.lower));
    }
    // "if the allowed us to", "when the pulled the curtain": a verb before its object.
    if (!ok) {
      const read = englishWordInfo(first.lower);
      ok =
        !!read &&
        !read.noun &&
        !read.adjective &&
        read.verbs.some((v) => v.form === "past" || v.form === "base") &&
        second?.kind === "word" &&
        /^(?:the|a|an|us|them|me|him|her|it|you|my|your|our|their)$/.test(second.lower) &&
        !(third?.kind === "word" && third.lower === "of");
    }
    if (!ok) continue;
    const [start, end] = m.indices!.groups!.target;
    findings.push({
      ruleId: "englishConfusedWords",
      messageKey: "review_msg_confused_word",
      range: { start, end },
      alternatives: [caseLike(target, "they")],
      context: evidence(ctx, m.index, first.end),
    });
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["englishConfusedWords"], detect: english(verbAsNoun, theForThey) },
];
