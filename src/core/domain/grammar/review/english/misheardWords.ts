import { englishInflect } from "../../implementations/helpers/EnglishInflection";
import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { Fixer } from "../../engine/reviewRules";
import { afterBreak, DETERMINERS, FUNCTION_WORDS, wordBefore } from "./slotWords";

const read = (word: string | undefined) => (word ? englishWordInfo(word.toLowerCase()) : null);
/** A base verb with no noun or adjective reading: "write", "learn", "clarify". */
const plainBase = (word: string) => {
  const r = read(word);
  return (
    !!r?.verbs.some((v) => v.form === "base" && v.lemma === word.toLowerCase()) &&
    !r.noun &&
    !r.plural &&
    !r.adjective &&
    !FUNCTION_WORDS.has(word.toLowerCase())
  );
};

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  // "The route of the problem is unknown": root (a title keeps its capitals).
  misheardWordsRoutes: (m) =>
    // Only the first letter may be a capital.
    m[0].slice(1) === m[0].slice(1).toLowerCase() ? m.groups!.target.replace(/oute/i, "oot") : null,
  // "I pic the second one", "He wanted to wright a letter": pick, write.
  misheardWordsPic: (m) =>
    ({ pic: "pick", wright: "write", rite: "write", rote: "wrote" })[
      m.groups!.target.toLowerCase() as "pic"
    ],
  // "Google dose not care", "Dose not seem right": does (not "a dose not exceeding").
  misheardWordsDose: (m, ctx) => {
    const before = wordBefore(ctx, m.index);
    if (DETERMINERS.has(before) || /^\d/.test(before) || read(before)?.adjective) return null;
    return read(m.groups!.verb)?.verbs.some((v) => v.form === "base") ? "does" : null;
  },
  // "I scrolled trough the file", "available trough Google": through.
  misheardWordsTrough: (m, ctx) => {
    const next = m.groups!.next;
    // A name after it ("trough Google"); a lowercase noun makes a compound ("trough planters").
    if (next === next.toLowerCase() && !/^(?:the|a|an|my|your|this|it|them|all)$/.test(next))
      return null;
    const before = wordBefore(ctx, m.index);
    return !before || DETERMINERS.has(before) || read(before)?.adjective ? null : "through";
  },
  // "He is of Asian decent": descent.
  misheardWordsDecent: (m) => (/^\p{Lu}\p{Ll}/u.test(m.groups!.origin) ? "descent" : null),
  // "It is my strong believe that…", "Are there different believes?": belief.
  misheardWordsBelieve: (m) => (/s$/i.test(m.groups!.target) ? "beliefs" : "belief"),
  // "It happens on the Monday nigh", "I woke at nigh": night.
  misheardWordsNigh: (m, ctx) =>
    /^[ \t ]+(?:on|unto|impossible|invincible)\b/i.test(
      ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 14),
    )
      ? null
      : "night",
  // "We have not seen him sine Monday": since.
  misheardWordsSine: (m, ctx) => (/^(?:a|the|of)$/.test(wordBefore(ctx, m.index)) ? null : "since"),
  // "Hoe does it work?", "Learn hoe to cook": how.
  misheardWordsHoe: (m, ctx) => {
    const before = wordBefore(ctx, m.index);
    return (!before && afterBreak(ctx, m.index)) ||
      /^(?:know|learn|see|ask|tell|show|wonder|explain|understand)$/.test(before)
      ? "how"
      : null;
  },
  misheardWordsBeside: (m, ctx) => (afterBreak(ctx, m.index) ? "besides" : null),
  // "Grate work!", "It's really grate.": great.
  misheardWordsGrate: (m, ctx) => {
    const lead = m.groups!.lead?.toLowerCase();
    if (lead === "a")
      return /^[ \t ]*[.!]/.test(ctx.text.slice(m.index + m[0].length)) ? null : "great";
    return lead || afterBreak(ctx, m.index) ? "great" : null;
  },
  // "I have bin there", "haven't bin told": been.
  misheardWordsBin: (m) => {
    const next = m.groups!.next.toLowerCase();
    if (
      /^(?:there|here|to|in|so|very|really|told|done|able|busy|sick|away|out|at|on|with|for|since|ill|unable|asked|a|an|the)$/.test(
        next,
      )
    )
      return "been";
    return read(next)?.verbs.some((v) => v.form === "ing" || v.form === "participle") &&
      !read(next)?.noun
      ? "been"
      : null;
  },
  // "I what have done it differently": would.
  misheardWordsWhat: (m, ctx) =>
    afterBreak(ctx, m.index) && m.groups!.next.toLowerCase() !== "you" ? "would" : null,
  // "ten minuets walking distance": minutes.
  misheardWordsMinuets: (m) => (/s$/i.test(m.groups!.target) ? "minutes" : "minute"),
  // "Deer Anne,": Dear.
  misheardWordsDeer: (m, ctx) =>
    afterBreak(ctx, m.index) && /^\p{Lu}/u.test(m.groups!.name) && m.groups!.target === "Deer"
      ? "Dear"
      : null,
  // "He diffused several bombs": defused.
  misheardWordsDiffuse: (m) => m.groups!.target.toLowerCase().replace(/^dif/, "de"),
  // "The feature is about to implemented": about to be implemented.
  misheardWordsTo: (m) => {
    const verb = m.groups!.verb.toLowerCase();
    const r = read(verb);
    const lemma = r?.verbs.find((v) => v.form === "past" || v.form === "participle")?.lemma;
    if (!lemma || r?.noun || r?.adjective || !englishInflect(lemma, "past")) return null;
    return [`to be ${verb}`, `to ${lemma}`];
  },
  // "I would like her too do it": to before a base verb.
  misheardWordsToo: (m, ctx) => {
    // "like her too do it", "decided himself too start"; "The students too realize" is also.
    const before = wordBefore(ctx, m.index);
    if (
      !/^(?:her|him|them|me|us|you|myself|himself|herself|themselves|ourselves|yourself)$/.test(
        before,
      )
    )
      return null;
    return plainBase(m.groups!.verb) || /^(?:do|start|go|be|have)$/.test(m.groups!.verb)
      ? "to"
      : null;
  },
} satisfies Record<string, Fixer>;
