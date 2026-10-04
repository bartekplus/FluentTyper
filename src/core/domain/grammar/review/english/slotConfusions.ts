import { englishListedNoun, englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { PhraseRow } from "../englishPhraseTables";
import { SPACE as S, WORD_END as E } from "../phraseTemplates";
import type { DetectContext, ReviewDetectorEntry } from "../reviewDetectors";
import { FUNCTION_WORDS } from "./slotWords";
import {
  COMPOUND,
  CONTEXT,
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

const TAG_QUESTION: Rule = {
  ruleId: "englishSentenceStructure",
  messageKey: "review_msg_tag_question",
};

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
  ["couldn't careless", "couldn't care less"],
  ["could not careless", "could not care less"],
  ["could careless", "could care less"],
  ["might has well", "might as well"],
  ["may has well", "may as well"],
  ["half an our", "half an hour"],
  ...["ago", "later", "earlier", "away", "long", "or two", "or so"].map((tail): PhraseRow => [
    `an our ${tail}`,
    `an hour ${tail}`,
  ]),
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
  // Set phrases with a real word typed for its neighbour.
  ["save and sound", "safe and sound"],
  ["safe the date", "save the date"],
  ["in any from", "in any form"],
  ["with all do respect", "with all due respect"],
  ["health car", "health care"],
  [
    ["consolation price", "consolation prices"],
    ["consolation prize", "consolation prizes"],
  ],
  [["nobel price", "noble prize"], "Nobel Prize"],
  ["nobel prices", "Nobel Prizes"],
  ["by any mans", "by any means"],
  ["by all mans", "by all means"],
  ["by no mans", "by no means"],
  ["by mans of", "by means of"],
  ["ever once in a while", "every once in a while"],
  ["happily every after", "happily ever after"],
  ["bet wishes", "best wishes"],
  ["first off all", "first of all"],
  ["of the top of my head", "off the top of my head"],
  ["comprise of", ["comprise", "consist of"]],
  ...["look", "looks", "looked", "looking"].flatMap((look) =>
    ["that", "this", "it"].map((what): PhraseRow => [
      `${look} in to ${what}`,
      `${look} into ${what}`,
    ]),
  ),
  ...["split", "divided", "translated", "converted"].map((verb): PhraseRow => [
    `${verb} in to`,
    `${verb} into`,
  ]),
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
// A modal opening its sentence asks about a noun: "Would login work here?"
const VERB_LEAD = `(?:(?<!(?:^|[.!?]["”’)]?[ \\t]{1,8}|\\n))(?:${MODAL})|please|${NEGATION}|who|let${S}(?:me|us|them|him|her)|(?:I|we|they|you)|(?:can|could|will|would|should|do|does|did|can['’]t|won['’]t|don['’]t|doesn['’]t|didn['’]t|wouldn['’]t|couldn['’]t)${S}(?:I|you|we|they|he|she|it)|(?:${INFINITIVE_LEAD})${S}to|(?:${INFINITIVE_LEAD})${S}(?:[\\p{L}'’]+${S}){1,2}to)`;
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

// "I stop here, aren't I?", "He's crazy, doesn't he?": after a positive clause the tag negates
// the clause's own auxiliary: be after be, do (in its tense and person) after a lexical verb.
const NEGATIVE_TAG = `(?<![\\p{L}'’])(?<subject>I|you|we|they|he|she|it)(?<verb>['’](?:m|re|s)|${S}(?:(?:always|usually|often|really|just|also|still|never)${S})?[a-z]+)(?=[^.!?,;:\\n]{0,60},${S}(?:aren|isn|wasn|weren|don|doesn|didn)['’]t)[^.!?,;:\\n]{0,60},${S}(?<target>(?<aux>aren['’]t|isn['’]t|wasn['’]t|weren['’]t|don['’]t|doesn['’]t|didn['’]t)${S}(?<pron>I|you|we|they|he|she|it))${E}(?=[ \\t]*\\?)`;

function negativeTagFix(m: RegExpExecArray): FixResult {
  const { subject, verb, aux, pron } = m.groups!;
  const p = pron.toLowerCase();
  if (subject.toLowerCase() !== p) return null;
  // A negated clause takes a positive tag: tagFix's frame.
  if (/n['’]t|\b(?:not|never|no)\b/i.test(m[0].slice(0, m[0].length - m.groups!.target.length)))
    return null;
  const single = /^(?:he|she|it)$/.test(p);
  const word = verb
    .trim()
    .toLowerCase()
    .split(/[ \t\u00a0]+/)
    .pop()!
    .replaceAll("’", "'");
  let tag: string;
  if (word === "'m" || word === "am") tag = "aren't";
  else if (word === "'re" || word === "are") tag = "aren't";
  else if (word === "'s" || word === "is") {
    // "He's got a car, hasn't he?": 's is has before a participle.
    const next = /^[ \t ]+([a-z]+)/.exec(m[0].slice(m.groups!.subject.length + verb.length))?.[1];
    const read = next ? englishWordInfo(next) : null;
    if (word === "'s" && read?.verbs.some((v) => v.form === "participle") && !read.adjective)
      return null;
    tag = "isn't";
  } else if (word === "was") tag = "wasn't";
  else if (word === "were") tag = "weren't";
  else {
    const read = englishWordInfo(word);
    if (!read?.verbs.length || FUNCTION_WORDS.has(word)) return null;
    const forms = new Set(read.verbs.map((v) => v.form));
    // The verb must agree with the subject: "you know", "he knows", "I knew".
    if (forms.has("past") && !forms.has("base")) tag = "didn't";
    else if (single ? forms.has("third") : forms.has("base") && !forms.has("third"))
      tag = single ? "doesn't" : "don't";
    else return null;
  }
  const typed = aux.toLowerCase().replaceAll("’", "'");
  if (typed === tag) return null;
  return `${aux.includes("’") ? tag.replaceAll("'", "’") : tag} ${pron}`;
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

const ID_VERB =
  "rather|probably|like|love|hate|be|have|never|just|prefer|preferred|better|already|definitely|also|really|say|been|gladly|appreciate|want|go|need|imagine|recommend|suggest|bet|do|get|try|still|always|only|certainly|happily|guess";
const CASING: Rule = { ruleId: "englishCanonicalCasing", messageKey: "review_msg_name_casing" };
const YOUR: Rule = { ruleId: "englishYourYouAre", messageKey: "review_msg_your_possessive" };

// "you" before a singular noun that its verb follows: "you car was stolen" -> "your car".
// Not after verbs that take "you" and a clause ("I told you dad is home"), not "what you
// need is", and never a person addressed ("you guys", "you idiot").
export const YOU_CLAUSE_VERBS =
  /^(?:tell|tells|told|telling|show|shows|showed|remind|reminds|reminded|assure|assured|promise|promised|warn|warned|inform|informed|bet|guarantee|guaranteed|ask|asked|teach|taught|convince|convinced|notify|notified|let|lets|thank|thanks|give|gave|given|send|sent|bring|brought|owe|owed|offer|offered|wish|wished|call|called|make|made|get|got|buy|bought|pay|paid|cost|save|saved|charge|charged|see|saw|seen|hear|heard|mean|meant|know|knew|think|thought|believe|suppose)$/;
export const ADDRESSED =
  /^(?:guy|guys|idiot|fool|dummy|moron|genius|darling|honey|baby|sir|madam|man|dude|bro|mate|sis|buddy|pal|lot|kid|boy|girl|people|folks|all|both|two|three|alone|yourself|there|here|too|also|something|anything|nothing|everything|everyone|anyone|someone|one|ones|each|most|now|then|again|later|soon|today|tonight|first|last|instead|anyway|maybe|perhaps|men|women|children|ladies|gentlemen)$/;
const YOU_FINITE =
  /^(?:will|would|can|could|may|might|must|should|shall|is|was|has|does|did|isn['’]t|wasn['’]t|hasn['’]t|doesn['’]t|didn['’]t|won['’]t|can['’]t|got|seems|looks|needs|works|stopped|broke|died)$/;
function yourNoun(
  ctx: DetectContext,
  at: number,
  adj: string | undefined,
  noun: string,
  strict: boolean,
  listed = false,
): boolean {
  if (noun !== noun.toLowerCase() || ADDRESSED.test(noun) || ctx.dictionary.has(noun)) return false;
  // "You might has well…": a modal before a mistyped "as well".
  if (!adj && /^(?:might|may|can|must)$/.test(noun)) return false;
  if (adj) {
    const a = info(adj);
    if (!a?.adjective || a.verbs.length || /^(?:own|only|alone)$/i.test(adj)) return false;
  }
  const read = info(noun);
  // A plain noun only: "you recall", "you still", "you new" read otherwise. A long noun the
  // lexicon lists as a plain noun ("information") counts.
  if (!read && (listed || !strict) && englishListedNoun(noun) === "singular") {
    const before = /([A-Za-z]+)[ \t ]+$/.exec(ctx.text.slice(Math.max(0, at - 24), at))?.[1];
    return !before || !YOU_CLAUSE_VERBS.test(before.toLowerCase());
  }
  if (!read?.noun || read.plural || read.adjective || read.adverb) return false;
  if (strict && read.verbs.some((v) => v.form === "base")) return false;
  const before = /([A-Za-z]+)[ \t ]+$/.exec(ctx.text.slice(Math.max(0, at - 24), at))?.[1];
  return !before || !YOU_CLAUSE_VERBS.test(before.toLowerCase());
}
const COLLECTIVE_NOUN = /^(?:team|family|staff|crew|class|group|company|band|club|department)$/;
/** The noun after "you" (with an optional adjective) and the word after it, both readings. */
function youReadings(m: RegExpExecArray): [string | undefined, string, string | undefined][] {
  const { w1, w2, w3 } = m.groups!;
  return [
    [undefined, w1, w2],
    [w1, w2, w3],
  ];
}

const FRAMES: readonly Frame[] = [
  // "I found anther problem": "another" after a verb or preposition (the flower's anther
  // follows "the", an adjective or a list comma).
  {
    rule: TYPO,
    cue: ["anther"],
    pattern: `(?:found|find|see|saw|seen|add|have|has|had|need|want|got|get|buy|try|take|use|make|give|is|was|there['’]s|here['’]s|meant|mean|emailing|send|sending|write|wrote|and|or|just|also|still|for|with|from|to|at|into)${S}(?<target>anther)(?=[ \\t]*[.!?,;:]|${S}[a-z]+${E})`,
    fix: (m) => (m.groups!.target === "anther" ? "another" : null),
  },
  // "Many tanks for your help", "Tank you": "thanks", "thank".
  {
    rule: TYPO,
    cue: ["tank", "tanks"],
    pattern: `(?:(?<=(?:^|[.!?]["”’)]?[ \\t]{1,8}|\\n))(?<target>tanks)${S}(?:so${S}much|a${S}lot|for${S}(?:your|the|all|nothing|everything|helping|coming|this|that|it)|again)|many${S}(?<target2>tanks)${S}for)${E}`,
    fix: (m) => {
      const g = m.indices!.groups!;
      return { alternatives: ["thanks"], range: g.target ?? g.target2 };
    },
  },
  {
    rule: TYPO,
    cue: ["tank"],
    pattern: `(?<=(?:^|[.!?,]["”’)]?[ \\t]{1,8}|\\n))(?<target>tank)${S}you(?=[ \\t]*[.!?,]|${S}(?:very|so|for|all)${E})`,
    fix: "thank",
  },
  // "Thank, that helps", "Many thank for", "Thank to the rain": "thanks".
  {
    rule: TYPO,
    cue: ["thank"],
    pattern: `(?:(?<=(?:^|[.!?]["”’)]?[ \\t]{1,8}|\\n))(?<target>thank)(?=[ \\t]*[,!]|${S}to${E})|many${S}(?<target2>thank)${S}for)${E}`,
    fix: (m) => {
      const g = m.indices!.groups!;
      return { alternatives: ["thanks"], range: g.target ?? g.target2 };
    },
  },
  // "It's not save to eat", "Are we save?", "feel save": the adjective "safe".
  {
    rule: TYPO,
    cue: ["save"],
    pattern: `(?:(?:is|was|are|were|it['’]s|isn['’]t|wasn['’]t|aren['’]t|feel|feels|felt|stay|stays|stayed|be|been|am)(?:${S}not)?(?:${S}(?:very|so|too|completely|totally|perfectly|quite|really))?|(?:is|are|am)${S}(?:it|that|this|we|I|you|they|he|she))${S}(?<target>save)(?=[ \\t]*[.!?]|${S}(?:to|for|in|here|there|from|enough|now)${E})`,
    fix: "safe",
  },
  {
    rule: TYPO,
    cue: ["safes"],
    pattern: `(?<target>safes)${S}(?:my|your|his|her|our|their|the|lives|time|money)${E}`,
    fix: "saves",
  },
  // "Lets all go home", "Now lets leave": the suggestion "let's".
  {
    rule: TYPO,
    cue: ["lets"],
    pattern: `(?:(?<=(?:^|[.!?,;:]["”’)]?[ \\t]{1,8}|\\n))|(?:now|so|ok|okay|but|and|then|please)${S})(?<target>lets)${S}(?:all|just|go|do|get|try|see|make|take|start|stay|leave|have|be|not|keep|finally|hope|say|talk|meet|move|wait|eat|play|celebrate|focus|begin|find|check|look|put)${E}`,
    fix: (m) =>
      m.groups!.target === "Lets" ? "Let's" : m.groups!.target === "lets" ? "let's" : null,
  },
  // "Learn how to us a semicolon": the verb "use".
  {
    rule: TYPO,
    cue: ["us"],
    pattern: `(?:going|have|has|had|need|needs|needed|want|wants|wanted|required|able|how|try|trying|tried|easy|hard|free|ready|decided)${S}to${S}(?<target>us)${S}(?:a|an|the|this|that|it|them|my|your|our|their|his|her|some|any)${E}`,
    fix: "use",
  },
  // "the number or workers", "a list or guidelines": "of".
  {
    rule: TYPO,
    cue: ["or"],
    // Not "the number or types of sounds": two heads sharing "of".
    pattern: `number${S}(?<target>or)${S}(?<n>[a-z]{3,}s)${E}(?=[ \\t]*[.,:;]|${S}(?:who|that|which|by|per|in|on|for|at|is|are|was|were|has|have)${E})`,
    fix: (m) => (info(m.groups!.n)?.plural || info(m.groups!.n.slice(0, -1))?.noun ? "of" : null),
  },
  // "one if the best", "a couple if days", "if course": "of".
  {
    rule: TYPO,
    cue: ["if"],
    pattern: `(?:one${S}(?<target>if)${S}the${S}(?:most|best|worst|biggest|largest|few|first|last|main|top|greatest|only|many)|(?:couple|lots?|bunch|(?:this|that|what|some|any|the|a)${S}(?:kind|sort))${S}(?<target2>if)${S}(?!(?:you|I|we|they|he|she|it)${E})[a-z])`,
    fix: (m) => {
      const g = m.indices!.groups!;
      return { alternatives: ["of"], range: g.target ?? g.target2 };
    },
  },
  {
    rule: TYPO,
    cue: ["if"],
    pattern: `(?<target>if)${S}course(?=[ \\t]*[.!?,])`,
    fix: "of",
  },
  // "drop by an see", "the cards an chips": "and" before a word no article takes.
  {
    rule: TYPO,
    cue: ["an"],
    pattern: `(?<![.,;:!?][ \\t]{0,8})(?<target>an)${S}(?<w>[b-df-hj-np-tv-z][a-z]+)${S}(?:what|where|how|the|a|an|another|other|it|them|some|my|your|his|her|our|their|this|that|if|whether)${E}`,
    fix: (m) => {
      if (m.groups!.target !== "an") return null;
      const read = info(m.groups!.w);
      if (!read) return null;
      const verbOnly =
        /^(?:see|do|go|get|make|take|join|try|play|eat|run|say|tell|ask|stay|leave|come|look|watch|keep|give|send|bring|call)$/.test(
          m.groups!.w,
        ) ||
        (!read.noun &&
          !read.adjective &&
          !read.adverb &&
          read.verbs.some((v) => v.form === "base"));
      return verbOnly ? "and" : null;
    },
  },
  // "Fill in this from", "a letter form my friend": "form" and "from" swapped.
  {
    rule: TYPO,
    cue: ["from"],
    // Not "Where is this from?": a stranded preposition ends many questions.
    pattern: `(?:fill${S}(?:in|out)|submit|complete|sign|in)${S}(?:this|that|the|our|your|a)${S}(?<target>from)(?=[ \\t]*[.!?]|${S}(?:on|below|above)${E})`,
    fix: "form",
  },
  {
    rule: TYPO,
    cue: ["form"],
    pattern: `(?:letter|email|message|gift|income|money|news|greetings|hello)${S}(?<target>form)${S}(?:my|your|his|her|our|their|the|this|him|them|us)${E}`,
    fix: "from",
  },
  // "I am so curios", "Are you curios?": "curious" (curios are trinkets).
  {
    rule: TYPO,
    cue: ["curios"],
    pattern: `(?:so|very|am|are|is|was|were|be|been|really|just|too|quite|pretty|extremely|['’]m|['’]re)${S}(?<target>curios)(?=[ \\t]*[.!?,]|${S}(?:if|what|about|to|whether|why|how|person|people|cat|child|kid|mind|one)${E})`,
    fix: "curious",
  },
  // "I red a book", "have red the email": "read".
  {
    rule: TYPO,
    cue: ["red"],
    pattern: `(?:I|you|we|they|he|she|can|could|will|would|should|have|has|had|didn['’]t|don['’]t|to|never|already|just)${S}(?<target>red)${S}(?:a|an|the|this|that|it|my|your|his|their|our|about|some|books?|articles?|emails?|messages?|reviews?)${E}`,
    fix: "read",
  },
  // "I will past it into the field": "paste".
  {
    rule: TYPO,
    cue: ["past"],
    pattern: `(?:will|can|could|would|should|to|then|just|and|I|you|we|they|users|please)${S}(?<target>past)${S}(?:(?:it|this|that|them|text|code|the${S}[a-z]+|your${S}[a-z]+|my${S}[a-z]+)${S})?(?:into|in${S}(?:the|a|your|my)|here)${E}`,
    fix: "paste",
  },
  // "it's event possible", "Event I make mistakes": "even".
  {
    rule: TYPO,
    cue: ["event"],
    pattern: `(?:(?:it['’]s|is|was|isn['’]t|wasn['’]t|get|be|not)${S}(?<target>event)${S}(?:possible|impossible|more|less|better|worse|usually|harder|easier|bigger|though|if|when|after)|(?<=(?:^|[.!?]["”’)]?[ \\t]{1,8}|\\n|(?:but|and)[ \\t]{1,8}))(?<target2>[Ee]vent)${S}(?:I|we|you|they|he|she|if|though|so|now))${E}`,
    fix: (m) => {
      const g = m.indices!.groups!;
      return { alternatives: ["even"], range: g.target ?? g.target2 };
    },
  },
  // "closed do to the storm": "due to".
  {
    rule: TYPO,
    cue: ["do"],
    pattern: `(?:close|closed|closing|is|was|are|were|delayed|cancelled|canceled|postponed|there|mainly|partly|largely|probably|possibly)${S}(?<target>do${S}to)${S}(?:the|a|an|covid|bad|heavy|high|low|his|her|their|our|my|its|this|that|lack|[a-z]{2,})`,
    fix: "due to",
  },
  // "on may different fronts", "May thanks": "many"; "cancel may subscription": "my".
  {
    rule: TYPO,
    cue: ["may"],
    pattern: `(?:(?:on|in|so|too|how|and|very|for|of|with)${S}(?<target>may)${S}(?:different|more|other|people|times|ways|years|things|reasons|of${S}(?:them|us|you|the))|(?<=(?:^|[.!?]["”’)]?[ \\t]{1,8}|\\n))(?<target2>May)${S}thanks)${E}`,
    fix: (m) => {
      const g = m.indices!.groups!;
      if (g.target && m.groups!.target !== "may") return null;
      return { alternatives: ["many"], range: g.target ?? g.target2 };
    },
  },
  {
    rule: TYPO,
    cue: ["may"],
    pattern: `(?:cancel|on|in|to|from|with|for|of|at|into)${S}(?<target>may)${S}(?:subscription|account|list|head|mind|life|house|car|phone|computer|wife|husband|mother|father|order|name|email|friend|friends|family|job|own)${E}`,
    fix: (m) => (m.groups!.target === "may" ? "my" : null),
  },
  // "I ave no idea", "should ave been": "have".
  {
    rule: TYPO,
    cue: ["ave"],
    pattern: `(?:(?:I|you|we|they|should|could|would|will|must|might|to)${S}(?<target>ave)${S}(?:been|no|a|an|the|to|many|any|some|it|this|that|done|seen|had|got|known|gone|made|taken|told|said|thought)|(?<=(?:^|[.!?]["”’)]?[ \\t]{1,8}|\\n))(?<target2>Ave)${S}(?:you|we|they)${S}(?:been|got|seen|had|done|ever))${E}`,
    fix: (m) => {
      const g = m.indices!.groups!;
      return { alternatives: ["have"], range: g.target ?? g.target2 };
    },
  },
  // "Send it to is.": "us"; "That us so cool": "is".
  {
    rule: TYPO,
    cue: ["is"],
    pattern: `(?:to|with|for|from|believes|believe|told|gave|give|send|sent|join|help)${S}(?<target>is)(?=[ \\t]*[.!?])`,
    fix: "us",
  },
  {
    rule: TYPO,
    cue: ["us"],
    pattern: `(?:he|she|that|this|there|what)${S}(?<target>us)${S}(?:going|so|right|wrong|not|very|good|great|true|fine|ok|okay|done|coming)${E}`,
    fix: "is",
  },
  // "Take car!": "care".
  {
    rule: TYPO,
    cue: ["car"],
    pattern: `take${S}(?<target>car)(?=[ \\t]*[.!?,]|[ \\t]*$)`,
    fix: "care",
  },
  // "We have these to problems", "the to new developers": "two".
  {
    rule: TYPO,
    cue: ["to"],
    pattern: `(?:the|these|those|first|last|next|only|other)${S}(?<target>to)${S}(?:new|old|main|other|different|big|small|problems|issues|options|people|ones|developers|things|days|weeks|years|times|charts|files)${E}`,
    fix: "two",
  },
  // "He cam to help", "Can you com and help": "came", "come".
  {
    rule: TYPO,
    cue: ["cam"],
    pattern: `(?:he|she|it|they|we|I|you)${S}(?<target>cam)${S}(?:to|here|home|back|in|over|out|up|down|across)${E}`,
    fix: "came",
  },
  {
    rule: TYPO,
    cue: ["com"],
    pattern: `(?:can|could|will|would|to|please|has|have|had|you)${S}(?<target>com)${S}(?:and|to|here|home|back|in|over|with|along|up)${E}`,
    fix: "come",
  },
  // "It is really hart", "a hart time": "hard".
  {
    rule: TYPO,
    cue: ["hart"],
    pattern: `(?:really|very|so|too|it|be|is|was|a|pretty|quite)${S}(?<target>hart)(?=[ \\t]*[.!?,]|${S}(?:to|time|times|work|day|days|thing|one|part)${E})`,
    fix: "hard",
  },
  // "the wurst case", "the wurst is yet to come": "worst".
  {
    rule: TYPO,
    cue: ["wurst"],
    pattern: `the${S}(?<target>wurst)${S}(?:case|scenario|thing|part|day|time|player|game|movie|idea|ever|of${S}(?:all|the|it|them)|I${S}(?:have|had|ever)|is${S}yet)${E}`,
    fix: "worst",
  },
  // "Than you for your help": "Thank you".
  {
    rule: TYPO,
    cue: ["than"],
    pattern: `(?:(?<=(?:^|[.!?,]["”’)]?[ \\t]{1,8}|\\n))|(?:say|but|and|just|oh|ok|okay)${S})(?<target>than)${S}you(?=[ \\t]*[.!?,]|${S}(?:so|very|for|all)${E})`,
    fix: "thank",
  },
  // "She ads value", "would ad a new one": "adds", "add".
  {
    rule: TYPO,
    cue: ["ad"],
    pattern: `(?:I|you|we|they|would|wouldn['’]t|could|can|will|should|usually|always|please|just|also)${S}(?<target>ad)${S}(?:a|an|the|some|more|it|them|this|that|ketchup|salt|sugar|value|to)${E}`,
    fix: "add",
  },
  {
    rule: TYPO,
    cue: ["ads"],
    pattern: `(?:he|she|it|this|which|who)${S}(?:(?:also|really|usually|always)${S})?(?<target>ads)${S}(?:a|an|the|some|more|value|to|up)${E}`,
    fix: "adds",
  },
  // "I have work to due", "All I can due is": "do".
  {
    rule: TYPO,
    cue: ["due"],
    pattern: `(?:can|could|will|would|should|must|to|didn['’]t|don['’]t)${S}(?<target>due)(?=[ \\t]*[.!?]|${S}(?:is|his|her|my|your|their|our|it|this|that|the${S}(?:dishes|work|job|homework|same)|what|something|anything|nothing)${E})`,
    fix: "do",
  },
  // "Be quite!", "a quite word": "quiet"; "I am quiet sure": "quite".
  {
    rule: TYPO,
    cue: ["quite"],
    pattern: `(?:be${S}(?<target>quite)(?=[ \\t]*[.!])|a${S}(?<target2>quite)${S}(?:word|place|night|evening|room|moment|life|spot|street|corner|neighborhood|neighbourhood|town|village|weekend|voice)${E})`,
    fix: (m) => {
      const g = m.indices!.groups!;
      return { alternatives: ["quiet"], range: g.target ?? g.target2 };
    },
  },
  {
    rule: TYPO,
    cue: ["quiet"],
    pattern: `(?:am|is|are|was|were|['’]s|['’]m|['’]re)${S}(?<target>quiet)${S}(?:sure|new|different|right|simple|easy|difficult|interesting|good|nice|certain)${E}`,
    fix: "quite",
  },
  // "I loss a friend", "could loss his life", "always losses his keys", "a lose tooth".
  {
    rule: TYPO,
    cue: ["loss"],
    pattern: `(?<lead>I|you|we|they|he|she|could|would|will|can|might|to|not|never|didn['’]t|don['’]t)${S}(?<target>loss)${S}(?:a|an|the|my|your|his|her|their|our|it|them|weight|money|time|control|track|interest|sight|hope|games?|friends?|football)${E}`,
    fix: (m) => {
      const lead = m.groups!.lead.toLowerCase();
      if (/^(?:he|she)$/.test(lead)) return "lost";
      return /^(?:i|you|we|they)$/.test(lead) ? ["lost", "lose"] : "lose";
    },
  },
  {
    rule: TYPO,
    cue: ["losses"],
    pattern: `(?:he|she|it|always|never|usually|often)${S}(?<target>losses)${S}(?:his|her|its|their|the|a|my)${E}`,
    fix: "loses",
  },
  {
    rule: TYPO,
    cue: ["lose"],
    pattern: `(?:a|the)${S}(?<target>lose)${S}(?:tooth|thread|end|ends|screw|connection|wire|cable|cannon|fit|leaf|grip)${E}`,
    fix: "loose",
  },
  // "I hope to here from you": "hear".
  {
    rule: TYPO,
    cue: ["here"],
    pattern: `(?:to|don['’]t|do${S}not|won['’]t|didn['’]t|will|would|can|could|never)${S}(?<target>here)${S}from${S}(?:you|me|him|her|them|us)${E}`,
    fix: "hear",
  },
  // "received your massage", "sent different massages": "message".
  {
    rule: TYPO,
    cue: ["massage", "massages"],
    pattern: `(?:received|got|read|sent|forwarded|deleted|answered|reply${S}to|answer${S}to)${S}(?:(?:your|my|his|her|our|their|the|different|several|many|some|two|three)${S})?(?:(?:last|previous|earlier|recent|text|voice)${S})?(?<target>massages?)${E}`,
    fix: (m) => (/s$/.test(m.groups!.target) ? "messages" : "message"),
  },
  // "against his principals", "principals of the Constitution": "principles".
  {
    rule: TYPO,
    cue: ["principals"],
    pattern: `(?:(?:against|to|with)${S}(?:my|his|her|your|our|their)${S}(?<target>principals)|(?<target2>principals)${S}of${S}the${S}(?:constitution|law|physics|design|democracy|game|faith))${E}`,
    fix: (m) => {
      const g = m.indices!.groups!;
      return { alternatives: ["principles"], range: g.target ?? g.target2 };
    },
  },
  // "That peaked my interest": "piqued".
  {
    rule: TYPO,
    cue: ["peaked", "peeked", "peaks", "peeks", "peaking", "peeking"],
    pattern: `(?<target>peaked|peeked|peaks|peeks|peaking|peeking)${S}(?:(?:my|your|his|her|their|our|the|public|everyone['’]s|[a-z]+['’]s?)${S})?(?:(?:intense|lasting|and|immediate|keen|own|constitutional|judges['’]?)${S})*(?:interest|curiosity|attention|suspicions?)${E}`,
    fix: (m) => {
      const typed = m.groups!.target.toLowerCase();
      // The phrase table owns "peaked my interest" and its siblings.
      if (/^peak\w*\s+(?:my|your|his|her|our|their)\s+interest$/i.test(m[0])) return null;
      return /ed$/.test(typed) ? "piqued" : /s$/.test(typed) ? "piques" : "piquing";
    },
  },
  // "I did not man to", "what we man?": "mean".
  {
    rule: TYPO,
    cue: ["man"],
    pattern: `(?:(?:not|didn['’]t|don['’]t|doesn['’]t|never)${S}(?<target>man)${S}to|what${S}(?:we|you|they|I|he|she)${S}(?<target2>man)(?=[ \\t]*[?.]))${E}`,
    fix: (m) => {
      const g = m.indices!.groups!;
      return { alternatives: ["mean"], range: g.target ?? g.target2 };
    },
  },
  // "the greatest jokes every told", "would every be": "ever".
  {
    rule: TYPO,
    cue: ["every"],
    pattern: `(?:(?:greatest|best|worst|biggest|first|only|most|least)${S}(?:[a-z]+${S})?(?<target>every)${S}(?:told|made|seen|written|lived|played|recorded|built|created|sold|produced|known)|(?:would|could|will|can|might|should|if|hardly|nor)${S}(?<target2>every)${S}(?:be|been|get|see|happen|make|want|need|seen|go|come|find|know|use))${E}`,
    fix: (m) => {
      const g = m.indices!.groups!;
      return { alternatives: ["ever"], range: g.target ?? g.target2 };
    },
  },
  // "All the bet", "wish you the bet": "best".
  {
    rule: TYPO,
    cue: ["bet"],
    pattern: `(?:all${S}the${S}(?<target>bet)(?=[ \\t]*[.!,]|[ \\t]*$)|wish${S}(?:you|him|her|them|us)${S}(?:all${S})?the${S}(?<target2>bet))${E}`,
    fix: (m) => {
      const g = m.indices!.groups!;
      return { alternatives: ["best"], range: g.target ?? g.target2 };
    },
  },
  // "As off yesterday", "aware off.": "of"; "pulled of an upset": "off".
  {
    rule: TYPO,
    cue: ["off"],
    pattern: `(?:as${S}(?<target>off)${S}(?:yesterday|today|now|tomorrow|this|last|next|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|june|july|august|september|october|november|december|[0-9])|aware${S}(?<target2>off)(?=[ \\t]*[.!?]))${E}`,
    fix: (m) => {
      const g = m.indices!.groups!;
      return { alternatives: ["of"], range: g.target ?? g.target2 };
    },
  },
  {
    rule: TYPO,
    cue: ["of"],
    pattern: `(?:pulled|pull|pulls|pulling)${S}(?<target>of)${S}(?:an?|the)${S}(?:upset|win|victory|trick|stunt|heist|miracle|comeback)${E}`,
    fix: "off",
  },
  // "If you car was stolen", "You new coat is dirty": "your" before the subject's noun.
  {
    rule: YOUR,
    cue: ["you"],
    pattern: `(?<lead>(?<=(?:^|[.!?,;:]["”’)]?[ \\t]{1,8}|\\n))|(?:if|when|because|and|but|then|now|otherwise|so|until|unless|since|whether|while|that)${S})(?<target>you)${S}(?<w1>[a-z]+)${S}(?<w2>[a-z]+(?:['’]t)?)(?:${S}(?<w3>[a-z]+(?:['’]t)?))?${E}`,
    fix: (m, ctx) => {
      // "if you recall was", "that you need is": inside a sentence only a noun that is no verb,
      // unless a mental verb is ruled out ("if you phone is dead").
      const strict = !!m.groups!.lead;
      const mental =
        /^(?:recall|remember|know|think|believe|see|say|mean|guess|ask|want|like|need|do|get|feel|hear|expect|suppose|said|knew|thought)$/;
      const at = m.indices!.groups!.target[0];
      return youReadings(m).some(
        ([adj, noun, verb]) =>
          !!verb &&
          YOU_FINITE.test(verb.toLowerCase()) &&
          yourNoun(
            ctx,
            at,
            adj,
            noun,
            strict &&
              !(
                !adj &&
                /^(?:is|was|has)$/i.test(verb) &&
                !mental.test(noun) &&
                /^(?:if|because|since|so|and|but)\b/i.test(m.groups!.lead ?? "")
              ),
            true,
          ),
      )
        ? "your"
        : null;
    },
  },
  // "Did you team check it?", "Will you driver pick us up?": an inverted question.
  {
    rule: YOUR,
    cue: ["you"],
    pattern: `(?<aux>did|does|do|didn['’]t|doesn['’]t|don['’]t|will|would|could|can|should|has|have)${S}(?<target>you)${S}(?<w1>[a-z]+)${S}(?<w2>[a-z]+)(?:${S}(?<w3>[a-z]+))?${E}`,
    fix: (m, ctx) => {
      const at = m.indices!.groups!.target[0];
      // "does you" and "has you" never pair with the pronoun: a noun that is also a verb fits.
      const strict = !/^(?:does|doesn['’]t|has)$/i.test(m.groups!.aux);
      const base = (word: string | undefined) =>
        word === "be" ||
        (!!word && !!info(word)?.verbs.some((v) => v.form === "base") && !info(word)!.plural);
      return youReadings(m).some(
        ([adj, noun, verb]) =>
          base(verb) &&
          // "Do you grammar check…": plural do takes no singular noun, save a group ("team").
          (!/^(?:do|don['’]t)$/i.test(m.groups!.aux) || COLLECTIVE_NOUN.test(noun)) &&
          yourNoun(ctx, at, adj, noun, strict && verb !== "be"),
      )
        ? "your"
        : null;
    },
  },
  // "Thank you for you time.", "Have you done you homework yet?": an owned noun ends the phrase.
  {
    rule: YOUR,
    cue: ["you"],
    pattern: `(?:for|at|about|on|with|from|not|done|did|finished|lost|found|forgot|hug|hugged|wash|washed|clean|cleaned|update|updated|(?:you|I|we|they)${S}have)${S}(?<target>you)${S}(?<w1>[a-z]+)(?:${S}(?!(?:yet|with|already|today|now|first|and|or|of)${E})(?<w2>[a-z]+))?(?<end>[ \\t\\u00a0]*[.!?,;:]|${S}(?:yet|with|already|today|now|first|and|or|of)${E})`,
    fix: (m, ctx) => {
      const at = m.indices!.groups!.target[0];
      const { w1, w2, end } = m.groups!;
      // "This is for you mom!": a person addressed at the end.
      if (
        /[.!?,;:]/.test(end) &&
        /^(?:mom|mum|dad|mommy|mummy|daddy|mother|father|sister|brother|son|daughter|grandma|grandpa|granny|love|dear|sweetie|friend|friends|boss|team|coach|doc)$/.test(
          w2 ?? w1,
        )
      )
        return null;
      const owned = w2
        ? yourNoun(ctx, at, w1, w2, true, true)
        : yourNoun(ctx, at, undefined, w1, true, true);
      return owned ? "your" : null;
    },
  },
  // "She wasn't upset too.": a negative clause ends in "either".
  {
    rule: CONTEXT,
    cue: ["too"],
    pattern: `(?<=(?:n['’]t|(?:is|was|are|were|am|do|does|did|will|would|can|could|have|has|had|be|['’]m|['’]re|['’]s)${S}not|${S}never)${S}(?:[\\p{L}'’]+${S}){0,4})(?<target>too)(?=[ \\t\\u00a0]*[.!])`,
    fix: (m, ctx) => {
      // The negation and "too" share one clause: no comma, "but" or "and" between them.
      const before = ctx.text.slice(Math.max(0, m.index - 60), m.index);
      const clause = before.slice(Math.max(before.lastIndexOf(","), before.lastIndexOf(";")) + 1);
      if (/\b(?:but|and|or|because|so)\b/i.test(clause)) return null;
      // "don't have too": the "to" frame below owns it.
      return /\b(?:have|has|had|having|able|want|wants|wanted|wanting|need|needs|needed|supposed|ought|not)[ \t\u00a0]+$/i.test(
        before,
      )
        ? null
        : "either";
    },
  },
  // "You don't have too.", "I am not able too.": the infinitive "to" with its verb left out.
  {
    rule: TYPO,
    cue: ["too"],
    pattern: `(?:have|has|had|having|able|want|wants|wanted|wanting|need|needs|needed|supposed|ought|not)${S}(?<target>too)(?=[ \\t\\u00a0]*[.!?])`,
    fix: "to",
  },
  // "I think id rather wait", "Id like that": "I'd" with its apostrophe dropped.
  {
    rule: TYPO,
    cue: ["id"],
    pattern: `(?:(?<=(?:^|[.!?]["”’)]?[ \\t]{1,8}|\\n|,[ \\t]{1,8}))|(?:think|thought|guess|hope|wish|know|said|says|so|but|and|because|if|then|maybe|honestly|yes|well)${S})(?<target>id)${S}(?:${ID_VERB})${E}`,
    fix: (m) => (/^[Ii]d$/.test(m.groups!.target) ? { alternatives: ["I'd"], raw: true } : null),
  },
  // "my id expired": the identity document is an abbreviation.
  {
    rule: CASING,
    cue: ["id"],
    pattern: `(?:my|your|his|her|their|our|photo|student|valid|government|employee|staff)${S}(?<target>id)(?=${S}(?:card|cards|number|badge|proves|shows|expired|is|was|to|at|for|and|or|with)${E}|[ \\t]*[.!?,;:])`,
    fix: (m) => (m.groups!.target === "id" ? { alternatives: ["ID"], raw: true } : null),
  },
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
  { rule: TAG_QUESTION, cue: ["t"], pattern: NEGATIVE_TAG, fix: (m) => negativeTagFix(m) },
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
      // "the former" may come before or right after ("subordinated the later to the former").
      const former = /\bformer\b/i.test(ctx.text.slice(Math.max(0, m.index - 300), end(m) + 120));
      const verb = LATTER_VERB.test(next);
      const ADVERB = /^(?:very|actually|also|often|always|never|usually|only|still|clearly)$/;
      const adverb = ADVERB.test(next);
      let after = adverb ? nextWord(ctx, end(m) + 1 + next.length) : "";
      // "the later very often causes": a second adverb before the verb.
      if (ADVERB.test(after)) after = nextWord(ctx, ctx.text.indexOf(after, end(m)) + after.length);
      const ok =
        verb ||
        (adverb && (LATTER_VERB.test(after) || isVerb(after, "third", "ing"))) ||
        /^(?:because|based)$/.test(next) ||
        (former && (next === "" || /^(?:in|on|for|as|because|since|to|and)$/.test(next)));
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
    pattern: `(?:think|thinks|thought|know|knows|knew|say|says|said|believe|believes|hope|guess|because|is|was|that|told${S}(?:me|him|her|us|them|you)|teach${S}us|teaches${S}us)${S}(?<target>tat)${S}(?:is|was|must|can|will|would|should|could|it|the|a|I|you|we|they|he|she|this|there|one|[a-z]+s${S}are)${E}`,
    fix: "that",
  },
  {
    rule: TYPO,
    cue: ["tat"],
    pattern: `(?<=(?:^|[.!?]["”’)]?[ \\t]{1,8}|\\n))(?<target>Tat)${S}(?:is|was|must|can|will|would|should|could|seems|sounds|looks)${E}`,
    fix: "That",
  },
  // "This is were I live", "the place were the police look", "not sure were to go": "where".
  {
    rule: TYPO,
    cue: ["were"],
    pattern: `(?:(?:this|that|here|it)${S}is|(?:sure|know|knew|wonder|wondering|asked|ask|idea|tell|told|show|remember|forgot|guess)|(?:the|a|one${S}of${S}the)${S}(?:place|places|page|pages|point|area|areas|city|town|room|house|country|site|website|spot|age|land|office|section|folder|location|stage|part|world|street|village|region|one))${S}(?<target>were)${S}(?:I|we|you|they|he|she|to|the${S}[a-z]+${S}(?:is|are|was|were|can|will|has|have|had|look|looks|live|lives|work|works)|my|our|your|their|his|her)${E}`,
    fix: (m) => (/^were$/i.test(m.groups!.target) ? "where" : null),
  },
  {
    rule: TYPO,
    cue: ["were"],
    pattern: `(?<=(?:^|[.!?]["”’)]?[ \\t]{1,8}|\\n))(?<target>Were)${S}(?:did|does|do|else|is|are|can|could|should|would|will|have|has)${E}`,
    fix: "Where",
  },
  // "Which browser where you using?", "The runners where running": the past of "be".
  {
    rule: TYPO,
    cue: ["where"],
    pattern: `(?:(?:which|what)${S}[a-z]+|they|we|you|people|users|[a-z]+s)${S}(?<target>where)${S}(?:(?:you|they|we)${S})?(?<ing>[a-z]{2,}ing)${E}(?!${S}(?:is|was|are|were|has|can|will|should|would)${E})`,
    fix: (m) => (isVerb(m.groups!.ing, "ing") ? "were" : null),
  },
  // "there's and example", "here is and update": the article "an" before a vowel.
  {
    rule: TYPO,
    cue: ["and"],
    pattern: `(?:there['’]s|there${S}(?:is|was)|here['’]s|here${S}is|is${S}there|was${S}there|such|quite|what)${S}(?<target>and)${S}(?<noun>[aeiou][a-z]+)(?=[ \\t]*[.!?,:;]|${S}(?:of|for|that|to|on|in|with|from|about|here|there|we|you|I)${E})`,
    fix: (m) => {
      const read = info(m.groups!.noun);
      return read?.noun && !read.plural ? "an" : null;
    },
  },
  // "They decline an eventually go", "once an for all", "two an a half": "and".
  {
    rule: TYPO,
    cue: ["an"],
    pattern: `(?<target>an)${S}(?:(?:also|already|eventually)${S}(?:go|be|do|have|get|make|take|went|did|got|made|took)|thus|therefore|still|finally|later|regarding|the|my|your|his|her|our|their|these|those|for${S}all|a${S}half)${E}`,
    fix: (m) => (m.groups!.target === "an" || m.groups!.target === "An" ? "and" : null),
  },
  // "Let me now your thoughts", "I don't now": the verb "know".
  {
    rule: TYPO,
    cue: ["now"],
    pattern: `(?:(?:don['’]t|doesn['’]t|didn['’]t|let${S}(?:me|us|him|her|them))${S}(?<target>now)${S}(?:if|whether|what|how|why|when|where|who|your|the|about|anything|it|him|her|them)|let${S}(?:me|us)${S}(?<target2>now)(?=[ \\t]*[.!?]))${E}`,
    fix: (m) => {
      const g = m.indices!.groups!;
      return { alternatives: ["know"], range: g.target ?? g.target2 };
    },
  },
  // "right know", "from know on", "every know and then": the adverb "now".
  {
    rule: TYPO,
    cue: ["know"],
    pattern: `(?:right|until)${S}(?<target>know)(?=[ \\t]*[.!?,]|${S}(?:and|or|but|because|I|we|you|he|she|they|it|is|are)${E})`,
    fix: "now",
  },
  {
    rule: TYPO,
    cue: ["know"],
    pattern: `(?:from${S}(?<target>know)${S}on|every${S}(?<target2>know)${S}and${S}then)${E}`,
    fix: (m) => {
      const g = m.indices!.groups!;
      return { alternatives: ["now"], range: g.target ?? g.target2 };
    },
  },
  {
    rule: TYPO,
    cue: ["know"],
    pattern: `there${S}(?:is|was|['’]s)${S}(?<target>know)${S}(?:place|way|one|time|need|point|reason|doubt|chance|problem|longer|more)${E}`,
    fix: "no",
  },
  // "more that $10", "more libertarian that others", "a better app that Outlook.": "than".
  {
    rule: TYPO,
    cue: ["that"],
    pattern: `(?<!the${S})(?:more|less|fewer)${S}(?<target>that)${S}(?:\\$?[0-9]|a${S}few|a${S}couple|two|three|four|five|ten|twenty|hundred|half|twice)`,
    fix: "than",
  },
  {
    rule: TYPO,
    cue: ["that"],
    // Not "more important that others help": a that-clause after such an adjective.
    pattern: `(?:more|less)${S}(?<adj>[a-z]+)${S}(?<target>that)${S}(?:others|anyone|anything|everyone|everything|ever|usual|expected|necessary|needed|planned|before)${E}(?=[ \\t]*(?:[.!?,;:)]|$)|${S}(?:do|did|does|in|on|at|for|of)${E})`,
    fix: (m) =>
      /^(?:important|likely|clear|obvious|necessary|possible|probable|true|surprising|essential|crucial|vital|urgent|interesting|apparent|evident|certain|plausible|unlikely|concerning|worrying)$/.test(
        m.groups!.adj,
      )
        ? null
        : "than",
  },
  {
    rule: TYPO,
    cue: ["that"],
    pattern: `(?:better|worse|bigger|smaller|faster|slower|cheaper|stronger|weaker|safer|easier|harder|(?:more|less)${S}[a-z]+)${S}(?:[a-z]+${S})?(?<target>that)${S}\\p{L}[\\p{L}]*(?=[ \\t]*(?:[.!?,;:]|$| -))`,
    fix: (m, ctx) => {
      const end = m.indices!.groups!.target[1];
      return m.groups!.target === "that" && /^[ \t ]+\p{Lu}/u.test(ctx.text.slice(end, end + 9))
        ? "than"
        : null;
    },
  },
  // "once of the reasons", "once more time", "One upon a time", "every one in a while".
  {
    rule: TYPO,
    cue: ["once"],
    pattern: `(?:(?:is|was|are|were|be|been|being|as|became|become|remains)${S}(?<target>once)${S}of${S}(?:the|my|your|our|his|her|their|these|those|them|us)|(?<target2>once)${S}(?:more${S}time(?=[ \\t]*[.!?,]|${S}(?:to|and|please|before)${E})))${E}`,
    fix: (m) => {
      const g = m.indices!.groups!;
      return { alternatives: ["one"], range: g.target ?? g.target2 };
    },
  },
  {
    rule: TYPO,
    cue: ["one"],
    pattern: `(?:(?<!(?<![\\p{L}'’])(?:the|this|that|a|any|each|every|which|no)${S})(?<target>one)${S}(?:upon${S}a${S}time|and${S}for${S}all)|every${S}(?<target2>one)${S}in${S}a${S}while)${E}`,
    fix: (m) => {
      const g = m.indices!.groups!;
      return { alternatives: ["once"], range: g.target ?? g.target2 };
    },
  },
  // "I wonder it there is", "Catch me it you can": the conjunction "if".
  {
    rule: TYPO,
    cue: ["it"],
    pattern: `(?:(?:sure|wonder|wondering|see|check|checking|(?:ask|asked|asking)(?:${S}(?:me|him|her|them|us))?)${S}(?<target>it)${S}(?:there${S}(?:is|are|was|were)|anyone|anybody|someone|somebody)|me${S}(?<target2>it)${S}you${S}can(?=[ \\t]*[.!?]))${E}`,
    fix: (m) => {
      const g = m.indices!.groups!;
      return { alternatives: ["if"], range: g.target ?? g.target2 };
    },
  },
  {
    rule: TYPO,
    cue: ["if"],
    pattern: `(?:(?:make|makes|made|making)${S}(?<target>if)${S}(?:clear|possible|easier|easy|harder|hard|difficult|sure|known|work)|for${S}(?<target2>if)(?=[ \\t]*[!.]))${E}`,
    fix: (m) => {
      const g = m.indices!.groups!;
      return { alternatives: ["it"], range: g.target ?? g.target2 };
    },
  },
  // "I can all ready do it", "I all so think": "already", "also".
  {
    rule: TYPO,
    cue: ["ready"],
    pattern: `(?<target>all${S}ready)${S}(?<next>[a-z]+)${E}`,
    // A verb follows ("all ready be", "all ready doing"), not a noun ("all ready meals").
    fix: (m) => {
      const read = info(m.groups!.next);
      const verb =
        /^(?:be|are|is|was|were|has|had|have|did|done|seen|see|get|go|do|start|leave|use|make|take|know|say|find|tell|feel|hear|buy|pay|send|book)$/.test(
          m.groups!.next,
        );
      return verb || (read && !read.noun && !read.adjective && read.verbs.length)
        ? "already"
        : null;
    },
  },
  {
    rule: TYPO,
    cue: ["all"],
    pattern: `(?:I|we|they|you)${S}(?<target>all${S}so)${S}(?:think|thought|want|need|have|like|love|know|agree|believe)${E}`,
    fix: "also",
  },
  // "A user recently complaint that", "A user complaints about": the verb.
  {
    rule: TYPO,
    cue: ["complaint", "complaints"],
    pattern: `(?:(?:recently|also|just|always|often|then)${S}(?<target>complaint)|(?:a|one|another|every|each)${S}[a-z]+${S}(?<target2>complaints))${S}(?:that|about)${E}`,
    fix: (m) => {
      const g = m.indices!.groups!;
      return g.target
        ? { alternatives: ["complained"], range: g.target }
        : { alternatives: ["complains"], range: g.target2 };
    },
  },
  // "per moth", "the end of the moth", "for moths,": "month".
  {
    rule: TYPO,
    cue: ["moth", "moths"],
    pattern: `(?:(?:per|next|last|calendar|(?:beginning|end|middle|start)${S}of${S}the)${S}(?<target>moth)(?=[ \\t]*[.!?,;:]|${S}(?:ago|later|before|after|and|or)${E})|(?:for|some|few|several|many|two|three|four|five|six|seven|eight|nine|ten|twelve|[0-9]+)${S}(?<target2>moths)(?=[ \\t]*[.!?,;:]|${S}(?:ago|now|later|before|after)${E}))`,
    fix: (m) => {
      const g = m.indices!.groups!;
      return g.target
        ? { alternatives: ["month"], range: g.target }
        : { alternatives: ["months"], range: g.target2 };
    },
  },
  // "He's jut unhappy", "Let's jut do it": the adverb "just" (not "jut out").
  {
    rule: TYPO,
    cue: ["jut"],
    pattern: `(?:(?:I|you|we|they|he|she|it|has|have|had|does|do|did|can|could|would|should|will|let['’]s|couldn['’]t|can['’]t|don['’]t|is|was|are|were)|\\p{L}+['’](?:s|re|m|ve|ll|d))${S}(?<target>jut)${S}(?!(?:out|outs|into|over|from|above|beyond|forth|up|across)${E})[a-z]`,
    fix: "just",
  },
  // "It doe not matter", "What doe he think": "does".
  {
    rule: TYPO,
    cue: ["doe"],
    pattern: `(?:(?:it|he|she|this|that|which|who)${S}(?<target>doe)${S}not|(?:what|how|why|where|when)${S}(?<target2>doe)${S}(?:he|she|it))${E}`,
    fix: (m) => {
      const g = m.indices!.groups!;
      return { alternatives: ["does"], range: g.target ?? g.target2 };
    },
  },
  // "It bares little resemblance", "can't bare the thought": the verb "bear".
  {
    rule: TYPO,
    cue: ["bare", "bares", "bared", "baring"],
    pattern: `(?:(?<target>bares|bared|baring)${S}(?:(?:a|an|little|no|some|striking|uncanny|close|almost|an${S}almost)${S})*(?:resemblance|witness|the${S}brunt|repeating|mentioning)|(?:can['’]t|cannot|couldn['’]t|could${S}not)${S}(?<target2>bare)${S}(?:the${S}[a-z]+|it|to|this|that|him|her|them|seeing|being|watching|hearing))${E}`,
    fix: (m, ctx) => {
      const g = m.indices!.groups!;
      if (g.target2) return { alternatives: ["bear"], range: g.target2 };
      const typed = m.groups!.target.toLowerCase();
      const perfect = /\b(?:has|have|had)[ \t]+$/i.test(
        ctx.text.slice(Math.max(0, g.target[0] - 8), g.target[0]),
      );
      const fix = { bares: "bears", baring: "bearing", bared: perfect ? "borne" : "bore" }[typed]!;
      return { alternatives: [fix], range: g.target };
    },
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
    rules: [
      "englishPhraseCorrections",
      "englishContextualCompounds",
      "englishSentenceStructure",
      "englishCanonicalCasing",
      "englishYourYouAre",
    ],
    detect: frameDetector(FRAMES),
  },
];
