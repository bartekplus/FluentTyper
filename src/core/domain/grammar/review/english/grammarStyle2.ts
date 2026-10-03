import { englishInitialSound } from "../../implementations/helpers/EnglishInitialSound";
import { englishWordInfo, hasVerbForm } from "../../implementations/helpers/EnglishLexicon";
import { englishNounForms } from "../../implementations/helpers/EnglishNounNumber";
import {
  applyWordCase,
  detectWordCase,
  wordSet,
} from "../../implementations/helpers/GenericRuleShared";
import { each, type PhraseRow } from "../englishPhraseTables";
import {
  COMPLETE,
  detectPhraseTemplates,
  frameMatches,
  group,
  hasUserOrCasedWord,
  type PhraseTemplate,
  SPACE,
  WORD_END,
} from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { gatedMatches, mentions } from "./grammarStyle1";

/** Spaced and hyphen-less forms of a hyphenated compound: "blu ray" -> "blu-ray". */
const hyphenated = (...compounds: string[]): PhraseRow[] =>
  compounds.map((compound) => [compound.replaceAll("-", " "), compound]);

/** Rows for englishPhraseCorrections. */
export const PHRASES: readonly PhraseRow[] = [
  // "very less" is never English: "much less" for an amount, "too little" for too small an amount.
  ["very less", ["much less", "far less", "a lot less"]],
  ["quite less", ["quite a lot less", "much less"]],
  ["too less", "too little"],
  // "is been" mixes two auxiliaries.
  ["is been", "has been"],
  ["isn't been", "hasn't been"],
  ["are been", "have been"],
  ["aren't been", "haven't been"],
  ["each others", "each other's"],
  ["one anothers", "one another's"],
  // Prefixes the words never take.
  ["insecured", "unsecured"],
  ["unsecure", "insecure"],
  ["unpossible", "impossible"],
  ["unvisible", "invisible"],
  // Misspellings that are never words.
  [["abandonedware", "abanonedware"], "abandonware"],
  ["generaly", "generally"],
  ["childrens", "children's"],
  ["cheif", "chief"],
  ["recieved", "received"],
  ["hes", "he's"],
  ["shes", "she's"],
  ["guilded age", "Gilded Age"],
  ["to to to", "to do to"],
  [
    ["to to list", "to-to list"],
    ["to-do list", "to do list"],
  ],
  [
    ["to to lists", "to-to lists"],
    ["to-do lists", "to do lists"],
  ],
  // "scrap" discards; "scrape" extracts data from the web.
  ...["", " ", "-"].flatMap((join): PhraseRow[] =>
    [
      ["scrap", "scrape"],
      ["scraps", "scrapes"],
      ["scrapped", "scraped"],
      ["scrapper", "scraper"],
      ["scrappers", "scrapers"],
      ["scrapping", "scraping"],
    ].map(([typed, fixed]) => [`web${join}${typed}`, `web${join}${fixed}`]),
  ),
  ["scrap html", "scrape html"],
  ["scraps html", "scrapes html"],
  ["scrapping html", "scraping html"],
  ["scrapping web", "scraping web"],
];

export const COMPOUNDS: readonly PhraseRow[] = [
  ...hyphenated("blu-ray", "blu-rays", "cross-platform", "post-it note", "post-it notes"),
  ...hyphenated("double-check", "double-checks", "double-checked", "double-checking"),
  ...hyphenated("guinea-bissau"),
  ...each(
    ["rate", "rates", "conversion", "conversions", "optimization", "optimizations", "ratio"],
    "click through ~",
    "click-through ~",
  ),
  ...each(
    ["rate", "rates", "conversion", "conversions", "optimization"],
    "view through ~",
    "view-through ~",
  ),
  ...each(["", "s", "ed", "ing"], "black list~", "blacklist~"),
  ...each(["", "s", "ed", "ing"], "white list~", "whitelist~"),
  ["kindof", "kind of"],
  ["sortof", "sort of"],
  ["insteadof", "instead of"],
  ["intothe", "into the"],
  ["doesthe", "does the"],
  ["notnot", "not not"],
];

const UNIQUE_DEGREE = [
  "pretty",
  "fairly",
  "somewhat",
  "quite",
  "rather",
  "really",
  "extremely",
  "so",
];
export const STYLE: readonly PhraseRow[] = [
  ["pretty decent", "decent"],
  ...each(
    ["know", "knew", "think", "thought", "believe", "believed", "said", "hope", "feel", "felt"],
    "~ that that",
    "~ that",
  ),
  ...UNIQUE_DEGREE.map((degree): PhraseRow => [
    `${degree} unique`,
    [`${degree} unusual`, `${degree} rare`, "unique"],
  ]),
  // Clipped and chat spellings.
  ["cybersec", "cybersecurity"],
  ["cuz", "because"],
  ["legit", "legitimate"],
  ["perf", "performance"],
  ["pref", "preference"],
  ["prefs", "preferences"],
  ["tho", "though"],
  ["fwd", "forward"],
  ["thru", "through"],
  ["prev", "previous"],
  ["ctrl", "control"],
  ["w/o", "without"],
  [["in-built", "inbuilt"], "built-in"],
  ["touristic", ["tourist", "touristy"]],
  // Current names of renamed places.
  ["bombay", "Mumbai"],
  ["ayers rock", "Uluru"],
  ["saigon", "Ho Chi Minh City"],
  ["the olgas", "Kata Tjuta"],
  [["leningrad", "petrograd"], "Saint Petersburg"],
  ["upper volta", "Burkina Faso"],
  ["ivory coast", "Côte d'Ivoire"],
];

// Closed-class word sets; open-class decisions go through the lexicon.
const DET = wordSet(
  "the a an this that these those my your his her its our their each every no another",
);
const PRONOUNS = wordSet("i you we they he she it me him us them");
const AUX = wordSet(
  "is are was were be been am has have had will would can could should shall may might must do does did",
);
const PREPOSITIONS = wordSet(
  "of for about with from into onto at by to on in up out off over back down away under through during after before since until like as than",
);
const CLOSED = new Set([
  ...DET,
  ...PRONOUNS,
  ...AUX,
  ...PREPOSITIONS,
  ...wordSet("and or but so if then there here now not too very also just still all both some any"),
  ...wordSet("who whom whose which what where when why how forward forwards ahead"),
]);
/** A noun or adjective that is not only a verb; an unlisted lowercase word is a long pure noun. */
function modifiable(word: string): boolean {
  const lower = word.toLowerCase();
  if (CLOSED.has(lower)) return false;
  const entry = englishWordInfo(lower);
  if (!entry) return /^[a-z]{3,}$/i.test(word);
  return entry.noun || entry.plural || entry.adjective;
}

type Range = readonly [number, number];
const span = (match: RegExpExecArray): Range => [match.index, match.index + match[0].length];
/** Only spaces, quotes or brackets between a clause boundary and `index`, or `also` matches. */
function opensClause(ctx: DetectContext, index: number, also?: RegExp): boolean {
  const before = ctx.text.slice(Math.max(0, index - 48), index);
  return /(?:^|[.!?;:(\n"“][ \t ]*)$/.test(before) || (also?.test(before) ?? false);
}
/**
 * A finding for [start, end) whose replacement keeps the typed letters' case:
 * `fix` rewrites the typed text ("Two Handed" -> "Two-Handed"). Names and user words abstain.
 */
function finding(
  ctx: DetectContext,
  [start, end]: Range,
  ruleId: RawFinding["ruleId"],
  messageKey: RawFinding["messageKey"],
  fix: (typed: string) => string,
  evidence: Range = [start, end],
): RawFinding | null {
  if (hasUserOrCasedWord(ctx, ctx.text.slice(evidence[0], evidence[1]))) return null;
  const typed = ctx.source.slice(start, end);
  const fixed = fix(typed);
  if (fixed === typed) return null;
  return {
    ruleId,
    messageKey,
    range: { start, end },
    alternatives: [fixed],
    context: {
      start: Math.max(0, evidence[0] - 48),
      end: Math.min(ctx.text.length, evidence[1] + 16),
    },
  };
}
const cased = (replacement: string) => (typed: string) =>
  applyWordCase(replacement, detectWordCase(typed));
const hyphen = (typed: string) => typed.replace(/[ \t ]+/, "-");
const join = (typed: string) => typed.replace(/[ \t ]+/, "");
const NEXT = `${SPACE}(?<next>\\p{L}+)${WORD_END}`;

// A frame scan costs a pass over the chunk: a keyword gate skips most chunks. A frame
// without a key is gated on its own required literal (frameMatches).
type KeyedTemplate = PhraseTemplate & { key?: RegExp };
const templates = (
  ctx: DetectContext,
  list: readonly KeyedTemplate[],
  ruleId: RawFinding["ruleId"],
) =>
  detectPhraseTemplates(
    ctx,
    list.filter((template) => !template.key || mentions(ctx, template.key)),
    ruleId,
  );

const SENTENCE_TEMPLATES: readonly KeyedTemplate[] = [
  // "Tell me if there a delay": the clause has lost its verb.
  {
    key: /there\s+(?:a|an|another)\b/giu,
    pattern: `(?:if|when|whenever|whether|because|unless|since|while|until|once)${SPACE}(?<target>there${SPACE})(?=(?:a|an|another)${WORD_END})`,
    replacement: "there is ",
    messageKey: "review_msg_sentence_structure",
  },
  // "I am not be happy": "be" after a finite be-verb and "not".
  {
    key: /not\s+be\b/giu,
    pattern: `(?:am|is|are|was|were|i['’]m|you['’]re|we['’]re|they['’]re)${SPACE}(?<target>not${SPACE}be)${WORD_END}`,
    replacement: "not",
    messageKey: "review_msg_sentence_structure",
  },
];
const PHRASE_TEMPLATES: readonly KeyedTemplate[] = [
  {
    pattern: `(?:look|looks|looked|looking)${SPACE}(?<target>likes)${WORD_END}`,
    replacement: "like",
    messageKey: "review_msg_phrase_correction",
  },
  {
    key: /no\s+nothing/giu,
    pattern: `(?:i|you|we|they)${SPACE}(?<target>no)(?=${SPACE}nothing${WORD_END})`,
    replacement: "know",
    messageKey: "review_msg_typo",
  },
  {
    key: /no\s+nothing/giu,
    pattern: `(?:he|she|it)${SPACE}(?<target>no)(?=${SPACE}nothing${WORD_END})`,
    replacement: "knows",
    messageKey: "review_msg_typo",
  },
];
const COMPOUND_TEMPLATES: readonly KeyedTemplate[] = [
  // ", where as cats…" contrasts two clauses; "where, as a child, …" is a place.
  {
    key: /where\s+as\b/giu,
    pattern: `(?<=,${SPACE})(?<target>where${SPACE}as)${SPACE}(?!(?:a|an|the|soon|long|well|much|many|far|if|though|usual|always|before|such|of|to)${WORD_END})`,
    replacement: "whereas",
    messageKey: "review_msg_closed_compound",
  },
];
const NOT_ANY = `(?!(?:one|longer|matter|more|less|doubt|further|sooner|way|thanks|for)${WORD_END})\\p{L}+${WORD_END}`;
const DOUBLE_NEGATIVE: readonly KeyedTemplate[] = [
  // "I haven't done no harm": the perfect is already negative. "haven't said no" refuses,
  // and "hasn't got no…" is mostly quoted dialect.
  {
    key: /\bno\b/giu,
    pattern: `(?:haven['’]t|hasn['’]t|hadn['’]t|(?:have|has|had)${SPACE}(?:not|n['’]t))${SPACE}(?!(?:said|got)${WORD_END})\\p{L}+${SPACE}(?<target>no)${SPACE}${NOT_ANY}`,
    replacement: "any",
    messageKey: "review_msg_double_negative",
  },
  {
    key: /take\s+no\b/giu,
    pattern: `(?:didn['’]t|did${SPACE}not|don['’]t|do${SPACE}not|doesn['’]t|does${SPACE}not|won['’]t|wouldn['’]t)${SPACE}take${SPACE}(?<target>no)${SPACE}${NOT_ANY}`,
    replacement: "any",
    messageKey: "review_msg_double_negative",
  },
];
const STYLE_TEMPLATES: readonly KeyedTemplate[] = [
  // "No thanks" opens with an interjection; "No thanks to you" is a different idiom.
  {
    key: /no\s+thanks/giu,
    pattern: `(?<target>no)(?=${SPACE}thanks${WORD_END}(?!${SPACE}to${WORD_END}))`,
    replacement: "no,",
    messageKey: "review_msg_style_phrasing",
    clauseStart: true,
  },
];

/** Names whose spelling or hyphen is fixed, written canonically whatever the typed case. */
const NAMES: ReadonlyArray<{
  key?: RegExp;
  pattern: string;
  name: string;
  ruleId: RawFinding["ruleId"];
  messageKey: RawFinding["messageKey"];
}> = [
  {
    key: /nob(?:le|el)\s/giu,
    pattern: `(?<target>(?:noble|nobel)${SPACE}(?:peace|piece)${SPACE}(?:prize|price|prise))${WORD_END}`,
    name: "Nobel Peace Prize",
    ruleId: "englishPhraseCorrections",
    messageKey: "review_msg_typo",
  },
  {
    key: /goggle|googol/giu,
    pattern: `(?<target>goggle|googol)(?=${SPACE}(?:analytics|maps|slides|forms|drive|search|workspace|photos|docs|mail|calendar|sheets|chrome|cloud|play|translate|meet|earth|scholar|ads|news|books|assistant|lens|fonts)${WORD_END})`,
    name: "Google",
    ruleId: "englishPhraseCorrections",
    messageKey: "review_msg_typo",
  },
  {
    pattern: `(?<target>mercedes${SPACE}benz)${WORD_END}`,
    name: "Mercedes-Benz",
    ruleId: "englishClosedCompounds",
    messageKey: "review_msg_closed_compound",
  },
  {
    pattern: `(?<target>wordpress\\.com)${WORD_END}`,
    name: "WordPress.com",
    ruleId: "englishCanonicalCasing",
    messageKey: "review_msg_canonical_casing",
  },
];
function names(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const { key, pattern, name, ruleId, messageKey } of NAMES) {
    for (const match of key ? gatedMatches(ctx, key, pattern) : frameMatches(ctx, pattern)) {
      const [start, end] = group(match, "target");
      const typed = match.groups!.target;
      if (typed.split(/[^\p{L}]+/u).some((word) => ctx.dictionary.has(word.toLowerCase())))
        continue;
      if (typed === name) continue;
      findings.push({
        ruleId,
        messageKey,
        range: { start, end },
        alternatives: [name],
        context: { start: Math.max(0, start - 48), end: Math.min(ctx.text.length, end + 16) },
      });
    }
  }
  return findings;
}

/** "There after came a second wave": a clause-initial adverb before a verb or auxiliary. */
function thereAfter(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const match of gatedMatches(
    ctx,
    /there\s+after/giu,
    `(?<target>there${SPACE}after)${NEXT}`,
  )) {
    if (!opensClause(ctx, match.index, /\b(?:and|but|or|so|then)[ \t ]+$/i)) continue;
    const next = match.groups!.next.toLowerCase();
    const entry = englishWordInfo(next);
    const verbal =
      AUX.has(next) ||
      /^(?:often|then|again|also|only|soon|always|never)$/.test(next) ||
      (!!entry && !entry.noun && !entry.plural && hasVerbForm(next, "past", "third"));
    if (!verbal) continue;
    const found = finding(
      ctx,
      group(match, "target"),
      "englishClosedCompounds",
      "review_msg_closed_compound",
      join,
      span(match),
    );
    if (found) findings.push(found);
  }
  return findings;
}

/** A noun or adjective after a compound modifier, not a verb: "easy going uphill" stays. */
const modifierNext = (next: string) => {
  const entry = englishWordInfo(next);
  return modifiable(next) && !(entry && !entry.noun && !entry.plural && !entry.adjective);
};
const before = (ctx: DetectContext, index: number) =>
  ctx.text.slice(Math.max(0, index - 16), index);
const PREVIOUS = /(?:(\p{L}+)[ \t\u00a0]{1,8})?(\p{L}+)[ \t\u00a0]{1,8}$/u;
/** The two words before `index` on its line, nearest last: [det, prev]. */
const previous = (ctx: DetectContext, index: number) =>
  PREVIOUS.exec(ctx.text.slice(Math.max(0, index - 64), index))?.slice(1) ?? [];
const MAKEUP_LEAD =
  /(?<![\p{L}'’])(the|a|my|your|his|her|our|their|this|that)[ \t\u00a0]{1,8}(?:(\p{L}+)[ \t\u00a0]{1,8})?$/iu;
/** Compound modifiers and nouns written as two words before a noun: "an easy going person". */
const MODIFIERS: ReadonlyArray<{
  key?: RegExp;
  pattern: string;
  fix: (typed: string) => string;
  check: (ctx: DetectContext, match: RegExpExecArray) => boolean;
}> = [
  {
    key: /easy\s+going/giu,
    pattern: `(?<target>easy${SPACE}going)${NEXT}`,
    fix: hyphen,
    check: (_ctx, m) => modifierNext(m.groups!.next),
  },
  {
    // "No one handed in…" is a pronoun and a verb.
    pattern: `(?<target>(?:one|two)${SPACE}handed)${NEXT}`,
    fix: hyphen,
    check: (ctx, m) =>
      modifierNext(m.groups!.next) &&
      !/\b(?:no|every|any|each|some)[ \t ]+$/i.test(before(ctx, m.index)),
  },
  {
    // "The first person reports to…" is an ordinal phrase before its verb.
    pattern: `(?<target>(?:first|second|third)${SPACE}person)${NEXT}`,
    fix: hyphen,
    check: (ctx, m) =>
      modifierNext(m.groups!.next) &&
      !(
        hasVerbForm(m.groups!.next, "third") &&
        /\b(?:the|a|an|every|each|this|that)[ \t ]+$/i.test(before(ctx, m.index))
      ),
  },
  {
    key: /colou?red/giu,
    pattern: `(?<target>(?:rainbow|cream|flesh|straw|honey|rust|copper|bronze|olive|sand)${SPACE}colou?red)${NEXT}`,
    fix: hyphen,
    check: (_ctx, m) => modifierNext(m.groups!.next),
  },
  {
    key: /password\s+protected/giu,
    pattern: `(?<target>password${SPACE}protected)${NEXT}`,
    fix: hyphen,
    check: (_ctx, m) => modifierNext(m.groups!.next),
  },
  {
    // "your self - worth" is a spaced hyphen; "your self" alone is the pronoun. The other
    // forms ("him self", "our selves") are phrase rows.
    key: /your\s+self\b/giu,
    pattern: `(?<target>your${SPACE}self)${WORD_END}(?![ \\t\\u00a0]*[-–])`,
    fix: join,
    check: () => true,
  },
  {
    // "a ok" in lowercase or capitals; "Is plan A ok?" names an option.
    key: /\ba\s+ok/giu,
    pattern: `(?<target>a${SPACE}ok(?:ay)?)${WORD_END}`,
    fix: (typed) => (typed === typed.toUpperCase() ? "A-OK" : "a-ok"),
    check: (_ctx, m) =>
      /^(?:a[ \t\u00a0]+(?:ok|okay)|A[ \t\u00a0]+(?:OK|OKAY))$/.test(m.groups!.target),
  },
  {
    pattern: `(?<target>tomorrows)${NEXT}`,
    fix: (typed) => typed.replace(/s$/i, "'$&"),
    check: (_ctx, m) => modifierNext(m.groups!.next),
  },
  {
    // "Prices rose over time" is a phrase; "over time pay" is a noun compound.
    key: /over\s+time/giu,
    pattern: `(?<target>over${SPACE}time)${SPACE}(?:pay|wages?|hours|rates?|shifts?|claims?|approvals?|budgets?|details)${WORD_END}`,
    fix: join,
    check: (ctx, m) => !opensClause(ctx, m.index),
  },
  {
    // "Her make up looked great" is a noun; "help her make up a story" is a verb.
    key: /make\s+up/giu,
    pattern: `(?<target>make${SPACE}up)(?:${NEXT})?`,
    fix: join,
    check: (ctx, m) => {
      const lead = MAKEUP_LEAD.exec(ctx.text.slice(Math.max(0, m.index - 64), m.index));
      if (!lead) return false;
      const [, det, adj] = lead;
      const next = m.groups!.next;
      if (adj) {
        // "the players make up the team" has a plural subject before the verb.
        const entry = englishWordInfo(adj);
        if (CLOSED.has(adj.toLowerCase()) || entry?.plural) return false;
        if (entry && !entry.adjective && (entry.noun || entry.verbs.length)) return false;
        if (!entry && !/^[a-z]{4,}$/.test(adj)) return false;
      } else if (/^(?:her|that|this)$/i.test(det) && !opensClause(ctx, m.index - lead[0].length))
        return false;
      return !next || /^of$/i.test(next) || !CLOSED.has(next.toLowerCase());
    },
  },
  {
    // "a built in feature"; "It was built in Rust" stays.
    key: /built\s+in/giu,
    pattern: `(?<target>built${SPACE}in)${NEXT}(?:${SPACE}(?<then>\\p{L}+))?`,
    fix: hyphen,
    check: (ctx, m) => {
      const { next, then } = m.groups!;
      const lower = previous(ctx, m.index)[1]?.toLowerCase() ?? "";
      const slot =
        (DET.has(lower) && lower !== "that") ||
        /^(?:with|without|has|have|had|provides?|offers?|includes?|adds?|lacks?|supports?)$/.test(
          lower,
        );
      // "provides built in Rust support": a name may modify the noun.
      if (/^\p{Lu}/u.test(next)) return slot && !!then && /^\p{Ll}/u.test(then) && modifiable(then);
      return slot && modifierNext(next);
    },
  },
];
function modifiers(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const { key, pattern, fix, check } of MODIFIERS) {
    for (const match of key ? gatedMatches(ctx, key, pattern) : frameMatches(ctx, pattern)) {
      if (!check(ctx, match)) continue;
      const found = finding(
        ctx,
        group(match, "target"),
        "englishClosedCompounds",
        "review_msg_closed_compound",
        fix,
      );
      if (found) findings.push(found);
    }
  }
  return findings;
}

/** "Do I interested in music?": an adjective after "do I" needs "am I". */
function doIAdjective(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const pattern = `(?<target>do)${SPACE}I${SPACE}(?:not${SPACE})?(?<adj>\\p{L}+)${WORD_END}(?:${SPACE}(?<after>\\p{L}+))?`;
  for (const match of gatedMatches(ctx, /\bdo\s+i\b/giu, pattern)) {
    const { adj, after } = match.groups!;
    const entry = englishWordInfo(adj);
    if (!entry || entry.adverb || entry.noun || CLOSED.has(adj.toLowerCase())) continue;
    const next = after?.toLowerCase();
    // "Do I ready the boat?" is a verb; "Do I clean it?" too.
    const ok = hasVerbForm(adj, "base")
      ? entry.adjective && (next === "for" || next === "yet")
      : entry.adjective ||
        (hasVerbForm(adj, "participle") && (!next || /^(?:in|about|by|with|at|of)$/.test(next)));
    if (!ok) continue;
    const found = finding(
      ctx,
      group(match, "target"),
      "englishSentenceStructure",
      "review_msg_sentence_structure",
      cased("am"),
      span(match),
    );
    if (found) findings.push(found);
  }
  return findings;
}

/** "It time to leave": the clause needs "it's". "Give it time to heal" keeps its object. */
const IT_TIME_LEAD =
  /\b(?:if|when|whenever|once|because|since|so|and|but|now|maybe|perhaps|think|thought|guess|believe|suppose|feel|felt|say|said|know|knew|reckon|hope)[ \t ]+$/i;
function itTime(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const match of gatedMatches(
    ctx,
    /\bit\s+time\b/giu,
    `(?<target>it)${SPACE}time${SPACE}(?:to|for)${WORD_END}`,
  )) {
    if (!opensClause(ctx, match.index, IT_TIME_LEAD)) continue;
    const found = finding(
      ctx,
      group(match, "target"),
      "englishItsContext",
      "review_msg_its_contraction",
      cased("it's"),
      span(match),
    );
    if (found) findings.push(found);
  }
  return findings;
}

/** Clause-initial "ur ready?", "ya really dedicated": "you're" before a predicate adjective. */
function youArePredicate(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const pattern = `(?<target>ur|ya|yr)${SPACE}(?:(?<adverb>\\p{L}+ly)${SPACE})?(?<adj>\\p{L}+)${COMPLETE}`;
  for (const match of gatedMatches(ctx, /\b(?:ur|ya|yr)\s/giu, pattern)) {
    if (!opensClause(ctx, match.index)) continue;
    const { adverb, adj } = match.groups!;
    if (adverb && !englishWordInfo(adverb)?.adverb) continue;
    const entry = englishWordInfo(adj);
    if (!entry || CLOSED.has(adj.toLowerCase())) continue;
    // "ur barely awake": after an adverb, a verb-like adjective too.
    const predicate =
      entry.adjective ||
      (!entry.noun && (hasVerbForm(adj, "participle") || (!!adverb && hasVerbForm(adj, "base"))));
    if (!predicate) continue;
    const found = finding(
      ctx,
      group(match, "target"),
      "englishYourYouAre",
      "review_msg_your_you_are",
      cased("you're"),
      span(match),
    );
    if (found) findings.push(found);
  }
  return findings;
}

/** "a chance to to refer", "applied to to correction": a doubled "to" the core rule leaves. */
function doubledTo(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const match of gatedMatches(ctx, /\bto\s+to\b/giu, `(?<pair>to${SPACE}to)${NEXT}`, "pair")) {
    const next = match.groups!.next;
    const [det, prev = ""] = previous(ctx, match.index);
    if (!prev || /^to$/i.test(prev) || /^(?:to|list|lists)$/i.test(next)) continue;
    const nextInfo = englishWordInfo(next);
    const prevInfo = englishWordInfo(prev);
    const nounPrev =
      (!!det && DET.has(det.toLowerCase()) && !CLOSED.has(prev.toLowerCase())) ||
      (!!prevInfo && prevInfo.noun && !prevInfo.verbs.length);
    // "the team I wrote to to complain": a stranded preposition before an infinitive.
    if (hasVerbForm(next, "base")) {
      if (!nounPrev) continue;
    } else if (!(nextInfo?.noun || nextInfo?.plural || (!nextInfo && /^[a-z]{4,}$/.test(next))))
      continue;
    const found = finding(
      ctx,
      group(match, "pair"),
      "englishRepeatedWords",
      "review_msg_repeated_words",
      (typed) => typed.slice(0, 2),
      span(match),
    );
    if (found) findings.push(found);
  }
  return findings;
}

/** "there is strings…": a plural the lexicon knows after singular existential "there". */
const NOT_PLURAL_SUBJECT = wordSet(
  "news series species means lots tons loads plenty kudos physics mathematics economics politics thanks",
);
const EXISTENTIAL_LEAD = /\b(?:if|when|that|which|because|and|but|so|where|whether)[ \t ]+$/i;
function existentialPlural(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const pattern = `there${SPACE}(?<verb>is|was)${SPACE}(?<noun>\\p{L}+s)${WORD_END}(?!${SPACE}(?:of|and)${WORD_END})`;
  for (const match of gatedMatches(ctx, /there\s+(?:is|was)\s/giu, pattern, "verb")) {
    if (!opensClause(ctx, match.index, EXISTENTIAL_LEAD)) continue;
    const { verb, noun } = match.groups!;
    if (noun !== noun.toLowerCase() || NOT_PLURAL_SUBJECT.has(noun) || englishNounForms(noun))
      continue;
    const entry = englishWordInfo(noun);
    if (!entry?.plural || !entry.noun || entry.adjective) continue;
    const found = finding(
      ctx,
      group(match, "verb"),
      "englishExistentialAgreement",
      "review_msg_existential_agreement",
      cased(/^is$/i.test(verb) ? "are" : "were"),
      span(match),
    );
    if (found) findings.push(found);
  }
  return findings;
}

/**
 * "Please provide reproducible example": a request verb, a modifier and a
 * countable issue-report noun with no article.
 */
const ARTICLE_PATTERN = `(?<=(?<![\\p{L}'’])(?:please|you|we|i|they|to|should|can|could|will|would|must)${SPACE})(?:provide|send|share|attach|submit|create|file|give|add|include|post|write|get|need|want|reproduce)${SPACE}(?<target>(?:more${SPACE})?(?<adj>\\p{L}+)${SPACE}(?:example|reproduction|repro|test${SPACE}case|bug${SPACE}report|report|summary|ticket|scenario|explanation|fix|update|screenshot|log|note|comment|feature|solution|answer|response|change|patch|description))(?=[ \\t\\u00a0]{0,8}(?:[.!?,;:]|$)|${SPACE}(?:of|for|about|in|on)${WORD_END})`;
const ARTICLE_KEY =
  /(?:provide|send|share|attach|submit|create|file|give|add|include|post|write|get|need|want|reproduce)\s/giu;
const NOT_MODIFIER = wordSet("more most less least much many few enough further other same own");
function missingArticle(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const match of gatedMatches(ctx, ARTICLE_KEY, ARTICLE_PATTERN)) {
    const adj = match.groups!.adj.toLowerCase();
    if (CLOSED.has(adj) || NOT_MODIFIER.has(adj)) continue;
    const entry = englishWordInfo(adj);
    // A modifier: an adjective, a participle, or an unlisted "-ible/-able" form.
    const flagged = entry && (entry.noun || entry.adjective || entry.adverb || entry.verbs.length);
    const modifier = flagged
      ? (entry.adjective || hasVerbForm(adj, "participle")) && !entry.plural
      : /(?:ible|able)$/.test(adj);
    if (!modifier) continue;
    const [start] = group(match, "target");
    if (hasUserOrCasedWord(ctx, match[0])) continue;
    const first = /^\p{L}+/u.exec(match.groups!.target)![0];
    const sound = englishInitialSound(first);
    if (sound === "either") continue;
    const article = sound === "vowel" ? "an" : "a";
    findings.push({
      ruleId: "englishSentenceStructure",
      messageKey: "review_msg_sentence_structure",
      range: { start, end: start + first.length },
      alternatives: [`${article} ${first}`],
      context: { start: Math.max(0, match.index - 48), end: match.index + match[0].length },
    });
  }
  return findings;
}

/** ", including, but not limited to, …": the phrase is set off on both sides. */
const LIMITED = new RegExp(
  `(?<=\\p{L})(?<lead>,?${SPACE})including(?<c1>,?)${SPACE}but${SPACE}not${SPACE}limited${SPACE}to(?<c2>,?)(?=${SPACE}\\p{L})`,
  "gidu",
);
function includingButNotLimited(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const match of gatedMatches(ctx, /limited\s+to/giu, LIMITED, (m) => m.index)) {
    const { lead, c1, c2 } = match.groups!;
    if (lead.startsWith(",") && c1 && c2) continue;
    const [start, end] = span(match);
    if (hasUserOrCasedWord(ctx, match[0])) continue;
    findings.push({
      ruleId: "stylePhrasing",
      messageKey: "review_msg_style_phrasing",
      range: { start, end },
      alternatives: [", including, but not limited to,"],
      context: { start: Math.max(0, start - 48), end: Math.min(ctx.text.length, end + 16) },
    });
  }
  return findings;
}

/** "°K" opening the text; the measurement rule covers it after a number or a space. */
function kelvinAtStart(ctx: DetectContext): RawFinding[] {
  if (ctx.from > 0 || !/^°K(?![\p{L}\p{N}_])/u.test(ctx.text)) return [];
  return [
    {
      ruleId: "measurementUnitFormatting",
      messageKey: "review_msg_kelvin_degree",
      range: { start: 0, end: 2 },
      alternatives: ["K"],
      context: { start: 0, end: 2 },
    },
  ];
}

const ENGLISH_DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: ["englishSentenceStructure"],
    detect: (ctx) => [
      ...templates(ctx, SENTENCE_TEMPLATES, "englishSentenceStructure"),
      ...doIAdjective(ctx),
      ...missingArticle(ctx),
    ],
  },
  {
    rules: ["englishPhraseCorrections", "englishClosedCompounds", "englishCanonicalCasing"],
    detect: (ctx) => [
      ...templates(ctx, PHRASE_TEMPLATES, "englishPhraseCorrections"),
      ...templates(ctx, COMPOUND_TEMPLATES, "englishClosedCompounds"),
      ...names(ctx),
      ...thereAfter(ctx),
      ...modifiers(ctx),
    ],
  },
  {
    rules: ["englishUsagePhrases"],
    detect: (ctx) => templates(ctx, DOUBLE_NEGATIVE, "englishUsagePhrases"),
  },
  { rules: ["englishItsContext"], detect: itTime },
  { rules: ["englishYourYouAre"], detect: youArePredicate },
  { rules: ["englishRepeatedWords"], detect: doubledTo },
  { rules: ["englishExistentialAgreement"], detect: existentialPlural },
  {
    rules: ["stylePhrasing"],
    detect: (ctx) => [
      ...templates(ctx, STYLE_TEMPLATES, "stylePhrasing"),
      ...includingButNotLimited(ctx),
    ],
  },
];

/** Context detectors appended to REVIEW_DETECTORS. */
export const DETECTORS: readonly ReviewDetectorEntry[] = [
  ...ENGLISH_DETECTORS.map(({ rules, detect }): ReviewDetectorEntry => ({
    rules,
    detect: (ctx) => (ctx.lang !== "en_US" ? [] : detect(ctx)),
  })),
  // The "°K" check applies to all languages.
  { rules: ["measurementUnitFormatting"], detect: kelvinAtStart },
];
