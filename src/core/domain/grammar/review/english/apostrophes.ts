import {
  englishLexiconInflect,
  englishNounPair,
  englishWordInfo,
} from "../../implementations/helpers/EnglishLexicon";
import { memoize } from "../../implementations/helpers/GenericRuleShared";
import { wordSet as words } from "../phraseTemplates";
import type { DetectContext } from "../reviewDetectors";
import type { MatchFixer } from "../../engine/reviewRules";
import { finding } from "../finding";

// Apostrophes in the wrong place: a plural written with 's ("two CD's"), a verb with one ("he
// see's"), a doubled or spaced apostrophe ("we''ll", "I' m"), a possessive left without one
// ("last weeks meeting", "other's ideas"), and "who's" where "whose" owns the next noun.

const infoOf = memoize(englishWordInfo, 20_000);
const info = (word: string) => infoOf(word.toLowerCase());
const context = (ctx: DetectContext, start: number, end: number) => ({
  start: Math.max(0, start - 96),
  end: Math.min(ctx.text.length, end + 40),
});
/** The next word (lowercased) after `end`, "" at punctuation or the end, null after a symbol. */
function nextWord(ctx: DetectContext, end: number): string | null {
  const after = ctx.text.slice(end, end + 40);
  if (/^[ \t ]*(?:[.!?,;:)\]"”…]|$|\n)/.test(after)) return "";
  const word = /^[ \t ]+([A-Za-z]+(?:['’][a-z]+)?)/.exec(after);
  return word ? word[1].toLowerCase().replaceAll("’", "'") : null;
}
/** The previous word (lowercased) before `start`, "" at a clause start. */
function previousWord(ctx: DetectContext, start: number): string {
  const before = ctx.text.slice(Math.max(0, start - 40), start);
  if (/(?:^|[.!?;:"“(\n])[ \t ]*$/.test(before)) return "";
  return /([A-Za-z]+(?:['’][a-z]+)?)[ \t ]+$/.exec(before)?.[1].toLowerCase() ?? "?";
}

// Words after which a plural noun ends its phrase: a verb, a relative, a preposition...
const PHRASE_ENDS = words(
  "that who which whom whose and or but nor are were have had has will would can could should " +
    "may might must do did don't didn't aren't weren't haven't won't can't couldn't wouldn't to in " +
    "on at for with from of by into onto about over under ago later before after so as than i you " +
    "we they he she it me him them us there here then now too also all both each still just already " +
    "is was isn't wasn't need needed seem seemed look looked go went come came get got out",
);
// Plurals that are not a singular + s, and nouns whose 's is a common possessive or contraction.
const NOT_PLURALS = words(
  "people men women children folk police staff cattle personnel data media alumni everyone " +
    "someone anyone nobody everybody somebody anybody one's let it what that who there here",
);
const COUNT_WORDS = words("two three four five six seven eight nine ten twelve twenty hundred");
// Capitalized words before a count that are no label: "The 3 SMEs", "All 5 CEOs".
const LABEL_FREE = words(
  "the a an all these those some over about only nearly almost around with for in at by of and or",
);

/** The plural of a noun typed with 's ("CD's" -> "CDs", "reply's" -> "replies"), or null. */
function pluralOf(word: string): string | null {
  if (/^[A-Z][A-Z&]*[A-Z]$/.test(word)) return `${word}s`;
  if (!/^[a-z]{2,}$/.test(word) || NOT_PLURALS.has(word)) return null;
  if (word === "one" || word === "other") return `${word}s`;
  const pair = englishNounPair(word);
  if (pair) return pair.singular === word ? pair.plural : null;
  // Derived nouns ("teacher", from teach + -er) carry no plural flag of their own.
  if (!info(word)?.noun || info(word)!.plural) return null;
  const plural = /(?:[sxz]|[cs]h)$/.test(word)
    ? `${word}es`
    : /[^aeiou]y$/.test(word)
      ? `${word.slice(0, -1)}ies`
      : `${word}s`;
  if (info(plural)?.plural) return plural;
  // "tech" -> "techs" (a hard "ch"); a plain -s plural the lexicon leaves out still counts.
  if (info(`${word}s`)) return `${word}s`;
  // "ex" -> "exes", "bus" -> "buses": a listed noun takes its regular plural.
  return plural;
}

const BARE_SUBJECT_BEFORE = words(
  // Not after "and"/"or": "the plum and peach's are shorter" leaves the owned noun out.
  "most all some many where when if because think thought believe guess so why how whether " +
    "while unless",
);

const OBJECT_SLOT = words(
  "about of to in on for with from at by into among between are were is was all any none many " +
    "some most each see saw like read fix fixed tested check checked",
);
const CLAUSE_VERB = words(
  "had have has did do does was were is are will would can could made make got get use used " +
    "tested wrote write need needed want wanted know knew see saw found find don't didn't doesn't " +
    "can't won't haven't hasn't",
);

const AFTER_VERB = words(
  "to the a an my your his her our their its this that these those it him them me us you all " +
    "over up out on off in into for with about back away down not too so very like well really " +
    "just quite much more less",
);
const IRREGULAR_THIRD = new Map([
  ["be", "is"],
  ["doe", "does"],
  ["do", "does"],
  ["go", "goes"],
  ["have", "has"],
]);

const ENDINGS: Record<string, string> = {
  i: "m ve ll d",
  you: "re ve ll d",
  we: "re ve ll d",
  they: "re ve ll d",
  he: "s ll d",
  she: "s ll d",
  it: "s ll d",
};

const OWNER_DETERMINERS = words(
  "each one the an any every no some this that my your his her our their its another",
);

const NOT_OWNED = words(
  "are were have has had will would can could should may might must is was been be do does did " +
    "i you we they he she it of in on at for with to from and or but that which who as so than " +
    "since by about ago before after later went came passed flew now then",
);
const DETERMINERS_BEFORE = words("the these those my your his her our their its for over");

const FINITE_AFTER = words("is are was were has have had will would can could does do did");
const PREPOSITIONS = words(
  "by for to with from of about under in on at against through without among between",
);
const NOT_WHOSE = words(
  "who what that this there here home next up out in on off online back still also not now " +
    "just really already always never often going coming done gone been got had friends boss " +
    "ready right wrong sure afraid able the a an my your his her our their its anybody " +
    "somebody someone anyone everyone everybody nobody",
);

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  apostropheQuantifiedPlural: (m, ctx) => {
    const { q, mod, w } = m.groups!;
    const ql = q.toLowerCase();
    // "The 2015 movie's": a year, not a count.
    if (/^(?:1[89]|20)\d\d$/.test(q)) return null;
    if (/[0-9]/.test(q)) {
      // A numbered label ("Chapter 2 owner's guide", "Windows 10 user's"), not a count.
      const before = ctx.text.slice(Math.max(0, m.index - 24), m.index);
      const label = /(\p{Lu}[\p{L}]*)[ \t\u00a0]+$/u.exec(before)?.[1];
      if (label && !LABEL_FREE.has(label.toLowerCase())) return null;
      if (
        /\b(?:no|number|model|version|chapter|section|page|step|level|row|column)\.?[ \t\u00a0]+$/i.test(
          before,
        )
      )
        return null;
    }
    if (mod) {
      const read = info(mod);
      // "all three manufacturer's", "many of those API's": a count or determiner in between.
      const between = COUNT_WORDS.has(mod) || (/of$/i.test(q) && /^(?:these|those)$/.test(mod));
      if (!/^[a-z]+$/.test(mod) || !(read?.adjective || mod === "other" || between)) return null;
    }
    // After a number, an unlisted lowercase noun ("2 outlet's") is counted too.
    const plural =
      pluralOf(w) ??
      (/^(?:[2-9]|[1-9][0-9]+)$/.test(q) && /^[a-z]{4,}$/.test(w) && !info(w) && !/s$/.test(w)
        ? `${w}s`
        : null);
    if (!plural || ctx.dictionary.has(w.toLowerCase())) return null;
    // "some user's settings" is one user; "all" and "some" count only acronyms or a closed phrase.
    if ((ql === "some" || ql === "all") && !/^[A-Z][A-Z&]*[A-Z]$/.test(w)) {
      const after = nextWord(ctx, m.index + m[0].length);
      if (ql === "some" || after === null || !(after === "" || PHRASE_ENDS.has(after))) return null;
    }
    if (ql === "these" || ql === "those" || ql === "both") {
      // "these one's" yes; "both John's" is two owners.
      if (!/^(?:[a-z]+|[A-Z][A-Z&]*[A-Z])$/.test(w)) return null;
    }
    const [start] = m.indices!.groups!.w;
    const end = m.index + m[0].length;
    const next = nextWord(ctx, end);
    if (next === null) return null;
    const nextRead = next ? info(next) : null;
    const ends =
      next === "" ||
      PHRASE_ENDS.has(next) ||
      (!!nextRead && (!nextRead.noun || nextRead.verbs.some((v) => v.form === "past")));
    const alternatives = ends ? [plural] : [`${plural}'`, plural];
    return {
      ruleId: "englishApostrophes",
      messageKey: "review_msg_plural_apostrophe",
      range: { start, end },
      alternatives: alternatives.map((alt) => (/’/.test(m[0]) ? alt.replaceAll("'", "’") : alt)),
      ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
      context: context(ctx, m.index, end),
    };
  },
  apostropheRelativePlural: (m, ctx) => {
    const { w, verb, verb2 } = m.groups!;
    if (!OBJECT_SLOT.has(previousWord(ctx, m.index)) || ctx.dictionary.has(w)) return null;
    const v = (verb ?? verb2).toLowerCase().replaceAll("’", "'");
    const read = info(v);
    const finite =
      CLAUSE_VERB.has(v) || !!read?.verbs.some((x) => x.form === "past" || x.form === "third");
    if (!finite) return null;
    // The lexicon leaves out long plain nouns ("problem"): their plural is the plain -s one.
    const plural = pluralOf(w) ?? (!info(w) && /[^s]$/.test(w) && w.length > 5 ? `${w}s` : null);
    if (!plural) return null;
    const [start] = m.indices!.groups!.w;
    return {
      ruleId: "englishApostrophes",
      messageKey: "review_msg_plural_apostrophe",
      range: { start, end: start + w.length + 2 },
      alternatives: [plural],
      context: context(ctx, m.index, m.index + m[0].length),
    };
  },
  apostrophePluralSubject: (m, ctx) => {
    const { w, verb } = m.groups!;
    const before = previousWord(ctx, m.index);
    // "The car's are cheap", "those file's were": a plural verb right after the article.
    const article =
      /^(?:these|those)$/.test(before) ||
      (before === "the" && /^(?:are|were|aren't|weren't)$/.test(verb.replaceAll("’", "'")));
    if ((!article && !BARE_SUBJECT_BEFORE.has(before)) || ctx.dictionary.has(w)) return null;
    const plural = pluralOf(w);
    if (!plural) return null;
    const [start] = m.indices!.groups!.w;
    const end = start + w.length + 2;
    return finding("englishApostrophes", "review_msg_plural_apostrophe", start, end, [plural], {
      context: context(ctx, m.index, m.index + m[0].length),
    });
  },
  apostropheVerb: (m, ctx) => {
    const { subject, adverb, v } = m.groups!;
    const pronoun = /^(?:he|she|it|who)$/i.test(subject);
    // "that dog's", "Sam bill's": only a pronoun subject or an adverb rules out an owner.
    if (!pronoun && !adverb) return null;
    const third =
      IRREGULAR_THIRD.get(v) ??
      (info(v)?.verbs.some((read) => read.form === "base" && read.lemma === v)
        ? englishLexiconInflect(v, "third")
        : null);
    if (!third || ctx.dictionary.has(v)) return null;
    const end = m.index + m[0].length;
    const next = nextWord(ctx, end);
    if (next === null || (next !== "" && !AFTER_VERB.has(next))) return null;
    const [start] = m.indices!.groups!.v;
    return finding("englishApostrophes", "review_msg_verb_apostrophe", start, end, [third], {
      context: context(ctx, m.index, end),
    });
  },
  apostropheDoubled: (m) => {
    const [start, end] = m.indices!.groups!.marks;
    return finding("englishApostrophes", "review_msg_duplicate_punctuation", start, end, [
      m.groups!.marks[0],
    ]);
  },
  apostropheSpaced: (m, ctx) => {
    const { w, gap, s } = m.groups!;
    const allowed = ENDINGS[w.toLowerCase()];
    if (allowed ? !allowed.split(" ").includes(s) : s !== "s" || !/^[A-Z][a-z]+$/.test(w))
      return null;
    // A name's possessive needs the owned word right after it.
    if (!allowed && !/^[ \t ]+[a-z]/.test(ctx.text.slice(m.index + m[0].length))) return null;
    if (w !== "I" && !allowed && ctx.dictionary.has(w.toLowerCase())) return null;
    const [start, end] = m.indices!.groups!.gap;
    return finding("englishApostrophes", "review_msg_apostrophe_space", start, end, [gap.trim()]);
  },
  apostropheOthers: (m, ctx) => {
    if (m.groups!.w !== "other" && m.groups!.w !== "Other") return null;
    if (OWNER_DETERMINERS.has(previousWord(ctx, m.index))) return null;
    const n = m.groups!.n;
    // An unlisted word after it ("other's intentions") is read as the owned noun.
    const read = info(n);
    if (read ? !(read.noun || read.adjective) : n.length < 4) return null;
    if (PHRASE_ENDS.has(n)) return null;
    const start = m.index;
    const end = start + "other's".length;
    return {
      ruleId: "englishApostrophes",
      messageKey: "review_msg_noun_possessive",
      range: { start, end },
      alternatives: [`${m.groups!.w}s${ctx.text[start + 5]}`],
      context: context(ctx, start, m.index + m[0].length),
    };
  },
  apostropheTimeOwner: (m, ctx) => {
    const { d, t, n } = m.groups!;
    if (!/^[A-Za-z][a-z]*$/.test(t + n) || NOT_OWNED.has(n.toLowerCase())) return null;
    if (d.toLowerCase() !== "this" && DETERMINERS_BEFORE.has(previousWord(ctx, m.index)))
      return null;
    const read = info(n);
    if (!/^[A-Z]/.test(n) && !read?.noun) return null;
    if (read && ((!read.noun && read.verbs.length) || read.adverb)) return null;
    const [start] = m.indices!.groups!.t;
    const end = start + t.length + 1;
    return finding("englishApostrophes", "review_msg_noun_possessive", start, end, [`${t}'s`], {
      context: context(ctx, m.index, m.index + m[0].length),
    });
  },
  apostropheDayOwner: (m, ctx) => {
    if (!/^[A-Za-z][a-z]*$/.test(m.groups!.t)) return null;
    return {
      ruleId: "englishApostrophes",
      messageKey: "review_msg_noun_possessive",
      range: { start: m.index, end: m.index + m[0].length },
      alternatives: [`${m.groups!.t}'s`],
      context: context(ctx, m.index, m.index + m[0].length),
    };
  },
  apostropheWhose: (m, ctx) => {
    const n = m.groups!.n;
    // "WHO's list" is the organization.
    if (m.groups!.w !== "who" && m.groups!.w !== "Who") return null;
    const read = info(n);
    if (!read?.noun || NOT_WHOSE.has(n) || read.adjective || read.adverb) return null;
    if (read.verbs.some((v) => v.form !== "base" && v.form !== "third")) return null;
    const end = m.index + m[0].length;
    const next = nextWord(ctx, end);
    const nextRead = next ? info(next) : null;
    const owned =
      (next !== null && FINITE_AFTER.has(next)) ||
      !!nextRead?.verbs.some((v) => v.form === "past") ||
      PREPOSITIONS.has(previousWord(ctx, m.index));
    if (!owned) return null;
    const start = m.index;
    return finding(
      "englishApostrophes",
      "review_msg_whose",
      start,
      start + 5,
      [`${m.groups!.w}se`],
      {
        context: context(ctx, start, end),
      },
    );
  },
} satisfies Record<string, MatchFixer>;
