import { isNounMight, modalHaveWord } from "../../implementations/EnglishModalOfCorrectionRule";
import { ordinalSuffix } from "../../implementations/EnglishOrdinalSuffixRule";
import {
  englishListedNoun,
  englishListedWithoutPlural,
  englishWordInfo,
} from "../../implementations/helpers/EnglishLexicon";
import { canonicalCasing } from "../canonicalCasing";
import { phraseCorrections } from "../englishPhraseCorrections";
import type { PhraseRow } from "../englishPhraseTables";
import { NOUN_LIKE_ING } from "../englishParticiples";
import { namedExampleBefore } from "../exampleCues";
import {
  COMPLETE,
  detectAll,
  frameMatches,
  hasUserOrCasedWord,
  SPACE,
  WORD_END,
} from "../phraseTemplates";
import type { CatalogRuleId } from "../../ruleCatalog";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { quotedMention } from "./grammarStyle1";
import { DETECTORS as CONFUSED_WORDS } from "./confusions1";
import { DETECTORS as FIXED_PHRASES } from "./fixedPhrases";
import { DETECTORS as IDIOM_FRAMES_1 } from "./idioms1";

/** Rows for englishPhraseCorrections, englishClosedCompounds and stylePhrasing. */
export const PHRASES: readonly PhraseRow[] = [
  // A disassembler's view is a disassembly; "dissemble" means to hide one's feelings.
  ...["tab", "window", "view", "listing", "output", "pane"].map((noun): PhraseRow => [
    `dissemble ${noun}`,
    `disassembly ${noun}`,
  ]),
  // Taking apart is paired with putting together (see SLASHED for the slash token).
  ["dissemble/assemble", "disassemble/assemble"],
  ["assemble/dissemble", "assemble/disassemble"],
  // Never English: quoted speech is checked too ("once a twice", he said).
  ["once a twice", "once or twice"],
];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [
  ["chicken/egg", ["chicken-and-egg", "chicken & egg"]],
  // A whole system's infrastructure is uncountable in plain prose.
  ["an infrastructure for", "infrastructure for"],
  // The legal "constituted as" (established as) stays; a judgment is "construed as".
  ["be constituted as a", ["be construed as a", "be constituted a"]],
  ["be constituted as an", ["be construed as an", "be constituted an"]],
];

type Match = RegExpExecArray;

/** `replacement` in the casing of `typed`: shouted, capitalized or as written. */
function caseLike(typed: string, replacement: string): string {
  if (typed.length > 1 && typed === typed.toUpperCase()) return replacement.toUpperCase();
  return /^\p{Lu}/u.test(typed) ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;
}

function finding(
  ctx: DetectContext,
  m: Match,
  ruleId: RawFinding["ruleId"],
  messageKey: RawFinding["messageKey"],
  alternative: string,
): RawFinding {
  const [start, end] = m.indices!.groups!.target;
  return {
    ruleId,
    messageKey,
    range: { start, end },
    alternatives: [alternative],
    context: {
      start: Math.max(0, m.index - 96),
      end: Math.min(ctx.text.length, m.index + m[0].length + 9),
    },
  };
}

/** The chunk names the detector's rare literal at all. */
function mentions(ctx: DetectContext, gate: RegExp): boolean {
  gate.lastIndex = Math.max(0, ctx.from - 256);
  const m = gate.exec(ctx.scanText);
  return !!m && m.index < ctx.to + 64;
}

/** A detector for English text that only runs on chunks naming its literal. */
const gated =
  (gate: RegExp, detect: (ctx: DetectContext) => RawFinding[]) =>
  (ctx: DetectContext): RawFinding[] =>
    ctx.lang !== "en_US" || !mentions(ctx, gate)
      ? []
      : detect(ctx).filter((f) => !quotedMention(ctx, f));

/** English text only; for detectors whose own patterns already read quotes. */
const english =
  (...detectors: ((ctx: DetectContext) => RawFinding[])[]) =>
  (ctx: DetectContext): RawFinding[] =>
    ctx.lang !== "en_US" ? [] : detectAll(ctx, detectors);
/** English text naming the detector's literal; quotations are left to the detector. */
const when =
  (gate: RegExp, detect: (ctx: DetectContext) => RawFinding[]) =>
  (ctx: DetectContext): RawFinding[] =>
    ctx.lang !== "en_US" || !mentions(ctx, gate) ? [] : detect(ctx);

const opensClause = (ctx: DetectContext, index: number) =>
  /(?:^|[.!?;:\n"“(][ \t\u00a0]*)$/.test(ctx.text.slice(Math.max(0, index - 16), index));

// ---------------------------------------------------------------- modal of

// "could of" closing its clause; the core rule waits for the word after "of". Only a
// subject, an adverb or the clause start may come before: "great might of", "a must of".
const MODAL_OF_END = `(?<target>(?<modal>could|would|should|must|might)(?:n['’]t)?${SPACE}(?<of>of))${COMPLETE}`;
const MODAL_LEAD =
  /(?:^|[.!?;:,\n"“(][ \t\u00a0]*|\b(?:I|you|we|they|he|she|it|who|that|there|this|just|still|also|really|never|probably)[ \t\u00a0]+)$/i;

function modalOfAtEnd(ctx: DetectContext): RawFinding[] {
  return [...frameMatches(ctx, MODAL_OF_END)]
    .filter((m) => {
      const before = ctx.text.slice(Math.max(0, m.index - 24), m.index);
      return MODAL_LEAD.test(before) && !isNounMight(m.groups!.modal, before);
    })
    .map((m) => {
      const [ofStart] = m.indices!.groups!.of;
      const typed = ctx.source.slice(m.index, ofStart);
      return finding(
        ctx,
        m,
        "englishModalOfCorrection",
        "review_msg_modal_of",
        `${typed}${modalHaveWord(m.groups!.modal, m.groups!.of)}`,
      );
    });
}

// ---------------------------------------------------------------- prepositions

// "Beware on the step": the thing to beware of takes "of".
const BEWARE = `beware${SPACE}(?<target>in|on|at)${SPACE}(?:the|that|this|these|those)${WORD_END}`;

function bewareOf(ctx: DetectContext): RawFinding[] {
  return [...frameMatches(ctx, BEWARE)]
    .filter((m) => opensClause(ctx, m.index))
    .map((m) =>
      finding(
        ctx,
        m,
        "englishFixedPrepositions",
        "review_msg_fixed_prepositions",
        caseLike(m.groups!.target, "of"),
      ),
    );
}

// "They left in mass": all together is "en masse" after a verb of moving or quitting.
const MOVERS = `move|moves|moved|moving|arrive|arrives|arrived|arriving|leave|leaves|left|leaving|flee|flees|fled|fleeing|resign|resigns|resigned|resigning|quit|quits|quitting|migrate|migrates|migrated|migrating|desert|deserted|gather|gathered|protest|protested|walked${SPACE}out`;
const AFTER_MASS =
  "yesterday|today|tonight|again|now|then|last|this|that|from|to|into|across|after|before|when|and|but|as|over|toward|towards";
const EN_MASSE = `(?:${MOVERS})${SPACE}(?<target>[io]n${SPACE}mass)(?:${COMPLETE}|(?=${SPACE}(?:${AFTER_MASS})${WORD_END}))`;

function enMasse(ctx: DetectContext): RawFinding[] {
  return [...frameMatches(ctx, EN_MASSE)]
    .filter((m) => !hasUserOrCasedWord(ctx, m[0]))
    .map((m) =>
      finding(
        ctx,
        m,
        "englishPhraseCorrections",
        "review_msg_phrase_correction",
        caseLike(m.groups!.target, "en masse"),
      ),
    );
}

// ---------------------------------------------------------------- data structures

// "link lists" are lists of links unless the text is about nodes and pointers.
const LINK_LISTS = `(?<target>link)${SPACE}lists${WORD_END}`;
const LINKED_LIST_CONTEXT =
  /\b(?:nodes?|pointers?|doubly|singly|traversal|traverse|insertion|deletion|data structures?)\b/i;

function linkedLists(ctx: DetectContext): RawFinding[] {
  return [...frameMatches(ctx, LINK_LISTS)]
    .filter((m) =>
      LINKED_LIST_CONTEXT.test(
        ctx.text.slice(Math.max(0, m.index - 160), m.index + m[0].length + 160),
      ),
    )
    .map((m) =>
      finding(
        ctx,
        m,
        "englishPhraseCorrections",
        "review_msg_phrase_correction",
        caseLike(m.groups!.target, "linked"),
      ),
    );
}

// "parts of speeches" are sections of speeches unless the text is about grammar.
const PARTS_OF_SPEECHES = `(?<target>parts?${SPACE}of${SPACE}speeches)${WORD_END}`;
const GRAMMAR_CONTEXT =
  /\b(?:nouns?|verbs?|adjectives?|adverbs?|pronouns?|prepositions?|conjunctions?|POS|tag(?:s|ging|ger)?|grammar|grammatical)\b/;

function partsOfSpeech(ctx: DetectContext): RawFinding[] {
  return [...frameMatches(ctx, PARTS_OF_SPEECHES)]
    .filter(
      (m) =>
        !hasUserOrCasedWord(ctx, m[0]) &&
        GRAMMAR_CONTEXT.test(
          ctx.text.slice(Math.max(0, m.index - 120), m.index + m[0].length + 120),
        ),
    )
    .map((m) =>
      finding(
        ctx,
        m,
        "englishPhraseCorrections",
        "review_msg_phrase_correction",
        caseLike(m.groups!.target, "parts of speech"),
      ),
    );
}

// ---------------------------------------------------------------- scrape / scrap

// "scrap" discards; "scrape" extracts. Only extraction evidence decides: a "from"
// source, a site's markup, or what only a scraper collects.
const SCRAPE: Readonly<Record<string, string>> = {
  scrap: "scrape",
  scraps: "scrapes",
  scrapped: "scraped",
  scrapping: "scraping",
};
const SCRAP = `(?<target>scrap(?:s|ped|ping)?)${SPACE}(?:(?:the|a|an|all|some|its|their|our|my|your|this|these|different|multiple|various|several|many|other)${SPACE})?(?<site>(?:website|site|page|webpage)['’]s${SPACE})?(?<object>[a-z]+)${WORD_END}(?<from>${SPACE}from${WORD_END})?`;
const SCRAPED_ONLY = /^(?:html|urls|tweets|headlines|metadata|hyperlinks)$/;
// Whole sites are scraped only by a program: scrapping them is also just discarding them.
const SITES = /^(?:websites|sites|pages|webpages)$/;
const SCRAPER_CONTEXT =
  /\b(?:python|scripts?|crawl(?:er|ers|ing)?|spiders?|beautifulsoup|selenium|puppeteer|playwright|scrapy|parsers?|parsing)\b/i;
const EXTRACTED =
  /^(?:data|html|content|news|text|prices|information|info|results|links|urls|reviews|listings|articles|emails|images|tweets|headlines|metadata|hyperlinks)$/;

function scrapeWeb(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, SCRAP)) {
    const { target, site, object, from } = m.groups!;
    const object_ = object.toLowerCase();
    if (target !== target.toLowerCase() && !/^S[a-z]+$/.test(target)) continue;
    const sites =
      SITES.test(object_) &&
      SCRAPER_CONTEXT.test(ctx.text.slice(Math.max(0, m.index - 200), m.index + m[0].length + 200));
    if (!sites && (!EXTRACTED.test(object_) || !(from || site || SCRAPED_ONLY.test(object_))))
      continue;
    findings.push(
      finding(
        ctx,
        m,
        "englishPhraseCorrections",
        "review_msg_phrase_correction",
        caseLike(target, SCRAPE[target.toLowerCase()]),
      ),
    );
  }
  return findings;
}

// ---------------------------------------------------------------- style

// "imitate the rhythm from their mentor": whose rhythm it is takes "of" (opt-in).
const IMITATE_FROM = `imitat(?:e|es|ed|ing)${SPACE}(?:the|every|that|this|their|his|her|its|our|your|my)(?:${SPACE}[a-z]+){1,3}${SPACE}(?<target>from)${SPACE}(?:the|their|his|her|its|our|your|my|\\p{Lu}\\p{Ll}+['’]s)${WORD_END}`;

function imitateOf(ctx: DetectContext): RawFinding[] {
  return [...frameMatches(ctx, IMITATE_FROM)].map((m) =>
    finding(ctx, m, "stylePhrasing", "review_msg_style_phrasing", caseLike(m.groups!.target, "of")),
  );
}

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
  for (const [at, swap] of swaps)
    text = text.slice(0, at - left) + swap + text.slice(at - left + swap.length);
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
const PHRASE_FRAMES = IDIOM_FRAMES_1.filter((d) => d.rules.includes("englishPhraseCorrections"));
const phrasesAndFrames = (view: DetectContext) => [
  ...phraseCorrections(view),
  ...PHRASE_FRAMES.flatMap((d) => d.detect(view)),
];

/**
 * A named example's guard reaches 80 characters past its opening quote; once the
 * quotation closes ('The name "Forge" is inspired from'), the prose after it is checked.
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

/** Fixed phrases broken across a soft wrap ("Double\nclick", "I would argue\nthat"). */
function wrappedPhrases(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  SOFT_WRAP.lastIndex = ctx.from;
  for (
    let m = SOFT_WRAP.exec(ctx.scanText);
    m && m.index < ctx.to;
    m = SOFT_WRAP.exec(ctx.scanText)
  ) {
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

// The filler "I would argue that" (grammarStyle1) over a soft wrap.
const ARGUE_WRAPPED = `(?<target>I${SPACE}would${SPACE}argue[ \\t]*\\n[ \\t]*that${SPACE})(?=[A-Za-z])`;

function argueWrapped(ctx: DetectContext): RawFinding[] {
  return [...frameMatches(ctx, ARGUE_WRAPPED)].map((m) =>
    finding(ctx, m, "stylePhrasing", "review_msg_style_phrasing", ""),
  );
}

// A run of capitalized words: a heading, a sign, or shouting.
const CAPS_RUN =
  /(?<![\p{L}\p{N}_'’@/#\\.-])[A-Z]{2,}(?:[ \t ]+[A-Z]{2,})*(?![\p{L}\p{N}_'’@/#\\-])/gu;
const CASING_ONLY: ReadonlySet<string> = new Set(["englishCanonicalCasing"]);
// The default checks a mixed-case word hides; read here whatever the user enabled.
const CASED_RULES: ReadonlySet<string> = new Set([
  "englishConfusedWords",
  "englishCanonicalCasing",
]);

/** Optional: names written in capitals ("SOUTH AMERICA") in their usual casing. */
function shoutedNames(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  CAPS_RUN.lastIndex = ctx.from;
  for (
    let m = CAPS_RUN.exec(ctx.scanText);
    m && m.index < ctx.to;
    m = CAPS_RUN.exec(ctx.scanText)
  ) {
    const start = m.index;
    const end = start + m[0].length;
    // A short acronym ("API", "NASA") is no name written in capitals.
    if (m[0].length < 5) continue;
    const swaps: Swap[] = [[start, m[0].toLowerCase()]];
    const names = (view: DetectContext) => [
      ...canonicalCasing(view),
      ...phraseCorrections(view),
      ...chromeExtension(view),
    ];
    for (const f of inView(ctx, start, end, swaps, names, CASING_ONLY))
      if (
        inside(f, start, end) &&
        !f.alternatives.includes(ctx.text.slice(f.range.start, f.range.end))
      )
        findings.push({ ...f, ruleId: "stylePhrasing", messageKey: "review_msg_name_casing" });
  }
  return findings;
}

// ---------------------------------------------------------------- names

// Lowercase "chrome extension" is the browser's add-on; "Chrome Extension" is offered too.
const CHROME_EXTENSION = `(?<target>(?<chrome>chrome)${SPACE}(?<ext>extensions?))${WORD_END}`;

function chromeExtension(ctx: DetectContext): RawFinding[] {
  return [...frameMatches(ctx, CHROME_EXTENSION)]
    .filter((m) => m.groups!.chrome === "chrome" && m.groups!.ext === m.groups!.ext.toLowerCase())
    .map((m) => {
      const ext = m.groups!.ext;
      const f = finding(ctx, m, "englishCanonicalCasing", "review_msg_canonical_casing", "");
      const alternatives = [`Chrome ${ext}`, `Chrome E${ext.slice(1)}`];
      return { ...f, alternatives, requiresChoice: true as const };
    });
}

// "Day One" is the journaling app; "day one" is the first day.
const DAY_ONE = `(?<target>day${SPACE}one)${WORD_END}`;
const JOURNAL_APP = /\bjournal(?:s|ing)?\b[\s\S]{0,40}\bapps?\b|\bapps?\b[\s\S]{0,40}\bjournal/i;

function dayOne(ctx: DetectContext): RawFinding[] {
  return [...frameMatches(ctx, DAY_ONE)]
    .filter(
      (m) =>
        m[0] === m[0].toLowerCase() &&
        JOURNAL_APP.test(ctx.text.slice(Math.max(0, m.index - 120), m.index + 140)),
    )
    .map((m) =>
      finding(ctx, m, "englishCanonicalCasing", "review_msg_canonical_casing", "Day One"),
    );
}

// Apple writes "macOS" even at the start of a sentence.
const MAC_OS = /(?<![\p{L}\p{N}_'’@/#\\.-])(?<target>MacO[Ss])(?![\p{L}\p{N}_'’@/#\\-])/dgu;

function macOS(ctx: DetectContext): RawFinding[] {
  return [...frameMatches(ctx, MAC_OS)].map((m) =>
    finding(ctx, m, "englishCanonicalCasing", "review_msg_canonical_casing", "macOS"),
  );
}

// The clipped "cybersec" (grammarStyle2) shouted: its capitals are kept.
const CYBERSEC = /(?<![\p{L}\p{N}_'’@/#\\.-])(?<target>CYBERSEC)(?![\p{L}\p{N}_'’@/#\\-])/dgu;

function cybersec(ctx: DetectContext): RawFinding[] {
  return [...frameMatches(ctx, CYBERSEC)].map((m) =>
    finding(ctx, m, "stylePhrasing", "review_msg_style_phrasing", "CYBERSECURITY"),
  );
}

// The hosting service is written "WordPress.com" (the bare domain only, not a URL path).
const WORDPRESS_COM =
  /(?<![\p{L}\p{N}_'’@/#\\.:-])(?<target>[Ww]ord[Pp]ress\.com)(?![\p{L}\p{N}_'’@/#\\-]|\.\p{L})/dgu;

function wordpressCom(ctx: DetectContext): RawFinding[] {
  return [...frameMatches(ctx, WORDPRESS_COM)]
    .filter((m) => m.groups!.target !== "WordPress.com")
    .map((m) =>
      finding(ctx, m, "englishCanonicalCasing", "review_msg_canonical_casing", "WordPress.com"),
    );
}

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
const SLASHED_WORD = new RegExp(
  `(?<![\\p{L}\\p{N}_'’@/#\\\\.-])(?<target>${Object.keys(SLASHED).join("|")})(?=/\\p{L}+(?![\\p{L}\\p{N}_'’@/#\\\\.-]|\\.\\p{L}))`,
  "dgiu",
);
const BE_BEFORE = /(?:^|[^\p{L}'’])(?:am|is|are|was|were|be|been|being|['’]m|['’]re)[ \t ]+$/iu;

function slashedWords(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  SLASHED_WORD.lastIndex = Math.max(0, ctx.from);
  for (
    let m = SLASHED_WORD.exec(ctx.scanText);
    m && m.index < ctx.to;
    m = SLASHED_WORD.exec(ctx.scanText)
  ) {
    const typed = m.groups!.target;
    const word = typed.toLowerCase();
    if (ctx.rules && !ctx.rules.has(SLASHED[word].ruleId)) continue;
    if (typed !== word && !/^[A-Z][a-z]+$/.test(typed)) continue;
    if (ctx.dictionary.has(word)) continue;
    if (word === "bias" && !BE_BEFORE.test(ctx.text.slice(Math.max(0, m.index - 16), m.index)))
      continue;
    const { to, ruleId, messageKey } = SLASHED[word];
    findings.push(finding(ctx, m, ruleId, messageKey, caseLike(typed, to)));
  }
  return findings;
}

// ---------------------------------------------------------------- their / there

// "Is that there dog?": the dialect demonstrative or a slip for the possessive.
// The lookahead first: the clause lookbehind runs only where "is/was that" stands.
const THAT_THERE = `(?=(?:is|was)${SPACE}that${SPACE})(?<=(?:^|[.!?]["”’)]{0,3}[ \\t\\u00a0]{1,8}|\\n[ \\t]{0,8}))(?:is|was)${SPACE}that${SPACE}(?<target>there)${SPACE}(?<noun>\\p{Ll}+)(?=[ \\t\\u00a0]*\\?)`;

function thatThere(ctx: DetectContext): RawFinding[] {
  return [...frameMatches(ctx, THAT_THERE)]
    .filter((m) => {
      const noun = m.groups!.noun;
      const info = englishWordInfo(noun);
      if (NOT_FOUND_THING.test(noun)) return false;
      return !!info?.noun && !info.plural && !info.adverb && !info.adjective;
    })
    .map((m) =>
      finding(ctx, m, "englishTheirThereTheyAre", "review_msg_their_possessive", "their"),
    );
}

// "I saw their running through the park": a seen action, not a possession.
const SAW_THEIR = `(?:saw|see|sees|seen|seeing|watched|noticed|spotted)${SPACE}(?<target>their)${SPACE}(?<ing>\\p{Ll}+ing)${SPACE}(?:through|across|along|around|down|up|into|past|toward|towards|over|away|off)${WORD_END}`;

function sawTheir(ctx: DetectContext): RawFinding[] {
  return [...frameMatches(ctx, SAW_THEIR)]
    .filter((m) => englishWordInfo(m.groups!.ing)?.verbs.some((v) => v.form === "ing"))
    .map((m) => ({
      ...finding(ctx, m, "englishTheirThereTheyAre", "review_msg_confused_word", "they're"),
      alternatives: ["they're", "them"],
      requiresChoice: true as const,
    }));
}

// ---------------------------------------------------------------- small fixes

// "npm" is spelled out letter by letter: "an npm package".
const A_NPM = `(?<target>a)${SPACE}npm${WORD_END}`;

function anNpm(ctx: DetectContext): RawFinding[] {
  return [...frameMatches(ctx, A_NPM)]
    .filter((m) => m[0].endsWith("npm"))
    .map((m) =>
      finding(
        ctx,
        m,
        "englishArticleAnCorrection",
        "review_msg_article",
        caseLike(m.groups!.target, "an"),
      ),
    );
}

// "all are broke under 3.5.1": software is broken in a version; people are broke.
const BROKE_IN_VERSION = `(?:is|are|was|were|be|been|being|got|gets|get)${SPACE}(?<target>broke)${SPACE}(?:again${SPACE})?(?:under|on|in|since|after|with|from|for)${SPACE}v?\\p{Nd}+(?:\\.\\p{Nd}+)+${WORD_END}`;

function brokeInVersion(ctx: DetectContext): RawFinding[] {
  return [...frameMatches(ctx, BROKE_IN_VERSION)].map((m) =>
    finding(ctx, m, "englishIrregularForms", "review_msg_irregular_form", "broken"),
  );
}

// "This policy effects employee morale": a singular subject acting on a bare object.
// "effects" itself takes a change brought about ("effects change").
const EFFECTS = `(?:this|that|the|our|their|his|her|its|my|your|each|every|any)${SPACE}(?<subject>\\p{Ll}{3,})${SPACE}(?<target>effects)${SPACE}(?<object>\\p{Ll}+(?:${SPACE}\\p{Ll}+){0,2})(?=[ \\t\\u00a0]*(?:[.!?;]|$))`;
const BROUGHT_ABOUT =
  /^(?:change|changes|reform|reforms|transformation|transformations|improvement|improvements|repair|repairs|cure|escape|rescue|transfer|transfers|entry|compromise|recovery|savings|closure|settlement)$/;

function effectsObject(ctx: DetectContext): RawFinding[] {
  return [...frameMatches(ctx, EFFECTS)]
    .filter((m) => {
      const subject = englishWordInfo(m.groups!.subject);
      const listed = englishListedNoun(m.groups!.subject);
      if (subject ? !subject.noun || subject.plural || subject.adjective : listed !== "singular")
        return false;
      const words = m.groups!.object.split(/[ \t ]+/);
      if (words.some((w) => BROUGHT_ABOUT.test(w))) return false;
      return words.every((w, i) => {
        const info = englishWordInfo(w);
        if (!info) return englishListedNoun(w) !== null;
        return i === words.length - 1 ? info.noun : info.noun || info.adjective;
      });
    })
    .map((m) => finding(ctx, m, "englishConfusedWords", "review_msg_confused_word", "affects"));
}

// "WebScrappers", "WebScrapping": a web scraper scrapes; "scrap" discards.
const WEB_SCRAP =
  /(?<![\p{L}\p{N}])[Ww]eb(?<target>Scrap(?:p(?:ers?|ing|ed))|Scraps(?=[ \t ]+(?:the|a|an|data|pages|sites|websites)\b))(?![\p{L}\p{N}])/dgu;
const WEB_SCRAPE: Readonly<Record<string, string>> = {
  Scrapper: "Scraper",
  Scrappers: "Scrapers",
  Scrapping: "Scraping",
  Scrapped: "Scraped",
  Scraps: "Scrapes",
};

function webScrape(ctx: DetectContext): RawFinding[] {
  return [...frameMatches(ctx, WEB_SCRAP)].map((m) =>
    finding(
      ctx,
      m,
      "englishPhraseCorrections",
      "review_msg_phrase_correction",
      WEB_SCRAPE[m.groups!.target],
    ),
  );
}

// "each person (s)", "person(ss)": the optional plural is "(s)", attached.
const PLURAL_MARK = /(?<=\p{L})(?<target>[ \t ]+\(s\)|\(ss\))(?![\p{L}\p{N}])/dgu;

function pluralMark(ctx: DetectContext): RawFinding[] {
  return [...frameMatches(ctx, PLURAL_MARK)]
    .filter((m) => {
      const word = /\p{L}+$/u.exec(ctx.text.slice(Math.max(0, m.index - 32), m.index))?.[0] ?? "";
      return word === word.toLowerCase() && !!englishWordInfo(word)?.noun;
    })
    .map((m) => finding(ctx, m, "englishClosedCompounds", "review_msg_closed_compound", "(s)"));
}

// "They agreed meet at dawn": "agree" and "decide" take an infinitive, never a bare verb.
// The verb is no adjective or adverb ("agreed long ago") and a preposition, adverb or
// object follows it, so "decided work was…" (a clause) stays.
const AGREED_VERB = `(?:agree|agrees|agreed|decide|decides|decided)${SPACE}(?<target>\\p{Ll}+)${SPACE}(?<next>at|on|in|with|by|for|from|before|after|early|later|soon|today|tonight|tomorrow|together|again|now|the|a|an|this|that|it|them|him|her|us|me|you|our|their|his|its|my|your)${WORD_END}`;

function agreedVerb(ctx: DetectContext): RawFinding[] {
  return [...frameMatches(ctx, AGREED_VERB)]
    .filter((m) => {
      const word = m.groups!.target;
      const info = englishWordInfo(word);
      return (
        !!info?.verbs.some((v) => v.form === "base") &&
        !info.plural &&
        !info.adjective &&
        !info.adverb &&
        !NOT_FOUND_THING.test(word) &&
        !DETERMINERS.test(word)
      );
    })
    .map((m) =>
      finding(ctx, m, "englishVerbComplements", "review_msg_missing_to", `to ${m.groups!.target}`),
    );
}

// ---------------------------------------------------------------- opt-in style

// "find out the answer": "find" names what was looked for; "find out" stays before a clause,
// "about", a pronoun or a time ("find out the next day").
const FIND_OUT = `(?<target>(?<verb>find|finds|finding)${SPACE}out)${SPACE}(?<next>\\p{Ll}+)(?:${SPACE}(?<second>\\p{Ll}+))?`;
const NOT_FOUND_THING =
  /^(?:about|if|whether|what|who|whom|whose|why|when|where|which|how|that|more|much|less|everything|anything|something|nothing|all|for|from|by|in|on|at|to|with|it|them|him|me|us|you|myself|yourself|himself|herself|themselves|ourselves|soon|later|now|today|tomorrow|tonight|yesterday|first|again|too|also|here|there|fast|quickly|eventually|exactly|together|and|or|but|so|then)$/;
const DETERMINERS =
  /^(?:the|a|an|this|that|these|those|my|your|his|her|its|our|their|some|any|each|every)$/;
const NOT_AFTER_DETERMINER =
  /^(?:hard|next|following|same|other|day|week|month|year|morning|evening|night|time|moment|minute|second|way)$/;

function findOut(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, FIND_OUT)) {
    const { verb, next, second } = m.groups!;
    if (NOT_FOUND_THING.test(next)) continue;
    if (DETERMINERS.test(next)) {
      if (!second || NOT_AFTER_DETERMINER.test(second)) continue;
    } else {
      const info = englishWordInfo(next);
      if (!info || info.adverb || !(info.noun || info.adjective) || /ly$/.test(next)) continue;
    }
    findings.push(finding(ctx, m, "stylePhrasing", "review_msg_style_phrasing", verb));
  }
  return findings;
}

// "After thinking a while, …": as an adverb right after its verb it is one word, "awhile".
// "took a while", "spent a while", "be a while" keep the noun phrase.
const A_WHILE = `(?<verb>\\p{Ll}{3,})${SPACE}(?<target>a${SPACE}while)(?=[ \\t\\u00a0]*(?:[.,;!?]|$))`;
const OBJECT_WHILE = new Set(["take", "spend", "have", "need", "give", "be", "last", "require"]);

function awhile(ctx: DetectContext): RawFinding[] {
  return [...frameMatches(ctx, A_WHILE)]
    .filter((m) => {
      const verbs = englishWordInfo(m.groups!.verb)?.verbs ?? [];
      return (
        verbs.some((v) => v.form === "ing" || v.form === "past") &&
        !verbs.some((v) => OBJECT_WHILE.has(v.lemma))
      );
    })
    .map((m) => finding(ctx, m, "stylePhrasing", "review_msg_style_phrasing", "awhile"));
}

// ---------------------------------------------------------------- slash before a word

// "the most insulting /backhand compliment": one slash typed before a dictionary word in a
// sentence is a typo, not a path ("/usr", "/tmp") or a command at a line start ("/help").
const SLASH_WORD = /(?<=\p{Ll}[,]?[ \t])\/(?=\p{Ll}{3,}[ \t]+\p{Ll})/gu;

/** The slashed token at `start` reads as a word in prose; review's path guard lets it through. */
export function slashedProseWord(source: string, start: number, bare: string): boolean {
  return (
    /^\/\p{Ll}{3,}$/u.test(bare) &&
    /\p{Ll},?[ \t]$/u.test(source.slice(Math.max(0, start - 3), start)) &&
    /^[ \t]+\p{Ll}/u.test(source.slice(start + bare.length, start + bare.length + 3)) &&
    !!englishWordInfo(bare.slice(1))
  );
}

/** The fixed phrases a stray slash hides from the tables: "/backhand compliment". */
function slashPrefixed(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  SLASH_WORD.lastIndex = ctx.from;
  for (let m = SLASH_WORD.exec(ctx.scanText); m && m.index < ctx.to;) {
    const word = /^\p{Ll}+/u.exec(ctx.text.slice(m.index + 1, m.index + 40))![0];
    if (slashedProseWord(ctx.text, m.index, `/${word}`)) {
      const start = m.index + 1;
      findings.push(
        ...inView(ctx, start, start + word.length, [[m.index, " "]], phraseCorrections).filter(
          (f) => f.range.start === start,
        ),
      );
    }
    m = SLASH_WORD.exec(ctx.scanText);
  }
  return findings;
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
const group = (m: Match, name: string) => m.indices!.groups![name];
const lowerFirst = (word: string) =>
  englishWordInfo(word) ? word[0].toLowerCase() + word.slice(1) : word;
const isLower = (word: string) => word === word.toLowerCase();

// "the 2st", "1012rd": "st" (stone) and "rd" (rod) are units too, so the default rule
// leaves them; here the ordinal is offered unless a pound count follows ("11st 4lb").
const ODD_ORDINAL = /(?<=^|[\s([])(?<digits>\p{Nd}{1,9})(?<suffix>st|rd)(?![\p{L}\p{N}_/@#\\-])/gu;

function ordinals(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  ODD_ORDINAL.lastIndex = ctx.from;
  for (let m = ODD_ORDINAL.exec(ctx.scanText); m && m.index < ctx.to;) {
    const { digits, suffix } = m.groups!;
    const end = m.index + m[0].length;
    const expected = ordinalSuffix(digits);
    if (expected !== suffix && !/^[ \t]*\p{Nd}+[ \t]*lbs?\b/u.test(ctx.text.slice(end, end + 12)))
      findings.push(
        possible(ctx, m.index, {
          range: [m.index, end],
          alternatives: [`${digits}${expected}`],
          key: "review_msg_ordinal",
        }),
      );
    m = ODD_ORDINAL.exec(ctx.scanText);
  }
  return findings;
}

// "Their two options left.": "There are …" when what is left is counted.
const THEIR_LEFT = `(?<target>their)${SPACE}(?:two|three|four|five|six|seven|eight|nine|ten|no|several|many|\\p{Nd}+|a${SPACE}few)${SPACE}(?<noun>\\p{L}+)${SPACE}left(?=[ \\t\\u00a0]*(?:[.!?]|$))`;

function theirLeft(ctx: DetectContext): RawFinding[] {
  return [...frameMatches(ctx, THEIR_LEFT)]
    .filter((m) => opensClause(ctx, m.index) && isLower(m.groups!.noun))
    .filter((m) => !!englishWordInfo(m.groups!.noun)?.plural)
    .map((m) =>
      possible(ctx, m.index, {
        range: group(m, "target"),
        alternatives: [caseLike(m.groups!.target, "there are")],
      }),
    );
}

// "The cause it is unclear.": a pronoun repeating the subject before an adjective that ends
// the sentence. "cause" may also have been "because".
const SUBJECT_IT = `(?<target>(?<det>the|this|that|our|my|your|their|his|her)${SPACE}(?<noun>\\p{L}+)${SPACE}it${SPACE}(?<be>is|was))${SPACE}(?<adj>\\p{L}+)(?=[ \\t\\u00a0]*(?:[.!?]|$))`;

function subjectIt(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, SUBJECT_IT)) {
    const { det, noun, be, adj } = m.groups!;
    const nounInfo = englishWordInfo(noun);
    if (!opensClause(ctx, m.index) || !isLower(noun + adj) || !nounInfo?.noun || nounInfo.plural)
      continue;
    if (!englishWordInfo(adj)?.adjective) continue;
    const alternatives = [`${det} ${noun} ${be}`];
    if (noun === "cause" && /^the$/i.test(det))
      alternatives.push(caseLike(det, `because it ${be}`));
    findings.push(possible(ctx, m.index, { range: group(m, "target"), alternatives }));
  }
  return findings;
}

// "Stress can cause it is not obvious.": a clause missing "That", or a clause after "it".
const CAUSE_IT_IS = `(?<target>(?<subject>\\p{L}+)${SPACE}(?<modal>can|could|may|might|will|would|should|must|does|did)${SPACE}cause${SPACE}it${SPACE}(?<be>is|was))${WORD_END}`;

function causeItIs(ctx: DetectContext): RawFinding[] {
  return [...frameMatches(ctx, CAUSE_IT_IS)]
    .filter((m) => opensClause(ctx, m.index) && isLower(m.groups!.modal))
    .map((m) => {
      const { subject, modal, be } = m.groups!;
      return possible(ctx, m.index, {
        range: group(m, "target"),
        alternatives: [
          `${caseLike(subject, "that")} ${lowerFirst(subject)} ${modal} cause it ${be}`,
          `${subject} ${modal} cause it, which ${be}`,
        ],
      });
    });
}

// "The artist painted portrait in studio.": a lone countable noun after a past verb, with a
// lone noun after its preposition or an adverb closing the sentence.
const BARE_OBJECT = `(?:the|a|an|this|that|my|our|their|his|her)${SPACE}\\p{L}+${SPACE}(?<verb>\\p{L}+)${SPACE}(?<obj>\\p{L}+)${SPACE}(?:(?:in|on|at|under|near|into|onto|behind|beside)${SPACE}(?<place>\\p{L}+)|(?<adverb>\\p{L}+ly|outside|inside|nearby|indoors|outdoors))(?=[ \\t\\u00a0]*[.!?])`;
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

function bareObjects(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, BARE_OBJECT, "obj")) {
    const { verb, obj, place, adverb } = m.groups!;
    if (!opensClause(ctx, m.index) || !isLower(verb) || !countableSingular(obj)) continue;
    if (!englishWordInfo(verb)?.verbs.some((v) => v.form === "past")) continue;
    if (place && (BARE_PLACES.has(place) || !countableSingular(place))) continue;
    if (adverb && /ly$/.test(adverb) && !englishWordInfo(adverb)?.adverb) continue;
    const article = /^[aeiou]/.test(obj) ? "an" : "a";
    findings.push(
      possible(ctx, m.index, {
        range: group(m, "obj"),
        alternatives: [`${article} ${obj}`, `the ${obj}`],
      }),
    );
    if (place)
      findings.push(
        possible(ctx, m.index, { range: group(m, "place"), alternatives: [`the ${place}`] }),
      );
  }
  return findings;
}

// "They have writing today.": the progressive takes "be"; "have been writing" keeps "have".
// The default rule leaves -ing words that are also nouns ("We have training today") and a
// clause ending on the verb; this opt-in check offers both readings there.
const HAVE_ING = `(?<target>(?<subject>I|you|we|they|he|she|it)${SPACE}(?<have>have|has)${SPACE}(?<ing>\\p{L}+ing))(?=${SPACE}(?:today|now|tonight|tomorrow|again)${WORD_END}|(?<end>[ \\t\\u00a0]*(?:[.!?]|$)))`;
const BE_FOR: Record<string, string> = { i: "am", he: "is", she: "is", it: "is" };

function haveIng(ctx: DetectContext): RawFinding[] {
  return [...frameMatches(ctx, HAVE_ING)]
    .filter((m) => {
      const { subject, have, ing, end } = m.groups!;
      const singular = /^(?:he|she|it)$/i.test(subject);
      if (!opensClause(ctx, m.index) || !isLower(have + ing) || (have === "has") !== singular)
        return false;
      if (end === undefined && !NOUN_LIKE_ING.test(ing)) return false;
      return !!englishWordInfo(ing)?.verbs.some((v) => v.form === "ing");
    })
    .map((m) => {
      const { subject, have, ing } = m.groups!;
      const be = BE_FOR[subject.toLowerCase()] ?? "are";
      return possible(ctx, m.index, {
        range: group(m, "target"),
        alternatives: [`${subject} ${be} ${ing}`, `${subject} ${have} been ${ing}`],
      });
    });
}

// "It doesn't quiet.": "quite" closing a negated clause (the default rule needs a next word).
const NOT_QUIET = `\\p{L}+n['’]t${SPACE}(?<target>quiet)${COMPLETE}`;

// "you have more good" -> "better", unless more good is weighed against harm.
const MORE_GOOD = `(?<target>more${SPACE}good)${COMPLETE}`;

// "they often sort after the total": a habit is "sought after" or "sort by"; "sort after the
// join" (then) has no frequency adverb before it.
const SORT_AFTER = `(?:often|usually|always|generally|typically|commonly|normally|sometimes|mostly)${SPACE}(?<target>sort${SPACE}after)${SPACE}(?:the|a|an|their|its|his|her|our|my|your)${WORD_END}`;

// "scrap page", "scrapped pages": scraping extracts a page; scrapping discards it.
const SCRAP_PAGES = `(?<target>scrap(?:s|ped|ping)?)${SPACE}(?:web${SPACE})?(?:pages?|webpages?|websites?|sites?)${WORD_END}`;

// "I adore markdown": the formatting language is "Markdown"; a price cut keeps lowercase.
const MARKDOWN = `(?<!(?:a|an|the|this|that|any|no|big|huge|steep|deep|small|price|\\p{Nd}+%?)${SPACE})(?<target>markdown)${WORD_END}(?!${SPACE}(?:of|on|in|to|from|price|prices)${WORD_END})`;

// "She wants finish early": "want" and "need" take "to" before a verb.
const WANTS_VERB = `(?:want|wants|wanted|need|needs|needed)${SPACE}(?<target>\\p{L}+)${SPACE}(?:early|later|soon|now|today|tonight|tomorrow|first|quickly|again|together|immediately)${WORD_END}`;

// "because affect is hidden": the noun is usually "effect" ("affect" is a mood in psychology).
const AFFECT_NOUN = `(?:because|since|although|though|while|if|when|and|but|so)${SPACE}(?<target>affect)${SPACE}(?:is|was|has|will|can|may|might|seems)${WORD_END}`;

// "helps you weight small things": "weigh" measures; "weight" assigns a weight.
const WEIGHT_VERB = `(?:help|helps|helped|helping|let|lets|make|makes)${SPACE}(?:you|me|us|them|him|her|people|users)${SPACE}(?<target>weight)${WORD_END}`;

// "You boxes": "Your boxes", or "You box".
const YOU_PLURAL = `(?<target>you${SPACE}(?<word>\\p{L}+s))(?=[ \\t\\u00a0]*(?:[.!?]|$)|${SPACE}(?:are|were|look|seem)${WORD_END})`;

// "The Putin's war": a name's possessive takes no article. Names that take "the" stay.
const THE_NAME = `(?<target>the${SPACE})(?<name>\\p{L}+)['’]s${SPACE}\\p{L}`;
const THE_NAMES = new Set(
  "hague thames bronx vatican kremlin sahara nile rhine danube mediterranean caribbean gambia congo sudan ukraine crimea midwest quran koran louvre alamo riviera yukon mekong volga titanic hobbit".split(
    " ",
  ),
);

function possibleForms(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const add = (pattern: string, alternatives: (m: Match) => string[] | null) => {
    for (const m of frameMatches(ctx, pattern)) {
      const alts = alternatives(m);
      if (alts)
        findings.push(possible(ctx, m.index, { range: group(m, "target"), alternatives: alts }));
    }
  };
  const typed = (m: Match) => m.groups!.target;
  add(NOT_QUIET, (m) => (isLower(typed(m)) ? ["quite"] : null));
  add(MORE_GOOD, (m) => (isLower(typed(m)) ? ["better"] : null));
  add(SORT_AFTER, (m) => (isLower(typed(m)) ? ["sought after", "sort by"] : null));
  add(SCRAP_PAGES, (m) => (isLower(typed(m)) ? [SCRAPE[typed(m)]] : null));
  add(MARKDOWN, (m) => (typed(m) === "markdown" ? ["Markdown"] : null));
  add(WANTS_VERB, (m) => {
    const info = englishWordInfo(typed(m));
    const verb =
      isLower(typed(m)) &&
      !!info?.verbs.some((v) => v.form === "base") &&
      !info.plural &&
      !info.adjective &&
      !info.adverb &&
      !NOT_FOUND_THING.test(typed(m)) &&
      !DETERMINERS.test(typed(m));
    return verb ? [`to ${typed(m)}`] : null;
  });
  add(AFFECT_NOUN, (m) => (isLower(typed(m)) ? ["effect", "the effect"] : null));
  add(WEIGHT_VERB, (m) => (isLower(typed(m)) ? ["weigh"] : null));
  add(YOU_PLURAL, (m) => {
    const word = m.groups!.word;
    const info = englishWordInfo(word);
    const third = info?.verbs.find((v) => v.form === "third");
    if (!opensClause(ctx, m.index) || !isLower(word) || !info?.plural || !third) return null;
    const you = typed(m).slice(0, 3);
    return [`${caseLike(you, "your")} ${word}`, `${you} ${third.lemma}`];
  });
  add(THE_NAME, (m) => {
    const name = m.groups!.name;
    if (!/^\p{Lu}\p{Ll}+$/u.test(name) || /s$/.test(name) || THE_NAMES.has(name.toLowerCase()))
      return null;
    if (englishWordInfo(name) || englishListedNoun(name)) return null;
    // A title in capitals ("The Hobbit's Ending") is a name of its own.
    const after = ctx.text.slice(m.index + m[0].length - 1, m.index + m[0].length);
    return isLower(after) ? [""] : null;
  });
  return findings;
}

// "I HoP we can…", "cHrOmE eXtEnSiOn": words typed with random capitals hide the default
// checks, which abstain on cased words (names like "iPhone"). Read lowercased, they apply.
const MIXED_CASE = /(?<![\p{L}\p{N}_'’@/#\\.-])\p{L}*\p{Ll}\p{Lu}\p{L}*(?![\p{L}\p{N}_'’@/#\\-])/gu;
// A copy for matchAll, which starts at the lastIndex of the regex it is given.
const MIXED_WORDS = new RegExp(MIXED_CASE.source, "gu");
const casedChecks = (view: DetectContext) => [
  ...CONFUSED_WORDS.flatMap((d) => d.detect(view)),
  ...chromeExtension(view),
];

function mixedCase(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  MIXED_CASE.lastIndex = ctx.from;
  for (let m = MIXED_CASE.exec(ctx.scanText); m && m.index < ctx.to;) {
    const start = m.index;
    const end = start + m[0].length;
    // Only a dictionary word can hide a check ("aB" or "PoC" stay).
    if (englishWordInfo(m[0])) {
      // Every mixed word around it is read lowercased: "cHrOmE eXtEnSiOn".
      const from = Math.max(0, start - 64);
      const swaps: Swap[] = [...ctx.text.slice(from, end + 64).matchAll(MIXED_WORDS)].map(
        (w): Swap => [from + w.index, w[0].toLowerCase()],
      );
      for (const f of inView(ctx, start, end, swaps, casedChecks, CASED_RULES))
        if (f.range.start < end && f.range.end > start)
          findings.push({ ...f, ruleId: "englishPossibleErrors" });
    }
    m = MIXED_CASE.exec(ctx.scanText);
  }
  return findings;
}

// Quoted wording is checked too: the tables' quotation and example guards keep a mention
// ("'chalk full' is nonstandard") as typed, and this opt-in check reads it anyway.
const QUOTE_MARKS = /["“”'‘’«»`]/;
const QUOTED_RULES: ReadonlySet<string> = new Set([
  "englishPhraseCorrections",
  "englishClosedCompounds",
  "englishPossibleErrors",
]);
const quotedChecks = (view: DetectContext) => [
  ...phrasesAndFrames(view),
  ...FIXED_PHRASES.flatMap((d) => d.detect(view)),
];

function quotedMentions(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const { start, end } of ctx.quotationRanges ?? []) {
    if (start < ctx.from) continue;
    if (start >= ctx.to) break;
    const innerEnd = QUOTE_MARKS.test(ctx.text[end - 1]) ? end - 1 : end;
    // The window inView reads: 256 characters around the quotation's inside.
    const left = Math.max(0, start + 1 - 256);
    const right = Math.min(ctx.text.length, innerEnd + 256);
    // Only the quotation is read: everything around it is blanked.
    const swaps: Swap[] = [
      [left, " ".repeat(start + 1 - left)],
      [innerEnd, " ".repeat(right - innerEnd)],
    ];
    for (const f of inView(ctx, start + 1, innerEnd, swaps, quotedChecks, QUOTED_RULES))
      if (inside(f, start + 1, innerEnd))
        findings.push({
          ...f,
          ruleId: "englishPossibleErrors",
          messageKey: "review_msg_quoted_mention",
        });
  }
  return findings;
}

// ---------------------------------------------------------------- opt-in: other accepted forms

// "Chrome extension": the store's own title case, "Chrome Extension", is offered on request.
function chromeTitle(ctx: DetectContext): RawFinding[] {
  return [...frameMatches(ctx, CHROME_EXTENSION)]
    .filter((m) => m.groups!.chrome === "Chrome" && isLower(m.groups!.ext))
    .map((m) => ({
      ...finding(ctx, m, "styleAlternativePhrasing", "review_msg_alternative_phrasing", ""),
      alternatives: [`Chrome E${m.groups!.ext.slice(1)}`],
    }));
}

const PHRASE_RULES: CatalogRuleId[] = [
  "englishPhraseCorrections",
  "englishClosedCompounds",
  "stylePhrasing",
  "englishAmericanSpelling",
  "englishBritishSpelling",
  "styleWordChoice",
  "englishCanonicalCasing",
];

/** Context detectors appended to REVIEW_DETECTORS. */
export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: ["englishModalOfCorrection"],
    detect: gated(/(?:ld|st|ht)(?:n['’]t)?[ \t\u00a0]+of\b/gi, modalOfAtEnd),
  },
  { rules: ["englishFixedPrepositions"], detect: gated(/beware/gi, bewareOf) },
  {
    rules: ["englishPhraseCorrections"],
    detect: (ctx) => [
      ...gated(/\b[io]n[ \t\u00a0]+mass\b/gi, enMasse)(ctx),
      ...gated(/link[ \t\u00a0]+lists/gi, linkedLists)(ctx),
      ...gated(/of[ \t\u00a0]+speeches/gi, partsOfSpeech)(ctx),
      ...gated(/scrap/gi, scrapeWeb)(ctx),
    ],
  },
  { rules: ["stylePhrasing"], detect: gated(/imitat/gi, imitateOf) },
  { rules: PHRASE_RULES, detect: english(quotedPhrases, afterExamples, wrappedPhrases) },
  { rules: ["stylePhrasing"], detect: english(shoutedNames) },
  {
    rules: ["englishCanonicalCasing"],
    detect: (ctx) => [
      ...when(/chrome[ \t\u00a0]+extension/gi, chromeExtension)(ctx),
      ...when(/day[ \t\u00a0]+one/gi, dayOne)(ctx),
      ...when(/MacO[Ss]/g, macOS)(ctx),
      ...when(/press\.com/gi, wordpressCom)(ctx),
    ],
  },
  {
    rules: ["englishClosedCompounds", "englishConfusedWords", "styleWordChoice"],
    detect: when(/\/\p{L}/gu, slashedWords),
  },
  {
    rules: ["englishTheirThereTheyAre"],
    detect: (ctx) => [
      ...when(/that[ \t\u00a0]+there/gi, thatThere)(ctx),
      ...when(/their[ \t\u00a0]+\p{L}+ing/giu, sawTheir)(ctx),
    ],
  },
  { rules: ["englishArticleAnCorrection"], detect: when(/\ba[ \t\u00a0]+npm/g, anNpm) },
  { rules: ["englishIrregularForms"], detect: when(/broke[ \t\u00a0]/gi, brokeInVersion) },
  { rules: ["englishConfusedWords"], detect: when(/effects[ \t\u00a0]/gi, effectsObject) },
  {
    rules: ["englishVerbComplements"],
    detect: when(/(?:agree|decide)[sd]?[ \t\u00a0]/gi, agreedVerb),
  },
  { rules: ["englishPhraseCorrections"], detect: when(/[Ww]ebScrap/g, webScrape) },
  { rules: ["englishClosedCompounds"], detect: when(/\((?:s|ss)\)/g, pluralMark) },
  { rules: ["englishPhraseCorrections"], detect: when(/\s\/\p{Ll}/gu, slashPrefixed) },
  {
    rules: ["englishPossibleErrors"],
    // Each check runs only on chunks holding its rare literal.
    detect: english(
      when(/\p{Nd}(?:st|rd)/gu, ordinals),
      when(/their[ \t\u00a0]/gi, theirLeft),
      when(/\bit[ \t\u00a0]+(?:is|was)\b/gi, subjectIt),
      when(/cause[ \t\u00a0]+it/gi, causeItIs),
      bareObjects,
      when(/\bha(?:ve|s)[ \t\u00a0]+\p{L}+ing\b/giu, haveIng),
      possibleForms,
      when(/\p{Ll}\p{Lu}/gu, mixedCase),
      quotedMentions,
    ),
  },
  {
    rules: ["styleAlternativePhrasing"],
    detect: when(/chrome[ \t\u00a0]+extension/gi, chromeTitle),
  },
  {
    rules: ["stylePhrasing"],
    detect: (ctx) => [
      ...when(/find(?:s|ing)?[ \t\u00a0]+out/gi, findOut)(ctx),
      ...when(/\ba[ \t\u00a0]+while/gi, awhile)(ctx),
      ...when(/argue[ \t]*\n/gi, argueWrapped)(ctx),
      ...when(/CYBERSEC/g, cybersec)(ctx),
    ],
  },
];
