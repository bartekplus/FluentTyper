import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { Fixer } from "../../engine/reviewRules";
import { afterBreak, FUNCTION_WORDS, nounOnly, wordBefore } from "./slotWords";

const read = (word: string | undefined) => (word ? englishWordInfo(word.toLowerCase()) : null);
const adjectiveWord = (word: string) => !!read(word)?.adjective && !FUNCTION_WORDS.has(word);
const third = (word: string) => !!read(word)?.verbs.some((v) => v.form === "third");
const ing = (word: string) => !!read(word)?.verbs.some((v) => v.form === "ing");
const base = (word: string) => !!read(word)?.verbs.some((v) => v.form === "base");

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  // "a rally good idea", "It rally hurts": really.
  neighbourSlotsRally: (m, ctx) => {
    const next = m.groups!.next;
    // "The rally drew a crowd": after a determiner the noun is meant.
    const determiner = /^(?:the|a|an|this|that|our|their|his|her|my|your)$/.test(
      wordBefore(ctx, m.index),
    );
    return (adjectiveWord(next) && !read(next)?.noun) ||
      (third(next) && !read(next)?.noun && !determiner) ||
      /^(?:good|bad|nice|great|cool|like|want|need|appreciate|hope|is|was|hurts|helps)$/.test(next)
      ? "really"
      : null;
  },
  // "I tent to agree": tend.
  neighbourSlotsTents: (m) => (m.groups!.target.toLowerCase() === "tents" ? "tends" : "tend"),
  // "Her you go!", "Her you can see it": here.
  neighbourSlotsHer: (m, ctx) => (afterBreak(ctx, m.index) ? "here" : null),
  // "a whit horse": white.
  neighbourSlotsWhit: (m) => (m.groups!.noun !== "of" && nounOnly(m.groups!.noun) ? "white" : null),
  // "I well help you": will.
  neighbourSlotsWell: (m, ctx) => (/^as$/.test(wordBefore(ctx, m.index)) ? null : "will"),
  // "We have to new developers": two before a plural noun.
  neighbourSlotsTo: (m) => {
    if (nounOnly(m.groups!.noun) !== "plural") return null;
    const after = m.groups!.after?.trim();
    return !/^ha/i.test(m.groups!.lead) || m.groups!.adj || (after && ing(after)) ? "two" : null;
  },
  // "Yes, we cab.", "Cab you confirm?": can.
  neighbourSlotsCab: (m, ctx) => (m.groups!.target || afterBreak(ctx, m.index) ? "can" : null),
  // "I have sen you a message", "I can't sen it": sent/send.
  neighbourSlotsSen: (m) => (/^ha/i.test(m.groups!.lead) ? "sent" : "send"),
  // "She posses a car", "will posses": possess.
  neighbourSlotsPosses: (m) => (/^(?:he|she|it)$/i.test(m.groups!.lead) ? "possesses" : "possess"),
  // "Would yo do it?", "What do yo think?": you.
  neighbourSlotsYo: (m) => (base(m.groups!.verb) || ing(m.groups!.verb) ? "you" : null),
  // "Turn of the TV", "The light was switched of": off.
  neighbourSlotsOf: (m, ctx) => (/^(?:the|a|an)$/.test(wordBefore(ctx, m.index)) ? null : "off"),
  neighbourSlotsOf2: (m, ctx) =>
    afterBreak(ctx, m.index) || wordBefore(ctx, m.index) === "please" ? "off" : null,
  // "I am all ready doing it": already.
  neighbourSlotsAll: (m) => (ing(m.groups!.next) && !read(m.groups!.next)?.noun ? "already" : null),
  // "Shell we dance?", "We shell overcome": shall.
  neighbourSlotsShell: (m, ctx) =>
    m.groups!.target
      ? afterBreak(ctx, m.index)
        ? "shall"
        : null
      : base(m.groups!.verb)
        ? "shall"
        : null,
  // "Do not chance these settings": change.
  neighbourSlotsChances: (m) =>
    m.groups!.target.toLowerCase() === "chances" ? "changes" : "change",
  // "Al other prices": all.
  neighbourSlotsAl: (m, ctx) => (afterBreak(ctx, m.index) ? "all" : null),
  // "I'd like to know hwy this fails": why.
  neighbourSlotsHwy: (m, ctx) => (m.groups!.target || afterBreak(ctx, m.index) ? "why" : null),
  // "Tom is my college and friend", "My colleges and I": colleague.
  neighbourSlotsColleges: (m) => (/s$/i.test(m.groups!.target) ? "colleagues" : "colleague"),
  // "It was really had to do": hard.
  neighbourSlotsHad: (m) => (base(m.groups!.verb) ? "hard" : null),
  // "almost ell editors": all.
  neighbourSlotsEll: (m) =>
    nounOnly(m.groups!.next) === "plural" || adjectiveWord(m.groups!.next) ? "all" : null,
  // "Their elicit behavior": illicit.
  neighbourSlotsElicit: (m) =>
    nounOnly(m.groups!.noun) || read(m.groups!.noun)?.noun ? "illicit" : null,
} satisfies Record<string, Fixer>;
