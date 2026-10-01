import { isNounMight, modalHaveWord } from "../../implementations/EnglishModalOfCorrectionRule";
import type { PhraseRow } from "../englishPhraseTables";
import { COMPLETE, frameMatches, hasUserOrCasedWord, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { quotedMention } from "./grammarStyle1";

/** Rows for englishPhraseCorrections, englishClosedCompounds and stylePhrasing. */
export const PHRASES: readonly PhraseRow[] = [
  // A disassembler's view is a disassembly; "dissemble" means to hide one's feelings.
  ...["tab", "window", "view", "listing", "output", "pane"].map((noun): PhraseRow => [
    `dissemble ${noun}`,
    `disassembly ${noun}`,
  ]),
];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [
  // "find out" discovers a fact; ways and means are found.
  ["find out ways", "find ways"],
  ["find out a way", "find a way"],
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
const SCRAP = `(?<target>scrap(?:s|ped|ping)?)${SPACE}(?:(?:the|a|an|all|some|its|their|our|my|your|this|these)${SPACE})?(?<site>(?:website|site|page|webpage)['’]s${SPACE})?(?<object>[a-z]+)${WORD_END}(?<from>${SPACE}from${WORD_END})?`;
const SCRAPED_ONLY = /^(?:html|urls|tweets|headlines|metadata|hyperlinks)$/;
const EXTRACTED =
  /^(?:data|html|content|news|text|prices|information|info|results|links|urls|reviews|listings|articles|emails|images|tweets|headlines|metadata|hyperlinks)$/;

function scrapeWeb(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const m of frameMatches(ctx, SCRAP)) {
    const { target, site, object, from } = m.groups!;
    const object_ = object.toLowerCase();
    if (target !== target.toLowerCase() && !/^S[a-z]+$/.test(target)) continue;
    if (!EXTRACTED.test(object_) || !(from || site || SCRAPED_ONLY.test(object_))) continue;
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
];
