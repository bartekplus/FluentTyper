import { englishLemma } from "../../implementations/helpers/EnglishInflection";
import { englishWordInfo, hasVerbForm } from "../../implementations/helpers/EnglishLexicon";
import { englishVerbForms } from "../../implementations/helpers/EnglishVerbForms";
import { englishNounForms, hasCountPrefix } from "../../implementations/helpers/EnglishNounNumber";
import { FEELING_VERBS } from "../englishAuxiliaryForms";
import { SPECIALIST } from "../englishCountability";
import { doubledDegree } from "../englishDegree";
import {
  around,
  caseLike,
  detectAll,
  found,
  hasUserOrCasedWord,
  nextLowerWord,
  PSEUDO_CLEFT_BEFORE,
  SPACE,
  WORD_END,
} from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import type { FindingsFilter, MatchFixer } from "../../engine/reviewRules";
import { finding } from "../finding";
import { namedExampleBefore } from "../exampleCues";
import { objectGapBefore } from "./slotWords";

// ---------------------------------------------------------------------------- helpers

const atClauseStart = (ctx: DetectContext, index: number) => {
  const before = ctx.text.slice(Math.max(0, index - 96), index);
  return (
    (index <= 96 && /^[ \t\u00a0]*$/.test(before)) ||
    /(?:[.!?;:"“]|\n[ \t\u00a0]*\n)[ \t\u00a0\n]*$/.test(before)
  );
};

/** The base of a past or participle form that is not itself a base ("went", "needed"). */
function pastLemma(word: string): string | null {
  const w = word.toLowerCase();
  const irregular = englishVerbForms(w);
  if (irregular)
    return w !== irregular.lemma && (w === irregular.past || w === irregular.participle)
      ? irregular.lemma
      : null;
  if (!w.endsWith("ed")) return null;
  const info = englishWordInfo(w);
  if (!info || info.noun || info.verbs.some((v) => v.form === "base")) return null;
  return englishLemma(w, "past");
}

const isParticiple = (word: string) => {
  const w = word.toLowerCase();
  const irregular = englishVerbForms(w);
  return irregular ? w === irregular.participle && w !== irregular.lemma : !!pastLemma(w);
};

// ---------------------------------------------------------------------------- degree

const IRREGULAR_DEGREE = new Set(["better", "best", "worse", "worst", "farther", "farthest"]);

/** A comparative or superlative adjective ("faster", "easiest", "bigger", "best"). */
function graded(word: string): boolean {
  if (IRREGULAR_DEGREE.has(word)) return true;
  const suffix = /est$/.test(word) ? 3 : /er$/.test(word) ? 2 : 0;
  if (!suffix || word.length < suffix + 2) return false;
  const info = englishWordInfo(word);
  if (!info || info.noun || info.verbs.length) return false;
  const stem = word.slice(0, -suffix);
  const stems = [stem, `${stem}e`, stem.replace(/i$/, "y"), stem.replace(/(.)\1$/, "$1")];
  return stems.some((s) => englishWordInfo(s)?.adjective);
}

/** Known to the dictionary as neither a noun nor a verb ("bigger", "cuter"). */
function plainWord(word: string): boolean {
  const info = englishWordInfo(word);
  return !!info && !info.noun && !info.verbs.length;
}

/** The one-word comparative of a base adjective, when the dictionary has one. */
function comparative(word: string): string[] {
  if (word === "bad") return ["worse"];
  if (word === "far") return ["farther", "further"];
  // Short adjectives only: "more robust", "more often" are standard.
  const syllables =
    (word.replace(/e$/, "").match(/[aeiouy]+/g)?.length ?? 0) + (/[^aeiou]le$/.test(word) ? 1 : 0);
  if (syllables > (word.endsWith("y") ? 2 : 1) || !englishWordInfo(word)?.adjective) return [];
  return [
    `${word}er`,
    `${word}r`,
    word.replace(/y$/, "ier"),
    word.replace(/([^aeiou][aeiou])([bdgmnpt])$/, "$1$2$2er"),
  ]
    .filter((form, i, all) => form !== word && all.indexOf(form) === i && plainWord(form))
    .slice(0, 1);
}

/**
 * The comparison ends where the clause shows it: a mark, "than" + a word, "to" + a verb, a
 * verb, or one singular noun. "more older workers" counts workers; unknown words abstain.
 */
function finishedComparison(ctx: DetectContext, start: number, end: number): boolean {
  const tail = ctx.text.slice(end, end + 48);
  if (/^[ \t\u00a0]*(?:[.!?,;:]|$)/.test(tail) && tail.length < 48) return true;
  // "a most best quality file": one thing, so "most" cannot count.
  if (/\ban?[ \t\u00a0]+$/i.test(ctx.text.slice(Math.max(0, start - 8), start))) return true;
  const [, next, after] = /^[ \t\u00a0]+([A-Za-z]+)(?:[ \t\u00a0]+([A-Za-z]+))?/.exec(tail) ?? [];
  if (!next || next !== next.toLowerCase()) return false;
  if (next === "than") return !!after;
  // "most better for me": a preposition closes the phrase too.
  if (/^(?:for|with|in|on|at|by|from|about)$/.test(next)) return true;
  if (next === "to") return hasVerbForm(after ?? "", "base");
  if (/^(?:is|are|was|were)$/.test(next)) return true;
  if (FUNCTION_WORDS.test(next)) return false;
  const info = englishWordInfo(next);
  return !!info?.noun && !info.plural;
}

// The core frames own their matches; the doubled-degree frame adds the rest. Read once a chunk.
const CORE_DEGREE = new WeakMap<DetectContext, Set<number>>();
function coreDegree(ctx: DetectContext): Set<number> {
  let starts = CORE_DEGREE.get(ctx);
  if (!starts) {
    starts = new Set(doubledDegree(ctx).map((f) => f.range.start));
    CORE_DEGREE.set(ctx, starts);
  }
  return starts;
}

// ---------------------------------------------------------------------------- verb forms

// "What I did changed everything": did ends a noun clause.
const NOUN_CLAUSE =
  /\b(?:what|whatever|everything|anything|something|nothing|all|thing|things)\b(?:[ \t ]+[\p{L}'’]+){0,3}[ \t ]+$/iu;

/** "did went", "didn't saw", "helped made": do-support and help take a base verb. */
function auxiliaryBase(m: RegExpExecArray, ctx: DetectContext, isDid: boolean): string | null {
  // Owned by "did"/"helped": the auxiliary is the evidence, so a scope without it abstains.
  if (m.index < ctx.from || m.index >= ctx.to) return null;
  const verb = m.groups!.target;
  const lemma = pastLemma(verb);
  if (!lemma || verb !== verb.toLowerCase() || hasUserOrCasedWord(ctx, verb)) return null;
  // "should've helped given that…": "given" works as a preposition.
  if (!isDid && (/^(?:do|have|be)$/.test(lemma) || verb.toLowerCase() === "given")) return null;
  if (isDid && NOUN_CLAUSE.test(ctx.text.slice(Math.max(0, m.index - 48), m.index))) return null;
  if (isDid && /^(?:supposed|used)$/.test(verb.toLowerCase())) return null;
  // "did not found any towns": found/ground/wound are base verbs too; "didn't found it"
  // still gets the fix.
  if (
    isDid &&
    /^(?:found|ground|wound)$/.test(verb) &&
    !/^(?:it|them|him|her|me|us|you)$/.test(nextLowerWord(ctx, m.index + m[0].length))
  )
    return null;
  // "The survey we did showed…": did closes a relative clause after a noun. A time word
  // is no head ("Yesterday I did showed").
  const before = ctx.text.slice(Math.max(0, m.index - 48), m.index);
  if (
    isDid &&
    !m.groups!.negated &&
    objectGapBefore(before) &&
    !/\b(?:yesterday|today|tonight|tomorrow|now|then|once|sometimes|finally)[ \t ]+\S+[ \t ]+$/i.test(
      before,
    )
  )
    return null;
  // "Did you bored?" asks with be: englishAuxiliaryForms offers "Were you bored".
  if (
    isDid &&
    FEELING_VERBS.has(lemma) &&
    /^did(?:n['’]?t)?[ \t ]+(?:I|you|he|she|it|we|they)\b/i.test(m[0])
  )
    return null;
  // Affirmative "did" is also the main verb ("They did needed repairs", "The new server
  // did logged it"): it needs a pronoun subject, or "Did" opening the clause, and an object.
  const after = nextLowerWord(ctx, m.index + m[0].length);
  // "I did wanted catch it": a bare verb after the participle is no object either.
  const verbNext = !!after && !FUNCTION_WORDS.test(after) && hasVerbForm(after, "base");
  if (isDid && !m.groups!.negated) {
    const subject = /([A-Za-z]+)[ \t ]+$/.exec(
      ctx.text.slice(Math.max(0, m.index - 24), m.index),
    )?.[1];
    const opens = atClauseStart(ctx, m.index) && /^Did$/.test(m[0].slice(0, 3));
    if (!opens && !/^(?:I|you|he|she|it|we|they|this|that|i)$/.test(subject ?? "")) return null;
    if (
      !opens &&
      !/^[ \t ]+(?:it|them|him|her|us|me|this|that|the|a|an|my|your|his|its|our|their|to)\b/i.test(
        ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 12),
      ) &&
      !verbNext
    )
      return null;
  }
  if (isDid && englishWordInfo(verb)?.adjective && englishWordInfo(after)?.noun && !verbNext)
    return null;
  return lemma;
}

// Irregular plurals that englishNounForms does not have. Regularized forms ("childs",
// "eated") are left to Review's dictionary spelling check, which already offers the
// irregular form first.
const IRREGULAR_PLURALS: Record<string, string> = {
  foot: "feet",
  elf: "elves",
  hero: "heroes",
  echo: "echoes",
  veto: "vetoes",
  torpedo: "torpedoes",
};

// ---------------------------------------------------------------------------- agreement

const PLURAL_COUNT = `(?:these|those|several|many|both|few|multiple|various|numerous|two|three|four|five|six|seven|eight|nine|ten|[2-9]|[1-9][0-9]+)`;
const MODIFIER = `(?:(?!(?:of|the|a|an|this|that|which|and|or|to)${WORD_END})\\(?[A-Za-z][A-Za-z-]*\\)?)`;
// An ellipsis may open the phrase ("...one criteria"), so these start at any non-word character.
const LOOSE_START = "(?<![\\p{L}\\p{N}_'’@/#\\\\-])";
const PLURAL_BEFORE = new RegExp(
  `${LOOSE_START}${PLURAL_COUNT}(?:${SPACE}${MODIFIER}){0,3}${SPACE}$`,
  "iu",
);
const SINGLE_BEFORE = new RegExp(
  `${LOOSE_START}(?:one|this|each|every|single|(?<that>that))${SPACE}$`,
  "iu",
);

// ---------------------------------------------------------------------------- countability

/** Uncountable nouns, the count word that measures them, and countable synonyms. */
const MASS: Record<string, { unit: string; count?: readonly [string, string][] }> = {
  advice: {
    unit: "piece of",
    count: [
      ["tip", "tips"],
      ["suggestion", "suggestions"],
    ],
  },
  information: { unit: "piece of" },
  info: { unit: "piece of" },
  furniture: { unit: "piece of" },
  luggage: {
    unit: "piece of",
    count: [
      ["suitcase", "suitcases"],
      ["bag", "bags"],
    ],
  },
  baggage: { unit: "piece of", count: [["bag", "bags"]] },
  equipment: { unit: "piece of" },
  evidence: { unit: "piece of" },
  feedback: { unit: "piece of" },
  software: {
    unit: "piece of",
    count: [
      ["application", "applications"],
      ["software package", "software packages"],
    ],
  },
  firmware: { unit: "piece of" },
  hardware: { unit: "piece of" },
  malware: { unit: "piece of" },
  ransomware: { unit: "piece of" },
  clothing: { unit: "item of", count: [["garment", "garments"]] },
  punctuation: { unit: "punctuation mark", count: [["punctuation mark", "punctuation marks"]] },
};
const SINGLE = "(?<single>an?|one|another|each|every|single)";
const SEVERAL = `(?<several>(?<how>how${SPACE}|so${SPACE}|too${SPACE})?many|(?<afew>a${SPACE})?few|fewer|several|multiple|both|numerous|two|three|four|five|six|seven|eight|nine|ten|[2-9]|[1-9][0-9]+)`;
const COUNTED_BEFORE = new RegExp(`(?<![\\p{L}\\p{N}_'’-])(?:${SINGLE}|${SEVERAL})${SPACE}$`, "iu");
const JUDGED_BEFORE = new RegExp(
  `(?:(?:kind|sort|type)${SPACE}of|(?<!(?:${PLURAL_COUNT}|the|a|an|my|your|our|their|his|her|these|those)${SPACE})(?:bad|good|great|wise|sound|terrible|wrong|conflicting))${SPACE}$`,
  "iu",
);
const ARTICLE_EXEMPT = /\b(?:payment|remittance|shipping|credit|debit|legal)[ \t ]+$/i;
const plural = (unit: string) =>
  unit
    .replace(/^(\w+)/, (word) => (word === "piece" || word === "item" ? `${word}s` : word))
    .replace(/mark$/, "marks");

const FUNCTION_WORDS =
  /^(?:would|could|should|will|can|may|might|must|is|are|was|were|has|have|had|do|does|did|to|for|with|of|in|on|at|by|from|about|into|than|that|which|who|and|or|but|as|so|if|when|while|because|you|i|we|they|he|she|it|this|these|those)$/;

/** The next word continues a compound noun ("a software engineer", "a software rendered game"). */
function compoundHead(ctx: DetectContext, end: number): boolean {
  const next = nextLowerWord(ctx, end);
  if (!next || FUNCTION_WORDS.test(next)) return false;
  const info = englishWordInfo(next);
  // The lexicon leaves long plain nouns out ("component").
  if (!info) return next.length > 5;
  if (pastLemma(next)) {
    const after = nextLowerWord(ctx, end + ctx.text.slice(end).indexOf(next) + next.length);
    return !!after && !FUNCTION_WORDS.test(after) && !!englishWordInfo(after)?.noun;
  }
  // A noun after it heads the compound ("a software engineer", "a information frames").
  return info.noun || info.plural;
}

/** "softwares", "bad advices": a plural of an uncountable noun loses its "s". */
function massPlural(m: RegExpExecArray, ctx: DetectContext): string | null {
  const noun = m.groups!.noun;
  if (noun !== noun.toLowerCase() || hasUserOrCasedWord(ctx, m[0])) return null;
  if (ARTICLE_EXEMPT.test(ctx.text.slice(Math.max(0, m.index - 16), m.index))) return null;
  if (SPECIALIST.test(ctx.text.slice(Math.max(0, m.index - 128), m.index + m[0].length + 128)))
    return null;
  if (compoundHead(ctx, m.index + m[0].length)) return null;
  return noun.slice(0, -1);
}

// ---------------------------------------------------------------------------- noun number

const TAILS =
  /^(?:is|was|has|had|does|did|can|could|will|would|should|must|that|which|who|where|with|in|on|at|of|for|to|from|and|or)$/;
const COLLECTIVE =
  /^(?:family|team|crew|gang|staff|group|band|crowd|audience|public|committee|club|party|class|army|jury|best|most|few|same|other|kind|sort|type|lot)$/;
// Words that end the search for the noun: a plural is already right ("the trees behind him"),
// and a pronoun, preposition or number is not the head ("the many notes she included").
const NOT_A_HEAD_NOUN =
  /^(?:people|men|women|children|feet|teeth|mice|geese|police|data|media|criteria|phenomena|today|tonight|tomorrow|yesterday|overnight|few|many|several|i|me|you|he|him|she|her|it|we|us|they|them|this|that|these|those|behind|above|below|under|over|after|before|between|among|without|within|during|about|around|into|onto|upon|across|along|against|toward|towards|near|beside|beyond|through|in|on|at|by|for|from|to|with|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|hundred|thousand|million)$/;

/** Where "one of the …" ends: a clause end, a function word or a verb ("node loses"). */
function closesNounPhrase(next: string | undefined, after: string): boolean {
  // The end of the text closes it too; typing proposals never reach the word at the caret.
  if (!next)
    return (
      /^[ \t ]*(?:[.!?,;:)]|[ \t ]+[A-Za-z]+)/.test(after) ||
      (/^[ \t ]*$/.test(after) && after.length < 24)
    );
  if (TAILS.test(next)) return true;
  // "one of the car parks": a plural after the word is the noun itself.
  const info = englishWordInfo(next);
  return !!info?.verbs.some((v) => v.form === "third" || v.form === "past") && !info.plural;
}

const NOT_A_HEAD =
  /^(?:ago|old|olds|later|earlier|before|after|of|and|or|to|in|on|at|for|from|with|by|per|each|is|was|are|were|left|long|away|late|early|off)$/;

// ---------------------------------------------------------------------------- words

const VISITED = /\b(?:at|to|toured|visited|attend|attends|attended|the)[ \t ]{1,8}$/i;

// Adjectives that name a group of people ("the rich of the town"), and words the lexicon reads
// as no noun that still head a phrase before "of" (ordinals, comparison words).
const NOUNLESS_ALLOWED =
  /^(?:rich|poor|young|old|elderly|wealthy|sick|dead|living|blind|deaf|homeless|unemployed|needy|faithful|brave|injured|wounded|disabled|famous|powerful|weak|innocent|guilty|lucky|chosen|slain|fallen|damned|departed|deceased|accused|condemned|wretched|best|worst|most|least|more|less|lesser|greater|former|latter|first|last|next|only|other|same|very|whole|rest|remainder|likes|many|few|several|each|all|both|none|bulk|majority|minority)$/;

const NOUN_IN_MATH = /^(?:exponential|dual|conjugate|reciprocal|transpose|integral|differential)$/;

/** A known word with no noun, verb or adverb reading: "widespread", "additional". */
function adjectiveOnly(word: string): boolean {
  if (FUNCTION_WORDS.test(word) || NOUNLESS_ALLOWED.test(word)) return false;
  // Comparatives and superlatives head "the larger of the two", "the finest of",
  // "the northernmost of"; math names a function ("the exponential of", "the dual of").
  if (/(?:er|est|most)$/.test(word) || NOUN_IN_MATH.test(word)) return false;
  // Other checks repair these with their noun: "the important of" (importance), "a serious
  // of" (series), "the numerous of" (number).
  if (/^(?:serious|numerous)$/.test(word) || englishWordInfo(word.replace(/t$/, "ce"))?.noun)
    return false;
  const info = englishWordInfo(word);
  return !!info && !info.noun && !info.plural && !info.adverb && !info.verbs.length;
}

/** A warning on the determiner group of `m`: no fix, only the sentence to reread. */
const warning = (ctx: DetectContext, m: RegExpExecArray, name = "target"): RawFinding => ({
  ...found(ctx, m, "englishSentenceStructure", "review_msg_sentence_structure", [], name),
  warningOnly: true,
});

// ---------------------------------------------------------------------------- typography

// Words that open a sentence and never a dotted name's next part ("table.The room").
const STARTERS =
  "The|A|An|It|Its|I|So|But|And|This|That|These|Those|He|She|We|They|You|There|Then|What|When|Where|Why|How|If|My|Our|Your|His|Her|Their|Some|Many|One|No|Yes|Now|Also|However|After|Before|As|Each|Every|All";
/**
 * Dotted tokens that are prose, not names: "a.m.", a decimal range ("1.5-2.5"), two
 * sentences glued at a period ("table.The") and the brand "WordPress.com" (grammarStyle2.ts
 * fixes its casing). Review's technical-token guard lets them through.
 */
export const PROSE_DOTTED_TOKEN = new RegExp(
  `^(?:\\p{Nd}{1,9}(?:\\.\\p{Nd}{1,9})?[-–—]\\p{Nd}{1,9}(?:\\.\\p{Nd}{1,9})?|[ap]\\.m|[AP]\\.M|\\p{L}*\\p{Ll}{2}\\.(?:${STARTERS})|[Ww]ord[Pp]ress\\.com)$`,
  "u",
);

// ---------------------------------------------------------------------------- optional style

const STYLE_WORDS: Record<string, string[]> = {
  fav: ["favorite"],
  favs: ["favorites"],
  fave: ["favorite"],
  faves: ["favorites"],
  ppl: ["people"],
  omg: ["oh my god"],
  rly: ["really"],
  eli5: ["explain like I'm five"],
  iykyk: ["if you know, you know"],
  iiuc: ["if I understand correctly"],
  shit: ["crap", "sh*t"],
  fuck: ["****"],
  fucking: ["****ing"],
  fucked: ["****ed"],
  fucker: ["****er"],
  fuckers: ["****ers"],
};
const MARKER_COMPLEMENTS = /^(?:of|far|much|many|long|often|hard|good|bad|little|few|more|less)$/;

const UNIT_WORDS: Record<string, string> = {
  B: "byte",
  kB: "kilobyte",
  MB: "megabyte",
  GB: "gigabyte",
  TB: "terabyte",
  PB: "petabyte",
  EB: "exabyte",
  ZB: "zettabyte",
  YB: "yottabyte",
  RB: "ronnabyte",
  QB: "quettabyte",
  KiB: "kibibyte",
  MiB: "mebibyte",
  GiB: "gibibyte",
  TiB: "tebibyte",
  PiB: "pebibyte",
  EiB: "exbibyte",
  ZiB: "zebibyte",
  YiB: "yobibyte",
  RiB: "robibyte",
  QiB: "quebibyte",
  hr: "hour",
  hrs: "hour",
  min: "minute",
  mins: "minute",
  sec: "second",
  secs: "second",
  ms: "millisecond",
  msec: "millisecond",
  msecs: "millisecond",
};

const INTENSIFIED =
  /^[ \t ]+(?:is|isn['’]t|was|wasn['’]t|are|has|does|doesn['’]t|can|will|would|should|must)\b/i;

// ---------------------------------------------------------------------------- contractions

const NOT_STEMS =
  /^(?:is|are|was|were|do|does|did|has|have|had|could|would|should|might|must|need|may|ought|dare)$/;
const SUBJECTS = /^(?:I|you|he|she|it|we|they|that|this|there|here|what|who|where|how|when|why)$/i;

/** The full form(s) of a contraction, or null when it is not one ("John's", "o'clock"). */
function expandContraction(
  word: string,
  ending: string,
  have: string | undefined,
): string[] | null {
  const w = word.toLowerCase();
  const e = ending.toLowerCase();
  let full: string[] | null = null;
  if (e === "t") {
    if (!w.endsWith("n")) return null;
    const stem = w.slice(0, -1);
    const special: Record<string, string> = { ca: "cannot", wo: "will not", sha: "shall not" };
    full = special[stem] ? [special[stem]] : NOT_STEMS.test(stem) ? [`${stem} not`] : null;
  } else if (e === "m") full = w === "i" ? ["I am"] : null;
  else if (e === "re")
    full = /^(?:you|we|they|who|what|how|where|there|why|when)$/.test(w) ? [`${w} are`] : null;
  else if (e === "ve")
    full = /^(?:i|you|we|they|who|what|could|would|should|might|must|may)$/.test(w)
      ? [`${w} have`]
      : null;
  else if (e === "ll") full = SUBJECTS.test(w) ? [`${w} will`] : null;
  else if (e === "d") full = SUBJECTS.test(w) ? [`${w} would`, `${w} had`] : null;
  else if (w === "let") full = ["let us"];
  else if (e === "s" && SUBJECTS.test(w) && w !== "i") full = [`${w} is`, `${w} has`];
  return full && full.map((f) => (have ? `${f} have` : f).replace(/^i\b/, "I"));
}

// ---------------------------------------------------------------------------- serial comma

const INTRO =
  /^(?:however|when|whenever|if|after|before|in|on|at|for|while|although|though|because|since|yes|no|hello|hi|hey|well|so|also|then|now|first|second|finally|thus|therefore|meanwhile|as|once|until|unless|whether|by|with|from|during|to|dear|oh|okay|ok|sadly|luckily|unfortunately|fortunately)$/i;
const SUBJECT_PRONOUN = /^(?:I|you|he|she|it|we|they|there)$/i;

/** The list tail of `m` is a list: no introductory word or clause, no clause as its item. */
function listTail(m: RegExpExecArray, ctx: DetectContext): boolean {
  if (m.index < ctx.from || m.index >= ctx.to) return false;
  const before = ctx.text.slice(Math.max(0, m.index - 160), m.index);
  const clause = before.slice(before.search(/[^.!?;:\n]*$/));
  const head = clause.trimStart().split(/[ \t ,]+/)[0] ?? "";
  // An introductory word or clause before the first comma is not a list item.
  if (
    !clause.includes(",") &&
    (INTRO.test(head) || (/ly$/i.test(head) && !/[ \t ]/.test(clause.trim())))
  )
    return false;
  const words = m.groups!.item.split(/[ \t ]+/);
  if (words.some((word) => SUBJECT_PRONOUN.test(word) || /^(?:and|or|nor|but)$/i.test(word)))
    return false;
  // ", affecting relationships and identity" is a participle clause, not a list item.
  return !(words.length > 1 && /ing$/i.test(words[0]));
}

/**
 * Inside a named example (`the word "he go"`): an error cited on purpose. Other
 * quotations and parentheses are the writer's prose and are checked; their
 * fixes stay out of Fix all (toDiagnostic).
 */
export function quotedMention(ctx: DetectContext, finding: RawFinding): boolean {
  return namedExampleBefore(ctx.text, finding.range.start);
}
/** The named findings filters of grammar/rules/en.yaml (`filter:`). */
export const FILTERS = {
  /** Findings inside a named example are dropped: the example is mentioned, not used. */
  outsideExamples: (ctx, findings) => findings.filter((f) => !quotedMention(ctx, f)),
} satisfies Record<string, FindingsFilter>;

/** English only; findings inside a named example are dropped. */
export const english =
  (...detectors: ((ctx: DetectContext) => RawFinding[])[]) =>
  (ctx: DetectContext): RawFinding[] =>
    ctx.lang !== "en_US" ? [] : detectAll(ctx, detectors).filter((f) => !quotedMention(ctx, f));

/** The named frame fixes of grammar/rules/en.yaml (`fixer:`). */
export const FIXERS = {
  doubledMoreMost: (m, ctx) => {
    if (coreDegree(ctx).has(m.indices!.groups!.target[0])) return null;
    const { marker, adj: typed } = m.groups!;
    const adj = typed.toLowerCase();
    // Capitals other than a sentence's first letter are a name or emphasis.
    const markerCase =
      marker === marker.toLowerCase() ||
      (marker === caseLike("A", marker.toLowerCase()) && atClauseStart(ctx, m.index));
    if (typed !== adj || !markerCase || hasUserOrCasedWord(ctx, m[0])) return null;
    // "honest" is a base adjective ("honestly"), not hon + -est.
    if (!graded(adj) || englishWordInfo(`${adj}ly`)) return null;
    // "I'll write more later": time adverbs, not a comparative "more" could double.
    if (/^(?:later|earlier|sooner)$/.test(adj)) return null;
    // "one more smaller case", "some more bigger boxes": that "more" counts.
    if (
      marker.toLowerCase() === "more" &&
      /\b(?:one|two|three|four|five|few|several|some|any|no)[ \t ]+$/i.test(
        ctx.text.slice(Math.max(0, m.index - 12), m.index),
      )
    )
      return null;
    const [start, end] = m.indices!.groups!.target;
    if (!finishedComparison(ctx, start, end)) return null;
    return caseLike(m.groups!.marker, m.groups!.adj);
  },
  moreBase: (m, ctx) => {
    const adj = m.groups!.adj.toLowerCase();
    const forms = comparative(adj);
    if (!forms.length || hasUserOrCasedWord(ctx, m[0])) return null;
    // "more human than machine", "more subtle than direct" weigh two descriptions.
    const than = /^[ \t ]+than[ \t ]+([A-Za-z]+)/i.exec(
      ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 40),
    );
    const compared = than ? englishWordInfo(than[1]) : null;
    if (compared && (compared.noun || compared.adjective)) return null;
    return forms.map((form) => caseLike(m[0], form));
  },
  didBase: (m, ctx) => auxiliaryBase(m, ctx, true),
  helpedBase: (m, ctx) => auxiliaryBase(m, ctx, false),
  /** "I may of made a mistake": "of" heard for 've. */
  mayOf: (m) => (isParticiple(m.groups!.verb) ? caseLike(m.groups!.target, "have") : null),
  youR: (m) => {
    const pronoun = m.groups!.pronoun;
    const kase =
      pronoun === pronoun.toUpperCase() ? (s: string) => s.toUpperCase() : (s: string) => s;
    return [`${pronoun} ${kase("are")}`, `${pronoun}${kase("'re")}`];
  },
  johnsHopkins: (m, ctx) => {
    const place = VISITED.test(ctx.text.slice(Math.max(0, m.index - 16), m.index));
    if (!place && !m.groups!.institution) return null;
    const typed = m[0];
    return `${typed}${typed === typed.toUpperCase() ? "S" : "s"}`;
  },
  thatS: (m, ctx) => {
    if (hasUserOrCasedWord(ctx, m[0])) return null;
    const word = m.groups!.word;
    return `${word}${word === word.toUpperCase() ? "'S" : "'s"}`;
  },
  splitLetter: (m, ctx) => {
    const letterAt = m.index + 1;
    if (letterAt < ctx.from || letterAt >= ctx.to) return null;
    const head = /(?<![\p{L}\p{N}_'’@/#\\.-])[a-z]{3,}(?=[ \t ]+$)/u.exec(
      ctx.text.slice(Math.max(0, letterAt - 40), letterAt),
    )?.[0];
    const word = head && head + ctx.text[letterAt];
    if (!head || englishWordInfo(head) || ctx.dictionary.has(head) || !englishWordInfo(word!))
      return null;
    const start = ctx.text.lastIndexOf(head, letterAt);
    return finding(
      "englishTypoWhitelistCorrection",
      "review_msg_typo",
      start,
      letterAt + 1,
      [word!],
      {
        context: around(ctx, m),
      },
    );
  },
  noBody: (m) => {
    const info = englishWordInfo(m.groups!.verb);
    if (!info?.verbs.some((v) => v.form === "past" || v.form === "third") || info.noun) return null;
    return caseLike(m.groups!.target, "nobody");
  },
  /** "Somethings going well": the contraction of "something is" lost its apostrophe. */
  thingsIs: (m, ctx) => {
    const typed = m.groups!.target;
    const word = typed.slice(0, -1);
    const s = typed.slice(-1);
    const mark = ctx.text.slice(Math.max(0, m.index - 200), m.index + 200).includes("’")
      ? "’"
      : "'";
    return [`${word}${mark}${s}`, `${word} ${s === "S" ? "IS" : "is"}`];
  },
  /** "This is are", "I'm am": two forms of be left from an edit; the second goes. */
  doubleBe: (m, ctx) => {
    const first = m[0]
      .slice(0, m.indices!.groups!.target[0] - m.index)
      .replace(/\s+\S+$/, (tail) => (m.groups!.adverb ? "" : tail));
    const second = m.groups!.second;
    // Identical pairs are repeated words; "the question is are we" asks a question.
    if (first.replace(/^['’]/, "").toLowerCase() === second.toLowerCase()) return null;
    // "Was IS weakened", "The IS was": an all-caps IS is a name, not a verb.
    const caps = (w: string) => w.length > 1 && w === w.toUpperCase();
    if (caps(first) !== caps(second)) return null;
    // "his team's was flat": after a noun, "'s" is a possessive that stands for its noun.
    if (
      /^['’]s$/i.test(first) &&
      !/(?:^|[^\p{L}])(?:he|she|it|that|this|what|who|where|how|there|here|everyone|everything|nothing|nobody|someone|something)$/iu.test(
        ctx.text.slice(Math.max(0, m.index - 16), m.index),
      )
    )
      return null;
    if (/^(?:I|you|we|they|he|she|it|there)$/i.test(nextLowerWord(ctx, m.index + m[0].length)))
      return null;
    // "My motto is never be late": after a noun subject, an imperative complement.
    if (
      m.groups!.adverb &&
      !/(?:^|[^\p{L}'’])(?:I|you|we|they|he|she|it|\p{Lu}\p{L}*)[ \t ]+$/u.test(
        ctx.text.slice(Math.max(0, m.index - 24), m.index),
      )
    )
      return null;
    // "To be or not to be is…": an infinitive subject before its verb.
    if (
      first.toLowerCase() === "be" &&
      /\bto[ \t ]+$/i.test(ctx.text.slice(Math.max(0, m.index - 4), m.index))
    )
      return null;
    // "What there are is a mess": the first verb closes a free relative clause.
    if (PSEUDO_CLEFT_BEFORE.test(ctx.text.slice(Math.max(0, m.index - 80), m.index))) return null;
    // "The are is a unit of area": after a determiner, "are" is the noun.
    if (
      first.toLowerCase() === "are" &&
      /(?:^|[^\p{L}'’])(?:the|an|one|per|each|this|that|square)[ \t ]+$/iu.test(
        ctx.text.slice(Math.max(0, m.index - 12), m.index),
      )
    )
      return null;
    // "Let's be", and "Mateo's are": after a name, "'s" is a possessive standing for its noun.
    if (/^['’]/.test(first) && second.toLowerCase() === "be") return null;
    // "All I'm saying is be careful", "all I want to do is be able": a bare infinitive or
    // imperative after a clause ending in do or say.
    if (
      /^(?:is|was)$/i.test(first) &&
      second.toLowerCase() === "be" &&
      !m.groups!.adverb &&
      /\b(?:do|did|say|saying|said|mean|meant|ask|asking|asked)[ \t ]+$/i.test(
        ctx.text.slice(Math.max(0, m.index - 16), m.index),
      )
    )
      return null;
    // "two x's are", "the SKU's are": letters and short abbreviations take 's as a plural.
    if (
      /^['’]s$/.test(first) &&
      /(?:^|[^\p{L}])\p{L}{1,3}$/u.test(ctx.text.slice(Math.max(0, m.index - 8), m.index))
    )
      return null;
    // So is a noun after a determiner ("these one's are", "my aunt's are"): never "is".
    if (
      /^['’]s$/.test(first) &&
      (/\p{Lu}\p{L}*$/u.test(ctx.text.slice(Math.max(0, m.index - 24), m.index)) ||
        /(?:^|[^\p{L}'’])(?:the|a|an|these|those|this|that|my|your|his|her|our|their|its|some|all|both|many|several|few|other)(?:[ \t ]+\p{L}+){1,2}$/iu.test(
          ctx.text.slice(Math.max(0, m.index - 40), m.index),
        ))
    )
      return null;
    return "";
  },
  /** "the some candidates" is "some candidates"; "the some approach" was "the same approach". */
  theSome: (m, ctx) => {
    const [the, some] = m.groups!.target.split(/[ \t ]+/);
    const next = nextLowerWord(ctx, m.index + m[0].length);
    const info = next ? englishWordInfo(next) : null;
    const some2 = caseLike(the, some.toLowerCase());
    const same = `${the}${m.groups!.target.slice(the.length, -some.length)}${caseLike(some, "same")}`;
    // The lexicon leaves long plain nouns out ("layout"), so an unknown word counts as one.
    const singular =
      (info ? info.noun && !info.plural : next.length > 5 && !next.endsWith("s")) &&
      !/^[ \t ]*\S+['’]s\b/.test(ctx.text.slice(m.index + m[0].length));
    return singular ? [same, some2] : [some2, same];
  },
  /** "The and other options": a determiner with no noun after it. */
  danglingDeterminer: (m, ctx) => {
    if (m.index < ctx.from || m.index >= ctx.to) return null;
    if (m.groups!.target && !/^the[ \t ]+[a-z]+$/i.test(m.groups!.target)) return null;
    if (m.groups!.target && /[A-Z]/.test(m.groups!.target.split(/\s+/)[1])) return null;
    // "the or operator", "the and keyword": the word is named, not used.
    if (
      m.groups!.target &&
      /^(?:operators?|keywords?|gates?|clauses?|conditions?|statements?|functions?|buttons?|options?|cases?|keys?|logic|query|queries|search|searches|filters?|mode|rule)$/i.test(
        nextLowerWord(ctx, m.index + m[0].length),
      )
    )
      return null;
    return warning(ctx, m, m.groups!.target ? "target" : "article");
  },
  /** "The widespread of", "the is better": an article with no noun after it. */
  nounlessDeterminer: (m, ctx) => {
    if (m.index < ctx.from || m.index >= ctx.to) return null;
    const { det, word, be } = m.groups!;
    if (word && (word !== word.toLowerCase() || !adjectiveOnly(word))) return null;
    if (be) {
      // "I think the is…", "if Ic an be": "the" or "an" before a lowercase be. A letter
      // names a thing ("Let a be", "Annex A is", "An was"), and "a be-all" is an idiom.
      const lead = det.toLowerCase();
      if (be !== be.toLowerCase() || lead === "a") return null;
      if (det !== lead && !atClauseStart(ctx, m.index)) return null;
      if (lead === "the" && be === "be") return null;
      if (lead === "an" && !/^(?:be|has|was)$/.test(be)) return null;
      if (hasUserOrCasedWord(ctx, m[0])) return null;
    }
    return warning(ctx, m);
  },
  /** Greek plurals: "three criterion" and "one criteria" swap number. */
  greekPlural: (m, ctx) => {
    if (m.index < ctx.from || m.index >= ctx.to) return null;
    const noun = m[0];
    const plural = noun.endsWith("on");
    const window = ctx.text.slice(Math.max(0, m.index - 80), m.index);
    const count = (plural ? PLURAL_BEFORE : SINGLE_BEFORE).exec(window);
    if (!count || noun !== noun.toLowerCase() || hasUserOrCasedWord(ctx, count[0] + noun))
      return null;
    const end = m.index + noun.length;
    // "that" is also a conjunction: only "that phenomena." closing its clause.
    if (count.groups?.that && !/^[ \t ]*(?:[.!?,;:]|$)/.test(ctx.text.slice(end, end + 9)))
      return null;
    const before = ctx.text.slice(
      Math.max(0, m.index - 96 - count[0].length),
      m.index - count[0].length,
    );
    // "twenty one phenomena", "one or two criterion", "section one criteria".
    if (/\bof[ \t ]+$/i.test(before) || hasCountPrefix(before)) return null;
    // A bare "many criterion" is not flagged: no rule has enough evidence for it.
    if (/^many[ \t ]+$/i.test(count[0])) return null;
    const corrected = noun.replace(/(?:on|a)$/, plural ? "a" : "on");
    return finding(
      "englishCountability",
      "review_msg_countable_number",
      m.index,
      end,
      [corrected],
      {
        context: around(ctx, m),
      },
    );
  },
  /** "an advice", "many information": uncountable nouns used as counts. */
  massNoun: (m, ctx) => {
    if (m.index < ctx.from || m.index >= ctx.to) return null;
    const before = ctx.text.slice(Math.max(0, m.index - 24), m.index);
    const counted = COUNTED_BEFORE.exec(before);
    if (!counted) return null;
    const { single, several, how, afew } = counted.groups!;
    const noun = m[0];
    const n = noun.toLowerCase();
    const start = m.index - before.length + counted.index;
    const end = m.index + noun.length;
    if (noun !== n || hasUserOrCasedWord(ctx, ctx.text.slice(start, end))) return null;
    // "a software engineer": the noun modifies the next one. So does a coordinated
    // modifier: "a feedback and planning tool".
    if (compoundHead(ctx, end)) return null;
    const joined = /^[ \t ]+(?:and|or|&)[ \t ]+([a-z]+)/i.exec(ctx.text.slice(end, end + 32));
    if (
      joined &&
      !FUNCTION_WORDS.test(joined[1]) &&
      !/^(?:a|an|the|some|any|my|your|his|her|our|their|its|no|more|other|lots|plenty)$/i.test(
        joined[1],
      ) &&
      compoundHead(ctx, end + joined[0].length)
    )
      return null;
    // "a information" is the core rule's warning.
    if (n === "information" && single && /^an?$/i.test(single)) return null;
    const { unit, count = [] } = MASS[n];
    const det = single ?? several;
    const kase = (text: string) => caseLike(det, text);
    let alternatives: string[];
    if (single) {
      const article = /^an?$/i.test(single);
      const withUnit = unit.endsWith("of") ? `${unit} ${n}` : unit;
      alternatives = article
        ? [
            `some ${n}`,
            `a ${withUnit}`,
            ...count.map(([one]) => `${/^[aeiou]/.test(one) ? "an" : "a"} ${one}`),
          ]
        : [
            `${single.toLowerCase()} ${withUnit}`,
            ...count.map(([one]) => `${single.toLowerCase()} ${one}`),
          ];
    } else {
      const d = det.toLowerCase();
      const unitPlural = unit.endsWith("of") ? `${plural(unit)} ${n}` : plural(unit);
      alternatives = [
        ...(how ? [`${how.toLowerCase()}much ${n}`] : []),
        ...(d === "fewer" ? [`less ${n}`] : []),
        `${afew ? "a few" : d.replace(/^(?:how|so|too)\s+/, `${how ? how.toLowerCase() : ""}`)} ${unitPlural}`,
        ...count.map(([, many]) => `${d.replace(/\s+/g, " ")} ${many}`),
      ];
    }
    const offered = [...new Set(alternatives.map(kase))];
    return finding("englishCountability", "review_msg_countability", start, end, offered, {
      ...(offered.length > 1 ? { requiresChoice: true as const } : {}),
      context: around(ctx, m),
    });
  },
  massPlural,
  judgedPlural: (m, ctx) =>
    JUDGED_BEFORE.test(ctx.text.slice(Math.max(0, m.index - 48), m.index))
      ? massPlural(m, ctx)
      : null,
  /** "one of the test" names one member of a plural set. */
  oneOfPlural: (m, ctx) => {
    if (m.index < ctx.from || m.index >= ctx.to) return null;
    if (hasUserOrCasedWord(ctx, m[0])) return null;
    const [wordsStart] = m.indices!.groups!.words;
    const words = [...m.groups!.words.matchAll(/[A-Za-z][A-Za-z-]*/g)];
    const after = ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 24);
    let head = -1;
    for (let i = 0; i < words.length && head < 0; i++) {
      const word = words[i][0].toLowerCase();
      if (NOT_A_HEAD_NOUN.test(word) || englishWordInfo(word)?.plural) break;
      // "one of the battery powered units": a noun before a participle modifies the next noun.
      const modifier = /ed$/.test(words[i + 1]?.[0] ?? "") && !!words[i + 2];
      if (!modifier && closesNounPhrase(words[i + 1]?.[0], after)) head = i;
    }
    if (head < 0) return null;
    const noun = words[head][0];
    if (COLLECTIVE.test(noun) || !/^[a-z]+$/.test(noun)) return null;
    // Authored nouns ("person", "device") take their authored plural; the core rule's
    // identical finding for the same span merges with this one.
    const authored = englishNounForms(noun);
    const info = englishWordInfo(noun);
    if (authored ? noun !== authored.singular : !info?.noun || info.plural || info.adjective)
      return null;
    const plural =
      authored?.plural ??
      IRREGULAR_PLURALS[noun] ??
      [`${noun}s`, `${noun}es`, noun.replace(/([^aeiou])y$/, "$1ies")].find(
        (form) => form !== noun && englishWordInfo(form)?.plural,
      );
    if (!plural) return null;
    const start = wordsStart + words[head].index;
    return finding("englishNounNumber", "review_msg_one_of", start, start + noun.length, [plural], {
      context: around(ctx, m),
    });
  },
  /** "in my 30's", "late 1970's", "an 80's style": decades and ages take a plain s. */
  decade: (m, ctx) => {
    const [start] = m.indices!.groups![m.groups!.two ? "two" : m.groups!.span ? "span" : "decade"];
    if (start < ctx.from || start >= ctx.to) return null;
    const number = m.groups!.two ?? m.groups!.span ?? m.groups!.decade;
    const end = m.index + m[0].length;
    const short = number.length === 2 && !m.groups!.age;
    return {
      ruleId: "englishNounNumber",
      messageKey: "review_msg_decade_plural",
      range: { start, end },
      alternatives: short ? [`${m.groups!.mark}${number}s`, `${number}s`] : [`${number}s`],
      ...(short ? { requiresChoice: true as const } : {}),
      context: around(ctx, m),
    };
  },
  /** "each 2 hours" is "every 2 hours". */
  eachCount: (m) => caseLike(m.groups!.target, "every"),
  /** "several two hosts" states two counts. */
  vagueCount: (m) => [caseLike(m.groups!.vague, m.groups!.count), m.groups!.vague],
  /** "a 3 day course": a number and unit before a noun are hyphenated. */
  numberUnit: (m) => {
    const { n, unit, next } = m.groups!;
    // "the 2018 Year-End chart": a capitalized unit belongs to a name.
    if (n === "1" || /^[A-Z]/.test(unit) || (next && NOT_A_HEAD.test(next))) return null;
    if (next && !englishWordInfo(next)?.noun && !englishWordInfo(next)?.adjective) return null;
    // "my 2 step daughters": stepchildren counted.
    if (
      unit === "step" &&
      /^(?:daughter|son|child|kid|sister|brother|parent)s?$|^children$/.test(next ?? "")
    )
      return null;
    return `${n}-${unit}`;
  },
  /** "table.The room": a sentence mark glued to the next sentence. */
  missingSpace: (m, ctx) => {
    const start = m.index;
    if (start < ctx.from || start >= ctx.to) return null;
    const before = /[\p{L}]+$/u.exec(ctx.text.slice(Math.max(0, start - 32), start))?.[0] ?? "";
    if (ctx.text[start - before.length - 1] === "&") return null;
    return finding(
      "commaPeriodSpacing",
      "review_msg_space_after_mark",
      start,
      start + 1,
      [`${m[0]} `],
      {
        context: { start: Math.max(0, start - 16), end: Math.min(ctx.text.length, start + 16) },
      },
    );
  },
  /** Optional typography: a number range takes an en dash ("pages 12–14"). */
  numberRange: (m, ctx) => {
    if (m.index < ctx.from || m.index >= ctx.to) return null;
    const { a, b } = m.groups!;
    // Telephone and postal numbers: "555-1234", "12345-6789".
    if (b.length === 4 && (a.length === 3 || a.length === 5)) return null;
    const at = m.indices!.groups!.dash[0];
    return finding("emdashShortcut", "review_msg_typed_dash", at, at + 1, ["–"], {
      context: { start: m.index, end: m.index + m[0].length },
    });
  },
  styleWord: (m, ctx) => {
    const typed = m.groups!.target;
    if (ctx.dictionary.has(typed.toLowerCase()) || hasUserOrCasedWord(ctx, typed)) return null;
    // "PPL" in capitals is also an acronym, unless the text around it shouts too.
    if (typed.length > 1 && typed === typed.toUpperCase()) {
      const near = ctx.text.slice(Math.max(0, m.index - 24), m.index + typed.length + 24);
      const words = (near.match(/\p{L}{2,}/gu) ?? []).filter((w) => w !== typed);
      if (words.length && !words.some((w) => w === w.toUpperCase())) return null;
    }
    return STYLE_WORDS[typed.toLowerCase()].map((r) => caseLike(typed, r));
  },
  increasingly: (m) => {
    // An adjective follows: "more prevalent", not "more people" or "more than".
    const word = m.groups!.adj.toLowerCase();
    const adj = englishWordInfo(word);
    if (FUNCTION_WORDS.test(word) || (adj && !adj.adjective && !plainWord(word))) return null;
    const degree = m.groups!.degree.toLowerCase();
    return caseLike(m.groups!.target, `${degree} and ${degree}`);
  },
  discourseMarker: (m, ctx) => {
    const next = m.groups!.next.toLowerCase();
    if (!atClauseStart(ctx, m.index) || MARKER_COMPLEMENTS.test(next)) return null;
    if (/^however$/i.test(m.groups!.target) && englishWordInfo(next)?.adjective) return null;
    return `${m.groups!.target},`;
  },
  timeOfDay: (m, ctx) => {
    const { number, meridiem, tail } = m.groups!;
    // "5 P.M. in the afternoon." keeps one period.
    const end = m.index + m[0].length;
    const time = number + meridiem;
    const doubled = time.endsWith(".") && ctx.text[end] === ".";
    return [time.slice(0, doubled ? -1 : undefined), `${number}${tail}`];
  },
  unitWord: (m, ctx) => {
    if (m.index < ctx.from || m.index >= ctx.to) return null;
    const { n, unit = "B" } = m.groups!;
    const sep = m.groups!.sep ?? m.groups!.sep2;
    const word = UNIT_WORDS[unit];
    const hyphen = sep === "-";
    return {
      ruleId: "stylePhrasing",
      messageKey: "review_msg_style_phrasing",
      range: { start: m.index, end: m.index + m[0].length },
      alternatives: [`${n}${hyphen ? "-" : " "}${word}${hyphen || n === "1" ? "" : "s"}`],
      context: around(ctx, m),
    };
  },
  selfVerb: (m, ctx) => {
    const verb = m.groups!.verb;
    if (!englishWordInfo(verb)?.verbs.length && !/(?:ing|ed|s)$/i.test(verb)) return null;
    // "self harm itself isn't…": the reflexive stresses a noun subject.
    if (INTENSIFIED.test(ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 16)))
      return null;
    const [start] = m.indices!.groups!.target;
    const [, verbEnd] = m.indices!.groups!.verb;
    return {
      ruleId: "stylePhrasing",
      messageKey: "review_msg_style_phrasing",
      range: { start, end: verbEnd },
      alternatives: [caseLike(m.groups!.self, verb)],
      context: around(ctx, m),
    };
  },
  /** Optional formal register: contractions written out. */
  contraction: (m, ctx) => {
    const { word, ending, have, target } = m.groups!;
    if (hasUserOrCasedWord(ctx, target)) return null;
    return expandContraction(word, ending, have)?.map((f) => caseLike(target, f)) ?? null;
  },
  /** Optional serial comma: "A, B and C" gets the comma before "and". */
  addOxfordComma: (m, ctx) => {
    if (m.groups!.oxford || !listTail(m, ctx)) return null;
    const [conjStart] = m.indices!.groups!.conj;
    const [, itemEnd] = m.indices!.groups!.item;
    return {
      ruleId: "styleOxfordComma",
      messageKey: "review_msg_oxford_comma",
      range: { start: itemEnd, end: conjStart },
      alternatives: [`,${ctx.text.slice(itemEnd, conjStart)}`],
      context: { start: m.index, end: m.index + m[0].length },
    };
  },
  /** Optional serial comma: "A, B, and C" loses the comma before "and". */
  removeOxfordComma: (m, ctx) => {
    if (!m.groups!.oxford || !listTail(m, ctx) || SUBJECT_PRONOUN.test(m.groups!.after))
      return null;
    const [conjStart] = m.indices!.groups!.conj;
    const [at] = m.indices!.groups!.oxford;
    return finding("styleNoOxfordComma", "review_msg_no_oxford_comma", at, conjStart, [" "], {
      context: { start: m.index, end: m.index + m[0].length },
    });
  },
} satisfies Record<string, MatchFixer>;
