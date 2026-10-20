import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { Fixer } from "../../engine/reviewRules";
import { afterBreak, nounOnly } from "./slotWords";

const MONTHS =
  /^(?:January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/;

const ing = (word: string) =>
  !!englishWordInfo(word.toLowerCase())?.verbs.some((v) => v.form === "ing");

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  prepositionSlotsFor: (m) => (ing(m.groups!.verb) ? "of" : null),
  // "By example, …", "On fact, …" at a clause start.
  prepositionSlotsBy: (m, ctx) =>
    afterBreak(ctx, m.index)
      ? /example/i.test(m.groups!.target)
        ? "for example"
        : "in fact"
      : null,
  // "their departure of New York": from a place.
  prepositionSlotsOf: (m) =>
    MONTHS.test(m.groups!.place) || !/^[A-Z]/.test(m.groups!.place) ? null : "from",
  // "Anne is waiting her patient": waiting for.
  prepositionSlotsWaiting: (m) =>
    nounOnly(m.groups!.noun) || englishWordInfo(m.groups!.noun)?.noun ? "waiting for" : null,
  // "Prior leaving, he…": prior to.
  prepositionSlotsPrior: (m) => (ing(m.groups!.verb) ? "prior to" : null),
  // "knocked the door": on.
  prepositionSlotsKnock: (m) => `${m.groups!.target} on`,
  // "located on 11056 Main Street": at an address.
  prepositionSlotsOn: (m) => (/^[A-Z]/.test(m.groups!.street) ? "at" : null),
  // "I like to do soccer", "to do a meeting": after "to" or as -ing (fixedFrames owns
  // "I do soccer", "we did a meeting" after a subject).
  prepositionSlotsDo: (m) => (m.groups!.target ? "play" : "playing"),
  prepositionSlotsDo2: (m) => {
    const party = m.groups!.what.toLowerCase() === "party";
    return m.groups!.target ? (party ? "throw" : "have") : party ? "throwing" : "having";
  },
  // "That accounts a rise in price": accounts for.
  prepositionSlotsAccounts: (m) => `${m.groups!.target} for`,
  // "returning in the office", "returning in Montreal": to.
  prepositionSlotsIn: (m) =>
    m.groups!.place && (MONTHS.test(m.groups!.place) || !/^[A-Z]/.test(m.groups!.place))
      ? null
      : "to",
  // "a trip in New York": to.
  prepositionSlotsIn2: (m) =>
    MONTHS.test(m.groups!.place) || !/^[A-Z]/.test(m.groups!.place) ? null : "to",
  // "I have 25 years old": be.
  prepositionSlotsHave: (m) =>
    /^I$/.test(m.groups!.subject) ? "am" : /^(?:he|she)$/i.test(m.groups!.subject) ? "is" : "are",
  // "non standard", "anti communist": prefixed adjectives are hyphenated.
  prepositionSlotsPrefix: (m) => {
    const read = englishWordInfo(m.groups!.word);
    const nonNoun =
      m.groups!.prefix.toLowerCase() === "non" && (read?.noun || !!nounOnly(m.groups!.word));
    return (read?.adjective || nonNoun) && !read?.verbs.some((v) => v.form !== "base")
      ? `${m.groups!.prefix}-${m.groups!.word}`
      : null;
  },
} satisfies Record<string, Fixer>;
