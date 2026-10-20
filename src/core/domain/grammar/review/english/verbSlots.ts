import { englishInflect, englishLemma } from "../../implementations/helpers/EnglishInflection";
import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { DetectContext } from "../reviewDetectors";
import type { Fixer } from "../../engine/reviewRules";
import { participle } from "./realWordFrames";
import { afterBreak, FUNCTION_WORDS, tokensAfter, wordBefore } from "./slotWords";

const read = (word: string | undefined) => (word ? englishWordInfo(word.toLowerCase()) : null);
const lower = (word: string | undefined) => (word ?? "").toLowerCase();
/** The lemma of a verb-only -s, past or -ing form ("means", "forgot", "squealing"), or null. */
function nonBase(word: string, forms: readonly string[] = ["third", "past", "ing"]): string | null {
  const w = lower(word);
  const r = read(w);
  if (!r || FUNCTION_WORDS.has(w) || r.noun || r.plural || r.adjective || r.adverb) return null;
  if (r.verbs.some((v) => v.form === "base")) return null;
  const form = r.verbs.find((v) => forms.includes(v.form));
  if (!form || !r.verbs.every((v) => v.lemma === form.lemma) || form.lemma === "be") return null;
  return form.lemma;
}
/** A base verb ("make", "win", "believe"), perhaps also a noun, never an adjective. */
const baseVerb = (word: string) => {
  const w = lower(word);
  const r = read(w);
  return (
    !!r?.verbs.some((v) => v.form === "base" && v.lemma === w) &&
    !r.adjective &&
    !r.plural &&
    !FUNCTION_WORDS.has(w)
  );
};
const third = (verb: string) => englishInflect(lower(verb), "third");
const OBJECT =
  /^(?:the|a|an|my|your|his|her|our|their|its|this|that|these|those|it|them|him|me|us|you|some|any|no|all|every|each)$/;
/** The next word after the match, lowercased, or "" at punctuation. */
const nextWord = (ctx: DetectContext, end: number) => {
  const token = tokensAfter(ctx, end, 1)[0];
  return token?.kind === "word" ? token.lower : "";
};

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  // "It doesn't necessarily means that", "I usually do not forgot", "Didn't there used to":
  // a negative do takes the base form.
  verbSlotsA: (m, ctx) => {
    const lemma = nonBase(m.groups!.target);
    // "works (or doesn't, depending on…)": a do with no subject ends its clause.
    if (/ing$/.test(m.groups!.target) && /^(?:or|and|but|nor)$/.test(wordBefore(ctx, m.index)))
      return null;
    return lemma && lemma !== "do" ? lemma : null;
  },
  // "Peter did went", "Tom does drinks wine" stay with the verb-group check; "would found
  // their own styles" is found. A modal before a past form: "will based on", "can made".
  verbSlotsA2: (m, ctx) => {
    const word = lower(m.groups!.target);
    const modal = m.groups!.modal;
    if (modal !== lower(modal)) return null;
    const before = wordBefore(ctx, m.index);
    // Pronoun and noun subjects belong to the auxiliary check; here only a gerund subject
    // ("Pricing will based on") or a code ("AB 45x will heard") before the modal. "the will
    // made by", "a tin can opened": a noun modal stays.
    if (
      (!/ing$/.test(before) || !/^(?:will|would|should|could)$/.test(modal)) &&
      (before !== "" || afterBreak(ctx, m.index))
    )
      return null;
    const lemma = nonBase(word, ["past", "participle"]);
    if (!lemma) return null;
    return [lemma, `be ${word}`];
  },
  // "Can anyone lists the factors", "how can I monitoring it", "Can Tom sent it": a modal's
  // inverted subject takes the base.
  verbSlotsA3: (m, ctx) => {
    const subject = m.groups!.subject;
    // A name ("Can Tom sent it") or a listed pronoun; the clause-start question belongs to
    // the auxiliary check.
    if (
      !/^(?:I|you|we|they|he|she|it|this|anyone|anybody|someone|somebody|everyone)$/i.test(
        subject,
      ) &&
      !/^[A-Z][a-z]+$/.test(subject)
    )
      return null;
    // "Will Smith played…": a capitalized modal before a name must open a question.
    if (
      /^[A-Z]/.test(m[0]) &&
      /^[A-Z][a-z]+$/.test(subject) &&
      !/^[^.!?]*\?/.test(ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 200))
    )
      return null;
    const lead = ctx.text.slice(Math.max(0, m.index - 24), m.index);
    if (
      /(?:^|[.!?:;\n])[ \t\u00a0"“]*(?:(?:how|what|why|when|where|who)[ \t\u00a0]+)?$/i.test(
        lead,
      ) &&
      /^(?:I|you|we|they|he|she|it|this)$/i.test(subject)
    )
      return null;
    // "would this pricing change": this before an -ing noun.
    if (/^this$/i.test(subject) && /ing$/i.test(m.groups!.target)) return null;
    // "It will he turned on", "The door will he locked": a subject before the modal, so no
    // inversion ("he" is "be").
    const owner = wordBefore(ctx, m.index);
    if (
      /^(?:i|you|we|they|he|she|it|this|that)$/.test(owner) ||
      (!FUNCTION_WORDS.has(owner) &&
        !!read(owner)?.noun &&
        !/^(?:then|only|so|nor|why|how|when|where|what)$/.test(owner))
    )
      return null;
    // "Can anyone involved in it comment?", "Can someone using Linux help?": a participle
    // after an indefinite pronoun can open a reduced relative clause.
    if (/^(?:any|some|every)(?:one|body)$/i.test(subject))
      return (
        nonBase(m.groups!.target, ["third"]) ??
        (read(m.groups!.target)?.verbs.some((v) => v.form === "participle")
          ? null
          : nonBase(m.groups!.target, ["past"]))
      );
    return nonBase(m.groups!.target);
  },
  // "if it make sense", "I hope it win", "sources it believe to be reliable": it + base.
  verbSlotsA4: (m, ctx) => {
    const word = m.groups!.target;
    if (
      word !== lower(word) ||
      !baseVerb(word) ||
      /^(?:please|thank|need|dare|ought)$/.test(word) ||
      // "it cost us a lot", "it hit me": a past form like its base.
      read(word)?.verbs.some((v) => v.form === "past")
    )
      return null;
    const before = wordBefore(ctx, m.index);
    // After a verb, it is an object: "let it go", "make it work", "call it home".
    const opens =
      (!before && afterBreak(ctx, m.index)) ||
      /^(?:that|if|when|because|so|and|but|since|while|where|which|whether|hope|hoping|think|guess|believe|said|says|me|for)$/.test(
        before,
      ) ||
      (!!read(before)?.noun && !read(before)?.verbs.length && !FUNCTION_WORDS.has(before));
    if (!opens) return null;
    // "It is vital that it run on time": a mandative subjunctive keeps the base.
    if (
      before === "that" &&
      /\b(?:vital|essential|important|necessary|crucial|imperative|requir\w*|insist\w*|demand\w*|recommend\w*|suggest\w*|propos\w*|ask\w*)\b[^.!?]*$/i.test(
        ctx.text.slice(Math.max(0, m.index - 60), m.index),
      )
    )
      return null;
    const next = nextWord(ctx, m.index + m[0].length);
    // The verb needs its own complement: an object, "to" or a particle.
    if (!(OBJECT.test(next) || /^(?:to|sense|up|out|on|off|in|well|so)$/.test(next))) return null;
    return third(word);
  },
  // "If the United States try to…", "until the US get…": one country.
  verbSlotsA5: (m, ctx) => {
    if (!/^(?:United[ \t ]+States|US|U\.S\.)$/.test(m.groups!.name)) return null;
    const word = m.groups!.target;
    if (word === "do") return "does";
    const next = nextWord(ctx, m.index + m[0].length);
    // "the United States upset the Cubans": a past form like its base.
    if (read(word)?.verbs.some((v) => v.form === "past")) return null;
    return baseVerb(word) && (OBJECT.test(next) || /^(?:to|not|full|in|on|out|up)$/.test(next))
      ? third(word)
      : null;
  },
  // "It visits a website and perform two actions": the second verb of the pair agrees too.
  verbSlotsA6: (m, ctx) => {
    const first = lower(m.groups!.first);
    const r = read(first);
    if (!r?.verbs.some((v) => v.form === "third") || r.adjective) return null;
    // "visits" is a plural noun too: then a singular subject must come right before it.
    if (
      (r.noun || r.plural) &&
      !/^(?:it|he|she|this|that|who|which)$/.test(wordBefore(ctx, m.index))
    )
      return null;
    // "makes us laugh and cry", "wants you to stay and help": a bare or to-infinitive pair.
    if (
      /^(?:makes|lets|helps|has|does|wants|needs|tries|seems|sees|hears|watches|goes|comes)$/.test(
        first,
      )
    )
      return null;
    const middle = lower(m.groups!.middle)
      .trim()
      .split(/[ \t ]+/);
    if (
      middle.some(
        (w) =>
          /^(?:to|i|you|we|they|he|she|who|which|that|if|when|will|would|can|could|should|must|may|might|or|but|as|than|is|are|was|were)$/.test(
            w,
          ) ||
          (!!read(w)?.verbs.some((v) => v.form !== "base" && v.form !== "participle") &&
            !read(w)?.noun),
      )
    )
      return null;
    const word = m.groups!.target;
    if (word !== lower(word) || !baseVerb(word)) return null;
    const next = nextWord(ctx, m.index + m[0].length);
    if (read(word)?.noun && !OBJECT.test(next)) return null;
    // The subject must be third person: not "they visits", which has its own error.
    const subject = /([A-Za-z]+)[ \t ]+$/.exec(
      ctx.text.slice(Math.max(0, m.index - 30), m.index),
    )?.[1];
    if (subject && /^(?:i|you|we|they)$/i.test(subject)) return null;
    return third(word);
  },
  // "The mother told him do his homework": to before the verb.
  verbSlotsA7: (m, ctx) => {
    const word = m.groups!.target;
    if (word !== lower(word)) return null;
    const bare = /^(?:do|go|be|come|stay|leave|get|keep|stop|wait)$/.test(word);
    if (!bare && !baseVerb(word)) return null;
    const next = nextWord(ctx, m.index + m[0].length);
    if (!bare && read(word)?.noun && !OBJECT.test(next)) return null;
    return `to ${word}`;
  },
  // "I'll be able come", "It would be great write a story": to after the adjective.
  verbSlotsA8: (m, ctx) => {
    const word = m.groups!.target;
    if (word !== lower(word) || !baseVerb(word) || /^(?:for|to|thank|please)$/.test(word))
      return null;
    const next = nextWord(ctx, m.index + m[0].length);
    // "Jobs are hard come by": the idiom.
    if (word === "come" && next === "by") return null;
    if (
      read(word)?.noun &&
      !(
        OBJECT.test(next) ||
        /^(?:over|back|up|out|in|on|by|home|here|there|tomorrow|today|soon)$/.test(next)
      )
    )
      return null;
    return `to ${word}`;
  },
  // "She explained me the results", "Let me explain you why": explain to someone.
  verbSlotsMe: (m) => `to ${m.groups!.target}`,
  // "We cannot afford spending a month there": afford to spend.
  verbSlotsA9: (m) => {
    const lemma = englishLemma(m.groups!.target, "ing");
    return lemma && lemma !== "be" ? `to ${lemma}` : null;
  },
  // "It not required", "You not allowed to": the pronoun lost its be.
  verbSlotsNot: (m, ctx) => {
    const before = wordBefore(ctx, m.index);
    // "Do you not…", "Will it not…": an inverted question keeps its auxiliary.
    if (
      before &&
      FUNCTION_WORDS.has(before) &&
      !/^(?:that|if|so|and|but|because|when|think|said)$/.test(before)
    )
      return null;
    const subject = lower(m.groups!.subject);
    const be = subject === "i" ? "am" : /^(?:he|she|it)$/.test(subject) ? "is" : "are";
    return `${be} not`;
  },
  // "We have not including him", "The report has not coming yet": a perfect or a progressive.
  verbSlotsA10: (m) => {
    const lemma = nonBase(m.groups!.target, ["ing"]);
    const done = lemma && lemma !== "be" && participle(lemma);
    if (!done) return null;
    const be = lower(m.groups!.have) === "has" ? "is" : "are";
    const start = m.indices!.groups!.have[0];
    return {
      alternatives: [`${m.groups!.have} not ${done}`, `${be} not ${m.groups!.target}`],
      range: [start, m.index + m[0].length],
      raw: true,
    };
  },
  // "It did been solved", "They do been ready": a perfect takes have.
  verbSlotsDid: (m) => ({ did: "had", does: "has", do: "have" })[lower(m.groups!.target) as "do"],
  // "There is has been an outrage": one auxiliary.
  verbSlotsIs: (m) => m.groups!.have,
  // "I am surprise that", "She was disappoint": the participle after be.
  verbSlotsSurprise: (m) => {
    const word = lower(m.groups!.target);
    return englishInflect(word, "past");
  },
  // "I use to own a car", "apps that use to be free": used to.
  verbSlotsUse: (m, ctx) => {
    const subject = lower(m.groups!.subject);
    const verb = lower(m.groups!.verb);
    if (/^(?:that|which|who)$/.test(subject)) return verb === "be" ? "used" : null;
    // "the tool I use to write code": the object of use comes before its subject.
    const before = wordBefore(ctx, m.index);
    const opens =
      (!before && afterBreak(ctx, m.index)) ||
      /^(?:and|but|so|because|when|know|knew|think|thought|remember)$/.test(before);
    const r = read(verb);
    return opens && r?.verbs.some((v) => v.form === "base") && !r.noun ? "used" : null;
  },
} satisfies Record<string, Fixer>;
