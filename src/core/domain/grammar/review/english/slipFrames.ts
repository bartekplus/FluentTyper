import {
  englishLexiconInflect,
  englishWordInfo,
} from "../../implementations/helpers/EnglishLexicon";
import type { PhraseRow } from "../englishPhraseTables";
import { SPACE as S, WORD_END as E } from "../phraseTemplates";
import type { DetectContext, ReviewDetectorEntry } from "../reviewDetectors";
import { nounNumber } from "./nounNumberSlots";
import { frameDetector, TYPO, type Frame, type Rule } from "./idioms5";
import { afterBreak, FUNCTION_WORDS, nounOnly, tokensAfter, wordBefore } from "./slotWords";

// Short slips with a fixed shape: "drove to fast" (too), "there is not fast way" (no),
// "a 100 countries" (100), "Someone else walk" (walks), "its working" (it's), "the will
// provide" (they), "should by Google stock" (buy/be), "It would
// cool if" (be cool), "This two are" (These), "These kind of" (This kind / These kinds).

const CONFUSED: Rule = { ruleId: "englishConfusedWords", messageKey: "review_msg_confused_word" };
const AGREEMENT: Rule = {
  ruleId: "englishSubjectVerbAgreement",
  messageKey: "review_msg_subject_verb",
};
const NUMBER: Rule = { ruleId: "englishNounNumber", messageKey: "review_msg_noun_count" };
const DEMONSTRATIVE: Rule = {
  ruleId: "englishNounNumber",
  messageKey: "review_msg_demonstrative_number",
};
const MISSING_BE: Rule = {
  ruleId: "englishSentenceStructure",
  messageKey: "review_msg_missing_be",
};
const ITS: Rule = { ruleId: "englishItsContext", messageKey: "review_msg_its_contraction" };

export const PHRASES: readonly PhraseRow[] = [
  ...["a", "the", "this"].map((lead): PhraseRow => [`${lead} serious of`, `${lead} series of`]),
  ...["the", "my", "his", "her", "our", "their", "your"].map((lead): PhraseRow => [
    `${lead} live of`,
    `${lead} life of`,
  ]),
];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

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
const NUMBER_WORD =
  "two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety";
const TOO_DEGREE =
  "fast|soon|late|early|slowly|quickly|much|many|long|far|big|small|hard|easy|busy|tired|young|old|expensive|cheap|close|high|low|loud|hot|cold";
const MOTION =
  /^(?:drove|drive|drives|driving|ran|run|runs|went|go|goes|came|come|comes|got|get|gets)$/;
// "Can anybody else check it?": a subject after an auxiliary keeps the base.
const AUX_BEFORE =
  /^(?:can|could|will|would|should|shall|may|might|must|did|does|do|to|let|make|help|have|had)$/;
const MODAL = "will|would|should|could|can|may|might|must";

const ITS_OWNER: Rule = { ruleId: "englishItsContext", messageKey: "review_msg_its_possessive" };
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

const FRAMES: readonly Frame[] = [
  // "I drove to fast", "came much to soon", "far to novice to win": too.
  {
    rule: CONFUSED,
    cue: ["to"],
    pattern: `(?<lead>drove|drive|drives|driving|ran|run|runs|went|go|goes|came|come|comes|spoke|speak|talk|talks|talked|much|far|way|be|is|are|was|were|it['’]s|that['’]s|['’]re|['’]m|got|get|gets)${S}(?<target>to)${S}(?<adj>${TOO_DEGREE}|[a-z]+)(?=[ \\t\\u00a0]*[.,!?]|${S}(?:to|because|for|and|but|so)${E})`,
    fix: (m) => {
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
  },
  // "There is not fast way", "has not knowledge of": no before a noun phrase.
  {
    rule: CONFUSED,
    cue: ["not"],
    pattern: `there${S}(?:is|was|are|were|['’]s)${S}(?<target>not)${S}(?<adj>[a-z]+)${S}(?<noun>[a-z]+)${E}`,
    fix: (m) => {
      const { adj, noun } = m.groups!;
      return adjectiveOnly(adj) && (read(noun)?.noun || nounOnly(noun)) ? "no" : null;
    },
  },
  {
    rule: CONFUSED,
    cue: ["not"],
    pattern: `(?:has|have|['’]ve)${S}(?<target>not)${S}(?<noun>[a-z]+)${S}(?:of|to|for|listed|left|available)${E}`,
    fix: (m) => {
      const noun = m.groups!.noun;
      if (FUNCTION_WORDS.has(noun)) return null;
      const r = read(noun);
      return (r ? r.noun && !r.verbs.length && !r.adjective : nounOnly(noun)) ? "no" : null;
    },
  },
  // "more than a 100 countries", "After a two months": no article before a count.
  {
    rule: NUMBER,
    cue: ["a", "an"],
    pattern: `(?<target>an?${S}(?<num>(?:${NUMBER_WORD})(?:-[a-z]+)?|[2-9]|[1-9][0-9]+))${S}(?<noun>[a-z]+s)${E}`,
    fix: (m, ctx) => {
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
      if (
        (!orSo && /^(?:or|and|old|long)$/.test(next ?? "")) ||
        wordBefore(ctx, m.index) === "worth"
      )
        return null;
      return closes || orSo || (next && FUNCTION_WORDS.has(next)) ? m.groups!.num : null;
    },
  },
  // "Someone else walk to the store": an -s verb after an indefinite pronoun.
  {
    rule: AGREEMENT,
    cue: ["else"],
    pattern: `(?:someone|somebody|anyone|anybody|everyone|everybody|nobody)${S}else(?:${S}(?:always|usually|often|never|sometimes|also|just|really))?${S}(?<target>[a-z]+)${S}(?:to|the|a|an|my|his|her|our|their|it|them|me|us|that|this)${E}`,
    fix: (m, ctx) =>
      baseVerb(m.groups!.target) && !AUX_BEFORE.test(wordBefore(ctx, m.index))
        ? [third(m.groups!.target)]
        : null,
  },
  // "He going crazy.": a progressive with no be.
  {
    rule: MISSING_BE,
    cue: ["he", "she"],
    pattern: `(?<target>(?<pron>he|she)${S}(?<verb>[a-z]+ing))${S}(?:crazy|home|away|nuts|mad|insane)${E}`,
    fix: (m, ctx) => {
      if (!afterBreak(ctx, m.index)) return null;
      const r = read(m.groups!.verb);
      if (!r?.verbs.some((v) => v.form === "ing")) return null;
      return `${m.groups!.pron} is ${m.groups!.verb}`;
    },
  },
  // "If its toxic then…", "that its working in…", "Its 2 p.m.": it's.
  {
    rule: ITS,
    cue: ["its"],
    pattern: `(?<target>its)${S}(?:(?<adj>[a-z]+)(?=[ \\t\\u00a0]*[,.!?]|${S}then${E})|(?<ing>[a-z]+ing)${S}(?:that|it|it['’]s|in|on|to|so|now|fine|well|again|right)${E}|[0-9]{1,2}(?:[ \\t\\u00a0]*(?:a\\.?m|p\\.?m|o['’]clock)|:[0-9]{2}))`,
    fix: (m, ctx) => {
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
  },
  // "As usual, the will provide details", "The really would like…": they.
  {
    rule: CONFUSED,
    cue: ["the"],
    pattern: `(?<target>the)${S}(?:(?:really|probably|always|usually|never|also|just|quietly|still|already|often|sometimes)${S}(?:would|will|should|could|can|won['’]t|wouldn['’]t|don['’]t|didn['’]t|do|did|have|are|were|finish|need|want|like|might)|(?:would|should|could|won['’]t|wouldn['’]t|shouldn['’]t|couldn['’]t|can['’]t|don['’]t|didn['’]t)|will${S}(?<verb>[a-z]+))${E}`,
    fix: (m) => {
      const verb = m.groups!.verb;
      if (verb && !baseVerb(verb)) return null;
      // "The Don't Quit Podcast": a title.
      return /[A-Z]/.test(m[0].slice(4)) ? null : "they";
    },
  },
  // "I really should by Google stock", "will by network ready": buy or be.
  {
    rule: CONFUSED,
    cue: ["by"],
    pattern: `(?:${MODAL}|don['’]t|didn['’]t)(?:${S}(?:definitely|really|probably|soon|also|just|never|always|actually))?${S}(?<target>by)${S}(?<next>up${S}to|via|[0-9(]|[a-z]{2,}|[a-z]+)`,
    fix: (m) => {
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
  },
  // "if it worse", "it safe to say", "she unable to read": the be is missing.
  {
    rule: MISSING_BE,
    cue: ["safe", "unable", "worse", "better", "able", "possible", "impossible", "likely"],
    pattern: `(?<target>(?<pron>it|she|he)${S}(?<adj>safe|unable|able|worse|better|possible|impossible|likely|unlikely|necessary|important|true|clear|okay|fine|ready))(?=${S}(?:to|or|than|that|for)${E}|[ \\t\\u00a0]*[.!?])`,
    fix: (m, ctx) => {
      const lead = wordBefore(ctx, m.index);
      if (
        !afterBreak(ctx, m.index) &&
        !/^(?:if|whether|as|because|since|that|so|but|and|when|rate|starts)$/.test(lead)
      )
        return null;
      return `${m.groups!.pron} is ${m.groups!.adj}`;
    },
  },
  // "It would cool if…", "we will significant benefits": the modal lacks be/have.
  {
    rule: { ruleId: "englishAuxiliaryBaseVerb", messageKey: "review_msg_modal_be" },
    cue: [
      ...["will", "would", "should", "could", "can", "may", "might", "must", "ll", "won"],
      ...["wouldn", "shouldn", "couldn", "mustn"],
    ],
    // "It wouldn't cool", "We'll happy": a negated or contracted modal too.
    pattern: `(?<![\\p{L}'’])(?:I|you|we|they|he|she|it|this|that|there)(?:${S}(?<modal>${MODAL})(?:n['’]t)?|${S}won['’]t|['’]ll)${S}(?<target>[a-z]+)(?<after>${S}(?:if|to|that|for)${E}|[ \\t\\u00a0]*[.,!?]|${S}[a-z]+)`,
    fix: (m) => {
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
      const before = noun && (read(noun)?.noun || nounOnly(noun)) && !FUNCTION_WORDS.has(noun);
      return before ? [`be ${target}`, `have ${target}`] : `be ${target}`;
    },
  },
  // "This two are the options", "all this were": these before a plural.
  {
    rule: DEMONSTRATIVE,
    cue: ["this"],
    pattern: `(?<target>this)${S}(?:two|three|four|five|both)${S}(?:are|were|have)${E}`,
    fix: "these",
  },
  // "These kind of errors": this kind / these kinds.
  {
    rule: DEMONSTRATIVE,
    cue: ["kind", "type", "sort"],
    pattern: `(?<target>(?<dem>these|those)${S}(?<kind>kind|type|sort))${S}of${E}`,
    fix: (m) => {
      const { dem, kind } = m.groups!;
      const one = /^these$/i.test(dem) ? "this" : "that";
      const single = /^[A-Z]/.test(dem) ? one[0].toUpperCase() + one.slice(1) : one;
      return [`${single} ${kind}`, `${dem} ${kind}s`];
    },
  },
  // "It is right in many way.": many ways.
  {
    rule: NUMBER,
    cue: ["way"],
    pattern: `(?:in|of)${S}(?:many|several|various|different|few)${S}(?<target>way)(?=[ \\t\\u00a0]*[.,!?;])`,
    fix: "ways",
  },
  // "Your order is requires approval", "It is tastes good": be before an -s verb.
  {
    rule: AGREEMENT,
    cue: ["is", "are", "was", "were"],
    pattern: `(?<target>(?:is|are|was|were)${S}(?<adverb>(?:always|also|just|really|still|often|never)${S})?(?<verb>[a-z]+s))${E}`,
    fix: (m, ctx) => {
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
  },
  // "I have than signed it", "you can than forward it": then after an auxiliary.
  {
    rule: { ruleId: "englishThenThan", messageKey: "review_msg_then_than_temporal" },
    cue: ["than"],
    pattern: `(?<![\\p{L}'’])(?:can|could|will|would|should|must|might|may|have|has|had|is|was|I|we|you|they|he|she)${S}(?<target>than)${S}(?<verb>[a-z]+)${E}`,
    // No comparison follows an auxiliary directly, so any verb reading settles it.
    fix: (m) =>
      read(m.groups!.verb)?.verbs.length && !FUNCTION_WORDS.has(m.groups!.verb.toLowerCase())
        ? "then"
        : null,
  },
  // "Send it to out team", "the link to out dashboard": our before a noun.
  {
    rule: CONFUSED,
    cue: ["out"],
    pattern: `(?<![\\p{L}'’])(?:to|at|from|for|into|about)${S}(?<target>out)${S}(?<noun>[a-z]+)${E}`,
    fix: (m) => {
      const noun = m.groups!.noun.toLowerCase();
      if (FUNCTION_WORDS.has(noun) || noun !== m.groups!.noun) return null;
      const r = read(noun);
      // "to out someone" is the verb before a name or pronoun; a noun or unknown word is owned.
      return r
        ? r.noun && !r.adverb && !r.adjective
          ? "our"
          : null
        : nounOnly(noun)
          ? "our"
          : null;
    },
  },
  // "The team and it's members", "when it's state is changed", "filter it's content": a noun
  // after "it's" that only the possessive explains.
  {
    rule: ITS_OWNER,
    cue: ["it"],
    pattern: `(?<target>it['’]s)${S}(?=[a-z])`,
    fix: (m, ctx) => (itsOwner(ctx, m) ? "its" : null),
  },
  // "my big begs", "a grocery beg": bag.
  {
    rule: TYPO,
    cue: ["beg", "begs"],
    pattern: `(?:big|small|large|little|green|grocery|shopping|paper|plastic|tea|sleeping|school|travel|gym|garbage|trash|carrier|heavy|empty)${S}(?<target>begs?)${E}`,
    fix: (m) => (m.groups!.target.toLowerCase() === "begs" ? "bags" : "bag"),
  },
];

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: [
      "englishConfusedWords",
      "englishSubjectVerbAgreement",
      "englishNounNumber",
      "englishSentenceStructure",
      "englishItsContext",
      "englishAuxiliaryBaseVerb",
      "englishPhraseCorrections",
      "englishThenThan",
    ],
    detect: frameDetector(FRAMES),
  },
];
