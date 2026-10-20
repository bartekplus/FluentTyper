import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { Fixer } from "../../engine/reviewRules";
import { afterBreak, FUNCTION_WORDS, wordBefore } from "./slotWords";

const adjectiveOnly = (word: string) => {
  const read = englishWordInfo(word.toLowerCase());
  return !!read?.adjective;
};
const verbBase = (word: string) =>
  !!englishWordInfo(word.toLowerCase())?.verbs.some((v) => v.form === "base");

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  // "Wed gone so far", "wed love to": we'd.
  typoSlotsWed: (m, ctx) =>
    afterBreak(ctx, m.index) || /^(?:and|but|so|then|actually)$/.test(wordBefore(ctx, m.index))
      ? "we'd"
      : null,
  // "Whose at the door?", "Whose the boss here?": who's.
  typoSlotsWhose: (m, ctx) => (afterBreak(ctx, m.index) ? "who's" : null),
  // "Hell be there": he'll.
  typoSlotsHell: (m, ctx) =>
    afterBreak(ctx, m.index) || /^(?:and|but|so|then)$/.test(wordBefore(ctx, m.index))
      ? "he'll"
      : null,
  // "Th water is hot": the.
  typoSlotsTh: (m, ctx) => {
    const read = englishWordInfo(m.groups!.next);
    return afterBreak(ctx, m.index) &&
      !!read?.noun &&
      !read.adverb &&
      !read.adjective &&
      !read.verbs.some((v) => v.form !== "base") &&
      !FUNCTION_WORDS.has(m.groups!.next)
      ? "the"
      : null;
  },
  // "My life as gotten busier": has.
  typoSlotsAs: (m) => (FUNCTION_WORDS.has(m.groups!.lead.toLowerCase()) ? null : "has"),
  // "A lot of vary happy people": very.
  typoSlotsVary: (m) => (adjectiveOnly(m.groups!.adj) ? "very" : null),
  // "The heart sill pumped", "I'm sill looking": still.
  typoSlotsSill: (m) => {
    const read = englishWordInfo(m.groups!.next);
    return /^(?:not|here|there|alive|working|waiting|looking|open)$/.test(m.groups!.next) ||
      read?.verbs.some((v) => v.form === "ing" || v.form === "past")
      ? "still"
      : null;
  },
  // "Too twenty-three students", "increases too 1000's": to before a count.
  typoSlotsToo: (m, ctx) =>
    // "It's too 1990's for me": a decade as a predicate.
    /^(?:me|you|us|them|him|her|it|is|was|it['’]s|that['’]s|so|be)$/.test(wordBefore(ctx, m.index))
      ? null
      : "to",
  // "Ur a nice guy": you're.
  typoSlotsUr: (m, ctx) => (afterBreak(ctx, m.index) ? "you're" : null),
  // "You mus see it", "Mus you go?": must.
  typoSlotsMus: (m, ctx) =>
    m.groups!.target
      ? verbBase(m.groups!.verb)
        ? "must"
        : null
      : afterBreak(ctx, m.index)
        ? { alternatives: ["must"], range: [m.index, m.index + 3] }
        : null,
  // "Look the door behind you": lock.
  typoSlotsLook: (m) => m.groups!.target.toLowerCase().replace("look", "lock"),
  // "How is your teacher like?": what … like.
  typoSlotsHow: (m, ctx) => (afterBreak(ctx, m.index) ? "what" : null),
  // "Cold her father hear him?", "This cold be true": could.
  typoSlotsCold: (m, ctx) =>
    m.groups!.target
      ? "could"
      : afterBreak(ctx, m.index)
        ? { alternatives: ["could"], range: [m.index, m.index + 4] }
        : null,
  // "What ca I do?", "You ca do it!": can.
  typoSlotsCa: (m) => (m.groups!.target === "CA" ? null : "can"),
  // "Them it became clear", "Than it became clear": then.
  typoSlotsThem: (m, ctx) => {
    if (!afterBreak(ctx, m.index) || m.groups!.target[0] !== m.groups!.target[0].toUpperCase())
      return null;
    const read = englishWordInfo(m.groups!.verb);
    return read?.verbs.some((v) => v.form !== "base") ||
      /^(?:will|would|can|could)$/.test(m.groups!.verb)
      ? "then"
      : null;
  },
} satisfies Record<string, Fixer>;
