import { englishWordInfo } from "../../implementations/helpers/EnglishLexicon";
import type { PhraseRow } from "../englishPhraseTables";
import {
  COMPLETE,
  frameMatches,
  hasUserOrCasedWord,
  SPACE,
  WORD_END,
  isLang,
} from "../phraseTemplates";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";

const S = SPACE;
const E = WORD_END;
const POSSESSIVES = ["my", "your", "his", "her", "its", "our", "their"];

/** Every combination of the word lists, joined by spaces ("" drops a slot). */
const combos = (...parts: readonly (readonly string[])[]): string[] =>
  parts.reduce<string[]>(
    (acc, words) => acc.flatMap((a) => words.map((w) => [a, w].filter(Boolean).join(" "))),
    [""],
  );
/** One row per form: `~` stands for the form in both columns. */
const forms = (typed: string, replacement: string, words: readonly string[]): PhraseRow[] =>
  words.map((word) => [typed.replace("~", word), replacement.replace("~", word)]);

const CHANGE = ["change", "changes", "changed", "changing"];
const CHICKEN_NOUNS = ["problem", "problems", "situation", "dilemma", "conundrum", "scenario"];

/** Rows for englishPhraseCorrections, englishClosedCompounds and stylePhrasing. */
export const PHRASES: readonly PhraseRow[] = [
  ["a some", "some"],
  ...["in", "for", "after", "quite"].map((word): PhraseRow => [
    `${word} awhile`,
    `${word} a while`,
  ]),
  ...forms("all hell ~ out", "all hell ~ loose", [
    "break",
    "breaks",
    "breaking",
    "broke",
    "broken",
  ]),
  [
    [
      "for all intended purposes",
      "for all intense purposes",
      "for all intrinsic purposes",
      "for all intense and purposes",
      "for all extents and purposes",
      ...["at", "by", "from", "in", "on", "through", "with"].flatMap((word) => [
        `${word} all intents and purposes`,
        `${word} all intensive purposes`,
        `${word} all intense purposes`,
      ]),
    ],
    "for all intents and purposes",
  ],
  [["to all intense and purposes", "to all extents and purposes"], "to all intents and purposes"],
  ["all intents and purpose", "all intents and purposes"],
  ["apart of", ["a part of", "apart from"]],
  ["far a part", "far apart"],
  ...forms("~ a part", "~ apart", ["fall", "falls", "fell", "falling", "fallen"]),
  ["bare bone", "bare bones"],
  ["bare-bone", "bare-bones"],
  ["behind the scene", "behind the scenes"],
  ["behind-the-scene", "behind-the-scenes"],
  ...combos(["a"], ["cache", "cash"], ["22", "twenty two"]).map((typed): PhraseRow => [
    typed,
    typed.replace(/cache|cash/, "catch"),
  ]),
  ...combos(["a"], ["cache-22", "cash-22", "cache twenty-two", "cash twenty-two"]).map(
    (typed): PhraseRow => [typed, typed.replace(/cache|cash/, "catch")],
  ),
  ...["cautionary", "inspirational"].flatMap((word): PhraseRow[] => [
    [`${word} tail`, `${word} tale`],
    [`${word} tails`, `${word} tales`],
  ]),
  ...combos(CHANGE, ["", ...POSSESSIVES, "it's", "the"], ["tact", "tacts", "tacks"]).map(
    (typed): PhraseRow => [typed, typed.replace(/\S+$/, "tack")],
  ),
  ...combos(["change", "changes", "changing"], ["of"], ["tact", "tacts", "tacks"]).map(
    (typed): PhraseRow => [typed, typed.replace(/\S+$/, "tack")],
  ),
  [["a different tact", "a different tacts"], "a different tack"],
  ...CHICKEN_NOUNS.flatMap((noun): PhraseRow[] => [
    [[`chicken-egg ${noun}`, `chicken-or-egg ${noun}`], `chicken-and-egg ${noun}`],
    [
      [
        `chicken egg ${noun}`,
        `chicken or egg ${noun}`,
        `chicken or the egg ${noun}`,
        `chicken and the egg ${noun}`,
      ],
      `chicken and egg ${noun}`,
    ],
  ]),
  ["chicken an egg", "chicken and egg"],
  [
    ["choke full", "choke-full", "chalk-full", "chocked full", "choked full", "chucked full"],
    "chock-full",
  ],
  ...combos(["tight", "close", "tightly", "closely"], ["nit"]).flatMap((typed): PhraseRow[] => [
    [typed, typed.replace("nit", "knit")],
    [typed.replace(" ", "-"), typed.replace(" nit", "-knit")],
  ]),
  ...["door", "doors", "gate", "gates", "window", "windows", "mouth", "lid", "slightly"].map(
    (word): PhraseRow => [`${word} a jar`, `${word} ajar`],
  ),
];
export const COMPOUNDS: readonly PhraseRow[] = [
  [["a kimbo", "a-kimbo"], "akimbo"],
  ...["legs", "arms"].map((word): PhraseRow => [`${word}-a-kimbo`, `${word}-akimbo`]),
  ["a-jar", "ajar"],
];
export const STYLE: readonly PhraseRow[] = [
  // Both forms are current; "think" is the original pun.
  ["another thing coming", "another think coming"],
  ...combos(["acoustic", "analog", "analogue"], ["bike", "bicycle"]).flatMap(
    (typed): PhraseRow[] => [
      [`an ${typed}`, "a non-electric bike"],
      [typed, "non-electric bike"],
      [`${typed}s`, "non-electric bikes"],
    ],
  ),
  // "crave" is transitive; "crave for" is a regional variant.
  ...["crave", "craves", "craved"].map((verb): PhraseRow => [`${verb} for`, verb]),
];

// ---- Context detectors: forms that are also ordinary English elsewhere. ----

type Rule = Pick<RawFinding, "ruleId" | "messageKey">;
const PHRASE: Rule = {
  ruleId: "englishPhraseCorrections",
  messageKey: "review_msg_phrase_correction",
};
const PREPOSITION: Rule = {
  ruleId: "englishFixedPrepositions",
  messageKey: "review_msg_contextual_grammar",
};
const STYLED: Rule = { ruleId: "stylePhrasing", messageKey: "review_msg_style_phrasing" };

type Fix = string | readonly string[] | null;
type Frame = {
  rule: Rule;
  pattern: string;
  fix: Fix | ((m: RegExpExecArray, ctx: DetectContext) => Fix);
  /** Alternatives are written as they should appear; otherwise they take the typed case. */
  verbatim?: true;
  /** Only the target's words must be plain; the rest may name things ("written on JavaScript"). */
  targetOnly?: true;
};

const lexicon = (word: string) => englishWordInfo(word.toLowerCase());
const verbBase = (word: string) =>
  /^be$/i.test(word) || (lexicon(word)?.verbs.some((v) => v.form === "base") ?? false);
/** The word right before `index`, or "" when punctuation comes first. */
const wordBefore = (ctx: DetectContext, index: number) =>
  /(\p{L}[\p{L}'’]*)[ \t ]{1,8}$/u.exec(ctx.text.slice(Math.max(0, index - 40), index))?.[1] ?? "";
/** The word after `end`, or "" when punctuation or the end comes first. */
const wordAfter = (ctx: DetectContext, end: number) =>
  /^[ \t ]{1,8}(\p{L}[\p{L}'’]*)/u.exec(ctx.text.slice(end, end + 48))?.[1] ?? "";
const targetEnd = (m: RegExpExecArray) => m.indices!.groups!.target[1];
/** Only spaces and opening marks between `index` and a sentence stop, a line break or the start. */
const atSentenceStart = (ctx: DetectContext, index: number) =>
  /(?:^|[.!?\n])[ \t "“'‘(]*$/.test(ctx.text.slice(Math.max(0, index - 64), index));

const REFLEXIVE: Record<string, string> = {
  my: "myself",
  your: "yourself",
  his: "himself",
  her: "herself",
  its: "itself",
  our: "ourselves",
  their: "themselves",
};
// Programming languages; the capitalized ones are ordinary words in lower case.
const LANGUAGES =
  /^(?:python|javascript|typescript|php|haskell|kotlin|golang|fortran|pascal|cpp|csharp|objc|objective-c|assembler|assembly|asm|lisp|cobol|scala|elixir|erlang|clojure|lua|matlab|html|css|java|perl|c\+\+|c#|ocaml|f#|zig|nim|groovy|delphi|prolog|bash|powershell|sql|vba|solidity|dart|fsharp|racket|smalltalk|verilog|vhdl)$/i;
const CASED_LANGUAGES = /^(?:Go|C|Swift|Rust|Ruby|Julia|Ada|BASIC|R|Elm|Crystal|Scheme|Haxe)$/;
// Adjectives whose "of" takes a complement ("too proud of a son", "true of a dog").
const OF_COMPLEMENT =
  /^(?:much|many|more|most|less|least|little|few|full|sure|aware|unaware|afraid|proud|fond|capable|incapable|worthy|unworthy|free|clear|devoid|tired|sick|ashamed|jealous|envious|guilty|certain|conscious|ahead|wary|weary|scared|careful|critical|supportive|appreciative|indicative|reminiscent|typical|characteristic|representative|respectful|mindful|unsure|suspicious|tolerant|true|false|part|kind|sort|bit|lot|one|out|independent|deserving|east|west|north|south|outside|inside|instead|because|enough)$/i;
const OBJECT_NEXT =
  /^(?:me|you|him|her|us|them|it|people|the|a|an|my|your|his|our|their|this|that|these|those|millions|thousands|users|players|kids|children|teens|teenagers|\p{L}+self|\p{L}+selves)$/iu;
const ACQUIRE =
  /^(?:need|needs|needed|order|orders|ordered|use|uses|used|is|was|are|were|be|been|it['’]s|that['’]s|just|only|one|single|spare|another|the|this|that|got|get|buy|bought|received|borrowed|took|take|pulled|salvaged|replaced|requested|have|has|had)$/i;
const MANNER_PREV =
  /^(?:it|everything|all|play|plays|played|playing|go|goes|went|going|done|did|do|does|doing|things|stuff|run|runs|ran|running)$/i;
const SUPERLATIVE_BEFORE =
  /(?<!\p{L})(?:best|worst|top|favou?rite|most|least|\p{L}{2,}est)(?:[ \t ]+[^\s.!?,;:]+){0,3}[ \t ]+$/iu;
const ADJECTIVE_STOP =
  /^(?:who|whom|whose|that|which|and|or|but|to|of|for|in|on|with|at|from|by|as|is|was|are|were|has|had|have|will|would|can|could|may|might|should|must)$/i;
const NOUN_STOP =
  /^(?:if|in|on|at|to|for|with|by|of|and|or|but|so|as|when|after|before|until|then|again|too|the|a|an|this|that|just|now|here|there)$/i;
const nounLike = (word: string) => {
  if (!word || NOUN_STOP.test(word)) return false;
  const info = lexicon(word);
  return info ? info.noun || info.plural : word.length > 6;
};
const DEGREE =
  /^(?:more|most|less|least|very|so|too|quite|really|pretty|same|and|or|but|also|extremely|super|particularly|especially|fairly|safe)$/i;

const FRAMES: readonly Frame[] = [
  // "after 2 years later": one of the two time words goes.
  {
    rule: PHRASE,
    pattern: `(?<target>after${S}(?:(?:about|exactly|almost|nearly|roughly|around|approximately|just|over|only|another)${S})?(?:an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|fifty|a${S}few|a${S}couple${S}(?:of${S})?|few|several|many|[0-9]{1,4})${S}(?:more${S})?(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?|decades?|moments?|century|centuries)${S}later)${E}`,
    verbatim: true,
    fix: (m) => {
      const typed = m.groups!.target;
      const withoutLater = typed.replace(/[ \t ]+\S+$/, "");
      let withoutAfter = typed.replace(/^\S+[ \t ]+/, "");
      if (/^AFTER/.test(typed)) withoutAfter = withoutAfter.toUpperCase();
      else if (/^A/.test(typed))
        withoutAfter = withoutAfter.replace(/\p{L}/u, (c) => c.toUpperCase());
      // With a qualifier ("after about a year later") the phrase reads as "about a year later".
      const qualified =
        /^\S+[ \t ]+(?:about|exactly|almost|nearly|roughly|around|approximately|just|over|only|another|an?)[ \t ]/iu.test(
          typed,
        );
      return qualified ? [withoutAfter, withoutLater] : [withoutLater, withoutAfter];
    },
  },
  {
    rule: PHRASE,
    pattern: `(?<target>a${S}part${S}from)${E}`,
    fix: (m, ctx) => {
      const prev = wordBefore(ctx, m.index);
      const info = prev ? lexicon(prev) : null;
      if (ACQUIRE.test(prev) || (info && info.verbs.length && !info.noun && !info.adverb))
        return null;
      return ["apart from", "a part of"];
    },
  },
  {
    rule: PHRASE,
    // "changes a word apart form one fix": a distance, then the verb "form".
    pattern: `(?<!(?<![\\p{L}'’])(?:a|an|one|two|three|few|several|[0-9]+)${S}\\p{L}+${S})apart(?:${S}|[ \\t\\u00a0]*\\r?\\n[ \\t\\u00a0]*)(?<target>form)${E}`,
    fix: "from",
  },
  // "amounts for the total" → "amounts to"; "accounts for" when it explains a share.
  {
    rule: PHRASE,
    pattern: `(?:that|which|this|it|they|would|will|should|can|could|may|might|must|does|do|did|not)${S}(?<target>(?<verb>amount|amounts|amounted|amounting)${S}for)${E}(?!${S}(?:each|every|all|both|any)${E})`,
    fix: (m) => {
      const verb = m.groups!.verb.toLowerCase();
      return [`${verb} to`, `${verb.replace("amount", "account")} for`];
    },
  },
  {
    rule: PREPOSITION,
    // englishPrepositions.ts owns "arrived to the office|station|airport|hotel".
    pattern: `(?:arrive|arrives|arriving|arrived(?!${S}to${S}the${S}(?:office|station|airport|hotel)${E}))${S}(?<target>to)${E}`,
    fix: (m, ctx) => (verbBase(wordAfter(ctx, targetEnd(m))) ? null : ["at", "in"]),
  },
  // "accused them for lying" → "of"; "the accused for a murder case" is a noun.
  {
    rule: PREPOSITION,
    pattern: `(?<!(?<![\\p{L}'’])the${S})(?:accuse|accuses|accused|accusing)(?:${S}(?:me|you|him|her|us|them|it|someone|everyone|people))?${S}(?<target>for)${E}`,
    fix: (m, ctx) => {
      const next = wordAfter(ctx, targetEnd(m));
      return !next || /ing$|^(?:it|this|that|something|anything|nothing|everything)$/i.test(next)
        ? "of"
        : null;
    },
  },
  // "Aspire" mid-sentence names a product.
  {
    rule: PREPOSITION,
    pattern: `(?<verb>aspire|aspires|aspired|aspiring)${S}(?<target>for)${E}`,
    fix: (m, ctx) => (/^[a-z]/.test(m.groups!.verb) || atSentenceStart(ctx, m.index) ? "to" : null),
  },
  // Progressive "ask/tell to him": no "to" before the person told.
  {
    rule: PREPOSITION,
    pattern: `(?:ask|asks|asking|tell|tells|telling)(?<target>${S}to)${S}(?:me|you|him|her|us|them|it|one)${E}(?!${S}(?:of|side|another)${E})(?=${S}[\\p{L}"“'‘~])`,
    fix: "",
  },
  {
    rule: PREPOSITION,
    pattern: `(?=asked|told)(?<!(?<![\\p{L}'’])(?:was|were|is|are|be|been|being|get|got|gets|getting)${S}(?:\\p{L}+ly${S}|often${S}|always${S}|never${S}|not${S}|also${S}|already${S})?)(?:asked|told)(?<target>${S}to)${S}(?:me|you|him|her|us|them|it|one)${E}(?!${S}(?:of|side|another)${E})(?=${S}[\\p{L}"“'‘~])`,
    fix: "",
  },
  {
    rule: PREPOSITION,
    pattern: `(?:curious|unsure|uncertain|unclear|clueless|confused)${S}(?<target>to)${S}(?:how|what|when|where|whether|which|who|whom|why)${E}(?!${S}(?:degree|extent)${E})`,
    fix: "as to",
  },
  {
    rule: PREPOSITION,
    pattern: `(?<!(?<![\\p{L}'’])(?:such|well|same|seeing|being|just|much|exactly|precisely|similar|not|known|so|is|was|it|that|this|as|far)${S})(?<target>as${S})how${E}`,
    fix: "as to ",
  },
  {
    rule: PREPOSITION,
    pattern: `(?<plural>claims?)${S}(?<target>for)${S}fame${E}`,
    fix: (m, ctx) =>
      /(?<!\p{L})(?:make|makes|made|making)(?:[ \t ]+\S+){0,2}[ \t ]+$/iu.test(
        ctx.text.slice(Math.max(0, m.index - 48), m.index),
      )
        ? null
        : "to",
  },
  {
    rule: PREPOSITION,
    pattern: `(?:code|codes|coded|coding|write|writes|wrote|written|writing|program|programmed|programming)${S}(?<target>on)${S}(?<lang>\\p{L}[\\p{L}+#-]*)(?<language>${S}language)?(?![\\p{L}\\p{N}_'’@/\\\\])`,
    targetOnly: true,
    fix: (m) => {
      const { lang, language } = m.groups!;
      return language || LANGUAGES.test(lang) || CASED_LANGUAGES.test(lang) ? "in" : null;
    },
  },
  {
    rule: PHRASE,
    pattern: `(?<target>(?:seiz|siez)(?<ending>e|es|ed|ing))${S}to${S}(?<verb>\\p{L}+)${E}`,
    fix: (m) => (verbBase(m.groups!.verb) ? `ceas${m.groups!.ending.toLowerCase()}` : null),
  },
  {
    rule: PHRASE,
    // "make her complain" keeps the verb: "her" is also an object.
    pattern: `(?:a|the|my|your|his|our|their|any|another|each|every)${S}(?<target>complain)${E}`,
    fix: (m, ctx) => (nounLike(wordAfter(ctx, targetEnd(m))) ? null : "complaint"),
  },
  {
    rule: PHRASE,
    pattern: `(?:the|many|some|several|these|those|my|your|his|her|our|their|no|any|few|multiple)${S}(?<target>complains)${E}`,
    fix: "complaints",
  },
  {
    rule: PHRASE,
    pattern: `(?:feel|feels|felt|feeling|am|is|are|was|were|be|been|being|sound|sounds|sounded|seem|seems|seemed|look|looks|looked|very|so|too|quite|more|most|less|really|extremely|fully|pretty|remain|remains|remained|stay|stays|stayed|i['’]m|you['’]re|we['’]re|they['’]re|he['’]s|she['’]s)${S}(?<target>confidant)${E}(?!${S}(?:of|to)${E})`,
    fix: "confident",
  },
  {
    rule: PHRASE,
    pattern: `(?:a|an)${S}(?<target>confidant)${E}`,
    fix: (m, ctx) => {
      const next = /^,?[ \t ]{1,8}(\p{L}+)/u.exec(
        ctx.text.slice(targetEnd(m), targetEnd(m) + 40),
      )?.[1];
      if (!next || ADJECTIVE_STOP.test(next) || /^\p{Lu}/u.test(next)) return null;
      const info = lexicon(next);
      return info && (info.adjective || info.noun) ? "confident" : null;
    },
  },
  {
    rule: PHRASE,
    pattern: `(?<target>(?<conjunction>and|an|or)${S}(?:the${S}likes|the${S}alikes?|alikes))${E}(?!${S}of${E})(?!['’])`,
    fix: (m) => `${/^or$/i.test(m.groups!.conjunction) ? "or" : "and"} the like`,
  },
  {
    rule: PHRASE,
    pattern: `(?:and|or)${S}(?<target>alike)(?:${COMPLETE}|(?=["”)]))`,
    fix: "the like",
  },
  {
    rule: PHRASE,
    pattern: `of${S}all${S}(?<target>times)${E}`,
    fix: (m, ctx) =>
      SUPERLATIVE_BEFORE.test(ctx.text.slice(Math.max(0, m.index - 80), m.index)) ? "time" : null,
  },
  {
    rule: PHRASE,
    pattern: `(?<target>on)${S}(?:(?:complete|happy|literal|mere|pure|sheer|total)${S})?accident${E}`,
    fix: (m, ctx) => (nounLike(wordAfter(ctx, m.index + m[0].length)) ? null : "by"),
  },
  {
    rule: PHRASE,
    pattern: `back${S}in${S}the${S}(?<target>days)${E}(?!${S}(?:of|when|where|that|before|after|I|we|you|he|she|they)${E})(?![ \\t]*['’])`,
    fix: "day",
  },
  {
    rule: PHRASE,
    pattern: `(?<target>by${S}(?<owner>my|your|his|her|its|our|their)${S}own)(?=["”'’]?[ \\t\\u00a0]{0,8}(?:[.!?,;:)]|$))`,
    fix: (m) => {
      const owner = m.groups!.owner.toLowerCase();
      return [`on ${owner} own`, `by ${REFLEXIVE[owner]}`];
    },
  },
  {
    rule: PHRASE,
    pattern: `by${S}the${S}(?<target>books)${E}(?!['’])`,
    fix: (m, ctx) => (MANNER_PREV.test(wordBefore(ctx, m.index)) ? "book" : null),
  },
  // "call it Quit", "call it quit()" name something.
  {
    rule: PHRASE,
    pattern: `(?:call|calls|called|calling)${S}it${S}(?<target>quit)${E}(?![(\\[])`,
    fix: (m) => (m.groups!.target === "quit" ? "quits" : null),
  },
  {
    rule: PHRASE,
    pattern: `(?:call|calls|called|calling)${S}(?:them|it|this|that|her|him|you|me|us|everyone|everybody|these|those)(?<target>${S}as)${E}(?!${S}(?:I|you|he|she|it|we|they|it['’]s|is|are|was|were|needed|appropriate|necessary|required|such|well|follows|soon|long|much|many|if|though|usual|usually|expected|before|normal|normally|shown|described|documented|intended|below|above|planned|agreed|promised|scheduled|root|admin|sudo|async|part|a${S}(?:function|method|command|script|callback|module|subroutine|program|library|service|user|parameter|constructor|class|decorator|hook|task|job|process|thread|coroutine)|an${S}(?:argument|admin|administrator|async|object|instance|action|event|endpoint)|the${S}(?:same|first|last|user|root|admin|owner|main|default))${E})`,
    fix: "",
  },
  {
    rule: PHRASE,
    pattern: `(?:has|have|had|having)${S}(?<target>ways)${S}to${S}go${E}(?!${S}(?:about|back|around|through|forward|up|down|out|over|into|beyond|from|ahead|home|there|online|offline)${E})`,
    fix: ["a long way", "a ways"],
  },
  // "better off served": "better served", or "better off" before what would be better.
  {
    rule: PHRASE,
    pattern: `(?<target>better${S}off${S}served)${E}`,
    fix: (m, ctx) => {
      // "better off served cold": the dish is served cold.
      const next = wordAfter(ctx, targetEnd(m));
      const info = lexicon(next);
      return info?.adjective && !info.adverb && !info.verbs.length && !/^(?:just|only)$/i.test(next)
        ? null
        : ["better served", "better off"];
    },
  },
  // A store that is convenient ("a convenient store for messages") is ordinary English.
  {
    rule: PHRASE,
    pattern: `(?<target>convenient)${S}(?<store>stores?)${E}(?!${S}(?:for|than|that|which|whose)${E})`,
    fix: (m, ctx) => {
      if (/^Convenient$/.test(m.groups!.target) && /^Store/.test(m.groups!.store))
        return "convenience";
      const next = wordAfter(ctx, m.index + m[0].length);
      return DEGREE.test(wordBefore(ctx, m.index)) || nounLike(next) ? null : "convenience";
    },
  },
  // ---- Style advice (off by default). ----
  {
    rule: STYLED,
    pattern: `(?:a|an|is|are|was|were|be|been|being|so|very|highly|extremely|super|quite|really|too|incredibly|insanely|pretty|and|of|most|more|less|least|seriously|surprisingly|strangely|oddly|ridiculously|dangerously|kinda)${S}(?<target>addicting)${E}`,
    fix: (m, ctx) => (OBJECT_NEXT.test(wordAfter(ctx, targetEnd(m))) ? null : "addictive"),
  },
  // "too big of a deal" → "too big a deal".
  {
    rule: STYLED,
    pattern: `(?:too|that|as|so|how)${S}(?<adjective>\\p{L}+)${S}(?<target>of${S})(?=an?${E})`,
    fix: (m) => {
      const word = m.groups!.adjective;
      return !OF_COMPLEMENT.test(word) && lexicon(word)?.adjective ? "" : null;
    },
  },
  // "barely unconscious" says the opposite of the "barely conscious" it means.
  {
    rule: STYLED,
    pattern: `barely${S}(?<target>un)(?<stem>\\p{L}{3,})${E}`,
    fix: (m) => {
      const stem = lexicon(m.groups!.stem);
      if (!stem || /^(?:til|der|less|to)$/i.test(m.groups!.stem)) return null;
      const plain = !stem.noun && !stem.plural && !stem.adverb && !stem.verbs.length;
      return stem.adjective || plain || stem.verbs.some((v) => v.form === "participle") ? "" : null;
    },
  },
  {
    rule: STYLED,
    pattern: `(?:am|is|are|was|were|be|been|i['’]m|you['’]re|we['’]re|they['’]re|he['’]s|she['’]s)(?:${S}(?:really|still|always|just|so|now|also))?${S}craving(?<target>${S}for)${E}`,
    fix: "",
  },
];

function recase(typed: string, alternative: string): string {
  if (typed.length > 1 && /\p{L}/u.test(typed) && typed === typed.toUpperCase())
    return alternative.toUpperCase();
  return /^\P{L}*\p{Lu}/u.test(typed)
    ? alternative.replace(/\p{L}/u, (c) => c.toUpperCase())
    : alternative;
}

function detectFrames(ctx: DetectContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const { rule, pattern, fix, verbatim, targetOnly } of FRAMES) {
    if (ctx.rules && !ctx.rules.has(rule.ruleId)) continue;
    for (const m of frameMatches(ctx, pattern)) {
      const [start, end] = m.indices!.groups!.target;
      const typed = ctx.text.slice(start, end);
      if (hasUserOrCasedWord(ctx, targetOnly ? typed : m[0])) continue;
      const value = typeof fix === "function" ? fix(m, ctx) : fix;
      if (value === null) continue;
      const alternatives = [value].flat().map((alt) => (verbatim ? alt : recase(typed, alt)));
      findings.push({
        ...rule,
        range: { start, end },
        alternatives,
        ...(alternatives.length > 1 ? { requiresChoice: true as const } : {}),
        context: {
          start: Math.max(0, m.index - 40),
          end: Math.min(ctx.text.length, m.index + m[0].length + 20),
        },
      });
    }
  }
  return findings;
}

/** Context detectors appended to REVIEW_DETECTORS. */
export const DETECTORS: readonly ReviewDetectorEntry[] = [
  {
    rules: ["englishPhraseCorrections", "englishFixedPrepositions", "stylePhrasing"],
    detect: (ctx) => (isLang(ctx, "en") ? detectFrames(ctx) : []),
  },
];
