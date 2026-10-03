import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { PhraseRow } from "../englishPhraseTables";
import { SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, ReviewDetectorEntry } from "../reviewDetectors";
import {
  COMPOUND,
  frameDetector,
  PHRASE,
  TYPO,
  type Frame,
  type FixResult,
  type Rule,
} from "./idioms5";

// Real words typed for a near neighbour in a slot only the neighbour fits: "a few moths ago",
// "I barley moved", "we can discus it", "the former and the later", "has setup the tent".
// Each frame names the slot (the words around it), so the word keeps its own meaning elsewhere.

const S = SPACE;
const TAG_QUESTION: Rule = {
  ruleId: "englishSentenceStructure",
  messageKey: "review_msg_tag_question",
};
const E = WORD_END;

/** Fixed phrases with a wrong word in them; matched as whole words by the phrase table. */
export const PHRASES: readonly PhraseRow[] = [
  ...[
    "instead",
    "because",
    "regardless",
    "in front",
    "in spite",
    "on behalf",
    "in favour",
    "in favor",
    "by means",
    "in terms",
    "as a result",
  ].map((lead): PhraseRow => [`${lead} off`, `${lead} of`]),
  ["in any shape or from", "in any shape or form"],
  ["in the from of", "in the form of"],
  ["in some from or another", "in some form or another"],
  [["tattle-tail", "tattle tail", "tattletail"], "tattle-tale"],
  [["tattle-tails", "tattle tails", "tattletails"], "tattle-tales"],
  ...["basic", "general", "guiding", "core", "fundamental", "moral", "founding", "key"].flatMap(
    (kind): PhraseRow[] => [
      [`${kind} principals`, `${kind} principles`],
      [`${kind} principal`, `${kind} principle`],
    ],
  ),
  ...["investigator", "component", "residence", "shareholder", "dancer"].flatMap(
    (noun): PhraseRow[] => [
      [`principle ${noun}`, `principal ${noun}`],
      [`principle ${noun}s`, `principal ${noun}s`],
    ],
  ),
  ...["school", "assistant", "vice", "deputy", "high school"].flatMap((kind): PhraseRow[] => [
    [`${kind} principle`, `${kind} principal`],
    [`${kind} principles`, `${kind} principals`],
  ]),
  ...[
    ["take", "take"],
    ["takes", "takes"],
    ["took", "took"],
    ["taking", "taking"],
  ].map(([take]): PhraseRow => [`${take} car of`, `${take} care of`]),
  ["couldn't car less", "couldn't care less"],
  ["could car less", "could care less"],
  ...["cupboard", "supplies", "shop", "store", "items", "order", "drawer", "cabinet"].map(
    (thing): PhraseRow => [`stationary ${thing}`, `stationery ${thing}`],
  ),
  ["office stationary", "office stationery"],
  ["school stationary", "school stationery"],
  ["friends and colleges", "friends and colleagues"],
  ["colleges and friends", "colleagues and friends"],
  ["family and colleges", "family and colleagues"],
  ["friend and college", "friend and colleague"],
  ["free trail", "free trial"],
  ["free trails", "free trials"],
  ...["version", "period", "license", "licence", "account", "subscription", "user", "key"].map(
    (thing): PhraseRow => [`trail ${thing}`, `trial ${thing}`],
  ),
  ["error massage", "error message"],
  ["text massage", "text message"],
  ["error massages", "error messages"],
  ["text massages", "text messages"],
  ["for sometime now", "for some time now"],
  ["for quite sometime", "for quite some time"],
  ["in quite sometime", "in quite some time"],
  ["the vary end", "the very end"],
  ["listen to movies", "watch movies"],
  ["listen to films", "watch films"],
  [["listen to a movie", "listen to movie"], "watch a movie"],
  ...[
    ["look", "watch"],
    ["looks", "watches"],
    ["looked", "watched"],
    ["looking", "watching"],
  ].map(([look, watch]): PhraseRow => [`${look} TV`, `${watch} TV`]),
  ...[
    "recording",
    "recordings",
    "shot",
    "shots",
    "capture",
    "share",
    "sharing",
    "size",
    "reader",
  ].map((thing): PhraseRow => [`scree ${thing}`, `screen ${thing}`]),
  ...[
    "phone",
    "smartphone",
    "laptop",
    "computer",
    "TV",
    "touch",
    "home",
    "lock",
    "login",
    "loading",
    "splash",
  ].map((thing): PhraseRow => [`${thing} scree`, `${thing} screen`]),
  ["ensue that", "ensure that"],
  ["ensues that", "ensures that"],
  ["ensued that", "ensured that"],
  ["ensuing that", "ensuring that"],
];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

const info = (word: string | undefined) => (word ? englishWordInfo(word.toLowerCase()) : null);
const isVerb = (word: string | undefined, ...forms: string[]) =>
  !!info(word)?.verbs.some((v) => !forms.length || forms.includes(v.form));
const nextWord = (ctx: DetectContext, end: number) =>
  /^[ \t]{1,8}([A-Za-z]+(?:['’][a-z]+)?)/.exec(ctx.text.slice(end, end + 40))?.[1] ?? "";
const end = (m: RegExpExecArray) => m.index + m[0].length;

const SUBJECT = "I|you|we|they|he|she|it";
const MODAL = "can|could|will|would|shall|should|may|might|must|cannot|can['’]t|won['’]t";
const NEGATION = "don['’]t|doesn['’]t|didn['’]t|never|not";
const OBJECT_START =
  "the|a|an|this|that|these|those|it|them|my|your|his|her|our|their|some|any|all|each|every";
// A count of months: a number, a quantity word or a time adjective.
const MONTH_COUNT = `(?:[0-9]+|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|few|several|many|next|last|past|coming|following|couple${S}of)`;
// Compound nouns used as a verb, and their participles ("has setup" → "has set up").
const PARTICIPLE: Record<string, string> = {
  setup: "set up",
  shutdown: "shut down",
  backup: "backed up",
  cleanup: "cleaned up",
  signup: "signed up",
  pickup: "picked up",
  lookup: "looked up",
  checkout: "checked out",
  rollout: "rolled out",
};
const BASE: Record<string, string> = {
  setup: "set up",
  shutdown: "shut down",
  backup: "back up",
  cleanup: "clean up",
  signup: "sign up",
  pickup: "pick up",
  lookup: "look up",
  checkout: "check out",
  rollout: "roll out",
};
const COMPOUND_VERBS = Object.keys(BASE).join("|");
// The same nouns in a plain verb slot ("Please login", "to backup your files"), and their -s
// forms after he/she/it ("He logins daily" → "logs in").
const SLOT_BASE: Record<string, string> = { ...BASE, login: "log in", logout: "log out" };
const SLOT_THIRD: Record<string, string> = Object.fromEntries(
  Object.entries(SLOT_BASE).map(([noun, verb]) => [`${noun}s`, verb.replace(" ", "s ")]),
);
const INFINITIVE_LEAD =
  "need|needs|needed|want|wants|wanted|plan|plans|planned|try|tries|tried|trying|able|unable|how|going|forgot|forget|remember|allowed|asked|ask|tell|told";
// A verb slot: a modal, "please", a negation, "who", "let me", a subject pronoun, an inverted
// auxiliary or an infinitive lead ("need to", "ask the guests to").
const VERB_LEAD = `(?:${MODAL}|please|${NEGATION}|who|let${S}(?:me|us|them|him|her)|(?:I|we|they|you)|(?:can|could|will|would|should|do|does|did|can['’]t|won['’]t|don['’]t|doesn['’]t|didn['’]t|wouldn['’]t|couldn['’]t)${S}(?:I|you|we|they|he|she|it)|(?:${INFINITIVE_LEAD})${S}to|(?:${INFINITIVE_LEAD})${S}(?:[\\p{L}'’]+${S}){1,2}to)`;
// What follows a verb use: an object, a particle-like word or the clause end.
const VERB_FOLLOW = `(?=${S}(?:${OBJECT_START}|again|with|to|before|after|using|here|there|now|first|via|through|every|daily|into|from|by|on|at|in|without|automatically|successfully|early|late|today|tomorrow|once|twice|files?|data)${E}|[ \\t]*[.!?,;:])`;
// The sentence goes on in plain words to its punctuation: not typed half-way ("Please login
// to"), not glued to a token ("continue.next", "continue_id"), not an accented word.
const PLAIN_REST = /^(?:[ \t ]+[A-Za-z0-9]+(?:['’][A-Za-z]+)?)*[ \t ]*[.!?,;:](?![\p{L}\p{N}_])/u;
const verbSlot =
  (table: Record<string, string>) =>
  (m: RegExpExecArray, ctx: DetectContext): string | null => {
    const typed = m.groups!.target;
    if (typed !== typed.toLowerCase()) return null;
    const end = m.indices!.groups!.target[1];
    return PLAIN_REST.test(ctx.text.slice(end, end + 160)) ? table[typed] : null;
  };
const LOG_IN: Rule = { ruleId: "englishContextualCompounds", messageKey: "review_msg_log_in" };
const SET_UP: Rule = { ruleId: "englishContextualCompounds", messageKey: "review_msg_set_up" };

// "You don't know, are you?": a question tag repeats the clause's own auxiliary family, do
// after a negated lexical verb, be after a negated be. The tag's pronoun must be the
// clause's subject: "I don't know, is it?" asks a second question.
const BE_NEGATION = `['’]m${S}not|${S}(?:am|is|are|was|were)${S}not|${S}(?:isn['’]t|aren['’]t|wasn['’]t|weren['’]t)|['’](?:s|re)${S}not`;
const DO_NEGATION = `${S}(?:don['’]t|doesn['’]t|didn['’]t|do${S}not|does${S}not|did${S}not)`;
const TAG = `(?<subject>I|you|we|they|he|she|it)(?<neg>${BE_NEGATION}|${DO_NEGATION})${S}[^.!?,;:\n]{1,60},${S}(?<target>(?<aux>am|is|are|was|were|do|does|did)${S}(?<pron>I|you|we|they|he|she|it))${E}(?=[ \t]*\\?)`;
const BE_WORDS = /^(?:am|is|are|was|were)$/i;

function tagFix(m: RegExpExecArray): FixResult {
  const { subject, neg, aux, pron } = m.groups!;
  if (subject.toLowerCase() !== pron.toLowerCase()) return null;
  const clauseBe = !/do|did/i.test(neg);
  if (clauseBe === BE_WORDS.test(aux)) return null;
  const past = /was|were|did/i.test(neg);
  const p = pron.toLowerCase();
  const single = /^(?:he|she|it)$/.test(p);
  const verb = clauseBe
    ? past
      ? p === "i" || single
        ? "was"
        : "were"
      : p === "i"
        ? "am"
        : single
          ? "is"
          : "are"
    : past
      ? "did"
      : single
        ? "does"
        : "do";
  return `${verb} ${pron}`;
}

const LATTER_VERB =
  /^(?:is|was|are|were|has|have|had|can|could|will|would|should|may|might|must|does|did|seems|seemed|causes|caused|tends|remains|becomes|offers|requires|means|makes|gives)$/;
// Words before "all ready" that make it the adverb's slot ("I have all ready bought it").
const READY_LEAD =
  /^(?:i|you|we|they|he|she|it|can|could|will|would|should|may|might|must|have|has|had|am|is|are|was|were|i['’](?:ve|m|d)|(?:you|we|they)['’](?:ve|re|d)|(?:he|she|it)['’]s)$/i;

// Short words typed for a verb, in a verb's slot: after a subject, a modal or "to", before
// its object ("I can tech them", "I would choice this", "I ware my coat").
const VERB_FOR: Record<string, string> = {
  tel: "tell",
  tech: "teach",
  choice: "choose",
  ware: "wear",
  multiple: "multiply",
};
const THIRD_FOR: Record<string, string> = {
  tels: "tells",
  teches: "teaches",
  choices: "chooses",
  wares: "wears",
  multiples: "multiplies",
};
const VERB_OBJECT =
  "it|them|him|her|me|us|you|this|that|these|those|the|a|an|my|your|his|our|their|people|students|everyone|something|anything|whether|if|how|what";

const LOCK: Record<string, string> = {
  look: "lock",
  looks: "locks",
  looked: "locked",
  looking: "locking",
};
const NUMBER_WORD =
  "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand|million";

const FRAMES: readonly Frame[] = [
  // "Thanks you for coming": the verb's own "thank you".
  {
    rule: PHRASE,
    cue: ["thanks"],
    pattern: `(?<=(?:^|[.!?,;]["”’)]?[ \\t]{0,8}|\\n))(?<target>thanks)(?=${S}you(?:${S}(?:for|so|very|again|all)${E}|[ \\t]*[.!,]|[ \\t]*$))`,
    fix: "thank",
  },
  // "I cold see it", "Cold you hear him?": the modal.
  {
    rule: TYPO,
    cue: ["cold"],
    pattern: `(?:(?:I|you|we|they|he|she|who|parents|father|mother)${S}(?<target>cold)${S}(?:not|n['’]t|never|do|be|have|see|hear|help|go|get|make|say|tell|find|imagine|feel|ask|try|use)${E}|(?<=(?:^|[.!?]["”’)]?[ \\t]{1,8}))(?<target2>Cold)${S}(?:you|we|they|he|she|I|it|someone|anyone)${S}(?:please${S})?(?:help|tell|see|hear|send|check|give|explain|do|be|have|make)${E})`,
    fix: (m) => ({
      alternatives: ["could"],
      range: m.indices!.groups!.target ?? m.indices!.groups!.target2,
    }),
  },
  // "The smell began to envelope me": the verb "envelop".
  {
    rule: TYPO,
    cue: ["envelope", "envelopes", "enveloped", "enveloping"],
    pattern: `(?:to|will|would|can|could|may|might|it|he|she|they|fog|smoke|darkness|silence)${S}(?<target>envelope|envelopes)${S}(?:me|you|him|her|us|them|it|the|everything|everyone)${E}`,
    fix: (m) => (m.groups!.target.toLowerCase() === "envelopes" ? "envelops" : "envelop"),
  },
  // "from 30 too 37", "expanding too ten locations": "to" before a number.
  {
    rule: TYPO,
    cue: ["too"],
    pattern: `(?:from${S}[0-9A-Za-z.,%]+${S}|expand(?:s|ed|ing)?${S}|increase[sd]?${S}|grew${S}|grow(?:s|ing)?${S}|up${S}|rise[sn]?${S}|rose${S}|fell${S}|dropped${S})(?<target>too)${S}(?:[0-9]+|${NUMBER_WORD})${E}`,
    fix: "to",
  },
  // "let em know", "tell em what": the object pronoun.
  {
    rule: TYPO,
    cue: ["em"],
    pattern: `(?:let|tell|told|send|give|gave|show|ask|asked|help|thank|call|email|to)${S}(?<target>em)${S}(?:know|what|that|the|a|an|it|about|how|why|when|where|if|more)${E}`,
    fix: ["me", "them"],
  },
  // "I would git a new one": the verb "get".
  {
    rule: TYPO,
    cue: ["git"],
    pattern: `(?:${MODAL}|to|${NEGATION}|you|I|we|they|do|did|does)${S}(?<target>git)${S}(?:a|an|the|more|some|it|them|me|you|my|your|this|that|better|ready|started|back|out|home|rid|lost|used|over)${E}`,
    fix: "get",
  },
  // "I cab confirm": the modal "can".
  {
    rule: TYPO,
    cue: ["cab", "cam"],
    pattern: `(?:I|we|you|they)${S}(?<target>cab|cam)${S}(?:confirm|help|see|do|advise|try|check|be|not|say|tell|get|make|go|come|send|assure|guarantee)${E}`,
    fix: "can",
  },
  // "Whet is wrong?": the question word.
  {
    rule: TYPO,
    cue: ["whet"],
    pattern: `(?<=(?:^|[.!?]["”’)]?[ \\t]{1,8}|\\n))(?<target>whet)(?=${S}(?:is|are|was|were|do|does|did|happened|happens|about|if|else|time)${E}|['’]s|[ \\t]*\\?)`,
    fix: "what",
  },
  // "Good lick with it": luck.
  {
    rule: TYPO,
    cue: ["lick", "lock"],
    pattern: `(?:(?<!(?<![\\p{L}'’])(?:a|the)${S})good${S}(?<target>lick)|wish(?:ing)?${S}(?:you|him|her|them|us|everyone)${S}good${S}(?<target2>lock))(?=${S}(?:with|on|to|in|for|today|tomorrow|everyone|everybody|next)${E}|[ \\t]*[.,!]|[ \\t]*$)`,
    fix: (m) => ({
      alternatives: ["luck"],
      range: m.indices!.groups!.target ?? m.indices!.groups!.target2,
    }),
  },
  // "I have note seen it", "I'm note running": the negation.
  {
    rule: TYPO,
    cue: ["note"],
    pattern: `(?:(?:have|has|had)${S}(?<target>note)${S}(?<part>[a-z]+)|(?:I['’]m|am|is|are|was|were)${S}(?<target2>note)${S}(?<ing>[a-z]+ing))${E}`,
    fix: (m) => {
      const part = m.groups!.part;
      if (part && !(isVerb(part, "participle") && !isVerb(part, "base") && !info(part)?.noun))
        return null;
      if (m.groups!.ing && !isVerb(m.groups!.ing, "ing")) return null;
      return {
        alternatives: ["not"],
        range: m.indices!.groups!.target ?? m.indices!.groups!.target2,
      };
    },
  },
  // "That sounds goo!", "not goo enough": good.
  {
    rule: TYPO,
    cue: ["goo"],
    pattern: `(?:sounds|looks|seems|feels|as|so|too|very|really)${S}(?<target>goo)(?=${S}(?:enough|as|to|for|at|idea|job|news)${E}|[ \\t]*[.,!?])`,
    fix: "good",
  },
  // "He is very said", "She sad that": sad and said swapped.
  {
    rule: TYPO,
    cue: ["said"],
    pattern: `(?:very|too|really|feel|feels|felt|seemed|looked|I['’]m|am)${S}(?<target>said)(?=[ \\t]*[.,!?]|${S}(?:and|but|about|when|because|today)${E})`,
    fix: "sad",
  },
  {
    rule: TYPO,
    cue: ["sad"],
    pattern: `(?:(?:I|he|she|they|we|you|who)${S}(?<target>sad)${S}(?:that|it|so|this|something|nothing|yes|no|hello|goodbye)${E}|(?:have|has|had)${S}(?<target2>sad)(?=[ \\t]*[.,!?]|${S}(?:that|it|so|yesterday|before|earlier)${E}))`,
    fix: (m) => ({
      alternatives: ["said"],
      range: m.indices!.groups!.target ?? m.indices!.groups!.target2,
    }),
  },
  // "He never looks the front door": lock.
  {
    rule: TYPO,
    cue: ["look", "looks", "looked", "looking"],
    pattern: `(?<=\\p{L}[ \\t]{1,8})(?<target>look|looks|looked|looking)${S}(?:the|your|my|his|her|our|their|this|that)${S}(?:(?:front|back|main|car|garage|bedroom|office)${S})?(?:door|doors|gate|gates)${E}`,
    fix: (m) => LOCK[m.groups!.target.toLowerCase()],
  },
  // "non alcoholic", "non standard": the prefix takes a hyphen.
  {
    rule: COMPOUND,
    cue: ["non"],
    pattern: `(?<target>non${S}(?<word>[A-Za-z]+))${E}`,
    fix: (m) => {
      const word = m.groups!.word;
      if (/^(?:sequitur|grata|compos|est|plus|ultra|stop|nobis)$/i.test(word)) return null;
      const read = info(word);
      // "Non Khun" is a name; "non new relic" names a product.
      if (m.groups!.target.startsWith("N") || word.length < 5) return null;
      if (!/^[A-Z][a-z]+$/.test(word) && !read?.adjective) return null;
      return `non-${word}`;
    },
  },
  {
    rule: TYPO,
    cue: Object.keys(VERB_FOR),
    pattern: `(?:${MODAL}|to|${NEGATION}|I|we|you|they|let['’]s|please)${S}(?:(?:just|also|always|never|really|often|still)${S})?(?<target>${Object.keys(VERB_FOR).join("|")})${S}(?:${VERB_OBJECT})${E}`,
    fix: (m) => VERB_FOR[m.groups!.target.toLowerCase()],
  },
  {
    rule: TYPO,
    cue: Object.keys(THIRD_FOR),
    pattern: `(?:he|she|it|who|which|that)${S}(?:(?:just|also|always|never|really|often|still)${S})?(?<target>${Object.keys(THIRD_FOR).join("|")})${S}(?:${VERB_OBJECT})${E}`,
    fix: (m) => THIRD_FOR[m.groups!.target.toLowerCase()],
  },
  // "This issue mus exist", "you mus see it": the modal "must" before a bare verb.
  {
    rule: TYPO,
    cue: ["mus"],
    pattern: `(?<target>mus)${S}(?<verb>[a-z]+)${E}`,
    fix: (m) =>
      /^(?:be|have|not|already|also|still|always|never)$/.test(m.groups!.verb) ||
      (isVerb(m.groups!.verb, "base") && !info(m.groups!.verb)?.noun)
        ? "must"
        : null,
  },
  // "I sill check it", "you would sill lock it": the adverb "still" before a verb.
  {
    rule: TYPO,
    cue: ["sill"],
    pattern: `(?:I|you|we|they|he|she|it|would|could|will|should|can|must|might|may|and|but|are|is|was|were|am)${S}(?<target>sill)${S}(?<verb>[a-z]+)${E}`,
    fix: (m) =>
      /^(?:always|never|not|here|there|working|waiting|going|alive|open|valid|the|a|an|in|on|at|my|your)$/.test(
        m.groups!.verb,
      ) || isVerb(m.groups!.verb, "base", "past", "third", "ing")
        ? "still"
        : null,
  },
  // "Pleas have a look", "could you pleas check": the request word.
  {
    rule: TYPO,
    cue: ["pleas"],
    pattern: `(?:(?<=(?:^|[.!?\\n]["”’)]?[ \\t]{0,8}))|(?:you|kindly|and)${S})(?<target>pleas)(?=${S}(?:have|check|let|send|help|see|do|be|note|find|look|tell|try|share|add|call|reply|confirm|review|fix|wait|contact|give|make|keep|consider)${E}|[ \\t]*,)`,
    fix: "please",
  },
  // "I'm nut sure", "it is nut ready": the negation.
  {
    rule: TYPO,
    cue: ["nut"],
    pattern: `(?:I['’]m|am|is|are|was|were|be|do|does|did|could|would|will|should|can)${S}(?<target>nut)${S}(?:sure|going|ready|able|allowed|happy|true|a|an|the|that|so|too|very|really|yet|working|done|here|there|know)${E}`,
    fix: "not",
  },
  // "He walked trough the door": the preposition.
  {
    rule: TYPO,
    cue: ["trough"],
    pattern: `(?:go|goes|went|gone|going|walk|walks|walked|walking|run|runs|ran|running|pass|passed|passes|passing|come|comes|came|coming|get|gets|got|getting|look|looks|looked|looking|read|went|drive|drove|driving|it|way|all|halfway|straight|right)${S}(?<target>trough)${S}(?:the|a|an|this|that|it|them|my|your|his|her|our|their|without|with)${E}`,
    fix: "through",
  },
  // "They were vary happy": the degree word before an adjective.
  {
    rule: TYPO,
    cue: ["vary"],
    pattern: `(?:am|is|are|was|were|be|been|(?:I|you|we|they|he|she|it|that)['’](?:m|re|s)|feel|feels|felt|look|looks|looked|seem|seems|seemed)${S}(?<target>vary)${S}(?<adj>[a-z]+)${E}`,
    fix: (m) => {
      const read = info(m.groups!.adj);
      return read?.adjective || read?.adverb ? "very" : null;
    },
  },
  { rule: TAG_QUESTION, cue: ["not", "t"], pattern: TAG, fix: (m) => tagFix(m) },
  // "a few moths ago", "in two moths": a count of moths is a time span here.
  {
    rule: TYPO,
    cue: ["moths", "moth"],
    pattern: `${MONTH_COUNT}${S}(?<target>moths)(?=${S}(?:ago|later|earlier|before|after|old|long|from${S}now)${E})`,
    fix: "months",
  },
  {
    rule: TYPO,
    cue: ["moths"],
    pattern: `(?:in|for|within|after|over|during)${S}(?:the${S}|a${S})?${MONTH_COUNT}${S}(?<target>moths)(?=[ \\t]*[.,;!?])`,
    fix: "months",
  },
  {
    rule: TYPO,
    cue: ["moth"],
    pattern: `(?:a|one|per|each|every|this|next|last)${S}(?<target>moth)(?=${S}(?:ago|later|earlier|before|after|old|long|from${S}now)${E})`,
    fix: "month",
  },
  // "I barley moved", "they were barley awake": barley as an adverb before a verb or adjective.
  {
    rule: TYPO,
    cue: ["barley"],
    pattern: `(?:${SUBJECT}|${MODAL}|am|is|are|was|were|had|has|have|did|could|['’](?:m|re|s|d|ve))${S}(?<target>barley)${S}(?<next>[a-z]+)${E}`,
    fix: (m) => {
      const next = m.groups!.next;
      const read = info(next);
      return /^(?:even|any|enough|able|there|ever|making|getting|know|knew)$/.test(next) ||
        (read && (read.verbs.length || read.adjective) && !read.plural)
        ? "barely"
        : null;
    },
  },
  // "I found anther problem": a determiner's slot, before a noun.
  {
    rule: TYPO,
    cue: ["anther"],
    pattern: `(?:found|find|need|needs|needed|had|have|has|is|was|['’]s|try|tried|yet|one|and|or|for|of|with|to|on|in|at|from|by|about|another|any)${S}(?<target>anther)${E}`,
    fix: (m, ctx) => {
      const next = nextWord(ctx, end(m));
      // The flower's anther: botany around it.
      const near = ctx.text.slice(Math.max(0, m.index - 120), m.index + 160);
      if (/pollen|stamen|filament|petal|flower|stigma/i.test(near)) return null;
      return next === "" || info(next)?.noun || /^(?:one|time|way|day)$/.test(next)
        ? "another"
        : null;
    },
  },
  // "wold wide web", "wold politics": the world (a wold is also an upland).
  {
    rule: TYPO,
    cue: ["wold"],
    pattern: `(?<target>wold)(?=${S}(?:wide${S}web|war|record|cup|peace|leader|leaders|economy|politics|history|map|population)${E})`,
    fix: "world",
  },
  // "It mans the world to me", "what he mans": the verb "means".
  {
    rule: TYPO,
    cue: ["mans"],
    pattern: `(?:it|this|that|which|what${S}(?:he|she|it|this|that))${S}(?<target>mans)${E}`,
    fix: (m, ctx) =>
      /^(?:a|an|the|that|to|nothing|something|everything|anything|so|much|more|less|you|me|him|her|us|them|it|business|well)$/i.test(
        nextWord(ctx, end(m)),
      ) || /^[ \t]*[.!?,;]/.test(ctx.text.slice(end(m), end(m) + 4))
        ? "means"
        : null,
  },
  // "I can due it", "Due you work today?": the verb "do".
  {
    rule: TYPO,
    cue: ["due"],
    pattern: `(?:${MODAL}|to|${NEGATION}|let['’]s|I|we|you|they)${S}(?<target>due)${S}(?:it|this|that|so|anything|something|nothing|everything|my${S}best|your${S}best|the${S}(?:dishes|job|work|same))${E}`,
    fix: "do",
  },
  {
    rule: TYPO,
    cue: ["due"],
    pattern: `(?=Due)(?<=(?:^|[.!?]["”’)]?[ \\t]{1,8}|\\n))(?<target>Due)${S}(?:you|we|they|I)${S}(?<verb>[a-z]+)${E}`,
    fix: (m) => (isVerb(m.groups!.verb, "base") ? "Do" : null),
  },
  // "Please us the side door", "will us their method": the verb "use".
  {
    rule: TYPO,
    cue: ["us"],
    pattern: `(?:${MODAL}|please|let['’]s|lets)${S}(?<target>us)${S}(?:the|a|an|his|her|their|my|your|our|its|this|these|those)${S}(?!(?:most|more|best|least|same|whole|rest)${E})[a-z]+`,
    fix: (m, ctx) =>
      /\b(?:give|gave|show|tell|told|send|sent)\s+$/i.test(
        ctx.text.slice(Math.max(0, m.index - 12), m.index),
      )
        ? null
        : "use",
  },
  // "It event works", "to event try": the adverb "even".
  {
    rule: TYPO,
    cue: ["event"],
    pattern: `(?:it|${MODAL}|to|not|n['’]t)${S}(?<target>event)${S}(?<next>[a-z]+)${E}`,
    fix: (m) => {
      const next = m.groups!.next;
      if (
        /^(?:based|driven|related|specific|free|triggered|handling|handler|planning|planner|organizer|management|loop|log|data|type|horizon|listener|queue|bus|stream|source|day|night)$/.test(
          next,
        )
      )
        return null;
      const read = info(next);
      return read && (read.verbs.some((v) => v.form !== "ing") || read.adjective || read.adverb)
        ? "even"
        : null;
    },
  },
  // "I can here you", "glad to here that": the verb "hear".
  {
    rule: TYPO,
    cue: ["here"],
    pattern: `(?:(?:can|could|cannot|can['’]t|couldn['’]t|almost|barely|hardly|to)${S})(?<target>here)${S}(?:you|me|him|her|them|us|it|that|this|what|about|from|of|anything|something|nothing|someone|somebody|footsteps|voices|music|noise)${E}`,
    fix: (m, ctx) => {
      const lead = /([A-Za-z']+)[ \t]+here/i.exec(m[0])?.[1].toLowerCase();
      // "to here from there", "moved to here": only "glad/nice/want to hear".
      if (
        lead === "to" &&
        !/\b(?:glad|nice|happy|sad|sorry|good|great|want|wants|wanted|like|love|hate|able|wait|surprised|pleased)[ \t]+$/i.test(
          ctx.text.slice(Math.max(0, m.index - 24), m.index),
        )
      )
        return null;
      return "hear";
    },
  },
  // "It bares repeating", "might bare repeating".
  {
    rule: TYPO,
    cue: ["bare", "bares", "bared"],
    pattern: `(?<target>bare|bares)${S}(?:repeating|repetition|mentioning|noting|fruit|witness|the${S}brunt|responsibility)${E}`,
    fix: (m) => (m.groups!.target.toLowerCase() === "bares" ? "bears" : "bear"),
  },
  // "I one had a car", "she ones told me": the adverb "once".
  {
    rule: TYPO,
    cue: ["one", "ones"],
    pattern: `(?:${SUBJECT}|it)${S}(?<target>ones?)${S}(?<verb>had|was|were|told|said|lived|worked|owned|knew|met|saw|went|made|wrote|played|thought|believed|loved)${E}`,
    fix: "once",
  },
  // "at he beginning", "to be he best": the article.
  {
    rule: TYPO,
    cue: ["he"],
    pattern: `(?:at|for|in|of|on|from|by|be|until|till)${S}(?<target>he)${S}(?:first|last|best|only|same|beginning|start|end|front|back|middle|whole|rest|top|bottom|next|latest|biggest|main)${E}`,
    fix: (m, ctx) =>
      // "for he first had to…": a clause after "for" (because) or "until".
      /^(?:had|was|is|did|has|would|will|could)$/.test(nextWord(ctx, end(m)).toLowerCase())
        ? null
        : "the",
  },
  // "we can discus it", "he discuses the plan": the verb, not the disc.
  {
    rule: TYPO,
    cue: ["discus", "discuses"],
    pattern: `(?:I|we|you|they|to|${MODAL}|${NEGATION}|let['’]s|please)${S}(?<target>discus)${S}(?:${OBJECT_START}|with|about|how|what|whether)${E}`,
    fix: "discuss",
  },
  {
    rule: TYPO,
    cue: ["discuses"],
    pattern: `(?:he|she|it|who|which|that|this)${S}(?<target>discuses)${S}(?:${OBJECT_START}|with|about|how|what|whether)${E}`,
    fix: "discusses",
  },
  // "I always loose my keys", "I'm loosing my job": the verb "lose".
  {
    rule: TYPO,
    cue: ["loose", "loosing"],
    pattern: `(?:${SUBJECT}|${MODAL}|to|${NEGATION}|always|often|sometimes|usually|keep|might|if${S}(?:I|you|we|they))${S}(?<target>loose)${S}(?:my|your|his|her|our|their|this|the${S}(?:password|key|keys|game|match|job|bet|war|battle|race)|track|sight|control|money|interest|faith|hope|touch)${E}`,
    fix: "lose",
  },
  {
    rule: TYPO,
    cue: ["loosing"],
    pattern: `(?<target>loosing)${S}(?:my|your|his|her|our|their|track|sight|control|money|interest|faith|hope|touch|the${S}(?:game|match|war|battle|race|job))${E}`,
    fix: "losing",
  },
  // "at a lose", "the lose of": the noun "loss".
  {
    rule: TYPO,
    cue: ["lose"],
    pattern: `(?:at${S}a${S}(?<target>lose)${S}(?:for|and|about|as|[.,;!?])|(?:the|a|great|big|huge|heavy|total|sudden)${S}(?<target2>lose)${S}of${E})`,
    fix: (m) => ({
      alternatives: ["loss"],
      range: m.indices!.groups!.target ?? m.indices!.groups!.target2,
    }),
  },
  // "complains from customers", "our biggest complain": the noun "complaint".
  {
    rule: TYPO,
    cue: ["complains", "complain"],
    pattern: `(?:are|were|of|no|any|many|several|few|some|these|those|biggest|main|common|only|frequent|formal|written|our|their|your|his|her|my)${S}(?<target>complains)(?=${S}(?:from|about|of|regarding|were|are|have|had)${E}|[ \\t]*[.,;!?])`,
    fix: "complaints",
  },
  {
    rule: TYPO,
    cue: ["complain"],
    pattern: `(?:biggest|main|common|only|frequent|formal|written|major|usual|first|last)${S}(?<target>complain)(?=${S}(?:from|about|of|regarding|was|is|has|had|among)${E}|[ \\t]*[.,;!?])`,
    fix: "complaint",
  },
  // "never heard of it, yet alone tried": "let alone".
  {
    rule: PHRASE,
    cue: ["yet"],
    pattern: `(?<!(?<![\\p{L}'’])(?:not|n['’]t|is|was|are|were|am|be|been|feel|felt|feels|still)${S})(?<target>yet${S}alone)${S}(?=[a-z])`,
    fix: (m, ctx) => {
      // "Not yet alone": only after a comma or a negative clause.
      const before = ctx.text.slice(Math.max(0, m.index - 80), m.index);
      return /,[ \t]*$|\.{2,}[ \t]*$|\b(?:never|not|n['’]t|no|nobody|nothing|hardly|barely|can['’]?t|cannot|idea)\b[^.!?]*$/i.test(
        before,
      )
        ? "let alone"
        : null;
    },
  },
  // "the former … the later": the second of two named things, a pronoun before its verb.
  {
    rule: TYPO,
    cue: ["later"],
    pattern: `(?<target>(?<the>the)${S}later)(?=${S}(?<next>[a-z]+)${E}|[ \\t]*[.,;])`,
    fix: (m, ctx) => {
      const next = m.groups!.next ?? "";
      const former = /\bformer\b/i.test(ctx.text.slice(Math.max(0, m.index - 300), m.index));
      const verb = LATTER_VERB.test(next);
      const adverb = /^(?:very|actually|also|often|always|never|usually|only|still|clearly)$/.test(
        next,
      );
      const after = adverb ? nextWord(ctx, end(m) + 1 + next.length) : "";
      const ok =
        verb ||
        (adverb && (LATTER_VERB.test(after) || isVerb(after, "third", "ing"))) ||
        (former && (next === "" || /^(?:in|on|for|as|because|since)$/.test(next)));
      return ok
        ? { alternatives: [`${m.groups!.the} latter`], range: m.indices!.groups!.target }
        : null;
    },
  },
  // "I have all ready bought it", "Peter all ready has": the adverb "already".
  {
    rule: TYPO,
    cue: ["ready"],
    pattern: `(?<lead>[A-Za-z]+(?:['’][a-z]+)?)${S}(?<target>all${S}ready)${S}(?<next>[a-z]+)${E}`,
    fix: (m) => {
      const { lead, next } = m.groups!;
      // A name owns its verb: "Peter all ready has".
      const name = /^[A-Z][a-z]+$/.test(lead) && /^(?:has|had|did|was)$/.test(next);
      if (!READY_LEAD.test(lead) && !name) return null;
      if (/^(?:to|for|and|or|now|set|here|there|by|when|at|in|on|with|so)$/.test(next)) return null;
      return /^(?:has|have|had|been|done|gone|seen|bought|made|taken|started|finished|left)$/.test(
        next,
      ) ||
        (isVerb(next, "participle", "ing", "base", "third", "past") && !info(next)?.noun)
        ? "already"
        : null;
    },
  },
  // "Can you attache a photo?": the verb; "please find attache" is "attached".
  {
    rule: TYPO,
    cue: ["attache"],
    pattern: `(?:${SUBJECT}|${MODAL}|to|please|${NEGATION}|really|also|just)${S}(?<target>attache)${S}(?:a|an|the|my|your|our|their|his|her|it|them|this|that|these|those|some|files?|photos?|images?|pictures?|documents?|screenshots?)${E}`,
    fix: (m, ctx) =>
      /\bfind[ \t]+$/i.test(ctx.text.slice(Math.max(0, m.index - 8), m.index + 1))
        ? null
        : "attach",
  },
  {
    rule: TYPO,
    cue: ["attache"],
    pattern: `find${S}(?<target>attache)${E}`,
    fix: "attached",
  },
  // "I think tat is right": the pronoun "that".
  {
    rule: TYPO,
    cue: ["tat"],
    pattern: `(?:think|thought|know|knew|say|said|believe|hope|guess|because|is|was)${S}(?<target>tat)${S}(?:is|was|it|the|a|I|you|we|they|he|she|this|there|one)${E}`,
    fix: "that",
  },
  // Compound nouns as verbs: "she has setup the tent", "I just setup a meeting", "who login".
  {
    rule: COMPOUND,
    cue: Object.keys(BASE),
    pattern: `(?:has|have|['’]ve)${S}(?:(?:just|already|never|not|finally|also)${S})?(?<target>${COMPOUND_VERBS})${S}(?:${OBJECT_START}|again|with|for|my|your)${E}`,
    fix: (m) => PARTICIPLE[m.groups!.target.toLowerCase()],
  },
  {
    rule: COMPOUND,
    cue: Object.keys(BASE),
    pattern: `(?:I|we|they|you)${S}(?:just|already|never|also|then|finally|first|quickly|always|usually)${S}(?<target>${COMPOUND_VERBS})${S}(?:${OBJECT_START}|again|with|for|to|before|after|using|here|now)${E}`,
    fix: (m) => BASE[m.groups!.target.toLowerCase()],
  },
  ...(
    [
      [LOG_IN, ["login"]],
      [SET_UP, ["setup"]],
      [COMPOUND, Object.keys(SLOT_BASE).filter((noun) => noun !== "login" && noun !== "setup")],
    ] as const
  ).map(([rule, nouns]): Frame => ({
    rule,
    cue: nouns,
    pattern: `${VERB_LEAD}${S}(?<target>${nouns.join("|")})${VERB_FOLLOW}`,
    fix: verbSlot(SLOT_BASE),
  })),
  {
    rule: COMPOUND,
    cue: Object.keys(SLOT_THIRD),
    pattern: `(?:he|she|it|who)${S}(?:(?:also|just|always|usually|never|often|rarely)${S})?(?<target>${Object.keys(SLOT_THIRD).join("|")})${VERB_FOLLOW}`,
    fix: verbSlot(SLOT_THIRD),
  },
];

/** Context detectors appended to REVIEW_DETECTORS. */
export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: ["englishPhraseCorrections", "englishContextualCompounds", "englishSentenceStructure"],
    detect: frameDetector(FRAMES),
  },
];
