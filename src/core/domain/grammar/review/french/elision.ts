import { namedExampleBefore } from "../exampleCues";
import type { DetectContext, RawFinding, ReviewDetectorEntry } from "../reviewDetectors";
import { ownedFrenchWords, tokensBefore, withCase } from "./frenchTokens";

// Elision: "le", "de", "que", "je", "ne", "me", "te", "se", "la" drop their vowel before a word
// that starts with a vowel ("l'arbre", "qu'il"), written with an apostrophe and no space.

const RULE = "frenchElision";
const MESSAGE = "review_msg_fr_elision";

const VOWEL = /^[aeiouâàäéèêëîïôöûùüœæ]/i;
// Vowel-initial words that refuse elision ("le oui", "le onze", "la une"), and words after
// which an elided form reads differently.
const NO_ELISION = new Set([
  "oui",
  "onze",
  "onzième",
  "onzièmes",
  "ouistiti",
  "uhlan",
  "ululement",
]);
const NOT_A_WORD_AFTER = new Set(["à", "a", "ou", "où", "et", "est", "en", "au", "aux"]);
const ARTICLES = new Set(["le", "la", "les", "un", "une", "du", "des", "ce"]);
const NOT_AFTER_ARTICLE = new Set(
  "il ils elle elles on aussi encore avec ici ensuite alors après aujourd'hui".split(" "),
);
const SENTENCE_START = /(?:^|[.!?…\n])[\s\u00a0]*$/u;
// Letters a text may use as variables ("si c divise a, alors c est premier").
const VARIABLE_LETTERS = new Set(["c", "d", "l", "m", "n", "s", "t"]);
/** Conjunctions ending in "que" elide only before these. */
const QUE_COMPOUNDS = new Set(["lorsque", "puisque", "quoique"]);
const BEFORE_QUE_COMPOUND = new Set(["il", "ils", "elle", "elles", "on", "un", "une"]);

/** The letter a word elides to: "je" -> "j", "que" -> "qu", "la" -> "l". */
const ELIDED: Record<string, string> = {
  je: "j",
  me: "m",
  te: "t",
  se: "s",
  le: "l",
  la: "l",
  ne: "n",
  de: "d",
  que: "qu",
  lorsque: "lorsqu",
  puisque: "puisqu",
  quoique: "quoiqu",
};

function apostropheNear(ctx: DetectContext, index: number): string {
  const nearby = ctx.text.slice(Math.max(0, index - 300), index + 300);
  return nearby.includes("’") && !nearby.includes("'") ? "’" : "'";
}

/** "je aime", "que il", "le arbre": the full word before a vowel. */
function missingElision(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const typed = m.groups!.word;
  const next = m.groups!.next;
  const lower = typed.toLowerCase();
  const nextLower = next.toLowerCase();
  // "je y vais" -> "j'y": the pronoun "y" elides like a vowel.
  if ((!VOWEL.test(next) && nextLower !== "y") || NO_ELISION.has(nextLower)) return null;
  if (QUE_COMPOUNDS.has(lower) && !BEFORE_QUE_COMPOUND.has(nextLower)) return null;
  if (NOT_A_WORD_AFTER.has(nextLower) && !(lower === "que" && nextLower === "à")) return null;
  // Names, titles and foreign words ("de Autant en emporte le vent") keep their spelling, and
  // so does a capitalized "Me"/"Se" inside a sentence ("Kiss Me Once", "Macintosh SE").
  if ((next.length < 2 && nextLower !== "y" && nextLower !== "à") || /\p{Lu}/u.test(next))
    return null;
  if (
    /^\p{Lu}/u.test(typed) &&
    !SENTENCE_START.test(ctx.text.slice(Math.max(0, m.index - 4), m.index))
  )
    return null;
  // "le ne explétif", "5.000 me": the word named, or a unit.
  const previous = tokensBefore(ctx.text, m.index, 1)[0];
  if (previous && ARTICLES.has(previous.w)) return null;
  if (/\d\s*$/.test(ctx.text.slice(Math.max(0, m.index - 3), m.index))) return null;
  // "Et la il est", "la aussi": "là" missing its accent, not the article.
  if (lower === "la" && NOT_AFTER_ARTICLE.has(nextLower)) return null;
  const end = m.index + typed.length + m.groups!.space.length + next.length;
  // "de un à dix": a number in a range.
  if (
    (nextLower === "un" || nextLower === "une") &&
    /^\s+(?:à|a)(?=\s|$)|^\s*\d/u.test(ctx.text.slice(end))
  )
    return null;
  // "la une", "le un": the noun "une" or the numeral after an article.
  if ((lower === "la" || lower === "le") && (nextLower === "un" || nextLower === "une"))
    return null;
  if (ctx.dictionary.has(lower) || namedExampleBefore(ctx.text, m.index)) return null;
  const apostrophe = apostropheNear(ctx, m.index);
  const fixed = withCase(typed, ELIDED[lower]) + apostrophe + next;
  return {
    ruleId: RULE,
    messageKey: MESSAGE,
    range: { start: m.index, end },
    alternatives: [fixed],
  };
}

/** "l arbre", "qu il", "d’ enfants": the apostrophe missing, or followed by a space. */
function spacedElision(ctx: DetectContext, m: RegExpExecArray): RawFinding | null {
  const letter = m.groups!.letter;
  const next = m.groups!.next;
  const mark = m.groups!.mark;
  const before = ctx.text.slice(Math.max(0, m.index - 3), m.index);
  // "a, b, c", "M. J Dupont", "2 l eau": letters, initials and units.
  if (/[\d,]\s*$/.test(before) || /^\p{Lu}/u.test(next)) return null;
  if (!mark) {
    if (/^\p{Lu}/u.test(letter) && !/(?:^|[.!?]\s*)$/.test(before)) return null;
    // "s" only elides "si" before "il(s)".
    if (letter.toLowerCase() === "s" && !/^ils?$/.test(next)) return null;
    if (!VOWEL.test(next) && !/^h/.test(next)) return null;
    // A single letter before a word may be a variable or a list item ("l ensemble L").
    if (/^\s*[,;:]/.test(ctx.text.slice(m.index + m[0].length))) return null;
    if (["et", "ou", "avec", "par", "entier"].includes(next.toLowerCase())) return null;
    // "les valeurs a, b et c en", "la fonction c a été": letters in a list or as names.
    if (
      /(?<![\p{L}\p{N}])\p{L}\s*(?:,|\bet|\bou)\s*$/u.test(
        ctx.text.slice(Math.max(0, m.index - 8), m.index),
      )
    )
      return null;
    if (letter === "c" && next.toLowerCase() === "a") return null;
    if (VARIABLE_LETTERS.has(letter)) {
      const around = ctx.text.slice(Math.max(0, m.index - 200), m.index + 200);
      const standalone = new RegExp(`(?<![\\p{L}\\p{N}'’-])${letter}(?![\\p{L}\\p{N}'’-])`, "gu");
      if ((around.match(standalone) ?? []).length > 1) return null;
    }
  } else if (!VOWEL.test(next) && !/^h/i.test(next)) {
    // "n' pas": an apostrophe before a consonant has lost a word, not a space.
    return null;
  }
  if (namedExampleBefore(ctx.text, m.index)) return null;
  const apostrophe = mark?.trim() || apostropheNear(ctx, m.index);
  return {
    ruleId: RULE,
    messageKey: MESSAGE,
    range: { start: m.index, end: m.index + m[0].length },
    alternatives: [letter + apostrophe + next],
  };
}

const FULL =
  /(?<![\p{L}\p{M}\p{N}_'’-])(?<word>je|me|te|se|le|la|ne|de|que|lorsque|puisque|quoique)(?=(?<space>[ \t]+)(?<next>\p{L}[\p{L}\p{M}]*)(?![\p{L}\p{M}\p{N}_'’-]))/giu;
const SPACED =
  /(?<![\p{L}\p{M}\p{N}_'’.-])(?<letter>[cdjlmnst]|qu)(?:(?<mark>[ \t]*['’][ \t]+|[ \t]+['’][ \t]*)|[ \t]+)(?<next>\p{L}[\p{L}\p{M}]*)(?![\p{L}\p{M}\p{N}_'’-])/giu;

function elision(ctx: DetectContext): RawFinding[] {
  if (ctx.lang.slice(0, 2) !== "fr") return [];
  const findings: RawFinding[] = [];
  for (const m of ownedFrenchWords(ctx, FULL)) {
    const finding = missingElision(ctx, m);
    if (finding) findings.push(finding);
  }
  for (const m of ownedFrenchWords(ctx, SPACED)) {
    const finding = spacedElision(ctx, m);
    if (finding) findings.push(finding);
  }
  return findings;
}

export const DETECTORS: readonly ReviewDetectorEntry[] = [{ rules: [RULE], detect: elision }];
