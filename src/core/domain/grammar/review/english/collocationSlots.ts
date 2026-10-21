import {
  englishLexiconInflect,
  englishListedNoun,
  englishWordInfo,
} from "../../implementations/helpers/EnglishLexicon";
import { ENGLISH_VERB_FORMS } from "../../implementations/helpers/EnglishVerbForms";
import { namedExampleBefore } from "../exampleCues";
import { hasUserOrCasedWord } from "../phraseTemplates";
import type { DetectContext } from "../reviewDetectors";
import type { MatchFixer } from "../../engine/reviewRules";
import {
  afterBreak,
  BE_FINITE,
  caseLike,
  DETERMINERS,
  evidence,
  FUNCTION_WORDS,
  nounOnly,
  OBJECT_PRONOUNS,
  SUBJECT_PRONOUNS,
  tokensAfter,
  wordBefore,
  type Token,
} from "./slotWords";

// A word that governs a fixed preposition, typed with another one: "afraid from the dark"
// (of), "participated to the event" (in), "depends of the weather" (on). One table keyed by the
// head word; a verb head ending in "+" stands for all its inflections from the lexicon.

type Guard = (ctx: DetectContext, head: Token, after: readonly Token[]) => boolean;

const BE = new Set([...BE_FINITE, "be", "been", "being", "feel", "felt", "feels", "seem", "seems"]);
const POSSESSIVES = new Set("my your his her its our their".split(" "));

/** A plain word the lexicon knows: not a name, a typo or a token glued to code. */
const known = (token: Token | undefined) =>
  token?.kind === "word" &&
  (FUNCTION_WORDS.has(token.lower) ||
    !!englishWordInfo(token.lower) ||
    !!englishListedNoun(token.lower));
/** The word after the preposition opens a noun phrase: no verb, adverb or clause word. */
const object: Guard = (_ctx, _head, [, next, after]) => {
  if (!next) return false;
  if (next.kind === "number") return true;
  if (next.kind !== "word") return false;
  if (OBJECT_PRONOUNS.has(next.lower)) return true;
  // "afraid of the dark", but not a determiner left hanging ("discussed about the").
  if (DETERMINERS.has(next.lower) || POSSESSIVES.has(next.lower)) return known(after);
  if (FUNCTION_WORDS.has(next.lower) || !known(next)) return false;
  const read = englishWordInfo(next.lower);
  // "believe to be": a base verb makes it an infinitive.
  return !read?.verbs.some((v) => v.form === "base" && v.lemma === next.lower) || !!read?.noun;
};
/** A person after the preposition: an object pronoun or a determiner and noun. */
const person: Guard = (ctx, head, after) =>
  !!after[1] &&
  after[1].kind === "word" &&
  (/^(?:me|him|her|us|them|you|everyone|everybody|people)$/.test(after[1].lower) ||
    (POSSESSIVES.has(after[1].lower) && object(ctx, head, after)));
/** Only a pronoun person: "kind with him", not "kind with your words". */
const pronoun: Guard = (_ctx, _head, [, next]) =>
  !!next && /^(?:me|him|her|us|them|you|everyone|everybody|people|others)$/.test(next.lower);
/** A linking verb right before the adjective: "is guilty for", not "felt guilty for leaving". */
const afterBe: Guard = (ctx, head, after) =>
  BE_FINITE.has(wordBefore(ctx, head.start)) &&
  object(ctx, head, after) &&
  !/ing$/.test(after[1].lower);
const both =
  (...guards: Guard[]): Guard =>
  (ctx, head, after) =>
    guards.every((g) => g(ctx, head, after));
const notBefore =
  (words: RegExp): Guard =>
  (ctx, head) =>
    !words.test(wordBefore(ctx, head.start));
const notNext =
  (words: RegExp): Guard =>
  (_ctx, _head, [, next]) =>
    !next || !words.test(next.lower);
/** A verb in a clause: after a subject, modal, "to" or do-form ("they lack of", not "the lack of"). */
const verbSlot: Guard = (ctx, head) => {
  const before = wordBefore(ctx, head.start);
  return (
    SUBJECT_PRONOUNS.has(before) ||
    /^(?:to|will|would|can|could|should|may|might|must|do|does|did|don['’]t|doesn['’]t|didn['’]t|please|also|still|really|often|never|always|just|people|many|most|some|kids|children|users)$/.test(
      before,
    )
  );
};

// Adverbial phrases that open with the typed preposition: "satisfied of course", "proud on
// that day", "interested at first", "scared from the start".
const IDIOM: Record<string, RegExp> = {
  of: /^course$/,
  at: /^(?:first|last|least|all|once|times|present|home|work|night|the (?:time|moment|start|end|same)|this (?:point|stage|time)|that (?:point|stage|time))$/,
  on: /^(?:average|and|top|time|purpose|occasion|behalf|board|paper|balance|the (?:day|whole|other|one|spot|way|weekend)|that (?:day|night|occasion)|this (?:day|occasion)|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/,
  from: /^(?:the (?:start|beginning|outset|get|first)|time|then|now|scratch|birth|childhood|day)$/,
  with: /^(?:no|respect|regard|time|age)$/,
  to: /^(?:date|this (?:day|point))$/,
  // "discussed about five issues": "about" as "roughly".
  about:
    /^(?:time|it|half|[0-9][0-9.,]*|one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|a (?:dozen|hundred|thousand|million|few|couple|third|quarter|week|month|year)|an hour)$/,
  for: /^(?:now|sure|example|instance|good|once|ages|years|hours|days|weeks|months|a (?:while|moment|minute|second|bit|time|long)|the (?:first|second|third|last|next|moment|most|time))$/,
};
const idiom = (prep: Token, after: readonly Token[]) => {
  const pattern = IDIOM[prep.lower];
  const one = after[1]?.lower ?? "";
  return !!pattern && (pattern.test(one) || pattern.test(`${one} ${after[2]?.lower ?? ""}`));
};
/** "married with a doctor", not "married with two kids". */
const spouse: Guard = (ctx, head, after) =>
  !!after[1] &&
  after[1].kind === "word" &&
  (person(ctx, head, after) || /^(?:a|an|the)$/.test(after[1].lower)) &&
  !/^(?:children|kids|no|two|three|four|five|several|many)$/.test(after[1].lower) &&
  // "married with a three-year-old daughter": a household, not a spouse.
  !/^[^.!?;\n]{0,40}?(?:child|children|kids?|bab(?:y|ies)|family|daughters?|sons?|twins|year-old|years? old|dog|cat)\b/i.test(
    ctx.text.slice(after[1].start, after[1].start + 48),
  );
/** "believe to ghosts": a bare noun or name, not "believe to be". */
const bareNoun: Guard = (ctx, head, [, next]) =>
  next?.kind === "word" &&
  !FUNCTION_WORDS.has(next.lower) &&
  !!englishWordInfo(next.lower)?.noun &&
  !englishWordInfo(next.lower)?.verbs.some((v) => v.form === "base");

// [heads, typed prepositions, the fixed one, guard]. "" as the fixed one deletes the typed word.
// The head frame of en.collocations lists every typed preposition (a test checks it).
export const ROWS: readonly (readonly [string, string, string | string[], Guard?])[] = [
  // ---- adjectives and participles ----
  ["afraid scared frightened terrified", "from", "of", object],
  ["interested", "for at", "in", object],
  ["full", "with", "of", object],
  ["guilty", "for", "of", afterBe],
  ["satisfied", "of", "with", object],
  ["jealous envious", "on at", "of", object],
  ["famous", "of", "for", object],
  ["dependent reliant", "of from", "on", object],
  ["proud", "on", "of", object],
  ["keen", "of", "on", object],
  ["tired", "about", "of", object],
  ["addicted", "with on", "to", object],
  ["allergic", "of from with", "to", object],
  ["similar", "with", "to", both(object, notNext(/^(?:respect|regard)$/))],
  ["similar", "as", "to", both(object, notBefore(/^(?:as|so|how|too)$/))],
  ["different", "of", "from", object],
  ["angry", "on against", ["with", "at"], person],
  ["crowded filled", "of", "with", object],
  ["excited", "of", "about", object],
  ["surprised", "of", ["by", "at"], object],
  ["disappointed", "from of", ["with", "by", "in"], object],
  ["kind", "with", "to", pronoun],
  ["far", "of", "from", both(object, notNext(/^(?:a|an)$/), notBefore(/^(?:so|thus|as|how|too)$/))],
  ["based", "of", "on", object],
  ["regardless", "from", "of", object],
  [
    "married",
    "with",
    "to",
    both(spouse, (ctx, head) =>
      /^(?:get|gets|got|getting|be|been|being|is|are|was|were|am)$/.test(
        wordBefore(ctx, head.start),
      ),
    ),
  ],
  [
    "marry marries married marrying",
    "with",
    "",
    both(
      spouse,
      notBefore(
        /^(?:get|gets|got|getting|be|been|being|is|are|was|were|am|happily|newly|recently|once|still|just|now|not)$/,
      ),
    ),
  ],
  // ---- verbs ----
  ["participate+", "to", "in", object],
  ["consist+", "to from on", "of", object],
  ["depend+", "of from", "on", object],
  ["rely+", "of", "on", object],
  ["believe+", "to", "in", bareNoun],
  ["recover+", "of", "from", object],
  ["invest+", "on", "in", both(object, notNext(/^behalf$/))],
  ["specialize+ specialise+", "on", "in", object],
  ["resemble+", "to with", "", object],
  ["suffer suffers suffered", "of", "from", object],
  ["suffering", "of", "from", both(object, (ctx, head) => BE.has(wordBefore(ctx, head.start)))],
  ["lack lacks lacked", "of", "", both(object, verbSlot)],
  // A line break before the verb may end a heading or list item: "We\ndiscussed about".
  [
    "discuss+",
    "about",
    "",
    both(
      object,
      (ctx, head) => !/\n[ \t]*$/.test(ctx.text.slice(Math.max(0, head.start - 8), head.start)),
    ),
  ],
  ["mentioned", "about", "", object],
  ["mention", "about", "", both(object, verbSlot)],
  ["yell+ shout+ scream+", "on", "at", person],
  ["abstain+ refrain+", "of", "from", object],
  ["benefited benefitted benefiting benefitting", "of", "from", object],
  ["charged", "of", "with", object],
  ["comply+", "to", "with", object],
  ["persist+", "on", "in", object],
  ["retire+", "of", "from", object],
  ["differ+", "of", "from", object],
  // ---- nouns ----
  ["participation", "to", "in", object],
  ["interest", "about", "in", object],
  ["acquainted", "to", "with", object],
  ["accused", "for", "of", afterBe],
  ["absorbed", "at", "in", object],
];

/** A verb head's base, -s, past, participle and -ing forms, as the lexicon spells them. */
function inflections(lemma: string): string[] {
  const irregular = ENGLISH_VERB_FORMS.find((row) => row.lemma === lemma);
  const forms = [lemma, irregular?.participle];
  for (const form of ["third", "past", "ing"] as const)
    forms.push(englishLexiconInflect(lemma, form) ?? undefined);
  return forms.filter((f): f is string => !!f);
}

type Entry = { wrong: ReadonlySet<string>; right: readonly string[]; guard?: Guard };
let heads: Map<string, Entry[]> | undefined;
function table(): Map<string, Entry[]> {
  if (heads) return heads;
  heads = new Map();
  for (const [words, wrong, right, guard] of ROWS) {
    const entry = {
      wrong: new Set(wrong.split(" ")),
      right: typeof right === "string" ? [right] : right,
      guard,
    };
    for (const word of words.split(" "))
      for (const form of word.endsWith("+") ? inflections(word.slice(0, -1)) : [word])
        heads.set(form, [...(heads.get(form) ?? []), entry]);
  }
  return heads;
}

/** No noun follows: the phrase ends, or a clause or adverb word comes next. */
function phraseEnd(ctx: DetectContext, end: number): boolean {
  const next = tokensAfter(ctx, end, 1)[0];
  return (
    !next ||
    next.kind === "end" ||
    next.kind === "comma" ||
    (next.kind === "word" &&
      (FUNCTION_WORDS.has(next.lower) ||
        /^(?:early|late|safely|tonight|today|yesterday|tomorrow|alone|together|afterwards|before|after)$/.test(
          next.lower,
        )))
  );
}
/** The -ing form of a base verb, or null. */
function ingOf(verb: string): string | null {
  const lower = verb.toLowerCase();
  if (!englishWordInfo(lower)?.verbs.some((v) => v.form === "base" && v.lemma === lower))
    return null;
  return englishLexiconInflect(lower, "ing") ?? null;
}

/** A frame fixer: `fix` gives the preposition for the `target` group, or null. */
const framed =
  (fix: (m: RegExpExecArray, ctx: DetectContext) => string | null): MatchFixer =>
  (m, ctx) => {
    const [start, end] = m.indices!.groups!.target;
    const target = m.groups!.target.trim();
    // Lowercase, or capitalized at a sentence start ("In Monday"); never a user word.
    if (target.slice(1) !== target.slice(1).toLowerCase() || hasUserOrCasedWord(ctx, m[0]))
      return null;
    const fixed = fix(m, ctx);
    if (fixed === null) return null;
    return {
      ruleId: "englishFixedPrepositions",
      messageKey: "review_msg_fixed_prepositions",
      range: { start, end },
      alternatives: [caseLike(m.groups!.target, fixed)],
      context: evidence(ctx, m.index, end),
    };
  };

const homeFix = (m: RegExpExecArray, ctx: DetectContext) =>
  /home$/.test(m[0]) && phraseEnd(ctx, m.index + m[0].length) ? "" : null;

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  // A word of the head table and the wrong preposition after it.
  collocationHead: (m, ctx) => {
    const rows = table();
    const lower = m[0].toLowerCase();
    const entries = rows.get(lower);
    if (!entries || ctx.dictionary.has(lower)) return null;
    // Lowercase, or capitalized at a sentence start.
    if (m[0] !== lower && m[0] !== lower[0].toUpperCase() + lower.slice(1)) return null;
    const head: Token = {
      text: m[0],
      lower,
      start: m.index,
      end: m.index + m[0].length,
      kind: "word",
    };
    const after = tokensAfter(ctx, head.end, 4);
    const prep = after[0];
    if (prep?.kind !== "word" || prep.text !== prep.lower || ctx.dictionary.has(prep.lower))
      return null;
    const entry = entries.find(
      (e) => e.wrong.has(prep.lower) && (!e.guard || e.guard(ctx, head, after)),
    );
    if (!entry || idiom(prep, after) || namedExampleBefore(ctx.text, head.start)) return null;
    const deletion = entry.right.length === 1 && entry.right[0] === "";
    // A deletion takes the space after the word, as the phrase templates do ("discuss about ").
    const range = deletion
      ? { start: prep.start, end: after[1].start }
      : { start: prep.start, end: prep.end };
    return {
      ruleId: "englishFixedPrepositions",
      messageKey: "review_msg_fixed_prepositions",
      range,
      alternatives: [...entry.right],
      ...(entry.right.length > 1 ? { requiresChoice: true as const } : {}),
      context: evidence(ctx, head.start, prep.end),
    };
  },
  collocationDayOn: framed((m, ctx) => {
    const before = wordBefore(ctx, m.index);
    const next = tokensAfter(ctx, m.index + m[0].length, 1)[0];
    if (next?.kind === "word" && /['’]/.test(next.text)) return null;
    return /^(?:you|meet|meeting|meetings|class|classes|appointment|party|exam|test|game|match|starts|start|begins|ends|closed|opens|open|due|deadline|leave|leaves|leaving|arrive|arrives|arriving|arrived|born|held|scheduled|planned)$/.test(
      before,
    ) ||
      (m.groups!.target.toLowerCase() === "at" && afterBreak(ctx, m.index))
      ? "on"
      : null;
  }),
  collocationYearIn: framed((m, ctx) => (phraseEnd(ctx, m.index + m[0].length) ? "in" : null)),
  collocationClockAt: framed(() => "at"),
  collocationPartOfDayIn: framed((m, ctx) => {
    // "on the evening of May 5", "on the morning before": a particular day keeps "on".
    const next = tokensAfter(ctx, m.index + m[0].length, 1)[0];
    return !next ||
      next.kind === "end" ||
      next.kind === "comma" ||
      /^(?:and|but|so|because|too|again|together|alone|anyway)$/.test(next.lower)
      ? "in"
      : null;
  }),
  collocationLotOf: framed((m, ctx) => {
    if (OBJECT_PRONOUNS.has(wordBefore(ctx, m.index))) return null;
    const noun = m.groups!.noun.toLowerCase();
    return noun === "people" ||
      (nounOnly(noun) === "plural" &&
        !/^(?:times|ways|days|years|months|weeks|hours|minutes|seconds)$/.test(noun))
      ? "lot of"
      : null;
  }),
  collocationBetweenAnd: framed(() => "and"),
  collocationHome: framed(homeFix),
  collocationFrom: framed((m) =>
    englishWordInfo(m.groups!.ing.toLowerCase())?.verbs.some((v) => v.form === "ing")
      ? "from"
      : null,
  ),
  collocationGerund: framed((m, ctx) => {
    const { head, verb } = m.groups!;
    const ing = ingOf(verb);
    if (!ing) return null;
    const next = tokensAfter(ctx, m.index + m[0].length, 1)[0];
    const object =
      next?.kind === "word" && (DETERMINERS.has(next.lower) || OBJECT_PRONOUNS.has(next.lower));
    // "succeeded to power in 1990": a noun reading needs an object after it.
    if (englishWordInfo(verb.toLowerCase())?.noun && !object) return null;
    const prep = /^ins/i.test(head) ? "on" : /^suc/i.test(head) ? "in" : "of";
    return `${prep} ${ing}`;
  }),
  collocationListenTo: framed((m) => `${m.groups!.target} to`),
  collocationByVehicle: framed((m, ctx) =>
    phraseEnd(ctx, m.index + m[0].length) ? `by ${m.groups!.vehicle}` : null,
  ),
  collocationDrop: framed(() => ""),
  // "from the sternum in front to the spine behind": a span, not "in front of".
  collocationInFrontOf: framed((m, ctx) =>
    /\bfrom\b[^.!?;]*$/i.test(ctx.text.slice(Math.max(0, m.index - 60), m.index)) ? null : "of",
  ),
  collocationBirthdayOn: framed((m, ctx) => (phraseEnd(ctx, m.index + m[0].length) ? "on" : null)),
  collocationOn: framed(() => "on"),
  collocationFor: framed(() => "for"),
} satisfies Record<string, MatchFixer>;
