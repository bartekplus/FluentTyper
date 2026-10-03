import {
  englishListedNoun,
  englishListedWithoutPlural,
  englishWordInfo,
  type EnglishWordInfo,
} from "../../implementations/helpers/EnglishLexicon";
import { englishNounForms } from "../../implementations/helpers/EnglishNounNumber";
import { ENGLISH_VERB_FORMS } from "../../implementations/helpers/EnglishVerbForms";
import type { PhraseRow } from "../englishPhraseTables";
import { frameMatches, hasUserOrCasedWord, SPACE } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { quotedMention } from "./grammarStyle1";

// Checks that lean on the dictionary-derived lexicon (EnglishLexicon) rather than phrase rows:
// regularized irregular forms, missing possessive apostrophes and misplaced spaces.

/** Rows for englishPhraseCorrections, englishClosedCompounds and stylePhrasing. */
export const PHRASES: readonly PhraseRow[] = [];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

const lower = (word: string) => word.toLowerCase();
/** `replacement` with the first letter of `typed` capitalized when it is. */
const caseLike = (typed: string, replacement: string) =>
  /^[A-Z]/.test(typed) ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;
const context = (ctx: DetectContext, start: number, end: number) => ({
  start: Math.max(0, start - 96),
  end: Math.min(ctx.text.length, end + 40),
});

// One word: letters only, not part of a technical token, a number or an abbreviation ("e.g").
const WORD =
  /(?<![\p{L}\p{M}\p{N}_'’@/#\\.-])[A-Za-z]+(?![\p{L}\p{M}\p{N}_'’@/#\\-]|\.[\p{L}\p{N}])/gu;

// Function words the lexicon has no part of speech for.
const FUNCTION_WORDS = new Set(
  "as his her hers into only its us is unto per amongst ok vs".split(" "),
);
// Memoized: the same words recur, and a lexicon lookup tries every affix rule.
const INFO = new Map<string, EnglishWordInfo | null>();
const KNOWN = new Map<string, boolean>();
function info(word: string): EnglishWordInfo | null {
  const w = lower(word);
  let hit = INFO.get(w);
  if (hit === undefined) {
    if (INFO.size > 20000) INFO.clear();
    hit = englishWordInfo(w);
    INFO.set(w, hit);
  }
  return hit;
}
function known(word: string): boolean {
  const w = lower(word);
  let hit = KNOWN.get(w);
  if (hit === undefined) {
    if (KNOWN.size > 20000) KNOWN.clear();
    hit = FUNCTION_WORDS.has(w) || !!info(w) || englishListedNoun(w) !== null;
    KNOWN.set(w, hit);
  }
  return hit;
}

/** Lowercase, or capitalized at the start of a clause: no name, acronym or code. */
const plainAt = (ctx: DetectContext, word: string, index: number) =>
  /^[a-z]+$/.test(word) || (/^[A-Z][a-z]*$/.test(word) && wordBefore(ctx, index) === "");

// ---------------------------------------------------------------------------- irregular forms

// The regular -ed spelled on an irregular verb ("eated", "writed", "runned") and the regular
// plural on an irregular noun ("childs", "womans"), from the authored tables. Valid variants
// stay out: "kneeled" and "betted" are dictionary-accepted pasts the lexicon lacks.
const VALID_VARIANTS = new Set(["kneeled", "betted"]);
const REGULAR_PASTS = new Map<string, (typeof ENGLISH_VERB_FORMS)[number]>();
for (const verb of ENGLISH_VERB_FORMS) {
  const { lemma } = verb;
  const forms = [`${lemma}ed`, lemma.endsWith("e") ? `${lemma}d` : ""];
  if (/[^aeiou][aeiou][b-df-hj-np-tv-z]$/.test(lemma)) forms.push(`${lemma}${lemma.at(-1)}ed`);
  for (const form of forms)
    if (form && !VALID_VARIANTS.has(form) && form !== verb.past && form !== verb.participle)
      REGULAR_PASTS.set(form, verb);
}
const REGULAR_PLURALS = new Map<string, { singular: string; plural: string }>();
for (const singular of ["child", "woman", "man", "ox", "foot", "tooth", "goose", "mouse", "louse"]
  .concat(["leaf", "loaf", "shelf", "wolf", "knife", "wife", "half", "thief", "calf", "life"])
  .concat(["grandchild", "gentleman", "person"])) {
  const forms = englishNounForms(singular);
  if (forms) for (const ending of ["s", "es"]) REGULAR_PLURALS.set(singular + ending, forms);
}
const PARTICIPLE_BEFORE =
  /(?:^|[^\p{L}])(?:have|has|had|having|['’]ve|been|be|being|is|are|was|were|am|get|gets|got|gotten)[ \t\u00a0]+(?:(?:not|never|already|just|also|all|now)[ \t\u00a0]+)?$/iu;
// A past needs its subject or auxiliary right before it: "I eated", "had runned", "and drinked".
// "malformed finded constructions" only names the word.
const VERB_BEFORE =
  /(?:^|[^\p{L}'’])(?:i|you|he|she|it|we|they|who|and|or|then|also|just|never|already|finally|once|have|has|had|having|['’]ve|['’]d|been|be|being|is|are|was|were|am|get|gets|got|gotten)[ \t\u00a0]+$/iu;

/** The irregular form for a word the dictionary does not know, or null. */
function irregularFor(word: string, before: string): string[] | null {
  const w = lower(word);
  const verb = REGULAR_PASTS.get(w);
  if (verb) {
    if (!VERB_BEFORE.test(before) || known(w)) return null;
    const participle = PARTICIPLE_BEFORE.test(before);
    return [participle ? verb.participle : verb.past];
  }
  if (!w.endsWith("s") || w.length < 4 || info(w)) return null;
  // The dictionary's own -s plural ("shamans") is no error; "meatloafs" is, as "meatloaf"
  // is listed without one.
  const listed = (singular: string) =>
    englishListedNoun(w) === "singular" ||
    (englishListedNoun(w) === "plural" && !englishListedWithoutPlural(singular));
  // A table noun at the end of a lowercase compound counts too: "meatloafs", "grandchilds"
  // (not the names "Germans", "Normans").
  for (let cut = 0; cut <= (/^[a-z]/.test(word) ? w.length - 3 : 0); cut++) {
    const forms = REGULAR_PLURALS.get(w.slice(cut));
    if (!forms) continue;
    const head = w.slice(0, cut);
    const singular = head + forms.singular;
    return listed(singular) ? null : [head + forms.plural, `${singular}'s`];
  }
  // Spelling rules for a plural the dictionary lists: hero -> heroes, kitty -> kitties.
  const singular = w.slice(0, -1);
  const plural = w.endsWith("os")
    ? `${w.slice(0, -1)}es`
    : /[^aeiou]ys$/.test(w)
      ? `${w.slice(0, -2)}ies`
      : w.endsWith("fs")
        ? `${w.slice(0, -2)}ves`
        : null;
  const spelled = plural && info(plural);
  // "believes" is only a verb: "beliefs" stays (its singular is a listed noun anyway).
  if (!spelled || (spelled.verbs.length > 0 && !spelled.noun)) return null;
  if (!known(singular) || listed(singular)) return null;
  return [plural, `${singular}'s`];
}

// ---------------------------------------------------------------------------- word boundaries

// Two-letter words a moved space may produce; the dictionary's rarer ones (em, en) stay out.
const SHORT_WORDS = new Set(
  "a i am an as at be by do go he if in is it me my no of oh ok on or so to up us we".split(" "),
);
const shortOk = (word: string) => word.length > 2 || SHORT_WORDS.has(lower(word));

// Function words glued to the next word ("thisinstead"). Words that also start ordinary
// compounds (in, on, up, out, over) stay out ("inline", "onboarding", "uptime"), and so do
// "of" and "as", which start British spellings and deliberate tokens ("offences", "aswell").
const GLUED = new Set(
  (
    "this that the these those and but with from is was are were have has had will would " +
    "could should not than"
  ).split(" "),
);

/** "thisinstead" -> "this instead": a function word glued to a word the lexicon knows. */
function splitGlued(word: string): string | null {
  const w = lower(word);
  if (w.length < 6) return null;
  for (let cut = 2; cut <= 6 && cut <= w.length - 3; cut++) {
    const head = w.slice(0, cut);
    const rest = w.slice(cut);
    if (GLUED.has(head) && info(rest)) return `${word.slice(0, cut)} ${rest}`;
  }
  return null;
}

// Parts that also build words the dictionary lacks on purpose: suffixes ("countability",
// "subjectless") and the computing compounds ("textarea", "codebase", "webhooks", "typecheck").
const NOT_SPLIT = new Set(
  (
    "ability abilities less ness ship ships hood dom ism isms ist ists able ful like wise ward " +
    "wards some web code text type tool tools name file files key keys data time user users work " +
    "sub net host end front back side lock page pages line lines view views base check checks " +
    "path paths stack space spaces area chain chains hook hooks tip tips process script scripts " +
    "set sets box bar bars list lists map maps mark point points case cases load flow board " +
    "frame frames down up out over cycle fore under mid self super inter multi counter micro " +
    "mini macro nano auto mega meta after head man men way house room land yard wood ball " +
    "light field smith"
  ).split(" "),
);
/** A plain noun: not also an adjective, adverb or preposition the joined word could build on. */
const plainNoun = (part: string) => {
  const entry = info(part);
  return (
    !!entry?.noun &&
    !entry.adjective &&
    !entry.adverb &&
    !NOT_SPLIT.has(part) &&
    !NOT_SPLIT.has(part.replace(/s$/, ""))
  );
};

/**
 * "landingpad" -> "landing pad": two plain nouns the lexicon knows, joined into a lowercase
 * word it does not. Only one split may fit; the singular head offered has four letters or more.
 */
function splitNouns(word: string): string | null {
  const w = word;
  if (w.length < 8 || !/^[a-z]+$/.test(w)) return null;
  // An inflection of a word the lexicon knows ("compressions") is no compound.
  const stem = w.replace(/(?:e?s|ed|ing)$/, "");
  if ([stem, `${stem}e`, w.replace(/ies$/, "y")].some((form) => form !== w && known(form)))
    return null;
  let split: string | null = null;
  for (let cut = 3; cut <= w.length - 3; cut++) {
    const head = w.slice(0, cut);
    const tail = w.slice(cut);
    // A letter doubled at the seam is an inflection or a coinage: "fuelling", "ashheaps".
    if (head.at(-1) === tail[0]) continue;
    if (!plainNoun(head) || info(head)!.plural || !plainNoun(tail)) continue;
    // A short joined word with a three-letter tail is more often a coinage or a name.
    if (tail.length === 3 && head.length < 7) continue;
    if (FUNCTION_WORDS.has(head) || FUNCTION_WORDS.has(tail)) continue;
    if (split !== null) return null;
    // A three-letter head counts against another split ("gas pumps" / "gasp umps") but is
    // too short to offer alone ("deb ounce").
    split = cut > 3 ? `${head} ${tail}` : "";
  }
  return split || null;
}

/**
 * Two neighbours, one of them no dictionary word: a space one letter off ("Th ecat",
 * "spac eis") or one too many ("her etofore").
 */
function boundaryFix(first: string, second: string): string[] {
  // Both words unknown ("spac eis"), or a known two-letter word that is a fragment of a
  // function word ("Thec at"). A longer known neighbour is a word of its own: "Womans and" is
  // not "Woman sand", "learnt it" not "learn tit".
  const both = !known(first) && !known(second);
  const fixes = [
    [first.slice(0, -1), first.slice(-1) + second],
    [first + second[0], second.slice(1)],
  ]
    .filter(
      ([a, b]) =>
        a.length &&
        b.length &&
        shortOk(a) &&
        shortOk(b) &&
        known(a) &&
        known(b) &&
        (both ||
          (Math.min(first.length, second.length) < 3 && (GLUED.has(lower(a)) || GLUED.has(b)))),
    )
    .map(([a, b]) => `${a} ${b}`);
  if (!fixes.length && second.length > 2 && known(first) && !known(second)) {
    const joined = first + second;
    if (info(joined)) fixes.push(joined);
  }
  return fixes;
}

const ruleOn = (ctx: DetectContext, rule: string) => !ctx.rules || ctx.rules.has(rule);

/** One pass over the words for the irregular-form and space checks. */
function wordChecks(ctx: DetectContext): RawFinding[] {
  const irregular = ruleOn(ctx, "englishIrregularForms");
  const spaces = ruleOn(ctx, "englishAlotCorrection");
  const findings: RawFinding[] = [];
  const words = new RegExp(WORD);
  words.lastIndex = Math.max(0, ctx.from - 40);
  let last: { index: number; word: string; unknown: boolean } | null = null;
  for (let m = words.exec(ctx.scanText); m && m.index < ctx.to; m = words.exec(ctx.scanText)) {
    const { index } = m;
    const word = m[0];
    const w = lower(word);
    const unknown = !known(w);
    const prev = last;
    last = { index, word, unknown };
    const owned = index >= ctx.from;
    // Most words are known, and so is their neighbour: nothing to check.
    const regular =
      irregular &&
      owned &&
      (w.endsWith("ed") ? REGULAR_PASTS.has(w) : w.length > 3 && w.endsWith("s") && !info(w));
    if (!unknown && !regular && !prev?.unknown) continue;
    if (!plainAt(ctx, word, index) || ctx.dictionary.has(w)) continue;
    const end = index + word.length;
    const forms = regular && irregularFor(word, ctx.text.slice(Math.max(0, index - 40), index));
    if (forms) {
      findings.push({
        ruleId: "englishIrregularForms",
        messageKey: "review_msg_irregular_form",
        range: { start: index, end },
        alternatives: forms.map((form) => caseLike(word, form)),
        ...(forms.length > 1 ? { requiresChoice: true as const } : {}),
        context: context(ctx, index, end),
      });
      continue;
    }
    if (!spaces) continue;
    const split = unknown && owned && (splitGlued(word) ?? splitNouns(word));
    if (split) {
      findings.push({
        ruleId: "englishAlotCorrection",
        messageKey: "review_msg_split_words",
        range: { start: index, end },
        alternatives: [split],
        bulkBlock: "context-dependent",
        context: context(ctx, index, end),
      });
      continue;
    }
    // A single space between two words of two letters or more, one of them unknown.
    if (!prev || prev.index < ctx.from || prev.index + prev.word.length !== index - 1) continue;
    if (ctx.text[index - 1] !== " " || prev.word.length < 2 || word.length < 2) continue;
    if (!plainAt(ctx, prev.word, prev.index) || /^[A-Z]/.test(word)) continue;
    if (ctx.dictionary.has(lower(prev.word))) continue;
    const fixes = boundaryFix(prev.word, word);
    if (!fixes.length) continue;
    findings.push({
      ruleId: "englishAlotCorrection",
      messageKey: "review_msg_word_boundary",
      range: { start: prev.index, end },
      alternatives: fixes,
      ...(fixes.length > 1 ? { requiresChoice: true as const } : {}),
      bulkBlock: "context-dependent",
      context: context(ctx, prev.index, end),
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------- possessive nouns

// Plurals that commonly modify another noun without owning it: "the sales team", "a sports
// car", "the settings page". Words in -ics and -ings behave the same way and are caught below.
const ATTRIBUTIVE_PLURALS = new Set(
  (
    "sales sports arts savings goods arms customs clothes glasses jobs systems operations parts " +
    "news needs claims works means series species rights services products events admissions " +
    "materials weapons drugs awards games records accounts payments skills drinks numbers " +
    "contents crafts letters ways sciences studies affairs relations resources utilities " +
    "securities futures options assets results comments users tools files tests items orders " +
    "notes tickets members images docs logs tasks"
  ).split(" "),
);
const IRREGULAR_OWNERS = new Set(["children", "women", "men"]);
const OWNER_DETERMINERS = "the|a|an|my|your|his|her|our|their|every|each|another";
const POSSESSIVE_FRAME = `(?<det>${OWNER_DETERMINERS})${SPACE}(?<owner>[a-z]{3,}s|children|women|men)${SPACE}(?<head>[a-z]{3,})(?:[ \\t\\u00a0]*(?:[.!?,;:]|$)|${SPACE}(?<next>[A-Za-z]+)(?![\\p{L}\\p{N}_'’@/#\\\\-]))`;
const SINGLE_DETERMINERS = new Set(["a", "an", "every", "each", "another"]);
const PREPOSITIONS = new Set(
  (
    "in on at of with from to into onto for by about under over through near behind inside " +
    "outside without within across around among between beside toward towards against"
  ).split(" "),
);
const PERCEPTION = new Set(
  "see saw seen seeing hear heard hearing watch watched watching notice noticed".split(" "),
);
// Closed-class words the dictionary also lists as nouns ("the haves", "an are", "a she"): never
// the owned noun. "the children she knew", "the pickers are paid", "the players all played".
const NOT_HEADS = new Set(
  (
    "i you he she it we they me him her us them who whom whose which that what this these those " +
    "all both each either neither none some any many much more most few several such own same " +
    "other others and but or nor yet so if then than as is are was were am be been being have " +
    "has had do does did will would can could shall should may might must not no " +
    // Adverbs the dictionary lists as nouns: "I talked to the students yesterday".
    "yesterday today tonight tomorrow overnight first once home outside inside upstairs " +
    "downstairs aside back forward last next daily weekly monthly yearly nightly online offline"
  ).split(" "),
);
const SINGULAR_FINITE = new Set("is was has does".split(" "));
const PLURAL_FINITE = new Set("are were have do".split(" "));
const MODALS = new Set("will would can could should must may might".split(" "));

/** The singular a plural owner names, when the lexicon reads it as a plural noun. */
function ownerSingular(owner: string): string | null {
  // "-ics" words are mostly singular fields ("physics", "the graphics card"); "music" is
  // uncountable, so "the musics performance" is its possessive.
  if (
    ATTRIBUTIVE_PLURALS.has(owner) ||
    (/(?:ics|ings|ss|us|is)$/.test(owner) && owner !== "musics")
  )
    return null;
  const read = info(owner);
  if (!(read?.plural && read.noun) && englishListedNoun(owner) !== "plural") return null;
  const stems = [owner.slice(0, -1)];
  if (owner.endsWith("ies")) stems.unshift(`${owner.slice(0, -3)}y`);
  else if (owner.endsWith("es")) stems.push(owner.slice(0, -2));
  return stems.find((stem) => info(stem)?.noun || englishListedNoun(stem) === "singular") ?? null;
}

const nounInfo = (word: string): { info: EnglishWordInfo | null; plural: boolean } | null => {
  const read = info(word);
  if (read) return read.noun && !read.adverb ? { info: read, plural: read.plural } : null;
  const listed = englishListedNoun(word);
  return listed ? { info: null, plural: listed === "plural" } : null;
};

/** The word before `index` (lowercased), "" at the start of a clause. */
function wordBefore(ctx: DetectContext, index: number): string {
  const before = ctx.text.slice(Math.max(0, index - 40), index);
  if (/(?:^|[.!?;:"“\n])[ \t\u00a0]*$/.test(before)) return "";
  return lower(/([A-Za-z]+)[ \t\u00a0]+$/.exec(before)?.[1] ?? "?");
}

/**
 * "the cats tail is long", "a teachers lounge": a plural owner right before the noun it owns,
 * where the frame leaves no other reading. The owner's head noun is followed by its verb, or
 * the phrase ends after a preposition or a perception verb, or a singular determiner rules
 * the plural out.
 */
function possessiveNouns(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, POSSESSIVE_FRAME, "owner")) {
    const { det, owner, head, next } = m.groups!;
    // The frame is case-insensitive: capitals name something ("the Beatles song").
    if (!/^[a-z]+$/.test(owner + head) || hasUserOrCasedWord(ctx, m[0])) continue;
    const singular = IRREGULAR_OWNERS.has(owner) ? null : ownerSingular(owner);
    if ((!singular && !IRREGULAR_OWNERS.has(owner)) || NOT_HEADS.has(head)) continue;
    const headNoun = nounInfo(head);
    if (!headNoun) continue;
    const verbal = !!headNoun.info?.verbs.length;
    const before = wordBefore(ctx, m.index);
    const n = next ? lower(next) : "";
    const nextInfo = n ? info(n) : null;
    const finite =
      MODALS.has(n) ||
      (headNoun.plural ? PLURAL_FINITE.has(n) : SINGULAR_FINITE.has(n)) ||
      (!!nextInfo?.verbs.some((v) => v.form === "past") && !nextInfo.noun);
    const ends = !next;
    const ok =
      SINGLE_DETERMINERS.has(lower(det)) ||
      (finite && (!verbal || before === "" || PREPOSITIONS.has(before))) ||
      (ends && PREPOSITIONS.has(before)) ||
      (ends && !verbal && PERCEPTION.has(before));
    if (!ok) continue;
    const [start, end] = m.indices!.groups!.owner;
    const alternatives = singular ? [`${singular}'s`, `${owner}'`] : [`${owner}'s`];
    findings.push({
      ruleId: "englishPossessiveNouns",
      messageKey: "review_msg_noun_possessive",
      range: { start, end },
      alternatives,
      ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
      context: context(ctx, m.index, m.index + m[0].length),
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------- you + noun

const YOU_OF = `(?<target>You)${SPACE}(?<noun>[a-z]{4,})${SPACE}of(?![\\p{L}\\p{N}_'’@/#\\\\-])`;

/** "You combination of artist and teacher.": "Your" or "You're a" before a lone noun. */
function youNounOf(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, YOU_OF)) {
    if (wordBefore(ctx, m.index) !== "" || hasUserOrCasedWord(ctx, m.groups!.noun)) continue;
    const read = info(m.groups!.noun);
    const noun = read
      ? read.noun && !read.plural && !read.verbs.length && !read.adjective
      : englishListedNoun(m.groups!.noun) === "singular";
    if (!noun) continue;
    const [start, end] = m.indices!.groups!.target;
    findings.push({
      ruleId: "englishYourYouAre",
      messageKey: "review_msg_your_possessive",
      range: { start, end },
      alternatives: [caseLike(m.groups!.target, "your"), caseLike(m.groups!.target, "you're a")],
      requiresChoice: true,
      context: context(ctx, m.index, m.index + m[0].length),
    });
  }
  return findings;
}

/** English only; findings inside a quoted or parenthesized example are dropped. */
const english =
  (detect: (ctx: DetectContext) => RawFinding[]) =>
  (ctx: DetectContext): RawFinding[] =>
    ctx.lang !== "en_US" ? [] : detect(ctx).filter((f) => !quotedMention(ctx, f));

/** Context detectors appended to REVIEW_DETECTORS. */
export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["englishIrregularForms", "englishAlotCorrection"], detect: english(wordChecks) },
  { rules: ["englishPossessiveNouns"], detect: english(possessiveNouns) },
  { rules: ["englishYourYouAre"], detect: english(youNounOf) },
];
