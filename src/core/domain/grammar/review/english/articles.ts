import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { PhraseRow } from "../englishPhraseTables";
import { frameMatches, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { quotedMention } from "./grammarStyle1";

// "the" where English requires it: place names that carry it ("in Netherlands", "on Solomon
// Islands", "in Gulf of Mexico") and a superlative before its noun ("is hottest city"); "a"
// in quantity phrases ("in lot of cases", "have bunch of").

const S = SPACE;
const E = WORD_END;

const QUANTITY_LEADS = [
  "in",
  "have",
  "has",
  "had",
  "got",
  "with",
  "for",
  "are",
  "is",
  "was",
  "were",
  "take",
  "takes",
  "took",
  "spent",
  "received",
  "made",
];

/** Rows for englishPhraseCorrections, englishClosedCompounds and stylePhrasing. */
export const PHRASES: readonly PhraseRow[] = [
  ...QUANTITY_LEADS.flatMap((lead): PhraseRow[] => [
    [`${lead} lot of`, `${lead} a lot of`],
    [`${lead} bunch of`, `${lead} a bunch of`],
    [`${lead} couple of`, `${lead} a couple of`],
    [`${lead} whole bunch of`, `${lead} a whole bunch of`],
    [`${lead} majority of`, `${lead} the majority of`],
    [`${lead} vast majority of`, `${lead} the vast majority of`],
  ]),
];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

type Finding = RawFinding;

// Names that take "the": plural countries, republics and unions, regions, and bodies of water,
// ranges, islands, deserts and canals named by their kind.
const THE_NAMES =
  "Netherlands|Philippines|Bahamas|Maldives|Seychelles|Comoros|United States|United Kingdom|" +
  "United Arab Emirates|Czech Republic|Dominican Republic|Central African Republic|" +
  "Middle East|Far East|Near East|North Pole|South Pole|Himalayas|Alps|Andes|Pyrenees|" +
  "Balkans|Rockies|Isle of Man|Ivory Coast|Sahara|Gobi|Kalahari|Tropic of Cancer|" +
  "Tropic of Capricorn|Gulf of [A-Z][a-z]+|Bay of [A-Z][a-z]+|Strait of [A-Z][a-z]+|" +
  "(?:[A-Z][a-z]+ ){1,3}(?:Islands|Mountains|Sea|Ocean|River|Canal|Desert|desert|Peninsula)";
const PLACE = `(?<prep>in|on|to|from|across|near|into|through|over|off|around|visit|visited|visiting|cross|crossed|crossing)${S}(?<name>${THE_NAMES})${E}`;
// The words of a name that are themselves an article or a title: "in The Hague", "to Isle".
const NOT_PLACE_WORDS = /^(?:The|A|An|My|Our|This|That|New|Old)\b/;

function geographicThe(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  for (const m of frameMatches(ctx, PLACE, "name")) {
    const { prep, name } = m.groups!;
    // The frame ignores case: a name is capitalized, the preposition is not a title word.
    if (!/^[A-Z]/.test(name) || /^[A-Z]/.test(prep) || NOT_PLACE_WORDS.test(name)) continue;
    // "the Black Sea ports" already has one; "Pacific Ocean Drive" is a street.
    const after = ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 24);
    // "on United States television": the name modifies a noun; "United States v. Lee": a case.
    const next = /^[ \t]+([a-z]+)/.exec(after)?.[1];
    if (/^[ \t]+vs?\./.test(after) || (next && isPlainNoun(next))) continue;
    if (/^[ \t ]+(?:Drive|Road|Street|Avenue|Hotel|Company|Inc|Ltd|Corp)\b/.test(after)) continue;
    const [start, end] = m.indices!.groups!.name;
    findings.push({
      ruleId: "englishPhraseCorrections",
      messageKey: "review_msg_geographic_the",
      range: { start, end },
      alternatives: [`the ${name}`],
    });
  }
  return findings;
}

// "is hottest city", "are best workers": a superlative before its noun takes "the".
const SUPERLATIVE = `(?<be>is|are|was|were|be|'s|'re|’s|’re)(?<gap>${S})(?<adj>[a-z]+est|best|worst|least)${S}(?<noun>[a-z]+)${E}`;
const NOT_SUPERLATIVES = new Set("best worst".split(" "));
const EST_WORDS = new Set(
  "honest modest earnest forest interest manifest request guest chest west nest test protest contest digest arrest harvest invest suggest".split(
    " ",
  ),
);
const NOT_NOUNS = new Set(
  (
    "friends friend known able suited placed left used the a an to of in on at for and or but " +
    "than if when so as that because while since though then here there now today ever yet too also"
  ).split(" "),
);
/** A noun that is no verb or function word: the head of a compound ("neighbor methods"). */
const isPlainNoun = (word: string) => {
  const read = englishWordInfo(word);
  return !!read?.noun && !read.verbs.length && !NOT_NOUNS.has(word);
};

// Set phrases that take no article: "It is best practice to…", "He was best man", "worst
// case", "the path of least resistance".
const ARTICLELESS = new Set(
  (
    "best practice|best practices|best man|best friends|best effort|best case|best seller|" +
    "best sellers|worst case|least resistance|best value|best interest|best interests"
  ).split("|"),
);

function superlativeThe(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  for (const m of frameMatches(ctx, SUPERLATIVE, "adj")) {
    const { adj, noun } = m.groups!;
    if (NOT_NOUNS.has(noun) || EST_WORDS.has(adj)) continue;
    if (ARTICLELESS.has(`${adj.toLowerCase()} ${noun.toLowerCase()}`)) continue;
    const adjRead = englishWordInfo(adj);
    if (!NOT_SUPERLATIVES.has(adj) && !adjRead?.adjective && !/(?:est)$/.test(adj)) continue;
    // "-est" words that are no superlative: "interest", "honest", "forest", "modest".
    if (/est$/.test(adj) && !NOT_SUPERLATIVES.has(adj)) {
      const base = adj
        .replace(/(?:iest)$/, "y")
        .replace(/([a-z])\1est$/, "$1")
        .replace(/e?st$/, "");
      if (!englishWordInfo(base)?.adjective && !englishWordInfo(`${base}e`)?.adjective) continue;
    }
    const read = englishWordInfo(noun);
    if (!read?.noun || read.adjective || read.adverb) continue;
    if (read.verbs.some((v) => v.form === "participle" || v.form === "past" || v.form === "ing"))
      continue;
    // "nearest neighbor methods": a compound noun, often a term.
    const end0 = m.index + m[0].length;
    const following = /^[ \t]+([a-z]+)/.exec(ctx.text.slice(end0, end0 + 24))?.[1];
    const followingRead = following ? englishWordInfo(following) : null;
    // An unknown word after it may be the compound's head too: stay silent.
    if (
      following &&
      !NOT_NOUNS.has(following) &&
      (followingRead ? followingRead.noun : following.length > 3)
    )
      continue;
    const [start, end] = m.indices!.groups!.adj;
    findings.push({
      ruleId: "englishPhraseCorrections",
      messageKey: "review_msg_superlative_the",
      range: { start, end },
      alternatives: [`the ${adj}`],
    });
  }
  return findings;
}

/** English only; findings inside a quoted or parenthesized example are dropped. */
const english =
  (...detectors: ((ctx: DetectContext) => Finding[])[]) =>
  (ctx: DetectContext): Finding[] =>
    ctx.lang !== "en_US"
      ? []
      : detectors.flatMap((detect) => detect(ctx)).filter((f) => !quotedMention(ctx, f));

/** Context detectors appended to REVIEW_DETECTORS. */
export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["englishPhraseCorrections"], detect: english(geographicThe, superlativeThe) },
];
