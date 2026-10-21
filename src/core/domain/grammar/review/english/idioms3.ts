import { englishWordInfo, hasVerbForm } from "../../implementations/helpers/EnglishLexicon";
import { group, nextWord } from "../phraseTemplates";
import type { DetectContext } from "../reviewDetectors";
import type { Fixer } from "../../engine/reviewRules";

// ---- Context detectors: forms that are also ordinary English elsewhere. ----

const verbBase = (word: string) => /^be$/i.test(word) || hasVerbForm(word, "base");
/** The word right before `index`, or "" when punctuation comes first. */
const wordBefore = (ctx: DetectContext, index: number) =>
  /(\p{L}[\p{L}'’]*)[ \t ]{1,8}$/u.exec(ctx.text.slice(Math.max(0, index - 40), index))?.[1] ?? "";
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
  const info = englishWordInfo(word);
  return info ? info.noun || info.plural : word.length > 6;
};
const DEGREE =
  /^(?:more|most|less|least|very|so|too|quite|really|pretty|same|and|or|but|also|extremely|super|particularly|especially|fairly|safe)$/i;

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  // "after 2 years later": one of the two time words goes.
  idioms3After: (m) => {
    const typed = m.groups!.target;
    const withoutLater = typed.replace(/[ \t ]+\S+$/, "");
    let withoutAfter = typed.replace(/^\S+[ \t ]+/, "");
    if (/^AFTER/.test(typed)) withoutAfter = withoutAfter.toUpperCase();
    else if (/^A/.test(typed))
      withoutAfter = withoutAfter.replace(/^\p{L}/u, (c) => c.toUpperCase());
    // With a qualifier ("after about a year later") the phrase reads as "about a year later".
    const qualified =
      /^\S+[ \t ]+(?:about|exactly|almost|nearly|roughly|around|approximately|just|over|only|another|an?)[ \t ]/iu.test(
        typed,
      );
    return qualified ? [withoutAfter, withoutLater] : [withoutLater, withoutAfter];
  },
  idioms3A: (m, ctx) => {
    const prev = wordBefore(ctx, m.index);
    const info = prev ? englishWordInfo(prev) : null;
    if (ACQUIRE.test(prev) || (info && info.verbs.length && !info.noun && !info.adverb))
      return null;
    return ["apart from", "a part of"];
  },
  // "amounts for the total" → "amounts to"; "accounts for" when it explains a share.
  idioms3Verb: (m) => {
    const verb = m.groups!.verb.toLowerCase();
    return [`${verb} to`, `${verb.replace("amount", "account")} for`];
  },
  idioms3To: (m, ctx) => (verbBase(nextWord(ctx, group(m, "target")[1])) ? null : ["at", "in"]),
  // "accused them for lying" → "of"; "the accused for a murder case" is a noun.
  idioms3For: (m, ctx) => {
    const next = nextWord(ctx, group(m, "target")[1]);
    return !next || /ing$|^(?:it|this|that|something|anything|nothing|everything)$/i.test(next)
      ? "of"
      : null;
  },
  // "Aspire" mid-sentence names a product.
  idioms3For2: (m, ctx) =>
    /^[a-z]/.test(m.groups!.verb) || atSentenceStart(ctx, m.index) ? "to" : null,
  idioms3For3: (m, ctx) =>
    /(?<!\p{L})(?:make|makes|made|making)(?:[ \t ]+\S+){0,2}[ \t ]+$/iu.test(
      ctx.text.slice(Math.max(0, m.index - 48), m.index),
    )
      ? null
      : "to",
  idioms3On: (m) => {
    const { lang, language } = m.groups!;
    return language || LANGUAGES.test(lang) || CASED_LANGUAGES.test(lang) ? "in" : null;
  },
  idioms3Seiz: (m) => (verbBase(m.groups!.verb) ? `ceas${m.groups!.ending.toLowerCase()}` : null),
  idioms3Complain: (m, ctx) =>
    nounLike(nextWord(ctx, group(m, "target")[1])) ? null : "complaint",
  idioms3Confidant: (m, ctx) => {
    const next = /^,?[ \t ]{1,8}(\p{L}+)/u.exec(
      ctx.text.slice(group(m, "target")[1], group(m, "target")[1] + 40),
    )?.[1];
    if (!next || ADJECTIVE_STOP.test(next) || /^\p{Lu}/u.test(next)) return null;
    const info = englishWordInfo(next);
    return info && (info.adjective || info.noun) ? "confident" : null;
  },
  idioms3Conjunction: (m) => `${/^or$/i.test(m.groups!.conjunction) ? "or" : "and"} the like`,
  idioms3Times: (m, ctx) =>
    SUPERLATIVE_BEFORE.test(ctx.text.slice(Math.max(0, m.index - 80), m.index)) ? "time" : null,
  idioms3On2: (m, ctx) => (nounLike(nextWord(ctx, m.index + m[0].length)) ? null : "by"),
  idioms3By: (m) => {
    const owner = m.groups!.owner.toLowerCase();
    return [`on ${owner} own`, `by ${REFLEXIVE[owner]}`];
  },
  idioms3Books: (m, ctx) => (MANNER_PREV.test(wordBefore(ctx, m.index)) ? "book" : null),
  // "call it Quit", "call it quit()" name something.
  idioms3Quit: (m) => (m.groups!.target === "quit" ? "quits" : null),
  // "better off served": "better served", or "better off" before what would be better.
  idioms3Better: (m, ctx) => {
    // "better off served cold": the dish is served cold.
    const next = nextWord(ctx, group(m, "target")[1]);
    const info = englishWordInfo(next);
    return info?.adjective && !info.adverb && !info.verbs.length && !/^(?:just|only)$/i.test(next)
      ? null
      : ["better served", "better off"];
  },
  // A store that is convenient ("a convenient store for messages") is ordinary English.
  idioms3Convenient: (m, ctx) => {
    if (/^Convenient$/.test(m.groups!.target) && /^Store/.test(m.groups!.store))
      return "convenience";
    const next = nextWord(ctx, m.index + m[0].length);
    return DEGREE.test(wordBefore(ctx, m.index)) || nounLike(next) ? null : "convenience";
  },
  // ---- Style advice (off by default). ----
  idioms3Addicting: (m, ctx) =>
    OBJECT_NEXT.test(nextWord(ctx, group(m, "target")[1])) ? null : "addictive",
  // "too big of a deal" → "too big a deal".
  idioms3Of: (m) => {
    const word = m.groups!.adjective;
    return !OF_COMPLEMENT.test(word) && englishWordInfo(word)?.adjective ? "" : null;
  },
  // "barely unconscious" says the opposite of the "barely conscious" it means.
  idioms3Un: (m) => {
    const stem = englishWordInfo(m.groups!.stem);
    if (!stem || /^(?:til|der|less|to)$/i.test(m.groups!.stem)) return null;
    const plain = !stem.noun && !stem.plural && !stem.adverb && !stem.verbs.length;
    return stem.adjective || plain || stem.verbs.some((v) => v.form === "participle") ? "" : null;
  },
} satisfies Record<string, Fixer>;
