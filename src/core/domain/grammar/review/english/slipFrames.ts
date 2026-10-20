import {
  englishLexiconInflect,
  englishWordInfo,
} from "../../implementations/helpers/EnglishLexicon";
import type { DetectContext } from "../reviewDetectors";
import type { Fixer } from "../../engine/reviewRules";
import { nounNumber } from "./nounNumberSlots";
import { afterBreak, FUNCTION_WORDS, nounOnly, tokensAfter, wordBefore } from "./slotWords";

const read = (word: string | undefined) => (word ? englishWordInfo(word.toLowerCase()) : null);
/** An adjective with no noun or verb reading: "significant", "unable", "toxic". */
const adjectiveOnly = (word: string) => {
  const r = read(word);
  return !!r?.adjective && !r.noun && !r.verbs.length && !r.adverb && !FUNCTION_WORDS.has(word);
};
/** A word whose readings are all base-form verbs: "walk", "enter", "provide". */
const baseVerb = (word: string) => {
  const r = read(word);
  return (
    !!r?.verbs.length &&
    r.verbs.every((v) => v.form === "base") &&
    !r.adjective &&
    !FUNCTION_WORDS.has(word.toLowerCase())
  );
};
const third = (word: string) => {
  const lower = word.toLowerCase();
  const form = englishLexiconInflect(lower, "third");
  if (form) return form;
  if (/[^aeiou]y$/.test(lower)) return `${lower.slice(0, -1)}ies`;
  return /(?:s|x|z|ch|sh|o)$/.test(lower) ? `${lower}es` : `${lower}s`;
};
const TOO_DEGREE =
  "fast|soon|late|early|slowly|quickly|much|many|long|far|big|small|hard|easy|busy|tired|young|old|expensive|cheap|close|high|low|loud|hot|cold";
const MOTION =
  /^(?:drove|drive|drives|driving|ran|run|runs|went|go|goes|came|come|comes|got|get|gets)$/;
// "Can anybody else check it?": a subject after an auxiliary keeps the base.
const AUX_BEFORE =
  /^(?:can|could|will|would|should|shall|may|might|must|did|does|do|to|let|make|help|have|had)$/;

// Nouns "it's" takes as a predicate: "it's time", "it's fun", "it's times like these".
const ITS_PREDICATES = new Set(
  "time times fun okay ok love home work money business nonsense lunchtime bedtime midnight noon news thanks lots tons days years hours minutes weeks months ages me him her us them dinner lunch breakfast supper tea none".split(
    " ",
  ),
);
// Verbs that take a clause: "I think it's time", "said it's done".
const CLAUSE_VERBS = new Set(
  "think thinks thought thinking know knew knows guess guessing believe believes hope hopes hoping say says said saying feel feels felt mean means meant suppose see saw hear heard find found realize realise notice wish bet seem seems seemed figure assume understand admit agree claim show shows showed prove read learn learned remember forget check decide ensure doubt explain imagine swear promise expect reckon worry tell told sure glad sorry afraid".split(
    " ",
  ),
);
const FINITE =
  /^(?:is|are|was|were|has|have|had|will|would|can|could|should|may|might|must|does|did|isn['’]t|wasn['’]t|doesn['’]t|didn['’]t|won['’]t|can['’]t)$/;

/** A noun word after "it's" that is no predicate: no adjective, -ing or participle reading. */
function ownedNoun(word: string): "singular" | "plural" | null {
  if (
    FUNCTION_WORDS.has(word) ||
    ITS_PREDICATES.has(word) ||
    /^(?:some|any|no|every)(?:thing|one|body|where)$/.test(word)
  )
    return null;
  const r = read(word);
  if (!r) return nounOnly(word);
  if (r.adjective || r.adverb || r.verbs.some((v) => v.form !== "base" && v.form !== "third"))
    return null;
  return r.plural ? "plural" : r.noun ? "singular" : null;
}

/** "it's" is the possessive: a plural noun, a noun phrase before its verb, or an object. */
function itsOwner(ctx: DetectContext, m: RegExpExecArray): boolean {
  const [, end] = m.indices!.groups!.target;
  const tokens = tokensAfter(ctx, end, 5);
  const word = (k: number) =>
    tokens[k]?.kind === "word" && tokens[k].text === tokens[k].lower ? tokens[k].lower : "";
  const first = ownedNoun(word(0));
  // "The team and it's members", "it's features include". At a clause start a verb must follow:
  // "It's beans on toast", "it's mains powered" are predicates.
  const verbAfter = (k: number) => {
    const r = read(word(k));
    return (
      FINITE.test(word(k)) ||
      // "it's password protected": a participle is a predicate.
      (!!r?.verbs.some((v) => v.form === "past" || v.form === "third") &&
        !r.verbs.some((v) => v.form === "participle") &&
        !r.noun &&
        !r.adjective)
    );
  };
  if (first === "plural" && (verbAfter(1) || !afterBreak(ctx, m.index))) {
    const r = read(word(1));
    if (!r?.adjective && !/ed$/.test(word(1))) return true;
  }
  // "when it's state is changed", "it's death rate is higher", "it's primary function seems".
  for (let k = 0; k < 3; k++) {
    const w = word(k);
    const modifier =
      k === 0 ? !!first || ATTRIBUTIVE.test(w) : !!ownedNoun(w) || !!read(w)?.adjective;
    if (!w || !modifier) break;
    const head = ownedNoun(w) || (k > 0 && read(w)?.noun);
    if (head && verbAfter(k + 1)) return true;
  }
  const before = wordBefore(ctx, m.index);
  // "amid it's noise", "for all it's charm": no contraction follows a preposition.
  if (
    (first || ATTRIBUTIVE.test(word(0))) &&
    (/^(?:amid|alongside|beside|beyond|across|behind|inside|outside|throughout|upon|unlike|via|around|near)$/.test(
      before,
    ) ||
      /\bfor[ \t ]+all[ \t ]+$/i.test(ctx.text.slice(Math.max(0, m.index - 12), m.index)))
  )
    return true;
  // "filter it's content", "what is it's parent": an object or a predicate noun after a verb.
  if (!first || CLAUSE_VERBS.has(before)) return false;
  if (/^(?:is|was)$/.test(before)) return true;
  const verb = read(before);
  if (!before || FUNCTION_WORDS.has(before) || !verb?.verbs.length || verb.adjective) return false;
  // A verb that is also a noun needs a modal, "to" or a pronoun before it ("should filter").
  return (
    !verb.noun ||
    /(?:^|[^\p{L}'’])(?:to|will|would|should|could|can|must|may|might|do|does|did|i|you|we|they|he|she|not|never|please)[ \t ]+\p{L}+[ \t ]+$/iu.test(
      ctx.text.slice(Math.max(0, m.index - 40), m.index),
    )
  );
}
// Adjectives that only modify a noun: "it's main rival" is "its main rival".
const ATTRIBUTIVE =
  /^(?:main|primary|latest|only|entire|whole|original|overall|former|sole|chief|principal|own|previous|current)$/;

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  // "I drove to fast", "came much to soon", "far to novice to win": too.
  slipFramesTo: (m) => {
    const adj = m.groups!.adj.toLowerCase();
    const lead = m.groups!.lead.toLowerCase();
    // "Did it come to much?", "go to just": an idiom or an adverb after a motion verb.
    const motion = MOTION.test(lead);
    if (/^(?:much|many)$/.test(adj)) return motion ? null : "too";
    if (new RegExp(`^(?:${TOO_DEGREE})$`).test(adj)) return "too";
    if (motion) return null;
    const r = read(adj);
    // "It's to interesting to turn…": an adjective with no base-verb reading ("was to trying
    // to" keeps its -ing verb).
    if (/ing$/.test(adj) && !/['’]s$/.test(lead)) return null;
    return r?.adjective && !r.noun && !r.adverb && !r.verbs.some((v) => v.form === "base")
      ? "too"
      : null;
  },
  // "There is not fast way", "has not knowledge of": no before a noun phrase.
  slipFramesNot: (m) => {
    const { adj, noun } = m.groups!;
    return adjectiveOnly(adj) && (read(noun)?.noun || nounOnly(noun)) ? "no" : null;
  },
  slipFramesNot2: (m) => {
    const noun = m.groups!.noun;
    if (FUNCTION_WORDS.has(noun)) return null;
    const r = read(noun);
    return (r ? r.noun && !r.verbs.length && !r.adjective : nounOnly(noun)) ? "no" : null;
  },
  // "more than a 100 countries", "After a two months": no article before a count.
  slipFramesAn: (m, ctx) => {
    const noun = m.groups!.noun;
    const plural =
      nounNumber(noun)?.number === "plural" || nounOnly(noun) === "plural" || noun === "months";
    if (!plural || /^(?:percent|times)$/.test(noun)) return null;
    // "a ten minutes walk", "a 74 years old": the plural modifies what follows; only a
    // closed word or the clause end shows it is the head.
    const rest = ctx.text.slice(m.index + m[0].length);
    const next = /^[ \t\u00a0]+([a-z]+)/i.exec(rest)?.[1].toLowerCase();
    const closes = /^[ \t\u00a0]*(?:[.,;:!?)]|$)/.test(rest);
    // "a seven nights or more package"; "worth a 1000 words" reads "a thousand".
    const orSo = /^[ \t\u00a0]+or[ \t\u00a0]+so\b/i.test(rest);
    if ((!orSo && /^(?:or|and|old|long)$/.test(next ?? "")) || wordBefore(ctx, m.index) === "worth")
      return null;
    return closes || orSo || (next && FUNCTION_WORDS.has(next)) ? m.groups!.num : null;
  },
  // "Someone else walk to the store": an -s verb after an indefinite pronoun.
  slipFramesA: (m, ctx) =>
    baseVerb(m.groups!.target) && !AUX_BEFORE.test(wordBefore(ctx, m.index))
      ? [third(m.groups!.target)]
      : null,
  // "He going crazy.": a progressive with no be.
  slipFramesPron: (m, ctx) => {
    if (!afterBreak(ctx, m.index)) return null;
    const r = read(m.groups!.verb);
    if (!r?.verbs.some((v) => v.form === "ing")) return null;
    return `${m.groups!.pron} is ${m.groups!.verb}`;
  },
  // "If its toxic then…", "that its working in…", "Its 2 p.m.": it's.
  slipFramesIts: (m, ctx) => {
    const { adj, ing } = m.groups!;
    const lead = wordBefore(ctx, m.index);
    if (
      adj &&
      !(
        read(adj)?.adjective &&
        !read(adj)?.noun &&
        !read(adj)?.verbs.length &&
        /^(?:if|that|because|when|while|since|so|but|and)$/.test(lead)
      )
    )
      return null;
    if (ing) {
      // "However, its copying in later texts": a possessive before a gerund.
      const r = read(ing);
      if (!r?.verbs.some((v) => v.form === "ing") || r.noun) return null;
      // "since its founding in 1859": since is a preposition there.
      if (!/^(?:if|that|because|when|while|so|but|and)$/.test(lead)) return null;
    }
    return "it's";
  },
  // "As usual, the will provide details", "The really would like…": they.
  slipFramesThe: (m) => {
    const verb = m.groups!.verb;
    if (verb && !baseVerb(verb)) return null;
    // "The Don't Quit Podcast": a title.
    return /[A-Z]/.test(m[0].slice(4)) ? null : "they";
  },
  // "I really should by Google stock", "will by network ready": buy or be.
  slipFramesBy: (m) => {
    const next = m.groups!.next;
    // "Uncle Zebulon's Will by Magnus": a capitalized noun.
    if (/^[A-Z]/.test(m[0])) return null;
    if (/^(?:up|via|[0-9(])/i.test(next)) return ["buy", "be"];
    if (/^[A-Z]/.test(next))
      return /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December|Christmas|then|now)$/i.test(
        next,
      )
        ? null
        : ["buy", "be"];
    if (next === "why") return ["be", "buy"];
    return adjectiveOnly(next) ? ["be", "buy"] : null;
  },
  // "if it worse", "it safe to say", "she unable to read": the be is missing.
  slipFramesPron2: (m, ctx) => {
    const lead = wordBefore(ctx, m.index);
    if (
      !afterBreak(ctx, m.index) &&
      !/^(?:if|whether|as|because|since|that|so|but|and|when|rate|starts)$/.test(lead)
    )
      return null;
    return `${m.groups!.pron} is ${m.groups!.adj}`;
  },
  // "It would cool if…", "we will significant benefits": the modal lacks be/have.
  slipFramesA2: (m) => {
    const { target, after } = m.groups!;
    // "would sooner die", "can cheap out", "will cool to 71": comparatives, particles, verbs.
    if (/^(?:likely|sooner|rather|better|best|worse|soon|later)$/.test(target)) return null;
    if (/^[ \t\u00a0]+(?:out|up|off|down|over)\b/.test(after)) return null;
    // Predicate-only adjectives take no noun after them: "be alone", never "have alone".
    if (/^(?:afraid|asleep)$/.test(target)) return `be ${target}`;
    const adjective =
      adjectiveOnly(target) || (target === "cool" && /^[ \t\u00a0]*(?:[.,!?]|if)/.test(after));
    if (!adjective) return null;
    const noun = after.trim().replace(/^[^a-z]+/, "");
    // "I would sure like to find it": an informal adverb sure before the verb.
    if (target === "sure" && read(noun)?.verbs.some((v) => v.form === "base")) return null;
    const before = noun && (read(noun)?.noun || nounOnly(noun)) && !FUNCTION_WORDS.has(noun);
    return before ? [`be ${target}`, `have ${target}`] : `be ${target}`;
  },
  // "These kind of errors": this kind / these kinds.
  slipFramesDem: (m) => {
    const { dem, kind } = m.groups!;
    const one = /^these$/i.test(dem) ? "this" : "that";
    const single = /^[A-Z]/.test(dem) ? one[0].toUpperCase() + one.slice(1) : one;
    return [`${single} ${kind}`, `${dem} ${kind}s`];
  },
  // "Your order is requires approval", "It is tastes good": be before an -s verb.
  slipFramesIs: (m, ctx) => {
    const verb = m.groups!.verb.toLowerCase();
    // "IS has" (a name), "the are has" (the unit), "the product there is contains".
    if (/^(?:has|does|was|is)$/.test(verb) || !/^[a-z]/.test(m[0])) return null;
    if (/^(?:the|a|an|there|here)$/.test(wordBefore(ctx, m.index))) return null;
    const r = read(verb);
    const linking = /^(?:tastes|looks|sounds|smells|feels|seems)$/.test(verb);
    if (
      !r?.verbs.some((v) => v.form === "third") ||
      (!linking && (r.noun || r.plural || r.adjective))
    )
      return null;
    // "What it is means…": a pseudo-cleft.
    if (
      /\b(?:what|whatever|all)\b[^.!?;:\n]*$/i.test(
        ctx.text.slice(Math.max(0, m.index - 48), m.index),
      )
    )
      return null;
    return `${m.groups!.adverb ?? ""}${m.groups!.verb}`;
  },
  // "I have than signed it", "you can than forward it": then after an auxiliary.
  slipFramesThan: (m) =>
    read(m.groups!.verb)?.verbs.length && !FUNCTION_WORDS.has(m.groups!.verb.toLowerCase())
      ? "then"
      : null,
  // "Send it to out team", "the link to out dashboard": our before a noun.
  slipFramesOut: (m) => {
    const noun = m.groups!.noun.toLowerCase();
    if (FUNCTION_WORDS.has(noun) || noun !== m.groups!.noun) return null;
    const r = read(noun);
    // "to out someone" is the verb before a name or pronoun; a noun or unknown word is owned.
    return r ? (r.noun && !r.adverb && !r.adjective ? "our" : null) : nounOnly(noun) ? "our" : null;
  },
  // "The team and it's members", "when it's state is changed", "filter it's content": a noun
  // after "it's" that only the possessive explains.
  slipFramesIt: (m, ctx) => (itsOwner(ctx, m) ? "its" : null),
  // "my big begs", "a grocery beg": bag.
  slipFramesBegs: (m) => (m.groups!.target.toLowerCase() === "begs" ? "bags" : "bag"),
} satisfies Record<string, Fixer>;
