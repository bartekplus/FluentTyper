import {
  englishLexiconInflect,
  englishWordInfo,
} from "../../implementations/helpers/EnglishLexicon";
import type { PhraseRow } from "../englishPhraseTables";
import { SPACE, WORD_END } from "../phraseTemplates";
import type { ReviewDetectorEntry } from "../reviewDetectors";
import { nounNumber } from "./nounNumberSlots";
import { frameDetector, TYPO, type Frame, type Rule } from "./idioms5";
import { afterBreak, FUNCTION_WORDS, nounOnly, wordBefore } from "./slotWords";

// Short slips with a fixed shape: "drove to fast" (too), "there is not fast way" (no),
// "a 100 countries" (100), "Someone else walk" (walks), "its working" (it's), "the will
// provide" (they), "should by Google stock" (buy/be), "It would
// cool if" (be cool), "This two are" (These), "These kind of" (This kind / These kinds).

const S = SPACE;
const E = WORD_END;
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
    pattern: `(?:${MODAL}|don['’]t|didn['’]t)(?:${S}(?:definitely|really|probably|soon|also|just|never|always|actually))?${S}(?<target>by)${S}(?<next>up${S}to|via|[0-9(]|[A-Z][a-z]+|[a-z]+)`,
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
    cue: ["will", "would", "should", "could", "can", "may", "might", "must"],
    pattern: `(?<![\\p{L}'’])(?:I|you|we|they|he|she|it|this|that|there)${S}(?<modal>${MODAL})${S}(?<target>[a-z]+)(?<after>${S}(?:if|to|that|for)${E}|[ \\t\\u00a0]*[.,!?]|${S}[a-z]+)`,
    fix: (m) => {
      const { target, after } = m.groups!;
      // "would sooner die", "can cheap out", "will cool to 71": comparatives, particles, verbs.
      if (/^(?:likely|sooner|rather|better|best|worse|soon|later)$/.test(target)) return null;
      if (/^[ \t\u00a0]+(?:out|up|off|down|over)\b/.test(after)) return null;
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
    ],
    detect: frameDetector(FRAMES),
  },
];
