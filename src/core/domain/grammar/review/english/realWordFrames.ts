import { englishInflect, englishLemma } from "../../implementations/helpers/EnglishInflection";
import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import { englishVerbForms } from "../../implementations/helpers/EnglishVerbForms";
import type { PhraseRow } from "../englishPhraseTables";
import { SPACE as S, WORD_END as E } from "../phraseTemplates";
import type { ReviewDetectorEntry } from "../reviewDetectors";
import { CONTEXT, frameDetector, type Frame, type Rule } from "./idioms5";
import { afterBreak, DETERMINERS, FUNCTION_WORDS, tokensAfter, wordBefore } from "./slotWords";

// Real words in a slot that only a similar word fits, read with the lexicon: a noun where
// its verb belongs ("I complaint about", "He departures at"), "cause" for "because", "though"
// for "thought", "bit" for "a bit", an -ies noun for an -ize verb, and misheard set phrases.

const CONFUSED: Rule = { ruleId: "englishConfusedWords", messageKey: "review_msg_confused_word" };
const AUXILIARY: Rule = {
  ruleId: "englishAuxiliaryBaseVerb",
  messageKey: "review_msg_auxiliary_base",
};
const TO_BASE: Rule = { ruleId: "englishAuxiliaryBaseVerb", messageKey: "review_msg_to_base" };
const GERUND: Rule = {
  ruleId: "englishVerbComplements",
  messageKey: "review_msg_gerund_complement",
};
const COMPLEMENT: Rule = {
  ruleId: "englishVerbComplements",
  messageKey: "review_msg_verb_complements",
};

/** Misheard set phrases: each typed form is wrong in every context. */
export const PHRASES: readonly PhraseRow[] = [
  [["back and fourth", "back in forth", "back in fourth"], "back and forth"],
  ["bye the way", "by the way"],
  [["bob wire", "bobbed wire", "barb wire"], "barbed wire"],
  ["witch haunt", "witch hunt"],
  ["witch haunts", "witch hunts"],
  ["flee market", "flea market"],
  ["flee markets", "flea markets"],
  [["mary christmas", "marry christmas"], "merry christmas"],
  ["kind retards", "kind regards"],
  ["very mush", "very much"],
  ["on behave of", "on behalf of"],
  ["a loot of", "a lot of"],
  ...["daily", "weekly", "monthly", "yearly", "regular", "case-by-case", "permanent"].map(
    (when): PhraseRow => [`on a ${when} base`, `on a ${when} basis`],
  ),
  [["spilling error", "spilling mistake"], "spelling error"],
  [["spilling errors", "spilling mistakes"], "spelling errors"],
  [["airplane hanger", "aircraft hanger"], "airplane hangar"],
  [["airplane hangers", "aircraft hangers"], "airplane hangars"],
  ["pigeon english", "pidgin English"],
  ["totem poll", "totem pole"],
  [["opinion pole", "opinion poles"], "opinion poll"],
  ["in plain side", "in plain sight"],
  ["next do nothing", "next to nothing"],
  [["do to the fact that", "do to the fact"], "due to the fact that"],
  ["do to the lack of", "due to the lack of"],
  ["ascetic acid", "acetic acid"],
  ...["affairs", "relations", "sector", "health", "school", "schools", "library", "transport"].map(
    (noun): PhraseRow => [`pubic ${noun}`, `public ${noun}`],
  ),
  [
    ["golf medal", "golf medalist", "golf medallist"],
    ["gold medal", "gold medalist"],
  ],
  ["price sensibility", "price sensitivity"],
  ["aspect ration", "aspect ratio"],
  ["from than on", "from then on"],
  ["untied states", "United States"],
  ...["weapons", "missiles", "warheads", "reactor", "reactors", "arsenal"].map(
    (noun): PhraseRow => [`unclear ${noun}`, `nuclear ${noun}`],
  ),
  ["at the hard of", "at the heart of"],
  ["peace of cake", "piece of cake"],
  ["must of the time", "most of the time"],
  ["ease off use", "ease of use"],
  ...["concerns", "fears", "doubts", "suspicions"].map((noun): PhraseRow => [
    `ally ${noun}`,
    `allay ${noun}`,
  ]),
  ...["compromise", "suggestions", "persuasion", "reason"].map((noun): PhraseRow => [
    `amendable to ${noun}`,
    `amenable to ${noun}`,
  ]),
  ...["bomb", "bombs", "tension", "tensions", "the bomb", "the situation"].map(
    (noun): PhraseRow => [`diffuse ${noun}`, `defuse ${noun}`],
  ),
  ["risk adverse", "risk averse"],
  ["free reign", "free rein"],
  ["construction side", "construction site"],
  ...["positive", "negative", "bright", "flip"].map((kind): PhraseRow => [
    `on the ${kind} site`,
    `on the ${kind} side`,
  ]),
];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

const read = (word: string | undefined) => (word ? englishWordInfo(word.toLowerCase()) : null);
const verbOnly = (word: string) => {
  const r = read(word);
  return !!r?.verbs.length && !r.noun && !r.plural && !r.adjective;
};
const baseVerb = (word: string) =>
  !!read(word)?.verbs.some((v) => v.form === "base" && v.lemma === word.toLowerCase());
/** The past participle of a base verb: irregular table first. */
export const participle = (lemma: string) => {
  const irregular = englishVerbForms(lemma);
  return irregular?.lemma === lemma ? irregular.participle : englishInflect(lemma, "past");
};

// Nouns whose verb the suffix rules below do not reach.
const NOUN_VERBS: Record<string, string> = {
  life: "live",
  belief: "believe",
  relief: "relieve",
  grief: "grieve",
  proof: "prove",
  threat: "threaten",
  intent: "intend",
  advice: "advise",
  choice: "choose",
  multiple: "multiply",
};

/** The base verb a noun stands for ("complaint" -> complain, "departures" -> depart). */
function verbOfNoun(noun: string): { verb: string; plural: boolean } | null {
  const verb = nounVerb(noun);
  return verb ? { verb, plural: /s$/.test(noun) && !/ss$/.test(noun) } : null;
}
export function nounVerb(noun: string): string | null {
  const singular = /ies$/.test(noun)
    ? `${noun.slice(0, -3)}y`
    : /(?:[^s]s|ss)$/.test(noun) && !/ss$/.test(noun)
      ? noun.slice(0, -1)
      : noun;
  const r = read(singular);
  if (NOUN_VERBS[singular]) return r?.verbs.length ? null : NOUN_VERBS[singular];
  if (!r?.noun || r.verbs.length || r.adjective || r.adverb || FUNCTION_WORDS.has(singular))
    return null;
  const candidates = [
    singular.replace(/aint$/, "ain"),
    singular.replace(/ery$/, "er"),
    singular.replace(/ure$/, ""),
    singular.replace(/ure$/, "e"),
    singular.replace(/al$/, ""),
    singular.replace(/al$/, "e"),
  ];
  // "depart", "deliver": a verb, maybe also a noun; not an adjective.
  return candidates.find((c) => c !== singular && baseVerb(c) && !read(c)?.adjective) ?? null;
}

// Verbs and adjectives that take a to-infinitive, in their usual forms.
const TO_GOVERNOR =
  /^(?:wants?|wanted|wanting|needs?|needed|tr(?:y|ies|ied|ying)|seems?|seemed|going|has|have|had|able|likes?|liked|loves?|loved|hates?|hated|decided?|decides|plans?|planned|hopes?|hoped|expects?|expected|managed?|manages|starts?|started|begins?|began|continues?|continued|refused?|refuses|forgot|forget|remember(?:ed|s)?|learn(?:ed|s)?|agreed?|agrees|promised?|promises|chose|choose|fails?|failed|invited|asked|told|allowed|supposed|ought|would|'d|wish(?:es|ed)?|prefer(?:s|red)?|intends?|intended|happens?|happened|appears?|appeared|tends?|tended|helps?|helped|used)$/;

/** Third-person -s form of a base verb. */
const third = (verb: string) => englishInflect(verb, "third");

// "He mostly", "I formally": one adverb may come between the subject and its verb.
const ADVERB_SLOT = `(?:${S}(?:formally|recently|really|just|also|never|always|often|usually|already|still|only|sometimes|actually|then))?`;

const FRAMES: readonly Frame[] = [
  // "I complaint about it", "We life in Moscow", "He departures at 8", "She intents to go":
  // a noun after a subject pronoun where only its verb fits.
  {
    rule: CONFUSED,
    pattern: `(?<![\\p{L}'’])(?<subject>I|we|they|he|she)${ADVERB_SLOT}${S}(?<target>[a-z]{4,})${E}`,
    fix: (m, ctx) => {
      const { subject, target } = m.groups!;
      const word = target.toLowerCase();
      if (target !== word) return null;
      const found = verbOfNoun(word);
      if (!found) return null;
      const { verb, plural } = found;
      // "Type I life jackets", "World War I deliveries": a numeral I.
      if (/\p{Lu}/u.test(ctx.text.slice(Math.max(0, m.index - 3), m.index))) return null;
      const next = tokensAfter(ctx, m.index + m[0].length, 1)[0];
      // "they lawyers", "we developers": a plural noun can stand beside we/they.
      const singularSubject = /^(?:he|she)$/i.test(subject);
      if (singularSubject !== plural) return null;
      // A clause goes on after the verb: an object, a preposition, "to" or the clause end; a
      // noun or another verb form after it ("life jackets") leaves a compound.
      const after = next?.kind === "word" ? read(next.lower) : null;
      if (
        after &&
        !FUNCTION_WORDS.has(next.lower) &&
        (after.verbs.some((v) => v.form !== "base") ||
          ((after.noun || after.plural) && !after.verbs.length))
      )
        return null;
      if (singularSubject) return third(verb);
      const past = englishInflect(verb, "past");
      return past ? [verb, past] : verb;
    },
  },
  // "I guess they did it cause they need money": because.
  {
    rule: CONFUSED,
    cue: ["cause"],
    pattern: `(?<![\\p{L}'’])(?<target>cause)${S}(?<next>I|I['’]m|I['’]ve|I['’]ll|we|we['’]re|they|they['’]re|he|he['’]s|she|she['’]s|it['’]s|you['’]re|there['’]s|(?:it|you|our|my|your|his|her|their|the)${S}(?:[a-z]+${S})?(?:is|was|are|were|can|can['’]t|will|won['’]t|did|didn['’]t|does|doesn['’]t|has|had|need|needs))${E}`,
    fix: (m, ctx) => {
      const before = wordBefore(ctx, m.index);
      // "a good cause they support", "can cause the", "that cause our": a noun or a verb.
      if (
        before &&
        (DETERMINERS.has(before) ||
          FUNCTION_WORDS.has(before) ||
          /n['’]t$/.test(before) ||
          read(before)?.verbs.some((v) => v.form === "base" || v.form === "third"))
      )
        return null;
      const lead = ctx.text.slice(Math.max(0, m.index - 30), m.index);
      if (
        /\b(?:a|an|the|this|that|my|our|your|his|her|their|every|any|no)[ \t ]+[a-z]+[ \t ]+$/i.test(
          lead,
        )
      )
        return null;
      return "because";
    },
  },
  // "I though he left", "a problem they though was fixed", "higher than I though.": thought.
  {
    rule: CONFUSED,
    cue: ["though"],
    pattern: `(?<![\\p{L}'’])(?<subject>I|you|we|they|he|she)${S}(?<target>though)(?:${S}(?<next>of|about|that|so|it|he|she|I|you|we|they|this|was|is|the|a|my|his|her|their|our)${E}|(?<end>[ \\t\\u00a0]*[.!?]))`,
    fix: (m, ctx) => {
      const { next, end } = m.groups!;
      const before = wordBefore(ctx, m.index);
      if (end !== undefined) return before === "than" ? "thought" : null;
      // "He, though, is…" without commas: a clause start keeps "though" before be.
      if (/^(?:is|was)$/i.test(next) && !/^(?:that|which|what|who)$/.test(before)) return null;
      // "though of course"; "even though about".
      if (/^of$/i.test(next) && /^[ \t ]+course\b/i.test(ctx.text.slice(m.index + m[0].length)))
        return null;
      return /^(?:even|as)$/.test(before) ? null : "thought";
    },
  },
  // "I'm bit lazy", "Bit odd that…", "got bit money": a bit.
  {
    rule: CONTEXT,
    cue: ["bit"],
    pattern: `(?<![\\p{L}'’])(?<target>bit)${S}(?<next>[a-z]+)${E}`,
    fix: (m, ctx) => {
      const next = m.groups!.next.toLowerCase();
      const before = wordBefore(ctx, m.index);
      const lead =
        /^(?:am|is|are|was|were|be|been|feel|feels|felt|seem|seems|seemed|look|looks|looked|sound|sounds|got|get|need)$/.test(
          before,
        ) ||
        /['’](?:m|s|re)$/.test(before) ||
        (!before && afterBreak(ctx, m.index));
      if (!lead || /^(?:by|off|into|me|him|her|them|us|you|it|the|my)$/.test(next)) return null;
      const r = read(next);
      const closed =
        /^(?:too|more|less|of|late|early|later|earlier|better|worse|longer|faster|slower|behind|much)$/.test(
          next,
        );
      // "Bit serial designs": at a sentence start an adjective must end its phrase.
      if (!before && !closed) {
        const after = tokensAfter(ctx, m.index + m[0].length, 1)[0];
        if (after?.kind === "word" && !/^(?:that|to|but)$/.test(after.lower)) return null;
      }
      const fits =
        closed ||
        (!!r?.adjective && !r.verbs.length) ||
        (/^(?:got|get|need)$/.test(before) && !!r?.noun && !r.plural && !r.verbs.length);
      return fits ? { alternatives: ["a bit"], range: m.indices!.groups!.target } : null;
    },
  },
  // "I apologies for that", "We would priorities it": the -ize verb; "an apologize": the noun.
  {
    rule: CONFUSED,
    cue: ["apologies", "priorities", "summaries", "categories", "memories"],
    pattern: `(?<![\\p{L}'’])(?:I|we|they|you|will|would|should|could|can|must|might|please)${S}(?<target>[a-z]+ies)${E}`,
    fix: (m) => {
      const word = m.groups!.target.toLowerCase();
      const verb = `${word.slice(0, -3)}ize`;
      return read(word)?.plural && !read(word)?.verbs.length && baseVerb(verb) ? verb : null;
    },
  },
  {
    rule: CONFUSED,
    cue: ["apologize", "prioritize", "summarize", "categorize", "memorize"],
    pattern: `(?<![\\p{L}'’])(?:a|an|my|your|our|their|his|her|no)${S}(?<target>[a-z]+ize)${E}`,
    fix: (m) => {
      const word = m.groups!.target.toLowerCase();
      const noun = `${word.slice(0, -3)}y`;
      const r = read(noun);
      return verbOnly(word) && r?.noun && !r.verbs.length ? noun : null;
    },
  },
  // "He helped carrying the bags": help takes a bare or to-infinitive.
  {
    rule: COMPLEMENT,
    cue: ["help", "helped", "helps", "helping"],
    pattern: `(?<![\\p{L}'’])(?:help|helped|helps|helping)${S}(?:not${S})?(?<target>[a-z]+ing)${E}`,
    fix: (m, ctx) => {
      const word = m.groups!.target.toLowerCase();
      const before = ctx.text.slice(Math.max(0, m.index - 24), m.index);
      // "can't help laughing"; "It helps knowing that…": a gerund subject after it.
      if (/(?:can['’]?t|cannot|could(?:n['’]t|[ \t ]+not)|can[ \t ]+not)[ \t ]+$/i.test(before))
        return null;
      const subject = wordBefore(ctx, m.index);
      if (/^(?:it|this|that|what|which)$/.test(subject)) return null;
      // "I need help getting started": help is the noun there. "Meditation helps relaxing" is
      // heard too: only a pronoun, "to" or an auxiliary before help.
      if (
        !/^(?:i|we|they|you|he|she|to|will|would|can|could|should|must|might|did|do|does|please)$/.test(
          subject,
        )
      )
        return null;
      const r = read(word);
      const lemma = englishLemma(word, "ing");
      if (!lemma || lemma === "be" || r?.noun || r?.adjective) return null;
      return [`to ${lemma}`, lemma];
    },
  },
  // "I'm used to run every day", "accustomed to wait": the to is a preposition there.
  {
    rule: GERUND,
    cue: ["used", "accustomed"],
    pattern: `(?<![\\p{L}'’])(?:(?:I['’]m|I${S}am|I${S}was|(?:we|you)(?:['’]re|${S}are|${S}were))(?:${S}(?:so|very|really|not|quite|just))?${S}used|accustomed)${S}to${S}(?<target>[a-z]+)${E}`,
    fix: (m, ctx) => {
      const word = m.groups!.target.toLowerCase();
      if (!baseVerb(word) || FUNCTION_WORDS.has(word) || read(word)?.adjective) return null;
      const next = tokensAfter(ctx, m.index + m[0].length, 1)[0];
      // "used to work as…", "accustomed to change": a noun-or-verb needs an object after it.
      if (
        read(word)?.noun &&
        !(
          next?.kind === "word" &&
          /^(?:the|a|an|my|your|our|their|his|her|it|them|him|me|us|every|each|this|these|those)$/.test(
            next.lower,
          )
        )
      )
        return null;
      return englishInflect(word, "ing");
    },
  },
  // "She wants you to goes there", "seemed to noticed.": an infinitive takes the base.
  {
    rule: TO_BASE,
    cue: ["to"],
    pattern: `(?<![\\p{L}'’])to${S}(?:not${S})?(?<target>[a-z]+(?:s|ed))(?=(?<close>[ \\t\\u00a0]*[.!?,;]|${S}(?:the|a|an|my|your|his|her|our|their|it|them|him|me|us|there|here|home|at|in|to|with|on)${E}))`,
    fix: (m, ctx) => {
      const target = m.groups!.target;
      const word = target.toLowerCase();
      const r = read(word);
      if (target !== word || !r || r.noun || r.plural || r.adjective || FUNCTION_WORDS.has(word))
        return null;
      if (word === "thanks") return null;
      // "wants you to goes", "tried not to laughs": only after a verb that takes an infinitive;
      // "points to exists", "set it to disabled" keep the preposition.
      const lead =
        /([A-Za-z]+)(?:[ \t\u00a0]+(?:you|him|her|them|us|me|it))?[ \t\u00a0]+(?:not[ \t\u00a0]+)?$/.exec(
          ctx.text.slice(Math.max(0, m.index - 40), m.index),
        )?.[1];
      if (!lead || !TO_GOVERNOR.test(lead.toLowerCase())) return null;
      const form = r.verbs.find((v) => v.form === "third" || v.form === "past");
      if (!form || r.verbs.some((v) => v.form === "base")) return null;
      // A participle can be an adjective before its noun; only third or a clause end here.
      if (form.form === "past" && !m.groups!.close) return null;
      return form.lemma;
    },
  },
  // "He will be have a party", "must be replaces": be + a verb's base or -s form.
  {
    rule: AUXILIARY,
    cue: ["be"],
    pattern: `(?<![\\p{L}'’])(?:will|would|can|could|should|must|might|may|to)${S}(?<target>be${S}(?<verb>[a-z]+))${E}`,
    fix: (m, ctx) => {
      const word = m.groups!.verb.toLowerCase();
      if (word === "have") return ["have", "be having"];
      // "should be, please…", "will be follow up", "to be seem" (seen): not a verb slip.
      if (/^(?:please|further|seem)$/.test(word)) return null;
      const next = tokensAfter(ctx, m.index + m[0].length, 1)[0];
      if (next?.kind === "word" && /^(?:up|out|off|on|down|in)$/.test(next.lower)) return null;
      const r = read(word);
      if (!r || !verbOnly(word) || FUNCTION_WORDS.has(word)) return null;
      const form = r.verbs[0];
      if (!r.verbs.every((v) => v.lemma === form.lemma)) return null;
      if (r.verbs.some((v) => v.form === "participle" || v.form === "past" || v.form === "ing"))
        return null;
      const done = participle(form.lemma);
      // The participle, as the verb-group check offers it ("can be install" -> installed).
      return done ? { alternatives: [done], range: m.indices!.groups!.verb } : null;
    },
  },
  // "This state of art equipment": the compound adjective state-of-the-art.
  {
    rule: CONTEXT,
    cue: ["art"],
    pattern: `(?<target>state${S}of${S}art)${S}(?<noun>[a-z]+)${E}`,
    fix: (m) => {
      const noun = m.groups!.noun.toLowerCase();
      const r = read(noun);
      return r && (r.noun || r.plural) && !r.verbs.length && !FUNCTION_WORDS.has(noun)
        ? "state-of-the-art"
        : null;
    },
  },
];

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: [
      "englishConfusedWords",
      "englishPhraseCorrections",
      "englishAuxiliaryBaseVerb",
      "englishVerbComplements",
    ],
    detect: frameDetector(FRAMES),
  },
];
