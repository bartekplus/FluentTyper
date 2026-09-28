import { damerauLevenshteinDistance } from "../../../editDistance";
import { isTechnicalToken } from "../../implementations/helpers/GenericRuleShared";
import type { PreparedReview } from "../reviewDiagnostics";
import { applyEdits, editTouches, isGraphemeBoundary, rangesOverlap } from "../textRanges";
import {
  REVIEW_LOCAL_AI_CHECK,
  type ReviewCategory,
  type ReviewDiagnostic,
  type ReviewEdit,
  type TextRange,
} from "../types";
import { hashText } from "./segments";
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
  return hunks;
}

// ---------------------------------------------------------------------------
// Word classes (English first; a few Polish entries where cheap)

const lower = (word: string) => word.toLowerCase().replace(/’/g, "'");
const wordSet = (list: string) => new Set(list.trim().split(/\s+/));

/**
 * Negation words. Contractions typed without the apostrophe count too, except
 * "cant" and "wont", which are also real words ("the cant of the roof").
 */
const NEGATIONS = wordSet(`
  not no never none nobody nothing nowhere neither nor without cannot dont doesnt didnt isnt
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

const SENTENCE_MARK = /^[.!?…]$/;
const hasApostrophe = (token: Token) => /\p{L}['’]\p{L}/u.test(token.text);

/**
 * True when a hunk only changes register: informal words replaced, contractions
 * expanded ("can't" -> "cannot") or formed from two words ("do not" -> "don't").
 * Restoring a missing apostrophe ("dont" -> "don't") is still a correction.
 */
function formalizes(removed: readonly Token[], added: readonly Token[]): boolean {
  if (removed.some((token) => INFORMAL.has(lower(token.text)))) return true;
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
  ["of", "in", "on", "at", "to", "for", "with", "from", "by", "about", "into", "onto"],
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
  ["w", "we", "z", "ze", "o", "na", "do", "od", "po", "za", "się"],
];
/** Words that may be inserted or deleted by a correction (articles, auxiliaries, prepositions). */
const INSERTABLE = new Set(WORD_GROUPS.slice(0, 5).flat().concat(WORD_GROUPS[15]));

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

type CloseKind = "case" | "form" | "spelling";

/**
 * How two words relate, if a proofreader could swap them: case only, a
 * grammatical form (apostrophe, family, inflection) or a spelling fix (small
 * edit distance, diacritics). Anything else is a different word (drift).
 */
function closeKind(a: string, b: string): CloseKind | null {
  const x = lower(a);
  const y = lower(b);
  if (x === y) return "case";
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
  repeated: (index: number) => boolean,
): boolean {
  const n = removed.length;
  const m = added.length;
  if (n > 8 || m > 8) return false;
  const joined = (tokens: readonly Token[], from: number) =>
    bare(lower(tokens[from].text + tokens[from + 1].text));
  const reach = Array.from({ length: n + 1 }, () => new Array<boolean>(m + 1).fill(false));
  reach[0][0] = true;
  for (let i = 0; i <= n; i += 1) {
    for (let j = 0; j <= m; j += 1) {
      if (!reach[i][j]) continue;
      if (i < n && j < m && closeKind(removed[i].text, added[j].text)) reach[i + 1][j + 1] = true;
      if (i + 1 < n && j < m && joined(removed, i) === bare(lower(added[j].text))) {
        reach[i + 2][j + 1] = true;
      }
      if (i < n && j + 1 < m && bare(lower(removed[i].text)) === joined(added, j)) {
        reach[i + 1][j + 2] = true;
      }
      if (i < n && (INSERTABLE.has(lower(removed[i].text)) || repeated(i))) reach[i + 1][j] = true;
      if (j < m && INSERTABLE.has(lower(added[j].text))) reach[i][j + 1] = true;
    }
  }
  return reach[n][m];
}

// ---------------------------------------------------------------------------
// Segment analysis shared by Correct and Rewrite

const LINE_BREAK = /[\r\n\u2028\u2029]/;
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
    if (token.kind === "punct" && /^[.!?…]$/.test(token.text)) atStart = true;
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
  return tokens.filter((token) => token.kind === "word").map((token) => lower(token.text));
}

/** Hedge markers; "could you" is a polite request, not uncertainty. */
function hedgeCount(words: readonly string[]): number {
  let count = 0;
  words.forEach((word, index) => {
    const stripped = word.endsWith("n't") ? word.slice(0, -3) : word;
    const next = words[index + 1];
    if (HEDGES.has(stripped) && next !== "you") count += 1;
    if (next !== undefined && HEDGE_PAIRS.has(`${word} ${next}`)) count += 1;
  });
  return count;
}

const negationCount = (words: readonly string[]) => words.filter(isNegation).length;
const numbersOf = (tokens: readonly Token[]) =>
  tokens
    .filter(
      (token) =>
        token.kind === "word" && (/\p{N}/u.test(token.text) || NUMBER_WORDS.has(lower(token.text))),
    )
    .map((token) => lower(token.text));

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

type Analysis =
  | {
      ok: true;
      original: Token[];
      proposed: Token[];
      hunks: Hunk[];
      /** Snapshot edits, one per hunk, in order. */
      edits: ReviewEdit[];
      /** The same edits in segment-text offsets. */
      local: Array<{ start: number; end: number }>;
      pieces: Piece[];
    }
  | { ok: false; reason: AiRejectionReason };

/**
 * Checks shared by both modes for one segment: shape, placeholders, quoted
 * text, code symbols, the token diff and its mapping to snapshot edits
 * (scope, grapheme boundaries, protected ranges, exact originals) and the
 * reconstruction of the proposed text.
 */
function analyzeSegment(prepared: PreparedReview, segment: AiSegment, proposed: string): Analysis {
  const source = prepared.snapshot.text;
  const { scope } = prepared.snapshot;
  const pieces = segmentPieces(source, segment);
  if (!pieces || LINE_BREAK.test(proposed)) return { ok: false, reason: "shape" };
  const found = proposed.match(PLACEHOLDER_LIKE) ?? [];
  if (
    found.length !== segment.placeholders.length ||
    found.some((token, index) => token !== segment.placeholders[index].token)
  ) {
    return { ok: false, reason: "placeholder" };
  }
  const original = tokenize(segment.text);
  const next = tokenize(proposed);
  const hunks = diffTokens(original, next);
  if (!hunks) return { ok: false, reason: "length" };

  const quoted = quotedRegions(segment.text);
  const edits: ReviewEdit[] = [];
  const local: Array<{ start: number; end: number }> = [];
  for (const hunk of hunks) {
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
          : start < region.end && region.start < end,
      )
    ) {
      return { ok: false, reason: "quoted" };
    }
    // Code-like text ("latency=200", "a|b") is left alone, including its spacing.
    const neighbours = [original[hunk.o0 - 1], original[hunk.o1]].filter(Boolean);
    if (
      [...removed, ...added, ...neighbours].some(
        (token) => CODE_SYMBOL.test(token.text) || /\p{Ll}\p{Lu}/u.test(token.text),
      ) ||
      replacement.split(/\s+/).some((piece) => {
        const core = piece.replace(/^[("'“‘[<]+|[.,;:!?)\]"'”’>]+$/gu, "");
        return core !== "" && isTechnicalToken(core);
      })
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
      return {
        ok: false,
        reason: touched.reason === "technical" ? "technical-token" : "protected",
      };
    }
    edits.push(edit);
    local.push({ start, end });
  }
  const rebuilt = applyEdits(
    segment.text,
    edits.map((edit, index) => ({ ...edit, ...local[index] })),
  );
  if (rebuilt !== proposed) return { ok: false, reason: "shape" };
  return { ok: true, original, proposed: next, hunks, edits, local, pieces };
}

// ---------------------------------------------------------------------------
// Correct mode

/**
 * Turns one chunk's parsed Correct-mode output into guarded findings against
 * the prepared snapshot: word-level diff, placeholder restore, protection and
 * scope checks, risk guards (numbers, technical tokens, names, negation,
 * uncertainty, quotes), drift rejection, sentence-grouped atomic hunks and a
 * reconstruction check.
 *
 * A segment is one sentence; all of its accepted hunks form ONE diagnostic
 * with one alternative, so dependent edits are never applied halfway. Any
 * failing hunk rejects the whole segment.
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
    if ("reason" in result) reject(result.reason);
    else diagnostics.push(result.diagnostic);
  });
  return { diagnostics, rejected };
}

function correctSegment(
  prepared: PreparedReview,
  segment: AiSegment,
  proposed: string,
): { diagnostic: ReviewDiagnostic } | { reason: AiRejectionReason } {
  const lengthDelta = Math.abs(proposed.length - segment.text.length);
  if (lengthDelta > Math.max(12, Math.ceil(segment.text.length * 0.25)))
    return { reason: "length" };
  const analysis = analyzeSegment(prepared, segment, proposed);
  if (!analysis.ok) return { reason: analysis.reason };
  const { original, proposed: next, hunks, edits, local, pieces } = analysis;
  if (hunks.length === 0) return { reason: "shape" };

  const originalWords = wordsOf(original);
  const proposedWords = wordsOf(next);
  if (hunks.length > Math.max(3, Math.ceil(originalWords.length / 4))) {
    return { reason: "too-many-edits" };
  }
  if (numbersOf(original).join("\u0000") !== numbersOf(next).join("\u0000")) {
    return { reason: "number" };
  }
  if (negationCount(originalWords) !== negationCount(proposedWords)) return { reason: "negation" };
  if (hedgeCount(originalWords) !== hedgeCount(proposedWords)) return { reason: "uncertainty" };

  // Terminating a fragment ("lol same" -> "Lol, same.") formalizes it.
  const terminated = (text: string) => /[.!?…]["'”’»)\]]*\s*$/u.test(text);
  if (!terminated(segment.text) && terminated(proposed)) return { reason: "drift" };

  const originalStarts = sentenceStarts(original);
  const proposedStarts = sentenceStarts(next);
  const wordAt = (index: number) => original[index]?.kind === "word";
  for (const hunk of hunks) {
    const removedIndexes: number[] = [];
    for (let index = hunk.o0; index < hunk.o1; index += 1) {
      if (original[index].kind === "word") removedIndexes.push(index);
    }
    const removed = removedIndexes.map((index) => original[index]);
    const added = next.slice(hunk.p0, hunk.p1).filter((token) => token.kind === "word");
    if (removedIndexes.some((index) => isNameAt(original, originalStarts, index))) {
      return { reason: "name" };
    }
    if (removed.some((token) => prepared.dictionary.has(lower(token.text)))) {
      return { reason: "name" };
    }
    for (let index = hunk.p0; index < hunk.p1; index += 1) {
      if (
        isNameAt(next, proposedStarts, index) &&
        !removed.some((token) => lower(token.text) === lower(next[index].text))
      ) {
        return { reason: "name" };
      }
    }
    // "the the" -> "the": a deleted word repeating its neighbour.
    const repeated = (position: number) => {
      const index = removedIndexes[position];
      const text = lower(original[index].text);
      return (
        (original[index - 1]?.kind === "space" &&
          wordAt(index - 2) &&
          lower(original[index - 2].text) === text) ||
        (original[index + 1]?.kind === "space" &&
          wordAt(index + 2) &&
          lower(original[index + 2].text) === text)
      );
    };
    if (!isCorrection(removed, added, repeated) || formalizes(removed, added)) {
      return { reason: "drift" };
    }
    // A new sentence break inside the segment ("16 rd. chain") is not a correction.
    const addedMarks = next
      .slice(hunk.p0, hunk.p1)
      .filter((token) => SENTENCE_MARK.test(token.text));
    if (addedMarks.length > 0 && hunk.o1 < original.length) return { reason: "drift" };
  }

  // One atomic finding for the sentence: underline from the first to the last change.
  let underlineStart = local[0].start;
  let underlineEnd = local[local.length - 1].end;
  if (underlineStart === underlineEnd) {
    // A lone insertion underlines the token it attaches to.
    const hunk = hunks[0];
    const before = original
      .slice(0, hunk.o0)
      .reverse()
      .find((token) => token.kind !== "space");
    const after = original.slice(hunk.o1).find((token) => token.kind !== "space");
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
      category: categoryOf(original, next, hunks),
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
 * all chunks' parsed outputs, or a rejection. Facts (numbers, names, technical
 * tokens), negation and uncertainty must be preserved; no new commitments,
 * apologies, deadlines, greetings or sign-offs; length within the style's
 * bounds. Edits are word hunks, so untouched words (and their formatting) stay.
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
  const originalTokens: Token[][] = [];
  const proposedTokens: Token[][] = [];
  let originalText = "";
  let proposedText = "";
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex];
    const output = outputs[chunkIndex];
    if (output.length !== chunk.segments.length) return fail("shape");
    for (let index = 0; index < chunk.segments.length; index += 1) {
      const segment = chunk.segments[index];
      if (output[index].id !== segment.id) return fail("shape");
      const proposed = output[index].text;
      const analysis = analyzeSegment(prepared, segment, proposed);
      if (!analysis.ok) return fail(analysis.reason);
      edits.push(...analysis.edits);
      originalTokens.push(analysis.original);
      proposedTokens.push(analysis.proposed);
      originalText += `${segment.text}\n`;
      proposedText += `${proposed}\n`;
    }
  }

  const sorted = (values: string[]) => values.sort().join("\u0000");
  if (sorted(originalTokens.flatMap(numbersOf)) !== sorted(proposedTokens.flatMap(numbersOf))) {
    return fail("number");
  }
  const originalTechnical = technicalPieces(originalText);
  for (const piece of technicalPieces(proposedText)) {
    if (!originalTechnical.has(piece)) return fail("technical-token");
  }

  const originalWords = originalTokens.flatMap(wordsOf);
  const proposedWords = proposedTokens.flatMap(wordsOf);
  const proposedExact = new Set(proposedTokens.flat().map((token) => token.text));
  const originalLower = new Set(originalWords);
  for (let index = 0; index < originalTokens.length; index += 1) {
    const tokens = originalTokens[index];
    const starts = sentenceStarts(tokens);
    if (
      tokens.some((token, at) => isNameAt(tokens, starts, at) && !proposedExact.has(token.text))
    ) {
      return fail("name");
    }
    const next = proposedTokens[index];
    const nextStarts = sentenceStarts(next);
    if (
      next.some(
        (token, at) => isNameAt(next, nextStarts, at) && !originalLower.has(lower(token.text)),
      )
    ) {
      return fail("name");
    }
  }
  if (negationCount(originalWords) !== negationCount(proposedWords)) return fail("negation");
  if (hedgeCount(originalWords) !== hedgeCount(proposedWords)) return fail("uncertainty");
  const commitmentsBefore = commitmentCounts(originalWords);
  for (const [key, count] of commitmentCounts(proposedWords)) {
    if (count > (commitmentsBefore.get(key) ?? 0)) return fail("invented");
  }

  const before = originalText.length;
  const after = proposedText.length;
  const [low, high] = style === "concise" ? [0.3, 1.2] : [0.5, 2];
  if (after < before * low || after > Math.max(before * high, before + 20)) return fail("length");

  const source = prepared.snapshot.text;
  const { scope } = prepared.snapshot;
  const rewritten = applyEdits(source, edits);
  if (rewritten === null) return fail("shape");
  const delta = rewritten.length - source.length;
  return {
    ok: true,
    style,
    before: source.slice(scope.start, scope.end),
    after: rewritten.slice(scope.start, scope.end + delta),
    edits: edits.sort((a, b) => a.start - b.start),
  };
}
