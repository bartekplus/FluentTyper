import { englishInitialSound } from "../../implementations/helpers/EnglishInitialSound";
import { ENGLISH_MASS_NOUNS } from "../../implementations/helpers/EnglishCountability";
import { englishCountNoun, englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import { FUNCTION_WORDS } from "./slotWords";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import type { Fixer, FindingsFilter } from "../../engine/reviewRules";
import { quotedMention } from "./grammarStyle1";
import { finding } from "../finding";

// "the" where English requires it: place names that carry it ("in Netherlands", "on Solomon
// Islands", "in Gulf of Mexico") and a superlative before its noun ("is hottest city"); "a"
// in quantity phrases ("in lot of cases", "have bunch of").

// The words of a name that are themselves an article or a title: "in The Hague", "to Isle".
const NOT_PLACE_WORDS = /^(?:The|A|An|My|Our|This|That|New|Old)\b/;

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

// Count nouns with no mass or set-phrase use ("by mistake", "in person", "for example",
// "in life" and "at school" leave theirs out).
const COUNT_NOUNS = new Set(
  (
    "friend problem answer question airport river kitchen lobby brother sister soldier job " +
    "apartment garden bridge station restaurant village neighbor neighbour doctor lawyer " +
    "nurse driver singer colleague boss cousin uncle aunt chair bag computer laptop camera " +
    "dog cat horse bird flower song movie photo envelope umbrella wallet idea suggestion " +
    "decision hotel ticket"
  ).split(" "),
);
// After a preposition: "in answer to", "in question", "on hand".
const BARE_AFTER_PREPOSITION = /^(?:answer|question|job)$/;
const countNoun = (word: string) => COUNT_NOUNS.has(word);
// After be and an adjective, also a noun the n-grams show mostly counted ("is great golfer").
const describedCount = (adj: string | undefined, word: string) =>
  !!adj && englishCountNoun(word) && !ENGLISH_MASS_NOUNS.has(word);
const article = (word: string) => (englishInitialSound(word) === "vowel" ? "an" : "a");
/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  // "He is good friend.", "It was extremely difficult problem": be before a bare count noun.
  articlesVery: (m) => bareCount(m.groups!.target, m.groups!.adj, m.groups!.noun, false, true),
  // "waiting at airport", "about good friend": a preposition before a bare count noun.
  articlesAdj: (m) => bareCount(m.groups!.target, m.groups!.adj, m.groups!.noun, true),
  // "I have experienced problem", "He takes brother with him": an object count noun.
  articlesAdj2: (m) => bareCount(m.groups!.target, m.groups!.adj, m.groups!.noun, false),
  // "such good friend": such takes a.
  articlesSuch: (m) => {
    const { adj, noun } = m.groups!;
    if (!countNoun(noun) || (adj && !adjectiveOnly(adj))) return null;
    return `such ${article(adj ?? noun)}`;
  },
  articlesGeographic: (m, ctx) => {
    const { prep, name } = m.groups!;
    // The frame ignores case: a name is capitalized, the preposition is not a title word.
    if (!/^[A-Z]/.test(name) || /^[A-Z]/.test(prep) || NOT_PLACE_WORDS.test(name)) return null;
    // "the Black Sea ports" already has one; "Pacific Ocean Drive" is a street.
    const after = ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 24);
    // "on United States television": the name modifies a noun; "United States v. Lee": a case.
    const next = /^[ \t]+([a-z]+)/.exec(after)?.[1];
    if (/^[ \t]+vs?\./.test(after) || (next && isPlainNoun(next))) return null;
    if (/^[ \t ]+(?:Drive|Road|Street|Avenue|Hotel|Company|Inc|Ltd|Corp)\b/.test(after))
      return null;
    const [start, end] = m.indices!.groups!.name;
    return finding("englishPhraseCorrections", "review_msg_geographic_the", start, end, [
      `the ${name}`,
    ]);
  },
  articlesSuperlative: (m, ctx) => {
    const { adj, noun } = m.groups!;
    if (NOT_NOUNS.has(noun) || EST_WORDS.has(adj)) return null;
    if (ARTICLELESS.has(`${adj.toLowerCase()} ${noun.toLowerCase()}`)) return null;
    const adjRead = englishWordInfo(adj);
    if (!NOT_SUPERLATIVES.has(adj) && !adjRead?.adjective && !/(?:est)$/.test(adj)) return null;
    // "-est" words that are no superlative: "interest", "honest", "forest", "modest".
    if (/est$/.test(adj) && !NOT_SUPERLATIVES.has(adj)) {
      const base = adj
        .replace(/(?:iest)$/, "y")
        .replace(/([a-z])\1est$/, "$1")
        .replace(/e?st$/, "");
      if (!englishWordInfo(base)?.adjective && !englishWordInfo(`${base}e`)?.adjective) return null;
    }
    const read = englishWordInfo(noun);
    if (!read?.noun || read.adjective || read.adverb) return null;
    if (read.verbs.some((v) => v.form === "participle" || v.form === "past" || v.form === "ing"))
      return null;
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
      return null;
    const [start, end] = m.indices!.groups!.adj;
    return finding("englishPhraseCorrections", "review_msg_superlative_the", start, end, [
      `the ${adj}`,
    ]);
  },
} satisfies Record<string, Fixer>;

/** An adjective or -ed participle modifier ("good", "experienced"), never a closed word. */
function adjectiveOnly(word: string): boolean {
  if (FUNCTION_WORDS.has(word) || /^(?:no|such|same|own|one|last|next|first)$/.test(word))
    return false;
  const read = englishWordInfo(word);
  return !!read && (read.adjective || /ed$/.test(word)) && !read.adverb && !read.plural;
}

/** "a"/"the" before a bare singular count noun (and its modifiers), or null. */
function bareCount(
  target: string,
  adj: string | undefined,
  noun: string,
  phrase: boolean,
  described = false,
) {
  const counted = countNoun(noun) || (described && describedCount(adj, noun));
  if (!counted || (phrase && BARE_AFTER_PREPOSITION.test(noun))) return null;
  if (adj && !adjectiveOnly(adj)) return null;
  return [`${article(target)} ${target}`, `the ${target}`];
}

/** The findings filters of grammar/rules/en.yaml (`filter:`). */
export const FILTERS = {
  // A quoted mention ("the word 'unicorn'") is named, not used.
  missingArticle: (ctx: DetectContext, findings: RawFinding[]) =>
    findings.filter((f) => !quotedMention(ctx, f)),
} satisfies Record<string, FindingsFilter>;
