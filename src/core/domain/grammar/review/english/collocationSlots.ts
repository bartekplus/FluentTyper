import {
  englishLexiconInflect,
  englishListedNoun,
  englishWordInfo,
} from "../../implementations/helpers/EnglishLexicon";
import { ENGLISH_VERB_FORMS } from "../../implementations/helpers/EnglishVerbForms";
import { namedExampleBefore } from "../exampleCues";
import { frameMatches, hasUserOrCasedWord, SPACE, WORD_END } from "../phraseTemplates";
import type { PhraseRow } from "../englishPhraseTables";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import {
  afterBreak,
  BE_FINITE,
  caseLike,
  DETERMINERS,
  english,
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

export const PHRASES: readonly PhraseRow[] = [];
export const COMPOUNDS: readonly PhraseRow[] = [];
export const STYLE: readonly PhraseRow[] = [];

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
  for: /^(?:now|sure|example|instance|good|once|ages|years|hours|days|weeks|months|a (?:while|moment|minute|second|bit|time|long)|the (?:first|moment|most|time))$/,
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
const ROWS: readonly (readonly [string, string, string | string[], Guard?])[] = [
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

const WORD =
  /(?<![\p{L}\p{M}\p{N}_'’@/#\\.-])[A-Za-z]+(?![\p{L}\p{M}\p{N}_'’@/#\\-]|\.[\p{L}\p{N}])/gu;

function collocations(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const rows = table();
  WORD.lastIndex = Math.max(0, ctx.from - 40);
  for (let m = WORD.exec(ctx.text); m && m.index < ctx.to; m = WORD.exec(ctx.text)) {
    const lower = m[0].toLowerCase();
    const entries = rows.get(lower);
    if (!entries || ctx.dictionary.has(lower)) continue;
    // Lowercase, or capitalized at a sentence start.
    if (m[0] !== lower && m[0] !== lower[0].toUpperCase() + lower.slice(1)) continue;
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
      continue;
    const entry = entries.find(
      (e) => e.wrong.has(prep.lower) && (!e.guard || e.guard(ctx, head, after)),
    );
    if (!entry || idiom(prep, after) || namedExampleBefore(ctx.text, head.start)) continue;
    const deletion = entry.right.length === 1 && entry.right[0] === "";
    // A deletion takes the space after the word, as the phrase templates do ("discuss about ").
    const range = deletion
      ? { start: prep.start, end: after[1].start }
      : { start: prep.start, end: prep.end };
    findings.push({
      ruleId: "englishFixedPrepositions",
      messageKey: "review_msg_fixed_prepositions",
      range,
      alternatives: [...entry.right],
      ...(entry.right.length > 1 ? { requiresChoice: true as const } : {}),
      context: evidence(ctx, head.start, prep.end),
    });
  }
  return findings;
}

const DAY = "(?:mon|tues|wednes|thurs|fri|satur|sun)days?";
const NUMBER =
  "(?:[0-9]+(?:[.,][0-9]+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)";
const MOTION =
  "(?:go|goes|going|gone|went|come|comes|coming|came|get|gets|getting|got|return|returns|returned|returning|head|heads|headed|heading|walk|walks|walked|walking|drive|drives|drove|driving|run|runs|ran|running|hurry|hurried|rush|rushed|take|takes|took|taking|bring|brings|brought|send|sends|sent)";
const LOOSE_SPACE = "[ \\t\\u00a0]{0,8}";
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

type Frame = {
  pattern: string;
  fix: (m: RegExpExecArray, ctx: DetectContext) => string | null;
};
const FRAMES: readonly Frame[] = [
  // "see you in Monday", "closed at Sunday": days take "on".
  {
    // "be in Monday", "weighed in Wednesday", "slept in Tuesday": particles stay. Only after an
    // event or a meeting, and not before a possessive ("in Friday night's briefing").
    pattern: `(?<target>in|at)${SPACE}${DAY}${WORD_END}`,
    fix: (m, ctx) => {
      const before = wordBefore(ctx, m.index);
      const next = tokensAfter(ctx, m.index + m[0].length, 1)[0];
      if (next?.kind === "word" && /['’]/.test(next.text)) return null;
      return /^(?:you|meet|meeting|meetings|class|classes|appointment|party|exam|test|game|match|starts|start|begins|ends|closed|opens|open|due|deadline|leave|leaves|leaving|arrive|arrives|arriving|arrived|born|held|scheduled|planned)$/.test(
        before,
      ) ||
        (m.groups!.target.toLowerCase() === "at" && afterBreak(ctx, m.index))
        ? "on"
        : null;
    },
  },
  // "born on 1990", "founded at 2015": a bare year takes "in".
  {
    pattern: `(?:born|died|married|founded|built|established|launched|released|published|started|began|opened|retired|graduated|moved|formed|created)${SPACE}(?<target>on|at)${SPACE}(?:1[5-9]|20)[0-9]{2}${WORD_END}(?![/.:-][0-9])`,
    fix: (m, ctx) => (phraseEnd(ctx, m.index + m[0].length) ? "in" : null),
  },
  // "starts in 5 pm": a clock time takes "at".
  {
    pattern: `(?<target>in|on)${SPACE}(?:[0-9]|1[0-2])(?::[0-5][0-9])?${LOOSE_SPACE}(?:am|pm|a\\.m\\.|p\\.m\\.|o['’]clock)(?![\\p{L}\\p{N}])`,
    fix: () => "at",
  },
  // "at the morning" → "in"; "on the evening" without "of" → "in".
  {
    pattern: `(?<target>at|on)${SPACE}the${SPACE}(?:morning|afternoon|evening)${WORD_END}`,
    fix: (m, ctx) => {
      // "on the evening of May 5", "on the morning before": a particular day keeps "on".
      const next = tokensAfter(ctx, m.index + m[0].length, 1)[0];
      return !next ||
        next.kind === "end" ||
        next.kind === "comma" ||
        /^(?:and|but|so|because|too|again|together|alone|anyway)$/.test(next.lower)
        ? "in"
        : null;
    },
  },
  // "A lot people came": "a lot of"; not "liked it a lot people say".
  {
    pattern: `(?<![\\p{L}'’])a${SPACE}(?<target>lot)${SPACE}(?<noun>[a-z]+)${WORD_END}`,
    fix: (m, ctx) => {
      if (OBJECT_PRONOUNS.has(wordBefore(ctx, m.index))) return null;
      const noun = m.groups!.noun.toLowerCase();
      return noun === "people" ||
        (nounOnly(noun) === "plural" &&
          !/^(?:times|ways|days|years|months|weeks|hours|minutes|seconds)$/.test(noun))
        ? "lot of"
        : null;
    },
  },
  // "between three to five": "between ... and".
  {
    pattern: `between${SPACE}${NUMBER}(?:${LOOSE_SPACE}(?:%|am|pm|percent|years|hours|days|weeks|months|minutes))?${SPACE}(?<target>to)${SPACE}${NUMBER}${WORD_END}`,
    fix: () => "and",
  },
  // "went to home": "home" is the direction itself.
  {
    pattern: `${MOTION}(?:${SPACE}(?:back|straight|directly|me|him|her|us|them|you))?(?<target>${SPACE}to)${SPACE}home${WORD_END}`,
    fix: (m, ctx) => (/home$/.test(m[0]) && phraseEnd(ctx, m.index + m[0].length) ? "" : null),
  },
  {
    pattern: `(?:return|returns|returned|returning)(?<target>${SPACE}at)${SPACE}home${WORD_END}`,
    fix: (m, ctx) => (/home$/.test(m[0]) && phraseEnd(ctx, m.index + m[0].length) ? "" : null),
  },
  // "stopped him of leaving": hindering verbs take "from".
  {
    pattern: `(?:stop|stops|stopped|stopping|prevent|prevents|prevented|preventing|prohibit|prohibits|prohibited|prohibiting|discourage|discourages|discouraged|discouraging|dissuade|dissuaded|ban|bans|banned|banning)${SPACE}(?:me|you|him|her|us|them|it|people|others|users|(?:the|my|your|his|her|our|their)${SPACE}[a-z]+)${SPACE}(?<target>of)${SPACE}(?<ing>[a-z]+ing)${WORD_END}`,
    fix: (m) =>
      englishWordInfo(m.groups!.ing.toLowerCase())?.verbs.some((v) => v.form === "ing")
        ? "from"
        : null,
  },
  // "insisted to pay" → "insisted on paying"; "succeeded to open", "capable to finish".
  {
    pattern: `(?<head>insist|insists|insisted|insisting|succeed|succeeds|succeeded|succeeding|capable|incapable)${SPACE}(?<target>to${SPACE}(?<verb>[a-z]+))${WORD_END}`,
    fix: (m, ctx) => {
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
    },
  },
  // "listen music", "listened the song": "listen to".
  {
    pattern: `(?<target>listen|listens|listened|listening)${SPACE}(?:the|a|an|my|your|his|our|their|him|them|us|music|songs?|podcasts?|radio|audiobooks?)${WORD_END}`,
    fix: (m) => `${m.groups!.target} to`,
  },
  // "travel with a bus": "by bus".
  {
    pattern: `(?:travel|travels|traveled|travelled|traveling|travelling|commute|commutes|commuted|commuting)${SPACE}(?<target>with${SPACE}(?:a|the)${SPACE}(?<vehicle>bus|train|plane|taxi|boat|ship|ferry|subway|metro|tram|coach))${WORD_END}`,
    fix: (m, ctx) => (phraseEnd(ctx, m.index + m[0].length) ? `by ${m.groups!.vehicle}` : null),
  },
  {
    pattern: `(?:take|takes|took|taken|taking)${SPACE}into${SPACE}(?:consideration|account)(?<target>${SPACE}of)${WORD_END}`,
    fix: () => "",
  },
  {
    pattern: `in${SPACE}front${SPACE}(?<target>to)${SPACE}(?=(?:the|a|an|my|your|his|her|our|their|this|that|these|those|me|him|us|them|everyone)${WORD_END})`,
    // "from the sternum in front to the spine behind": a span, not "in front of".
    fix: (m, ctx) =>
      /\bfrom\b[^.!?;]*$/i.test(ctx.text.slice(Math.max(0, m.index - 60), m.index)) ? null : "of",
  },
  { pattern: `in${SPACE}exchange${SPACE}(?<target>of)${WORD_END}`, fix: () => "for" },
];

function frames(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const { pattern, fix } of FRAMES)
    for (const m of frameMatches(ctx, pattern)) {
      const [start, end] = m.indices!.groups!.target;
      const target = m.groups!.target.trim();
      // Lowercase, or capitalized at a sentence start ("In Monday"); never a user word.
      if (target.slice(1) !== target.slice(1).toLowerCase() || hasUserOrCasedWord(ctx, m[0]))
        continue;
      const fixed = fix(m, ctx);
      if (fixed === null) continue;
      findings.push({
        ruleId: "englishFixedPrepositions",
        messageKey: "review_msg_fixed_prepositions",
        range: { start, end },
        alternatives: [caseLike(m.groups!.target, fixed)],
        context: evidence(ctx, m.index, end),
      });
    }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [
  { rules: ["englishFixedPrepositions"], detect: english(collocations, frames) },
];
