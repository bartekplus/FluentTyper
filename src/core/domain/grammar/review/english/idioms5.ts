import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { PhraseRow } from "../englishPhraseTables";
import { OPENING_QUOTES } from "../exampleCues";
import { frameMatches, hasUserOrCasedWord, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";

const S = SPACE;
const E = WORD_END;

/** One row per item: `~` stands for the item (or its typed/replacement pair) in both columns. */
const each = (
  items: readonly (string | readonly [string, string])[],
  typed: string,
  replacement: string | readonly string[],
): PhraseRow[] =>
  items.map((item) => {
    const [from, to] = typeof item === "string" ? [item, item] : item;
    return [typed.replace("~", from), [replacement].flat().map((form) => form.replace("~", to))];
  });
const OWNERS = ["my", "your", "his", "her", "its", "our", "their"];
const REFLEXIVES = [
  ...["myself", "yourself", "himself", "herself", "itself", "oneself"],
  ...["ourselves", "yourselves", "themselves"],
];
const TRY = ["try", "tries", "tried", "trying"];
const TAKE = ["take", "takes", "took", "taken", "taking"];
const SHOOT = ["shoot", "shoots", "shot", "shooting"];
const BE = ["is", "are", "was", "were", "be", "been", "being"];

/** Misheard idioms, wrong words or prepositions in set phrases, and their inflections. */
export const PHRASES: readonly PhraseRow[] = [
  // "it means a lot to me": the feeling goes "to" someone.
  ...["mean", "means", "meant", "meaning"].flatMap((verb) =>
    ["me", "us", "him", "her", "them", "you"].flatMap((who): PhraseRow[] => [
      [
        [`${verb} a lot for ${who}`, `${verb} lot for ${who}`, `${verb} alot for ${who}`],
        `${verb} a lot to ${who}`,
      ],
      [[`${verb} lot to ${who}`, `${verb} alot to ${who}`], `${verb} a lot to ${who}`],
    ]),
  ),
  ...each(OWNERS, "famous ~", "famous for ~"),
  ...each(["him", "me", "us", "them"], "angry ~", ["angry with ~", "angry at ~"]),
  ["mixed bad", "mixed bag"],
  ["mixed bads", "mixed bags"],
  [
    "the most number of",
    ["the highest number of", "the largest number of", "the greatest number of"],
  ],
  [
    "the most amount of",
    ["the greatest amount of", "the largest amount of", "the maximum amount of"],
  ],
  ...each(
    ["the", "the final", "the last", "his", "her", "its", "their", "my", "your", "our", "that"],
    "nail on ~ coffin",
    "nail in ~ coffin",
  ),
  ...each(["the", "the final", "the last"], "nails on ~ coffin", "nails in ~ coffin"),
  [
    [
      "nail on the hat",
      "nail on the had",
      "nail on the hit",
      "nail on the hid",
      "nail on the heat",
    ],
    "nail on the head",
  ],
  // "no harm, no foul": both halves take "no", and a foul is not a fowl.
  ...["no", "nor"].flatMap((first) =>
    ["", ","].flatMap((comma) =>
      ["no", "nor"].flatMap((second) =>
        ["foul", "fowl"]
          .filter((last) => `${first} ${second} ${last}` !== "no no foul")
          .map((last): PhraseRow => [
            `${first} harm${comma} ${second} ${last}`,
            `no harm${comma} no foul`,
          ]),
      ),
    ),
  ),
  ...["obsess", "obsesses", "obsessing"].flatMap((verb) =>
    each(["on", "with"], `${verb} ~`, `${verb} over`),
  ),
  ["obsessed on", ["obsessed with", "obsessed over"]],
  [["of corse", "off corse", "off coarse", "o course"], "of course"],
  ["off-limit", "off-limits"],
  // "pale in comparison" is the verb "pale".
  ...[
    ["is", "pales"],
    ["are", "pale"],
    ["was", "paled"],
    ["were", "paled"],
    ["be", "pale"],
    ["been", "paled"],
  ].flatMap(([be, verb]) => each(["in", "by"], `${be} pale ~ comparison`, `${verb} ~ comparison`)),
  ...[...OWNERS, "it's", "there", "one's"].flatMap((owner) =>
    each(["accord", "accords"], `on ${owner} own ~`, `of ${owner} own ~`),
  ),
  ...[
    ["peek", "pique"],
    ["peeks", "piques"],
    ["peeked", "piqued"],
    ["peeking", "piquing"],
  ].flatMap(([peek, pique]) => each(OWNERS, `${peek} ~ interest`, `${pique} ~ interest`)),
  // The head noun of the set phrase takes the plural.
  ["line of codes", ["lines of code", "line of code"]],
  ["lines of codes", "lines of code"],
  ["point of views", ["points of view", "point of view"]],
  ["points of views", "points of view"],
  ["rule of thumbs", ["rules of thumb", "rule of thumb"]],
  ["rules of thumbs", "rules of thumb"],
  ["rule-of-thumbs", ["rules-of-thumb", "rule-of-thumb"]],
  ["rules-of-thumbs", "rules-of-thumb"],
  ["body in whites", ["bodies in white", "body in white"]],
  ["bodies in whites", "bodies in white"],
  ["flash in the pans", ["flashes in the pan", "flash in the pan"]],
  ["flashes in the pans", "flashes in the pan"],
  ["flash-in-the-pans", ["flashes-in-the-pan", "flash-in-the-pan"]],
  ["flashes-in-the-pans", "flashes-in-the-pan"],
  ["proof-of-concepts", ["proofs-of-concept", "proof-of-concept"]],
  ["proofs-of-concepts", "proofs-of-concept"],
  ...["run", "runs", "ran", "running"].flatMap((verb): PhraseRow[] => [
    [[`${verb} into a trouble`, `${verb} into troubles`], `${verb} into trouble`],
    [`${verb} into further troubles`, `${verb} into further trouble`],
    [`${verb} into some troubles`, `${verb} into some trouble`],
  ]),
  ...SHOOT.flatMap((verb) =>
    REFLEXIVES.map((self): PhraseRow => [
      // "shooting ourselves in the feet" is natural with a plural reflexive.
      ["into the foot", "into the feet", "in a foot", "into a foot"]
        .concat(/selves$/.test(self) ? [] : ["in the feet"])
        .map((place) => `${verb} ${self} ${place}`),
      `${verb} ${self} in the foot`,
    ]),
  ),
  ...["it's", "its", "it is", "it was", "that's", "thats", "that is", "that was", "this is"].map(
    (lead): PhraseRow => [`${lead} such shame`, `${lead} such a shame`],
  ),
  ...each(TAKE, "~ care about", "~ care of"),
  ...TRY.flatMap((verb) =>
    [...OWNERS, "one's"].flatMap((owner): PhraseRow[] => [
      [`${verb} ${owner} hands at`, `${verb} ${owner} hand at`],
      [`${verb} out ${owner} luck`, `${verb} ${owner} luck`],
    ]),
  ),
  // "viscous" describes thick liquids; both "vicious circle" and "vicious cycle" are standard.
  ["viscous cycle", ["vicious cycle", "vicious circle"]],
  ["viscous cycles", ["vicious cycles", "vicious circles"]],
  ["viscous circle", ["vicious circle", "vicious cycle"]],
  ["viscous circles", ["vicious circles", "vicious cycles"]],
  [["good-educated", "good - educated"], "well-educated"],
  ...each(
    [
      ...["accepted", "acceptable", "used", "known", "recognized", "recognised", "adopted"],
      ...["regarded", "believed", "considered"],
    ],
    "wide ~",
    "widely ~",
  ),
  ["with opened arms", "with open arms"],
  ["with open arm", "with open arms"],
  ...BE.flatMap((be): PhraseRow[] => [
    [
      [`${be} welcome with open arms`, `${be} welcome with open arm`],
      `${be} welcomed with open arms`,
    ],
    [[`${be} greet with open arms`, `${be} greet with open arm`], `${be} greeted with open arms`],
  ]),
  ["sort-after", "sought-after"],
  // The demonstrative, "kind" and "thing" agree: "this kind of thing", "these kinds of things".
  ...["kind", "sort", "type"].flatMap((kind): PhraseRow[] => [
    [`this ${kind} of things`, [`this ${kind} of thing`, `these ${kind}s of things`]],
    [`that ${kind} of things`, [`that ${kind} of thing`, `those ${kind}s of things`]],
    [`these ${kind} of things`, [`these ${kind}s of things`, `this ${kind} of thing`]],
    [`those ${kind} of things`, [`those ${kind}s of things`, `that ${kind} of thing`]],
    [`these ${kind} of thing`, [`this ${kind} of thing`, `these ${kind}s of things`]],
    [`those ${kind} of thing`, [`that ${kind} of thing`, `those ${kind}s of things`]],
  ]),
];

/** Half-hyphenated compounds. */
export const COMPOUNDS: readonly PhraseRow[] = [
  [
    ["out of-date", "out-of date"],
    ["out-of-date", "out of date"],
  ],
];

/** Optional advice: contested idiom variants, redundancy and non-idiomatic word choice. */
export const STYLE: readonly PhraseRow[] = [
  // "pay the bill": the bill is what is paid, not what is paid for.
  ...["pay", "pays", "paid", "paying"].flatMap((verb) =>
    ["", "the ", "a ", "my ", "your ", "his ", "her ", "our ", "their "].flatMap((det) =>
      ["bill", "bills", "check", "fee", "fees"]
        .filter((noun) => !(det === "a " && noun.endsWith("s")))
        .map((noun): PhraseRow => [`${verb} for ${det}${noun}`, `${verb} ${det}${noun}`]),
    ),
  ),
  ...SHOOT.flatMap((verb) =>
    REFLEXIVES.map((self): PhraseRow => [
      [`${verb} ${self} in the leg`, `${verb} ${self} into the leg`],
      `${verb} ${self} in the foot`,
    ]),
  ),
  ["somewhat of a", "something of a"],
  ["somewhat of an", "something of an"],
  ...each(["thrive", "thrives", "thrived", "throve", "thriving"], "~ off of", "~ on"),
  // "would have never" splits the verb group; "never would have" keeps the emphasis.
  ...["would", "could", "should"].flatMap((modal): PhraseRow[] => [
    [`${modal} have never`, [`never ${modal} have`, `${modal} never have`]],
    [
      [`${modal}'ve never`, `${modal}ve never`],
      [`never ${modal}'ve`, `${modal} never have`],
    ],
  ]),
];

// ---- Context detectors: forms that are also ordinary English elsewhere. ----

export type Rule = Pick<RawFinding, "ruleId" | "messageKey">;
export const PHRASE: Rule = {
  ruleId: "englishPhraseCorrections",
  messageKey: "review_msg_phrase_correction",
};
export const CONTEXT: Rule = {
  ruleId: "englishPhraseCorrections",
  messageKey: "review_msg_contextual_grammar",
};
export const TYPO: Rule = { ruleId: "englishPhraseCorrections", messageKey: "review_msg_typo" };
const PREPOSITION: Rule = {
  ruleId: "englishFixedPrepositions",
  messageKey: "review_msg_fixed_prepositions",
};
const SINCE: Rule = { ruleId: "englishFixedPrepositions", messageKey: "review_msg_since_duration" };
const MISSING_TO: Rule = { ruleId: "englishVerbComplements", messageKey: "review_msg_missing_to" };
const STRUCTURE: Rule = {
  ruleId: "englishSentenceStructure",
  messageKey: "review_msg_sentence_structure",
};
export const COMPOUND: Rule = {
  ruleId: "englishContextualCompounds",
  messageKey: "review_msg_compounds",
};
const STYLE_ADVICE: Rule = { ruleId: "stylePhrasing", messageKey: "review_msg_style_phrasing" };

/** Replacements for the `target` group (or `range`); `raw` keeps their casing as given. */
type Fix = { alternatives: readonly string[]; range?: readonly [number, number]; raw?: true };
export type FixResult = string | readonly string[] | Fix | null;
export type Frame = {
  rule: Rule;
  /** The frame runs only when one of these words occurs near the chunk. */
  cue?: readonly string[];
  pattern: string | RegExp;
  fix: string | readonly string[] | ((m: RegExpExecArray, ctx: DetectContext) => FixResult);
};

const lower = (word: string | undefined) => (word ?? "").toLowerCase();
const info = (word: string | undefined) => (word ? englishWordInfo(lower(word)) : null);
const hasForm = (word: string | undefined, form: string) =>
  info(word)?.verbs.some((v) => v.form === form) ?? false;
// Function words the lexicon also lists as nouns ("it", "you", "the ins and outs").
const FUNCTION_WORD =
  /^(?:i|me|my|you|your|he|him|his|she|her|it|its|we|us|our|they|them|their|this|that|these|those|the|a|an|if|in|on|at|to|for|with|by|of|off|out|up|down|over|than|and|or|but|so|as|when|because|since|after|before|until|now|then|again|here|there|yet|still|too|very|is|are|was|were|be|been)$/i;
/** A word the lexicon knows as a noun; unknown words are not. */
const nounLike = (word: string | undefined) => {
  if (!word || FUNCTION_WORD.test(word)) return false;
  const known = info(word);
  return !!known && (known.noun || known.plural);
};
/** The word after `end`, or "" when punctuation or the text end comes first. */
const nextWord = (ctx: DetectContext, end: number) =>
  /^[ \t\u00a0]{1,8}([\p{L}\p{N}][\p{L}\p{N}'’-]*)/u.exec(ctx.text.slice(end, end + 48))?.[1] ?? "";
const before = (ctx: DetectContext, index: number, chars = 80) =>
  ctx.text.slice(Math.max(0, index - chars), index);
const group = (m: RegExpExecArray, name: string) => m.indices!.groups![name];
const matchEnd = (m: RegExpExecArray) => m.index + m[0].length;
/** A lookbehind: none of the whole `words` (an alternation) right before the frame. */
// A letter first: off words (on long runs of spaces) the lookbehind is never tried.
const notAfter = (words: string) => `(?=\\p{L})(?<!(?<![\\p{L}'’])(?:${words})${S})`;
/** A frame that may also start right after a slash ("source/reason of saving"). */
const SLASH_START = (pattern: string) =>
  new RegExp(`(?<![.])(?<![\\p{L}\\p{M}\\p{N}_'’@#\\\\-])${pattern}`, "gidu");
/**
 * A lookbehind: the text start, or a stop, comma, colon or bracket with optional quotes,
 * before `next`. Checking `next` first keeps it off long runs of spaces, which it would
 * reread at every position in JavaScriptCore.
 */
const atClause = (next: string) => `(?=${next})(?<=(?:^|[.!?,;:(\\n])[ \\t\\u00a0"“'‘]{0,8})`;
const SUBJECT = "I|you|we|they|he|she|it";
const BE_FORM =
  "am|is|are|was|were|be|been|being|(?:I|you|we|they|he|she|it|that|there|who|what|this)['’](?:m|re|s)";

/** The typed casing carried onto a replacement: all capitals, or an initial capital. */
function recase(typed: string, alternative: string, whole: string): string {
  const letters = typed.replace(/\P{L}/gu, "");
  const all = whole.replace(/\P{L}/gu, "");
  if (
    letters &&
    letters === letters.toUpperCase() &&
    (letters.length > 1 || all === all.toUpperCase())
  )
    return alternative.toUpperCase();
  return /^\P{L}*\p{Lu}/u.test(typed)
    ? alternative.replace(/\p{L}/u, (c) => c.toUpperCase())
    : alternative;
}

// ---- "missing to": a verb or adjective that takes a to-infinitive, then a bare verb. ----
const GOVERNOR_PAST = [
  ...["meant", "wanted", "needed", "agreed", "forgot", "forgotten", "tried", "trying"],
  ...["refused", "resolved", "attempted", "decided", "hoped", "promised", "managed", "failed"],
  ...["planned", "intended", "expected"],
].join("|");
// A base form is often a noun ("the review plan anchor…"); a subject or auxiliary settles it.
const GOVERNOR_BASE =
  "want|need|agree|forget|try|refuse|resolve|attempt|decide|hope|promise|manage|fail|plan|intend|expect";
const BASE_LEAD =
  "I|you|we|they|to|will|would|can|could|should|must|might|may|shall|do|did|don['’]t|didn['’]t|won['’]t|never|just|really|also|always|still|please";
// A third-person -s form could be a plural noun ("his needs grow"); a subject settles it.
const GOVERNOR_THIRD =
  "wants|needs|agrees|forgets|tries|refuses|resolves|attempts|decides|hopes|promises|manages|fails|plans|intends|expects";
const GOVERNOR_ADJECTIVES = "ready|eager|inclined|able|unable|willing|unwilling|keen|determined";
const OBJECT_START = /^(?:the|a|an|my|your|his|her|its|our|their|it|them|him|me|us|you)$/i;
// "need help the most": a degree phrase, not an object.
const DEGREE_AFTER_THE =
  /^[ \t\u00a0]+the[ \t\u00a0]+(?:most|least|best|whole|rest|same|entire|other)\b/i;
function missingTo(m: RegExpExecArray, ctx: DetectContext): string | null {
  const verb = m.groups!.target;
  const known = info(verb);
  if (!known?.verbs.some((v) => v.form === "base") || /^(?:be|not|do)$/i.test(verb)) return null;
  // "agree with", "try out": function words; "tried create+modify" names an operation;
  // "They plan deploy" at the text end may still be typed.
  const rest = ctx.text.slice(matchEnd(m));
  if (FUNCTION_WORD.test(verb) || /^[^\s.,;:!?)]/u.test(rest) || !/\S/.test(rest)) return null;
  if (!known.noun && !known.adjective && !known.plural && !known.adverb) return `to ${verb}`;
  // A word that is also a noun needs an object or "about" after it: "need talk about".
  const end = matchEnd(m);
  const next = nextWord(ctx, end);
  if (/^about$/i.test(next)) return `to ${verb}`;
  return OBJECT_START.test(next) && !DEGREE_AFTER_THE.test(ctx.text.slice(end, end + 32))
    ? `to ${verb}`
    : null;
}

// ---- "since two weeks": a length of time takes "for", or "since … ago" for a start. ----
function sinceDuration(m: RegExpExecArray, ctx: DetectContext): Fix | null {
  const { unit, target } = m.groups!;
  // "Since two days were lost, …": the duration is a subject and "since" means "because".
  const next = nextWord(ctx, matchEnd(m));
  if (CLAUSE_VERB.test(next) || hasForm(next, "past") || hasForm(next, "third")) return null;
  // A following space joins the range, so "ago" lands before the next word.
  const space = /^[ \t\u00a0]*/.exec(ctx.text.slice(matchEnd(m)))![0];
  const [start, end] = group(m, "target");
  const ago = recase(unit, "ago", unit);
  return {
    alternatives: [
      `${recase(target.slice(0, 5), "for", m[0])}${target.slice(5)}${space}`,
      space ? `${target} ${ago}${space}` : `${target} ${ago}`,
    ],
    range: [start, end + space.length],
    raw: true,
  };
}

// ---- "rise the ranks", "raise through the ranks", "rise up in the ranks". ----
const RISE: Record<string, string> = {
  raise: "rise",
  raises: "rises",
  raised: "rose",
  raising: "rising",
  rised: "rose",
};
const RANKS = `(?<target>(?<verb>rise|rises|rose|risen|rising|rised|raise|raises|raised|raising)(?<mid>(?:${S}up)?(?:${S}(?:in|through))?)${S}(?<the>the${S}(?<rank>ranks?)))${E}(?!${S}and${S}file${E})`;
/** Errors: a missing preposition, "raise", "rised", or a singular "rank". */
function riseRanks(m: RegExpExecArray): FixResult {
  const verb = lower(m.groups!.verb);
  const mid = lower(m.groups!.mid)
    .trim()
    .replace(/[ \t\u00a0]+/g, " ");
  const plural = /s$/i.test(m.groups!.rank);
  const insert: Fix = { alternatives: ["through the ranks"], range: group(m, "the") };
  if (!(verb in RISE)) {
    if (!mid) return insert;
    return plural ? null : `${m.groups!.verb} through the ranks`;
  }
  // "raise (up) the ranks of" is a transitive "raise"; "rised the ranks" only lacks "through".
  if (!mid || mid === "up")
    return verb !== "rised" ? null : mid ? "rose through the ranks" : insert;
  return verb === "raised"
    ? ["rose through the ranks", "risen through the ranks"]
    : `${RISE[verb]} through the ranks`;
}
/** Style: "rise up the ranks", "rise in the ranks" for the set "rise through the ranks". */
function riseRanksStyle(m: RegExpExecArray): FixResult {
  const mid = lower(m.groups!.mid)
    .trim()
    .replace(/[ \t\u00a0]+/g, " ");
  if (lower(m.groups!.verb) in RISE || !mid || mid === "through") return null;
  return /s$/i.test(m.groups!.rank) ? `${m.groups!.verb} through the ranks` : null;
}

// ---- Phrasal verbs written as their compound noun: "I backup", "to rollback again". ----
const PHRASAL: Record<string, string> = {
  backup: "back up",
  breakup: "break up",
  checkout: "check out",
  cleanup: "clean up",
  comeback: "come back",
  followup: "follow up",
  lookup: "look up",
  pickup: "pick up",
  playback: "play back",
  rollback: "roll back",
  rollout: "roll out",
  setup: "set up",
  shutdown: "shut down",
  signup: "sign up",
  takeover: "take over",
  warmup: "warm up",
  workout: "work out",
};
const PHRASAL_WORDS = Object.keys(PHRASAL).join("|");
const PHRASAL_CUE = Object.keys(PHRASAL);
// The core contextual-compounds rule owns "setup" in its curated slots.
const PHRASAL_OWN = Object.keys(PHRASAL)
  .filter((word) => word !== "setup")
  .join("|");
const phrasal = (m: RegExpExecArray) => PHRASAL[lower(m.groups!.target)];
// "need to backup if it fails" may name the backup system.
const phrasalInfinitive = (m: RegExpExecArray, ctx: DetectContext) =>
  /^(?:if|when|unless|because|before|after|until|while|and|or|in)$/i.test(
    nextWord(ctx, matchEnd(m)),
  )
    ? null
    : phrasal(m);
// "to" opens an infinitive after these; "switch to backup" keeps the noun.
const INFINITIVE_LEAD =
  "want|wants|wanted|need|needs|needed|going|gonna|wanna|seem|seems|seemed|try|tries|tried|trying|how|able|unable|have|has|had|decided|decide|plan|planned|forgot|remember|easy|hard|possible|me|you|him|her|us|them";
const VERB_AFTER =
  "the|a|an|my|your|his|her|its|our|their|it|them|this|that|these|those|again|with";

const ADVERB_SLOT = /^(?:never|not|just|maybe|always|also|even|only|still|ever|perhaps)$/i;
const AUXILIARY =
  "can|could|will|would|shall|should|may|might|must|do|does|did|am|is|are|was|were|have|has|had";
// A verb right after "since two days" makes the duration a subject.
const CLAUSE_VERB = new RegExp(`^(?:${AUXILIARY}|went|passed|elapsed)$`, "i");
const MEDICINE =
  "antibiotics?|medicines?|medications?|pills?|tablets?|paracetamol|ibuprofen|aspirin|painkillers?|capsules?";
const FREQUENCY =
  "always|usually|often|sometimes|frequently|rarely|seldom|never|occasionally|generally|normally|typically";
const SORT_DEGREE = `very|highly|extremely|fairly|hugely|incredibly|pretty|quite|quiet|vastly|much|most|more|somewhat|kinda|abit|bit|strongly|greatly|widely|keenly|eagerly|hotly|super|increasingly|less|least|(?<![\\p{L}'’])(?:a|an)${S}rather`;
const ORDINAL =
  "[0-9]+(?:st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth";
const HIDING =
  /\b(?:hid|hide|hides|hidden|hiding|conceal\w*|keep|keeps|kept|keeping|shield\w*|protect\w*|obscur\w*|disguis\w*|mask\w*|secret\w*|safe|away)\b[^.!?;]*$/i;
const TRASH_AFTER =
  /^(?:away|out|in|into|on|onto|at|over|across|around|everywhere|from|off|down|to|inside|outside|anywhere|there|here)$/i;

const FRAMES: readonly Frame[] = [
  // ---- prepositions ----
  {
    rule: PREPOSITION,
    cue: ["interested"],
    pattern: `(?:${BE_FORM}|very|really|so|not|also|more|most|less|still|always|particularly|especially)${S}interested${S}(?<target>[a-z]+ing)${E}`,
    fix: (m) => (hasForm(m.groups!.target, "ing") ? `in ${m.groups!.target}` : null),
  },
  {
    // "seen from the naked eye" is "to" (or "with"); "hidden from the naked eye" stays.
    rule: PREPOSITION,
    cue: ["naked"],
    pattern: `(?<target>from)${S}the${S}naked${S}eyes?${E}`,
    fix: (m, ctx) => (HIDING.test(before(ctx, m.index)) ? null : ["to", "with"]),
  },
  {
    rule: PREPOSITION,
    cue: ["match"],
    pattern: `(?:${BE_FORM}|im|its|hes|shes|theyre|youre)${S}no${S}match${S}(?<target>against|to|of)${E}`,
    fix: "for",
  },
  {
    // "in the third floor of" is "on"; "in the third floor bathroom" names a room.
    rule: PREPOSITION,
    cue: ["floor"],
    pattern: `(?:${atClause("in|at")}|(?<![\\p{L}'’])(?:live|lives|lived|living|located|situated|stay|stays|stayed|staying|reside|resides|resided|residing|am|is|are|was|were|be|been|being|[a-z]+['’](?:m|re|s))${S})(?<target>in|at)${S}the${S}(?:${ORDINAL})${S}floor${E}`,
    fix: (m, ctx) => (nounLike(nextWord(ctx, matchEnd(m))) ? null : "on"),
  },
  {
    rule: PREPOSITION,
    cue: ["passionate"],
    pattern: `${notAfter("most|more|least|less|very|so")}passionate${S}(?<target>of)${E}(?!${S}(?:all|them|us|you|those|these|whom)${E})`,
    fix: "about",
  },
  {
    rule: PREPOSITION,
    cue: ["passionate"],
    pattern: `(?<target>of)${S}which${S}(?:${SUBJECT})${S}(?:am|are|is|was|were)${S}(?:(?:so|very|deeply|truly|most|really)${S})?passionate${E}(?!${S}about${E})`,
    fix: "about",
  },
  {
    // "the reason of doing" is "for"; "for reasons of security" stays.
    rule: PREPOSITION,
    cue: ["reason", "reasons"],
    pattern: SLASH_START(
      `${notAfter("for")}(?<target>(?<noun>reasons?)${S}of)${S}(?<ing>[a-z]+ing)${E}`,
    ),
    fix: (m) => (hasForm(m.groups!.ing, "ing") ? `${m.groups!.noun} for` : null),
  },
  {
    rule: PREPOSITION,
    cue: ["point"],
    pattern: `(?:what${S}is|what${S}was|what['’]s|whats|what)${S}the${S}point${S}(?<target>for)${E}`,
    fix: "of",
  },
  {
    rule: PREPOSITION,
    cue: ["point"],
    pattern: `${notAfter(`what|whats|what['’]s|what${S}is|what${S}was`)}the${S}point${S}(?<target>for)${S}(?<ing>[a-z]+ing)${E}`,
    fix: (m) => (hasForm(m.groups!.ing, "ing") ? "of" : null),
  },
  {
    // "take a look to see" is a purpose infinitive.
    rule: PREPOSITION,
    cue: ["look"],
    pattern: `(?:take|takes|took|taken|taking|have|has|had|having)${S}a${S}(?:(?:quick|closer|close|brief|good|deeper|second|first|careful|short)${S})?look${S}(?<target>to)${E}`,
    fix: (m, ctx) => {
      const next = nextWord(ctx, matchEnd(m));
      // "has a look to it" describes an appearance.
      if (hasForm(next, "base") || (/^ha/i.test(m[0]) && /^(?:it|them)$/i.test(next))) return null;
      return "at";
    },
  },
  {
    rule: PREPOSITION,
    cue: ["pride"],
    pattern: `(?:take|takes|took|taken|taking)${S}(?:(?:great|much|such|real|a${S}lot${S}of)${S})?pride${S}(?<target>of)${E}(?!${S}place${E})`,
    fix: "in",
  },
  {
    rule: SINCE,
    cue: ["since"],
    pattern: `(?<target>since${S}(?<quantity>a${S}couple(?:${S}of)?|few|(?:(?:over|more${S}than|almost|nearly|about)${S})?(?:two|three|four|five|six|seven|eight|nine|ten|twelve|several|many|a${S}few|[0-9]{1,3}))${S}(?<unit>seconds|minutes|hours|days|weeks|months|years|decades))${E}(?!${S}(?:ago|before|after|earlier|later|prior|old|of|back|since|from|that|when)${E})`,
    fix: sinceDuration,
  },
  // ---- set phrases ----
  {
    rule: CONTEXT,
    cue: ["times"],
    pattern: `(?:most|a${S}lot)${S}of${S}the${S}(?<target>times)${E}(?!${S}(?:I|we|you|he|she|they|it|that|when|which|where|people|the|this|those|these|my|our|their|his|her|its|in|on|of|listed|shown|given|above|below|between|from|to|for|I['’]ve|we['’]ve|you['’]ve|they['’]ve)${E})`,
    fix: "time",
  },
  {
    // "not longer than" is a comparison.
    rule: CONTEXT,
    cue: ["longer"],
    pattern: `(?<target>not)${S}longer${S}(?!(?:than|then|or|and|nor|but|by|in|at|on|to|for|with|that|because|if|since|is|are|was|were)${E})(?=[\\p{L}])`,
    fix: "no",
  },
  {
    rule: STRUCTURE,
    cue: ["longer"],
    pattern: `(?:and|but|so|or)${S}(?<target>(?<no>no${S}longer)${S}(?<pron>${SUBJECT})(?:${S}(?<aux>am|is|are|was|were|can|could|will|would|should|must|may|might|do|does|did|have|has|had))?)${S}(?=[a-z])`,
    fix: (m) => {
      const { no, pron, aux } = m.groups!;
      return { alternatives: [aux ? `${pron} ${aux} ${no}` : `${pron} ${no}`], raw: true };
    },
  },
  {
    // "nor I could" inverts: "nor could I"; "neither my tool nor I shall" coordinates subjects.
    rule: STRUCTURE,
    cue: ["nor"],
    pattern: `nor${S}(?<target>(?<pron>${SUBJECT})${S}(?<aux>${AUXILIARY}))${E}`,
    fix: (m, ctx) =>
      /\bneither\b[^,.!?;:]*$/i.test(before(ctx, m.index))
        ? null
        : { alternatives: [`${m.groups!.aux} ${m.groups!.pron}`], raw: true },
  },
  {
    rule: TYPO,
    cue: ["wont", "wonts"],
    pattern: `(?<subject>${SUBJECT})${S}(?<target>wonts?)${S}to${E}`,
    fix: (m) => (/^(?:he|she|it)$/i.test(m.groups!.subject) ? "wants" : "want"),
  },
  {
    rule: PHRASE,
    cue: ["curse", "coarse", "course"],
    pattern: `(?:${atClause("of")}|(?<![\\p{L}'’])(?:yes|yeah|well|and|but|so|oh|ok|okay|sure),?${S})(?<target>of${S}(?:curse|coarse)|off${S}course)${E}`,
    fix: "of course",
  },
  {
    rule: PHRASE,
    cue: ["limit"],
    pattern: `(?:${BE_FORM}|remain|remains|remained|stay|stays|stayed)${S}(?<target>off${S}limit)${E}`,
    fix: "off limits",
  },
  {
    rule: PHRASE,
    cue: ["oldest"],
    pattern: `oldest(?:${S}[a-z]+){1,3}?${S}in${S}the${S}(?<target>books)${E}`,
    fix: "book",
  },
  {
    rule: PHRASE,
    cue: ["fence"],
    pattern: `(?:(?:I|you|he|she|we|they|anyone|someone|everyone|anybody|somebody|everybody|nobody)${S}(?:am|is|are|was|were)|I['’]m|you['’]re|he['’]s|she['’]s|we['’]re|they['’]re)(?:${S}(?:still|also|really|kinda|totally|completely|honestly|currently|kind${S}of|sort${S}of|a${S}bit))?${S}on${S}(?<target>a)${S}fence${E}`,
    fix: "the",
  },
  { rule: PHRASE, pattern: `once${S}(?<target>a)${S}twice${E}`, fix: "or" },
  {
    // "they are one in the same": after "be"; "another one in the same place" is literal.
    rule: PHRASE,
    cue: ["same"],
    pattern: `(?:${atClause("one")}|(?<![\\p{L}'’])(?:${BE_FORM})${S})one${S}(?<target>in)${S}the${S}same(?:${S}as${E}|(?=[ \\t\\u00a0]{0,8}(?:[.!?,;:)…]|$)))`,
    fix: "and",
  },
  {
    // "you out to be" is "ought"; "made it out to be" and "turned out to be" stay.
    rule: TYPO,
    cue: ["out"],
    pattern: `(?=${SUBJECT})(?<=(?:^|[.!?;:,(][ \\t\\u00a0]{0,8}|(?<![\\p{L}'’])(?:as|then|so|and|but|or|if|that|which|because|since|when|while|though|although|what|how)${S}))(?:${SUBJECT})${S}(?<target>out)${S}to${S}be${E}`,
    fix: "ought",
  },
  {
    rule: PHRASE,
    cue: ["serious"],
    pattern: `(?:take|takes|took|taken|taking)${S}(?:(?:these|those|this|that|the|my|your|his|her|our|their|its)${S})?(?<object>[a-z]+)${S}(?<target>serious)${E}`,
    fix: (m, ctx) => {
      const object = m.groups!.object;
      if (
        !/^(?:it|me|him|her|them|us|you|this|that|everything|anything|anyone|everyone|nothing)$/i.test(
          object,
        ) &&
        !nounLike(object)
      )
        return null;
      return nounLike(nextWord(ctx, matchEnd(m))) ? null : "seriously";
    },
  },
  {
    // "the how it started": the wh-clause needs no article; "the how and the why" stays.
    rule: CONTEXT,
    cue: ["how", "why", "when", "what", "where", "who"],
    pattern: `(?<target>the${S})(?<wh>(?:how|why|when|what|where)${S}(?:it|we|you|they|he|she|I|the|a|an|this|that|these|those)|who${S}(?:is|are|was|were|will|can|it|we|you|they|he|she|I|the|a|an|this|that))${E}`,
    // "The Who is…" names the band.
    fix: (m) => (/^\p{Lu}/u.test(m.groups!.wh) && m[0] !== m[0].toUpperCase() ? null : ""),
  },
  {
    rule: PHRASE,
    cue: ["rank", "ranks"],
    pattern: `${RANKS}`,
    fix: riseRanks,
  },
  {
    rule: TYPO,
    cue: ["through"],
    pattern: `(?<target>through)${S}away${E}`,
    fix: (m, ctx) =>
      /(?:^|[.!?;:]\s*|\b(?:to|don['’]t|do|not|will|would|can|could|should|must|please|never|let['’]s|didn['’]t|did|cannot|can['’]t|won['’]t)\s+)$/i.test(
        before(ctx, m.index, 24),
      )
        ? "throw"
        : ["throw", "threw"],
  },
  {
    rule: PHRASE,
    cue: ["baby"],
    pattern: `(?<target>(?<verb>throw|throws|threw|thrown|throwing|through))${S}(?<away>away${S}|out${S})?(?<baby>the${S}baby)${S}(?<out>out${S})?with${S}the${S}bath(?:(?:${S})?water|-water)${E}`,
    fix: (m) => {
      const { verb, away, out } = m.groups!;
      if (/^through$/i.test(verb)) return { alternatives: ["throw"], range: group(m, "verb") };
      if (away && /^away/i.test(away))
        return { alternatives: ["out"], range: [group(m, "away")[0], group(m, "away")[0] + 4] };
      if (away || out) return null;
      return { alternatives: ["the baby out"], range: group(m, "baby") };
    },
  },
  {
    // "sort after" for "sought after" after "be" or a degree word; "we sort after loading" stays.
    rule: TYPO,
    cue: ["sort"],
    pattern: `(?:(?:${BE_FORM})(?:${S}(?:[a-z]+ly|so|very|still|also|always|often|sometimes|mostly|not|now|quite|quiet|much|more|most|less|pretty|kinda)){0,2}|${SORT_DEGREE})${S}(?<target>sort)${S}after${E}`,
    // "What I would do is sort after the join": an object after it keeps the verb.
    fix: (m, ctx) => (OBJECT_START.test(nextWord(ctx, matchEnd(m))) ? null : "sought"),
  },
  {
    rule: TYPO,
    cue: ["sort"],
    pattern: `of${S}(?<target>sort)${S}after${E}`,
    fix: (m, ctx) => (nounLike(nextWord(ctx, matchEnd(m))) ? "sought" : null),
  },
  {
    rule: MISSING_TO,
    cue: GOVERNOR_PAST.split("|"),
    pattern: `${notAfter("the|a|an|this|that|these|those|my|your|his|her|its|our|their|some|any|no|every|each")}(?:${GOVERNOR_PAST})${S}(?<target>[a-z]+)${E}`,
    fix: missingTo,
  },
  {
    rule: MISSING_TO,
    cue: GOVERNOR_BASE.split("|"),
    pattern: `(?<![\\p{L}'’])(?:${BASE_LEAD})${S}(?:${GOVERNOR_BASE})${S}(?<target>[a-z]+)${E}`,
    fix: missingTo,
  },
  {
    rule: MISSING_TO,
    cue: GOVERNOR_THIRD.split("|"),
    pattern: `(?:he|she|it|who|one|everyone|someone|somebody|everybody|nobody|anyone|anybody)${S}(?:${GOVERNOR_THIRD})${S}(?<target>[a-z]+)${E}`,
    fix: missingTo,
  },
  {
    rule: MISSING_TO,
    cue: GOVERNOR_ADJECTIVES.split("|"),
    pattern: `(?:${BE_FORM}|feel|feels|felt|seem|seems|seemed|not|so|very|really|always|more|less|quite|too)${S}(?:${GOVERNOR_ADJECTIVES})${S}(?<target>[a-z]+)${E}`,
    fix: missingTo,
  },
  {
    rule: COMPOUND,
    cue: PHRASAL_CUE,
    pattern: `(?:${atClause("you")}|(?<![\\p{L}'’])(?:and|but|or|so|then|if|when|that|because|where|once|before|after|until|unless|while|now|always|never|also|just|often|usually)${S})you${S}(?<target>${PHRASAL_OWN})${E}`,
    fix: phrasal,
  },
  {
    rule: COMPOUND,
    cue: PHRASAL_CUE,
    pattern: `(?<![\\p{L}'’])(?:I|we|they|(?<=(?:^|[.!?;:]|\\b(?:hope|that|if|when|who))${S})you)${S}(?<target>${PHRASAL_OWN})${E}`,
    fix: phrasal,
  },
  {
    // "who setup the servers": a subject "who" before an object.
    rule: COMPOUND,
    cue: PHRASAL_CUE,
    pattern: `(?<![\\p{L}'’])who${S}(?<target>${PHRASAL_WORDS})${S}(?:${VERB_AFTER})${E}`,
    fix: phrasal,
  },
  {
    rule: COMPOUND,
    cue: PHRASAL_CUE,
    // A modal opening its sentence asks about a noun: "Would checkout really help?". A
    // negated do/modal needs its subject before it ("I couldn't checkout").
    pattern: `(?:(?<!(?:^|[.!?]["”’)]?[ \\t]{1,8}|\\n))(?:will|would|can|could|should|must|might|may|shall)|never|(?<=(?:^|[^\\p{L}'’])(?:i|you|we|they|he|she|it|who)${S})(?:do|does|did|could|would|should|can|wo|must|might)(?:n['’]t|${S}not)|please|let['’]s|cannot)${S}(?<target>${PHRASAL_OWN})${E}`,
    fix: phrasal,
  },
  {
    rule: COMPOUND,
    cue: PHRASAL_CUE,
    pattern: `(?:${INFINITIVE_LEAD})${S}to${S}(?<target>${PHRASAL_OWN})${E}`,
    fix: phrasalInfinitive,
  },
  {
    // A split infinitive is a verb: "to properly setup a link".
    rule: COMPOUND,
    cue: PHRASAL_CUE,
    pattern: `to${S}[a-z]+ly${S}(?<target>${PHRASAL_WORDS})${E}`,
    fix: phrasal,
  },
  {
    rule: COMPOUND,
    cue: PHRASAL_CUE,
    pattern: `to${S}(?<target>${PHRASAL_OWN})${S}(?:${VERB_AFTER})${E}`,
    fix: phrasal,
  },
  {
    rule: COMPOUND,
    cue: ["show"],
    pattern: `(?<target>show(?:${S}case|-case|-cases|-cased|-casing))${E}(?!${S}(?:[0-9]|(?:stud(?:y|ies)|sensitive|insensitive|sensitivity|numbers?|files?|laws?|histor(?:y|ies)|notes?|reports?|examples?|results?|details?|statements?|summar(?:y|ies)|managers?|workers?|officers?|status)${E}))`,
    fix: (m) => m.groups!.target.replace(/[ \t\u00a0-]+/, ""),
  },
  {
    rule: COMPOUND,
    cue: ["soon"],
    pattern: `(?:(?:the|a|an|my|your|his|her|its|our|their|this|that|these|those)${S}|${atClause("soon")})(?<target>soon${S}to${S}be)${S}(?=[\\p{L}\\p{N}])`,
    fix: (m, ctx) => {
      const next = nextWord(ctx, group(m, "target")[1]);
      // At a clause start, only a noun makes it attributive: "Soon to be parents filled…".
      if (
        /^soon/i.test(m[0]) &&
        (!nounLike(next) || hasForm(next, "past") || hasForm(next, "participle"))
      )
        return null;
      return "soon-to-be";
    },
  },
  {
    rule: PHRASE,
    cue: ["versa"],
    pattern: `(?<target>vi[cs]e(?:-a-|${S}a${S}|-)versa)(?![\\p{L}\\p{N}_'’])`,
    fix: "vice versa",
  },
  {
    rule: CONTEXT,
    cue: ["wish", "wishes", "wished", "wishing"],
    pattern: `(?:wish|wishes|wished|wishing)${S}(?:that${S})?(?:I|you|we|they|he|she|it|this|that|someone|somebody|everyone|everybody|anyone|anybody)${S}(?<target>can)${E}`,
    fix: "could",
  },
  {
    // "to never to do": one "to" too many. "You shouldn't have to just to get by" elides
    // the first verb, and "set it to always to be safe" names a value.
    rule: CONTEXT,
    cue: ["to"],
    pattern: `${notAfter("have|has|had|having|ought|got|need|needs|want|wants|going|condition|option|setting|mode")}(?<target>(?<first>to)${S}(?<adverb>[a-z]+)${S}to)${S}(?<verb>[a-z]+)${E}`,
    fix: (m) => {
      const { first, adverb, verb } = m.groups!;
      if (!ADVERB_SLOT.test(adverb) && !(info(adverb)?.adverb && /ly$/i.test(adverb))) return null;
      if (!hasForm(verb, "base")) return null;
      const alternatives = [`${first} ${adverb}`];
      if (/^(?:never|not)$/i.test(adverb)) alternatives.push(`${recase(first, adverb, m[0])} to`);
      return { alternatives, raw: true };
    },
  },
  {
    rule: PHRASE,
    cue: ["problem"],
    pattern: `(?<target>(?<verb>run|runs|ran|running)${S}into${S}problem)${E}`,
    fix: (m, ctx) =>
      nounLike(nextWord(ctx, matchEnd(m)))
        ? null
        : [`${m.groups!.verb} into a problem`, `${m.groups!.verb} into problems`],
  },
  {
    // "good till date" is an order type.
    rule: PHRASE,
    cue: ["till", "til"],
    pattern: `${notAfter("good")}(?<target>(?:till|til)(?:${S}|-)date)${E}`,
    fix: "to date",
  },
  // ---- optional style ----
  {
    rule: STYLE_ADVICE,
    cue: ["that"],
    pattern: `${atClause("that")}(?<target>that${S}that)${S}(?:is|was|are|were)${E}`,
    fix: "that which",
  },
  {
    rule: STYLE_ADVICE,
    cue: FREQUENCY.split("|"),
    pattern: `(?<target>(?<first>${FREQUENCY})${S}(?<second>${FREQUENCY}))${E}`,
    fix: (m) => {
      const { first, second } = m.groups!;
      return lower(first) === lower(second) ? null : { alternatives: [first, second], raw: true };
    },
  },
  {
    rule: STYLE_ADVICE,
    cue: ["over"],
    pattern: `(?<target>over${S}(?<number>[0-9][0-9,.]*(?:${S}(?:thousand|million|billion))?)(?:${S}(?<plus>plus)|\\+))(?![\\p{L}\\p{N}_-])(?!${S}(?:size|sizes|sized)${E})`,
    fix: (m) => {
      const typed = m.groups!.target;
      // "over 5,000 PLUS": capitals for emphasis are the writer's choice.
      const plus = m.groups!.plus;
      if (plus && plus === plus.toUpperCase() && !/^OVER/.test(typed)) return null;
      const amount = typed.replace(/^over[ \t\u00a0]+/i, "");
      return { alternatives: [`${typed.slice(0, 4)} ${m.groups!.number}`, amount], raw: true };
    },
  },
  {
    rule: STYLE_ADVICE,
    cue: ["eat", "eats", "ate", "eaten", "eating"],
    pattern: `(?<target>(?<verb>eat|eats|ate|eaten|eating))${S}(?:(?:the|my|your|his|her|their|our|some|these|those|this|that|prescribed)${S}){0,2}(?:${MEDICINE})${E}`,
    fix: (m) => {
      const verb = lower(m.groups!.verb);
      return verb === "ate"
        ? ["took", "swallowed"]
        : ({ eat: "take", eats: "takes", eaten: "taken", eating: "taking" } as const)[
            verb as "eat"
          ];
    },
  },
  {
    rule: STYLE_ADVICE,
    cue: ["last"],
    pattern: `(?:in|for|during|over|within|throughout)${S}the${S}(?<target>last${S})(?:minutes|hours|days|weeks|months|years|decades)${E}(?!${S}(?:of|before|after|until|till|prior|leading|preceding|following|when)${E})`,
    fix: "last few ",
  },
  {
    rule: STYLE_ADVICE,
    cue: ["thrive", "thrives", "thrived", "throve", "thriving"],
    pattern: `(?:thrive|thrives|thrived|throve|thriving)${S}(?<target>off)${E}(?!${S}(?:of|the${S}land)${E})`,
    fix: "on",
  },
  {
    rule: STYLE_ADVICE,
    cue: ["rank", "ranks"],
    pattern: RANKS,
    fix: riseRanksStyle,
  },
  {
    rule: STYLE_ADVICE,
    cue: ["trash", "garbage", "rubbish", "litter"],
    pattern: `(?<target>(?<verb>throw|throws|threw|thrown|throwing)${S}(?<det>(?:(?:the|my|his|her|their|our|your|some|any|this|that|all${S}the)${S})?)(?<noun>trash|garbage|rubbish|litter))${E}`,
    fix: (m, ctx) => {
      const next = nextWord(ctx, matchEnd(m));
      // "garbage data", "garbage comments": a noun (or an unknown word) after it.
      const known = next && !FUNCTION_WORD.test(next) ? info(next) : null;
      const tagged =
        known &&
        (known.noun || known.plural || known.adjective || known.adverb || known.verbs.length);
      if (TRASH_AFTER.test(next) || (known !== null && !tagged)) return null;
      if (nounLike(next) && !hasForm(next, "ing")) return null;
      const { verb, det, noun } = m.groups!;
      const object = `${det}${noun}`;
      return [`${verb} away ${object}`, `${verb} out ${object}`, `${verb} ${object} away`];
    },
  },
];

/** The lowercase words from 256 characters before the chunk to 256 after it. */
// Read once per chunk: every frame detector built on this engine shares it.
const WORDS_NEAR = new WeakMap<DetectContext, Set<string>>();
function wordsNear(ctx: DetectContext): Set<string> {
  let words = WORDS_NEAR.get(ctx);
  if (!words) {
    words = new Set(
      ctx.scanText
        .slice(Math.max(0, ctx.from - 256), ctx.to + 256)
        .toLowerCase()
        .match(/\p{L}+/gu),
    );
    WORDS_NEAR.set(ctx, words);
  }
  return words;
}

/** Runs every frame whose rule is enabled; the `target` group (or a fix's range) is replaced. */
export const frameDetector =
  (frames: readonly Frame[]) =>
  (ctx: DetectContext): RawFinding[] =>
    detectFrames(ctx, frames);

function detectFrames(ctx: DetectContext, frames: readonly Frame[] = FRAMES): RawFinding[] {
  if (!ctx.lang.startsWith("en")) return [];
  const findings: RawFinding[] = [];
  const words = wordsNear(ctx);
  for (const { rule, cue, pattern, fix } of frames) {
    if (ctx.rules && !ctx.rules.has(rule.ruleId)) continue;
    if (cue && !cue.some((word) => words.has(word))) continue;
    // A frame with two alternatives names its second owner "target2".
    const owner = /\(\?<target2>/.test(typeof pattern === "string" ? pattern : pattern.source)
      ? (m: RegExpExecArray) => (m.indices!.groups!.target ?? m.indices!.groups!.target2)[0]
      : "target";
    for (const m of frameMatches(ctx, pattern, owner)) {
      if (hasUserOrCasedWord(ctx, m[0])) continue;
      // A quoted example ("need to backup") is mentioned, not used.
      if (
        OPENING_QUOTES.includes(ctx.text[m.index - 1] || "\n") &&
        /^["”'’“‘»«›‹]/.test(ctx.text.slice(matchEnd(m), matchEnd(m) + 1))
      )
        continue;
      const result = typeof fix === "function" ? fix(m, ctx) : fix;
      if (result === null) continue;
      const {
        alternatives,
        range = group(m, "target"),
        raw,
      }: Fix = typeof result === "string"
        ? { alternatives: [result] }
        : "alternatives" in result
          ? result
          : { alternatives: result };
      const [start, end] = range;
      const typed = ctx.text.slice(start, end);
      const cased = alternatives.map((alt) => (raw ? alt : recase(typed, alt, m[0])));
      if (cased.includes(typed)) continue;
      findings.push({
        ...rule,
        range: { start, end },
        alternatives: cased,
        ...(cased.length > 1 ? { requiresChoice: true as const } : {}),
        context: {
          start: Math.max(0, Math.min(start, m.index) - 40),
          end: Math.min(ctx.text.length, Math.max(end, matchEnd(m)) + 20),
        },
      });
    }
  }
  return findings;
}

/** Context detectors appended to REVIEW_DETECTORS. */
export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: [
      "englishPhraseCorrections",
      "englishFixedPrepositions",
      "englishVerbComplements",
      "englishSentenceStructure",
      "englishContextualCompounds",
      "stylePhrasing",
    ],
    detect: (ctx) => detectFrames(ctx),
  },
];
