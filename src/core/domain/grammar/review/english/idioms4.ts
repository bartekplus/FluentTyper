import { englishWordInfo, hasVerbForm } from "../../implementations/helpers/EnglishLexicon";
import type { Fixer } from "../../engine/reviewRules";

/**
 * The start of a sentence or line, an opening quote allowed. Frames check their word first
 * (`(?=word)`): tried at every position of a long run of spaces, this lookbehind rereads the
 * run each time in JavaScriptCore.
 */
const SENTENCE = `(?<=(?:^|[.!?\\n]["”’)]{0,3})[ \\t\\u00a0]{0,8}["“'‘(]?)`;
const DETERMINER =
  "the|a|an|this|that|these|those|my|your|his|her|its|our|their|some|any|all|every|each";
const OBJECT = new Set(
  `${DETERMINER}|it|them|me|him|us|you`.split("|").map((word) => word.toLowerCase()),
);
const SUBJECT_START = new Set(
  `${DETERMINER}|it|you|we|they|he|she|i|there|many|most|no|both|nobody|nothing|everyone|everybody|everything|someone|somebody|something|anyone|anybody|anything`.split(
    "|",
  ),
);
// Words after "in demand" / "in depth" that close the phrase instead of naming a noun.
const NOT_MODIFIED =
  /^(?:by|today|these|those|this|that|now|nowadays|than|as|and|or|but|in|on|at|for|to|of|with|right|here|there|again|too|also|lately|recently|since|during|among|across|everywhere|worldwide|anymore|yet|then|when|while|because|if)$/i;
const capitalized = (word: string) => /^\p{Lu}/u.test(word);
const MAKE: Record<string, string> = {
  do: "make",
  does: "makes",
  did: "made",
  doing: "making",
  done: "made",
};
const GO: Record<string, string> = {
  become: "go",
  becomes: "goes",
  became: "went",
  becoming: "going",
};
const OURS: Record<string, string> = {
  me: "mine",
  you: "yours",
  us: "ours",
  him: "his",
  them: "theirs",
};
// "how come", "how dare you" and "how people…" are not a missing "to".
// Auxiliaries open a question ("How have these changes helped?"), not a how-to.
const NOT_HOW_TO = new Set(
  "come dare do does did go people be say mean will can may might must shall should would could have has had".split(
    " ",
  ),
);

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  makeMistake: (m) => MAKE[m.groups!.target.toLowerCase()],
  friendOfMine: (m) => OURS[m.groups!.target.toLowerCase()],
  goSoFarAs: (m) => {
    const next = m.groups!.next;
    return /^(?:even|actually|really|just|literally|also)$/i.test(next) ||
      englishWordInfo(next)?.adverb ||
      (hasVerbForm(next, "base") && !OBJECT.has(next.toLowerCase()))
      ? "as to"
      : null;
  },
  handfulMore: (m) => {
    const next = englishWordInfo(m.groups!.next);
    return next && !next.noun && !next.plural ? null : "";
  },
  hardTime: (m) => {
    const typed = m.groups!.target;
    const an = /^[aeiou]/i.test(typed) ? "an" : "a";
    return `${typed === typed.toUpperCase() ? an.toUpperCase() : an} ${typed}`;
  },
  haloHello: (m) => (m.groups!.name && !capitalized(m.groups!.name) ? null : "hello"),
  inFavorOf: (m) => (hasVerbForm(m.groups!.ing, "ing") ? `${m.groups!.word} of ` : null),
  looksLikeThat: (m) => {
    const next = m.groups!.next;
    return SUBJECT_START.has(next.toLowerCase()) ||
      capitalized(next) ||
      (hasVerbForm(next, "ing") && !englishWordInfo(next)?.noun)
      ? ""
      : null;
  },
  itWouldBe: (m) => {
    if (m[0] === m[0].toUpperCase()) return "IT";
    const sentenceStart = new RegExp(SENTENCE, "uy");
    sentenceStart.lastIndex = m.index;
    return sentenceStart.test(m.input) ? "It" : "it";
  },
  lookDownNose: (m) => `${m.groups!.verb} down ${m.groups!.owner} ${m.groups!.nose}`,
  ifHadHave: (m) => {
    const done = m.groups!.done.toLowerCase();
    if (done !== "been" && !hasVerbForm(done, "participle")) return null;
    // "would not have known" -> "had not known"; "wouldn't have" -> "hadn't".
    const not = m.groups!.not;
    return not ? (/n['’]t/i.test(not) ? `hadn${not.match(/['’]/)![0]}t` : "had not") : "had";
  },
  howToVerb: (m) => {
    const { target, next } = m.groups!;
    const verb = englishWordInfo(target);
    if (
      capitalized(target) ||
      NOT_HOW_TO.has(target.toLowerCase()) ||
      !verb?.verbs.some((v) => v.form === "base") ||
      verb.adjective ||
      verb.adverb
    )
      return null;
    const object = englishWordInfo(next);
    return OBJECT.has(next.toLowerCase()) ||
      capitalized(next) ||
      hasVerbForm(next, "ing") ||
      // "how form submissions are…": a noun before a noun is a compound subject.
      (!verb.noun && (object ? object.noun && !object.verbs.length : next.length > 5))
      ? `to ${target}`
      : null;
  },
  itsAdjective: (m) => {
    const word = englishWordInfo(m.groups!.adjective);
    // "its largest to date", "its lowest since 1994": a superlative names its own thing.
    const superlative = /(?:est|^most|^least|^only)$/i.test(m.groups!.adjective);
    return word?.adjective && !word.noun && !word.verbs.length && !superlative ? "it's" : null;
  },
  fullyFleshedOut: (m) => [`fully${m.groups!.joint}fledged`, `fully${m.groups!.joint}fleshed out`],
  inDepthNoun: (m) => {
    const word = m.groups!.next;
    const next = englishWordInfo(word);
    if (
      NOT_MODIFIED.test(word) ||
      (next ? next.adverb || !(next.noun || next.adjective) : word.length < 6)
    )
      return null;
    return `in-${m.groups!.noun.toLowerCase()}`;
  },
  becomeMissing: (m) => GO[m.groups!.target.toLowerCase()],
  implementInto: (m) => (capitalized(m.groups!.target) ? null : "in"),
} satisfies Record<string, Fixer>;
