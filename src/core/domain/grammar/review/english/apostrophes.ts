import {
  englishLexiconInflect,
  englishNounPair,
  englishWordInfo,
  type EnglishWordInfo,
} from "../../implementations/helpers/EnglishLexicon";
import type { PhraseRow } from "../englishPhraseTables";
import { frameMatches, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { quotedMention } from "./grammarStyle1";

// Apostrophes in the wrong place: a plural written with 's ("two CD's"), a verb with one ("he
// see's"), a doubled or spaced apostrophe ("we''ll", "I' m"), a possessive left without one
// ("last weeks meeting", "other's ideas"), and "who's" where "whose" owns the next noun.

const S = SPACE;
const E = WORD_END;
const A = "['’]";

/** Rows for englishPhraseCorrections, englishClosedCompounds and stylePhrasing. */
export const PHRASES: readonly PhraseRow[] = [
  // Indefinite pronouns own with 's; they have no plural.
  // ("someone elses" is englishElsePossessive's.)
  ...["someone", "anyone", "everyone", "somebody", "anybody", "everybody", "nobody"].map(
    (who): PhraseRow => [`${who}s`, `${who}'s`],
  ),
  ["everybodies", "everybody's"],
  ...["fault", "business", "problem", "concern", "responsibility", "idea"].map(
    (noun): PhraseRow => [`no ones ${noun}`, `no one's ${noun}`],
  ),
  [["ones own", "ones' own"], "one's own"],
  // Set phrases built on a possessive.
  ["devils advocate", "devil's advocate"],
  ["writers block", "writer's block"],
  ["lions share", "lion's share"],
  ["a stones throw", "a stone's throw"],
  [["at arms length", "at arms' length"], "at arm's length"],
  [["birds eye view", "birds-eye view", "bird's eye view"], "bird's-eye view"],
  ["beginners luck", "beginner's luck"],
  ["the straw that broke the camels back", "the straw that broke the camel's back"],
  ["at deaths door", "at death's door"],
  ["in harms way", "in harm's way"],
  ["out of harms way", "out of harm's way"],
  ["at wits end", "at wit's end"],
  ["at my wits end", "at my wit's end"],
  ["for old times sake", "for old times' sake"],
  ["for goodness sake", ["for goodness' sake", "for goodness's sake"]],
  ["for heavens sake", "for heaven's sake"],
  ["for gods sake", "for God's sake"],
  ["in gods name", "in God's name"],
  ["for petes sake", "for Pete's sake"],
  ["mothers maiden name", "mother's maiden name"],
  ["runners high", "runner's high"],
  ["a good nights sleep", "a good night's sleep"],
  ["a nights sleep", "a night's sleep"],
  ["a days work", "a day's work"],
  ["a hard days work", "a hard day's work"],
  ["a days pay", "a day's pay"],
  ["a weeks notice", "a week's notice"],
  ["a months notice", "a month's notice"],
  ["two weeks notice", "two weeks' notice"],
  ["in a weeks time", "in a week's time"],
  ["in a years time", "in a year's time"],
  ["in two weeks time", "in two weeks' time"],
  ...["bachelor", "master"].flatMap((degree): PhraseRow[] => [
    [`${degree}s degree`, `${degree}'s degree`],
    [`${degree}s degrees`, `${degree}'s degrees`],
    [`${degree}s thesis`, `${degree}'s thesis`],
    [`${degree}s program`, `${degree}'s program`],
    [`${degree}s programme`, `${degree}'s programme`],
  ]),
  ["doctors appointment", "doctor's appointment"],
  ["dentists appointment", "dentist's appointment"],
  [
    ["drivers license", "drivers licence"],
    ["driver's license", "driver's licence"],
  ],
  ["travelers check", "traveler's check"],
  ["travelers checks", "traveler's checks"],
  ["travellers cheque", "traveller's cheque"],
  ["travellers cheques", "traveller's cheques"],
  // Eponymous conditions keep the discoverer's possessive.
  ...["Alzheimer", "Parkinson", "Crohn", "Huntington", "Hodgkin", "Bright"].map(
    (name): PhraseRow => [`${name.toLowerCase()}s disease`, `${name}'s disease`],
  ),
  ...["Asperger", "Tourette"].map((name): PhraseRow => [
    `${name.toLowerCase()}s syndrome`,
    `${name}'s syndrome`,
  ]),
  ["alzheimers", "Alzheimer's"],
  ["parkinsons", "Parkinson's"],
];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

type Finding = RawFinding;

const INFO = new Map<string, EnglishWordInfo | null>();
function info(word: string): EnglishWordInfo | null {
  const w = word.toLowerCase();
  let hit = INFO.get(w);
  if (hit === undefined) {
    if (INFO.size > 20000) INFO.clear();
    hit = englishWordInfo(w);
    INFO.set(w, hit);
  }
  return hit;
}
const words = (list: string) => new Set(list.split(" "));
const context = (ctx: DetectContext, start: number, end: number) => ({
  start: Math.max(0, start - 96),
  end: Math.min(ctx.text.length, end + 40),
});
/** The next word (lowercased) after `end`, "" at punctuation or the end, null after a symbol. */
function nextWord(ctx: DetectContext, end: number): string | null {
  const after = ctx.text.slice(end, end + 40);
  if (/^[ \t ]*(?:[.!?,;:)\]"”…]|$|\n)/.test(after)) return "";
  const word = /^[ \t ]+([A-Za-z]+(?:['’][a-z]+)?)/.exec(after);
  return word ? word[1].toLowerCase().replace("’", "'") : null;
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
const QUANTIFIERS =
  "two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|" +
  "fifty|hundred|dozens|hundreds|thousands|millions|many|several|few|numerous|various|" +
  "multiple|these|those|both|all|some|" +
  `(?:lots?|couple|number|plenty|dozens|all|most|some|many|several|both)${S}of|[2-9]|[1-9][0-9]+`;
const COUNT_WORDS = words("two three four five six seven eight nine ten twelve twenty hundred");
// Capitalized words before a count that are no label: "The 3 SMEs", "All 5 CEOs".
const LABEL_FREE = words(
  "the a an all these those some over about only nearly almost around with for in at by of and or",
);
const PLURAL_QUANTIFIED = `(?<q>${QUANTIFIERS})(?:${S}(?<mod>[a-z]+))?${S}(?<w>[A-Za-z][A-Za-z&]*)${A}s${E}`;

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

/**
 * "two CD's", "several girl's that", "many customer's in": after a plural quantifier the noun
 * is a plural, which takes no apostrophe. Before another noun it may be a plural possessive
 * ("two weeks' notice"), so the writer chooses.
 */
function quantifiedPlurals(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  for (const m of frameMatches(ctx, PLURAL_QUANTIFIED, "w")) {
    const { q, mod, w } = m.groups!;
    const ql = q.toLowerCase();
    // "The 2015 movie's": a year, not a count.
    if (/^(?:1[89]|20)\d\d$/.test(q)) continue;
    if (/[0-9]/.test(q)) {
      // A numbered label ("Chapter 2 owner's guide", "Windows 10 user's"), not a count.
      const before = ctx.text.slice(Math.max(0, m.index - 24), m.index);
      const label = /(\p{Lu}[\p{L}]*)[ \t\u00a0]+$/u.exec(before)?.[1];
      if (label && !LABEL_FREE.has(label.toLowerCase())) continue;
      if (
        /\b(?:no|number|model|version|chapter|section|page|step|level|row|column)\.?[ \t\u00a0]+$/i.test(
          before,
        )
      )
        continue;
    }
    if (mod) {
      const read = info(mod);
      // "all three manufacturer's", "many of those API's": a count or determiner in between.
      const between = COUNT_WORDS.has(mod) || (/of$/i.test(q) && /^(?:these|those)$/.test(mod));
      if (!/^[a-z]+$/.test(mod) || !(read?.adjective || mod === "other" || between)) continue;
    }
    // After a number, an unlisted lowercase noun ("2 outlet's") is counted too.
    const plural =
      pluralOf(w) ??
      (/^(?:[2-9]|[1-9][0-9]+)$/.test(q) && /^[a-z]{4,}$/.test(w) && !info(w) && !/s$/.test(w)
        ? `${w}s`
        : null);
    if (!plural || ctx.dictionary.has(w.toLowerCase())) continue;
    // "some user's settings" is one user; "all" and "some" count only acronyms or a closed phrase.
    if ((ql === "some" || ql === "all") && !/^[A-Z][A-Z&]*[A-Z]$/.test(w)) {
      const after = nextWord(ctx, m.index + m[0].length);
      if (ql === "some" || after === null || !(after === "" || PHRASE_ENDS.has(after))) continue;
    }
    if (ql === "these" || ql === "those" || ql === "both") {
      // "these one's" yes; "both John's" is two owners.
      if (!/^(?:[a-z]+|[A-Z][A-Z&]*[A-Z])$/.test(w)) continue;
    }
    const [start] = m.indices!.groups!.w;
    const end = m.index + m[0].length;
    const next = nextWord(ctx, end);
    if (next === null) continue;
    const nextRead = next ? info(next) : null;
    const ends =
      next === "" ||
      PHRASE_ENDS.has(next) ||
      (!!nextRead && (!nextRead.noun || nextRead.verbs.some((v) => v.form === "past")));
    const alternatives = ends ? [plural] : [`${plural}'`, plural];
    findings.push({
      ruleId: "englishApostrophes",
      messageKey: "review_msg_plural_apostrophe",
      range: { start, end },
      alternatives: alternatives.map((alt) => (/’/.test(m[0]) ? alt.replace("'", "’") : alt)),
      ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
      context: context(ctx, m.index, end),
    });
  }
  return findings;
}

// "where user's would", "most user's are": a bare noun before a finite verb is its plural subject.
const PLURAL_SUBJECT = `(?<w>[a-z]{3,})${A}s${S}(?<verb>would|could|should|are|were|have|don't|didn't|won't|aren't|weren't|haven't)${E}`;
const BARE_SUBJECT_BEFORE = words(
  // Not after "and"/"or": "the plum and peach's are shorter" leaves the owned noun out.
  "most all some many where when if because think thought believe guess so why how whether " +
    "while unless",
);

// "about the problem's it causes", "the one's I tested", "to user's that don't": a noun with
// 's, then a relative clause (a subject and its verb, or that/who and a verb), is a plural.
// Only as an object (after a preposition or a verb of being): "The problem's it fails" could
// be "the problem is (that) it fails".
const RELATIVE_PLURAL = `(?:(?<det>the|these|those|all|any|some|many|our|your|their|my)${S})?(?<w>[a-z]{3,})${A}s${S}(?:(?<pron>I|we|you|they|he|she|it)${S}(?<verb>[a-z]+(?:['’]t)?)|(?<rel>that|who)${S}(?<verb2>[a-z]+(?:['’]t)?))${E}`;
const OBJECT_SLOT = words(
  "about of to in on for with from at by into among between are were is was all any none many " +
    "some most each see saw like read fix fixed tested check checked",
);
const CLAUSE_VERB = words(
  "had have has did do does was were is are will would can could made make got get use used " +
    "tested wrote write need needed want wanted know knew see saw found find don't didn't doesn't " +
    "can't won't haven't hasn't",
);

function relativePlurals(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  for (const m of frameMatches(ctx, RELATIVE_PLURAL, "w")) {
    const { w, verb, verb2 } = m.groups!;
    if (!OBJECT_SLOT.has(previousWord(ctx, m.index)) || ctx.dictionary.has(w)) continue;
    const v = (verb ?? verb2).toLowerCase().replace("’", "'");
    const read = info(v);
    const finite =
      CLAUSE_VERB.has(v) || !!read?.verbs.some((x) => x.form === "past" || x.form === "third");
    if (!finite) continue;
    // The lexicon leaves out long plain nouns ("problem"): their plural is the plain -s one.
    const plural = pluralOf(w) ?? (!info(w) && /[^s]$/.test(w) && w.length > 5 ? `${w}s` : null);
    if (!plural) continue;
    const [start] = m.indices!.groups!.w;
    findings.push({
      ruleId: "englishApostrophes",
      messageKey: "review_msg_plural_apostrophe",
      range: { start, end: start + w.length + 2 },
      alternatives: [plural],
      context: context(ctx, m.index, m.index + m[0].length),
    });
  }
  return findings;
}

function pluralSubjects(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  for (const m of frameMatches(ctx, PLURAL_SUBJECT, "w")) {
    const { w, verb } = m.groups!;
    const before = previousWord(ctx, m.index);
    // "The car's are cheap", "those file's were": a plural verb right after the article.
    const article =
      /^(?:these|those)$/.test(before) ||
      (before === "the" && /^(?:are|were|aren't|weren't)$/.test(verb.replace("’", "'")));
    if ((!article && !BARE_SUBJECT_BEFORE.has(before)) || ctx.dictionary.has(w)) continue;
    const plural = pluralOf(w);
    if (!plural) continue;
    const [start] = m.indices!.groups!.w;
    const end = start + w.length + 2;
    findings.push({
      ruleId: "englishApostrophes",
      messageKey: "review_msg_plural_apostrophe",
      range: { start, end },
      alternatives: [plural],
      context: context(ctx, m.index, m.index + m[0].length),
    });
  }
  return findings;
}

// "he see's", "it last's", "Michael really want's": a verb's -s ending takes no apostrophe.
const VERB_S = `(?<subject>he|she|it|who|[A-Z][a-z]+|that)(?:${S}(?<adverb>really|just|also|always|never|often|still|only|usually|sometimes|actually|probably|rarely|even|simply))?${S}(?<v>[a-z]{2,})${A}s${E}`;
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

function verbApostrophes(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  for (const m of frameMatches(ctx, VERB_S, "v")) {
    const { subject, adverb, v } = m.groups!;
    const pronoun = /^(?:he|she|it|who)$/i.test(subject);
    // "that dog's", "Sam bill's": only a pronoun subject or an adverb rules out an owner.
    if (!pronoun && !adverb) continue;
    const third =
      IRREGULAR_THIRD.get(v) ??
      (info(v)?.verbs.some((read) => read.form === "base" && read.lemma === v)
        ? englishLexiconInflect(v, "third")
        : null);
    if (!third || ctx.dictionary.has(v)) continue;
    const end = m.index + m[0].length;
    const next = nextWord(ctx, end);
    if (next === null || (next !== "" && !AFTER_VERB.has(next))) continue;
    const [start] = m.indices!.groups!.v;
    findings.push({
      ruleId: "englishApostrophes",
      messageKey: "review_msg_verb_apostrophe",
      range: { start, end },
      alternatives: [third],
      context: context(ctx, m.index, end),
    });
  }
  return findings;
}

// "We''ll", "Tom''s": one apostrophe.
const DOUBLED = `(?<w>[A-Za-z]+)(?<marks>${A}${A})(?:s|t|ll|re|ve|d|m)(?![\\p{L}\\p{N}'’])`;
/** The text frames scan for this chunk holds `gate`; without it a frame cannot match. */
const holds = (ctx: DetectContext, gate: RegExp) =>
  gate.test(ctx.scanText.slice(Math.max(0, ctx.from - 256)));

function doubledApostrophes(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  if (!holds(ctx, /['’]['’]/)) return findings;
  for (const m of frameMatches(ctx, DOUBLED, "marks")) {
    const [start, end] = m.indices!.groups!.marks;
    findings.push({
      ruleId: "englishApostrophes",
      messageKey: "review_msg_duplicate_punctuation",
      range: { start, end },
      alternatives: [m.groups!.marks[0]],
    });
  }
  return findings;
}

// "I' m", "they 're", "Julia' s new": a contraction or possessive split by a space.
const SPACED = `(?<w>I|you|we|they|he|she|it|[A-Z][a-z]+)(?<gap>${A}${S}|${S}${A})(?<s>m|re|ve|ll|d|s)${E}`;
const ENDINGS: Record<string, string> = {
  i: "m ve ll d",
  you: "re ve ll d",
  we: "re ve ll d",
  they: "re ve ll d",
  he: "s ll d",
  she: "s ll d",
  it: "s ll d",
};
function spacedApostrophes(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  if (!holds(ctx, /['’][ \t\u00a0]|[ \t\u00a0]['’]/)) return findings;
  for (const m of frameMatches(ctx, SPACED, "gap")) {
    const { w, gap, s } = m.groups!;
    const allowed = ENDINGS[w.toLowerCase()];
    if (allowed ? !allowed.split(" ").includes(s) : s !== "s" || !/^[A-Z][a-z]+$/.test(w)) continue;
    // A name's possessive needs the owned word right after it.
    if (!allowed && !/^[ \t ]+[a-z]/.test(ctx.text.slice(m.index + m[0].length))) continue;
    if (w !== "I" && !allowed && ctx.dictionary.has(w.toLowerCase())) continue;
    const [start, end] = m.indices!.groups!.gap;
    findings.push({
      ruleId: "englishApostrophes",
      messageKey: "review_msg_apostrophe_space",
      range: { start, end },
      alternatives: [gap.trim()],
    });
  }
  return findings;
}

// "from other's photos": with no determiner, the owners are several others.
const OTHERS = `(?<w>other)${A}s${S}(?<n>[a-z]+)${E}`;
const OWNER_DETERMINERS = words(
  "each one the an any every no some this that my your his her our their its another",
);
function othersPossessive(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  for (const m of frameMatches(ctx, OTHERS, "w")) {
    if (m.groups!.w !== "other" && m.groups!.w !== "Other") continue;
    if (OWNER_DETERMINERS.has(previousWord(ctx, m.index))) continue;
    const n = m.groups!.n;
    // An unlisted word after it ("other's intentions") is read as the owned noun.
    const read = info(n);
    if (read ? !(read.noun || read.adjective) : n.length < 4) continue;
    if (PHRASE_ENDS.has(n)) continue;
    const start = m.index;
    const end = start + "other's".length;
    findings.push({
      ruleId: "englishApostrophes",
      messageKey: "review_msg_noun_possessive",
      range: { start, end },
      alternatives: [`${m.groups!.w}s${ctx.text[start + 5]}`],
      context: context(ctx, start, m.index + m[0].length),
    });
  }
  return findings;
}

// "last weeks meeting", "this years budget": a time noun owning the next noun.
const TIME_OWNER = `(?<d>this|last|next)${S}(?<t>week|weekend|month|year|morning|night|evening|afternoon|season|quarter|semester|summer|winter|autumn)s${S}(?<n>[A-Za-z]+)${E}`;
const NOT_OWNED = words(
  "are were have has had will would can could should may might must is was been be do does did " +
    "i you we they he she it of in on at for with to from and or but that which who as so than " +
    "since by about ago before after later went came passed flew now then",
);
const DETERMINERS_BEFORE = words("the these those my your his her our their its for over");
function timePossessives(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  for (const m of frameMatches(ctx, TIME_OWNER, "t")) {
    const { d, t, n } = m.groups!;
    if (!/^[A-Za-z][a-z]*$/.test(t + n) || NOT_OWNED.has(n.toLowerCase())) continue;
    if (d.toLowerCase() !== "this" && DETERMINERS_BEFORE.has(previousWord(ctx, m.index))) continue;
    const read = info(n);
    if (!/^[A-Z]/.test(n) && !read?.noun) continue;
    if (read && ((!read.noun && read.verbs.length) || read.adverb)) continue;
    const [start] = m.indices!.groups!.t;
    const end = start + t.length + 1;
    findings.push({
      ruleId: "englishApostrophes",
      messageKey: "review_msg_noun_possessive",
      range: { start, end },
      alternatives: [`${t}'s`],
      context: context(ctx, m.index, m.index + m[0].length),
    });
  }
  return findings;
}

// "a boy who's birthday is", "by who's standards": "whose" owns the noun after it.
const WHOS = `(?<w>who)${A}s${S}(?<n>[a-z]+)${E}`;
const FINITE_AFTER = words("is are was were has have had will would can could does do did");
const PREPOSITIONS = words(
  "by for to with from of about under in on at against through without among between",
);
const NOT_WHOSE = words(
  "who what that this there here home next up out in on off online back still also not now " +
    "just really already always never often going coming done gone been got had friends boss " +
    "ready right wrong sure afraid able the a an my your his her our their its",
);
function whoseOwner(ctx: DetectContext): Finding[] {
  const findings: Finding[] = [];
  for (const m of frameMatches(ctx, WHOS, "w")) {
    const n = m.groups!.n;
    // "WHO's list" is the organization.
    if (m.groups!.w !== "who" && m.groups!.w !== "Who") continue;
    const read = info(n);
    if (!read?.noun || NOT_WHOSE.has(n) || read.adjective || read.adverb) continue;
    if (read.verbs.some((v) => v.form !== "base" && v.form !== "third")) continue;
    const end = m.index + m[0].length;
    const next = nextWord(ctx, end);
    const nextRead = next ? info(next) : null;
    const owned =
      (next !== null && FINITE_AFTER.has(next)) ||
      !!nextRead?.verbs.some((v) => v.form === "past") ||
      PREPOSITIONS.has(previousWord(ctx, m.index));
    if (!owned) continue;
    const start = m.index;
    findings.push({
      ruleId: "englishApostrophes",
      messageKey: "review_msg_whose",
      range: { start, end: start + 5 },
      alternatives: [`${m.groups!.w}se`],
      context: context(ctx, start, end),
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
  {
    rules: ["englishApostrophes"],
    detect: english(
      quantifiedPlurals,
      pluralSubjects,
      relativePlurals,
      verbApostrophes,
      doubledApostrophes,
      spacedApostrophes,
      othersPossessive,
      timePossessives,
      whoseOwner,
    ),
  },
];
