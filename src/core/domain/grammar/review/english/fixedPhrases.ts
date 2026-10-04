import { englishWordInfo, hasVerbForm } from "../../implementations/helpers/EnglishLexicon";
import { applyWordCase, detectWordCase } from "../../implementations/helpers/GenericRuleShared";
import { each, type Pair, type PhraseRow, PLURAL, POSSESSIVES, TAKE } from "../englishPhraseTables";
import {
  before,
  caseLike,
  COMPLETE,
  EDGE,
  frame,
  frameMatches,
  group,
  hasUserOrCasedWord,
  nextWord,
  notAfter,
  SPACE,
  WORD_END,
  isLang,
} from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";

const GET = ["get", "gets", "got", "gotten", "getting"];
const MAKE = ["make", "makes", "made", "making"];
const LOOK = ["look", "looks", "looked", "looking"];
/** A regular verb's four typed forms paired with the replacement's forms. */
const TENSES = (base: string, to: string, third: string, past: string, ing: string): Pair[] => {
  const stem = base.replace(/e$/, "");
  return [
    [base, to],
    [`${base}s`, third],
    [`${stem}ed`, past],
    [`${stem}ing`, ing],
  ];
};

/** Misheard idioms, wrong words in set phrases and their inflections. */
export const PHRASES: readonly PhraseRow[] = [
  ["much adieu", "much ado"],
  ...each(PLURAL, "argument~ to be said", "argument~ to be made"),
  ...each(
    PLURAL,
    ["backhand compliment~", "back hand compliment~", "back-hand compliment~"],
    "backhanded compliment~",
  ),
  ...each(
    POSSESSIVES,
    ["bain of ~ existence", "bain of ~ existance", "bane of ~ existance"],
    "bane of ~ existence",
  ),
  ...each(PLURAL, ["bane-marie~", "bane marie~"], "bain-marie~"),
  ...each(PLURAL, ["commitment~ towards", "commitment~ toward"], "commitment~ to"),
  [["copywritten", "copywrited", "copywrote"], "copyrighted"],
  ["copywrites", "copyrights"],
  ...each(["date", "dates", "dated", "dating"], "~ back from", "~ back to"),
  ...each(PLURAL, ["double-edge sword~", "double edge sword~"], "double-edged sword~"),
  ...each(PLURAL, ["expatriot~", "ex-patriot~"], "expatriate~"),
  ...each(GET, ["~ rid off", "~ ride of", "~ ride off"], "~ rid of"),
  ...each(PLURAL, "holly war~", "holy war~"),
  ["in retaliation to", ["in retaliation for", "in response to"]],
  ["level of details", ["level of detail", "levels of detail"]],
  ["levels of details", "levels of detail"],
  ...each(
    ["several", "multiple", "many", "two", "three", "four", "different", "various"],
    ["~ level of details", "~ level of detail", "~ levels of details"],
    "~ levels of detail",
  ),
  ...each(["this", "that"], "in ~ regards", "in ~ regard"),
  ["monumentous", "momentous"],
  ["monumentously", "monumentally"],
  ...each(
    ["is", "are", "was", "were", "do", "does", "did", "has", "have", "had", "can", "could", "will"],
    "no only ~",
    "not only ~",
  ),
  ["play a factor", ["play a role", "be a factor"]],
  ["plays a factor", ["plays a role", "is a factor"]],
  ["played a factor", ["played a role", "was a factor"]],
  ["playing a factor", ["playing a role", "being a factor"]],
  [
    ["reversed engineer", "reversed engineered"],
    ["reverse engineered", "reverse engineer"],
  ],
  [["reversed-engineer", "reversed-engineered"], "reverse-engineered"],
  ...each(["engineering", "engineers"], ["reversed ~", "reversed-~"], "reverse ~"),
  ["a bridge to far", "a bridge too far"],
  [["life's to short", "lifes to short", "lifes too short"], "life's too short"],
  ["life is to short", "life is too short"],
  ["to fine a point", "too fine a point"],
  // "too big too fail" is the to/too frame's.
  [["to big to fail", "to big too fail"], "too big to fail"],
  [["to good to be true", "to good too be true"], "too good to be true"],
  ...each(
    ["think", "thinks", "thought", "thinking", "worry", "worries", "worried", "worrying"],
    "~ to much",
    "~ too much",
  ),
  ...each(PLURAL, ["worse-case-scenario~", "worst-case-scenario~"], "worst-case scenario~"),
  [["worse case scenarios", "worse-case scenarios"], "worst-case scenarios"],
  ["worst and worst", "worse and worse"],
  ...each(["turn", "turns", "turned", "turning"], "~ for the worst", "~ for the worse"),
  ...each(TENSES("combinate", "combine", "combines", "combined", "combining"), "~", "~"),
  ["condensated", "condensed"],
  ["condensating", "condensing"],
  ...each(TENSES("compulse", "compel", "compels", "compelled", "compelling"), "~", "~"),
  ...each(TENSES("provocate", "provoke", "provokes", "provoked", "provoking"), "~", "~"),
  ...each(PLURAL, "definitive article~", "definite article~"),
  ...each(PLURAL, "digestive track~", "digestive tract~"),
  ...each(["mark", "marks", "point", "points"], "explanation ~", "exclamation ~"),
  ...each(
    [
      ...["a certain", "some", "an", "a large", "a great", "a lesser", "the same", "such an"],
      ...["what", "the full", "the fullest", "a small"],
    ],
    "to ~ extend",
    "to ~ extent",
  ),
  ["to the extend that", "to the extent that"],
  ...each(TENSES("flaunt", "flout", "flouts", "flouted", "flouting"), "~ the rules", "~ the rules"),
  ...each(TENSES("flaunt", "flout", "flouts", "flouted", "flouting"), "~ the law", "~ the law"),
  ...each(TENSES("flaunt", "flout", "flouts", "flouted", "flouting"), "~ authority", "~ authority"),
  ...each(["foam", "foams", "foamed", "foaming"], "~ out the mouth", "~ at the mouth"),
  ...each(
    [
      ["flip", "foot"],
      ["flips", "foots"],
      ["flipped", "footed"],
      ["flipping", "footing"],
    ],
    "~ the bill",
    "~ the bill",
  ),
  ...each(GET, "~ used of", "~ used to"),
  ...each(["hit", "hits", "hitting", "hitted"], "~ the nail in the head", "~ the nail on the head"),
  ...each(PLURAL, "infliction point~", "inflection point~"),
  ["layouted", "laid out"],
  ["layouting", "laying out"],
  ...each(LOOK, "~ forward for", "~ forward to"),
  ...each(["made", "makes", "making"], "~ due with", "~ do with"),
  ...each(MAKE, "~ senses", "~ sense"),
  [["point is mute"], "point is moot"],
  ["point was mute", "point was moot"],
  ...each(PLURAL, "operative system~", "operating system~"),
  [["passerbys", "passerby's"], "passersby"],
  ["passer-bys", "passers-by"],
  ...each(
    TENSES("peak", "peek", "peeks", "peeked", "peeking"),
    "~ behind the curtain",
    "~ behind the curtain",
  ),
  ...each(
    [...TAKE, "assume", "assumes", "assumed", "assuming", "claim", "claims", "claimed", "claiming"],
    "~ responsibility of",
    "~ responsibility for",
  ),
  ...each(TAKE, "~ full responsibility of", "~ full responsibility for"),
  ["an escape goat", "a scapegoat"],
  ...each(PLURAL, "escape goat~", "scapegoat~"),
  ...each(["set", "sets", "setting"], "~ up a bad example", "~ a bad example"),
  ...each(["set", "sets", "setting"], "~ up a good example", "~ a good example"),
  ...each(
    [...GET, "am", "are", "were", "I'm", "you're", "we're", "they're"],
    "~ use to",
    "~ used to",
  ),
  ...each(
    [
      ["verse", "play"],
      ["verses", "plays"],
      ["versed", "played"],
      ["versing", "playing"],
    ],
    "~ against",
    "~ against",
  ),
  ["versing", "playing"],
  ...["come", "to", "can", "gonna", "wanna"].flatMap((lead) =>
    each(["me", "you", "him", "her", "them", "us"], `${lead} verse ~`, `${lead} play ~`),
  ),
  ["by wrote", "by rote"],
  ["by-wrote", "by-rote"],
  ...each(
    ["learning", "memorization", "memorisation", "memorizing", "memorising"],
    "wrote-~",
    "rote-~",
  ),
  // "seam" is a noun and a sewing verb; after a subject and before "to" it is "seem".
  ...each(
    [
      ...["i", "you", "we", "they"].flatMap((s) => [s, `${s} all`, `${s} both`]),
      ...["can't", "cannot", "don't", "didn't", "doesn't"],
    ],
    "~ seam to",
    "~ seem to",
  ),
  ...each(["they", "they all", "they both"], "~ seam", "~ seem"),
  ...each(
    [
      ...["he", "she", "it", "everyone", "everybody", "everything", "someone", "somebody"],
      ...["nobody", "nothing", "anyone"],
    ],
    "~ seams",
    "~ seems",
  ),
  ...each(
    ["i", "you", "we", "they", "he", "she", "it", "everyone", "everything"],
    "~ seamed to",
    "~ seemed to",
  ),
];

/** Split, joined and hyphenated forms of single words. */
export const COMPOUNDS: readonly PhraseRow[] = [
  ...each(PLURAL, ["ex-pat~", "ex pat~"], "expat~"),
  ...each(["", "s", "ed", "ing", "er", "ers"], ["hi-jack~", "high jack~", "high-jack~"], "hijack~"),
  [
    [
      ...["now a days", "now a day's", "now-a-days", "now-a-day", "now-adays", "now adays"],
      ...["nowaday", "now aday's", "nowa days", "now aday", "now-a-day's"],
    ],
    "nowadays",
  ],
  ...each(PLURAL, "look-a-like~", "lookalike~"),
  ...each(PLURAL, ["double edged sword~"], "double-edged sword~"),
];

/** Optional advice: informal abbreviations, contested idiom variants, redundancy. */
export const STYLE: readonly PhraseRow[] = [
  ["alloc", ["allocate", "allocation"]],
  ["allocs", ["allocations", "allocates"]],
  ["govts", "governments"],
  ...[
    ["algo", "algorithm"],
    ["arg", "argument"],
    ["coord", "coordinate"],
    ["decl", "declaration"],
    ["deref", "dereference"],
    ["notif", "notification"],
    ["param", "parameter"],
    ["ptr", "pointer"],
  ].flatMap(([short, word]) => each(PLURAL, `${short}~`, `${word}~`)),
  ["dep", "dependency"],
  ["deps", "dependencies"],
  ["dir", "directory"],
  ["dirs", "directories"],
  ["vuln", "vulnerability"],
  ["vulns", "vulnerabilities"],
  ...each(
    [
      ["chomp", "champ"],
      ["chomps", "champs"],
      ["chomped", "champed"],
      ["chomping", "champing"],
    ],
    "~ at the bit",
    "~ at the bit",
  ),
  ...each(
    [
      ["hone", "home"],
      ["hones", "homes"],
      ["honed", "homed"],
      ["honing", "homing"],
    ],
    "~ in on",
    "~ in on",
  ),
  ...each(
    [
      "invest",
      "invests",
      "invested",
      "investing",
      "re-invest",
      "re-invests",
      "re-invested",
      "re-investing",
      "reinvest",
      "reinvests",
      "reinvested",
      "reinvesting",
      "investment",
      "investments",
    ],
    "~ into",
    "~ in",
  ),
  ...each(TAKE, "~ control over", "~ control of"),
  ...each(
    [
      ["uncommon", "common"],
      ["unlikely", "likely"],
      ["insignificant", "significant"],
      ["unusual", "usual"],
      ["unimportant", "important"],
    ],
    "not ~",
    "~",
  ),
  [["more preferable", "most preferable"], "preferable"],
  [["more optimal", "most optimal"], "optimal"],
  [["most ideal", "more ideal"], "ideal"],
  ["a side tangent", ["an aside", "a tangent"]],
  ["side tangent", "tangent"],
  ["side tangents", "tangents"],
  ["a whole entire", ["a whole", "an entire"]],
  [
    ["whole entire", "entire whole"],
    ["whole", "entire"],
  ],
  [["client's side"], ["client-side", "client side"]],
  [["server's side"], ["server-side", "server side"]],
];

// ---- Context detectors: forms that are also ordinary English elsewhere. ----

type Rule = Pick<RawFinding, "ruleId" | "messageKey">;
const PHRASE: Rule = {
  ruleId: "englishPhraseCorrections",
  messageKey: "review_msg_phrase_correction",
};
const CONTEXT: Rule = {
  ruleId: "englishPhraseCorrections",
  messageKey: "review_msg_contextual_grammar",
};
const TYPO: Rule = { ruleId: "englishPhraseCorrections", messageKey: "review_msg_typo" };
const TOO: Rule = { ruleId: "englishToToo", messageKey: "review_msg_to_too" };

/** A finding for `range`; each alternative takes the typed text's initial or all capitals. */
function found(
  ctx: DetectContext,
  rule: Rule,
  m: RegExpExecArray,
  [start, end]: readonly [number, number],
  alternatives: readonly string[],
  recase = true,
): RawFinding | null {
  if (hasUserOrCasedWord(ctx, m[0])) return null;
  const typed = ctx.text.slice(start, end);
  const cased = alternatives.map((alt) => (recase ? caseLike(typed, alt) : alt));
  return {
    ...rule,
    range: { start, end },
    alternatives: cased,
    ...(cased.length > 1 ? { requiresChoice: true as const } : {}),
    context: {
      start: Math.max(0, m.index - 32),
      end: Math.min(ctx.text.length, m.index + m[0].length + 16),
    },
  };
}
/** Only spaces and opening marks between `index` and a stop, a line break or the text start. */
const atClauseStart = (ctx: DetectContext, index: number) =>
  /(?:^|[.!?;:\n])[ \t\u00a0"“'‘(]*$/.test(before(ctx, index, 96));
// Function words the lexicon also lists as nouns ("ifs and buts", "the ins and outs").
const CLOSED_CLASS =
  /^(?:if|in|on|at|to|for|with|by|of|off|out|up|down|over|than|and|or|but|so|as|when|because|since|after|before|until|now|then|again|lately|here|there|yet|still|too|very|it|this|that)$/i;
/** A word the lexicon knows as a noun; it omits long pure nouns, so unknown long words count. */
const nounLike = (word: string, unknownLong = true) => {
  if (!word || CLOSED_CLASS.test(word)) return false;
  const info = englishWordInfo(word.toLowerCase());
  return info ? info.noun || info.plural : word.length > 6 && (unknownLong || /s$/i.test(word));
};
const kept = (findings: (RawFinding | null)[]) => findings.filter((f): f is RawFinding => !!f);

// "dose" for "does": after a subject pronoun, in a clause-opening wh-question, or opening a
// yes/no question. "What dose of…", "what dose it takes" and "to dose it" stay nouns or verbs.
const DOSE_SUBJECT = frame(
  `(?:he|she|it|someone|somebody|everyone|everybody|anyone|anybody|nobody)${SPACE}(?<target>dose)${WORD_END}`,
);
const DOSE_WH = frame(
  `(?:what|how|when|where|why|who|which)${SPACE}(?<target>dose)${SPACE}(?<next>\\p{L}[\\p{L}'’]*)(?:${SPACE}(?<then>\\p{L}+))?`,
);
const DOSE_QUESTION = frame(
  `(?<target>dose)${SPACE}(?:it|he|she|this|that|anyone|someone|anybody|everyone|everything|anything)${SPACE}(?<verb>[a-z]+)${WORD_END}`,
);
const NOUN_DOSE_NEXT =
  /^(?:of|is|was|are|were|has|had|have|should|would|will|can|could|may|might|must|per|for|and|or|to|in|on|at|level|levels|amount|size|range|form)$/i;
const PRONOUN_NEXT = /^(?:it|he|she|this|that|they|we|you|i)$/i;
function dose(ctx: DetectContext): RawFinding[] {
  const out: (RawFinding | null)[] = [];
  for (const m of frameMatches(ctx, DOSE_SUBJECT))
    out.push(found(ctx, TYPO, m, group(m, "target"), ["does"]));
  for (const m of frameMatches(ctx, DOSE_WH)) {
    const { next, then = "" } = m.groups!;
    if (!atClauseStart(ctx, m.index) || NOUN_DOSE_NEXT.test(next)) continue;
    const pronoun = PRONOUN_NEXT.test(next);
    if (!pronoun && englishWordInfo(next.toLowerCase())?.plural) continue;
    // "what dose it takes": a third-person verb after the pronoun keeps "dose" a noun.
    if (pronoun && hasVerbForm(then.toLowerCase(), "third")) continue;
    out.push(found(ctx, TYPO, m, group(m, "target"), ["does"]));
  }
  for (const m of frameMatches(ctx, DOSE_QUESTION)) {
    const verb = m.groups!.verb;
    if (!atClauseStart(ctx, m.index) || /^(?:back|up|off|out|down|too|twice|once)$/i.test(verb))
      continue;
    if (hasVerbForm(verb, "base")) out.push(found(ctx, TYPO, m, group(m, "target"), ["does"]));
  }
  return kept(out);
}

// worse/worst: a comparative slot (much, far, get, make it …) or "at worst".
const GETS =
  "(?:get|gets|got|gotten|getting|become|becomes|became|becoming|grow|grows|grew|grown|growing)";
const WORST_DEGREE = frame(
  `${notAfter("by")}(?:much|far|a${SPACE}lot|lots|even|way|slightly|somewhat|considerably|significantly)${SPACE}(?<target>worst)${WORD_END}`,
);
const WORST_GET = frame(
  `(?:${GETS}|(?:make|makes|made|making)${SPACE}(?:it|them|things|this|that|everything|matters))${SPACE}(?<target>worst)${WORD_END}`,
);
const WORST_THAN = frame(`(?<target>worst)${SPACE}than${WORD_END}`);
const WORSE_AND_WORST = frame(`${GETS}${SPACE}worse${SPACE}and${SPACE}(?<target>worst)${WORD_END}`);
const AT_WORSE = frame(`at${SPACE}(?<target>worse)${COMPLETE}`);
// "the worse ever": a superlative slot; "got worse ever since" stays.
const WORSE_EVER = frame(`(?<target>worse)${SPACE}ever${WORD_END}(?!${SPACE}since${WORD_END})`);
function worse(ctx: DetectContext): RawFinding[] {
  const out = new Map<number, RawFinding | null>();
  const add = (m: RegExpExecArray, word: string) => {
    const range = group(m, "target");
    if (!out.has(range[0])) out.set(range[0], found(ctx, CONTEXT, m, range, [word]));
  };
  for (const m of frameMatches(ctx, WORST_THAN)) add(m, "worse");
  for (const m of frameMatches(ctx, WORST_DEGREE)) add(m, "worse");
  for (const m of frameMatches(ctx, WORSE_AND_WORST)) add(m, "worse");
  // "getting worst accuracy", "makes them worst case": a noun after it makes it a superlative.
  for (const m of frameMatches(ctx, WORST_GET))
    if (!nounLike(nextWord(ctx, group(m, "target")[1]))) add(m, "worse");
  for (const m of frameMatches(ctx, AT_WORSE)) add(m, "worst");
  for (const m of frameMatches(ctx, WORSE_EVER)) add(m, "worst");
  return kept([...out.values()]);
}

// "how it looks like": either "what it looks like" or "how it looks".
const HOW_LIKE = frame(
  `(?<target>(?<how>how)${SPACE}(?<subject>it|he|she|they|we|you|I|this|that|these|those|everything)${SPACE}(?<verb>looks|look['’]s|look|looked)${SPACE}like)${WORD_END}`,
);
const HOW_DOES_LIKE = frame(
  `(?<target>how)${SPACE}(?:does|do|did|would|will|should|could|might)${SPACE}(?:it|he|she|they|we|you|I|this|that|these|those)${SPACE}look${SPACE}like${WORD_END}`,
);
function howLooksLike(ctx: DetectContext): RawFinding[] {
  const out: (RawFinding | null)[] = [];
  for (const m of frameMatches(ctx, HOW_LIKE)) {
    const { subject, verb } = m.groups!;
    const single = /^(?:it|he|she|this|that|everything)$/i.test(subject);
    const agreed = /ed$/i.test(verb) ? "looked" : single ? "looks" : "look";
    out.push(
      found(ctx, CONTEXT, m, group(m, "target"), [
        `what ${subject} ${agreed} like`,
        `how ${subject} ${agreed}`,
      ]),
    );
  }
  for (const m of frameMatches(ctx, HOW_DOES_LIKE))
    out.push(found(ctx, CONTEXT, m, group(m, "target"), ["what"]));
  return kept(out);
}

// "made it seems like": a causative make takes the base form. A relative clause before
// it can make "seems" the main verb ("the one who made it seems tired").
const MAKE_SEEM = frame(
  `(?<make>make|makes|made|making)${SPACE}(?:it|them|him|her|me|us|you|this|that|everything|things)${SPACE}(?<target>seems|seemed)${WORD_END}`,
);
function makeSeem(ctx: DetectContext): RawFinding[] {
  const out: (RawFinding | null)[] = [];
  for (const m of frameMatches(ctx, MAKE_SEEM)) {
    const prior = before(ctx, m.index, 48);
    if (/\b(?:who|whoever|whatever|what)[ \t\u00a0]+$/i.test(prior)) continue;
    if (
      /^making$/i.test(m.groups!.make) &&
      !/\b(?:of|by|for|from|without|avoid|stop|keep|keeps|kept|is|are|was|were|be|been)[ \t\u00a0]+$/i.test(
        prior,
      )
    )
      continue;
    out.push(
      found(
        ctx,
        { ruleId: "englishVerbComplements", messageKey: "review_msg_causative_base" },
        m,
        group(m, "target"),
        ["seem"],
      ),
    );
  }
  return kept(out);
}

// A person who is a "nerve wreck" is a "nervous wreck"; a situation ("It was a nerve-wreck",
// "so much nerve wreck") is left alone.
const NERVE_WRECK = frame(`(?<target>nerve(?:${SPACE}|-)wrecks?)${WORD_END}`);
const SITUATION =
  /(?:\bmuch|\b(?:it|this|that|which)(?:['’]s|[ \t\u00a0]+(?:is|was|were|be|been|will[ \t\u00a0]+be))[ \t\u00a0]+(?:(?:a|such[ \t\u00a0]+a|quite[ \t\u00a0]+a|a[ \t\u00a0]+real|a[ \t\u00a0]+total|a[ \t\u00a0]+complete)[ \t\u00a0]+)?)[ \t\u00a0]*$/i;
function nerveWreck(ctx: DetectContext): RawFinding[] {
  const out: (RawFinding | null)[] = [];
  for (const m of frameMatches(ctx, NERVE_WRECK)) {
    if (SITUATION.test(before(ctx, m.index, 48))) continue;
    const [nerve, wreck] = m.groups!.target.split(/[ \t\u00a0-]+/);
    const nervous = applyWordCase("nervous", detectWordCase(nerve));
    out.push(found(ctx, PHRASE, m, group(m, "target"), [`${nervous} ${wreck}`]));
  }
  return kept(out);
}

// "bullocks" (young bulls) for "bollocks" (nonsense): after a predicate or an intensifier,
// or as an exclamation. "a herd of bullocks" stays.
const BULLOCKS = frame(`(?<target>bullocks)${WORD_END}`);
const NONSENSE_CUE =
  /(?:\b(?:complete|total|utter|absolute|pure|such|dogs|is|was|its|thats|what|bloody|just)|['’]s)[ \t\u00a0]+$/i;
function bullocks(ctx: DetectContext): RawFinding[] {
  const out: (RawFinding | null)[] = [];
  for (const m of frameMatches(ctx, BULLOCKS)) {
    const [, end] = group(m, "target");
    const exclamation =
      (atClauseStart(ctx, m.index) || /["“'‘]$/.test(before(ctx, m.index, 1))) &&
      /^[ \t\u00a0]*!/.test(ctx.text.slice(end));
    if (exclamation || NONSENSE_CUE.test(before(ctx, m.index, 48)))
      out.push(found(ctx, PHRASE, m, group(m, "target"), ["bollocks"]));
  }
  return kept(out);
}

/** A frame whose `target` takes one replacement; null keeps the typed text. */
type Swap = {
  pattern: RegExp;
  rule: Rule;
  replace: (typed: string) => string | null;
  /** The replacement already carries the typed casing. */
  raw?: true;
};
const FORMS = (pairs: Record<string, string>) => (typed: string) =>
  pairs[typed.toLowerCase()] ?? null;
const SWAPS: readonly Swap[] = [
  // "conform that" is "confirm that"; "conforming that is supported" stays a relative clause.
  {
    pattern: frame(
      `(?<target>conform|conforms|conformed|conforming)${SPACE}that${WORD_END}(?!${SPACE}(?:is|are|was|were|has|have|had|will|would|can|could|should|may|might|must|way|much|far|well)${WORD_END})`,
    ),
    rule: PHRASE,
    replace: FORMS({
      conform: "confirm",
      conforms: "confirms",
      conformed: "confirmed",
      conforming: "confirming",
    }),
  },
  // "constitutes as a" takes no "as"; "constituting as much as" and the passive stay.
  {
    pattern: frame(
      `${notAfter("be|been|being|is|are|was|were")}(?<target>(?:constitute|constitutes|constituting)${SPACE}as)${SPACE}(?!(?:much|many|well|long|far|soon|little|few|such|follows?|part|is|are|was|were|it|they|we|he|she|i|you|in|of)${WORD_END})`,
    ),
    rule: PHRASE,
    replace: (typed) => typed.split(/[ \t\u00a0]+/)[0],
  },
  // "time has past" is "passed"; "has past experience" keeps the adjective (checked below).
  {
    pattern: frame(`(?:has|have|had|having|['’]ve)${SPACE}(?<target>past)${WORD_END}`),
    rule: CONTEXT,
    replace: () => "passed",
  },
  // "payed" is nautical: a rope payed out or away, a deck or seam payed with tar or pitch.
  {
    pattern: frame(
      `(?<target>(?:over|under|pre|re)?payed)(?!${EDGE})(?!${SPACE}(?:out|away|(?:(?:the|a|her|his|its|their)${SPACE})?(?:decks?|seams?|hulls?|planking))${WORD_END})(?![^.!?\\n]{0,40}\\bwith${SPACE}(?:[a-z]+${SPACE})?(?:tar|pitch|oakum|resin)${WORD_END})`,
    ),
    rule: TYPO,
    replace: (typed) => typed.slice(0, -5) + "paid",
  },
  // "grind to halt" needs its article.
  {
    pattern: frame(
      `(?:grind|grinds|grinding|ground|grinded|come|comes|came|coming|bring|brings|brought|bringing|screech|screeches|screeched|screeching)${SPACE}to${SPACE}(?<target>halt)${WORD_END}`,
    ),
    rule: PHRASE,
    replace: (typed) => (typed === typed.toUpperCase() ? "A " : "a ") + typed,
    raw: true,
  },
  // "rise/arise the question" is "raise"; "there arose the question" is an inversion.
  {
    pattern: frame(
      `${notAfter("there|then|thus|hence|here|now|which|whence|so")}(?<target>rise|rises|rising|rose|risen|rised|arise|arises|arising|arose|arisen|arised)${SPACE}(?:the|a|this|that)${SPACE}question${WORD_END}`,
    ),
    rule: PHRASE,
    replace: (typed) =>
      ({
        rise: "raise",
        rises: "raises",
        rising: "raising",
        arise: "raise",
        arises: "raises",
        arising: "raising",
      })[typed.toLowerCase()] ?? "raised",
  },
  // "explained in (more) details" is "detail"; "interested in more details" is a noun phrase.
  {
    pattern: frame(
      `${notAfter("interested|interest|differ|differs|differed|differing|vary|varies|varied|varying|lies|lie|lay|lying|lost|buried|mired|bogged|drowning|drowned|is|are|was|were|only")}in${SPACE}(?:(?:more|greater|further|great|full|much${SPACE}more)${SPACE})?(?<target>details)${WORD_END}(?!${SPACE}(?:of|about|on|regarding|that|which|like|such|from|in|for|to|and)${WORD_END})`,
    ),
    rule: PHRASE,
    replace: () => "detail",
  },
  // "Now a day a calendar…" opening a clause; "We are now a day late" stays.
  {
    pattern: frame(
      `(?<target>now${SPACE}a${SPACE}day)(?:${SPACE}(?=(?:a|an|the|we|i|you|he|she|it|they|people|many|most|everyone|everybody|lots|there|this|these|those|kids|children)${WORD_END})|(?=,))`,
    ),
    rule: { ruleId: "englishClosedCompounds", messageKey: "review_msg_closed_compound" },
    replace: () => "nowadays",
  },
  // "have my cake and eat it to" is the adverb "too".
  {
    pattern: frame(`eat${SPACE}it${SPACE}(?<target>to)${COMPLETE}`),
    rule: TOO,
    replace: () => "too",
  },
  // "too big too fail": the second "too" opens the infinitive.
  {
    pattern: frame(
      `too${SPACE}(?:big|good|small|late|early|hard|easy|much|many|long|short|old|young|slow|fast|hot|cold|important|complex|complicated|busy|tired|scared|afraid)${SPACE}(?<target>too)${SPACE}(?:be|fail|do|go|see|use|get|make|take|handle|ignore|read|understand|change|fix|run|work|say|tell|care|keep)${WORD_END}`,
    ),
    rule: { ruleId: "englishToToo", messageKey: "review_msg_to_infinitive" },
    replace: () => "to",
  },
];
function swaps(ctx: DetectContext): RawFinding[] {
  const out: (RawFinding | null)[] = [];
  for (const { pattern, rule, replace, raw } of SWAPS)
    for (const m of frameMatches(ctx, pattern)) {
      const range = group(m, "target");
      const typed = ctx.text.slice(...range);
      // A noun after "has past" keeps "past" an adjective: "has past experience", "had past due".
      if (/^past$/i.test(typed)) {
        const next = nextWord(ctx, range[1]);
        if (next && (nounLike(next) || /^due$/i.test(next))) continue;
      }
      const replacement = replace(typed);
      if (replacement) out.push(found(ctx, rule, m, range, [replacement], !raw));
    }
  return kept(out);
}

// "went to far compared to…": "too far" before a word that cannot start a place noun phrase.
// The core to/too frame owns clause ends and its own follower list.
const TO_FAR = frame(
  `(?:go|goes|going|gone|went|take|takes|took|taken|taking|push|pushes|pushed|pushing|carry|carried|carrying)${SPACE}(?<target>to)${SPACE}far${WORD_END}`,
);
const CORE_TO_FAR_NEXT = /^(?:with|for|on|in|this|and|but|when|because|like|away|off|out|flung)$/i;
// "the form to big for small screens": degree "too" before an adjective and "for".
const TO_BIG_FOR = frame(
  `(?<target>to)${SPACE}(?:big|small|large|long|short|complex|complicated|expensive|heavy|slow|hard|difficult)${SPACE}for${WORD_END}`,
);
// "set the font to big for headings" names a value; "from small to big" a range.
const SETTING_VERB =
  /\b(?:set|sets|setting|change|changes|changed|changing|switch|switched|resize|resized|scale|scaled|convert|converted|from|increase|increased|reduce|reduced|default|defaults|move|moved|grow|grows|grew|shrink|shrank)\b[^.!?;:\n]*$/i;
function tooFar(ctx: DetectContext): RawFinding[] {
  const out: (RawFinding | null)[] = [];
  for (const m of frameMatches(ctx, TO_FAR)) {
    const next = nextWord(ctx, m.index + m[0].length);
    if (!next || CORE_TO_FAR_NEXT.test(next) || nounLike(next, false)) continue;
    out.push(found(ctx, TOO, m, group(m, "target"), ["too"]));
  }
  for (const m of frameMatches(ctx, TO_BIG_FOR))
    if (!SETTING_VERB.test(before(ctx, m.index, 48)))
      out.push(found(ctx, TOO, m, group(m, "target"), ["too"]));
  return kept(out);
}

// "wrote learning" after a determiner, preposition or another verb has no subject for "wrote".
const WROTE = frame(
  `(?:a|the|of|for|at|in|on|with|from|through|via|than|encouraged|encourage|encourages|did|do|does|use|uses|using|pure|mere|simple|much)${SPACE}(?<target>wrote)${SPACE}(?:learning|memori[sz]ation|memori[sz]ing|memory|repetition)${WORD_END}`,
);
function wroteRote(ctx: DetectContext): RawFinding[] {
  return kept(
    [...frameMatches(ctx, WROTE)].map((m) => found(ctx, PHRASE, m, group(m, "target"), ["rote"])),
  );
}

// Subjunctive "were" after "wish" or "if only" before a predicate; the elliptical
// "I only wish it was." stays.
const WISH_WAS = frame(
  `(?:if${SPACE}only|wish)${SPACE}(?:I|he|she|it|there|this|that)${SPACE}(?<target>was)${SPACE}(?=\\p{L})`,
);

// "govt." is "government"; its period stays when it ends the sentence.
const GOVT = frame(`(?<target>govt)(?<dot>\\.(?=[ \\t\\u00a0]{1,8}\\p{L}))?${WORD_END}`);
function styleFrames(ctx: DetectContext): RawFinding[] {
  const out: (RawFinding | null)[] = [];
  for (const m of frameMatches(ctx, GOVT)) {
    const [start, end] = group(m, "target");
    const range: [number, number] = [start, m.groups!.dot ? end + 1 : end];
    out.push(
      found(ctx, { ruleId: "stylePhrasing", messageKey: "review_msg_style_phrasing" }, m, range, [
        "government",
      ]),
    );
  }
  for (const m of frameMatches(ctx, WISH_WAS))
    out.push(
      found(
        ctx,
        { ruleId: "stylePhrasing", messageKey: "review_msg_style_phrasing" },
        m,
        group(m, "target"),
        ["were"],
      ),
    );
  return kept(out);
}

/** Context detectors appended to REVIEW_DETECTORS. */
export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: [
      "englishPhraseCorrections",
      "englishClosedCompounds",
      "englishToToo",
      "englishVerbComplements",
      "stylePhrasing",
    ],
    detect: (ctx) =>
      isLang(ctx, "en")
        ? [
            ...dose(ctx),
            ...worse(ctx),
            ...howLooksLike(ctx),
            ...makeSeem(ctx),
            ...nerveWreck(ctx),
            ...bullocks(ctx),
            ...swaps(ctx),
            ...tooFar(ctx),
            ...wroteRote(ctx),
            ...styleFrames(ctx),
          ]
        : [],
  },
];
