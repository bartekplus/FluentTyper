import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import { applyWordCase, detectWordCase } from "../../implementations/helpers/GenericRuleShared";
import type { PhraseRow } from "../englishPhraseTables";
import { frameMatches, hasUserOrCasedWord, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";

// British and American forms are both correct English, so each direction is an
// opt-in rule: whoever picks a dialect gets the other one's forms converted.

/** [British, American]. */
type Pair = readonly [british: string, american: string];

/** One pair per ending, added to both stems. */
const ends = (british: string, american: string, endings: string): Pair[] =>
  endings.split(",").map((end) => [british + end, american + end]);
/** colour / color */
const our = (stem: string, endings: string) => ends(`${stem}our`, `${stem}or`, endings);
/** travelled / traveled */
const doubledL = (stem: string, endings: string) => ends(`${stem}l`, stem, endings);
/** centre / center: "", "s", "d" and "ing" endings. */
const re = (stem: string, endings: string): Pair[] =>
  endings.split(",").map((end) => {
    if (end === "d") return [`${stem}red`, `${stem}ered`];
    if (end === "ing") return [`${stem}ring`, `${stem}ering`];
    return [`${stem}re${end}`, `${stem}er${end}`];
  });
/** realise / realize */
const ise = (stem: string) => ends(`${stem}is`, `${stem}iz`, "e,es,ed,ing,ation,ations,er,ers");

/** Spellings each dialect writes its own way; converted in both directions. */
const BOTH: readonly Pair[] = [
  ...our("col", ",s,ed,ing,ful,fully,less,ist,ists"),
  ...our("discol", ",s,ed,ing,ation"),
  ...our("fav", ",s,ed,ing,able,ably,ite,ites,itism"),
  ...our("unfav", "able,ably"),
  ...our("hon", ",s,ed,ing,able,ably"),
  ...our("dishon", ",s,ed,able"),
  ...our("lab", ",s,ed,ing,er,ers"),
  ...our("neighb", ",s,hood,hoods,ing,ly"),
  ...our("behavi", ",s,al,ally"),
  ...our("misbehavi", ""),
  ...our("hum", ",s,ed,ing,less"),
  ...our("flav", ",s,ed,ing,ful,less,some"),
  ...our("harb", ",s,ed,ing"),
  ...our("rum", ",s,ed"),
  ...our("vap", ",s"),
  ...our("od", ",s,less"),
  ...our("arm", ",s,ed,y"),
  ...our("endeav", ",s,ed,ing"),
  ...our("vig", ""),
  ...our("tum", ",s"),
  ...our("savi", ",s"),
  ...our("parl", ",s"),
  ...our("clam", ",s,ed,ing"),
  ...our("splend", ",s"),
  ...our("cand", ""),
  ...our("val", ""),
  ...our("ard", ""),
  ...our("ferv", ""),
  ...our("sav", ",s,ed,ing,y"),
  ...our("demean", ""),
  ["armouries", "armories"],
  ...re("cent", ",s,d,ing"),
  ...re("thea", ",s"),
  ...re("fib", ",s"),
  ...re("lit", ",s"),
  ...re("calib", ",s"),
  ...re("somb", ""),
  ...re("spect", ",s"),
  ...re("lust", ""),
  ...re("meag", ""),
  ...re("sab", ",s"),
  ...["centi", "kilo", "milli"].flatMap((prefix) => re(`${prefix}met`, ",s")),
  ...re("millilit", ",s"),
  ["centrepiece", "centerpiece"],
  ["fibreglass", "fiberglass"],
  ["epicentre", "epicenter"],
  ...doubledL("travel", "ed,ing,er,ers"),
  ...doubledL("cancel", "ed,ing"),
  ...doubledL("label", "ed,ing"),
  ...doubledL("model", "ed,ing,er,ers"),
  ...doubledL("fuel", "ed,ing"),
  ...doubledL("level", "ed,ing"),
  ...doubledL("signal", "ed,ing"),
  ...doubledL("marvel", "ed,ing,ous,ously"),
  ...doubledL("total", "ed,ing"),
  ...doubledL("channel", "ed,ing"),
  ...doubledL("tunnel", "ed,ing"),
  ...doubledL("quarrel", "ed,ing"),
  ...doubledL("dial", "ed,ing"),
  ...doubledL("equal", "ed,ing"),
  ...doubledL("rival", "ed,ing"),
  ...doubledL("counsel", "ed,ing,or,ors"),
  ...doubledL("jewel", "er,ers"),
  ...doubledL("wool", "en"),
  ...doubledL("panel", "ed,ing"),
  ...doubledL("shovel", "ed,ing"),
  ...doubledL("pencil", "ed"),
  ...doubledL("initial", "ed,ing"),
  ...doubledL("libel", "ous"),
  ["jewellery", "jewelry"],
  ...ends("enrol", "enroll", ",s"),
  ...ends("enrolment", "enrollment", ",s"),
  ...ends("fulfil", "fulfill", ",s"),
  ["fulfilment", "fulfillment"],
  ...ends("instalment", "installment", ",s"),
  ...ends("skilful", "skillful", ",ly"),
  ...ends("wilful", "willful", ",ly"),
  ...ends("distil", "distill", ",s"),
  ...ends("defence", "defense", ",s,less"),
  ...ends("offence", "offense", ",s"),
  ...ends("pretence", "pretense", ",s"),
  ...ends("anaemi", "anemi", "a,c"),
  ...ends("anaesthe", "anesthe", "sia,tic,tics"),
  ...ends("paediatric", "pediatric", ",s,ian,ians"),
  ...ends("orthopaedic", "orthopedic", ",s"),
  ["haemoglobin", "hemoglobin"],
  ...ends("haemorrhag", "hemorrhag", "e,es,ed,ing"),
  ["leukaemia", "leukemia"],
  ["diarrhoea", "diarrhea"],
  ["oesophagus", "esophagus"],
  ...ends("manoeuvr", "maneuver", "e,es,able"),
  ["manoeuvred", "maneuvered"],
  ["manoeuvring", "maneuvering"],
  // "analyses" is also the plural of "analysis" in both.
  ...["analy", "paraly", "cataly"].flatMap((stem) => ends(`${stem}s`, `${stem}z`, "e,ed,ing")),
  ...ends("analys", "analyz", "er,ers"),
  ...ends("grey", "gray", ",s,ed,ing,er,est,ish,ness,scale"),
  ...ends("sceptic", "skeptic", ",s,al,ally,ism"),
  ["aluminium", "aluminum"],
  ...ends("moustache", "mustache", ",s,d"),
  ...ends("pyjama", "pajama", ",s"),
  ...ends("plough", "plow", ",s,ed,ing"),
  ...ends("mould", "mold", ",s,ed,ing,y"),
  ...ends("smoulder", "smolder", ",s,ed,ing"),
  ...ends("cos", "coz", "y,ier,iest,ily,iness"),
  ...ends("catalogu", "catalog", "e,es"),
  ["catalogued", "cataloged"],
  ["cataloguing", "cataloging"],
  ...ends("aeroplane", "airplane", ",s"),
  // Idioms and verb forms each dialect prefers.
  ...ends("out of the window", "out the window", ""),
  ...["vicious", "virtuous"].flatMap((kind) => ends(`${kind} circle`, `${kind} cycle`, ",s")),
  ["sneaked", "snuck"],
];

/** British forms American English never uses, while British English also writes the American one. */
const AMERICAN_ONLY: readonly Pair[] = [
  // Oxford spelling writes -ize too, so only the American rule converts -ise.
  ...[
    ...["real", "organ", "reorgan", "disorgan", "unorgan", "recogn", "unrecogn", "apolog"],
    ...["critic", "emphas", "summar", "priorit", "minim", "maxim", "optim", "custom", "initial"],
    ...["normal", "final", "util", "special", "standard", "visual", "author", "unauthor"],
    ...["categor", "uncategor", "character", "memor", "synchron", "serial", "deserial", "sanit"],
    ...["local", "material", "capital", "modern", "central", "decentral", "global", "legal"],
    ...["stabil", "destabil", "symbol", "privat", "harmon", "mobil", "neutral", "steril", "item"],
    ...["jeopard", "agon", "ostrac", "scrutin", "subsid", "patron", "sympath", "theor", "vapor"],
    ...["fertil", "monopol", "polar", "public", "familiar", "hospital", "immun", "industrial"],
    ...["digit", "random", "token", "parameter", "container", "vector", "parallel", "virtual"],
    ...["personal", "general", "penal", "formal", "rational", "national", "international"],
    ...["commercial", "conceptual", "contextual", "equal", "crystall", "civil", "colon", "econom"],
    ...["hypothes", "synthes", "terror", "vandal", "victim", "demon", "tantal", "trivial"],
    ...["dramat", "traumat", "stigmat", "systemat", "monet", "amort", "anonym", "atom", "democrat"],
    ...["demoral", "empath", "energ", "epitom", "fantas", "galvan", "human", "dehuman", "ideal"],
    ...["immortal", "incentiv", "italic", "liberal", "metabol", "militar", "moistur", "oxid"],
    ...["philosoph", "plagiar", "popular", "pressur", "radical", "regular", "revital", "romantic"],
    ...["satir", "social", "union", "urban", "verbal", "vocal", "bapt", "computer", "hypnot"],
    ...["legitim", "marginal", "revolution", "western"],
  ].flatMap(ise),
  ...our("rig", ""),
  ...ends("programme", "program", ",s"),
  ...ends("tyre", "tire", ",s"),
  ...ends("kerb", "curb", ",s"),
  ...ends("cheque", "check", ",s"),
  ["chequebook", "checkbook"],
  ...ends("draught", "draft", ",y"),
  ["storey", "story"],
  ["storeys", "stories"],
  ...ends("metre", "meter", ",s"),
  ...ends("licence", "license", ",s"),
  ...ends("practis", "practic", "e,es,ed,ing"),
  ...ends("judgement", "judgment", ",s,al"),
  ...ends("acknowledgement", "acknowledgment", ",s"),
  ["ageing", "aging"],
  ...ends("artefact", "artifact", ",s"),
  ...ends("encyclopaedi", "encyclopedi", "a,as,c"),
  ...ends("foet", "fet", "us,uses,al"),
  ["oestrogen", "estrogen"],
  ["mediaeval", "medieval"],
  ...ends("sulph", "sulf", "ur,uric,ate,ates,ide,ides"),
  ...ends("focuss", "focus", "ed,ing"),
  ...ends("specialit", "specialt", "y,ies"),
  ...ends("yoghurt", "yogurt", ",s"),
  ...ends("yogourt", "yogurt", ",s"),
  ...ends("verandah", "veranda", ",s"),
  ...ends("benefitt", "benefit", "ed,ing"),
  // American "pled" is the courtroom form; "she pleaded with him" stays.
  ...["guilty", "not guilty", "innocent", "no contest"].map((plea): Pair => [
    `pleaded ${plea}`,
    `pled ${plea}`,
  ]),
];

/** American words with a distinct British one: [American, British]. */
/** Authored accepted spellings. Dictionary fallback must not turn these into dialect corrections. */
const DIALECT_WORDS = new Set([...BOTH, ...AMERICAN_ONLY].flat().map((word) => word.toLowerCase()));
export function isAcceptedEnglishDialectWord(word: string): boolean {
  return DIALECT_WORDS.has(word.toLowerCase());
}

const BRITISH_ONLY: readonly PhraseRow[] = [
  ["pacifier", "dummy"],
  ["pacifiers", "dummies"],
  ["faucet", "tap"],
  ["faucets", "taps"],
  ["gasoline", "petrol"],
  ["soccer", "football"],
  ["sweater", "jumper"],
  ["sweaters", "jumpers"],
  ["station wagon", ["estate car", "estate"]],
  ["station wagons", ["estate cars", "estates"]],
  ["sidewalk", "pavement"],
  ["sidewalks", "pavements"],
  [["eggplant", "brinjal"], "aubergine"],
  [["eggplants", "brinjals"], "aubergines"],
  ["zucchini", "courgette"],
  ["zucchinis", "courgettes"],
  ["cilantro", "coriander"],
  ["diaper", "nappy"],
  ["diapers", "nappies"],
  ["flashlight", "torch"],
  ["flashlights", "torches"],
  ["yogourt", "yoghurt"],
  ["yogourts", "yoghurts"],
  ["pled", "pleaded"],
  // Indian English "prepone": each dialect's own phrasal verb.
  ["prepone", "bring forward"],
  ["prepones", "brings forward"],
  ["preponed", "brought forward"],
  ["preponing", "bringing forward"],
];

const PREPONE_AMERICAN: readonly PhraseRow[] = [
  ["prepone", "move up"],
  ["prepones", "moves up"],
  ["preponed", "moved up"],
  ["preponing", "moving up"],
];

/** Optional word choice: the full or more precise word ("OK" in capitals stays). */
const WORD_CHOICE: readonly PhraseRow[] = [
  ["ok", "okay"],
  ["config", "configuration"],
  ["configs", "configurations"],
  ["deref", "dereference"],
  ["derefs", "dereferences"],
  ["dirs", "directories"],
  ["very good", "excellent"],
  ["a very good", "an excellent"],
];

/**
 * Both forms are correct English: the other form of a phrase that stylePhrasing may
 * propose ("another thing coming" -> "think"), and a hyphenated predicative compound.
 */
const ALTERNATIVE_PHRASING: readonly PhraseRow[] = [
  ["another think coming", "another thing coming"],
  // "would never have" is the usual order; "never would have" stresses the "never".
  ...["would", "could", "should"].map((modal): PhraseRow => [
    `${modal} never have`,
    `never ${modal} have`,
  ]),
  ...["is", "are", "was", "were", "be", "been", "being", "seems", "seemed", "looks", "looked"].map(
    (verb): PhraseRow => [`${verb} out of date`, `${verb} out-of-date`],
  ),
];

/** Usually mistakes, rarely meant: "chalk-full" (full of chalk), "choke-full" (a variant). */
const POSSIBLE_ERRORS: readonly PhraseRow[] = [
  [["chalk full", "chalk-full", "choke full", "choke-full"], "chock-full"],
];

/** Opt-in tables with their own rules, indexed with the phrase corrections. */
export const OPTIONAL_TABLES: readonly {
  rows: readonly PhraseRow[];
  ruleId: RawFinding["ruleId"];
  messageKey: RawFinding["messageKey"];
}[] = [
  {
    rows: [...BOTH, ...AMERICAN_ONLY, ...PREPONE_AMERICAN],
    ruleId: "englishAmericanSpelling",
    messageKey: "review_msg_american_spelling",
  },
  {
    rows: [...BOTH.map(([british, american]): PhraseRow => [american, british]), ...BRITISH_ONLY],
    ruleId: "englishBritishSpelling",
    messageKey: "review_msg_british_spelling",
  },
  { rows: WORD_CHOICE, ruleId: "styleWordChoice", messageKey: "review_msg_word_choice" },
  {
    rows: POSSIBLE_ERRORS,
    ruleId: "englishPossibleErrors",
    messageKey: "review_msg_possible_error",
  },
  {
    rows: ALTERNATIVE_PHRASING,
    ruleId: "styleAlternativePhrasing",
    messageKey: "review_msg_alternative_phrasing",
  },
];

/**
 * Slashed tokens that are prose, not paths: "w/o", "prev/next" and a decade
 * before a slash ("1970's/early"). Review's technical-token guard lets them through.
 */
export const PROSE_SLASH_TOKEN =
  // remaining.ts: slashed words it checks (SLASHED) and its slash-token rows.
  /^(?:w\/o|prev\/next|\p{Nd}{3}0['’]s\/\p{L}+|(?:infront|derefs?|dirs|bias)\/\p{L}+|dissemble\/assemble|assemble\/dissemble|chicken\/egg)$/iu;

/** Rows for englishPhraseCorrections, englishClosedCompounds and stylePhrasing. */
export const PHRASES: readonly PhraseRow[] = [];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [["prev/next", "previous/next"]];

// ---------------------------------------------------------------------------- detectors

type Rule = Pick<RawFinding, "ruleId" | "messageKey">;
const AMERICAN: Rule = {
  ruleId: "englishAmericanSpelling",
  messageKey: "review_msg_american_spelling",
};
const BRITISH: Rule = {
  ruleId: "englishBritishSpelling",
  messageKey: "review_msg_british_spelling",
};

function finding(
  ctx: DetectContext,
  m: RegExpExecArray,
  rule: Rule,
  group: string,
  replacement: string,
): RawFinding {
  const [start, end] = m.indices!.groups![group];
  return {
    ...rule,
    range: { start, end },
    alternatives: [applyWordCase(replacement, detectWordCase(m.groups![group]))],
    context: {
      start: Math.max(0, m.index - 96),
      end: Math.min(ctx.text.length, m.index + m[0].length + 9),
    },
  };
}

const on = (ctx: DetectContext, rule: Rule) => !ctx.rules || ctx.rules.has(rule.ruleId);

// "be on the cards" (British) and "be in the cards" (American): only after a form of "be"
// ("is that just not in the cards?"), so cards on a table ("write it on the cards") stay.
const BE =
  "(?:am|is|are|was|were|be|been|being|isn['’]?t|aren['’]?t|wasn['’]?t|weren['’]?t|its|\\p{L}+['’](?:s|re))";
const CARD_ADVERBS =
  "(?:not|just|really|probably|definitely|certainly|still|also|already|never|ever|likely|possibly|clearly|simply|even|again|all|quite|maybe|perhaps|hardly)";
// The idiom ends its clause or is followed by a function word: "in the cards box" stays.
const CARD_FOLLOWERS =
  "(?:for|at|but|and|or|any|anytime|again|anymore|now|right|yet|either|though|since|so|then|previously|back|soon|until|unless|if|because|as|with|too|just|after|before|when|while|ever|in|this|that|these|those)";
const CARDS = `${BE}(?:${SPACE}(?:that|this|it|they|he|she|we|you))?(?:${SPACE}${CARD_ADVERBS}){0,3}${SPACE}(?<target>(?<prep>on|in)${SPACE}the${SPACE}cards)${WORD_END}(?=[ \\t\\u00a0]{0,8}(?:[^\\p{L} \\t\\u00a0]|$)|${SPACE}${CARD_FOLLOWERS}${WORD_END})`;

function cards(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, CARDS)) {
    const british = m.groups!.prep.toLowerCase() === "on";
    const rule = british ? AMERICAN : BRITISH;
    if (!on(ctx, rule) || hasUserOrCasedWord(ctx, m.groups!.target)) continue;
    findings.push(finding(ctx, m, rule, "prep", british ? "in" : "on"));
  }
  return findings;
}

// "have a look" (British) and "take a look" (American). "has a look of / about / that…"
// describes appearance, and "look and feel" is a noun phrase: both stay.
const LOOK = `(?<verb>have|has|had|having|take|takes|took|taken|taking)${SPACE}a${SPACE}look${WORD_END}(?!${SPACE}(?:of|about|and|that|which|like|to)${WORD_END})`;
const TO_TAKE: Record<string, string> = { have: "take", has: "takes", having: "taking" };
const TO_HAVE: Record<string, string> = {
  take: "have",
  takes: "has",
  took: "had",
  taken: "had",
  taking: "having",
};
// "had" after a perfect auxiliary is a participle: "have you had a look" -> "have you taken a look".
const PERFECT_BEFORE =
  /(?:\b(?:have|has|had|haven['’]t|hasn['’]t|hadn['’]t)(?:[ \t\u00a0]+(?:you|we|they|i|he|she|it|not|already|just|never|ever|finally|recently|also|all))*|['’](?:ve|d)(?:[ \t\u00a0]+(?:not|already|just|never|ever|finally|recently|also|all))*)[ \t\u00a0]+$/i;

function look(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, LOOK, "verb")) {
    const verb = m.groups!.verb.toLowerCase();
    const rule = verb in TO_HAVE ? BRITISH : AMERICAN;
    if (!on(ctx, rule) || hasUserOrCasedWord(ctx, m[0])) continue;
    let replacement = TO_HAVE[verb] ?? TO_TAKE[verb];
    if (verb === "had") {
      const before = ctx.text.slice(Math.max(0, m.index - 48), m.index);
      replacement = PERFECT_BEFORE.test(before) ? "taken" : "took";
    }
    findings.push(finding(ctx, m, rule, "verb", replacement));
  }
  return findings;
}

// Optional number style: a single-digit count before a plural noun is spelled out ("9 pigs").
// Only after a function word, so labels ("Python 3 users", "step 2 results") stay, and
// only when the sentence has no other figure to keep consistent with.
const NUMBER_WORDS = ["", "", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const BEFORE_COUNT =
  "(?:the|these|those|my|your|his|her|its|our|their|are|were|is|was|be|been|have|has|had|with|for|of|in|on|at|by|from|to|into|about|around|over|under|nearly|almost|only|just|all|and|or|than|after|within|there|here|another|last|first|next)";
const COUNT = `(?<=(?:^|[^\\p{L}])${BEFORE_COUNT}${SPACE})(?<target>[2-9])${SPACE}(?<noun>\\p{Ll}{3,})${WORD_END}`;

function spelledNumbers(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, COUNT)) {
    if (!englishWordInfo(m.groups!.noun)?.plural) continue;
    const [start, end] = m.indices!.groups!.target;
    const sentence = (text: string) => text.split(/[.!?\n]/);
    const before = sentence(ctx.text.slice(Math.max(0, start - 200), start)).pop()!;
    const after = sentence(ctx.text.slice(end, end + 200))[0];
    if (/\p{N}/u.test(before + after)) continue;
    findings.push({
      ruleId: "styleSpelledNumbers",
      messageKey: "review_msg_spelled_numbers",
      range: { start, end },
      alternatives: [NUMBER_WORDS[Number(m.groups!.target)]],
      context: { start: start - before.length, end: end + after.length },
    });
  }
  return findings;
}

/** Context detectors appended to REVIEW_DETECTORS. */
export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["englishAmericanSpelling", "englishBritishSpelling"], detect: cards },
  { rules: ["englishAmericanSpelling", "englishBritishSpelling"], detect: look },
  { rules: ["styleSpelledNumbers"], detect: spelledNumbers },
];
