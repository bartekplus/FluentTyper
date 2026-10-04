import { startsSentence } from "../../implementations/CapitalizeSentenceStartRule";
import { damerauLevenshteinDistance } from "../../../editDistance";
import {
  isTechnicalToken,
  wordKey,
  wordSet,
} from "../../implementations/helpers/GenericRuleShared";
import type { PreparedReview } from "../reviewDiagnostics";
import {
  applyEdits,
  commonAffixes,
  editTouches,
  hashText,
  isGraphemeBoundary,
  rangesOverlap,
} from "../textRanges";
import {
  REVIEW_LOCAL_AI_CHECK,
  type ReviewCategory,
  type ReviewDiagnostic,
  type ReviewEdit,
  type TextRange,
} from "../types";
import { LINE_BREAK_CHAR } from "./segments";
import type {
  AiChunk,
  AiCorrectionResult,
  AiRejectionReason,
  AiSegment,
  ConcreteRewriteStyle,
  RewriteProposal,
} from "./types";

/*
 * Validation of model proposals (pure). The model returns text per segment;
 * every edit is derived here from a token diff against the segment and mapped
 * to the snapshot through the host-owned segment map, never by searching text.
 * The guards below are risk filters, not a proof that meaning is unchanged.
 */

// ---------------------------------------------------------------------------
// Tokens and diff

type TokenKind = "word" | "space" | "placeholder" | "punct";

interface Token {
  text: string;
  kind: TokenKind;
  /** Offsets into the segment (or proposed) text. */
  start: number;
  end: number;
}

const TOKEN =
  /(⟦\d{1,4}⟧)|([\p{L}\p{M}\p{N}]+(?:['’-][\p{L}\p{M}\p{N}]+)*)|(\s+)|(.(?:[\p{M}\ufe0e\ufe0f]|\p{Emoji_Modifier}|\u200d.)*)/gsu;

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(TOKEN)) {
    const kind: TokenKind = match[1]
      ? "placeholder"
      : match[2]
        ? "word"
        : match[3]
          ? "space"
          : "punct";
    tokens.push({ text: match[0], kind, start: match.index, end: match.index + match[0].length });
  }
  return tokens;
}

/** A changed region: tokens [o0, o1) of the original became [p0, p1) of the proposal. */
interface Hunk {
  o0: number;
  o1: number;
  p0: number;
  p1: number;
}

/** Bound on LCS table cells (tokens × tokens) per segment. */
const MAX_DIFF_CELLS = 1_000_000;

/** Token-level LCS diff, or null when the table would exceed its bound. */
function diffTokens(a: readonly Token[], b: readonly Token[]): Hunk[] | null {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre].text === b[pre].text) pre += 1;
  let suf = 0;
  while (
    suf < a.length - pre &&
    suf < b.length - pre &&
    a[a.length - 1 - suf].text === b[b.length - 1 - suf].text
  ) {
    suf += 1;
  }
  const n = a.length - pre - suf;
  const m = b.length - pre - suf;
  if (n === 0 && m === 0) return [];
  if ((n + 1) * (m + 1) > MAX_DIFF_CELLS) return null;
  const width = m + 1;
  // lcs[i * width + j]: LCS length of a[pre+i..pre+n) and b[pre+j..pre+m).
  const lcs = new Uint16Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i * width + j] =
        a[pre + i].text === b[pre + j].text
          ? lcs[(i + 1) * width + j + 1] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }
  const hunks: Hunk[] = [];
  let open: Hunk | null = null;
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[pre + i].text === b[pre + j].text) {
      if (open) hunks.push(open);
      open = null;
      i += 1;
      j += 1;
      continue;
    }
    open ??= { o0: pre + i, o1: pre + i, p0: pre + j, p1: pre + j };
    if (j < m && (i >= n || lcs[i * width + j + 1] >= lcs[(i + 1) * width + j])) j += 1;
    else i += 1;
    open.o1 = pre + i;
    open.p1 = pre + j;
  }
  if (open) hunks.push(open);
  // Changes separated only by a space are one change ("many equipments" ->
  // "a lot of equipment"), not a word pair aligned on the shared space.
  const merged: Hunk[] = [];
  for (const hunk of hunks) {
    const last = merged[merged.length - 1];
    if (last && a.slice(last.o1, hunk.o0).every((token) => token.kind === "space")) {
      last.o1 = hunk.o1;
      last.p1 = hunk.p1;
    } else {
      merged.push({ ...hunk });
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Word classes (English first; a few Polish entries where cheap)

/**
 * Negation words. Contractions typed without the apostrophe count too, except
 * "cant" and "wont", which are also real words ("the cant of the roof").
 */
const NEGATIONS = wordSet(`
  not no nope nah never none nobody nothing nowhere neither nor without cannot dont doesnt didnt isnt
  arent wasnt werent hasnt havent hadnt couldnt wouldnt shouldnt mustnt neednt aint nie
  nigdy nic niczego nikt nikogo nikomu nigdzie ani bez żaden żadna żadne żadnego żadnej
  żadnych żadnym żadnemu
`);

const isNegation = (word: string) => NEGATIONS.has(word) || word.endsWith("n't");

const HEDGES = wordSet(`
  may might maybe perhaps possibly probably likely unlikely could seem seems seemed
  seemingly apparently presumably arguably suppose guess może chyba prawdopodobnie raczej
  pewnie możliwe ewentualnie podobno
`);
const HEDGE_PAIRS = new Set([
  "i think",
  "i believe",
  "i feel",
  "not sure",
  "not certain",
  "kind of",
  "sort of",
  "wydaje się",
  "myślę że",
]);

/** Informal words a proofreader leaves alone (changing them formalizes the text). */
const INFORMAL = wordSet(`
  gonna wanna gotta kinda sorta dunno lemme gimme y'all ya yeah yep nope lol tbh imo btw ok
  okay cuz
`);

/** Nouns without a plural ("informations", "datas" are errors, not a choice of number). */
const UNCOUNTABLE = wordSet(`
  information advice equipment data feedback software research knowledge furniture luggage
  homework evidence news traffic money
`);
const isUncountable = (word: string) =>
  UNCOUNTABLE.has(word) || (word.endsWith("s") && UNCOUNTABLE.has(word.slice(0, -1)));

/** Determiners that fix a noun's number: agreement with them is a correction. */
const PLURAL_DETERMINERS = wordSet(`
  several many few both various numerous two three four five six seven eight nine
  ten eleven twelve twenty thirty forty fifty hundred thousand dozen
`);
// "that", "which" and "what" also introduce clauses ("which make it hard"): not listed.
const SINGULAR_DETERMINERS = wordSet("a an each every one another either neither");
/**
 * Determiners whose noun keeps the number the author wrote. Demonstratives are
 * here too: "this results" may mean one result or several ("these results").
 */
const NEUTRAL_DETERMINERS = wordSet(`
  the my your his her its our their some all any no whose this these those
`);

/** The plural of the pair when one word is the other with a plural ending, else null. */
function pluralOf(a: string, b: string): string | null {
  const [x, y] = [wordKey(a), wordKey(b)].sort((p, q) => p.length - q.length);
  const flip = y === `${x}s` || y === `${x}es` || (x.endsWith("y") && y === `${x.slice(0, -1)}ies`);
  return flip ? y : null;
}

/**
 * "My friends is" -> "My friend is": a noun right after an unchanged determiner
 * keeps its number unless the determiner itself marks it ("several issue" ->
 * "several issues", "a long texts" -> "a long text"). After a number-neutral
 * determiner, agreement is fixed on the verb, never by deciding how many there are.
 */
function flipsNounNumber(
  original: readonly Token[],
  index: number,
  unit: readonly Hunk[],
  added: readonly Token[],
): boolean {
  const determiner = wordBefore(original, index);
  // A determiner changed in the same unit ("many informations" -> "much information") agrees anew.
  if (!determiner || unit.some((hunk) => index - 2 >= hunk.o0 && index - 2 < hunk.o1)) {
    return false;
  }
  const word = wordKey(determiner.text);
  const numeric = /^\p{N}+$/u.test(word) ? Number(word) : null;
  const wantsPlural = PLURAL_DETERMINERS.has(word) || (numeric !== null && numeric >= 2);
  const wantsSingular = SINGULAR_DETERMINERS.has(word) || numeric === 1;
  if (!wantsPlural && !wantsSingular && !NEUTRAL_DETERMINERS.has(word)) return false;
  return added.some((token) => {
    const plural = pluralOf(original[index].text, token.text);
    if (plural === null) return false;
    const becomesPlural = wordKey(token.text) === plural;
    // "informations" -> "information": an uncountable noun has no plural to choose.
    if (!becomesPlural && UNCOUNTABLE.has(wordKey(token.text))) return false;
    return !(wantsPlural && becomesPlural) && !(wantsSingular && !becomesPlural);
  });
}

const SENTENCE_MARK = /^[.!?…]$/;
const hasApostrophe = (token: Token) => /\p{L}['’]\p{L}/u.test(token.text);

/**
 * True when a hunk only changes register: informal words replaced, contractions
 * expanded ("can't" -> "cannot") or formed from two words ("do not" -> "don't").
 * Restoring a missing apostrophe ("dont" -> "don't") is still a correction.
 */
function formalizes(removed: readonly Token[], added: readonly Token[]): boolean {
  if (removed.some((token) => INFORMAL.has(wordKey(token.text)))) return true;
  const before = removed.filter(hasApostrophe).length;
  const after = added.filter(hasApostrophe).length;
  return after < before || (after > before && removed.length > added.length);
}

const NUMBER_WORDS = wordSet(`
  zero one two three four five six seven eight nine ten eleven twelve twenty thirty forty
  fifty sixty seventy eighty ninety hundred thousand million billion dozen half twice once
  jeden jedna jedno dwa dwie trzy cztery pięć sześć siedem osiem dziewięć dziesięć sto
  tysiąc milion
`);

/** Closed-class groups: a replacement inside one group is a grammatical choice, not a synonym. */
const WORD_GROUPS: readonly (readonly string[])[] = [
  ["a", "an", "the"],
  ["be", "am", "is", "are", "was", "were", "been", "being"],
  ["have", "has", "had", "having"],
  ["do", "does", "did", "done", "doing"],
  [
    ...["of", "in", "on", "at", "to", "for", "with", "from", "by", "about", "into", "onto"],
    ...["since", "during", "until", "till"],
  ],
  ["i", "me", "my", "mine", "myself"],
  ["we", "us", "our", "ours", "ourselves"],
  ["he", "him", "his", "himself"],
  ["she", "her", "hers", "herself"],
  ["they", "them", "their", "theirs", "themselves"],
  ["who", "whom", "whose"],
  ["you", "your", "yours", "yourself"],
  ["it", "its", "itself"],
  ["this", "these"],
  ["that", "those"],
  ["w", "z", "ze", "o", "na", "od", "po", "za", "się"],
  ["much", "many"],
  ["little", "few"],
  ["less", "fewer"],
  // A second negative becomes its any-form ("didn't get no reply" -> "any reply");
  // the negation check still requires another negation to remain.
  ["no", "none", "any"],
  ["nobody", "anybody"],
  ["nothing", "anything"],
  ["never", "ever"],
  ["nowhere", "anywhere"],
];
/** Words that may be inserted or deleted by a correction (articles, auxiliaries, prepositions). */
const INSERTABLE = new Set(WORD_GROUPS.slice(0, 5).flat().concat(WORD_GROUPS[15], "we"));

/** Irregular verb families; an over-regularized form ("buyed") joins its base's family. */
const IRREGULAR: readonly (readonly string[])[] = [
  ["go", "goes", "went", "gone", "going"],
  ["see", "sees", "saw", "seen"],
  ["come", "comes", "came"],
  ["become", "becomes", "became"],
  ["begin", "begins", "began", "begun"],
  ["break", "breaks", "broke", "broken"],
  ["bring", "brings", "brought"],
  ["build", "builds", "built"],
  ["buy", "buys", "bought"],
  ["catch", "catches", "caught"],
  ["choose", "chooses", "chose", "chosen"],
  ["drink", "drinks", "drank", "drunk"],
  ["drive", "drives", "drove", "driven"],
  ["eat", "eats", "ate", "eaten"],
  ["fall", "falls", "fell", "fallen"],
  ["feel", "feels", "felt"],
  ["find", "finds", "found"],
  ["fly", "flies", "flew", "flown"],
  ["forget", "forgets", "forgot", "forgotten"],
  ["get", "gets", "got", "gotten"],
  ["give", "gives", "gave", "given"],
  ["grow", "grows", "grew", "grown"],
  ["hold", "holds", "held"],
  ["keep", "keeps", "kept"],
  ["know", "knows", "knew", "known"],
  ["leave", "leaves", "left"],
  ["lose", "loses", "lost"],
  ["make", "makes", "made"],
  ["meet", "meets", "met"],
  ["pay", "pays", "paid"],
  ["ride", "rides", "rode", "ridden"],
  ["ring", "rings", "rang", "rung"],
  ["rise", "rises", "rose", "risen"],
  ["run", "runs", "ran"],
  ["say", "says", "said"],
  ["sell", "sells", "sold"],
  ["send", "sends", "sent"],
  ["sing", "sings", "sang", "sung"],
  ["sit", "sits", "sat"],
  ["sleep", "sleeps", "slept"],
  ["speak", "speaks", "spoke", "spoken"],
  ["spend", "spends", "spent"],
  ["stand", "stands", "stood"],
  ["steal", "steals", "stole", "stolen"],
  ["swim", "swims", "swam", "swum"],
  ["take", "takes", "took", "taken"],
  ["teach", "teaches", "taught"],
  ["tell", "tells", "told"],
  ["think", "thinks", "thought"],
  ["throw", "throws", "threw", "thrown"],
  ["understand", "understands", "understood"],
  ["wake", "wakes", "woke", "woken"],
  ["wear", "wears", "wore", "worn"],
  ["win", "wins", "won"],
  ["write", "writes", "wrote", "written"],
];

const FAMILY = new Map<string, number>();
WORD_GROUPS.forEach((group, index) => {
  for (const word of group) if (!FAMILY.has(word)) FAMILY.set(word, index);
});
IRREGULAR.forEach((family, index) => {
  for (const word of family) FAMILY.set(word, WORD_GROUPS.length + index);
});

function familyOf(word: string): number | undefined {
  const direct = FAMILY.get(word);
  if (direct !== undefined) return direct;
  // "buyed", "catched", "writed": an -ed form of an irregular base.
  if (!word.endsWith("ed")) return undefined;
  const family = FAMILY.get(word.slice(0, -2)) ?? FAMILY.get(word.slice(0, -1));
  return family !== undefined && family >= WORD_GROUPS.length ? family : undefined;
}

/** Inflection stems of a word ("shows" -> show, "tried" -> try, "making" -> make). */
function stems(word: string): string[] {
  const result = [word];
  const add = (stem: string) => {
    if (stem.length >= 2) result.push(stem);
  };
  if (word.endsWith("ies")) add(`${word.slice(0, -3)}y`);
  if (word.endsWith("es")) add(word.slice(0, -2));
  if (word.endsWith("s")) add(word.slice(0, -1));
  if (word.endsWith("ied")) add(`${word.slice(0, -3)}y`);
  if (word.endsWith("ed")) add(word.slice(0, -2));
  if (word.endsWith("d")) add(word.slice(0, -1));
  if (word.endsWith("ing")) {
    add(word.slice(0, -3));
    add(`${word.slice(0, -3)}e`);
  }
  return result;
}

const foldDiacritics = (word: string) =>
  word.normalize("NFD").replace(/\p{M}/gu, "").replace(/ł/g, "l");
const bare = (word: string) => word.replace(/['’-]/g, "");
/** The tokens' text joined and normalized: a word written apart or together compares equal. */
const joinedKey = (tokens: readonly Token[]) =>
  bare(wordKey(tokens.map((token) => token.text).join("")));

type CloseKind = "case" | "form" | "spelling";

// A negating affix turns a word into its opposite at a tiny edit distance
// ("likely" -> "unlikely", "careful" -> "careless"): never a correction.
const NEGATING_PREFIXES = ["un", "in", "im", "il", "ir", "dis", "non", "non-", "mis", "anti", "a"];

function oppositePolarity(x: string, y: string): boolean {
  if (NEGATING_PREFIXES.some((prefix) => y === prefix + x || x === prefix + y)) return true;
  const root = (word: string) => word.replace(/(?:ful|less)$/u, "");
  return /(?:ful|less)$/u.test(x) && /(?:ful|less)$/u.test(y) && x !== y && root(x) === root(y);
}

/**
 * British and American spellings of one word ("colour"/"color",
 * "organise"/"organize", "centre"/"center", "travelled"/"traveled",
 * "catalogue"/"catalog", "licence"/"license"): both are correct, so swapping
 * them is never a correction. Curated patterns on otherwise identical words.
 */
function dialectPair(x: string, y: string): boolean {
  const { prefix, suffix } = commonAffixes(x, y);
  const head = x.slice(0, prefix);
  const tail = x.slice(x.length - suffix);
  const pair = [x.slice(prefix, x.length - suffix), y.slice(prefix, y.length - suffix)]
    .sort()
    .join("/");
  switch (pair) {
    case "/u": // colour, favourite, honours
      return head.endsWith("o") && tail.startsWith("r") && Math.max(x.length, y.length) >= 5;
    case "s/z": // organise, realising, analyse
      return /[iy]$/.test(head) && /^[eai]/.test(tail);
    case "er/re": // centre, metres
      return /^[sd]?$/.test(tail);
    case "/l": // travelled, modelling, labeller ("usefull" is a typo)
      return head.endsWith("l") && /^[ei]/.test(tail);
    case "/ue": // catalogue, dialogues
      return head.endsWith("og") && /^s?$/.test(tail);
    case "c/s": // licence, defence, offence
      return head.endsWith("en") && tail.startsWith("e");
    default:
      return false;
  }
}

/**
 * How two words relate, if a proofreader could swap them: case only, a
 * grammatical form (apostrophe, family, inflection) or a spelling fix (small
 * edit distance, diacritics). Anything else is a different word (drift).
 */
function closeKind(a: string, b: string): CloseKind | null {
  const x = wordKey(a);
  const y = wordKey(b);
  if (x === y) return "case";
  if (oppositePolarity(x, y) || dialectPair(x, y)) return null;
  if (bare(x) === bare(y) || foldDiacritics(x) === foldDiacritics(y)) return "spelling";
  const family = familyOf(x);
  if (family !== undefined && family === familyOf(y)) return "form";
  const ys = stems(y);
  if (stems(x).some((stem) => ys.includes(stem))) return "form";
  const length = Math.max([...x].length, [...y].length);
  const limit = length <= 3 ? 1 : Math.max(2, Math.ceil(length / 3));
  return damerauLevenshteinDistance(x, y, limit) <= limit ? "spelling" : null;
}

/**
 * True when the removed words can become the added words by corrections
 * alone: close pairs, split/joined words ("alot" -> "a lot"), and inserted or
 * deleted closed-class words (or a deleted repeated word).
 */
function isCorrection(
  removed: readonly Token[],
  added: readonly Token[],
  deletable: (index: number) => boolean,
  movable: (word: string) => boolean = () => false,
  /** Added words (count) that removed[i] may become in context, from added[j]; 0 when none. */
  phrase: (i: number, j: number) => number = () => 0,
): boolean {
  const n = removed.length;
  const m = added.length;
  if (n > 8 || m > 8) return false;
  const reach = Array.from({ length: n + 1 }, () => new Array<boolean>(m + 1).fill(false));
  reach[0][0] = true;
  for (let i = 0; i <= n; i += 1) {
    for (let j = 0; j <= m; j += 1) {
      if (!reach[i][j]) continue;
      if (i < n && j < m && closeKind(removed[i].text, added[j].text)) reach[i + 1][j + 1] = true;
      const span = i < n && j < m ? phrase(i, j) : 0;
      if (span > 0 && j + span <= m) reach[i + 1][j + span] = true;
      if (
        i + 1 < n &&
        j < m &&
        joinedKey(removed.slice(i, i + 2)) === joinedKey(added.slice(j, j + 1))
      ) {
        reach[i + 2][j + 1] = true;
      }
      if (
        i < n &&
        j + 1 < m &&
        joinedKey(removed.slice(i, i + 1)) === joinedKey(added.slice(j, j + 2))
      ) {
        reach[i + 1][j + 2] = true;
      }
      const gone = i < n ? wordKey(removed[i].text) : "";
      if (i < n && (INSERTABLE.has(gone) || movable(gone) || deletable(i))) reach[i + 1][j] = true;
      const extra = j < m ? wordKey(added[j].text) : "";
      if (j < m && (INSERTABLE.has(extra) || movable(extra))) reach[i][j + 1] = true;
    }
  }
  return reach[n][m];
}

// ---------------------------------------------------------------------------
// Segment analysis shared by Correct and Rewrite

const PLACEHOLDER_LIKE = /⟦[^⟦⟧]{0,8}⟧|[⟦⟧]/g;
const QUOTE_CHARS = /["“”„«»‘‚]/;
const CODE_SYMBOL = /[=<>{}[\]|\\/_*#@~`^$%&+]/;
const PRONOUN_I = /^I(?:['’](?:m|ll|ve|d))?$/;
const QUOTE_CLOSERS: Record<string, string> = {
  '"': '"',
  "“": "”",
  "„": "”“",
  "«": "»",
  "»": "«",
  "‘": "’",
  "‚": "’‘",
};

/** Quoted spans of a segment; an unclosed quote runs to the end, a stray closer from the start. */
function quotedRegions(text: string): TextRange[] {
  const regions: TextRange[] = [];
  let open = -1;
  let closers = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (open < 0) {
      if (char === "‘" && /\p{L}/u.test(text[index - 1] ?? "")) continue;
      if (char in QUOTE_CLOSERS) {
        open = index;
        closers = QUOTE_CLOSERS[char];
      } else if (char === "”") {
        regions.push({ start: 0, end: index + 1 });
      }
    } else if (closers.includes(char)) {
      // An apostrophe inside a quotation ("‘don’t’") does not close it.
      if (char === "’" && /\p{L}/u.test(text[index + 1] ?? "")) continue;
      regions.push({ start: open, end: index + 1 });
      open = -1;
    }
  }
  if (open >= 0) regions.push({ start: open, end: text.length });
  return regions;
}

/** Per token: true for a word that starts a sentence (segment start or after . ! ? …). */
function sentenceStarts(tokens: readonly Token[]): boolean[] {
  let atStart = true;
  return tokens.map((token) => {
    if (token.kind === "word") {
      const start = atStart;
      atStart = false;
      return start;
    }
    if (token.kind === "punct" && SENTENCE_MARK.test(token.text)) atStart = true;
    else if (token.kind === "placeholder") atStart = false;
    return false;
  });
}

/** A capitalized word that is not a sentence start or the pronoun I: likely a name. */
function isNameAt(tokens: readonly Token[], starts: readonly boolean[], index: number): boolean {
  const token = tokens[index];
  return (
    token.kind === "word" &&
    !starts[index] &&
    /^\p{Lu}/u.test(token.text) &&
    !PRONOUN_I.test(token.text)
  );
}

function wordsOf(tokens: readonly Token[]): string[] {
  return tokens.filter((token) => token.kind === "word").map((token) => wordKey(token.text));
}

const REQUEST_SUBJECTS = wordSet("you someone somebody anyone anybody we i");

/** Hedge markers; "could you" is a polite request, not uncertainty. */
function hedgeCount(words: readonly string[]): number {
  let count = 0;
  words.forEach((word, index) => {
    const stripped = word.endsWith("n't") ? word.slice(0, -3) : word;
    const next = words[index + 1];
    // "could you/someone …" asks; it does not hedge.
    const request = stripped === "could" && REQUEST_SUBJECTS.has(next ?? "");
    if (HEDGES.has(stripped) && !request) count += 1;
    if (next !== undefined && HEDGE_PAIRS.has(`${word} ${next}`)) count += 1;
  });
  return count;
}

const negationCount = (words: readonly string[]) => words.filter(isNegation).length;

/** Negative-polarity forms that replace a second negative ("not … nothing" -> "not … anything"). */
const NEGATIVE_POLARITY = wordSet("anything anybody anyone ever anywhere any either");

/** Negative quantifiers that make a nonstandard double negative with another negation. */
const NEGATIVE_QUANTIFIERS = wordSet("nothing nobody none never nowhere no neither nor");
const CLAUSE_WORDS = wordSet("and but or so because while although though if when whereas");

/**
 * How many negations a fix may drop by resolving double negatives: per clause
 * with two or more negations, its extra negative quantifiers ("to not change
 * nothing" -> "not to change anything" / "to make no changes"). Two plain
 * "not"s are logical, not a double negative ("I don't not like it"): none.
 */
function doubleNegativeAllowance(words: readonly string[]): number {
  let allowance = 0;
  let clause: string[] = [];
  const flush = () => {
    const negations = clause.filter(isNegation);
    if (negations.length >= 2) {
      const quantifiers = negations.filter((word) => NEGATIVE_QUANTIFIERS.has(word)).length;
      allowance += Math.min(negations.length - 1, quantifiers);
    }
    clause = [];
  };
  for (const word of words) {
    if (CLAUSE_WORDS.has(word)) flush();
    else clause.push(word);
  }
  flush();
  return allowance;
}

/**
 * True when the polarity may have changed. Resolving a double negative is not
 * a change: every dropped negation became its negative-polarity counterpart
 * ("nothing" -> "anything", "no one" -> "anyone") and a negation remains.
 */
function negationChanged(before: readonly string[], after: readonly string[]): boolean {
  const dropped = negationCount(before) - negationCount(after);
  if (dropped === 0) return false;
  if (dropped < 0 || negationCount(after) === 0) return true;
  if (dropped <= doubleNegativeAllowance(before)) return false;
  const polarity = (words: readonly string[]) =>
    words.filter((word) => NEGATIVE_POLARITY.has(word)).length;
  return polarity(after) - polarity(before) < dropped;
}
/** Numbers in order, not as a multiset: "pay 3 now and 5 later" must not become "5 now and 3 later". */
const numbersOf = (tokens: readonly Token[]) =>
  wordsOf(tokens)
    .filter((word) => /\p{N}/u.test(word) || NUMBER_WORDS.has(word))
    .join("\u0000");

/** Literal pieces of a segment: segment-text offsets and their snapshot start. */
interface Piece {
  textStart: number;
  textEnd: number;
  snapStart: number;
}

/**
 * The host-owned map from segment text to snapshot offsets, verified against
 * the snapshot (null when the segment does not belong to it).
 */
function segmentPieces(source: string, segment: AiSegment): Piece[] | null {
  const pieces: Piece[] = [];
  let textCursor = 0;
  let snapCursor = segment.range.start;
  for (const holder of segment.placeholders) {
    const at = segment.text.indexOf(holder.token, textCursor);
    if (at < 0 || at - textCursor !== holder.range.start - snapCursor) return null;
    pieces.push({ textStart: textCursor, textEnd: at, snapStart: snapCursor });
    textCursor = at + holder.token.length;
    snapCursor = holder.range.end;
  }
  if (segment.text.length - textCursor !== segment.range.end - snapCursor) return null;
  pieces.push({ textStart: textCursor, textEnd: segment.text.length, snapStart: snapCursor });
  for (const piece of pieces) {
    const length = piece.textEnd - piece.textStart;
    if (
      segment.text.slice(piece.textStart, piece.textEnd) !==
      source.slice(piece.snapStart, piece.snapStart + length)
    ) {
      return null;
    }
  }
  return pieces;
}

/** Snapshot offset of a segment-text offset inside (or at the edge of) one literal piece. */
function mapOffset(pieces: readonly Piece[], offset: number): number | null {
  for (const piece of pieces) {
    if (offset >= piece.textStart && offset <= piece.textEnd) {
      return piece.snapStart + offset - piece.textStart;
    }
  }
  return null;
}

interface SegmentDiff {
  original: Token[];
  proposed: Token[];
  hunks: Hunk[];
  pieces: Piece[];
  quoted: TextRange[];
}

/** Segment-level shape: host map, no line breaks, exact placeholders, bounded diff. */
function diffSegment(
  prepared: PreparedReview,
  segment: AiSegment,
  proposed: string,
): SegmentDiff | { reason: AiRejectionReason } {
  const pieces = segmentPieces(prepared.snapshot.text, segment);
  if (!pieces || LINE_BREAK_CHAR.test(proposed)) return { reason: "shape" };
  const found = proposed.match(PLACEHOLDER_LIKE) ?? [];
  if (
    found.length !== segment.placeholders.length ||
    found.some((token, index) => token !== segment.placeholders[index].token)
  ) {
    return { reason: "placeholder" };
  }
  const original = tokenize(segment.text);
  const next = tokenize(proposed);
  const hunks = diffTokens(original, next);
  if (!hunks) return { reason: "length" };
  return { original, proposed: next, hunks, pieces, quoted: quotedRegions(segment.text) };
}

/** Spacing at the segment edges belongs to the text around it. */
const edgesOf = (text: string) => `${/^\s*/.exec(text)?.[0]}|${/\s*$/.exec(text)?.[0]}`;
/** Brackets pair up code and asides: a proposal never opens or closes one. */
const bracketsOf = (text: string) => [...text.replace(/[^()[\]{}]/g, "")].sort().join("");

type HunkEdit =
  { ok: true; edit: ReviewEdit; local: TextRange } | { ok: false; reason: AiRejectionReason };

/**
 * One hunk as a snapshot edit: quoted text, code symbols, placeholders, the
 * mapping through the segment map, scope, grapheme boundaries, protected
 * ranges and the exact original text.
 */
function hunkEdit(
  prepared: PreparedReview,
  segment: AiSegment,
  diff: SegmentDiff,
  hunk: Hunk,
): HunkEdit {
  const source = prepared.snapshot.text;
  const { scope } = prepared.snapshot;
  const { original, proposed: next, pieces, quoted } = diff;
  const removed = original.slice(hunk.o0, hunk.o1);
  const added = next.slice(hunk.p0, hunk.p1);
  if ([...removed, ...added].some((token) => token.kind === "placeholder")) {
    return { ok: false, reason: "placeholder" };
  }
  const start = hunk.o0 < original.length ? original[hunk.o0].start : segment.text.length;
  const end = hunk.o1 > hunk.o0 ? original[hunk.o1 - 1].end : start;
  const replacement = added.map((token) => token.text).join("");
  const originalText = segment.text.slice(start, end);
  if (
    QUOTE_CHARS.test(originalText) ||
    QUOTE_CHARS.test(replacement) ||
    quoted.some((region) =>
      start === end
        ? region.start < start && start < region.end
        : rangesOverlap({ start, end }, region),
    )
  ) {
    return { ok: false, reason: "quoted" };
  }
  // Code-like text ("latency=200", "a|b") is left alone, including its spacing.
  const neighbours = [original[hunk.o0 - 1], original[hunk.o1]].filter(Boolean);
  if (
    bracketsOf(originalText) !== bracketsOf(replacement) ||
    [...removed, ...added, ...neighbours].some(
      (token) => CODE_SYMBOL.test(token.text) || /\p{Ll}\p{Lu}/u.test(token.text),
    ) ||
    technicalPieces(replacement).size > 0
  ) {
    return { ok: false, reason: "technical-token" };
  }
  const snapStart = mapOffset(pieces, start);
  const snapEnd = mapOffset(pieces, end);
  if (snapStart === null || snapEnd === null || snapEnd - snapStart !== end - start) {
    return { ok: false, reason: "placeholder" };
  }
  const edit: ReviewEdit = {
    start: snapStart,
    end: snapEnd,
    original: source.slice(snapStart, snapEnd),
    replacement,
  };
  if (
    edit.original !== originalText ||
    edit.start < scope.start ||
    edit.end > scope.end ||
    !isGraphemeBoundary(source, edit.start) ||
    !isGraphemeBoundary(source, edit.end)
  ) {
    return { ok: false, reason: "unsafe-boundary" };
  }
  const touched = prepared.protectedRanges.find((range) => editTouches(edit, range));
  if (touched) {
    return { ok: false, reason: touched.reason === "technical" ? "technical-token" : "protected" };
  }
  // Glued to a protected token ("⟦1⟧)" for "user.save()"): part of it, not prose.
  if (neighbours.some((token) => token.kind === "placeholder")) {
    return { ok: false, reason: "technical-token" };
  }
  return { ok: true, edit, local: { start, end } };
}

/** Edits in segment-text offsets, for rebuilding a segment variant. */
const localEdits = (hunkEdits: ReadonlyArray<{ edit: ReviewEdit; local: TextRange }>) =>
  hunkEdits.map(({ edit, local }) => ({ ...edit, ...local }));

// ---------------------------------------------------------------------------
// Correct mode

/**
 * Turns one chunk's parsed Correct-mode output into guarded findings against
 * the prepared snapshot: word-level diff, protection and scope checks, risk
 * guards (numbers, technical tokens, names, negation, uncertainty, quotes) and
 * drift rejection. A change that touches a placeholder is rejected.
 *
 * Findings are per change unit: hunks separated by at most one unchanged word
 * ("user paste" -> "a user pastes") form one unit, applied atomically so a
 * dependent edit is never applied halfway. Each unit is validated on its own
 * against the original sentence; a rejected unit is counted and dropped
 * without sinking the others.
 */
export function correctionFindings(
  prepared: PreparedReview,
  chunk: AiChunk,
  segments: ReadonlyArray<{ id: string; text: string }>,
): AiCorrectionResult {
  const diagnostics: ReviewDiagnostic[] = [];
  const rejected: Partial<Record<AiRejectionReason, number>> = {};
  const reject = (reason: AiRejectionReason) => {
    rejected[reason] = (rejected[reason] ?? 0) + 1;
  };
  if (
    segments.length !== chunk.segments.length ||
    segments.some((segment, index) => segment.id !== chunk.segments[index].id)
  ) {
    chunk.segments.forEach(() => reject("shape"));
    return { diagnostics, rejected };
  }
  chunk.segments.forEach((segment, index) => {
    const proposed = segments[index].text;
    if (proposed === segment.text) return;
    const result = correctSegment(prepared, segment, proposed);
    diagnostics.push(...result.diagnostics);
    result.rejected.forEach(reject);
  });
  return { diagnostics, rejected };
}

/** Hunks separated by at most one unchanged word belong together. */
function changeUnits(original: readonly Token[], hunks: readonly Hunk[]): Hunk[][] {
  const units: Hunk[][] = [];
  for (const hunk of hunks) {
    const unit = units[units.length - 1];
    const previous = unit?.[unit.length - 1];
    const between = previous
      ? original.slice(previous.o1, hunk.o0).filter((token) => token.kind === "word").length
      : Infinity;
    if (unit && between <= 1) unit.push(hunk);
    else units.push([hunk]);
  }
  return units;
}

function correctSegment(
  prepared: PreparedReview,
  segment: AiSegment,
  proposed: string,
): { diagnostics: ReviewDiagnostic[]; rejected: AiRejectionReason[] } {
  const diff = diffSegment(prepared, segment, proposed);
  if ("reason" in diff) return { diagnostics: [], rejected: [diff.reason] };
  const { original, hunks } = diff;
  if (hunks.length === 0) return { diagnostics: [], rejected: ["shape"] };

  const diagnostics: ReviewDiagnostic[] = [];
  const rejected: AiRejectionReason[] = [];
  for (const unit of changeUnits(original, hunks)) {
    const result = correctUnit(prepared, segment, diff, unit);
    if ("reason" in result) rejected.push(result.reason);
    else diagnostics.push(result.diagnostic);
  }
  return { diagnostics, rejected };
}

/** A word right after a number is its unit ("300 kb", "5ml"): changing it changes the quantity. */
function afterNumber(tokens: readonly Token[], index: number): boolean {
  const digits = (at: number) => /\p{N}/u.test(tokens[at]?.text ?? "");
  return digits(index - 1) || (tokens[index - 1]?.kind === "space" && digits(index - 2));
}

/** The first token index from `index` in the `step` direction that is not a space. */
function nonSpace(tokens: readonly Token[], index: number, step: 1 | -1): number {
  while (tokens[index]?.kind === "space") index += step;
  return index;
}

/** The word token before `index`, across one space, or undefined. */
const wordBefore = (tokens: readonly Token[], index: number) =>
  tokens[index - 1]?.kind === "space" && tokens[index - 2]?.kind === "word"
    ? tokens[index - 2]
    : undefined;
const wordAfter = (tokens: readonly Token[], index: number) =>
  tokens[index + 1]?.kind === "space" && tokens[index + 2]?.kind === "word"
    ? tokens[index + 2]
    : undefined;

/** Validates one change unit against the original sentence and builds its finding. */
function correctUnit(
  prepared: PreparedReview,
  segment: AiSegment,
  diff: SegmentDiff,
  unit: readonly Hunk[],
): { diagnostic: ReviewDiagnostic } | { reason: AiRejectionReason } {
  const { original, proposed: next, pieces } = diff;
  const hunkEdits: Array<{ edit: ReviewEdit; local: TextRange }> = [];
  for (const hunk of unit) {
    const result = hunkEdit(prepared, segment, diff, hunk);
    if (!result.ok) return { reason: result.reason };
    // A model segment can start inside a sentence, after a wrap or selection edge.
    // Check the source context. A line break alone is not sentence evidence.
    const { edit } = result;
    const first = original[hunk.o0];
    const replacement = next[hunk.p0];
    if (
      hunk.o0 === original.findIndex((token) => token.kind === "word") &&
      first?.kind === "word" &&
      replacement?.kind === "word" &&
      wordKey(first.text) === wordKey(replacement.text) &&
      first.text !== replacement.text &&
      !PRONOUN_I.test(replacement.text)
    ) {
      const source = prepared.snapshot.text.split(LINE_BREAK_CHAR).join(" ");
      let contextStart = edit.start;
      // Opening delimiters do not remove sentence evidence, or create it.
      while (contextStart > 0 && /[([\s]/u.test(source[contextStart - 1])) contextStart -= 1;
      if (!startsSentence(source, contextStart, prepared.options.lang)) {
        return { reason: "unsafe-boundary" };
      }
    }
    hunkEdits.push(result);
  }

  // The sentence with only this unit applied: the unit must stand on its own.
  const variant = applyEdits(segment.text, localEdits(hunkEdits));
  if (variant === null) return { reason: "shape" };
  if (edgesOf(variant) !== edgesOf(segment.text)) return { reason: "shape" };
  const changed = tokenize(variant);
  if (numbersOf(original) !== numbersOf(changed)) return { reason: "number" };
  const originalWords = wordsOf(original);
  const changedWords = wordsOf(changed);
  if (negationChanged(originalWords, changedWords)) return { reason: "negation" };
  if (hedgeCount(originalWords) !== hedgeCount(changedWords)) return { reason: "uncertainty" };
  // Terminating a fragment ("lol same" -> "Lol, same.") formalizes it.
  const terminated = (text: string) => /[.!?…]["'”’»)\]]*\s*$/u.test(text);
  if (!terminated(segment.text) && terminated(variant)) {
    return { reason: "drift.optional_style" };
  }

  // "to not change" -> "not to change": "not" moves across one word; the
  // negation count is unchanged (checked above).
  const spanStart = hunkEdits[0].local.start;
  const spanEnd = hunkEdits[hunkEdits.length - 1].local.end;
  const splitInfinitive =
    /\bto not\b/i.test(segment.text.slice(spanStart, spanEnd)) &&
    /\bnot to\b/i.test(variant.slice(spanStart, spanEnd + variant.length - segment.text.length));
  const movable = (word: string) => splitInfinitive && word === "not";

  const originalStarts = sentenceStarts(original);
  const proposedStarts = sentenceStarts(next);
  for (const hunk of unit) {
    const removedIndexes: number[] = [];
    for (let index = hunk.o0; index < hunk.o1; index += 1) {
      if (original[index].kind === "word") removedIndexes.push(index);
    }
    const removed = removedIndexes.map((index) => original[index]);
    const added = next.slice(hunk.p0, hunk.p1).filter((token) => token.kind === "word");
    const splitOrJoined =
      ((removed.length === 1 && added.length === 2) ||
        (removed.length === 2 && added.length === 1)) &&
      joinedKey(removed) === joinedKey(added);
    if (
      !splitOrJoined &&
      removed.some((before) =>
        added.some((after) => oppositePolarity(wordKey(before.text), wordKey(after.text))),
      )
    ) {
      return { reason: "negation" };
    }
    if (removedIndexes.some((index) => afterNumber(original, index))) return { reason: "number" };
    for (let index = hunk.p0; index < hunk.p1; index += 1) {
      if (next[index].kind === "word" && afterNumber(next, index)) return { reason: "number" };
    }
    if (removedIndexes.some((index) => flipsNounNumber(original, index, unit, added))) {
      return { reason: "drift.lexical_substitution" };
    }
    if (removedIndexes.some((index) => isNameAt(original, originalStarts, index))) {
      return { reason: "name" };
    }
    if (removed.some((token) => prepared.dictionary.has(wordKey(token.text)))) {
      return { reason: "name" };
    }
    for (let index = hunk.p0; index < hunk.p1; index += 1) {
      if (
        isNameAt(next, proposedStarts, index) &&
        !removed.some((token) => wordKey(token.text) === wordKey(next[index].text))
      ) {
        return { reason: "name" };
      }
    }
    // Deletions a proofreader makes: a repeated word ("the the"), the "more" of
    // a double comparative ("more slower").
    const deletable = (position: number) => {
      const index = removedIndexes[position];
      const text = wordKey(original[index].text);
      const before = wordBefore(original, index);
      const after = wordAfter(original, index);
      return (
        wordKey(before?.text ?? "") === text ||
        wordKey(after?.text ?? "") === text ||
        ((text === "more" || text === "most") && COMPARATIVE.test(wordKey(after?.text ?? "")))
      );
    };
    // Context-bound replacements: "very more slowly" -> "much more slowly",
    // "many equipments" -> "a lot of equipment" (only before an uncountable noun).
    const phrase = (position: number, j: number) => {
      const index = removedIndexes[position];
      const word = wordKey(original[index].text);
      const after = wordKey(wordAfter(original, index)?.text ?? "");
      const want = added.slice(j).map((token) => wordKey(token.text));
      if (word === "very" && want[0] === "much" && COMPARATIVE_OR_MORE.test(after)) return 1;
      if ((word === "many" || word === "much") && isUncountable(after)) {
        if (want.slice(0, 3).join(" ") === "a lot of") return 3;
        if (want.slice(0, 2).join(" ") === "lots of") return 2;
      }
      return 0;
    };
    if (!isCorrection(removed, added, deletable, movable, phrase) || formalizes(removed, added)) {
      return {
        reason: formalizes(removed, added) ? "drift.optional_style" : "drift.lexical_substitution",
      };
    }
    // A new sentence break inside the segment ("16 rd. chain") is not a correction.
    const addsMark = next.slice(hunk.p0, hunk.p1).some((token) => SENTENCE_MARK.test(token.text));
    if (addsMark && hunk.o1 < original.length) return { reason: "drift.optional_style" };
    if (styleChoice(original, next, hunk, originalStarts))
      return { reason: "drift.optional_style" };
  }

  // Underline from the first to the last change of the unit.
  const local = hunkEdits.map((item) => item.local);
  const edits = hunkEdits.map((item) => item.edit);
  let underlineStart = local[0].start;
  let underlineEnd = local[local.length - 1].end;
  if (underlineStart === underlineEnd) {
    // A lone insertion underlines the token it attaches to.
    const hunk = unit[0];
    const before = original[nonSpace(original, hunk.o0 - 1, -1)];
    const after = original[nonSpace(original, hunk.o1, 1)];
    if (before && before.kind !== "placeholder") underlineStart = before.start;
    else if (after && after.kind !== "placeholder") underlineEnd = after.end;
    else return { reason: "unsafe-boundary" };
  }
  const rangeStart = mapOffset(pieces, underlineStart);
  const rangeEnd = mapOffset(pieces, underlineEnd);
  if (rangeStart === null || rangeEnd === null) return { reason: "placeholder" };
  const range = { start: rangeStart, end: rangeEnd };
  if (
    prepared.protectedRanges.some(
      (protectedRange) =>
        protectedRange.reason !== "technical" && rangesOverlap(range, protectedRange),
    )
  ) {
    return { reason: "protected" };
  }
  const source = prepared.snapshot.text;
  const preview = applyEdits(
    source.slice(range.start, range.end),
    edits.map((edit) => ({
      ...edit,
      start: edit.start - range.start,
      end: edit.end - range.start,
    })),
  );
  if (preview === null) return { reason: "shape" };

  const { snapshot, options } = prepared;
  return {
    diagnostic: {
      id: `${snapshot.id}/${REVIEW_LOCAL_AI_CHECK}@${range.start}-${range.end}#${hashText(preview)}`,
      snapshotId: snapshot.id,
      ruleId: REVIEW_LOCAL_AI_CHECK,
      category: categoryOf(original, next, unit),
      messageKey: "review_msg_local_ai",
      lang: options.lang,
      range,
      original: source.slice(range.start, range.end),
      alternatives: [{ edits, preview }],
      bulk: { eligible: false, reason: "local-ai" },
      context: {
        start: Math.min(segment.range.start, range.start),
        end: Math.max(segment.range.end, range.end),
      },
    },
  };
}

/** Words after which a comma is the writer's choice ("Ok cool", "Well I agree"). */
const INTERJECTIONS = wordSet("ok okay yeah yep yes no nope well oh hey thanks sure cool");
/** Nouns that take a singular or plural verb by dialect ("the data are", "the team have"). */
const DUAL_NUMBER_NOUNS = wordSet("data media staff team committee family audience public");
/** Subjects that end the search for a verb's subject. */
const SUBJECT_PRONOUNS = wordSet("i you he she it we they who which that this these those there");
/** Verb forms that differ only in number. */
const VERB_NUMBER_PAIRS = new Set(["is are", "was were", "has have", "does do"]);
const OPENING_QUOTES = /^["“„«‘]$/;

/**
 * True when a hunk only makes a style or dialect choice that correct text may
 * go either way on: a comma after a sentence-initial interjection, before
 * "too" or an opening quote, subjunctive "were" after "if"/"wish", the case
 * of the first letter after a colon, or verb number with a noun used both ways
 * ("the data are", "the staff is").
 */
function styleChoice(
  original: readonly Token[],
  next: readonly Token[],
  hunk: Hunk,
  starts: readonly boolean[],
): boolean {
  const removed = original.slice(hunk.o0, hunk.o1).filter((token) => token.kind !== "space");
  const added = next.slice(hunk.p0, hunk.p1).filter((token) => token.kind !== "space");
  const before = nonSpace(original, hunk.o0 - 1, -1);
  const after = nonSpace(original, hunk.o1, 1);

  if (removed.length === 0 && added.length === 1 && added[0].text === ",") {
    const word = original[before];
    if (word?.kind === "word" && starts[before] && INTERJECTIONS.has(wordKey(word.text)))
      return true;
    if (OPENING_QUOTES.test(original[after]?.text ?? "")) return true;
    if (wordKey(original[after]?.text ?? "") === "too") {
      const following = nonSpace(original, after + 1, 1);
      // Paired commas mark additive "too"; "too many" may start the next clause.
      const proposedAfter = nonSpace(next, hunk.p1, 1);
      if (
        wordKey(next[proposedAfter]?.text ?? "") === "too" &&
        next[nonSpace(next, proposedAfter + 1, 1)]?.text === ","
      )
        return true;
      // An unpaired comma is optional only before clause-final "too".
      if (!original[following] || SENTENCE_MARK.test(original[following].text)) return true;
    }
  }
  if (removed.length !== 1 || added.length !== 1) return false;
  const [from, to] = [wordKey(removed[0].text), wordKey(added[0].text)];
  if (from === to && original[before]?.text === ":") return true;
  const verbPair = VERB_NUMBER_PAIRS.has(`${from} ${to}`) || VERB_NUMBER_PAIRS.has(`${to} ${from}`);
  if (verbPair && (from === "was" || from === "were")) {
    // "If I was you" / "I wish it was": subject, then if/wish/though.
    const subject = wordBefore(original, hunk.o0);
    const index = subject ? original.indexOf(subject) : -1;
    const trigger = index >= 0 ? wordKey(wordBefore(original, index)?.text ?? "") : "";
    if (["if", "wish", "wished", "though"].includes(trigger)) return true;
  }
  if (verbPair || pluralOf(from, to) !== null) {
    // Walk back to the verb's subject: a pronoun ends the search.
    for (let index = hunk.o0 - 1; index >= 0; index -= 1) {
      if (original[index].kind !== "word") continue;
      const word = wordKey(original[index].text);
      if (DUAL_NUMBER_NOUNS.has(word)) return true;
      if (SUBJECT_PRONOUNS.has(word)) return false;
    }
  }
  return false;
}

const COMPARATIVE_OR_MORE = /^(?:more|less|\p{L}{2,}er|better|worse)$/u;
const COMPARATIVE = /^(?:\p{L}{2,}(?:er|est)|better|best|worse|worst|less|least|fewer)$/u;

/** Category by the kind of change; a generic "grammar" rather than a guessed rule. */
function categoryOf(
  original: readonly Token[],
  next: readonly Token[],
  hunks: readonly Hunk[],
): ReviewCategory {
  const changed = hunks.map((hunk) => ({
    removed: original.slice(hunk.o0, hunk.o1).filter((token) => token.kind !== "space"),
    added: next.slice(hunk.p0, hunk.p1).filter((token) => token.kind !== "space"),
  }));
  const tokens = changed.flatMap((change) => [...change.removed, ...change.added]);
  if (tokens.every((token) => token.kind !== "word")) return "punctuation";
  if (
    changed.every(
      (change) =>
        change.removed.length === change.added.length &&
        change.removed.every(
          (token, index) =>
            token.kind === "word" &&
            change.added[index].kind === "word" &&
            closeKind(token.text, change.added[index].text) === "case",
        ),
    )
  ) {
    return "typography";
  }
  if (
    changed.length === 1 &&
    changed[0].removed.length === 1 &&
    changed[0].added.length === 1 &&
    changed[0].removed[0].kind === "word" &&
    changed[0].added[0].kind === "word" &&
    closeKind(changed[0].removed[0].text, changed[0].added[0].text) === "spelling"
  ) {
    return "spelling";
  }
  return "grammar";
}

// ---------------------------------------------------------------------------
// Rewrite mode

/**
 * New commitments, apologies, deadlines, greetings and sign-offs (normalized
 * stems). A rewrite may keep them, never add them.
 */
const COMMITMENT_WORD =
  /^(?:sorry|apolog\w*|promis\w*|guarantee\w*|asap|today|tomorrow|tonight|deadlines?|urgent\w*|dear|hi|hello|hey|regards|sincerely|cheers|thanks?|przepraszam|obiecuj\w*|gwarantuj\w*|dzi[sś]|dzisiaj|jutro|pozdrawiam|pozdrowienia|dzięki|dziękuję)$/u;
const COMMITMENT_PHRASE =
  /\b(?:will ensure|by (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|eod|end of (?:the )?(?:day|week)))\b/g;

function commitmentCounts(words: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);
  for (const word of words) {
    if (!COMMITMENT_WORD.test(word)) continue;
    bump(
      word
        .replace(/^(apolog|promis|guarantee|urgent|obiecuj|gwarantuj)\w*$/u, "$1")
        .replace(/^thanks$/, "thank"),
    );
  }
  for (const match of words.join(" ").matchAll(COMMITMENT_PHRASE)) bump(match[0]);
  return counts;
}

const POLISH_WORDS = wordSet(`
  w we z ze na do o od po za się nie że to jest są czy jak ale dla proszę już też tak
`);
const ENGLISH_WORDS = wordSet(`
  the a an and or to of in on at for with is are was were be have has it this that you we
  please will not
`);

/**
 * The proposal is in another language than the original ("wrzuciłem fix,
 * sprawdźcie proszę" -> "I pushed a fix, please check"): a rewrite never
 * translates. Polish vs English by diacritics and function words.
 */
function languageShifted(before: readonly string[], after: readonly string[]): boolean {
  const language = (words: readonly string[]) => {
    const polish = words.filter((w) => POLISH_WORDS.has(w) || /[ąćęłńóśźż]/u.test(w)).length;
    const english = words.filter((w) => ENGLISH_WORDS.has(w)).length;
    return polish > english ? "pl" : english > polish ? "en" : null;
  };
  const from = language(before);
  const to = language(after);
  return from !== null && to !== null && from !== to;
}

/** Candidate technical tokens (URLs, addresses, paths, dotted names) of a text. */
function technicalPieces(text: string): Set<string> {
  const pieces = new Set<string>();
  for (const piece of text.split(/\s+/)) {
    const core = piece.replace(/^[("'“‘[<]+|[.,;:!?)\]"'”’>]+$/gu, "");
    if (core && !/[⟦⟧]/.test(core) && isTechnicalToken(core)) pieces.add(core);
  }
  return pieces;
}

/**
 * Builds one validated rewrite proposal for the whole requested scope from
 * all chunks' parsed outputs, or a rejection.
 *
 * Every sentence (segment) is checked on its own: facts (numbers in order,
 * names, technical tokens) stay in their sentence, negation and uncertainty
 * are preserved, no new commitments, apologies, deadlines, greetings or
 * sign-offs, no translation, quotes untouched, length within the style's
 * bounds. A failing sentence is kept as written and counted in `kept`; the
 * proposal stands when at least one changed sentence passed. Structural
 * problems (ids, line breaks, placeholders) reject the whole proposal, and so
 * does a proposal whose every changed sentence failed (most frequent reason).
 * Edits are word hunks, so untouched words (and their formatting) stay.
 */
export function rewriteProposal(
  prepared: PreparedReview,
  chunks: readonly AiChunk[],
  outputs: ReadonlyArray<ReadonlyArray<{ id: string; text: string }>>,
  style: ConcreteRewriteStyle,
): RewriteProposal {
  const fail = (reason: AiRejectionReason): RewriteProposal => ({ ok: false, reason });
  if (chunks.length === 0 || outputs.length !== chunks.length) return fail("shape");
  const edits: ReviewEdit[] = [];
  const kept: Partial<Record<AiRejectionReason, number>> = {};
  let passed = 0;
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex];
    const output = outputs[chunkIndex];
    if (output.length !== chunk.segments.length) return fail("shape");
    for (let index = 0; index < chunk.segments.length; index += 1) {
      const segment = chunk.segments[index];
      if (output[index].id !== segment.id) return fail("shape");
      const proposed = output[index].text;
      if (proposed === segment.text) continue;
      const diff = diffSegment(prepared, segment, proposed);
      if ("reason" in diff) return fail(diff.reason);
      const result = rewriteSegment(prepared, segment, proposed, diff, style);
      if ("reason" in result) {
        kept[result.reason] = (kept[result.reason] ?? 0) + 1;
      } else {
        edits.push(...result.edits);
        passed += 1;
      }
    }
  }
  const reasons = Object.entries(kept) as Array<[AiRejectionReason, number]>;
  if (passed === 0 && reasons.length > 0) {
    // Most frequent; ties go to the first reason met.
    return fail(reasons.reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0]);
  }
  if (edits.length === 0) return fail("unchanged");

  const source = prepared.snapshot.text;
  const { scope } = prepared.snapshot;
  const rewritten = applyEdits(source, edits);
  if (rewritten === null) return fail("shape");
  const delta = rewritten.length - source.length;
  return {
    ok: true,
    before: source.slice(scope.start, scope.end),
    after: rewritten.slice(scope.start, scope.end + delta),
    edits: edits.sort((a, b) => a.start - b.start),
    kept,
  };
}

/** One sentence of a rewrite: its edits, or why it must stay as written. */
function rewriteSegment(
  prepared: PreparedReview,
  segment: AiSegment,
  proposed: string,
  diff: SegmentDiff,
  style: ConcreteRewriteStyle,
): { edits: ReviewEdit[] } | { reason: AiRejectionReason } {
  if (edgesOf(proposed) !== edgesOf(segment.text)) return { reason: "shape" };
  if (bracketsOf(proposed) !== bracketsOf(segment.text)) return { reason: "technical-token" };
  const hunkEdits: Array<{ edit: ReviewEdit; local: TextRange }> = [];
  for (const hunk of diff.hunks) {
    const result = hunkEdit(prepared, segment, diff, hunk);
    if (!result.ok) return { reason: result.reason };
    hunkEdits.push(result);
  }
  if (applyEdits(segment.text, localEdits(hunkEdits)) !== proposed) return { reason: "shape" };

  const { original, proposed: next } = diff;
  if (numbersOf(original) !== numbersOf(next)) return { reason: "number" };
  const originalTechnical = technicalPieces(segment.text);
  for (const piece of technicalPieces(proposed)) {
    if (!originalTechnical.has(piece)) return { reason: "technical-token" };
  }
  const originalWords = wordsOf(original);
  const proposedWords = wordsOf(next);
  const proposedExact = new Set(next.map((token) => token.text));
  const originalLower = new Set(originalWords);
  const starts = sentenceStarts(original);
  const nextStarts = sentenceStarts(next);
  if (
    original.some((token, at) => isNameAt(original, starts, at) && !proposedExact.has(token.text))
  ) {
    return { reason: "name" };
  }
  if (
    next.some(
      (token, at) => isNameAt(next, nextStarts, at) && !originalLower.has(wordKey(token.text)),
    )
  ) {
    return { reason: "name" };
  }
  if (negationChanged(originalWords, proposedWords)) return { reason: "negation" };
  if (languageShifted(originalWords, proposedWords)) return { reason: "drift" };
  if (hedgeCount(originalWords) !== hedgeCount(proposedWords)) return { reason: "uncertainty" };
  const commitmentsBefore = commitmentCounts(originalWords);
  for (const [key, count] of commitmentCounts(proposedWords)) {
    if (count > (commitmentsBefore.get(key) ?? 0)) return { reason: "invented" };
  }
  const before = segment.text.length;
  const after = proposed.length;
  const [low, high] = style === "concise" ? [0.3, 1.2] : [0.5, 2];
  if (after < before * low || after > Math.max(before * high, before + 20)) {
    return { reason: "length" };
  }
  return { edits: hunkEdits.map((item) => item.edit) };
}
