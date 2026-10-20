import { englishInitialSound } from "../../implementations/helpers/EnglishInitialSound";
import { englishWordInfo, hasVerbForm } from "../../implementations/helpers/EnglishLexicon";
import { englishNounForms } from "../../implementations/helpers/EnglishNounNumber";
import {
  applyWordCase,
  detectWordCase,
  wordSet,
} from "../../implementations/helpers/GenericRuleShared";
import { before, group, hasUserOrCasedWord } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import type { MatchFixer } from "../../engine/reviewRules";
import { finding } from "../finding";

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
export function opensClause(ctx: DetectContext, index: number, also?: RegExp): boolean {
  const before = ctx.text.slice(Math.max(0, index - 48), index);
  return /(?:^|[.!?;:(\n"“][ \t ]*)$/.test(before) || (also?.test(before) ?? false);
}
/**
 * A finding for [start, end) whose replacement keeps the typed letters' case:
 * `fix` rewrites the typed text ("Two Handed" -> "Two-Handed"). Names and user words abstain.
 */
function casedFinding(
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
  return finding(ruleId, messageKey, start, end, [fixed], {
    context: {
      start: Math.max(0, evidence[0] - 48),
      end: Math.min(ctx.text.length, evidence[1] + 16),
    },
  });
}
const cased = (replacement: string) => (typed: string) =>
  applyWordCase(replacement, detectWordCase(typed));
const hyphen = (typed: string) => typed.replace(/[ \t ]+/, "-");
const join = (typed: string) => typed.replace(/[ \t ]+/, "");

/** A name whose spelling or hyphen is fixed, written canonically whatever the typed case. */
const canonicalName =
  (name: string): MatchFixer =>
  (m, ctx, frame) => {
    const [start, end] = group(m, "target");
    const typed = m.groups!.target;
    if (typed.split(/[^\p{L}]+/u).some((word) => ctx.dictionary.has(word.toLowerCase())))
      return null;
    if (typed === name) return null;
    return finding(frame.ruleId, frame.messageKey, start, end, [name], {
      context: { start: Math.max(0, start - 48), end: Math.min(ctx.text.length, end + 16) },
    });
  };

const PREVIOUS = /(?:(\p{L}+)[ \t ]{1,8})?(\p{L}+)[ \t ]{1,8}$/u;
/** The two words before `index` on its line, nearest last: [det, prev]. */
const previous = (ctx: DetectContext, index: number) =>
  PREVIOUS.exec(ctx.text.slice(Math.max(0, index - 64), index))?.slice(1) ?? [];
const MAKEUP_LEAD =
  /(?<![\p{L}'’])(the|a|my|your|his|her|our|their|this|that)[ \t ]{1,8}(?:(\p{L}+)[ \t ]{1,8})?$/iu;
/** A compound modifier or noun written as two words before a noun: "an easy going person". */
const compound =
  (
    check: (ctx: DetectContext, m: RegExpExecArray) => boolean,
    fix: (typed: string) => string,
  ): MatchFixer =>
  (m, ctx) =>
    check(ctx, m)
      ? casedFinding(
          ctx,
          group(m, "target"),
          "englishClosedCompounds",
          "review_msg_closed_compound",
          fix,
        )
      : null;
const beforeNoun = (_ctx: DetectContext, m: RegExpExecArray) => modifiable(m.groups!.next);

/** "It time to leave": the clause needs "it's". "Give it time to heal" keeps its object. */
const IT_TIME_LEAD =
  /\b(?:if|when|whenever|once|because|since|so|and|but|now|maybe|perhaps|think|thought|guess|believe|suppose|feel|felt|say|said|know|knew|reckon|hope)[ \t ]+$/i;

/** "there is strings…": a plural the lexicon knows after singular existential "there". */
const NOT_PLURAL_SUBJECT = wordSet(
  "news series species means lots tons loads plenty kudos physics mathematics economics politics thanks " +
    "sometimes afterwards nowadays besides overseas upstairs downstairs indoors outdoors",
);
const EXISTENTIAL_LEAD = /\b(?:if|when|that|which|because|and|but|so|where|whether)[ \t ]+$/i;

const NOT_MODIFIER = wordSet("more most less least much many few enough further other same own");

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  /** "Do I interested in music?": an adjective after "do I" needs "am I". */
  doIAdjective: (m, ctx) => {
    const { adj, after } = m.groups!;
    const entry = englishWordInfo(adj);
    if (!entry || entry.adverb || entry.noun || CLOSED.has(adj.toLowerCase())) return null;
    const next = after?.toLowerCase();
    // "Do I ready the boat?" is a verb; "Do I clean it?" too.
    const ok = hasVerbForm(adj, "base")
      ? entry.adjective && (next === "for" || next === "yet")
      : entry.adjective ||
        (hasVerbForm(adj, "participle") && (!next || /^(?:in|about|by|with|at|of)$/.test(next)));
    if (!ok) return null;
    return casedFinding(
      ctx,
      group(m, "target"),
      "englishSentenceStructure",
      "review_msg_sentence_structure",
      cased("am"),
      span(m),
    );
  },
  /**
   * "Please provide reproducible example": a request verb, a modifier and a
   * countable issue-report noun with no article.
   */
  missingArticle: (m, ctx) => {
    const adj = m.groups!.adj.toLowerCase();
    if (CLOSED.has(adj) || NOT_MODIFIER.has(adj)) return null;
    const entry = englishWordInfo(adj);
    // A modifier: an adjective, a participle, or an unlisted "-ible/-able" form.
    const flagged = entry && (entry.noun || entry.adjective || entry.adverb || entry.verbs.length);
    const modifier = flagged
      ? (entry.adjective || hasVerbForm(adj, "participle")) && !entry.plural
      : /(?:ible|able)$/.test(adj);
    if (!modifier) return null;
    const [start] = group(m, "target");
    if (hasUserOrCasedWord(ctx, m[0])) return null;
    const first = /^\p{L}+/u.exec(m.groups!.target)![0];
    const sound = englishInitialSound(first);
    if (sound === "either") return null;
    const article = sound === "vowel" ? "an" : "a";
    return {
      ruleId: "englishSentenceStructure",
      messageKey: "review_msg_sentence_structure",
      range: { start, end: start + first.length },
      alternatives: [`${article} ${first}`],
      context: { start: Math.max(0, m.index - 48), end: m.index + m[0].length },
    };
  },
  nobelPeacePrize: canonicalName("Nobel Peace Prize"),
  googleName: canonicalName("Google"),
  mercedesBenz: canonicalName("Mercedes-Benz"),
  wordPressCom: canonicalName("WordPress.com"),
  /** "There after came a second wave": a clause-initial adverb before a verb or auxiliary. */
  thereAfter: (m, ctx) => {
    if (!opensClause(ctx, m.index, /\b(?:and|but|or|so|then)[ \t ]+$/i)) return null;
    const next = m.groups!.next.toLowerCase();
    const entry = englishWordInfo(next);
    const verbal =
      AUX.has(next) ||
      /^(?:often|then|again|also|only|soon|always|never)$/.test(next) ||
      (!!entry && !entry.noun && !entry.plural && hasVerbForm(next, "past", "third"));
    if (!verbal) return null;
    return casedFinding(
      ctx,
      group(m, "target"),
      "englishClosedCompounds",
      "review_msg_closed_compound",
      join,
      span(m),
    );
  },
  easyGoing: compound(beforeNoun, hyphen),
  oneHanded: compound(
    (ctx, m) =>
      modifiable(m.groups!.next) &&
      !/\b(?:no|every|any|each|some)[ \t ]+$/i.test(before(ctx, m.index, 16)),
    hyphen,
  ),
  firstPerson: compound(
    (ctx, m) =>
      modifiable(m.groups!.next) &&
      !(
        hasVerbForm(m.groups!.next, "third") &&
        /\b(?:the|a|an|every|each|this|that)[ \t ]+$/i.test(before(ctx, m.index, 16))
      ),
    hyphen,
  ),
  colouredCompound: compound(beforeNoun, hyphen),
  passwordProtected: compound(beforeNoun, hyphen),
  yourSelf: compound(() => true, join),
  aOk: compound(
    (_ctx, m) => /^(?:a[ \t ]+(?:ok|okay)|A[ \t ]+(?:OK|OKAY))$/.test(m.groups!.target),
    (typed) => (typed === typed.toUpperCase() ? "A-OK" : "a-ok"),
  ),
  tomorrowsNoun: compound(beforeNoun, (typed) => typed.replace(/s$/i, "'$&")),
  overTime: compound((ctx, m) => !opensClause(ctx, m.index), join),
  makeUp: compound((ctx, m) => {
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
  }, join),
  builtIn: compound((ctx, m) => {
    const { next, then } = m.groups!;
    const lower = previous(ctx, m.index)[1]?.toLowerCase() ?? "";
    const slot =
      (DET.has(lower) && lower !== "that") ||
      /^(?:with|without|has|have|had|provides?|offers?|includes?|adds?|lacks?|supports?)$/.test(
        lower,
      );
    // "provides built in Rust support": a name may modify the noun.
    if (/^\p{Lu}/u.test(next)) return slot && !!then && /^\p{Ll}/u.test(then) && modifiable(then);
    return slot && modifiable(next);
  }, hyphen),
  itTime: (m, ctx) =>
    opensClause(ctx, m.index, IT_TIME_LEAD)
      ? casedFinding(
          ctx,
          group(m, "target"),
          "englishItsContext",
          "review_msg_its_contraction",
          cased("it's"),
          span(m),
        )
      : null,
  /** Clause-initial "ur ready?", "ya really dedicated": "you're" before a predicate adjective. */
  youArePredicate: (m, ctx) => {
    if (!opensClause(ctx, m.index)) return null;
    const { adverb, adj } = m.groups!;
    if (adverb && !englishWordInfo(adverb)?.adverb) return null;
    const entry = englishWordInfo(adj);
    if (!entry || CLOSED.has(adj.toLowerCase())) return null;
    // "ur barely awake": after an adverb, a verb-like adjective too.
    const predicate =
      entry.adjective ||
      (!entry.noun && (hasVerbForm(adj, "participle") || (!!adverb && hasVerbForm(adj, "base"))));
    if (!predicate) return null;
    return casedFinding(
      ctx,
      group(m, "target"),
      "englishYourYouAre",
      "review_msg_your_you_are",
      cased("you're"),
      span(m),
    );
  },
  /** "a chance to to refer", "applied to to correction": a doubled "to" the core rule leaves. */
  doubledTo: (m, ctx) => {
    const next = m.groups!.next;
    const [det, prev = ""] = previous(ctx, m.index);
    if (!prev || /^to$/i.test(prev) || /^(?:to|list|lists)$/i.test(next)) return null;
    const nextInfo = englishWordInfo(next);
    const prevInfo = englishWordInfo(prev);
    const nounPrev =
      (!!det && DET.has(det.toLowerCase()) && !CLOSED.has(prev.toLowerCase())) ||
      (!!prevInfo && prevInfo.noun && !prevInfo.verbs.length);
    // "the team I wrote to to complain": a stranded preposition before an infinitive.
    if (hasVerbForm(next, "base")) {
      if (!nounPrev) return null;
    } else if (!(nextInfo?.noun || nextInfo?.plural || (!nextInfo && /^[a-z]{4,}$/.test(next))))
      return null;
    return casedFinding(
      ctx,
      group(m, "pair"),
      "englishRepeatedWords",
      "review_msg_repeated_words",
      (typed) => typed.slice(0, 2),
      span(m),
    );
  },
  existentialPlural: (m, ctx) => {
    if (!opensClause(ctx, m.index, EXISTENTIAL_LEAD)) return null;
    const { verb, noun } = m.groups!;
    if (noun !== noun.toLowerCase() || NOT_PLURAL_SUBJECT.has(noun) || englishNounForms(noun))
      return null;
    const entry = englishWordInfo(noun);
    if (!entry?.plural || !entry.noun || entry.adjective) return null;
    return casedFinding(
      ctx,
      group(m, "verb"),
      "englishExistentialAgreement",
      "review_msg_existential_agreement",
      cased(/^is$/i.test(verb) ? "are" : "were"),
      span(m),
    );
  },
  /** ", including, but not limited to, …": the phrase is set off on both sides. */
  includingButNotLimited: (m, ctx) => {
    if (m.index < ctx.from || m.index >= ctx.to) return null;
    const { lead, c1, c2 } = m.groups!;
    if (lead.startsWith(",") && c1 && c2) return null;
    const [start, end] = span(m);
    if (hasUserOrCasedWord(ctx, m[0])) return null;
    return {
      ruleId: "stylePhrasing",
      messageKey: "review_msg_style_phrasing",
      range: { start, end },
      alternatives: [", including, but not limited to,"],
      context: { start: Math.max(0, start - 48), end: Math.min(ctx.text.length, end + 16) },
    };
  },
} satisfies Record<string, MatchFixer>;
