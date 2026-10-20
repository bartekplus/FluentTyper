import { isNounMight, modalHaveWord } from "../../implementations/EnglishModalOfCorrectionRule";
import { ordinalSuffix } from "../../implementations/EnglishOrdinalSuffixRule";
import { englishInitialSound } from "../../implementations/helpers/EnglishInitialSound";
import {
  englishListedNoun,
  englishListedWithoutPlural,
  englishWordInfo,
  hasVerbForm,
} from "../../implementations/helpers/EnglishLexicon";
import { canonicalCasing } from "../canonicalCasing";
import { phraseCorrections } from "../englishPhraseCorrections";
import { NOUN_LIKE_ING } from "../englishParticiples";
import { namedExampleBefore } from "../exampleCues";
import {
  caseLike,
  detectAll,
  found,
  group,
  hasUserOrCasedWord,
  ownedMatches,
} from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import type { Detector, MatchFixer } from "../../engine/reviewRules";
import { opensClause } from "./grammarStyle2";
import { PREDICATES as CONFUSED_WORDS } from "./confusions1";
import { fixedPhrases } from "./fixedPhrases";
import { FIXERS as IDIOM_FIXERS_1 } from "./idioms1";
import { frameRuleDetector } from "../../engine/reviewRules";

/** English text only; for detectors whose own patterns already read quotes. */
const english =
  (...detectors: ((ctx: DetectContext) => RawFinding[])[]) =>
  (ctx: DetectContext): RawFinding[] =>
    ctx.lang !== "en_US" ? [] : detectAll(ctx, detectors);

// ---------------------------------------------------------------- frame fixes

// Only a subject, an adverb or the clause start may come before "could of": "great might
// of", "a must of".
const MODAL_LEAD =
  /(?:^|[.!?;:,\n"“(][ \t\u00a0]*|\b(?:I|you|we|they|he|she|it|who|that|there|this|just|still|also|really|never|probably)[ \t\u00a0]+)$/i;

const LINKED_LIST_CONTEXT =
  /\b(?:nodes?|pointers?|doubly|singly|traversal|traverse|insertion|deletion|data structures?)\b/i;
const GRAMMAR_CONTEXT =
  /\b(?:nouns?|verbs?|adjectives?|adverbs?|pronouns?|prepositions?|conjunctions?|POS|tag(?:s|ging|ger)?|grammar|grammatical)\b/;

// "scrap" discards; "scrape" extracts. Only extraction evidence decides: a "from"
// source, a site's markup, or what only a scraper collects.
const SCRAPE: Readonly<Record<string, string>> = {
  scrap: "scrape",
  scraps: "scrapes",
  scrapped: "scraped",
  scrapping: "scraping",
};
const SCRAPED_ONLY = /^(?:html|urls|tweets|headlines|metadata|hyperlinks)$/;
// Whole sites are scraped only by a program: scrapping them is also just discarding them.
const SITES = /^(?:websites|sites|pages|webpages)$/;
const SCRAPER_CONTEXT =
  /\b(?:python|scripts?|crawl(?:er|ers|ing)?|spiders?|beautifulsoup|selenium|puppeteer|playwright|scrapy|parsers?|parsing)\b/i;
const EXTRACTED =
  /^(?:data|html|content|news|text|prices|information|info|results|links|urls|reviews|listings|articles|emails|images|tweets|headlines|metadata|hyperlinks)$/;

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
const PHRASE_FIXERS = {
  modalOfAtEnd: (m, ctx) => {
    const before = ctx.text.slice(Math.max(0, m.index - 24), m.index);
    if (!MODAL_LEAD.test(before) || isNounMight(m.groups!.modal, before)) return null;
    const [ofStart] = m.indices!.groups!.of;
    const typed = ctx.source.slice(m.index, ofStart);
    return `${typed}${modalHaveWord(m.groups!.modal, m.groups!.of)}`;
  },
  bewareOf: (m, ctx) => (opensClause(ctx, m.index) ? caseLike(m.groups!.target, "of") : null),
  enMasse: (m, ctx) =>
    hasUserOrCasedWord(ctx, m[0]) ? null : caseLike(m.groups!.target, "en masse"),
  linkedLists: (m, ctx) =>
    LINKED_LIST_CONTEXT.test(
      ctx.text.slice(Math.max(0, m.index - 160), m.index + m[0].length + 160),
    )
      ? caseLike(m.groups!.target, "linked")
      : null,
  partsOfSpeech: (m, ctx) =>
    !hasUserOrCasedWord(ctx, m[0]) &&
    GRAMMAR_CONTEXT.test(ctx.text.slice(Math.max(0, m.index - 120), m.index + m[0].length + 120))
      ? caseLike(
          m.groups!.target,
          // "one part of speeches" is one part of speech; "the part of speeches" is plural.
          /\b(?:one|a|an|each|every|this|that)[ \t\u00a0]+$/i.test(
            ctx.text.slice(Math.max(0, m.index - 16), m.index),
          )
            ? "part of speech"
            : "parts of speech",
        )
      : null,
  scrapeWeb: (m, ctx) => {
    const { target, site, object, from } = m.groups!;
    const object_ = object.toLowerCase();
    if (target !== target.toLowerCase() && !/^S[a-z]+$/.test(target)) return null;
    const sites =
      SITES.test(object_) &&
      SCRAPER_CONTEXT.test(ctx.text.slice(Math.max(0, m.index - 200), m.index + m[0].length + 200));
    if (!sites && (!EXTRACTED.test(object_) || !(from || site || SCRAPED_ONLY.test(object_))))
      return null;
    return caseLike(target, SCRAPE[target.toLowerCase()]);
  },
  imitateOf: (m) => caseLike(m.groups!.target, "of"),
} satisfies Record<string, MatchFixer>;

// ---------------------------------------------------------------- phrase tables through a mark

/** A same-length substitution: the text at `at` reads as `text` in the view. */
type Swap = readonly [at: number, text: string];

/**
 * Runs `detect` over a window of the text with `swaps` applied, owning [start, end).
 * Offsets hold, so findings map back as they are. Lets the shared tables see a phrase
 * a mark hides from them: scare quotes, a soft line wrap, capitals.
 */
function inView(
  ctx: DetectContext,
  start: number,
  end: number,
  swaps: readonly Swap[],
  detect: (view: DetectContext) => RawFinding[],
  rules = ctx.rules,
): RawFinding[] {
  const left = Math.max(0, start - 256);
  const right = Math.min(ctx.text.length, end + 256);
  let text = ctx.text.slice(left, right);
  for (const [at, swap] of swaps) {
    // A swap outside the window cannot change the view.
    if (at < left || at + swap.length > right) continue;
    text = text.slice(0, at - left) + swap + text.slice(at - left + swap.length);
  }
  const view: DetectContext = {
    ...ctx,
    source: text,
    text,
    scanText: text,
    from: start - left,
    to: end - left,
    rules,
    quotationRanges: [],
    exampleRanges: [],
  };
  return detect(view).map((f) => ({
    ...f,
    range: { start: f.range.start + left, end: f.range.end + left },
    context: f.context && { start: f.context.start + left, end: f.context.end + left },
  }));
}

const inside = (f: RawFinding, start: number, end: number) =>
  f.range.start >= start && f.range.end <= end;

// Words that make a quotation a mention of its words rather than their use.
const MENTION =
  /\b(?:wrote|writes?|written|writing|typed|ironic\w*|sarcas\w*|nonstandard|non-standard|incorrect\w*|wrong\w*|misspel\w*|instead|rather|should be|supposed to be|means?|meaning|stands? for|versus|vs|spell\w*|phrases?|words?|terms?|expressions?|idioms?|typos?|errors?|mistakes?|forms?|correct\w*|labels?|titles?|headings?|buttons?|names?|named|tags?|strings?|commands?)\b/i;

const LISTED_BEFORE = /(?:["”'’»],[ \t]*|→[ \t]*|[-=]>[ \t]*|\([ \t]*)$/;
const LISTED_AFTER = /^(?:[ \t]*(?:→|[-=]>)|,[ \t]*["“'‘«]|[ \t]*\))/;

/** The sentence around [start, end), without the quotation itself. */
function sentenceAround(ctx: DetectContext, start: number, end: number): string {
  const before = ctx.text.slice(Math.max(0, start - 160), start);
  const after = ctx.text.slice(end, end + 160);
  const open = Math.max(...[".", "!", "?", "\n"].map((mark) => before.lastIndexOf(mark)));
  const close = after.search(/[.!?\n]/);
  return `${before.slice(open + 1)} ${close < 0 ? after : after.slice(0, close)}`;
}

/**
 * Scare quotes ("tongue and cheek" jokes) and quoted speech are the writer's own words:
 * the tables' quotation guard is meant for mentions, which a cue word gives away.
 * Still necessary: phraseCorrections skips a phrase that a quotation wraps exactly (quotedSpan).
 */
function quotedPhrases(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const examples = new Set((ctx.exampleRanges ?? []).map((r) => r.start));
  for (const { start, end } of ctx.quotationRanges ?? []) {
    if (start < ctx.from - 1 || examples.has(start)) continue;
    if (start >= ctx.to) break;
    const inner = ctx.text.slice(start + 1, end - 1);
    if (inner.length < 3 || inner.length > 48 || /[\n.!?]/.test(inner)) continue;
    if (!/[\p{P}]/u.test(ctx.text[end - 1])) continue;
    if (namedExampleBefore(ctx.text, start + 1) || MENTION.test(sentenceAround(ctx, start, end)))
      continue;
    // A list of quoted forms or a mapping ("x" → "y") names them.
    if (
      LISTED_BEFORE.test(ctx.text.slice(Math.max(0, start - 8), start)) ||
      LISTED_AFTER.test(ctx.text.slice(end, end + 8))
    )
      continue;
    const swaps: Swap[] = [
      [start, " "],
      [end - 1, " "],
    ];
    findings.push(
      ...inView(ctx, start + 1, end - 1, swaps, phraseCorrections).filter((f) =>
        inside(f, start + 1, end - 1),
      ),
    );
  }
  return findings;
}

// The fixed-preposition frames ("inspired from") that a named example before them also hides.
const idiomPhrases1 = frameRuleDetector("en.idiomPhrases1", { en: IDIOM_FIXERS_1 });
const phrasesAndFrames = (view: DetectContext) => [
  ...phraseCorrections(view),
  ...idiomPhrases1(view),
];

/**
 * A named example's guard reaches 80 characters past its opening quote; once the
 * quotation closes ('The name "Forge" is inspired from'), the prose after it is checked.
 * Still necessary: namedExampleBefore also hides that prose from the shared tables.
 */
function afterExamples(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const quotes = ctx.quotationRanges ?? [];
  for (const { start, end } of ctx.exampleRanges ?? []) {
    if (end < ctx.from || end >= ctx.to || !/[\p{P}]/u.test(ctx.text[end - 1])) continue;
    const lineEnd = ctx.text.indexOf("\n", end);
    const stop = Math.min(ctx.to, end + 80, lineEnd < 0 ? ctx.text.length : lineEnd);
    if (stop - end < 4) continue;
    findings.push(
      ...inView(ctx, end, stop, [[start, " "]], phrasesAndFrames).filter(
        (f) =>
          f.range.start >= end &&
          !quotes.some((q) => f.range.start < q.end && f.range.end > q.start),
      ),
    );
  }
  return findings;
}

// One line break inside a sentence, before a lowercase word: a soft wrap.
const SOFT_WRAP = /(?<=\p{L})[ \t]*\n[ \t]*(?=\p{Ll})/gu;

/** Fixed phrases broken across a soft wrap ("Double\nclick"). */
function wrappedPhrases(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of ownedMatches(ctx, SOFT_WRAP)) {
    const newline = m.index + m[0].indexOf("\n");
    const lineStart = ctx.text.lastIndexOf("\n", newline - 1) + 1;
    // Phrases are short: start at a word boundary at most ~40 characters back.
    let from = Math.max(lineStart, newline - 40);
    if (from > lineStart) {
      const space = ctx.text.indexOf(" ", from);
      if (space < 0 || space >= newline) continue;
      from = space + 1;
    }
    findings.push(
      ...inView(ctx, from, newline, [[newline, " "]], phraseCorrections).filter(
        (f) => f.range.start < newline && f.range.end > newline,
      ),
    );
  }
  return findings;
}

const CASING_ONLY: ReadonlySet<string> = new Set(["englishCanonicalCasing"]);

// "Day One" is the journaling app; "day one" is the first day.
const JOURNAL_APP = /\bjournal(?:s|ing)?\b[\s\S]{0,40}\bapps?\b|\bapps?\b[\s\S]{0,40}\bjournal/i;

// ---------------------------------------------------------------- slashed words

// Words wrong on the left of a slash; the slash token is otherwise read as a path.
// "bias" needs a form of "be" before it ("I am bias/prefer…").
const SLASHED: Readonly<
  Record<string, { to: string; ruleId: RawFinding["ruleId"]; messageKey: RawFinding["messageKey"] }>
> = {
  infront: {
    to: "in front",
    ruleId: "englishClosedCompounds",
    messageKey: "review_msg_closed_compound",
  },
  bias: { to: "biased", ruleId: "englishConfusedWords", messageKey: "review_msg_confused_word" },
  deref: { to: "dereference", ruleId: "styleWordChoice", messageKey: "review_msg_word_choice" },
  derefs: { to: "dereferences", ruleId: "styleWordChoice", messageKey: "review_msg_word_choice" },
  dirs: { to: "directories", ruleId: "styleWordChoice", messageKey: "review_msg_word_choice" },
};
/**
 * Slashed tokens that are prose, not paths: "w/o", "prev/next", a decade before a slash
 * ("1970's/early"), the SLASHED words and the slash-token rows. Review's technical-token
 * guard lets them through.
 */
export const PROSE_SLASH_TOKEN = new RegExp(
  `^(?:w\\/o|prev\\/next|\\p{Nd}{3}0['’]s\\/\\p{L}+|(?:${Object.keys(SLASHED).join("|")})\\/\\p{L}+|dissemble\\/assemble|assemble\\/dissemble|chicken\\/egg)$`,
  "iu",
);
const BE_BEFORE = /(?:^|[^\p{L}'’])(?:am|is|are|was|were|be|been|being|['’]m|['’]re)[ \t ]+$/iu;

// frame() uses the `i` flag, and `\p{Ll}` then also matches capitals. In all-caps text, write
// the fix in capitals.
const shouted = (m: RegExpExecArray, word: string) =>
  m[0] === m[0].toUpperCase() ? word.toUpperCase() : word;

// "This policy effects employee morale": "effects" itself takes a change brought about
// ("effects change").
const BROUGHT_ABOUT =
  /^(?:change|changes|reform|reforms|transformation|transformations|improvement|improvements|repair|repairs|cure|escape|rescue|transfer|transfers|entry|compromise|recovery|savings|closure|settlement)$/;

const WEB_SCRAPE: Readonly<Record<string, string>> = {
  Scrapper: "Scraper",
  Scrappers: "Scrapers",
  Scrapping: "Scraping",
  Scrapped: "Scraped",
  Scraps: "Scrapes",
};

/** A base verb that has no plural, adjective or adverb reading and is no determiner. */
function bareVerb(word: string): boolean {
  const info = englishWordInfo(word);
  return (
    !!info?.verbs.some((v) => v.form === "base") &&
    !info.plural &&
    !info.adjective &&
    !info.adverb &&
    !NOT_FOUND_THING.test(word) &&
    !DETERMINERS.test(word)
  );
}

// ---------------------------------------------------------------- opt-in style

const NOT_FOUND_THING =
  /^(?:about|if|whether|what|who|whom|whose|why|when|where|which|how|that|more|much|less|everything|anything|something|nothing|all|for|from|by|in|on|at|to|with|it|them|him|me|us|you|myself|yourself|himself|herself|themselves|ourselves|soon|later|now|today|tomorrow|tonight|yesterday|first|again|too|also|here|there|fast|quickly|eventually|exactly|together|and|or|but|so|then)$/;
const DETERMINERS =
  /^(?:the|a|an|this|that|these|those|my|your|his|her|its|our|their|some|any|each|every)$/;
const NOT_AFTER_DETERMINER =
  /^(?:hard|next|following|same|other|day|week|month|year|morning|evening|night|time|moment|minute|second|way)$/;

const OBJECT_WHILE = new Set(["take", "spend", "have", "need", "give", "be", "last", "require"]);

// ---------------------------------------------------------------- slash before a word

/** The slashed token at `start` reads as a word in prose; review's path guard lets it through. */
export function slashedProseWord(source: string, start: number, bare: string): boolean {
  return (
    /^\/\p{Ll}{3,}$/u.test(bare) &&
    /\p{Ll},?[ \t]$/u.test(source.slice(Math.max(0, start - 3), start)) &&
    /^[ \t]+\p{Ll}/u.test(source.slice(start + bare.length, start + bare.length + 3)) &&
    !!englishWordInfo(bare.slice(1))
  );
}

// ---------------------------------------------------------------- opt-in: possible mistakes

// Forms that are usually mistakes but can be correct English: each is offered only when the
// writer opts in to englishPossibleErrors, with the likely intended forms as choices.
type Possible = { range: [number, number]; alternatives: string[]; key?: RawFinding["messageKey"] };
const possible = (ctx: DetectContext, at: number, hit: Possible): RawFinding => ({
  ruleId: "englishPossibleErrors",
  messageKey: hit.key ?? "review_msg_possible_error",
  range: { start: hit.range[0], end: hit.range[1] },
  alternatives: hit.alternatives,
  ...(hit.alternatives.length > 1 ? { requiresChoice: true as const } : {}),
  context: { start: Math.max(0, at - 96), end: Math.min(ctx.text.length, hit.range[1] + 32) },
});
const lowerFirst = (word: string) =>
  word !== "I" && englishWordInfo(word) ? word[0].toLowerCase() + word.slice(1) : word;
const isLower = (word: string) => word === word.toLowerCase();

// Places English names without an article ("in bed", "at home", "on time").
const BARE_PLACES = new Set(
  "bed home school class church college court prison jail hospital sea work town time foot board fire hand line stage camp office duty air".split(
    " ",
  ),
);
const NOT_OBJECTS = new Set(
  "it them him her us me you this that these those something nothing everything anything one all home back out up down away there here".split(
    " ",
  ),
);

/** A singular countable noun from the lexicon: a plural exists and it is no adjective. */
function countableSingular(word: string): boolean {
  if (!isLower(word) || NOT_OBJECTS.has(word)) return false;
  const info = englishWordInfo(word);
  if (!info) return englishListedNoun(word) === "singular" && !englishListedWithoutPlural(word);
  if (!info.noun || info.plural || info.adjective || info.adverb) return false;
  if (info.verbs.some((v) => v.form !== "base")) return false;
  return [`${word}s`, `${word}es`].some((form) => englishWordInfo(form)?.plural);
}

const BE_FOR: Record<string, string> = { i: "am", he: "is", she: "is", it: "is" };

// "The Putin's war": names that take "the" stay.
const THE_NAMES = new Set(
  "hague thames bronx vatican kremlin sahara nile rhine danube mediterranean caribbean gambia congo sudan ukraine crimea midwest quran koran louvre alamo riviera yukon mekong volga titanic hobbit".split(
    " ",
  ),
);

/** A fixer that offers `alternatives` of the `target` group as a possible mistake. */
const possibleFix =
  (alternatives: (m: RegExpExecArray, ctx: DetectContext) => string[] | null): MatchFixer =>
  (m, ctx) => {
    const alts = alternatives(m, ctx);
    return alts && possible(ctx, m.index, { range: group(m, "target"), alternatives: alts });
  };
const targetOf = (m: RegExpExecArray) => m.groups!.target;
const lowerTarget = (alternatives: string[]) =>
  possibleFix((m) => (isLower(targetOf(m)) ? alternatives : null));

// A copy of the mixed-case frame for matchAll, which starts at the lastIndex of the regex it is
// given.
const MIXED_WORDS =
  /(?<![\p{L}\p{N}_'’@/#\\.-])\p{L}*\p{Ll}\p{Lu}\p{L}*(?![\p{L}\p{N}_'’@/#\\-])/gu;
const casedChecks = (view: DetectContext) => [
  ...CONFUSED_WORDS.confusedWords(view),
  ...chromeExtension(view),
];

// Quoted wording is checked too: the tables' quotation and example guards keep a mention
// ("'chalk full' is nonstandard") as typed, and this opt-in check reads it anyway.
const QUOTE_MARKS = /["“”'‘’«»`]/;
const QUOTED_RULES: ReadonlySet<string> = new Set([
  "englishPhraseCorrections",
  "englishClosedCompounds",
  "englishPossibleErrors",
]);
const quotedChecks = (view: DetectContext) => [...phrasesAndFrames(view), ...fixedPhrases(view)];

// Still necessary: the default checks skip a named example; only this opt-in check reads it.
function quotedMentions(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  // Away from the text's edges, the view is 256 blanks, the inside and 256 blanks: the same
  // inside gives the same findings at a shift. Each distinct inside is checked one time.
  const checked = new Map<string, { at: number; found: RawFinding[] }>();
  for (const { start, end } of ctx.quotationRanges ?? []) {
    if (start < ctx.from) continue;
    if (start >= ctx.to) break;
    const innerEnd = QUOTE_MARKS.test(ctx.text[end - 1]) ? end - 1 : end;
    const inner = ctx.text.slice(start + 1, innerEnd);
    // A letter or two ("a", "x") holds no phrase; skipping it spares a full frame pass.
    if ((inner.match(/\p{L}/gu)?.length ?? 0) < 3) continue;
    // The window inView reads: 256 characters around the quotation's inside.
    const left = Math.max(0, start + 1 - 256);
    const right = Math.min(ctx.text.length, innerEnd + 256);
    const same = left === start + 1 - 256 && right === innerEnd + 256;
    const seen = same ? checked.get(inner) : undefined;
    if (seen) {
      const shift = start + 1 - seen.at;
      for (const f of seen.found)
        findings.push({
          ...f,
          range: { start: f.range.start + shift, end: f.range.end + shift },
          context: f.context && { start: f.context.start + shift, end: f.context.end + shift },
        });
      continue;
    }
    // Only the quotation is read: everything around it is blanked.
    const swaps: Swap[] = [
      [left, " ".repeat(start + 1 - left)],
      [innerEnd, " ".repeat(right - innerEnd)],
    ];
    const found = inView(ctx, start + 1, innerEnd, swaps, quotedChecks, QUOTED_RULES)
      .filter((f) => inside(f, start + 1, innerEnd))
      .map((f): RawFinding => ({
        ...f,
        ruleId: "englishPossibleErrors",
        messageKey: "review_msg_quoted_mention",
      }));
    if (same) checked.set(inner, { at: start + 1, found });
    findings.push(...found);
  }
  return findings;
}

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  ...PHRASE_FIXERS,
  shoutedNames: (m, ctx) => {
    const start = m.index;
    const end = start + m[0].length;
    // A short acronym ("API", "NASA") is no name written in capitals.
    if (m[0].length < 5) return null;
    const swaps: Swap[] = [[start, m[0].toLowerCase()]];
    const names = (view: DetectContext) => [
      ...canonicalCasing(view),
      ...phraseCorrections(view),
      ...chromeExtension(view),
    ];
    return inView(ctx, start, end, swaps, names, CASING_ONLY)
      .filter(
        (f) =>
          inside(f, start, end) &&
          !f.alternatives.includes(ctx.text.slice(f.range.start, f.range.end)),
      )
      .map((f): RawFinding => ({
        ...f,
        ruleId: "stylePhrasing",
        messageKey: "review_msg_name_casing",
      }));
  },
  chromeExtension: (m) => {
    const ext = m.groups!.ext;
    return m.groups!.chrome === "chrome" && ext === ext.toLowerCase()
      ? [`Chrome ${ext}`, `Chrome E${ext.slice(1)}`]
      : null;
  },
  dayOne: (m, ctx) =>
    m[0] === m[0].toLowerCase() &&
    JOURNAL_APP.test(ctx.text.slice(Math.max(0, m.index - 120), m.index + 140))
      ? "Day One"
      : null,
  slashedWord: (m, ctx) => {
    const typed = m.groups!.target;
    const word = typed.toLowerCase();
    if (typed !== word && !/^[A-Z][a-z]+$/.test(typed)) return null;
    if (ctx.dictionary.has(word)) return null;
    if (word === "bias" && !BE_BEFORE.test(ctx.text.slice(Math.max(0, m.index - 16), m.index)))
      return null;
    const { to, ruleId, messageKey } = SLASHED[word];
    return found(ctx, m, ruleId, messageKey, [caseLike(typed, to)]);
  },
  thatThere: (m) => {
    const noun = m.groups!.noun;
    const info = englishWordInfo(noun);
    if (NOT_FOUND_THING.test(noun)) return null;
    return info?.noun && !info.plural && !info.adverb && !info.adjective
      ? shouted(m, "their")
      : null;
  },
  sawTheir: (m) =>
    hasVerbForm(m.groups!.ing, "ing") ? [shouted(m, "they're"), shouted(m, "them")] : null,
  anNpm: (m) => (m[0].endsWith("npm") ? caseLike(m.groups!.target, "an") : null),
  brokeInVersion: (m) => caseLike(m.groups!.target, "broken"),
  effectsObject: (m) => {
    const subject = englishWordInfo(m.groups!.subject);
    const listed = englishListedNoun(m.groups!.subject);
    if (subject ? !subject.noun || subject.plural || subject.adjective : listed !== "singular")
      return null;
    const words = m.groups!.object.split(/[ \t ]+/);
    if (words.some((w) => BROUGHT_ABOUT.test(w))) return null;
    return words.every((w, i) => {
      const info = englishWordInfo(w);
      if (!info) return englishListedNoun(w) !== null;
      return i === words.length - 1 ? info.noun : info.noun || info.adjective;
    })
      ? shouted(m, "affects")
      : null;
  },
  agreedVerb: (m) =>
    bareVerb(m.groups!.target) ? `${shouted(m, "to")} ${m.groups!.target}` : null,
  webScrape: (m) => WEB_SCRAPE[m.groups!.target],
  pluralMark: (m, ctx) => {
    const word = /\p{L}+$/u.exec(ctx.text.slice(Math.max(0, m.index - 32), m.index))?.[0] ?? "";
    return word === word.toLowerCase() && !!englishWordInfo(word)?.noun ? "(s)" : null;
  },
  /** The fixed phrases a stray slash hides from the tables: "/backhand compliment". */
  slashPrefixed: (m, ctx) => {
    const word = /^\p{Ll}+/u.exec(ctx.text.slice(m.index + 1, m.index + 40))![0];
    if (!slashedProseWord(ctx.text, m.index, `/${word}`)) return null;
    const start = m.index + 1;
    return inView(ctx, start, start + word.length, [[m.index, " "]], phraseCorrections).filter(
      (f) => f.range.start === start,
    );
  },
  oddOrdinal: (m, ctx) => {
    const { digits, suffix } = m.groups!;
    const end = m.index + m[0].length;
    const expected = ordinalSuffix(digits);
    if (expected === suffix || /^[ \t]*\p{Nd}+[ \t]*lbs?\b/u.test(ctx.text.slice(end, end + 12)))
      return null;
    return possible(ctx, m.index, {
      range: [m.index, end],
      alternatives: [`${digits}${expected}`],
      key: "review_msg_ordinal",
    });
  },
  theirLeft: possibleFix((m, ctx) =>
    opensClause(ctx, m.index) &&
    isLower(m.groups!.noun) &&
    !!englishWordInfo(m.groups!.noun)?.plural
      ? [caseLike(m.groups!.target, "there are")]
      : null,
  ),
  subjectIt: (m, ctx) => {
    const { det, noun, be, adj } = m.groups!;
    const nounInfo = englishWordInfo(noun);
    if (!opensClause(ctx, m.index) || !isLower(noun + adj) || !nounInfo?.noun || nounInfo.plural)
      return null;
    if (!englishWordInfo(adj)?.adjective) return null;
    const alternatives = [`${det} ${noun} ${be}`];
    if (noun === "cause" && /^the$/i.test(det))
      alternatives.push(caseLike(det, `because it ${be}`));
    return possible(ctx, m.index, { range: group(m, "target"), alternatives });
  },
  causeItIsPossible: possibleFix((m, ctx) => {
    if (!opensClause(ctx, m.index) || !isLower(m.groups!.modal)) return null;
    const { subject, modal, be } = m.groups!;
    return [
      `${caseLike(subject, "that")} ${lowerFirst(subject)} ${modal} cause it ${be}`,
      `${subject} ${modal} cause it, which ${be}`,
    ];
  }),
  bareObjects: (m, ctx) => {
    const { verb, obj, place, adverb } = m.groups!;
    if (!opensClause(ctx, m.index) || !isLower(verb) || !countableSingular(obj)) return null;
    if (!hasVerbForm(verb, "past")) return null;
    if (place && (BARE_PLACES.has(place) || !countableSingular(place))) return null;
    if (adverb && /ly$/.test(adverb) && !englishWordInfo(adverb)?.adverb) return null;
    // People say "herb" and "ukulele" with the two articles: the first letter selects one.
    const sound = englishInitialSound(obj);
    const vowel = sound === "either" ? /^[aeiou]/.test(obj) : sound === "vowel";
    const findings = [
      possible(ctx, m.index, {
        range: group(m, "obj"),
        alternatives: [`${vowel ? "an" : "a"} ${obj}`, `the ${obj}`],
      }),
    ];
    if (place)
      findings.push(
        possible(ctx, m.index, { range: group(m, "place"), alternatives: [`the ${place}`] }),
      );
    return findings;
  },
  haveIng: possibleFix((m, ctx) => {
    const { subject, have, ing, end } = m.groups!;
    const singular = /^(?:he|she|it)$/i.test(subject);
    if (!opensClause(ctx, m.index) || !isLower(have + ing) || (have === "has") !== singular)
      return null;
    if (end === undefined && !NOUN_LIKE_ING.test(ing)) return null;
    if (!hasVerbForm(ing, "ing")) return null;
    const be = BE_FOR[subject.toLowerCase()] ?? "are";
    return [`${subject} ${be} ${ing}`, `${subject} ${have} been ${ing}`];
  }),
  notQuiet: lowerTarget(["quite"]),
  moreGood: lowerTarget(["better"]),
  sortAfter: lowerTarget(["sought after", "sort by"]),
  scrapPages: possibleFix((m) => (isLower(targetOf(m)) ? [SCRAPE[targetOf(m)]] : null)),
  markdownName: possibleFix((m) => (targetOf(m) === "markdown" ? ["Markdown"] : null)),
  wantsVerb: possibleFix((m) =>
    isLower(targetOf(m)) && bareVerb(targetOf(m)) ? [`to ${targetOf(m)}`] : null,
  ),
  affectNoun: lowerTarget(["effect", "the effect"]),
  weightVerb: lowerTarget(["weigh"]),
  youPlural: possibleFix((m, ctx) => {
    const word = m.groups!.word;
    const info = englishWordInfo(word);
    const third = info?.verbs.find((v) => v.form === "third");
    if (!opensClause(ctx, m.index) || !isLower(word) || !info?.plural) return null;
    // "You idiots are late": a plural of address.
    if (
      /^(?:guys|folks|kids|boys|girls|ladies|idiots|fools|clowns|losers|cowards|liars|jerks|morons|geniuses|lads|chaps|dudes)$/.test(
        word,
      )
    )
      return null;
    const you = targetOf(m).slice(0, 3);
    // A plural noun that is also an -s verb ("You boxes") may have meant the verb.
    return [`${caseLike(you, "your")} ${word}`, ...(third ? [`${you} ${third.lemma}`] : [])];
  }),
  theName: possibleFix((m, ctx) => {
    const name = m.groups!.name;
    if (!/^\p{Lu}\p{Ll}+$/u.test(name) || /s$/.test(name) || THE_NAMES.has(name.toLowerCase()))
      return null;
    if (englishWordInfo(name) || englishListedNoun(name)) return null;
    // A title in capitals ("The Hobbit's Ending") is a name of its own.
    const after = ctx.text.slice(m.index + m[0].length - 1, m.index + m[0].length);
    return isLower(after) ? [""] : null;
  }),
  mixedCase: (m, ctx) => {
    const start = m.index;
    const end = start + m[0].length;
    // Only a dictionary word can hide a check ("aB" or "PoC" stay).
    if (!englishWordInfo(m[0])) return null;
    // Every mixed word around it is read lowercased: "cHrOmE eXtEnSiOn".
    const from = Math.max(0, start - 64);
    const swaps: Swap[] = [...ctx.text.slice(from, end + 64).matchAll(MIXED_WORDS)].map(
      (w): Swap => [from + w.index, w[0].toLowerCase()],
    );
    return inView(ctx, start, end, swaps, casedChecks)
      .filter((f) => f.range.start < end && f.range.end > start)
      .map((f): RawFinding => ({ ...f, ruleId: "englishPossibleErrors" }));
  },
  // "Chrome extension": the store's own title case, "Chrome Extension", is offered on request.
  chromeTitle: (m) =>
    m.groups!.chrome === "Chrome" && isLower(m.groups!.ext)
      ? `Chrome E${m.groups!.ext.slice(1)}`
      : null,
  findOut: (m) => {
    const { verb, next, second } = m.groups!;
    if (NOT_FOUND_THING.test(next)) return null;
    if (DETERMINERS.test(next)) {
      if (!second || NOT_AFTER_DETERMINER.test(second)) return null;
    } else {
      const info = englishWordInfo(next);
      if (!info || info.adverb || !(info.noun || info.adjective) || /ly$/.test(next)) return null;
    }
    return verb;
  },
  awhile: (m) => {
    const verbs = englishWordInfo(m.groups!.verb)?.verbs ?? [];
    return verbs.some((v) => v.form === "ing" || v.form === "past") &&
      !verbs.some((v) => OBJECT_WHILE.has(v.lemma))
      ? shouted(m, "awhile")
      : null;
  },
} satisfies Record<string, MatchFixer>;

// Lowercase "chrome extension" is the browser's add-on. Other checks read it in a view, as the
// predicate did: whatever checks are on.
const chromeExtensionRule = frameRuleDetector("en.chromeExtension", { en: FIXERS });
const chromeExtension = (view: DetectContext) => chromeExtensionRule({ ...view, rules: undefined });

/** The Review detectors by name; grammar/rules/en.yaml sets their checks and order. */
export const PREDICATES = {
  quotedPhrases: english(quotedPhrases, afterExamples, wrappedPhrases),
  quotedMentions: english(quotedMentions),
} satisfies Record<string, Detector>;
